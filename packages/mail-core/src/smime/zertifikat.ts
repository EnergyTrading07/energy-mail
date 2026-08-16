import crypto from 'node:crypto';
import tls from 'node:tls';
import { B } from './bezeichner.js';
import {
  BerFehler,
  DER,
  alsOid,
  alsZeit,
  erwarte,
  zerlege,
  zerlegeEines,
  type Stueck,
} from './der.js';

/**
 * X.509 - das Zertifikat, das bei S/MIME an die Stelle des PGP-Schlüssels tritt.
 *
 * ## Der Unterschied zu PGP, in einem Absatz
 *
 * Ein PGP-Schlüssel behauptet selbst, zu wem er gehört; wer das glauben will, prüft den
 * Fingerabdruck bei seinem Gegenüber nach. Ein Zertifikat behauptet es auch - aber eine
 * Ausgabestelle hat die Behauptung unterschrieben, und die Unterschrift lässt sich bis zu
 * einer Wurzel zurückverfolgen, der der Rechner ohnehin traut. Das ist der ganze
 * Unterschied, und er ist der Grund, warum S/MIME in Unternehmen läuft und PGP nicht:
 * Niemand muss Fingerabdrücke vergleichen.
 *
 * Der Preis steht in derselben Zeile: Man traut damit der Ausgabestelle. Wer eine Wurzel
 * unterschieben kann, kann Zertifikate auf fremde Namen ausstellen.
 *
 * ## Warum hier selbst zerlegt wird, obwohl Node X509Certificate mitbringt
 *
 * Für das Rechnen wird Node benutzt - Unterschrift prüfen, Aussteller zuordnen, öffentlichen
 * Schlüssel herausholen. Dort steckt OpenSSL dahinter, und daran ist nichts zu verbessern.
 *
 * Gelesen wird trotzdem selbst, und zwar genau ein Feld: die Adressen. Node gibt sie als
 * eine Zeichenkette heraus, in der die Einträge durch Komma getrennt sind - und ein Wert,
 * der selbst ein Komma enthält, macht daraus zwei Einträge. Genau daran hingen mehrere
 * Sicherheitslücken in mehreren Programmen (CVE-2021-44531 in Node selbst). Die Adresse
 * entscheidet hier darüber, ob eine Unterschrift dem Absender zugerechnet wird. Sie aus
 * einer zusammengesetzten Zeichenkette zurückzugewinnen wäre der falsche Weg; sie steht
 * in den Bytes, und dort wird sie geholt.
 */

export class ZertifikatsFehler extends Error {}

export interface Zertifikatsangaben {
  /** SHA-256 über das ganze Zertifikat, ohne Doppelpunkte - die Kennung, mit der es abgelegt wird. */
  fingerabdruck: string;
  /** Der angezeigte Name (CN), sonst die Organisation. */
  name: string;
  /** Alle Mailadressen, die das Zertifikat für sich beansprucht. */
  adressen: string[];
  aussteller: string;
  /** Die Seriennummer in Hexadezimalschreibweise. */
  seriennummer: string;
  giltAb: string;
  giltBis: string;
  /** Ob es eine Ausgabestelle ist - dann gehört es nicht zu einer Person. */
  ausgabestelle: boolean;
  /** Ob es zum Schutz von Mail ausgestellt wurde. */
  fuerMail: boolean;
  /** Ob damit unterschrieben werden darf. */
  darfUnterschreiben: boolean;
  /** Ob damit ein Schlüssel verschlüsselt werden darf - das braucht das Verschlüsseln. */
  darfVerschluesseln: boolean;
  /** Das Verfahren des öffentlichen Schlüssels, für den Befund. */
  schluesselart: string;
}

/** Die Felder, die zum Zuordnen gebraucht werden - als rohe Bytes, nie neu geschrieben. */
export interface Zertifikatsfelder {
  /** `issuer` als vollständiges Element, so wie es im Zertifikat steht. */
  aussteller: Buffer;
  /** `subject`, ebenso. */
  inhaber: Buffer;
  /** `serialNumber` als vollständiges INTEGER-Element. */
  seriennummer: Buffer;
  /** Die Schlüsselkennung aus der Erweiterung, wenn eine da ist. */
  schluesselKennung?: Buffer;
}

interface Erweiterung {
  bezeichner: string;
  kritisch: boolean;
  wert: Buffer;
}

