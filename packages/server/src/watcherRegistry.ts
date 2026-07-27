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
const watchers = new Map<string, () => void>();

/** Welcher Ordner je Konto überwacht wird. */
const WATCHED_FOLDER = 'INBOX';

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
 * Gleicht die laufenden Watcher mit den gespeicherten Konten ab: startet fehlende,
 * stoppt die von entfernten Konten. Nach jedem Anlegen/Löschen eines Kontos aufrufen.
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

  const activeIds = new Set(accounts.map((a) => a.id));

  for (const [accountId, stop] of watchers) {
    if (!activeIds.has(accountId)) {
      stop();
      watchers.delete(accountId);
      log.info(`Watcher für Konto ${accountId} gestoppt`);
    }
  }

  for (const account of accounts) {
    if (watchers.has(account.id)) continue;

    const base = { accountId: account.id, email: account.email };

    const stop = watchMailbox(account, WATCHED_FOLDER, {
      onNewMail: (event: NewMailEvent) => {
        log.info(`Neue Mail für ${account.email} in ${event.folder} (${event.count})`);
        verwerfeStaende(account.id, event.folder);
        // Kopfdaten nachholen, bevor gemeldet wird: die Verzögerung von ein paar
        // hundert Millisekunden merkt niemand, dafür weiß die Meldung, von wem die
        // Nachricht ist.
        void (async () => {
          emit({
            ...base,
            type: 'new-mail',
            folder: event.folder,
            count: event.count,
            prevCount: event.prevCount,
            neue: await holeNeue(account, event),
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
      onError: (err) => log.warn(`Watcher ${account.email}: ${err.message}`),
    });

    watchers.set(account.id, stop);
    log.info(`Watcher für ${account.email} (${WATCHED_FOLDER}) gestartet`);
  }
}

/**
 * Startet die Überwachung eines Kontos neu. Nötig nach einer erneuten Anmeldung: der
 * bestehende Watcher hängt an der abgelehnten Anmeldung und käme von allein nicht
 * zurück - syncWatchers() allein genügt nicht, weil dort schon ein Eintrag steht.
 */
export function restartWatcher(accountId: string): void {
  const stop = watchers.get(accountId);
  if (stop) {
    stop();
    watchers.delete(accountId);
  }
  syncWatchers();
}

export function stopAllWatchers(): void {
  for (const stop of watchers.values()) stop();
  watchers.clear();
}
