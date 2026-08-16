import { BerFehler, liesElement, liesTeile, tlv, type Element } from '../ldap/ber.js';

/**
 * DER - dieselben Bytes wie bei LDAP, nur strenger.
 *
 * ## Warum das hier steht und nicht in ber.ts
 *
 * BER und DER sind dieselbe Regel mit unterschiedlicher Strenge: BER lässt für einen Wert
 * mehrere gültige Schreibweisen zu, DER genau eine. Für LDAP ist das gleichgültig - dort
 * wird gelesen, was ankommt, und der Inhalt ist ein Name oder eine Zahl.
 *
 * Hier ist es das nicht. Über einer Signatur wird gerechnet, und gerechnet wird über
 * BYTES, nicht über deren Bedeutung. Wer denselben Wert auf zwei Arten schreiben kann,
 * kann zwei Bytefolgen bauen, die dasselbe bedeuten und verschieden aussehen - und schon
 * unterschreibt man das eine und zeigt das andere. Deshalb gilt in diesem Modul:
 *
 *   **Was geprüft werden soll, wird nie neu geschrieben, sondern durchgereicht.**
 *
 * Der Aussteller eines Zertifikats etwa wird nie zerlegt und wieder zusammengesetzt, um
 * ihn mit einem anderen zu vergleichen, sondern als Bytefolge kopiert und byteweise
 * verglichen. Das ist nicht Bequemlichkeit, sondern der einzige Weg, bei dem "gleich"
 * auch wirklich gleich heißt.
 *
 * ## Was hier dazukommt
 *
 * ber.ts kann Folge, Menge, Ganzzahl, Zeichenkette. Für X.509 und CMS fehlen: der
 * Objektbezeichner (die Nummer, mit der jedes Verfahren benannt wird), die Bitkette, die
 * beiden Zeitformate - und eine Menge, die richtig sortiert ist. Das Sortieren ist keine
 * Kosmetik: eine unsortierte SET OF ist kein DER, und die Gegenstelle rechnet dann über
 * andere Bytes als wir.
 */

export { BerFehler, liesElement, liesTeile, tlv, type Element };

export const DER = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  UTF8_STRING: 0x0c,
  SEQUENCE: 0x30,
  SET: 0x31,
  PRINTABLE_STRING: 0x13,
  IA5_STRING: 0x16,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
} as const;

/** Kontextspezifisch, zusammengesetzt - `[0]`, `[1]` und so weiter. */
export const ktx = (nummer: number) => 0xa0 | nummer;
/** Kontextspezifisch, einfach - `[0] IMPLICIT OCTET STRING` etwa. */
export const ktxEinfach = (nummer: number) => 0x80 | nummer;

// --- Objektbezeichner ---

/**
 * Schreibt einen Objektbezeichner.
 *
 * Die ersten beiden Zahlen teilen sich ein Byte (40·a + b), alle weiteren stehen als
 * Siebenerpäckchen mit gesetztem obersten Bit als Fortsetzungszeichen. Aus 1.2.840…
 * wird also 2a 86 48…
 */
export function oid(text: string): Buffer {
  const teile = text.split('.').map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 0) throw new BerFehler(`Kein Objektbezeichner: ${text}`);
    return n;
  });
  if (teile.length < 2) throw new BerFehler(`Kein Objektbezeichner: ${text}`);

  const bytes: number[] = [40 * teile[0]! + teile[1]!];
  for (const zahl of teile.slice(2)) {
    const paeckchen: number[] = [zahl & 0x7f];
    let rest = Math.floor(zahl / 128);
    while (rest > 0) {
      paeckchen.unshift((rest & 0x7f) | 0x80);
      rest = Math.floor(rest / 128);
    }
    bytes.push(...paeckchen);
  }
  return tlv(DER.OID, Buffer.from(bytes));
}

