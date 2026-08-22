import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';

/**
 * Die Bremse gegen Durchprobieren - über Neustarts hinweg.
 *
 * Vorher stand sie als `Map` im Arbeitsspeicher von anmelden.ts, mit einem ehrlichen
 * Kommentar daneben: "bei einem Neustart ist sie weg, und das ist für den Bekanntenkreis
 * vertretbar. Vor dem öffentlichen Betrieb gehört an diese Stelle etwas, das über
 * Prozessgrenzen hinweg zählt." Der öffentliche Betrieb ist da.
 *
 * Was daran das Loch war: Ein Neustart kommt nicht nur vom Angreifer. Er kommt von jedem
 * Einspielen einer neuen Fassung, von jedem `docker compose up -d`, von jedem Absturz.
 * Wer davon eine Handvoll am Tag hat, hat eine Bremse, die nie greift - und niemand sieht
 * es, weil sie im gelungenen Fall ohnehin nichts tut.
 *
 * ## Zwei Ebenen, und die dritte fehlt mit Absicht
 *
 * **Anschluss + Adresse** ist die genaue Frage: Hier probiert jemand EIN Kennwort durch.
 * Zehn Versuche in einer Viertelstunde.
 *
 * **Anschluss allein** fängt das, was die genaue Frage durchlässt: Wer ein einziges
 * Kennwort ("Sommer2026!") gegen fünfzig Adressen wirft, löst je Adresse einen Versuch aus
 * und käme nie an die Zehn. Fünfzig Versuche in der Stunde, dann ist Schluss.
 *
 * **Adresse allein gibt es hier nicht**, und das ist eine Entscheidung und kein Vergessen:
 * Eine Sperre, die an der Adresse hängt, kann jeder gegen jeden auslösen. Es genügt, die
 * Adresse zu kennen und zehnmal etwas Falsches zu schicken - und der Betroffene kommt eine
 * Viertelstunde lang nicht an seine Post, von keinem Anschluss aus. Das ist keine Bremse
 * mehr, das ist eine Waffe, und sie liegt für jeden bereit.
 *
 * ## Keine Steigerung der Sperrzeit
 *
 * Fünfzehn Minuten bleiben fünfzehn Minuten, auch beim zwanzigsten Mal. Gerechnet: zehn
 * Versuche je Viertelstunde sind vierzig in der Stunde, rund 350.000 im Jahr - gegen ein
 * Kennwort, das durch scrypt geht, ist das nichts. Eine Steigerung träfe also nicht den
 * Angreifer, für den es ohnehin aussichtslos ist, sondern den Menschen, der sein Kennwort
 * gerade nicht zusammenbekommt.
 */

/** Zehn Fehlversuche auf dieselbe Adresse vom selben Anschluss. */
const PAAR_MAX = 10;
const PAAR_FENSTER_MS = 15 * 60 * 1000;

/** Fünfzig Fehlversuche vom selben Anschluss, gleich gegen welche Adresse. */
const NETZ_MAX = 50;
const NETZ_FENSTER_MS = 60 * 60 * 1000;

/**
 * Damit die Datei nicht unbegrenzt wächst.
 *
 * Ein verteilter Angriff über zehntausend Anschlüsse legte sonst zehntausend Einträge an.
 * Ist die Grenze erreicht, fallen die heraus, die ohnehin als nächstes ablaufen - eine
 * frische Sperre bleibt damit stehen, eine fast abgelaufene geht.
 */
const MAX_EINTRAEGE = 20_000;

export interface Bremseintrag {
  /** Salzige Prüfsumme des Schlüssels - siehe `zeichen()`. */
  zeichen: string;
  anzahl: number;
  /** Wann dieser Eintrag verfällt. */
  bis: number;
}

type Ablage = { salz?: string; eintraege?: Bremseintrag[] };

const getPfad = () => path.join(getWurzelDir(), 'anmeldebremse.json');

let salz: string | null = null;
let geladen: Bremseintrag[] | null = null;

