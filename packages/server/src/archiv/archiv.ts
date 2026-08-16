import fs from 'node:fs';
import path from 'node:path';
import { getNutzerDir } from '../paths.js';
import { schreibeAtomar } from '../atomar.js';
import { protokolliere } from '../protokollDatei.js';
import { aktuellerNutzer, handelnderNutzer } from '../nutzer/kontext.js';
import { aufbewahrenBis, fristAbgelaufen, laengere, type Aufbewahrungsart } from './fristen.js';
import { ANFANG, abdruckVon, pruefeKette, verkette, type Eintrag, type Kettenbefund } from './kette.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Das Archiv nach GoBD.
 *
 * ## Was das ist und was es nicht ist
 *
 * Es ist ein zweiter, eigener Bestand: Jede Nachricht, die hereinkommt oder hinausgeht,
 * wird **im Original** abgelegt - die vollständigen Bytes samt aller Kopfzeilen, nicht
 * ein Ausdruck und nicht der angezeigte Text. Dazu ein Eintrag in einer verketteten
 * Liste, an der sich eine spätere Änderung ablesen lässt.
 *
 * Es ist **kein** Nachweis der Ordnungsmäßigkeit. Den gibt es für Software nicht: Die
 * GoBD sagen in Rz. 179 ausdrücklich, dass Zertifikate und Testate Dritter gegenüber der
 * Finanzverwaltung keine Bindungswirkung entfalten. Ordnungsmäßig ist ein *Verfahren*,
 * nicht ein Programm - dazu gehören die Organisation im Betrieb, die
 * Verfahrensdokumentation und die Frage, was überhaupt aufbewahrungspflichtig ist. Wer
 * etwas anderes verspricht, verkauft ein Gefühl.
 *
 * Was hier steht, ist der technische Teil davon, und der ist ehrlich gebaut.
 *
 * ## Warum ein zweiter Bestand und nicht das Postfach selbst
 *
 * Weil das Postfach dem Nutzer gehört. Er darf darin löschen, verschieben und aufräumen -
 * das ist der Sinn eines Postfachs. Ein Archiv, das dasselbe wäre, wäre keines. Der
 * Preis: die Nachrichten liegen zweimal. Bei üblicher Geschäftspost sind das ein paar
 * hundert Megabyte im Jahr; das ist die richtige Seite dieses Tauschs.
 *
 * ## Warum es nicht heimlich läuft
 *
 * Es wird je Konto eingeschaltet, und ohne diese Einstellung geschieht gar nichts. Ein
 * privates Postfach unbemerkt mitzuschreiben wäre gegenüber dem Nutzer falsch und
 * gegenüber jedem, der ihm schreibt, ebenso - und es gäbe dafür auch keinen Grund: Die
 * Aufbewahrungspflicht trifft geschäftliche Post, nicht alle.
 */

const ordner = () => path.join(getNutzerDir(), 'archiv');
const kettenDatei = () => path.join(ordner(), 'kette.jsonl');
const postOrdner = () => path.join(ordner(), 'post');
const einstellungsDatei = () => path.join(ordner(), 'einstellungen.json');

export class ArchivFehler extends Error {}

// --- Einstellungen ---

export interface ArchivEinstellungen {
  /** Konten, deren Post archiviert wird. Leer heißt: keines. */
  konten: string[];
  /** Was eine Nachricht ist, solange niemand etwas anderes sagt. */
  vorgabe: Aufbewahrungsart;
  /** Name des Betriebs - steht in der Verfahrensdokumentation und in der Ausfuhr. */
  betrieb?: string;
  /** Wer im Betrieb dafür zuständig ist. */
  verantwortlich?: string;
}

const LEER: ArchivEinstellungen = { konten: [], vorgabe: 'geschaeftsbrief' };

export function archivEinstellungen(): ArchivEinstellungen {
  try {
    const roh = JSON.parse(fs.readFileSync(einstellungsDatei(), 'utf-8')) as ArchivEinstellungen;
    if (Array.isArray(roh?.konten)) return { ...LEER, ...roh };
  } catch {
    // Keine Datei - dann ist nichts eingeschaltet.
  }
  return LEER;
}