/** Die Bestandteile eines Zertifikats, einmal zerlegt. */
interface Zerlegt {
  felder: Zertifikatsfelder;
  gueltigAb: Date;
  gueltigBis: Date;
  erweiterungen: Erweiterung[];
  inhaberTeile: { typ: string; wert: string }[];
  ausstellerTeile: { typ: string; wert: string }[];
}

/**
 * Zerlegt ein Zertifikat so weit, wie es hier gebraucht wird.
 *
 * Die Reihenfolge der Felder steht in RFC 5280, Abschnitt 4.1. Die Fassung ist optional
 * und steckt in einer `[0]`-Hülle; fehlt sie, ist es ein Zertifikat der ersten Fassung,
 * und dann beginnt es gleich mit der Seriennummer. Wer diesen Fall übergeht, liest die
 * Seriennummer als Fassung und alles Weitere um ein Feld verschoben.
 */
function zerlegeZertifikat(der: Buffer): Zerlegt {
  const ganz = erwarte(zerlegeEines(der), DER.SEQUENCE, 'Zertifikat');
  const [tbsStueck] = zerlege(ganz.inhalt);
  const tbs = erwarte(tbsStueck, DER.SEQUENCE, 'Zertifikatsrumpf');
  const teile = zerlege(tbs.inhalt);

  let i = 0;
  if (teile[0]?.kennung === 0xa0) i = 1;

  const seriennummer = erwarte(teile[i++], DER.INTEGER, 'Seriennummer');
  erwarte(teile[i++], DER.SEQUENCE, 'Unterschriftsverfahren');
  const aussteller = erwarte(teile[i++], DER.SEQUENCE, 'Aussteller');
  const gueltigkeit = erwarte(teile[i++], DER.SEQUENCE, 'Gültigkeit');
  const inhaber = erwarte(teile[i++], DER.SEQUENCE, 'Inhaber');
  erwarte(teile[i++], DER.SEQUENCE, 'Öffentlicher Schlüssel');

  const [ab, bis] = zerlege(gueltigkeit.inhalt);
  if (!ab || !bis) throw new ZertifikatsFehler('Die Gültigkeit fehlt.');

  const erweiterungen: Erweiterung[] = [];
  // Die Erweiterungen stehen in [3]; [1] und [2] sind alte Felder, die niemand mehr setzt.
  const huelle = teile.slice(i).find((s) => s.kennung === 0xa3);
  if (huelle) {
    const liste = erwarte(zerlegeEines(huelle.inhalt), DER.SEQUENCE, 'Erweiterungen');
    for (const eintrag of zerlege(liste.inhalt)) {
      const stuecke = zerlege(erwarte(eintrag, DER.SEQUENCE, 'Erweiterung').inhalt);
      const bezeichner = alsOid(erwarte(stuecke[0], DER.OID, 'Erweiterungskennung').inhalt);
      const kritisch = stuecke[1]?.kennung === DER.BOOLEAN && stuecke[1].inhalt[0] !== 0;
      const wert = stuecke[kritisch || stuecke[1]?.kennung === DER.BOOLEAN ? 2 : 1];
      if (wert) {
        erweiterungen.push({
          bezeichner,
          kritisch,
          wert: erwarte(wert, DER.OCTET_STRING, 'Erweiterungsinhalt').inhalt,
        });
      }
    }
  }

  return {
    felder: {
      aussteller: aussteller.roh,
      inhaber: inhaber.roh,
      seriennummer: seriennummer.roh,
      schluesselKennung: erweiterungen.find((e) => e.bezeichner === '2.5.29.14')
        ? zerlegeEines(erweiterungen.find((e) => e.bezeichner === '2.5.29.14')!.wert).inhalt
        : undefined,
    },
    gueltigAb: alsZeit(ab),
    gueltigBis: alsZeit(bis),
    erweiterungen,
    inhaberTeile: leseName(inhaber),
    ausstellerTeile: leseName(aussteller),
  };
}

/** Zerlegt einen Namen (RDNSequence) in seine Bestandteile. */
function leseName(name: Stueck): { typ: string; wert: string }[] {
  const teile: { typ: string; wert: string }[] = [];
  for (const rdn of zerlege(name.inhalt)) {
    if (rdn.kennung !== DER.SET) continue;
    for (const paar of zerlege(rdn.inhalt)) {
      const [typ, wert] = zerlege(paar.inhalt);
      if (!typ || !wert || typ.kennung !== DER.OID) continue;
      teile.push({ typ: alsOid(typ.inhalt), wert: wert.inhalt.toString('utf8') });
    }
  }
  return teile;
}