function lesen(): Bremseintrag[] {
  if (geladen) return geladen;
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    /*
     * Kaputt heißt hier nicht zwangsläufig "von vorn".
     *
     * liesJson greift zuerst auf die `.bak`-Fassung zurück und heilt die Datei damit -
     * dann stehen die Zähler weiter, nur ein paar Sekunden alt. Erst wenn auch die
     * Sicherungskopie unlesbar ist, fängt die Bremse bei null an.
     *
     * Und das ist dann die richtige Richtung. Die Alternative wäre, im Zweifel zu
     * sperren - dann sperrte eine beschädigte Datei alle Nutzer aus, und aus einem
     * Schreibfehler würde ein Ausfall. Ein Angreifer gewinnt durch das Zurücksetzen eine
     * Viertelstunde; ein ausgesperrter Betrieb verliert einen Tag.
     */
    protokolliere(
      'warnung',
      'anmeldung',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  salz = typeof befund.wert?.salz === 'string' ? befund.wert.salz : null;
  geladen = Array.isArray(befund.wert?.eintraege) ? befund.wert.eintraege : [];
  return geladen;
}

function schreiben(): void {
  try {
    schreibeAtomar(
      getPfad(),
      JSON.stringify({ salz: salzWert(), eintraege: geladen ?? [] }, null, 2),
    );
  } catch (err) {
    protokolliere('warnung', 'anmeldung', `Anmeldebremse nicht gesichert: ${(err as Error).message}`);
  }
}

function salzWert(): string {
  if (!salz) salz = crypto.randomBytes(16).toString('base64url');
  return salz;
}

/**
 * Aus Anschluss und Adresse ein Zeichen machen - und nicht beides hinschreiben.
 *
 * Die Bremse muss VERGLEICHEN, nie zurücklesen. Sie fragt einzig: "war dieser Schlüssel
 * schon da?" Für diese Frage genügt eine Prüfsumme, und dann steht in der Datei eben
 * nicht, wer sich am Dienstag um halb vier von wo aus vertippt hat.
 *
 * Das ist keine Förmlichkeit. Eine Anschlusskennung ist ein personenbezogenes Datum, und
 * jede Fehleingabe legte hier sonst eine Zeile an, die weder jemand liest noch jemand
 * löscht. Dieselbe Überlegung steht schon zweimal in diesem Programm: Das Protokoll kürzt
 * Anschlusskennungen (siehe kuerzeIpAdresse), und die Sitzungsdatei speichert nur die
 * Prüfsumme der Kennung statt der Kennung. Wer weniger hinschreibt, muss weniger schützen.
 *
 * Das Salz ist je Installation zufällig. Ohne es ließe sich eine Prüfsumme durch
 * Durchprobieren des Adressraums wieder auflösen - vier Milliarden sha256 sind kein
 * Aufwand mehr.
 */
function zeichen(roh: string): string {
  return crypto.createHash('sha256').update(`${salzWert()}|${roh}`).digest('base64url');
}

function aufraeumen(jetzt: number): Bremseintrag[] {
  const uebrig = lesen().filter((e) => e.bis > jetzt);
  if (uebrig.length > MAX_EINTRAEGE) {
    uebrig.sort((a, b) => b.bis - a.bis);
    uebrig.length = MAX_EINTRAEGE;
  }
  return uebrig;
}

function finde(eintraege: Bremseintrag[], z: string, jetzt: number): Bremseintrag | undefined {
  const e = eintraege.find((x) => x.zeichen === z);
  return e && e.bis > jetzt ? e : undefined;
}

/** Wie ein Schlüssel aussieht - einmal für beide Ebenen, damit sie nicht auseinanderlaufen. */
function schluessel(ip: string, email?: string): string {
  return email === undefined ? `netz:${ip}` : `paar:${ip}|${email.trim().toLowerCase()}`;
}

export type Sperrgrund = 'paar' | 'netz';

/**
 * Ob dieser Versuch noch durchdarf - und wenn nicht, welche Ebene ihn hält.
 *
 * Zählt selbst nichts hoch: Ein Aufruf beantwortet eine Frage und hat keine Wirkung.
 * Gezählt wird erst, wenn die Anmeldung tatsächlich misslungen ist.
 */
export function istGesperrt(ip: string, email: string): Sperrgrund | null {
  const jetzt = Date.now();
  const eintraege = lesen();
  const paar = finde(eintraege, zeichen(schluessel(ip, email)), jetzt);
  if (paar && paar.anzahl >= PAAR_MAX) return 'paar';
  const netz = finde(eintraege, zeichen(schluessel(ip)), jetzt);
  if (netz && netz.anzahl >= NETZ_MAX) return 'netz';
  return null;
}

/**
 * Einen Fehlversuch vermerken.
 *
 * Geschrieben wird nur, solange die Sperre noch nicht steht. Wer bereits gesperrt ist,
 * erzeugt keinen Schreibvorgang mehr - sonst wäre jeder weitere Versuch ein Schreiben auf
 * die Platte, und ein Angreifer, den wir gerade ausgesperrt haben, dürfte uns dafür den
 * Datenträger beschäftigen. An der Rate ändert das nichts: Die Sperre läuft ab dem
 * letzten gezählten Versuch, also gibt es weiterhin zehn je Viertelstunde.
 */
export function merkeFehlversuch(ip: string, email: string): void {
  const jetzt = Date.now();
  const eintraege = aufraeumen(jetzt);
  let geaendert = false;

  for (const [roh, max, fenster] of [
    [schluessel(ip, email), PAAR_MAX, PAAR_FENSTER_MS],
    [schluessel(ip), NETZ_MAX, NETZ_FENSTER_MS],
  ] as const) {
    const z = zeichen(roh);
    const vorhanden = eintraege.find((e) => e.zeichen === z);
    if (!vorhanden) {
      eintraege.push({ zeichen: z, anzahl: 1, bis: jetzt + fenster });
      geaendert = true;
    } else if (vorhanden.anzahl < max) {
      vorhanden.anzahl += 1;
      vorhanden.bis = jetzt + fenster;
      geaendert = true;
    }
  }

  geladen = eintraege;
  if (geaendert) schreiben();
}

/**
 * Nach gelungener Anmeldung: das Paar vergessen.
 *
 * Nur das Paar, nicht den Anschluss. Sonst genügte ein einziges richtiges Kennwort, um
 * den Zähler für alle anderen Adressen zurückzusetzen - und wer eine gültige Anmeldung
 * hat, könnte von derselben Leitung aus unbegrenzt gegen die Postfächer seiner Kollegen
 * probieren.
 */
export function merkeErfolg(ip: string, email: string): void {
  const jetzt = Date.now();
  const z = zeichen(schluessel(ip, email));
  const eintraege = aufraeumen(jetzt);
  const uebrig = eintraege.filter((e) => e.zeichen !== z);
  geladen = uebrig;
  if (uebrig.length !== eintraege.length) schreiben();
}

/**
 * Ein Zähler für alles andere, was sich begrenzen lassen muss.
 *
 * ## Warum das hier steht und nicht als zweite Bremse daneben
 *
 * Weil die Buchführung dieselbe ist: gesalzene Prüfsummen statt Klartext, ein Ablaufdatum
 * je Eintrag, eine Obergrenze gegen unbegrenztes Wachsen, und alles auf Platte, damit ein
 * Neustart die Zählung nicht zurücksetzt. Ein zweites Modul mit denselben hundert Zeilen
 * wäre die Sorte Verdopplung, bei der ein Jahr später nur eine von beiden repariert wird -
 * und keiner merkt, welche.
 *
 * Was ANDERS ist als oben, und deshalb einen eigenen Weg braucht: Dort wird gezählt, was
 * MISSLUNGEN ist. Eine Registrierung misslingt nicht - sie gelingt, und trotzdem darf sie
 * nicht beliebig oft von derselben Leitung kommen. Deshalb zählt diese Funktion den
 * Versuch selbst und beantwortet in einem Zug, ob die Grenze damit gerissen ist.
 *
 * @param bereich Ein eigener Namensraum je Verwendung. Getrennt zu zählen ist wesentlich:
 *   Ein Mensch, der sich registriert hat, soll deswegen nicht bei der Anmeldung anstehen.
 * @param roh Wonach gezählt wird - meist eine Anschlusskennung. Steht nie im Klartext in
 *   der Datei, sondern geht durch dieselbe gesalzene Prüfsumme wie oben.
 * @returns `true`, wenn dieser Versuch noch durchdarf.
 */
export function zaehleVersuch(
  bereich: string,
  roh: string,
  max: number,
  fensterMs: number,
): boolean {
  const jetzt = Date.now();
  const eintraege = aufraeumen(jetzt);
  const z = zeichen(`${bereich}:${roh}`);
  const vorhanden = eintraege.find((e) => e.zeichen === z);

  if (!vorhanden) {
    eintraege.push({ zeichen: z, anzahl: 1, bis: jetzt + fensterMs });
    geladen = eintraege;
    schreiben();
    return true;
  }

  if (vorhanden.anzahl >= max) {
    /*
     * Über der Grenze wird nicht mehr geschrieben - dieselbe Überlegung wie bei
     * merkeFehlversuch: Wer ohnehin abgewiesen wird, soll uns nicht mit jedem weiteren
     * Versuch den Datenträger beschäftigen. Die Frist läuft ab dem letzten GEZÄHLTEN
     * Versuch, die Rate bleibt damit dieselbe.
     */
    geladen = eintraege;
    return false;
  }

  vorhanden.anzahl += 1;
  vorhanden.bis = jetzt + fensterMs;
  geladen = eintraege;
  schreiben();
  return true;
}

/** Nur für Prüfungen: den Zwischenspeicher vergessen - wie ein Neustart des Servers. */
export function vergissBremse(): void {
  geladen = null;
  salz = null;
}
