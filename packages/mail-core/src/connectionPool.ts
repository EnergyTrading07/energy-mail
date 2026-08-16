import { ImapFlow } from 'imapflow';
import { buildImapAuth } from './imapAuth.js';
import { beschreibeProxy, proxyFuer } from './proxy.js';
import type { AccountConfig } from './types.js';

/**
 * Hält je Konto eine IMAP-Verbindung offen und gibt sie an alle Abfragen weiter.
 *
 * Vorher baute jeder Aufruf eine eigene Verbindung auf: TCP, TLS, LOGIN, Abfrage, Abbau.
 * Gemessen entfielen von 400-700 ms pro Aufruf die meisten auf den Aufbau, nicht auf die
 * Daten. Ein Ordnerwechsel kostete zwei bis drei komplette Anmeldungen.
 *
 * Zweiter Grund: Anbieter begrenzen gleichzeitige Verbindungen (Gmail etwa 15 pro Konto),
 * GMX hat Verbindungssalven mit ECONNRESET abgewiesen.
 *
 * Die Postfach-Watcher nutzen bewusst eigene Verbindungen - sie halten dauerhaft eine
 * Mailbox im IDLE-Zustand offen und könnten sie nicht nebenher für Abfragen freigeben.
 */

interface Eintrag {
  client: ImapFlow;
  zuletztGenutzt: number;
  /** Läuft ein Aufbau, warten weitere Anfragen darauf statt einen zweiten zu starten. */
  aufbau?: Promise<ImapFlow>;
  /** Anzahl gerade laufender Nutzungen - nur unbenutzte werden weggeräumt. */
  inBenutzung: number;
}

const pool = new Map<string, Eintrag>();

/** Nach dieser Zeit ohne Nutzung wird geschlossen; Anbieter trennen ohnehin irgendwann. */
const IDLE_TIMEOUT_MS = 4 * 60 * 1000;
const REAPER_INTERVAL_MS = 60 * 1000;

const imapLogger = process.env.ENERGY_MAIL_IMAP_DEBUG ? undefined : false;

async function erzeuge(
  config: AccountConfig,
  auth: Awaited<ReturnType<typeof buildImapAuth>>,
): Promise<ImapFlow> {
  /*
   * Der Weg nach draußen, wenn es keinen direkten gibt.
   *
   * In vielen Firmennetzen ist Port 993 an der Firewall zu und alles läuft über einen
   * Proxy. imapflow bringt HTTP CONNECT und SOCKS mit; gefehlt hat nur die Antwort auf
   * die Frage, welcher Proxy für diesen Rechner gilt - siehe proxy.ts.
   *
   * Je Verbindungsaufbau ermittelt und nicht einmal beim Start: ein PAC-Skript
   * beantwortet die Frage für jeden Zielrechner anders, und ein Rechner wechselt zwischen
   * Büro und Heimarbeit das Netz, ohne dass das Programm neu startet.
   */
  const proxy = await proxyFuer(config.imapHost, config.proxy);
  if (proxy.beanstandet) {
    console.warn(`[energy-mail] ${beschreibeProxy(proxy)}`);
  }

  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
    ...(proxy.adresse ? { proxy: proxy.adresse } : {}),
    /*
     * STARTTLS verlangen, wo nicht ohnehin von Anfang an verschluesselt wird.
     *
     * imapflow sagt es in seiner eigenen Dokumentation: ohne diese Angabe gilt
     * "If not supported, continue unencrypted. This may expose the connection to a
     * downgrade attack." Ein Angreifer im Netzpfad streicht STARTTLS aus der
     * Faehigkeitenliste, und "LOGIN <benutzer> <kennwort>" geht im Klartext ueber
     * Port 143.
     *
     * Konten mit imapSecure:false entstehen regulaer - findeEinstellungen liefert es
     * so, wenn die Anbieterdatenbank STARTTLS statt SSL nennt, und von Hand eintragen
     * laesst es sich ebenfalls.
     */
    ...(config.imapSecure ? {} : { doSTARTTLS: true as const }),
    tls: { minVersion: 'TLSv1.2' as const },
    auth,
    logger: imapLogger,
  });
}

/** Verbindung aus dem Pool entfernen und schließen. */
function verwerfen(accountId: string): void {
  const eintrag = pool.get(accountId);
  if (!eintrag) return;
  pool.delete(accountId);
  try {
    eintrag.client.close();
  } catch {
    // Bereits geschlossen - unerheblich.
  }
}

/**
 * Die Verbindung UND ihr Eintrag.
 *
 * Beides zusammen, weil der Aufrufer den Eintrag braucht (er zählt seine Nutzung mit) und
 * ihn nach dem `await` nicht mehr verlässlich selbst finden kann - siehe `withClient`.
 */
