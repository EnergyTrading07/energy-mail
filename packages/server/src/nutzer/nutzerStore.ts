import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';
import { istGueltigeNutzerId, pruefeNutzerId } from './kontext.js';
import { brauchtErneuerung, kennwortStimmt, verschluesselKennwort } from './kennwort.js';

/**
 * Wer den Server benutzen darf.
 *
 * Liegt in der WURZEL, nicht in einem Nutzerordner: es ist die Liste der Nutzer selbst,
 * sie gehört keinem einzelnen. Das ist auch der Grund, warum dieses Modul getWurzelDir()
 * nimmt und nicht getNutzerDir() - es läuft, bevor überhaupt feststeht, wer da ist.
 */

export interface Nutzer {
  id: string;
  /** Die Anmeldeadresse. Kleingeschrieben abgelegt, damit die Anmeldung nicht daran scheitert. */
  email: string;
  /** Prüfsumme des Anmeldekennworts - siehe kennwort.ts. */
  kennwort: string;
  angelegt: string;
  /**
   * Die verpackten Schlüssel dieses Nutzers, nach Generation.
   *
   * Mit ihnen werden seine Geheimnisse verschlüsselt (Postfachkennwörter, OAuth-Marken,
   * geheime PGP-Schlüssel). Sie liegen hier NICHT im Klartext, sondern jeweils mit dem
   * Masterschlüssel des Servers verschlüsselt - siehe schluesselHuelle.ts.
   *
   * Mehrere Generationen, damit sich der Schlüssel eines Nutzers wechseln lässt, ohne im
   * selben Augenblick sämtliche Geheimnisse neu verschlüsseln zu müssen: Neues wird mit
   * der aktuellen Generation geschrieben, Altes bleibt mit seiner lesbar, bis ein
   * Umschlüsseln durchgelaufen ist.
   */
  schluessel: Record<string, string>;
  /** Welche Generation für neue Geheimnisse gilt. */
  aktuelleGeneration: string;
  /** Gesperrte Nutzer können sich nicht anmelden, ihre Daten bleiben aber erhalten. */
  gesperrt?: boolean;
}

/** Was nach außen gehen darf - ohne Prüfsumme, ohne Schlüssel. */
export interface OeffentlicherNutzer {
  id: string;
  email: string;
  angelegt: string;
}

type Ablage = { nutzer: Nutzer[] };

const getPfad = () => path.join(getWurzelDir(), 'nutzer.json');

function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'nutzer',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  return Array.isArray(befund.wert?.nutzer) ? befund.wert : { nutzer: [] };
}

function schreiben(ablage: Ablage): void {
  schreibeAtomar(getPfad(), JSON.stringify(ablage, null, 2));
}

/** Für die Anzeige - nie die Prüfsumme oder die Schlüssel herausgeben. */
export function oeffentlich(n: Nutzer): OeffentlicherNutzer {
  return { id: n.id, email: n.email, angelegt: n.angelegt };
}

export function alleNutzer(): OeffentlicherNutzer[] {
  return lesen().nutzer.map(oeffentlich);
}

export function nutzerAnzahl(): number {
  return lesen().nutzer.length;
}

export function findeNutzer(id: string): Nutzer | null {
  if (!istGueltigeNutzerId(id)) return null;
  return lesen().nutzer.find((n) => n.id === id) ?? null;
}

export function findeNutzerNachEmail(email: string): Nutzer | null {
  const gesucht = email.trim().toLowerCase();
  if (!gesucht) return null;
  return lesen().nutzer.find((n) => n.email === gesucht) ?? null;
}

export class NutzerFehler extends Error {}

/**
 * Macht aus einer Mailadresse eine brauchbare Kennung.
 *
 * Die Kennung wird zu einem Ordnernamen (siehe kontext.ts), taugt also nur mit
 * Kleinbuchstaben, Ziffern, Bindestrich und Unterstrich. "Anna.Müller+mail@beispiel.de"
 * ergibt "anna-mueller-mail"; kollidiert das, wird durchnummeriert.
 */
function kennungAus(email: string, vergeben: readonly string[]): string {
  const roh = email.split('@')[0] ?? 'nutzer';
  const basis =
    roh
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'nutzer';

  if (!vergeben.includes(basis) && istGueltigeNutzerId(basis)) return basis;
  for (let i = 2; i < 10_000; i++) {
    const versuch = `${basis}-${i}`;
    if (!vergeben.includes(versuch)) return versuch;
  }
  // Praktisch unerreichbar; besser als eine Endlosschleife.
  return `nutzer-${crypto.randomBytes(6).toString('hex')}`;
}

export interface NeuerNutzer {
  email: string;
  kennwort: string;
  /** Nur für den Einplatzbetrieb: dort heißt der Nutzer fest "lokal". */
  id?: string;
}

/**
 * Legt einen Nutzer an - samt seinem verpackten Schlüssel.
 *
 * Der Schlüssel entsteht hier und nicht erst beim ersten Geheimnis: ein Nutzer ohne
 * Schlüssel wäre ein halber Zustand, in dem das Anlegen eines Kontos an einer Stelle
 * scheiterte, die damit nichts zu tun hat.
 */
