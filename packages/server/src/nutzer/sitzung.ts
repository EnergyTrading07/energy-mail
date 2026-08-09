import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';

/**
 * Angemeldete Sitzungen.
 *
 * Serverseitig gehalten, nicht als selbsttragende Marke im Keks. Der Unterschied zählt:
 * eine signierte Marke lässt sich nicht zurücknehmen - wer abgemeldet wird, bleibt bis
 * zum Ablauf angemeldet, und ein gestohlener Keks gilt weiter. Eine Sitzung, die hier
 * steht, ist mit einer Zeile weg.
 *
 * Auf Platte, damit ein Neustart des Servers nicht alle abmeldet. Bei einem
 * Mailprogramm, das den ganzen Tag offen ist, wäre das der auffälligste Nachteil einer
 * reinen Speicherlösung.
 */

export interface Sitzung {
  /** sha256 der Kennung - siehe unten. */
  kennungHash: string;
  nutzerId: string;
  angelegt: number;
  zuletztGenutzt: number;
}

type Ablage = { sitzungen: Sitzung[] };

const getPfad = () => path.join(getWurzelDir(), 'sitzungen.json');

/** Nach so langer Untätigkeit ist Schluss. */
const RUHE_FRIST_MS = 14 * 24 * 60 * 60 * 1000;

/** Und spätestens dann in jedem Fall - auch bei täglicher Nutzung. */
const HOECHSTDAUER_MS = 90 * 24 * 60 * 60 * 1000;

/** Damit ein voller Datenträger oder ein Fehler die Anmeldung nicht endlos wachsen lässt. */
const MAX_SITZUNGEN = 10_000;

let geladen: Sitzung[] | null = null;

function lesen(): Sitzung[] {
  if (geladen) return geladen;
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'warnung',
      'sitzung',
      `${befund.beschaedigt.pfad} war unlesbar - alle Nutzer müssen sich neu anmelden.`,
    );
  }
  geladen = Array.isArray(befund.wert?.sitzungen) ? befund.wert.sitzungen : [];
  return geladen;
}

function schreiben(): void {
  try {
    schreibeAtomar(getPfad(), JSON.stringify({ sitzungen: geladen ?? [] }, null, 2));
  } catch (err) {
    protokolliere('warnung', 'sitzung', `Sitzungen nicht gesichert: ${(err as Error).message}`);
  }
}

/**
 * Gespeichert wird nur eine Prüfsumme der Kennung, nicht die Kennung selbst.
 *
 * Damit ist die Datei kein Generalschlüssel: Wer sie in die Hände bekommt - aus einer
 * Sicherung, über einen Lesefehler anderswo -, kann daraus keine gültige Sitzung bauen.
 * sha256 genügt hier, anders als beim Kennwort: die Kennung sind 32 zufällige Bytes, da
 * gibt es nichts zu erraten, und ein langsames Verfahren käme bei jeder Anfrage zum
 * Tragen.
 */
function hashe(kennung: string): string {
  return crypto.createHash('sha256').update(kennung).digest('hex');
}

function abgelaufen(s: Sitzung, jetzt: number): boolean {
  return jetzt - s.zuletztGenutzt > RUHE_FRIST_MS || jetzt - s.angelegt > HOECHSTDAUER_MS;
}

/** Legt eine Sitzung an und gibt die Kennung zurück - sie steht danach nirgends mehr. */
export function eroeffneSitzung(nutzerId: string): string {
  const sitzungen = lesen();
  const jetzt = Date.now();

  // Beim Anmelden aufräumen: ein eigener Zeitgeber dafür wäre ein Aufwand, der nichts
  // besser macht - hier kommt ohnehin regelmäßig jemand vorbei.
  const uebrig = sitzungen.filter((s) => !abgelaufen(s, jetzt));
  if (uebrig.length >= MAX_SITZUNGEN) {
    uebrig.sort((a, b) => b.zuletztGenutzt - a.zuletztGenutzt);
    uebrig.length = MAX_SITZUNGEN - 1;
  }

  const kennung = crypto.randomBytes(32).toString('base64url');
  uebrig.push({ kennungHash: hashe(kennung), nutzerId, angelegt: jetzt, zuletztGenutzt: jetzt });

  geladen = uebrig;
  schreiben();
  return kennung;
}

/**
 * Wem eine Kennung gehört - oder `null`.
 *
 * Frischt nebenbei die letzte Nutzung auf, damit eine benutzte Sitzung nicht mitten in
 * der Arbeit abläuft. Geschrieben wird dabei nicht bei jeder Anfrage: das wären bei einem
 * offenen Mailprogramm hunderte Schreibvorgänge je Stunde für eine Angabe, die auf ein
 * paar Minuten genau nicht ankommt.
 */
export function nutzerZurSitzung(kennung: string | undefined): string | null {
  if (!kennung) return null;
  const gesucht = hashe(kennung);
  const jetzt = Date.now();

  const sitzung = lesen().find((s) => s.kennungHash === gesucht);
  if (!sitzung) return null;
  if (abgelaufen(sitzung, jetzt)) {
    beendeSitzung(kennung);
    return null;
  }

  if (jetzt - sitzung.zuletztGenutzt > 60 * 60 * 1000) {
    sitzung.zuletztGenutzt = jetzt;
    schreiben();
  }
  return sitzung.nutzerId;
}

export function beendeSitzung(kennung: string | undefined): void {
  if (!kennung) return;
  const gesucht = hashe(kennung);
  const vorher = lesen().length;
  geladen = lesen().filter((s) => s.kennungHash !== gesucht);
  if (geladen.length !== vorher) schreiben();
}

/** Meldet einen Nutzer überall ab - nach Kennwortwechsel oder auf Verlangen. */
export function beendeAlleSitzungen(nutzerId: string): number {
  const vorher = lesen().length;
  geladen = lesen().filter((s) => s.nutzerId !== nutzerId);
  const weg = vorher - geladen.length;
  if (weg > 0) schreiben();
  return weg;
}

/** Nur für Prüfungen: den Zwischenspeicher vergessen. */
export function vergissSitzungen(): void {
  geladen = null;
}
