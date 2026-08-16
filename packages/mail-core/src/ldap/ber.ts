/**
 * BER - die Bytefolge, in der LDAP spricht.
 *
 * ## Was das ist
 *
 * LDAP schickt keine Zeichenketten und kein JSON, sondern ASN.1 in der Basic Encoding
 * Rule: Jeder Wert ist ein Dreiklang aus Kennung, Länge und Inhalt, und Verschachtelung
 * entsteht dadurch, dass der Inhalt wieder aus solchen Dreiklängen besteht.
 *
 *     30 09   SEQUENCE, 9 Bytes Inhalt
 *        02 01 01        INTEGER 1
 *        04 04 61 6e 6e 61   OCTET STRING "anna"
 *
 * Mehr ist es nicht. Die ganze Datei bildet genau diesen Dreiklang ab, in beide
 * Richtungen.
 *
 * ## Warum selbst gebaut
 *
 * Dieselbe Abwägung wie beim QR-Bild: Es kommt nichts von außen herein außer Bytes, es
 * geht nichts hinaus außer Bytes, und die Regel steht in X.690. Dem gegenüber stünde eine
 * Abhängigkeit, die in einer Anwendung landet, die sich selbst aktualisiert - und die
 * gängige LDAP-Bibliothek für Node bringt ein Vielfaches dessen mit, was hier gebraucht
 * wird: Server, Schema, Änderungsoperationen. Gebraucht werden zwei Vorgänge, Anmelden
 * und Suchen, und beide nur lesend.
 *
 * ## Wo hier ausdrücklich streng gerechnet wird
 *
 * Beim LESEN. Die Bytes kommen von einem Verzeichnisdienst, den ein Kunde eingerichtet
 * hat, und ein Leser, der einer Längenangabe blind folgt, liest über den Puffer hinaus
 * oder dreht sich im Kreis. Jede Längenangabe wird deshalb gegen das geprüft, was
 * tatsächlich da ist.
 */

// --- Kennungen ---

export const KENNUNG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  ENUMERATED: 0x0a,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

/** Eine Kennung der Klasse "anwendungsspezifisch" - so heißen die LDAP-Vorgänge. */
export function anwendung(nummer: number, zusammengesetzt = true): number {
  return 0x40 | (zusammengesetzt ? 0x20 : 0) | nummer;
}

/** Eine Kennung der Klasse "kontextspezifisch" - so heißen die Zweige einer Auswahl. */
export function kontext(nummer: number, zusammengesetzt = true): number {
  return 0x80 | (zusammengesetzt ? 0x20 : 0) | nummer;
}

// --- Schreiben ---

/**
 * Die Längenangabe.
 *
 * Bis 127 ein einzelnes Byte. Darüber ein Byte, das sagt, wie viele Längenbytes folgen -
 * und darin steckt die Falle, die man beim Lesen abfangen muss: Ein Verzeichnis, das
 * antwortet, kann hier vier Bytes schicken und damit eine Länge von vier Milliarden
 * behaupten.
 */
