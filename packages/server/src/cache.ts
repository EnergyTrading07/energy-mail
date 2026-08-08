import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './paths.js';

/**
 * Zwischenspeicher für alles, was der Server sonst bei jedem Klick neu über IMAP holt:
 * Ordnerlisten, Gmails Einordnung und die jeweils erste Seite eines Ordners.
 *
 * Grundgedanke ist "erst zeigen, dann nachsehen": Vorhandenes geht sofort zurück, die
 * Auffrischung läuft daneben weiter. Ergibt sie etwas Neues, meldet der Server das über
 * dieselbe Leitung, über die auch neue Post gemeldet wird - die Oberfläche wartet also
 * nie auf das Netz, bekommt aber trotzdem den aktuellen Stand.
 *
 * Auf Platte, damit auch der erste Blick nach dem Start sofort dasteht. Ohne das wäre der
 * Zwischenspeicher genau dann leer, wenn er am meisten hülfe.
 *
 * Nicht zwischengespeichert werden Nachrichteninhalte - nur Kopfdaten. Inhalte sind um
 * Größenordnungen umfangreicher, und ein Postfach mit 30.000 Nachrichten würde damit
 * unbegrenzt wachsen.
 */

interface Eintrag<T = unknown> {
  wert: T;
  /** Zeitpunkt der letzten erfolgreichen Abfrage. */
  stand: number;
}

/**
 * Obergrenze der Einträge. Erreicht sie das Limit, fliegen die ältesten heraus - sonst
 * sammelt sich über Monate jeder je geöffnete Ordner an.
 */
const MAX_EINTRAEGE = 200;

const speicher = new Map<string, Eintrag>();
let geladen = false;
let schreibTimer: ReturnType<typeof setTimeout> | undefined;

const dateiPfad = () => path.join(getDataDir(), 'cache.json');

function laden(): void {
  if (geladen) return;
  geladen = true;
  try {
    const roh = fs.readFileSync(dateiPfad(), 'utf-8');
    for (const [schluessel, eintrag] of Object.entries(JSON.parse(roh) as Record<string, Eintrag>)) {
      speicher.set(schluessel, eintrag);
    }
  } catch {
    // Fehlende oder beschädigte Datei ist unkritisch: der Zwischenspeicher füllt sich
    // beim ersten Abruf von selbst wieder.
  }
}

/** Gebündelt schreiben - sonst fiele bei jedem Ordnerwechsel ein Schreibvorgang an. */
function planeSpeichern(): void {
  if (schreibTimer) return;
  schreibTimer = setTimeout(() => {
    schreibTimer = undefined;
    try {
      fs.mkdirSync(getDataDir(), { recursive: true });
      fs.writeFileSync(dateiPfad(), JSON.stringify(Object.fromEntries(speicher)), 'utf-8');
    } catch {
      // Der Zwischenspeicher ist Beiwerk; scheitert das Schreiben, arbeitet alles weiter.
    }
  }, 3000);
  schreibTimer.unref?.();
}

export function lies<T>(schluessel: string): Eintrag<T> | null {
  laden();
  return (speicher.get(schluessel) as Eintrag<T> | undefined) ?? null;
}

export function schreibe<T>(schluessel: string, wert: T): void {
  laden();
  speicher.set(schluessel, { wert, stand: Date.now() });

  if (speicher.size > MAX_EINTRAEGE) {
    const nachAlter = [...speicher.entries()].sort((a, b) => a[1].stand - b[1].stand);
    for (const [alt] of nachAlter.slice(0, speicher.size - MAX_EINTRAEGE)) {
      speicher.delete(alt);
    }
  }
  planeSpeichern();
}

/** Verwirft alle Einträge, deren Schlüssel mit dem Präfix beginnt. */
export function verwerfe(praefix: string): void {
  laden();
  let etwasEntfernt = false;
  for (const schluessel of speicher.keys()) {
    if (schluessel.startsWith(praefix)) {
      speicher.delete(schluessel);
      etwasEntfernt = true;
    }
  }
  if (etwasEntfernt) planeSpeichern();
}

