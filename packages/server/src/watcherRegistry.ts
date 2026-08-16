import {
  listMessages,
  watchMailbox,
  type AccountConfig,
  type MessageSummary,
  type NewMailEvent,
} from '@energy-mail/mail-core';
import { listAccounts } from './accountStore.js';
import { verwerfe } from './cache.js';
import { aktualisiereGelesen, nachrichtenSchluessel, verwirfNachrichten } from './messageCache.js';
import { aktuellerNutzer, alsNutzer } from './nutzer/kontext.js';
import { jeNutzer } from './nutzer/jeNutzer.js';
import { passt, regelnFuer, wendeRegelnAn } from './rules.js';
import { beantworteNeue } from './abwesenheit.js';
import { erfasseEingang } from './archiv/erfassen.js';

interface EventBase {
  accountId: string;
  email: string;
  folder: string;
}

export type MailEvent =
  | (EventBase & {
      type: 'new-mail';
      count: number;
      prevCount: number;
      /**
       * Kopfdaten der neu eingetroffenen Nachrichten - Grundlage für die Meldung des
       * Betriebssystems, die ohne Absender und Betreff nichts wert wäre. Leer, wenn der
       * Abruf nicht geklappt hat; die Meldung entfällt dann, der Rest arbeitet weiter.
       */
      neue: MessageSummary[];
    })
  /** Status anderswo geändert (Handy, Weboberfläche). uid fehlt, wenn der Server sie
   *  nicht mitliefert - dann muss der Client die Liste neu laden. */
  | (EventBase & { type: 'flags-changed'; uid?: number; seen: boolean })
  | (EventBase & { type: 'messages-removed'; uid?: number })
  /**
   * Eine Auffrischung im Hintergrund hat einen neueren Stand ergeben als den, der gerade
   * angezeigt wird. Die Oberfläche holt daraufhin genau das betroffene Stück nach - so
   * bekommt sie den aktuellen Stand, ohne beim Klick darauf gewartet zu haben.
   */
  | {
      type: 'data-updated';
      accountId: string;
      was: 'folders' | 'categories' | 'messages';
      folder?: string;
      category?: string;
    }
  /**
   * Ein Vorgang, der länger dauert, meldet, wie weit er ist.
   *
   * Ohne das steht bei der Absenderübersicht 1,4 Sekunden und beim Liegengebliebenen
   * eines großen Postfachs über fünf Sekunden nur "wird geladen" - und das ist von einem
   * Hänger nicht zu unterscheiden. Der Vorgang trägt einen Namen, damit gleichzeitig
   * laufende Abrufe sich nicht gegenseitig überschreiben.
   */
  | {
      type: 'fortschritt';
      accountId: string;
      vorgang: 'absender' | 'offen' | 'sicherung';
      getan: number;
      von: number;
      /** Was gerade geschieht, in einem Halbsatz - "Gesendet wird durchgesehen". */
      text?: string;
    };

type Listener = (event: MailEvent) => void;

/**
 * Zuhörer, Überwachungen und angesehene Ordner - je Nutzer getrennt.
 *
 * Hier stand dreimal eine prozessglobale Map, und das war die letzte Stelle, an der die
 * Umstellung auf mehrere Nutzer nicht angekommen war. Alles, was mit einer Datei
 * arbeitet, hing längst am Nutzerkontext; dieses Modul arbeitet mit keiner und ist
 * deshalb durchgerutscht. Zwei Folgen, beide schwer:
 *
 *  - `listeners` war ein einziger Satz. Jede WebSocket-Verbindung hing daran, und emit()
 *    ging an alle. Der Browser jedes angemeldeten Nutzers bekam damit die
 *    'new-mail'-Ereignisse ALLER Nutzer - und die tragen Betreff, Absender und
 *    Empfänger der eingegangenen Nachricht mit sich. Fremde Post, in Echtzeit, ohne
 *    dass irgendetwas danach gefragt hätte.
 *
 *  - `watchers` war eine einzige Map, syncWatchers() baute sein Soll aber immer nur aus
 *    den Konten des gerade laufenden Nutzers und stoppte alles, was nicht darin stand.
 *    Wer einen Ordner öffnete, beendete damit die Überwachung aller anderen. Beim Start
 *    behielt nur der letzte Nutzer der Schleife überhaupt eine.
 *
 * jeNutzer() ist dasselbe Werkzeug, mit dem cache.ts und die lokale Ablage dasselbe
 * Problem lösen - siehe nutzer/jeNutzer.ts.
 */