/** Liest einen Objektbezeichner in seine Punktschreibweise zurück. */
export function alsOid(inhalt: Buffer): string {
  if (inhalt.length === 0) throw new BerFehler('Leerer Objektbezeichner.');
  const erste = inhalt[0]!;
  const zahlen: number[] = [Math.floor(erste / 40), erste % 40];
  // Die erste Zahl geht nur bis 2; steht dort mehr, gehört der Rest zur zweiten.
  if (zahlen[0]! > 2) {
    zahlen[0] = 2;
    zahlen[1] = erste - 80;
  }

  let wert = 0;
  let angefangen = false;
  for (const byte of inhalt.subarray(1)) {
    wert = wert * 128 + (byte & 0x7f);
    angefangen = true;
    // Über 2^53 rechnet JavaScript nicht mehr genau - ein Bezeichner in dieser
    // Größenordnung ist kein Bezeichner mehr, sondern Unsinn.
    if (wert > Number.MAX_SAFE_INTEGER) throw new BerFehler('Unbrauchbarer Objektbezeichner.');
    if ((byte & 0x80) === 0) {
      zahlen.push(wert);
      wert = 0;
      angefangen = false;
    }
  }
  if (angefangen) throw new BerFehler('Abgeschnittener Objektbezeichner.');
  return zahlen.join('.');
}

// --- Bausteine ---

export function nullwert(): Buffer {
  return tlv(DER.NULL, Buffer.alloc(0));
}

/** Eine Kennung mit Parametern - `AlgorithmIdentifier`, in CMS an jeder Ecke. */
export function verfahren(bezeichner: string, parameter?: Buffer): Buffer {
  return folge(oid(bezeichner), ...(parameter ? [parameter] : []));
}

export function oktette(daten: Buffer): Buffer {
  return tlv(DER.OCTET_STRING, daten);
}

/**
 * Eine Bitkette.
 *
 * Das erste Byte des Inhalts zählt die unbenutzten Bits am Ende. Bei allem, was hier
 * vorkommt - Schlüssel, Unterschriften -, sind das null.
 */
export function bitkette(daten: Buffer): Buffer {
  return tlv(DER.BIT_STRING, Buffer.concat([Buffer.from([0]), daten]));
}

/**
 * Eine ganze Zahl aus rohen Bytes - für Seriennummern.
 *
 * Die Seriennummer eines Zertifikats hat bis zu 20 Bytes und passt in keine Zahl. Sie
 * wird deshalb nie in eine umgerechnet, sondern als Bytefolge weitergereicht.
 */
export function ganzzahlAusBytes(bytes: Buffer): Buffer {
  return tlv(DER.INTEGER, bytes);
}

export function kleineZahl(wert: number): Buffer {
  const bytes: number[] = [];
  let rest = Math.trunc(wert);
  if (rest === 0) bytes.push(0);
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0);
  return tlv(DER.INTEGER, Buffer.from(bytes));
}

export function folge(...teile: Buffer[]): Buffer {
  return tlv(DER.SEQUENCE, Buffer.concat(teile));
}

/**
 * Eine Menge - und zwar sortiert.
 *
 * In DER stehen die Glieder einer SET OF nach ihrer Bytefolge geordnet. Das sieht nach
 * Formsache aus, ist aber genau dort entscheidend, wo es wehtut: Die unterschriebenen
 * Merkmale einer CMS-Signatur SIND eine SET OF, und unterschrieben wird ihre Bytefolge.
 * Wer hier nicht sortiert, unterschreibt etwas anderes, als die Gegenstelle prüft - und
 * das fällt nicht beim eigenen Prüfen auf, sondern erst beim Empfänger.
 */
export function mengeSortiert(...teile: Buffer[]): Buffer {
  const geordnet = [...teile].sort(Buffer.compare);
  return tlv(DER.SET, Buffer.concat(geordnet));
}

/** Eine Menge, deren Reihenfolge vorgegeben ist - etwa beim Kopieren fremder Bytes. */
export function menge(...teile: Buffer[]): Buffer {
  return tlv(DER.SET, Buffer.concat(teile));
}

/** `[n] EXPLICIT` - der Wert steckt vollständig in einer Hülle. */
export function huelle(nummer: number, ...teile: Buffer[]): Buffer {
  return tlv(ktx(nummer), Buffer.concat(teile));
}

// --- Lesen ---

/** Die vollständigen Bytes eines Elements, Kennung und Länge eingeschlossen. */
export function rohBytes(daten: Buffer, ab = 0): Buffer {
  const element = liesElement(daten, ab);
  if (!element) throw new BerFehler('Abgeschnittenes Element.');
  return daten.subarray(ab, ab + element.gesamt);
}