/**
 * Ändert die Einstellungen.
 *
 * Die Änderung selbst kommt in die Kette. Das ist keine Übergenauigkeit: „Seit wann wird
 * dieses Konto mitgeschrieben?" ist die erste Frage einer Prüfung, wenn ein Zeitraum
 * dünn aussieht - und die Antwort gehört dorthin, wo sie sich nicht nachträglich
 * zurechtlegen lässt.
 */
export function setzeArchivEinstellungen(neu: ArchivEinstellungen): ArchivEinstellungen {
  const vorher = archivEinstellungen();
  const wert: ArchivEinstellungen = {
    konten: [...new Set(neu.konten ?? [])],
    vorgabe: neu.vorgabe ?? 'geschaeftsbrief',
    betrieb: neu.betrieb?.trim() || undefined,
    verantwortlich: neu.verantwortlich?.trim() || undefined,
  };
  fs.mkdirSync(ordner(), { recursive: true, mode: 0o700 });
  schreibeAtomar(einstellungsDatei(), JSON.stringify(wert, null, 2));

  const dazu = wert.konten.filter((k) => !vorher.konten.includes(k));
  const weg = vorher.konten.filter((k) => !wert.konten.includes(k));
  if (dazu.length > 0 || weg.length > 0) {
    vermerkeAllgemein(
      `Aufzeichnung geändert:${dazu.length ? ` ein für ${dazu.join(', ')};` : ''}` +
        `${weg.length ? ` aus für ${weg.join(', ')};` : ''}`,
    );
  }
  return wert;
}

export const wirdArchiviert = (kontoId: string): boolean =>
  archivEinstellungen().konten.includes(kontoId);

// --- Die Kette lesen ---

/**
 * Alle Einträge, älteste zuerst.
 *
 * Einmal gelesen und behalten, mit einem Blick auf die Größe der Datei: Ein Archiv mit
 * fünfzigtausend Nachrichten ist eine Datei von zwanzig Megabyte, und die bei jeder
 * Suche neu zu lesen wäre spürbar. Wächst sie - und das tut sie nur durch uns selbst -,
 * wird nachgelesen statt neu gelesen.
 */
interface Zwischenstand {
  eintraege: Eintrag[];
  gelesenBis: number;
  beschaedigt?: string;
}
const gemerkt = new Map<string, Zwischenstand>();

export function alleEintraege(): Eintrag[] {
  return liesStand().eintraege;
}

function liesStand(): Zwischenstand {
  const datei = kettenDatei();
  const schluessel = `${aktuellerNutzer()}:${datei}`;
  const bisher = gemerkt.get(schluessel);

  let groesse = 0;
  try {
    groesse = fs.statSync(datei).size;
  } catch {
    // Keine Datei - ein leeres Archiv.
    const leer: Zwischenstand = { eintraege: [], gelesenBis: 0 };
    gemerkt.set(schluessel, leer);
    return leer;
  }

  if (bisher && bisher.gelesenBis === groesse) return bisher;

  /*
   * Kleiner geworden kann sie nur sein, wenn jemand von außen eingegriffen hat. Dann
   * wird vollständig neu gelesen - und die Kettenprüfung schlägt gleich darauf an.
   */
  const vonVorn = !bisher || groesse < bisher.gelesenBis;
  const stand: Zwischenstand = vonVorn
    ? { eintraege: [], gelesenBis: 0 }
    : { eintraege: [...bisher.eintraege], gelesenBis: bisher.gelesenBis };

  const griff = fs.openSync(datei, 'r');
  try {
    const rest = groesse - stand.gelesenBis;
    const puffer = Buffer.alloc(rest);
    fs.readSync(griff, puffer, 0, rest, stand.gelesenBis);
    const zeilen = puffer.toString('utf8').split('\n');
    // Die letzte Zeile ist entweder leer (sauberes Ende) oder halb - beides steht nicht
    // im Bestand, sondern wird beim nächsten Mal noch einmal gelesen.
    const vollstaendig = zeilen.slice(0, -1);
    for (const zeile of vollstaendig) {
      if (!zeile.trim()) continue;
      try {
        stand.eintraege.push(JSON.parse(zeile) as Eintrag);
      } catch {
        stand.beschaedigt = t('Im Archiv steht eine Zeile, die sich nicht lesen lässt.');
      }
    }
    stand.gelesenBis = groesse - Buffer.byteLength(zeilen.at(-1) ?? '', 'utf8');
  } finally {
    fs.closeSync(griff);
  }

  gemerkt.set(schluessel, stand);
  return stand;
}