const zuhoerer = jeNutzer<Set<Listener>>(() => new Set());

/** Laufende Überwachungen je Nutzer, Schlüssel ist Konto + Ordner. */
const watchers = jeNutzer<Map<string, () => void>>(() => new Map());

/**
 * Der Ordner, der immer überwacht wird. Nur für ihn gibt es Benachrichtigungen - sonst
 * meldete jede selbst versendete Nachricht ihre Kopie im Gesendet-Ordner.
 */
export const POSTEINGANG = 'INBOX';

/**
 * Zusätzlich überwachte Ordner je Konto, mit dem Zeitpunkt der letzten Ansicht.
 *
 * Jede überwachte Mailbox kostet eine dauerhaft offene IMAP-Verbindung, und die Anbieter
 * begrenzen deren Zahl - Gmail lässt fünfzehn gleichzeitig zu. Alle Ordner zu überwachen
 * wäre bei zwei Konten mit je acht Ordnern schon nah daran und liefe bei einem dritten
 * Konto ins Leere. Überwacht wird deshalb, was man sich gerade ansieht: das deckt den
 * Zweck ab, ohne die Grenze zu berühren.
 */
const zusatzOrdner = jeNutzer<Map<string, Map<string, number>>>(() => new Map());

/** Höchstzahl zusätzlicher Ordner je Konto - macht mit dem Posteingang drei. */
const MAX_ZUSATZ = 2;

/** Nach dieser Zeit ohne Ansicht wird die zusätzliche Überwachung wieder beendet. */
const ZUSATZ_LEBENSDAUER_MS = 5 * 60_000;

/**
 * Trennzeichen zwischen Konto und Ordner. Ein senkrechter Strich kann in einer
 * Konto-Kennung (UUID aus Hexziffern und Bindestrichen) nicht vorkommen, die Zerlegung
 * ist damit eindeutig - auch wenn ein Ordnername selbst einen enthält.
 */
const TRENNER = '|';

const watcherSchluessel = (accountId: string, folder: string) =>
  `${accountId}${TRENNER}${folder}`;

/** Welche Ordner eines Kontos derzeit überwacht werden sollen. */
function gewuenschteOrdner(accountId: string): string[] {
  const zusatz = zusatzOrdner.hole().get(accountId);
  return [POSTEINGANG, ...(zusatz ? [...zusatz.keys()] : [])];
}

/**
 * Nimmt entgegen, welchen Ordner sich jemand gerade ansieht, und nimmt ihn in die
 * Überwachung auf. Wird beim Abruf der ersten Seite eines Ordners gerufen - also genau
 * dann, wenn er in der Oberfläche geöffnet wird.
 */
export function meldeAnsicht(accountId: string, folder: string): void {
  if (folder === POSTEINGANG) return;

  const jeKonto = zusatzOrdner.hole();
  const bisher = jeKonto.get(accountId) ?? new Map<string, number>();
  const schonDa = bisher.has(folder);
  bisher.set(folder, Date.now());

  // Ältesten herauswerfen, sobald es zu viele werden.
  while (bisher.size > MAX_ZUSATZ) {
    const [aeltester] = [...bisher.entries()].sort((a, b) => a[1] - b[1]);
    bisher.delete(aeltester[0]);
  }
  jeKonto.set(accountId, bisher);

  // Nur abgleichen, wenn wirklich ein Ordner hinzugekommen ist - sonst würde jeder
  // Klick in denselben Ordner einen Durchlauf auslösen.
  if (!schonDa) syncWatchers();
}

/**
 * Beendet Überwachungen von Ordnern, die längere Zeit niemand angesehen hat.
 *
 * Läuft auf einem Zeitgeber und damit ohne Nutzerkontext - jeder Nutzer wird deshalb
 * ausdrücklich betreten. Das ist genau der Fall, für den kontext.ts das Werfen ohne
 * Kontext vorsieht: Hintergrundarbeit bringt ihren Nutzer selbst mit.
 */
function raeumeZusatzAuf(): void {
  const grenze = Date.now() - ZUSATZ_LEBENSDAUER_MS;
  for (const [nutzerId, jeKonto] of zusatzOrdner.alle()) {
    let etwasEntfernt = false;
    for (const [accountId, ordner] of jeKonto) {
      for (const [folder, zuletzt] of ordner) {
        if (zuletzt < grenze) {
          ordner.delete(folder);
          etwasEntfernt = true;
        }
      }
      if (ordner.size === 0) jeKonto.delete(accountId);
    }
    // Je Nutzer für sich abgleichen: ein Fehler bei einem darf die übrigen nicht
    // mitreißen, und syncWatchers() gilt immer nur für den betretenen Nutzer.
    if (etwasEntfernt) {
      try {
        alsNutzer(nutzerId, syncWatchers);
      } catch (err) {
        log.warn(`Überwachung von "${nutzerId}" nicht abgeglichen: ${(err as Error).message}`);
      }
    }
  }
}