export function legeNutzerAn(
  eingabe: NeuerNutzer,
  verpackeSchluessel: (roh: Buffer) => string,
): Nutzer {
  const email = eingabe.email.trim().toLowerCase();
  if (!email.includes('@') || email.length < 3) {
    throw new NutzerFehler('Das ist keine brauchbare Mailadresse.');
  }
  if (typeof eingabe.kennwort !== 'string' || eingabe.kennwort.length < 10) {
    /*
     * Zehn Zeichen als Untergrenze, keine Regeln über Sonderzeichen.
     *
     * Die üblichen Regeln ("mindestens eine Ziffer, ein Großbuchstabe...") führen
     * nachweislich zu schlechteren Kennwörtern, weil sie Menschen zu "Passwort1!"
     * treiben. Länge ist die einzige Anforderung, die tatsächlich hilft.
     */
    throw new NutzerFehler('Das Kennwort muss mindestens zehn Zeichen haben.');
  }

  const ablage = lesen();
  if (ablage.nutzer.some((n) => n.email === email)) {
    throw new NutzerFehler('Diese Adresse ist hier bereits angemeldet.');
  }

  const id = eingabe.id
    ? pruefeNutzerId(eingabe.id)
    : kennungAus(
        email,
        ablage.nutzer.map((n) => n.id),
      );
  if (ablage.nutzer.some((n) => n.id === id)) {
    throw new NutzerFehler(`Die Kennung "${id}" ist bereits vergeben.`);
  }

  const neu: Nutzer = {
    id,
    email,
    kennwort: verschluesselKennwort(eingabe.kennwort),
    angelegt: new Date().toISOString(),
    schluessel: { '1': verpackeSchluessel(crypto.randomBytes(32)) },
    aktuelleGeneration: '1',
  };

  ablage.nutzer.push(neu);
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Nutzer "${id}" angelegt.`);
  return neu;
}

/**
 * Prüft eine Anmeldung.
 *
 * Gibt bei Erfolg den Nutzer zurück, sonst `null` - und zwar mit demselben Aufwand,
 * gleich ob es die Adresse gibt oder nicht. Sonst verriete die Antwortzeit, welche
 * Adressen angemeldet sind.
 */
export function pruefeAnmeldung(email: string, kennwort: string): Nutzer | null {
  const nutzer = findeNutzerNachEmail(email);

  if (!nutzer) {
    /*
     * Auch ohne Treffer rechnen.
     *
     * Ohne das wäre die Antwort bei einer unbekannten Adresse sofort da und bei einer
     * bekannten erst nach der scrypt-Rechnung. Aus dem Unterschied ließe sich ablesen,
     * wer hier ein Konto hat - eine Auskunft, die niemanden etwas angeht.
     */
    verschluesselKennwort(kennwort);
    return null;
  }
  if (nutzer.gesperrt) return null;
  if (!kennwortStimmt(kennwort, nutzer.kennwort)) return null;

  // Der einzige Augenblick, in dem das Kennwort im Klartext vorliegt: die Gelegenheit,
  // eine mit schwächeren Parametern gerechnete Prüfsumme still zu erneuern.
  if (brauchtErneuerung(nutzer.kennwort)) {
    setzeKennwort(nutzer.id, kennwort);
    protokolliere('info', 'nutzer', `Kennwortprüfsumme von "${nutzer.id}" erneuert.`);
  }

  return nutzer;
}

export function setzeKennwort(id: string, neuesKennwort: string): void {
  if (typeof neuesKennwort !== 'string' || neuesKennwort.length < 10) {
    throw new NutzerFehler('Das Kennwort muss mindestens zehn Zeichen haben.');
  }
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  nutzer.kennwort = verschluesselKennwort(neuesKennwort);
  schreiben(ablage);
}

/**
 * Sperrt einen Nutzer oder gibt ihn wieder frei.
 *
 * Der Unterschied zum Entfernen ist der Punkt: gesperrt kommt er nicht mehr herein, seine
 * Daten bleiben aber lesbar. Das ist, was man in der Testphase tatsächlich braucht -
 * jemand hört auf, oder etwas ist unklar und soll bis zur Klärung ruhen. Entfernen ist
 * endgültig: mit dem Eintrag geht sein Schlüssel, und danach sind seine Geheimnisse in
 * jeder Sicherung nur noch Bytes.
 *
 * `gesperrt` wurde in pruefeAnmeldung() schon abgefragt, seit es das Feld gibt - nur
 * konnte es niemand setzen. Die Abfrage lief also ins Leere.
 */
export function setzeSperre(id: string, gesperrt: boolean): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  if (gesperrt) nutzer.gesperrt = true;
  else delete nutzer.gesperrt;
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Nutzer "${id}" ${gesperrt ? 'gesperrt' : 'wieder freigegeben'}.`);
}

/** Ob ein Nutzer gesperrt ist - für die Anzeige im Verwaltungswerkzeug. */
export function istGesperrt(id: string): boolean {
  return Boolean(findeNutzer(id)?.gesperrt);
}

/** Trägt eine neue Schlüsselgeneration ein - für den Wechsel des Nutzerschlüssels. */
export function setzeSchluesselGeneration(id: string, generation: string, verpackt: string): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  nutzer.schluessel[generation] = verpackt;
  nutzer.aktuelleGeneration = generation;
  schreiben(ablage);
}

/**
 * Entfernt einen Nutzer aus der Liste.
 *
 * Damit sind seine Geheimnisse unlesbar - auch in jeder Sicherung, die es von ihnen
 * gibt: der Schlüssel dazu steht ausschließlich hier. Die Dateien in seinem Ordner löscht
 * der Aufrufer; ohne Schlüssel sind sie nur noch Bytes.
 */
export function entferneNutzer(id: string): boolean {
  const ablage = lesen();
  const vorher = ablage.nutzer.length;
  ablage.nutzer = ablage.nutzer.filter((n) => n.id !== id);
  if (ablage.nutzer.length === vorher) return false;
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Nutzer "${id}" entfernt - seine Geheimnisse sind unlesbar.`);
  return true;
}