/** Nur für die Prüfung: den gemerkten Stand vergessen. */
export function vergissStand(): void {
  gemerkt.clear();
}

export function siegel(): string {
  return alleEintraege().at(-1)?.siegel ?? ANFANG;
}

// --- Schreiben ---

/**
 * Legt eine Nachricht ab.
 *
 * Die Reihenfolge ist Absicht: **erst die Datei, dann der Eintrag.** Bricht es
 * dazwischen ab, liegt eine Datei ohne Eintrag herum - unschön, aber harmlos. Andersherum
 * stünde ein Eintrag ohne Nachricht in der Kette, und der ließe sich nie wieder
 * auflösen: Die Kette lässt sich nicht rückwirkend berichtigen, das ist ihr Zweck.
 *
 * Zurück kommt der Eintrag - oder `null`, wenn dieselbe Nachricht schon dasteht.
 */
export function archiviere(
  bytes: Buffer,
  angaben: {
    richtung: 'empfangen' | 'gesendet';
    kontoId: string;
    ordner?: string;
    absender: string;
    empfaenger: string[];
    betreff: string;
    messageId?: string;
    entstandenAm: Date;
    art?: Aufbewahrungsart;
  },
): Eintrag | null {
  const abdruck = abdruckVon(bytes);
  const stand = liesStand();
  // Dieselben Bytes im selben Konto sind dieselbe Nachricht. Ein Postfachwächter meldet
  // gelegentlich zweimal; ein Archiv mit Doppeleinträgen wäre nur schwerer zu lesen.
  if (stand.eintraege.some((e) => e.abdruck === abdruck && e.kontoId === angaben.kontoId)) {
    return null;
  }

  const art = angaben.art ?? archivEinstellungen().vorgabe;
  const jahr = angaben.entstandenAm.getUTCFullYear();
  const datei = `${jahr}/${abdruck.slice(0, 32)}.eml`;
  const voll = path.join(postOrdner(), datei);

  fs.mkdirSync(path.dirname(voll), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(voll)) {
    /*
     * Nur lesbar geschrieben. Das hält niemanden auf, der es darauf anlegt - unter
     * Windows kann der Eigentümer die Rechte selbst ändern -, aber es verhindert das
     * versehentliche Überschreiben durch ein anderes Programm, und das ist der Fall,
     * der wirklich vorkommt.
     */
    const griff = fs.openSync(voll, 'wx', 0o400);
    try {
      fs.writeFileSync(griff, bytes);
      fs.fsyncSync(griff);
    } finally {
      fs.closeSync(griff);
    }
  }

  return haengeAn({
    erfasstAm: new Date().toISOString(),
    datei,
    abdruck,
    groesse: bytes.length,
    richtung: angaben.richtung,
    kontoId: angaben.kontoId,
    ordner: angaben.ordner,
    absender: angaben.absender,
    empfaenger: angaben.empfaenger,
    betreff: angaben.betreff,
    messageId: angaben.messageId,
    entstandenAm: angaben.entstandenAm.toISOString(),
    art,
    aufbewahrenBis: aufbewahrenBis(angaben.entstandenAm, art),
  });
}

/** Hängt eine Zeile an die Kette - die einzige Stelle, die das tut. */
function haengeAn(rumpf: Omit<Eintrag, 'nr' | 'vorher' | 'siegel'>): Eintrag {
  const stand = liesStand();
  const eintrag = verkette(rumpf, stand.eintraege.at(-1) ?? null);
  const zeile = JSON.stringify(eintrag) + '\n';

  fs.mkdirSync(ordner(), { recursive: true, mode: 0o700 });
  /*
   * Anhängen und sofort auf die Platte. Ohne fsync läge die letzte Zeile im Puffer des
   * Betriebssystems - und bei einem Stromausfall fehlte ausgerechnet die Nachricht, die
   * gerade kam. Bei einem Archiv wiegt Verlässlichkeit mehr als Durchsatz; dieselbe
   * Abwägung wie beim Protokoll.
   */
  const griff = fs.openSync(kettenDatei(), 'a', 0o600);
  try {
    fs.writeFileSync(griff, zeile, 'utf-8');
    fs.fsyncSync(griff);
  } finally {
    fs.closeSync(griff);
  }

  stand.eintraege.push(eintrag);
  stand.gelesenBis += Buffer.byteLength(zeile, 'utf8');
  return eintrag;
}