/**
 * Die Mailadressen eines Zertifikats.
 *
 * Zwei Quellen, und die Reihenfolge ist nicht beliebig. Maßgeblich ist der alternative
 * Name (`rfc822Name`) - RFC 8551 sagt das ausdrücklich. Der Eintrag `emailAddress` im
 * Namen des Inhabers ist die alte Art; er wird nur dann noch berücksichtigt, wenn es gar
 * keinen alternativen Namen gibt. Beides zu vermischen wäre falsch herum: Ein Angreifer,
 * der eine Ausgabestelle dazu bringt, ihm einen beliebigen `emailAddress`-Eintrag in den
 * Namen zu schreiben, könnte sonst eine fremde Adresse für sich beanspruchen, obwohl der
 * verbindliche alternative Name etwas anderes sagt.
 */
function leseAdressen(zerlegt: Zerlegt): string[] {
  const san = zerlegt.erweiterungen.find((e) => e.bezeichner === '2.5.29.17');
  if (san) {
    const adressen: string[] = [];
    try {
      const namen = erwarte(zerlegeEines(san.wert), DER.SEQUENCE, 'Alternative Namen');
      for (const eintrag of zerlege(namen.inhalt)) {
        // rfc822Name ist [1] IMPLICIT IA5String - einfach, nicht zusammengesetzt.
        if (eintrag.kennung === 0x81) {
          const adresse = eintrag.inhalt.toString('ascii').trim().toLowerCase();
          if (adresse && !adressen.includes(adresse)) adressen.push(adresse);
        }
      }
    } catch {
      // Eine unlesbare Erweiterung bedeutet: keine Adresse. Nicht: alle Adressen.
    }
    if (adressen.length > 0) return adressen;
    // Ein alternativer Name ohne Mailadresse ist eine Aussage - dann gilt sie.
    return [];
  }

  return zerlegt.inhaberTeile
    .filter((t) => t.typ === '1.2.840.113549.1.9.1')
    .map((t) => t.wert.trim().toLowerCase())
    .filter(Boolean);
}

/** Ein Bit aus der Erweiterung "Schlüsselverwendung" - siehe RFC 5280 §4.2.1.3. */
function hatVerwendung(zerlegt: Zerlegt, bit: number): boolean {
  const ku = zerlegt.erweiterungen.find((e) => e.bezeichner === '2.5.29.15');
  // Fehlt die Erweiterung, ist jede Verwendung erlaubt - so steht es in der Norm.
  if (!ku) return true;
  try {
    const kette = erwarte(zerlegeEines(ku.wert), DER.BIT_STRING, 'Schlüsselverwendung');
    const bytes = kette.inhalt.subarray(1);
    const byte = bytes[bit >> 3];
    return byte !== undefined && (byte & (0x80 >> bit % 8)) !== 0;
  } catch {
    return false;
  }
}

export function beschreibeZertifikat(der: Buffer): Zertifikatsangaben {
  const zerlegt = zerlegeZertifikat(der);
  const x509 = new crypto.X509Certificate(der);

  const eku = zerlegt.erweiterungen.find((e) => e.bezeichner === '2.5.29.37');
  let zwecke: string[] = [];
  if (eku) {
    try {
      const liste = erwarte(zerlegeEines(eku.wert), DER.SEQUENCE, 'Verwendungszweck');
      zwecke = zerlege(liste.inhalt).map((s) => alsOid(s.inhalt));
    } catch {
      zwecke = [];
    }
  }

  const cn = zerlegt.inhaberTeile.find((t) => t.typ === '2.5.4.3')?.wert;
  const org = zerlegt.inhaberTeile.find((t) => t.typ === '2.5.4.10')?.wert;
  const adressen = leseAdressen(zerlegt);

  return {
    fingerabdruck: x509.fingerprint256.replace(/:/g, ''),
    name: cn || org || adressen[0] || '(ohne Namen)',
    adressen,
    aussteller:
      zerlegt.ausstellerTeile.find((t) => t.typ === '2.5.4.3')?.wert ||
      zerlegt.ausstellerTeile.find((t) => t.typ === '2.5.4.10')?.wert ||
      '(unbekannt)',
    seriennummer: zerlegt.felder.seriennummer.subarray(2).toString('hex').toUpperCase(),
    giltAb: zerlegt.gueltigAb.toISOString(),
    giltBis: zerlegt.gueltigBis.toISOString(),
    ausgabestelle: x509.ca,
    // Ohne die Erweiterung gilt kein Zweck als ausgeschlossen; "alle" heißt genau das.
    fuerMail:
      zwecke.length === 0 || zwecke.includes(B.zweckMailschutz) || zwecke.includes(B.zweckAlle),
    darfUnterschreiben: hatVerwendung(zerlegt, 0),
    darfVerschluesseln: hatVerwendung(zerlegt, 2),
    schluesselart: x509.publicKey.asymmetricKeyType ?? 'unbekannt',
  };
}