const aufraeumer = setInterval(raeumeZusatzAuf, 60_000);
aufraeumer.unref?.();

export interface RegistryLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

let log: RegistryLogger = { info: () => {}, warn: () => {} };

export function setRegistryLogger(logger: RegistryLogger): void {
  log = logger;
}

/**
 * Registriert einen Empfänger für Ereignisse aller Konten EINES Nutzers. Die Watcher
 * laufen unabhängig davon weiter, ob gerade jemand zuhört - so ist der Zustand nicht an
 * eine einzelne WebSocket-Verbindung gekoppelt und mehrere Fenster erzeugen keine
 * doppelte IMAP-Last.
 *
 * Der Nutzer wird ausdrücklich übergeben und nicht aus dem Kontext gelesen. Zwei Gründe:
 * die Desktop-Hülle meldet sich von außerhalb jeder Anfrage an (notifications.ts), und
 * ein stillschweigender Rückfall auf "dann eben alle" wäre genau die Vermischung, gegen
 * die dieses Modul umgebaut wurde.
 */
export function subscribe(nutzerId: string, listener: Listener): () => void {
  zuhoerer.holeFuer(nutzerId).add(listener);
  return () => {
    zuhoerer.vorhanden(nutzerId)?.delete(listener);
  };
}

/** Schickt ein Ereignis an die Zuhörer genau eines Nutzers - an niemanden sonst. */
function emit(nutzerId: string, event: MailEvent): void {
  const menge = zuhoerer.vorhanden(nutzerId);
  if (!menge) return;
  for (const listener of menge) {
    try {
      listener(event);
    } catch {
      // Ein defekter Empfänger darf die übrigen nicht blockieren.
    }
  }
}

/**
 * Höchstzahl der Nachrichten, deren Kopfdaten nach einem Eingang geholt werden.
 *
 * Nach einem Verbindungsabbruch - Standby, Netzwechsel - meldet der Server unter
 * Umständen den Zuwachs von Stunden auf einmal. Ohne Deckel würde daraus ein Abruf über
 * hunderte Nachrichten und eine Flut von Meldungen.
 */
const MAX_NEUE = 5;

