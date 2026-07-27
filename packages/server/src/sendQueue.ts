import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './paths.js';

/**
 * Warteschlange für ausgehende Nachrichten.
 *
 * Deckt zwei Dinge mit einem Mechanismus ab: die kurze Bedenkzeit nach dem Absenden
 * ("Rückgängig") und das geplante Senden zu einem späteren Zeitpunkt. Beides ist
 * dasselbe - eine Nachricht, die noch nicht raus ist und noch zurückgeholt werden kann.
 *
 * Auf Platte gehalten, damit ein für morgen früh geplanter Versand einen Neustart
 * übersteht. Was beim Start bereits fällig ist, geht sofort raus.
 *
 * Die Grenze der Sache ist offen zu benennen: gesendet wird nur, solange die Anwendung
 * läuft. Ist sie zum geplanten Zeitpunkt zu, geht die Nachricht beim nächsten Start
 * hinaus - nicht zur geplanten Minute. Anders ginge es nur mit einem Dienst, der
 * durchgehend läuft, und den gibt es hier bewusst nicht.
 */

export interface GeplanteSendung {
  id: string;
  accountId: string;
  /** Zeitpunkt, ab dem gesendet werden soll. */
  faellig: number;
  /** Der Nachrichtenkörper, wie ihn die Oberfläche geschickt hat (mit base64-Anhängen). */
  koerper: Record<string, unknown>;
  /** Nur zur Anzeige in der Rückgängig-Meldung. */
  betreff: string;
  empfaenger: string[];
}

const getPfad = () => path.join(getDataDir(), 'sendungen.json');

const geplant = new Map<string, GeplanteSendung>();
const timer = new Map<string, ReturnType<typeof setTimeout>>();

let senden: ((sendung: GeplanteSendung) => Promise<void>) | null = null;
let log: (msg: string) => void = () => {};

/**
 * Hinterlegt, wie tatsächlich gesendet wird. Getrennt, weil das Versenden die Konten und
 * das Anhängen von Dateien kennt - beides gehört nicht in die Warteschlange.
 */
export function setSendeVerfahren(
  fn: (sendung: GeplanteSendung) => Promise<void>,
  logger: (msg: string) => void,
): void {
  senden = fn;
  log = logger;
}

function speichern(): void {
  try {
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(getPfad(), JSON.stringify([...geplant.values()], null, 2), 'utf-8');
  } catch (err) {
    log(`Geplante Sendungen konnten nicht gesichert werden: ${(err as Error).message}`);
  }
}

async function ausfuehren(id: string): Promise<void> {
  const sendung = geplant.get(id);
  if (!sendung || !senden) return;

  geplant.delete(id);
  timer.delete(id);
  speichern();

  try {
    await senden(sendung);
    log(`Geplante Nachricht "${sendung.betreff}" versendet.`);
  } catch (err) {
    // Zurücklegen wäre schlimmer als der Fehler: bei einer dauerhaft falschen Adresse
    // liefe die Nachricht endlos im Kreis. Der Entwurf bleibt erhalten, die Meldung
    // nennt den Grund.
    log(`Geplante Nachricht "${sendung.betreff}" konnte nicht versendet werden: ${(err as Error).message}`);
  }
}

function planen(sendung: GeplanteSendung): void {
  const wartezeit = Math.max(0, sendung.faellig - Date.now());
  const t = setTimeout(() => void ausfuehren(sendung.id), wartezeit);
  // Ein wartender Versand soll die Anwendung nicht am Beenden hindern - beim Beenden
  // wird ohnehin alles Ausstehende abgeschickt.
  t.unref?.();
  timer.set(sendung.id, t);
}

/** Lädt Ausstehendes beim Start und schickt ab, was bereits fällig ist. */
export function ladeGeplanteSendungen(): void {
  let gespeichert: GeplanteSendung[] = [];
  try {
    gespeichert = JSON.parse(fs.readFileSync(getPfad(), 'utf-8')) as GeplanteSendung[];
  } catch {
    return;
  }
  for (const sendung of gespeichert) {
    geplant.set(sendung.id, sendung);
    planen(sendung);
  }
  if (gespeichert.length > 0) {
    const faellig = gespeichert.filter((s) => s.faellig <= Date.now()).length;
    log(
      `${gespeichert.length} geplante Nachricht(en) geladen` +
        (faellig > 0 ? `, davon ${faellig} überfällig - gehen jetzt raus.` : '.'),
    );
  }
}

export function planeSendung(
  accountId: string,
  koerper: Record<string, unknown>,
  faellig: number,
): GeplanteSendung {
  const sendung: GeplanteSendung = {
    id: randomUUID(),
    accountId,
    faellig,
    koerper,
    betreff: String(koerper.subject ?? '(kein Betreff)'),
    empfaenger: Array.isArray(koerper.to) ? (koerper.to as string[]) : [],
  };
  geplant.set(sendung.id, sendung);
  speichern();
  planen(sendung);
  return sendung;
}

/** Holt eine Nachricht zurück und liefert sie heraus - zum Weiterbearbeiten. */
export function storniereSendung(id: string): GeplanteSendung | null {
  const sendung = geplant.get(id);
  if (!sendung) return null;
  clearTimeout(timer.get(id));
  timer.delete(id);
  geplant.delete(id);
  speichern();
  return sendung;
}

export function listeGeplanteSendungen(accountId?: string): GeplanteSendung[] {
  return [...geplant.values()]
    .filter((s) => !accountId || s.accountId === accountId)
    .sort((a, b) => a.faellig - b.faellig);
}

/**
 * Schickt alles Ausstehende sofort ab - beim Beenden der Anwendung.
 *
 * Ohne das ginge eine Nachricht, die gerade in der Bedenkzeit steht, beim Schließen
 * verloren: der Nutzer hat auf "Senden" gedrückt und nichts widerrufen, also ist sie
 * gewollt. Für weit in der Zukunft geplante gilt das nicht - die bleiben liegen.
 */
export async function sendeAusstehendeSofort(): Promise<number> {
  const gleich = [...geplant.values()].filter((s) => s.faellig - Date.now() < 5 * 60_000);
  for (const sendung of gleich) {
    clearTimeout(timer.get(sendung.id));
    await ausfuehren(sendung.id);
  }
  return gleich.length;
}