export function felderVon(der: Buffer): Zertifikatsfelder {
  return zerlegeZertifikat(der).felder;
}

/**
 * Ob ein Zertifikat zu einer Adresse gehört.
 *
 * Verglichen wird die Adresse, nicht der Name - Namen sind frei wählbar und beweisen
 * nichts. Dieselbe Regel wie bei PGP, und aus demselben Grund.
 */
export function gehoertZu(angaben: Zertifikatsangaben, adresse: string | undefined): boolean {
  const wer = adresse?.trim().toLowerCase();
  if (!wer) return false;
  return angaben.adressen.includes(wer);
}

// --- Die Kette ---

export type Kettenbefund =
  /** Bis zu einer Wurzel zurückverfolgt, der dieser Rechner traut. */
  | { lage: 'vertraut'; ueber: string[] }
  /** Die Kette geht auf, aber die Wurzel steht in keinem Speicher. */
  | { lage: 'wurzel-unbekannt'; ueber: string[]; wurzel: string }
  /** Irgendwo in der Kette stimmt eine Unterschrift nicht. */
  | { lage: 'gebrochen'; grund: string }
  /** Etwas in der Kette ist abgelaufen oder noch nicht gültig. */
  | { lage: 'zeitlich-ungueltig'; grund: string };

let wurzelSpeicher: crypto.X509Certificate[] | null = null;

/**
 * Die Wurzeln, denen geglaubt wird.
 *
 * Dieselben, mit denen auch die Verbindung zum Postfach geprüft wird - siehe
 * zertifikate.ts. In einem Unternehmen ist das die entscheidende Zeile: die eigene
 * Ausgabestelle steht im Windows-Speicher, und nur weil er hier mitgelesen wird, gilt
 * das firmeneigene Zertifikat auch in diesem Programm.
 *
 * Einmal gebaut und dann behalten: Es sind rund dreihundert, und sie für jede Nachricht
 * neu einzulesen wäre in einem Posteingang mit vielen unterschriebenen Nachrichten
 * deutlich zu spüren.
 */
function wurzeln(): crypto.X509Certificate[] {
  if (wurzelSpeicher) return wurzelSpeicher;
  const gesammelt: crypto.X509Certificate[] = [];
  const gesehen = new Set<string>();
  for (const art of ['system', 'bundled'] as const) {
    let liste: string[] = [];
    try {
      liste = typeof tls.getCACertificates === 'function' ? [...tls.getCACertificates(art)] : [];
    } catch {
      liste = [];
    }
    for (const pem of liste) {
      try {
        const zert = new crypto.X509Certificate(pem);
        if (gesehen.has(zert.fingerprint256)) continue;
        gesehen.add(zert.fingerprint256);
        gesammelt.push(zert);
      } catch {
        // Ein unlesbarer Eintrag im Speicher ist kein Grund, alle anderen fallen zu lassen.
      }
    }
  }
  return (wurzelSpeicher = gesammelt);
}

/** Nur für die Prüfung: den Speicher vergessen, damit eigene Wurzeln gesetzt werden können. */
export function vergissWurzeln(): void {
  wurzelSpeicher = null;
}

/**
 * Verfolgt ein Zertifikat bis zu einer Wurzel zurück.
 *
 * `zusaetzlich` sind die Zertifikate, die in der Nachricht selbst mitgeschickt wurden -
 * bei S/MIME ist das der übliche Weg, die Zwischenstellen mitzuliefern.
 *
 * `jetzt` wird hereingereicht statt genommen. Eine Prüfung, die von der Uhr des Rechners
 * abhängt, lässt sich nicht wiederholbar prüfen, und "gestern ging es noch" ist der
 * schlechteste Ausgang für eine Sicherheitsfunktion.
 */