function laenge(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  let rest = n;
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/** Kennung, Länge, Inhalt - der ganze Aufbau in einer Zeile. */
export function tlv(kennung: number, inhalt: Buffer | Buffer[]): Buffer {
  const daten = Array.isArray(inhalt) ? Buffer.concat(inhalt) : inhalt;
  return Buffer.concat([Buffer.from([kennung]), laenge(daten.length), daten]);
}

/**
 * Eine ganze Zahl.
 *
 * Als Zweierkomplement mit möglichst wenigen Bytes, und das führende Bit darf nicht
 * gesetzt sein, wenn die Zahl positiv ist - sonst läse die Gegenseite eine negative. Bei
 * LDAP sind das Nachrichtennummern und Grenzwerte, also nie besonders groß.
 */
export function ganzzahl(wert: number, kennung: number = KENNUNG.INTEGER): Buffer {
  const bytes: number[] = [];
  let rest = Math.trunc(wert);
  if (rest === 0) bytes.push(0);
  while (rest > 0) {
    bytes.unshift(rest & 0xff);
    rest = Math.floor(rest / 256);
  }
  if ((bytes[0] ?? 0) & 0x80) bytes.unshift(0);
  return tlv(kennung, Buffer.from(bytes));
}

export function aufzaehlung(wert: number): Buffer {
  return ganzzahl(wert, KENNUNG.ENUMERATED);
}

export function zeichen(wert: string, kennung: number = KENNUNG.OCTET_STRING): Buffer {
  return tlv(kennung, Buffer.from(wert, 'utf8'));
}

export function wahrheit(wert: boolean): Buffer {
  return tlv(KENNUNG.BOOLEAN, Buffer.from([wert ? 0xff : 0x00]));
}

export function folge(...teile: Buffer[]): Buffer {
  return tlv(KENNUNG.SEQUENCE, teile);
}

export function menge(...teile: Buffer[]): Buffer {
  return tlv(KENNUNG.SET, teile);
}

// --- Lesen ---

export interface Element {
  kennung: number;
  inhalt: Buffer;
  /** Wie viele Bytes dieses Element im Ganzen einnimmt - Kennung und Länge mitgerechnet. */
  gesamt: number;
}

export class BerFehler extends Error {}

/**
 * Liest ein Element ab einer Stelle - oder `null`, wenn noch nicht genug da ist.
 *
 * `null` und nicht ein Fehler: Über einen Socket kommen Bytes stückweise an, und ein halb
 * eingetroffenes Element ist der Normalfall und kein Schaden. Erst wenn die Bytes da sind
 * und trotzdem nicht zusammenpassen, ist es ein Fehler.
 */
export function liesElement(daten: Buffer, ab = 0): Element | null {
  if (daten.length < ab + 2) return null;
  const kennung = daten[ab]!;
  const ersteLaenge = daten[ab + 1]!;

  let inhaltAb = ab + 2;
  let inhaltLaenge = ersteLaenge;

  if (ersteLaenge & 0x80) {
    const anzahl = ersteLaenge & 0x7f;
    /*
     * Die unbestimmte Länge (0x80) gibt es in BER, in LDAP aber nicht - dort ist immer
     * DER-nah kodiert. Sie hier zuzulassen hieße, auf ein Ende-Zeichen zu warten, das nie
     * kommt.
     */
    if (anzahl === 0) throw new BerFehler('Unbestimmte Länge wird nicht unterstützt.');
    /*
     * Mehr als vier Längenbytes wären über vier Milliarden - das ist keine Antwort mehr,
     * sondern ein Fehler oder ein Angriff. Hier abzubrechen ist billiger als ein Puffer,
     * auf den nie genug Bytes folgen.
     */
    if (anzahl > 4) throw new BerFehler(`Unbrauchbare Längenangabe (${anzahl} Bytes).`);
    if (daten.length < ab + 2 + anzahl) return null;
    inhaltLaenge = 0;
    for (let i = 0; i < anzahl; i++) inhaltLaenge = inhaltLaenge * 256 + daten[ab + 2 + i]!;
    inhaltAb = ab + 2 + anzahl;
  }

  if (daten.length < inhaltAb + inhaltLaenge) return null;
  return {
    kennung,
    inhalt: daten.subarray(inhaltAb, inhaltAb + inhaltLaenge),
    gesamt: inhaltAb - ab + inhaltLaenge,
  };
}

/** Zerlegt den Inhalt eines zusammengesetzten Elements in seine Bestandteile. */
export function liesTeile(inhalt: Buffer): Element[] {
  const teile: Element[] = [];
  let stelle = 0;
  while (stelle < inhalt.length) {
    const element = liesElement(inhalt, stelle);
    /*
     * Hier ist `null` sehr wohl ein Fehler: Der Inhalt liegt vollständig vor, und wenn
     * darin ein Element nicht aufgeht, ist die Antwort beschädigt. Ohne diesen Wurf
     * liefe die Schleife ewig weiter, ohne voranzukommen.
     */
    if (!element) throw new BerFehler('Abgeschnittenes Element in einer Folge.');
    teile.push(element);
    stelle += element.gesamt;
  }
  return teile;
}

export function alsGanzzahl(inhalt: Buffer): number {
  let wert = 0;
  for (const byte of inhalt) wert = wert * 256 + byte;
  return wert;
}

export function alsText(inhalt: Buffer): string {
  return inhalt.toString('utf8');
}
