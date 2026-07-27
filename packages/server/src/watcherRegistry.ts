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
import { passt, regelnFuer, wendeRegelnAn } from './rules.js';

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
    };

type Listener = (event: MailEvent) => void;

const listeners = new Set<Listener>();

/** Laufende Überwachungen, Schlüssel ist Konto + Ordner. */
const watchers = new Map<string, () => void>();

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
const zusatzOrdner = new Map<string, Map<string, number>>();

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
  const zusatz = zusatzOrdner.get(accountId);
  return [POSTEINGANG, ...(zusatz ? [...zusatz.keys()] : [])];
}

/**
 * Nimmt entgegen, welchen Ordner sich jemand gerade ansieht, und nimmt ihn in die
 * Überwachung auf. Wird beim Abruf der ersten Seite eines Ordners gerufen - also genau
 * dann, wenn er in der Oberfläche geöffnet wird.
 */
export function meldeAnsicht(accountId: string, folder: string): void {
  if (folder === POSTEINGANG) return;

  const bisher = zusatzOrdner.get(accountId) ?? new Map<string, number>();
  const schonDa = bisher.has(folder);
  bisher.set(folder, Date.now());

  // Ältesten herauswerfen, sobald es zu viele werden.
  while (bisher.size > MAX_ZUSATZ) {
    const [aeltester] = [...bisher.entries()].sort((a, b) => a[1] - b[1]);
    bisher.delete(aeltester[0]);
  }
  zusatzOrdner.set(accountId, bisher);

  // Nur abgleichen, wenn wirklich ein Ordner hinzugekommen ist - sonst würde jeder
  // Klick in denselben Ordner einen Durchlauf auslösen.
  if (!schonDa) syncWatchers();
}

/** Beendet Überwachungen von Ordnern, die längere Zeit niemand angesehen hat. */
function raeumeZusatzAuf(): void {
  const grenze = Date.now() - ZUSATZ_LEBENSDAUER_MS;
  let etwasEntfernt = false;
  for (const [accountId, ordner] of zusatzOrdner) {
    for (const [folder, zuletzt] of ordner) {
      if (zuletzt < grenze) {
        ordner.delete(folder);
        etwasEntfernt = true;
      }
    }
    if (ordner.size === 0) zusatzOrdner.delete(accountId);
  }
  if (etwasEntfernt) syncWatchers();
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
 * Registriert einen Empfänger für Ereignisse *aller* Konten. Die Watcher laufen
 * unabhängig davon weiter, ob gerade jemand zuhört - so ist der Zustand nicht an
 * eine einzelne WebSocket-Verbindung gekoppelt und mehrere Fenster erzeugen keine
 * doppelte IMAP-Last.
 */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: MailEvent): void {
  for (const listener of listeners) {
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

/** Meldet der Oberfläche, dass ein zwischengespeicherter Stand überholt ist. */
export function meldeAktualisierung(event: Extract<MailEvent, { type: 'data-updated' }>): void {
  emit(event);
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

  for (const [key, stop] of watchers) {
    if (!soll.has(key)) {
      stop();
      watchers.delete(key);
      log.info(`Überwachung beendet: ${key}`);
    }
  }

  for (const [key, { account, folder }] of soll) {
    if (watchers.has(key)) continue;
    watchers.set(key, starteWatcher(account, folder));
  }
}

/** Startet die Überwachung eines einzelnen Ordners und liefert die Stoppfunktion. */
function starteWatcher(account: AccountConfig, ordner: string): () => void {
  {
    const base = { accountId: account.id, email: account.email };

    const stop = watchMailbox(account, ordner, {
      onNewMail: (event: NewMailEvent) => {
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

          emit({
            ...base,
            type: 'new-mail',
            folder: event.folder,
            count: event.count,
            prevCount: event.prevCount,
            neue: uebrig,
          });
        })();
      },
      onFlagsChanged: (event) => {
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
        emit({ ...base, type: 'flags-changed', folder: event.folder, uid: event.uid, seen: event.seen });
      },
      onMessagesRemoved: (event) => {
        log.info(`Nachricht entfernt für ${account.email} in ${event.folder}`);
        verwerfeStaende(account.id, event.folder);
        verwirfNachrichten(
          event.uid !== undefined
            ? nachrichtenSchluessel(account.id, event.folder, event.uid)
            : `${account.id}:${event.folder}:`,
        );
        emit({ ...base, type: 'messages-removed', folder: event.folder, uid: event.uid });
      },
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
  for (const [key, stop] of watchers) {
    if (key.startsWith(`${accountId}${TRENNER}`)) {
      stop();
      watchers.delete(key);
    }
  }
  syncWatchers();
}

export function stopAllWatchers(): void {
  for (const stop of watchers.values()) stop();
  watchers.clear();
}