export function pruefeKette(
  zertifikat: Buffer,
  zusaetzlich: readonly Buffer[],
  jetzt: Date,
  eigeneWurzeln?: readonly crypto.X509Certificate[],
): Kettenbefund {
  const anker = eigeneWurzeln ?? wurzeln();
  const zwischen: crypto.X509Certificate[] = [];
  for (const der of zusaetzlich) {
    try {
      zwischen.push(new crypto.X509Certificate(der));
    } catch {
      // Ein beschädigtes Beipack macht die Nachricht nicht ungültig.
    }
  }

  let aktuell: crypto.X509Certificate;
  try {
    aktuell = new crypto.X509Certificate(zertifikat);
  } catch (err) {
    return { lage: 'gebrochen', grund: (err as Error).message };
  }

  const ueber: string[] = [];
  const gesehen = new Set<string>([aktuell.fingerprint256]);

  // Mehr als zehn Stufen hat keine echte Kette; die Grenze verhindert einen Kreis aus
  // Zertifikaten, die sich gegenseitig ausstellen.
  for (let stufe = 0; stufe < 10; stufe++) {
    if (new Date(aktuell.validFrom) > jetzt) {
      return { lage: 'zeitlich-ungueltig', grund: `„${kurz(aktuell)}“ gilt erst später.` };
    }
    if (new Date(aktuell.validTo) < jetzt) {
      return { lage: 'zeitlich-ungueltig', grund: `„${kurz(aktuell)}“ ist abgelaufen.` };
    }

    /*
     * Eine Wurzel zuerst suchen, und zwar bevor nach einer Zwischenstelle gesucht wird.
     * Andersherum liefe die Kette an einer selbst mitgeschickten Kopie der Wurzel vorbei
     * weiter und käme nie an - und schlimmer: Ein Absender könnte eine eigene "Wurzel"
     * beilegen und die Kette damit bei sich selbst enden lassen.
     */
    const wurzel = anker.find((w) => passtAls(aktuell, w, jetzt));
    if (wurzel) {
      ueber.push(kurz(wurzel));
      return { lage: 'vertraut', ueber };
    }

    const naechste = zwischen.find(
      (z) => !gesehen.has(z.fingerprint256) && passtAls(aktuell, z, jetzt),
    );
    if (!naechste) {
      return { lage: 'wurzel-unbekannt', ueber, wurzel: aktuell.issuer.split('\n').join(', ') };
    }
    gesehen.add(naechste.fingerprint256);
    ueber.push(kurz(naechste));
    aktuell = naechste;
  }
  return { lage: 'gebrochen', grund: 'Die Kette ist zu lang.' };
}

/**
 * Ob `moeglich` der Aussteller von `kind` ist - Name UND Unterschrift.
 *
 * Beides ist nötig und keines allein reicht. Der Name allein sagt nur, wer es behauptet;
 * die Unterschrift allein liefe auf ein Durchprobieren aller dreihundert Wurzeln hinaus.
 * `checkIssued` prüft dabei mehr als die Namensgleichheit - unter anderem, ob die
 * Schlüsselkennungen zusammenpassen.
 */
function passtAls(
  kind: crypto.X509Certificate,
  moeglich: crypto.X509Certificate,
  jetzt: Date,
): boolean {
  try {
    if (!moeglich.ca) return false;
    if (new Date(moeglich.validFrom) > jetzt || new Date(moeglich.validTo) < jetzt) return false;
    if (!kind.checkIssued(moeglich)) return false;
    return kind.verify(moeglich.publicKey);
  } catch {
    return false;
  }
}

function kurz(zert: crypto.X509Certificate): string {
  const cn = /(?:^|\n)CN=(.*)/.exec(zert.subject)?.[1];
  return (cn ?? zert.subject.split('\n')[0] ?? '').trim();
}

/** Liest ein Zertifikat aus PEM oder DER - was der Nutzer eben hat. */
export function leseZertifikat(daten: Buffer | string): Buffer {
  const roh = typeof daten === 'string' ? Buffer.from(daten, 'utf8') : daten;
  const text = roh.subarray(0, 64).toString('latin1');
  if (text.includes('-----BEGIN')) {
    const treffer = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(
      roh.toString('utf8'),
    );
    if (!treffer) throw new ZertifikatsFehler('In dieser Datei steht kein Zertifikat.');
    return Buffer.from(treffer[1]!.replace(/\s+/g, ''), 'base64');
  }
  try {
    // Wenn Node es lesen kann, ist es eines - und wir bekommen die aufgeräumten Bytes.
    return Buffer.from(new crypto.X509Certificate(roh).raw);
  } catch (err) {
    if (err instanceof BerFehler) throw new ZertifikatsFehler(err.message);
    throw new ZertifikatsFehler('Diese Datei ist kein Zertifikat.');
  }
}