async function beschaffen(config: AccountConfig): Promise<{ client: ImapFlow; eintrag: Eintrag }> {
  const vorhanden = pool.get(config.id);

  if (vorhanden?.aufbau) return { client: await vorhanden.aufbau, eintrag: vorhanden };
  if (vorhanden && vorhanden.client.usable) {
    vorhanden.zuletztGenutzt = Date.now();
    return { client: vorhanden.client, eintrag: vorhanden };
  }
  // Unbrauchbar gewordene Verbindung (Anbieter hat getrennt) aussortieren.
  if (vorhanden) verwerfen(config.id);

  const eintrag: Eintrag = {
    client: null as unknown as ImapFlow,
    zuletztGenutzt: Date.now(),
    inBenutzung: 0,
  };

  eintrag.aufbau = (async () => {
    const client = await erzeuge(config, await buildImapAuth(config));
    // Ohne Listener beendet ein Verbindungsfehler den gesamten Prozess.
    client.on('error', () => verwerfen(config.id));
    client.on('close', () => {
      if (pool.get(config.id)?.client === client) verwerfen(config.id);
    });
    await client.connect();
    eintrag.client = client;
    eintrag.aufbau = undefined;
    return client;
  })();

  pool.set(config.id, eintrag);

  try {
    return { client: await eintrag.aufbau, eintrag };
  } catch (err) {
    verwerfen(config.id);
    throw err;
  }
}

/** Fehler, nach denen die Verbindung nicht weiterverwendet werden darf. */
function istVerbindungsfehler(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  if (e.code && ['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'ECONNREFUSED'].includes(e.code)) {
    return true;
  }
  return /connection|socket|closed|not connected/i.test(e.message ?? '');
}

/**
 * Führt eine Abfrage auf der Verbindung des Kontos aus. Bricht die Verbindung weg, wird
 * sie verworfen und der Aufruf einmal wiederholt - das ist der häufigste Fall nach einer
 * längeren Pause, in der der Anbieter aufgelegt hat.
 */
export async function withClient<T>(
  config: AccountConfig,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  for (let versuch = 0; versuch < 2; versuch++) {
    /*
     * Der Eintrag kommt aus `beschaffen` und wird nicht danach aus dem Pool geholt.
     *
     * Vorher stand hier `pool.get(config.id)` unmittelbar nach dem `await`. Zwischen
     * beidem liegt eine Unterbrechung, und in ihr kann ein anderer Aufruf den Eintrag
     * ausgetauscht haben - dann wurde `inBenutzung` an einem Eintrag hochgezählt, der zu
     * einer anderen Verbindung gehört als die, mit der hier gearbeitet wird. Der
     * Aufräumer sah daraufhin eine unbenutzte Verbindung, die in Wahrheit gerade
     * gebraucht wurde, und schloss sie mitten im Abruf.
     */
    const { client, eintrag } = await beschaffen(config);
    eintrag.inBenutzung += 1;

    try {
      const ergebnis = await fn(client);
      eintrag.zuletztGenutzt = Date.now();
      return ergebnis;
    } catch (err) {
      /*
       * Nur bei einem Verbindungsfehler wegwerfen - nicht bei jedem Fehler.
       *
       * Vorher wurde die Verbindung bei JEDEM Fehler geschlossen, auch bei einem, der
       * mit ihr nichts zu tun hat: "Nachricht 42 nicht gefunden", weil sie an einem
       * anderen Gerät gelöscht wurde, ist eine vollständig gesunde Antwort eines
       * vollständig gesunden Servers.
       *
       * Zwei Folgen, und die zweite ist die schlimmere:
       *
       *  - Jeder solche Fehler kostete den nächsten Abruf einen vollständigen
       *    Neuaufbau - TCP, TLS, LOGIN, gemessen 400-700 ms (siehe oben).
       *  - Die Verbindung ist GETEILT. Läuft nebenher ein zweiter Abruf - die Oberfläche
       *    holt Ordnerliste, Nachrichten und Einordnung gleichzeitig -, brach ihm der
       *    Socket unter den Händen weg. Er lief dann in seinen eigenen Wiederholversuch
       *    und tat alles ein zweites Mal. Ein einzelner Klick auf eine verschwundene
       *    Nachricht setzte damit die halbe Oberfläche zurück.
       *
       * Eine wirklich kaputte Verbindung fällt trotzdem auf: dafür ist
       * `istVerbindungsfehler` da, und zusätzlich räumen die `error`- und
       * `close`-Behandler am Client den Pool von sich aus auf.
       */
      if (istVerbindungsfehler(err)) {
        verwerfen(config.id);
        if (versuch === 0) continue;
      }
      throw err;
    } finally {
      eintrag.inBenutzung = Math.max(0, eintrag.inBenutzung - 1);
    }
  }
  throw new Error('Verbindung konnte nicht hergestellt werden.');
}

/**
 * Einmalige Verbindung außerhalb des Pools - für das Prüfen noch nicht gespeicherter
 * Zugangsdaten, wo eine dauerhafte Verbindung nichts brächte.
 */
export async function withThrowawayClient<T>(
  config: AccountConfig,
  fn: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = await erzeuge(config, await buildImapAuth(config));
  client.on('error', () => {});
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Beim Entfernen eines Kontos oder nach Änderung der Zugangsdaten aufrufen. */
export function closeConnection(accountId: string): void {
  verwerfen(accountId);
}

export function closeAllConnections(): void {
  for (const accountId of [...pool.keys()]) verwerfen(accountId);
}

// Unbenutzte Verbindungen wegräumen. unref, damit der Zeitgeber den Prozess nicht am
// Beenden hindert.
const reaper = setInterval(() => {
  const jetzt = Date.now();
  for (const [accountId, eintrag] of pool) {
    if (eintrag.inBenutzung === 0 && !eintrag.aufbau && jetzt - eintrag.zuletztGenutzt > IDLE_TIMEOUT_MS) {
      verwerfen(accountId);
    }
  }
}, REAPER_INTERVAL_MS);
reaper.unref?.();