/**
 * Schreibt einen Vermerk zu einem vorhandenen Eintrag.
 *
 * Als NEUER Eintrag am Ende, mit Verweis auf die Nummer - nicht als Änderung des alten.
 * Das ist der Unterschied zwischen einem Archiv und einem Ordner: Was einmal darin
 * steht, bleibt stehen, und was später dazukommt, steht später.
 */
export function vermerke(bezugAuf: number, text: string): Eintrag {
  const stand = liesStand();
  const gemeint = stand.eintraege.find((e) => e.nr === bezugAuf);
  if (!gemeint) throw new ArchivFehler(t('Zu dieser Nummer gibt es keinen Eintrag.'));

  const wer = handelnderNutzer();
  return haengeAn({
    erfasstAm: new Date().toISOString(),
    datei: '',
    abdruck: '',
    groesse: 0,
    richtung: gemeint.richtung,
    kontoId: gemeint.kontoId,
    absender: wer,
    empfaenger: [],
    betreff: '',
    entstandenAm: new Date().toISOString(),
    art: 'ohne-pflicht',
    // Ein Vermerk selbst muss nicht aufbewahrt werden - er verschwindet mit dem, worauf
    // er sich bezieht. Deshalb dessen Frist und nicht die eigene.
    aufbewahrenBis: gemeint.aufbewahrenBis,
    bezugAuf,
    vermerk: text,
  });
}

/** Ein Vermerk ohne Bezug - für Vorgänge, die das ganze Archiv betreffen. */
function vermerkeAllgemein(text: string): void {
  try {
    haengeAn({
      erfasstAm: new Date().toISOString(),
      datei: '',
      abdruck: '',
      groesse: 0,
      richtung: 'empfangen',
      kontoId: '',
      absender: handelnderNutzer(),
      empfaenger: [],
      betreff: '',
      entstandenAm: new Date().toISOString(),
      art: 'ohne-pflicht',
      aufbewahrenBis: new Date().toISOString(),
      vermerk: text,
    });
  } catch (err) {
    protokolliere('warnung', 'archiv', `Vermerk nicht möglich: ${(err as Error).message}`);
  }
}

/**
 * Trägt eine Nachricht in eine andere Aufbewahrungsart um.
 *
 * Verlängert die Frist oder lässt sie, wie sie ist - **verkürzen kann sie niemand.**
 * Sonst ließe sich eine unbequeme Nachricht dadurch loswerden, dass man sie kurz vor
 * einer Prüfung zur Privatpost erklärt.
 */
export function trageUm(bezugAuf: number, art: Aufbewahrungsart): Eintrag {
  const stand = liesStand();
  const gemeint = letzterStand(stand.eintraege, bezugAuf);
  if (!gemeint) throw new ArchivFehler(t('Zu dieser Nummer gibt es keinen Eintrag.'));

  const neu = aufbewahrenBis(new Date(gemeint.entstandenAm), art);
  return haengeAn({
    ...gemeint,
    erfasstAm: new Date().toISOString(),
    art,
    aufbewahrenBis: laengere(neu, gemeint.aufbewahrenBis),
    bezugAuf,
    vermerk: `Umgetragen nach „${art}“ durch ${handelnderNutzer()}.`,
  });
}

/**
 * Der geltende Stand eines Eintrags - der letzte, der sich auf ihn bezieht.
 *
 * Weil ein Umtragen einen neuen Eintrag anlegt statt den alten zu ändern, muss beim
 * Lesen zusammengesetzt werden, was zusammengehört. Genau so liest man auch ein
 * Kassenbuch mit Berichtigungen.
 */
function letzterStand(eintraege: readonly Eintrag[], nr: number): Eintrag | undefined {
  let gueltig = eintraege.find((e) => e.nr === nr);
  for (const e of eintraege) {
    if (e.bezugAuf === nr && e.abdruck) gueltig = e;
  }
  return gueltig;
}

// --- Lesen und Suchen ---