/**
 * Zerlegt einen Puffer in seine Elemente - jedes mit seinen eigenen Bytes dabei.
 *
 * Die rohen Bytes mitzuführen ist der Kern dieses Moduls: Alles, was später verglichen
 * oder unterschrieben wird, greift auf sie zurück statt auf den zerlegten Inhalt.
 */
export interface Stueck extends Element {
  /** Die eigenen Bytes dieses Elements, unverändert aus der Vorlage. */
  roh: Buffer;
}

export function zerlege(inhalt: Buffer): Stueck[] {
  const stuecke: Stueck[] = [];
  let stelle = 0;
  while (stelle < inhalt.length) {
    const element = liesElement(inhalt, stelle);
    if (!element) throw new BerFehler('Abgeschnittenes Element in einer Folge.');
    stuecke.push({ ...element, roh: inhalt.subarray(stelle, stelle + element.gesamt) });
    stelle += element.gesamt;
  }
  return stuecke;
}

/** Zerlegt ein einzelnes Element - mit Prüfung, dass nichts dahinter steht. */
export function zerlegeEines(daten: Buffer): Stueck {
  const stuecke = zerlege(daten);
  if (stuecke.length !== 1) {
    throw new BerFehler(`Erwartet war ein Element, gefunden ${stuecke.length}.`);
  }
  return stuecke[0]!;
}

export function erwarte(stueck: Stueck | undefined, kennung: number, wo: string): Stueck {
  if (!stueck) throw new BerFehler(`${wo}: Es fehlt ein Element.`);
  if (stueck.kennung !== kennung) {
    const soll = kennung.toString(16).padStart(2, '0');
    const ist = stueck.kennung.toString(16).padStart(2, '0');
    throw new BerFehler(`${wo}: Erwartet war 0x${soll}, gefunden 0x${ist}.`);
  }
  return stueck;
}

/** Der Objektbezeichner eines Elements, das einer sein muss. */
export function oidVon(stueck: Stueck | undefined, wo: string): string {
  return alsOid(erwarte(stueck, DER.OID, wo).inhalt);
}

/**
 * Die Kennung eines Elements austauschen, ohne den Inhalt anzurühren.
 *
 * Gebraucht an genau einer Stelle, und die ist der Grund für dieses ganze Modul: Die
 * unterschriebenen Merkmale einer Signatur stehen in der Nachricht als `[0] IMPLICIT`,
 * unterschrieben wurde aber die Fassung mit der Kennung einer SET OF. Ohne diesen
 * Tausch schlägt jede Prüfung fehl - RFC 5652, Abschnitt 5.4 sagt es ausdrücklich.
 */
export function mitKennung(stueck: Stueck, kennung: number): Buffer {
  return tlv(kennung, stueck.inhalt);
}

/**
 * Liest eine Zeitangabe.
 *
 * Zwei Formate, aus historischen Gründen: UTCTime mit zweistelliger Jahreszahl - alles
 * unter 50 meint das 21. Jahrhundert - und GeneralizedTime mit vierstelliger. Wer sich
 * hier vertut, datiert eine Unterschrift um hundert Jahre.
 */
export function alsZeit(stueck: Stueck): Date {
  const text = stueck.inhalt.toString('ascii').trim();
  const teile = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(text);
  if (!teile) throw new BerFehler(`Unlesbare Zeitangabe: ${text}`);

  let jahr = Number(teile[1]);
  if (stueck.kennung === DER.UTC_TIME) jahr += jahr < 50 ? 2000 : 1900;
  return new Date(
    Date.UTC(
      jahr,
      Number(teile[2]) - 1,
      Number(teile[3]),
      Number(teile[4]),
      Number(teile[5]),
      Number(teile[6] ?? 0),
    ),
  );
}

/** Schreibt eine Zeit als UTCTime - so, wie es CMS für den Unterschriftszeitpunkt tut. */
export function zeitAlsUtc(wann: Date): Buffer {
  const zwei = (n: number) => String(n).padStart(2, '0');
  const text =
    zwei(wann.getUTCFullYear() % 100) +
    zwei(wann.getUTCMonth() + 1) +
    zwei(wann.getUTCDate()) +
    zwei(wann.getUTCHours()) +
    zwei(wann.getUTCMinutes()) +
    zwei(wann.getUTCSeconds()) +
    'Z';
  return tlv(DER.UTC_TIME, Buffer.from(text, 'ascii'));
}