async function holeNeue(config: AccountConfig, event: NewMailEvent): Promise<MessageSummary[]> {
  const zuwachs = Math.max(0, event.count - event.prevCount);
  if (zuwachs === 0) return [];
  try {
    const seite = await listMessages(config, event.folder, {
      pageSize: Math.min(zuwachs, MAX_NEUE),
    });
    return seite.messages;
  } catch (err) {
    log.warn(`Kopfdaten der neuen Nachricht nicht abrufbar: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Meldet der Oberfläche, dass ein zwischengespeicherter Stand überholt ist.
 *
 * Gerufen wird das aus Routen und aus Zeitgebern der Wiedervorlage - beide laufen in
 * einem Nutzerkontext, und genau dessen Zuhörer sind gemeint.
 */
export function meldeAktualisierung(event: Extract<MailEvent, { type: 'data-updated' }>): void {
  emit(aktuellerNutzer(), event);
}

/** Meldet, wie weit ein länger dauernder Vorgang ist. */
export function meldeFortschritt(event: Extract<MailEvent, { type: 'fortschritt' }>): void {
  emit(aktuellerNutzer(), event);
}

/**
 * Verwirft die zwischengespeicherten Stände eines Ordners, sobald sich dort etwas tut.
 *
 * Ohne das bliebe nach dem Eintreffen einer Mail bis zum Ablauf der Frist der alte Stand
 * stehen - und gerade dann will man ihn nicht sehen. Betroffen sind auch Ordnerliste und
 * Einordnung, weil sich deren Ungelesen-Zähler mitändern.
 */
function verwerfeStaende(accountId: string, folder: string): void {
  verwerfe(`nachrichten:${accountId}:${folder}:`);
  verwerfe(`ordner:${accountId}`);
  verwerfe(`einordnung:${accountId}`);
}

/**
 * Gleicht die laufenden Überwachungen mit dem Soll ab: startet fehlende, stoppt
 * überflüssige. Nach jedem Anlegen oder Löschen eines Kontos aufrufen, und immer dann,
 * wenn sich die Menge der angesehenen Ordner ändert.
 */
export function syncWatchers(): void {
  // Ganz vorn und nicht erst beim Zugriff: ohne Kontext ist gar nicht bestimmt, wessen
  // Überwachung hier abgeglichen werden soll, und ein Abgleich gegen den falschen Satz
  // Konten würde fremde Watcher stoppen. Genau das war der Fehler.
  const nutzerId = aktuellerNutzer();

  let accounts;
  try {
    accounts = listAccounts();
  } catch (err) {
    // Nicht entschlüsselbare Konten dürfen den Serverstart nicht verhindern - sonst
    // käme man nicht einmal mehr an die Oberfläche, um das Konto neu anzulegen.
    log.warn(`Konten für die Überwachung nicht lesbar: ${(err as Error).message}`);
    return;
  }

  const soll = new Map<string, { account: (typeof accounts)[number]; folder: string }>();
  for (const account of accounts) {
    for (const folder of gewuenschteOrdner(account.id)) {
      soll.set(watcherSchluessel(account.id, folder), { account, folder });
    }
  }

  // Nur die Überwachungen DIESES Nutzers. Vorher lief die Schleife über eine
  // prozessglobale Map, während "soll" nur die Konten des laufenden Nutzers kannte -
  // damit stoppte jeder Abgleich die Watcher aller anderen.
  const laufende = watchers.hole();

  for (const [key, stop] of laufende) {
    if (!soll.has(key)) {
      stop();
      laufende.delete(key);
      log.info(`Überwachung beendet: ${key}`);
    }
  }

  for (const [key, { account, folder }] of soll) {
    if (laufende.has(key)) continue;
    laufende.set(key, starteWatcher(nutzerId, account, folder));
  }
}

/** Startet die Überwachung eines einzelnen Ordners und liefert die Stoppfunktion. */
function starteWatcher(nutzerId: string, account: AccountConfig, ordner: string): () => void {
  {
    const base = { accountId: account.id, email: account.email };

    /**
     * Jeder Rückruf betritt den Nutzer ausdrücklich.
     *
     * Die Behandler hängen an einem IMAP-Socket und feuern, wenn der Anbieter etwas
     * schickt - also außerhalb jeder Anfrage. Was darin läuft, greift auf
     * Zwischenspeicher, Regeln und die abgelegten Nachrichten zu, und all das fragt den
     * Kontext. Dass er heute über die Socket-Erzeugung vererbt wird, ist eine Eigenschaft
     * von AsyncLocalStorage, auf die man sich nicht verlassen sollte: sie hängt daran,
     * dass der Client innerhalb von alsNutzer() gebaut wurde, und fiele beim nächsten
     * Umbau des Verbindungsaufbaus still weg. Hier steht sie ausdrücklich.
     */
    const imNutzer = <T,>(fn: () => T): T => alsNutzer(nutzerId, fn);

    const stop = watchMailbox(account, ordner, {
      onNewMail: (event: NewMailEvent) => imNutzer(() => {
        log.info(`Neue Mail für ${account.email} in ${event.folder} (${event.count})`);
        verwerfeStaende(account.id, event.folder);
        // Kopfdaten nachholen, bevor gemeldet wird: die Verzögerung von ein paar
        // hundert Millisekunden merkt niemand, dafür weiß die Meldung, von wem die
        // Nachricht ist.
        void (async () => {
          const neue = await holeNeue(account, event);

          // Regeln vor der Meldung anwenden - sonst käme erst eine Benachrichtigung
          // über eine Nachricht, die gleich darauf wegsortiert wird. Fehler dabei
          // dürfen weder die Meldung noch die Überwachung aufhalten.
          let uebrig = neue;
          try {
            const ergebnis = await wendeRegelnAn(account, event.folder, neue, (m) => log.info(m));
            if (ergebnis.betroffen > 0) {
              const regeln = regelnFuer(account.id).filter((r) => r.aktiv);
              uebrig = neue.filter((n) => !regeln.some((r) => passt(r, n)));
              verwerfeStaende(account.id, event.folder);
            }
          } catch (err) {
            log.warn(`Regeln konnten nicht angewendet werden: ${(err as Error).message}`);
          }

          /*
           * Die Abwesenheitsnotiz - nach den Regeln und auf dem, was übrig blieb.
           *
           * Auf `uebrig` und nicht auf `neue`: Was eine Regel gerade wegsortiert hat, hat
           * der Nutzer ausdrücklich als etwas gekennzeichnet, das ihn nicht erreichen
           * soll. Darauf zu antworten hieße, einem Verteiler zu schreiben, den er längst
           * beiseitegelegt hat.
           *
           * Fehler bleiben hier drin. Eine Notiz, die nicht hinausgeht, ist ärgerlich -
           * eine, die die Postfachüberwachung mitreißt, ist ein Ausfall des ganzen
           * Postfachs.
           */
          try {
            await beantworteNeue(account, event.folder, uebrig);
          } catch (err) {
            log.warn(`Abwesenheitsnotiz nicht möglich: ${(err as Error).message}`);
          }

          /*
           * Ins Archiv - und zwar auf `neue`, nicht auf `uebrig`.
           *
           * Der Unterschied zur Abwesenheitsnotiz ist der Zweck. Dort ging es darum, wem
           * geantwortet wird, und was eine Regel wegsortiert hat, soll keine Antwort
           * bekommen. Hier geht es um Vollständigkeit: Eine Regel, die eine Nachricht in
           * einen anderen Ordner schiebt, macht sie nicht weniger aufbewahrungspflichtig.
           * Wer sie an dieser Stelle übergeht, hat ein Archiv mit Lücken, die genau dem
           * folgen, was jemand einmal eingerichtet hat.
           */
          try {
            await erfasseEingang(account, event.folder, neue);
          } catch (err) {
            log.warn(`Archivierung nicht möglich: ${(err as Error).message}`);
          }

          emit(nutzerId, {
            ...base,
            type: 'new-mail',
            folder: event.folder,
            count: event.count,
            prevCount: event.prevCount,
            neue: uebrig,
          });
        })();
      }),
      onFlagsChanged: (event) => imNutzer(() => {
        log.info(
          `Status geändert für ${account.email} in ${event.folder}` +
            `${event.uid ? ` (uid ${event.uid})` : ''}: seen=${event.seen}`,
        );
        verwerfeStaende(account.id, event.folder);
        // Von außen geänderter Status (Handy, Weboberfläche): die vorgehaltene Fassung
        // nachziehen, wenn die Nachricht benannt ist - sonst bleibt nichts anderes, als
        // den Ordner zu verwerfen.
        if (event.uid !== undefined) {
          aktualisiereGelesen(account.id, event.folder, [event.uid], event.seen);
        } else {
          verwirfNachrichten(`${account.id}:${event.folder}:`);
        }
        emit(nutzerId, {
          ...base,
          type: 'flags-changed',
          folder: event.folder,
          uid: event.uid,
          seen: event.seen,
        });
      }),
      onMessagesRemoved: (event) => imNutzer(() => {
        log.info(`Nachricht entfernt für ${account.email} in ${event.folder}`);
        verwerfeStaende(account.id, event.folder);
        verwirfNachrichten(
          event.uid !== undefined
            ? nachrichtenSchluessel(account.id, event.folder, event.uid)
            : `${account.id}:${event.folder}:`,
        );
        emit(nutzerId, { ...base, type: 'messages-removed', folder: event.folder, uid: event.uid });
      }),
      onError: (err) => log.warn(`Überwachung ${account.email} (${ordner}): ${err.message}`),
    });

    log.info(`Überwachung gestartet: ${account.email} (${ordner})`);
    return stop;
  }
}

/**
 * Startet die Überwachungen eines Kontos neu. Nötig nach einer erneuten Anmeldung: die
 * bestehenden hängen an der abgelehnten Anmeldung und kämen von allein nicht zurück -
 * syncWatchers() allein genügt nicht, weil dort schon Einträge stehen.
 */
export function restartWatcher(accountId: string): void {
  const laufende = watchers.hole();
  for (const [key, stop] of laufende) {
    if (key.startsWith(`${accountId}${TRENNER}`)) {
      stop();
      laufende.delete(key);
    }
  }
  syncWatchers();
}

/**
 * Beendet die Überwachung ALLER Nutzer - beim Herunterfahren.
 *
 * Die einzige Stelle, die bewusst über alle geht, und sie tut es ohne Nutzerkontext:
 * gerufen wird sie aus dem onClose-Haken des Servers, und dort gibt es keinen.
 */
export function stopAllWatchers(): void {
  for (const [, laufende] of watchers.alle()) {
    for (const stop of laufende.values()) stop();
    laufende.clear();
  }
}