export interface Fund {
  nr: number;
  erfasstAm: string;
  entstandenAm: string;
  richtung: 'empfangen' | 'gesendet';
  kontoId: string;
  absender: string;
  empfaenger: string[];
  betreff: string;
  groesse: number;
  art: Aufbewahrungsart;
  aufbewahrenBis: string;
  /** Ob die Frist abgelaufen ist - dann darf gelöscht werden. */
  freigegeben: boolean;
  vermerke: { erfasstAm: string; wer: string; text: string }[];
}

export function suche(
  bedingung: {
    text?: string;
    von?: string;
    bis?: string;
    richtung?: 'empfangen' | 'gesendet';
    art?: Aufbewahrungsart;
    kontoId?: string;
  },
  grenze = 200,
  jetzt = new Date(),
): { treffer: Fund[]; gesamt: number } {
  const eintraege = alleEintraege();
  const wort = bedingung.text?.trim().toLowerCase();

  const vermerkeZu = new Map<number, Fund['vermerke']>();
  for (const e of eintraege) {
    if (e.bezugAuf === undefined || !e.vermerk) continue;
    const liste = vermerkeZu.get(e.bezugAuf) ?? [];
    liste.push({ erfasstAm: e.erfasstAm, wer: e.absender, text: e.vermerk });
    vermerkeZu.set(e.bezugAuf, liste);
  }

  const treffer: Fund[] = [];
  // Rückwärts: das Neueste zuerst, so sucht jeder.
  for (let i = eintraege.length - 1; i >= 0; i--) {
    const roh = eintraege[i]!;
    /*
     * Was keine Datei hat, ist keine Nachricht.
     *
     * Zwei Sorten stehen sonst mit in der Liste: Vermerke und Umtragungen (die haben
     * einen Bezug) - und Vermerke über das Archiv selbst, etwa "Aufzeichnung
     * eingeschaltet" (die haben keinen). Die zweite Sorte ist mir erst durch die Prüfung
     * aufgefallen: Sie tauchte als Nachricht ohne Betreff und ohne Beteiligte auf, mit
     * dem Datum des Tages - und verfälschte damit jede Zählung und jeden Zeitraum.
     */
    if (roh.bezugAuf !== undefined || !roh.datei) continue;
    const e = letzterStand(eintraege, roh.nr)!;

    if (bedingung.richtung && e.richtung !== bedingung.richtung) continue;
    if (bedingung.art && e.art !== bedingung.art) continue;
    if (bedingung.kontoId && e.kontoId !== bedingung.kontoId) continue;
    if (bedingung.von && e.entstandenAm < bedingung.von) continue;
    if (bedingung.bis && e.entstandenAm > bedingung.bis) continue;
    if (wort) {
      const heuhaufen = `${e.betreff} ${e.absender} ${e.empfaenger.join(' ')}`.toLowerCase();
      if (!heuhaufen.includes(wort)) continue;
    }
    treffer.push({
      nr: roh.nr,
      erfasstAm: roh.erfasstAm,
      entstandenAm: e.entstandenAm,
      richtung: e.richtung,
      kontoId: e.kontoId,
      absender: e.absender,
      empfaenger: e.empfaenger,
      betreff: e.betreff,
      groesse: e.groesse,
      art: e.art,
      aufbewahrenBis: e.aufbewahrenBis,
      freigegeben: fristAbgelaufen(e.aufbewahrenBis, jetzt),
      vermerke: vermerkeZu.get(roh.nr) ?? [],
    });
  }
  return { treffer: treffer.slice(0, grenze), gesamt: treffer.length };
}

/** Die Nachricht selbst, im Original. */
export function original(nr: number): { bytes: Buffer; eintrag: Eintrag } {
  const eintraege = alleEintraege();
  const eintrag = letzterStand(eintraege, nr);
  if (!eintrag?.datei) throw new ArchivFehler(t('Zu dieser Nummer gibt es keinen Eintrag.'));
  const bytes = fs.readFileSync(path.join(postOrdner(), eintrag.datei));
  if (abdruckVon(bytes) !== eintrag.abdruck) {
    /*
     * Hier wird ausdrücklich geworfen und nicht etwa die Nachricht trotzdem gezeigt.
     * Eine Datei, die nicht mehr zu ihrem Abdruck passt, ist keine archivierte Nachricht
     * mehr, sondern eine Datei mit unbekanntem Inhalt - und die als Original auszugeben
     * wäre schlimmer, als gar nichts auszugeben.
     */
    throw new ArchivFehler(
      t('Diese Nachricht stimmt nicht mehr mit ihrem Abdruck überein - sie wurde verändert.'),
    );
  }
  return { bytes, eintrag };
}