/** Schlüssel bilden - an einer Stelle, damit Ablage und Verwerfen zusammenpassen. */
export const schluessel = {
  ordner: (accountId: string) => `ordner:${accountId}`,
  einordnung: (accountId: string) => `einordnung:${accountId}`,
  /**
   * Alles, was die Antwort mitbestimmt, gehört in den Schlüssel.
   *
   * Die Seitengröße: ohne sie bekam eine Anfrage nach 25 Nachrichten die zuvor
   * abgelegten 5 - der Abruf beantwortete also eine andere Frage als die gestellte.
   *
   * Die Reihenfolge aus demselben Grund, und der Fehler sah genauso aus: "Älteste
   * zuerst" lieferte in 2 ms die neuesten, weil der Schlüssel die Richtung nicht kannte
   * und der abgelegte Stand der vorigen Frage passte.
   */
  nachrichten: (
    accountId: string,
    ordner: string,
    kategorie: string | undefined,
    seitenGroesse: number,
    aeltesteZuerst = false,
  ) =>
    `nachrichten:${accountId}:${ordner}:${kategorie ?? ''}:${seitenGroesse}:${aeltesteZuerst ? 'auf' : 'ab'}`,
};

/** Verwirft alles, was zu einem Konto gehört. */
export function verwerfeKonto(accountId: string): void {
  for (const art of ['ordner', 'einordnung', 'nachrichten']) {
    verwerfe(`${art}:${accountId}`);
  }
}

export interface HolOptionen<T> {
  /** Ab diesem Alter wird im Hintergrund aufgefrischt. */
  maxAlterMs: number;
  /** Wird gerufen, wenn die Auffrischung etwas anderes ergeben hat als das Gezeigte. */
  beiAenderung?: (wert: T) => void;
}

/**
 * Liefert den zwischengespeicherten Wert sofort und frischt bei Bedarf im Hintergrund
 * auf. Ohne Zwischenstand wird regulär gewartet.
 *
 * Schlägt die Abfrage fehl, obwohl etwas im Speicher liegt, gewinnt der alte Stand: ohne
 * Netz eine Nachrichtenliste von vorhin zu sehen ist deutlich brauchbarer als eine
 * Fehlermeldung.
 */
export async function ausSpeicherOderHolen<T>(
  key: string,
  holen: () => Promise<T>,
  optionen: HolOptionen<T>,
): Promise<{ wert: T; ausSpeicher: boolean }> {
  const vorhanden = lies<T>(key);

  if (!vorhanden) {
    const wert = await holen();
    schreibe(key, wert);
    return { wert, ausSpeicher: false };
  }

  // ">=" und nicht ">": bei gleicher Millisekunde ist die verstrichene Zeit 0, und eine
  // Frist von 0 ("immer nachsehen") wäre damit nie erfüllt gewesen.
  const veraltet = Date.now() - vorhanden.stand >= optionen.maxAlterMs;
  if (veraltet && !laufendeAuffrischung.has(key)) {
    const aufgabe = holen()
      .then((frisch) => {
        const anders = JSON.stringify(frisch) !== JSON.stringify(vorhanden.wert);
        schreibe(key, frisch);
        // Nur bei echter Änderung melden - sonst würde die Oberfläche ständig ohne
        // Anlass neu laden.
        if (anders) optionen.beiAenderung?.(frisch);
      })
      .catch(() => {
        // Der alte Stand bleibt stehen; beim nächsten Versuch wird es erneut probiert.
      })
      .finally(() => laufendeAuffrischung.delete(key));
    laufendeAuffrischung.set(key, aufgabe);
  }

  return { wert: vorhanden.wert, ausSpeicher: true };
}

/** Mehrere gleichzeitige Anfragen sollen nicht mehrere Auffrischungen auslösen. */
const laufendeAuffrischung = new Map<string, Promise<void>>();
