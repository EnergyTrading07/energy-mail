import { ImapFlow } from 'imapflow';
import { buildImapAuth } from './imapAuth.js';
import { proxyFuer } from './proxy.js';
import type { AccountConfig } from './types.js';

export interface NewMailEvent {
  /** Pfad des Ordners, in dem die neue Nachricht liegt. */
  folder: string;
  /** Nachrichtenanzahl im Ordner nach dem Eintreffen. */
  count: number;
  /** Anzahl davor - die Differenz ist die Zahl der neuen Nachrichten. */
  prevCount: number;
}

export interface FlagsChangedEvent {
  folder: string;
  /** Fehlt, wenn der Server die UID nicht mitliefert - dann hilft nur Neuladen. */
  uid?: number;
  seen: boolean;
  flags: string[];
}

export interface MessagesRemovedEvent {
  folder: string;
  uid?: number;
}

export interface WatchHandlers {
  onNewMail: (event: NewMailEvent) => void;
  /** Statusänderung an einer Nachricht, z.B. anderswo gelesen (Handy, Weboberfläche). */
  onFlagsChanged?: (event: FlagsChangedEvent) => void;
  /** Nachricht wurde entfernt - ebenfalls oft durch ein anderes Programm. */
  onMessagesRemoved?: (event: MessagesRemovedEvent) => void;
  /** Wird bei Verbindungsproblemen aufgerufen; der Watcher verbindet selbst neu. */
  onError?: (error: Error) => void;
}

const INITIAL_RETRY_MS = 5_000;
const MAX_RETRY_MS = 5 * 60_000;

/**
 * Hält eine dauerhafte IMAP-Verbindung offen und meldet neue Nachrichten, sobald der
 * Server sie ankündigt. ImapFlow geht bei offener Mailbox von selbst in den IDLE-Modus
 * und feuert dann "exists" - das ist sowohl schneller als auch sparsamer als Polling,
 * weil keine Verbindung im Intervall neu aufgebaut wird.
 *
 * Die Verbindung wird bei Abbruch mit exponentiell wachsender Wartezeit neu aufgebaut,
 * damit ein dauerhaft nicht erreichbarer Server den Anbieter nicht mit Login-Versuchen
 * überzieht.
 *
 * Läuft bewusst auf einer eigenen Verbindung, getrennt von den kurzlebigen Verbindungen
 * der Abruf-Funktionen in imapClient.ts.
 */
export function watchMailbox(
  config: AccountConfig,
  folder: string,
  handlers: WatchHandlers,
): () => void {
  let stopped = false;
  let client: ImapFlow | null = null;
  let retryDelay = INITIAL_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectScheduled = false;

  const scheduleReconnect = () => {
    // Verbindungsabbruch kann sowohl über 'close' als auch über einen Fehler in
    // connect() gemeldet werden - der Schalter verhindert doppelte Reconnects.
    if (stopped || reconnectScheduled) return;
    reconnectScheduled = true;
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
  };

  async function connect(): Promise<void> {
    reconnectScheduled = false;
    if (stopped) return;

    let auth;
    try {
      // Bei jedem Verbindungsaufbau neu: bei OAuth-Konten wird hier gegebenenfalls das
      // Zugriffstoken erneuert, denn diese Verbindung besteht länger als es gilt.
      auth = await buildImapAuth(config);
    } catch (err) {
      handlers.onError?.(err as Error);
      scheduleReconnect();
      return;
    }

    /*
     * Auch die Überwachung geht über den Proxy.
     *
     * Sie baut ihre Verbindungen bewusst selbst auf und nicht über den Pool (siehe oben:
     * sie hält eine Mailbox dauerhaft im IDLE-Zustand). Genau deshalb wäre sie beim
     * Einbau des Proxys fast durchgerutscht - der Pool war angebunden, diese Stelle
     * nicht. Aufgefallen ist es erst am laufenden Programm hinter einem echten Proxy:
     * die Anwendung startete, meldete keinen Fehler, und im Mitschrieb des Proxys stand
     * nichts. Es IST die wichtigste Verbindung von allen; sie steht den ganzen Tag.
     */
    const proxy = await proxyFuer(config.imapHost, config.proxy);

    const current = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapSecure,
      ...(proxy.adresse ? { proxy: proxy.adresse } : {}),
      // Dieselbe Erzwingung wie im Verbindungspool - siehe die Begründung dort.
      ...(config.imapSecure ? {} : { doSTARTTLS: true as const }),
      tls: { minVersion: 'TLSv1.2' as const },
      /*
       * IDLE von sich aus erneuern, lange vor der Grenze aus RFC 2177.
       *
       * Ohne diese Angabe startet imapflow IDLE NIE neu - der Wert steht dort
       * voreingestellt auf `false`. Die einzige Rettung wäre der Socket-Zeitgeber
       * (5 Minuten), und genau der greift bei den verbreitetsten Servern nicht:
       * Dovecot schickt von sich aus alle zwei Minuten "* OK Still here" und setzt den
       * Zeitgeber damit dauernd zurück. IDLE läuft dann über die 29 Minuten hinaus,
       * die RFC 2177 als Obergrenze nennt, und der Server legt auf.
       *
       * Sichtbar wurde das als halbstündlich abreißende Überwachung bei allen
       * Dovecot-Anbietern - und weil beim Neuverbinden nicht abgeglichen wurde (siehe
       * unten), blieb alles ungemeldet, was in der Lücke eintraf.
       */
      maxIdleTime: 5 * 60 * 1000,
      auth,
      logger: false,
    });
    client = current;

    // ImapFlow wirft 'error' als EventEmitter-Event; ohne Listener würde das den
    // Prozess beenden.
    current.on('error', (err: Error) => handlers.onError?.(err));
    current.on('close', () => {
      if (client === current) scheduleReconnect();
    });
    current.on('exists', (data: { path: string; count: number; prevCount: number }) => {
      if (data.count > data.prevCount) {
        handlers.onNewMail({ folder: data.path, count: data.count, prevCount: data.prevCount });
      }
    });

    // Der Server meldet während IDLE auch Änderungen, die woanders vorgenommen wurden -
    // etwa wenn eine Mail am Handy gelesen oder gelöscht wird.
    current.on('flags', (data: { path: string; uid?: number; flags: Set<string> }) => {
      const flags = Array.from(data.flags ?? []);
      handlers.onFlagsChanged?.({
        folder: data.path,
        uid: data.uid,
        seen: flags.includes('\\Seen'),
        flags,
      });
    });

    current.on('expunge', (data: { path: string; uid?: number }) => {
      handlers.onMessagesRemoved?.({ folder: data.path, uid: data.uid });
    });

    try {
      await current.connect();
      // mailboxOpen statt getMailboxLock: die Mailbox soll dauerhaft offen bleiben,
      // damit ImapFlow in IDLE gehen kann.
      await current.mailboxOpen(folder);
      retryDelay = INITIAL_RETRY_MS;
    } catch (err) {
      handlers.onError?.(err as Error);
      scheduleReconnect();
    }
  }

  void connect();

  return () => {
    stopped = true;
    clearTimeout(retryTimer);
    const current = client;
    client = null;
    current?.logout().catch(() => current.close());
  };
}
