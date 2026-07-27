import { ImapFlow } from 'imapflow';
import { buildImapAuth } from './imapAuth.js';
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

function erzeuge(config: AccountConfig, auth: Awaited<ReturnType<typeof buildImapAuth>>): ImapFlow {
  return new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: config.imapSecure,
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

async function beschaffen(config: AccountConfig): Promise<ImapFlow> {
  const vorhanden = pool.get(config.id);

  if (vorhanden?.aufbau) return vorhanden.aufbau;
  if (vorhanden && vorhanden.client.usable) {
    vorhanden.zuletztGenutzt = Date.now();
    return vorhanden.client;
  }
  // Unbrauchbar gewordene Verbindung (Anbieter hat getrennt) aussortieren.
  if (vorhanden) verwerfen(config.id);

  const eintrag: Eintrag = {
    client: null as unknown as ImapFlow,
    zuletztGenutzt: Date.now(),
    inBenutzung: 0,
  };

  eintrag.aufbau = (async () => {
    const client = erzeuge(config, await buildImapAuth(config));
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
    return await eintrag.aufbau;
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
    const client = await beschaffen(config);
    const eintrag = pool.get(config.id);
    if (eintrag) eintrag.inBenutzung += 1;

    try {
      const ergebnis = await fn(client);
      if (eintrag) eintrag.zuletztGenutzt = Date.now();
      return ergebnis;
    } catch (err) {
      verwerfen(config.id);
      if (versuch === 0 && istVerbindungsfehler(err)) continue;
      throw err;
    } finally {
      if (eintrag) eintrag.inBenutzung = Math.max(0, eintrag.inBenutzung - 1);
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
  const client = erzeuge(config, await buildImapAuth(config));
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