// --- Prüfen ---

export interface Bestandsbefund {
  kette: Kettenbefund;
  /** Wie viele Nachrichten wirklich nachgerechnet wurden. */
  geprueft: number;
  /** Einträge, deren Datei fehlt. */
  fehlend: number[];
  /** Einträge, deren Datei nicht mehr zum Abdruck passt. */
  verfaelscht: number[];
}

/**
 * Rechnet den ganzen Bestand nach.
 *
 * Dauert bei einem großen Archiv Minuten - jede Datei muss gelesen werden. Deshalb läuft
 * es nur auf ausdrücklichen Anstoß und nie nebenbei. Das Ergebnis gehört ins
 * Übergabeprotokoll einer Prüfung.
 */
export function pruefeBestand(): Bestandsbefund {
  const eintraege = alleEintraege();
  const befund: Bestandsbefund = {
    kette: pruefeKette(eintraege),
    geprueft: 0,
    fehlend: [],
    verfaelscht: [],
  };

  for (const e of eintraege) {
    if (!e.datei) continue;
    const voll = path.join(postOrdner(), e.datei);
    try {
      const bytes = fs.readFileSync(voll);
      befund.geprueft++;
      if (abdruckVon(bytes) !== e.abdruck) befund.verfaelscht.push(e.nr);
    } catch {
      befund.fehlend.push(e.nr);
    }
  }
  protokolliere(
    befund.kette.heil && befund.fehlend.length === 0 && befund.verfaelscht.length === 0
      ? 'info'
      : 'warnung',
    'archiv',
    `Bestandsprüfung: ${befund.geprueft} Nachrichten, ${befund.fehlend.length} fehlend, ` +
      `${befund.verfaelscht.length} verfälscht, Kette ${befund.kette.heil ? 'heil' : 'gebrochen'}.`,
  );
  return befund;
}

// --- Aufräumen ---

/**
 * Entfernt, was seine Frist hinter sich hat.
 *
 * Zwei Dinge, die man sich merken muss: Es läuft **nie von selbst** - eine Löschung, die
 * niemand angestoßen hat, ist bei aufbewahrungspflichtigen Unterlagen das Letzte, was man
 * will. Und die Kette bleibt vollständig: Die Nachricht verschwindet, ihr Eintrag nicht.
 * Sonst entstünde genau die Lücke, an der eine Prüfung hängenbleibt - und niemand könnte
 * sagen, ob dort etwas ablief oder etwas verschwand.
 */
export function raeumeAuf(jetzt = new Date(), wirklich = false): { anzahl: number; bytes: number } {
  const eintraege = alleEintraege();
  let anzahl = 0;
  let bytes = 0;

  for (const roh of eintraege) {
    if (roh.bezugAuf !== undefined || !roh.datei) continue;
    const e = letzterStand(eintraege, roh.nr)!;
    if (!fristAbgelaufen(e.aufbewahrenBis, jetzt)) continue;
    const voll = path.join(postOrdner(), e.datei);
    if (!fs.existsSync(voll)) continue;

    anzahl++;
    bytes += e.groesse;
    if (!wirklich) continue;
    try {
      // Erst schreibbar machen: geschrieben wurde sie mit 0o400.
      fs.chmodSync(voll, 0o600);
      fs.rmSync(voll);
      vermerke(roh.nr, `Nach Ablauf der Frist am ${e.aufbewahrenBis.slice(0, 10)} entfernt.`);
    } catch (err) {
      protokolliere('warnung', 'archiv', `Nicht entfernt (${e.datei}): ${(err as Error).message}`);
    }
  }
  if (wirklich) {
    protokolliere('info', 'archiv', `Aufgeräumt: ${anzahl} Nachrichten, ${bytes} Bytes.`);
  }
  return { anzahl, bytes };
}

/** Wo das Archiv liegt - für die Ausfuhr und für die Dokumentation. */
export const archivOrdner = ordner;
export const archivPostOrdner = postOrdner;
