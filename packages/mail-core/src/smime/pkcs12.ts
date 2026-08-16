import crypto from 'node:crypto';
import { B, benenne } from './bezeichner.js';
import { DER, alsOid, erwarte, zerlege, zerlegeEines, type Stueck } from './der.js';

/**
 * PKCS#12 - die Datei, die der Nutzer tatsächlich in der Hand hält (RFC 7292).
 *
 * ## Warum das gebraucht wird
 *
 * Weil niemand ein Zertifikat und einen geheimen Schlüssel als zwei getrennte Dateien
 * bekommt. Was eine Ausgabestelle ausliefert und was Windows beim Ausführen schreibt, ist
 * eine `.p12` oder `.pfx`: beides zusammen in einer Datei, mit einem Kennwort verschlossen.
 * Ohne diesen Leser wäre die ganze S/MIME-Umsetzung praktisch unbenutzbar - man könnte
 * jemandem erklären, er solle die Datei erst mit OpenSSL zerlegen, aber das tut niemand.
 *
 * ## Der Aufbau, in Kürze
 *
 * Eine Zwiebel aus vier Schichten: außen die Datei mit einer Prüfsumme, darin eine Liste
 * von Behältern, jeder davon entweder offen oder verschlüsselt, und darin Beutel - einer
 * mit dem Schlüssel, je einer mit einem Zertifikat.
 *
 * ## Die Schlüsselableitung
 *
 * PKCS#12 bringt eine eigene mit, älter als PBKDF2 und mit ihm nicht verwandt (Anhang B.2
 * der Norm). Sie ist umständlich, sie ist nach heutigem Maß schwach - und sie steckt in
 * jeder Datei, die Windows ausgibt. Wer sie nicht kann, kann die Hälfte aller Dateien
 * nicht lesen, die bei einem Kunden herumliegen. Sie steht deshalb hier, nachgerechnet
 * gegen eine von OpenSSL erzeugte Datei.
 *
 * Neuere Dateien benutzen PBES2 mit PBKDF2, und das kann Node von sich aus.
 */

export class SchluesseldateiFehler extends Error {}

/** Was in der Datei stand. */
export interface Schluesselpaar {
  /** Das Zertifikat, das zum geheimen Schlüssel gehört. */
  zertifikat: Buffer;
  /** Der geheime Schlüssel, als PKCS#8 ohne Kennwort. */
  schluessel: crypto.KeyObject;
  /** Alles Weitere aus der Datei - üblicherweise die Zwischenstellen der Ausgabestelle. */
  kette: Buffer[];
}

// --- Die Schlüsselableitung aus Anhang B.2 ---

/**
 * Das Kennwort als BMPString.
 *
 * PKCS#12 verlangt UTF-16 mit großem Ende und zwei Nullbytes am Schluss. Der Abschluss
 * gehört mit in die Rechnung - wer ihn wegleiert, bekommt für jedes Kennwort einen
 * anderen Schlüssel als jedes andere Programm, und zwar unbemerkt, bis die erste fremde
 * Datei nicht aufgeht.
 */
function alsBmp(kennwort: string): Buffer {
  const bytes = Buffer.alloc(kennwort.length * 2 + 2);
  for (let i = 0; i < kennwort.length; i++) bytes.writeUInt16BE(kennwort.charCodeAt(i), i * 2);
  return bytes;
}

/**
 * Die Ableitung selbst.
 *
 * `zweck` ist 1 für den Schlüssel, 2 für den Anfangswert, 3 für die Prüfsumme - dieselbe
 * Rechnung, drei Ergebnisse. Gerechnet wird mit Zahlen von v Bytes Länge, und die
 * Addition am Ende ist eine gewöhnliche Übertragsaddition über den ganzen Block.
 */
function ableiten(
  kennwort: string,
  salz: Buffer,
  wiederholungen: number,
  zweck: 1 | 2 | 3,
  laenge: number,
  streuName: string,
): Buffer {
  const v = streuName === 'sha512' || streuName === 'sha384' ? 128 : 64;
  const u = crypto.createHash(streuName).digest().length;

  const wiederhole = (was: Buffer, bis: number) => {
    if (was.length === 0) return Buffer.alloc(0);
    const voll = Buffer.alloc(bis);
    for (let i = 0; i < bis; i++) voll[i] = was[i % was.length]!;
    return voll;
  };

  const D = Buffer.alloc(v, zweck);
  const S = wiederhole(salz, Math.ceil(salz.length / v) * v);
  const P = wiederhole(alsBmp(kennwort), Math.ceil(alsBmp(kennwort).length / v) * v);
  let I = Buffer.concat([S, P]);

  const stuecke: Buffer[] = [];
  let bisher = 0;
  while (bisher < laenge) {
    let A = Buffer.concat([D, I]);
    for (let i = 0; i < wiederholungen; i++) A = crypto.createHash(streuName).update(A).digest();
    stuecke.push(A);
    bisher += A.length;
    if (bisher >= laenge) break;

    // B ist A auf v Bytes gestreckt; danach wird jeder Block von I um B+1 erhöht.
    const Bblock = wiederhole(A, v);
    const neu = Buffer.alloc(I.length);
    for (let start = 0; start < I.length; start += v) {
      let uebertrag = 1;
      for (let j = v - 1; j >= 0; j--) {
        const summe = I[start + j]! + Bblock[j]! + uebertrag;
        neu[start + j] = summe & 0xff;
        uebertrag = summe >> 8;
      }
    }
    I = neu;
    void u;
  }
  return Buffer.concat(stuecke).subarray(0, laenge);
}

// --- Entschlüsseln ---

/** Entschlüsselt einen Block nach dem Verfahren, das im Kopf steht. */
function entschluessle(verfahrenStueck: Stueck, geheim: Buffer, kennwort: string): Buffer {
  const teile = zerlege(verfahrenStueck.inhalt);
  const bezeichner = alsOid(erwarte(teile[0], DER.OID, 'Verfahren').inhalt);
  const parameter = teile[1];
  if (!parameter) throw new SchluesseldateiFehler('Dem Verfahren fehlen die Angaben.');

  if (bezeichner === B.pbes2) return pbes2(parameter, geheim, kennwort);

  const alt: Record<string, { name: string; schluesselBytes: number; ivBytes: number }> = {
    [B.pbeSha1Und3Des]: { name: 'des-ede3-cbc', schluesselBytes: 24, ivBytes: 8 },
  };
  const wie = alt[bezeichner];
  if (!wie) {
    /*
     * Der Satz ist wichtiger, als er aussieht. "Unbekanntes Verfahren" schickt jemanden
     * auf die Suche; RC2-40 beim Namen zu nennen sagt ihm, dass die Datei uralt ist und
     * dass ein neuer Export sie löst. RC2 ist in OpenSSL 3 nur noch über den Altbestand
     * erreichbar und in Node gar nicht - hier ist also wirklich Schluss.
     */
    throw new SchluesseldateiFehler(
      `Diese Datei ist mit ${benenne(bezeichner)} verschlüsselt. Dieses Verfahren gilt als überholt und wird hier nicht gelesen - bitte exportieren Sie die Datei neu.`,
    );
  }

  const [salzStueck, rundenStueck] = zerlege(parameter.inhalt);
  const salz = erwarte(salzStueck, DER.OCTET_STRING, 'Salz').inhalt;
  const runden = Number(BigInt('0x' + (rundenStueck?.inhalt.toString('hex') || '01')));
  const schluessel = ableiten(kennwort, salz, runden, 1, wie.schluesselBytes, 'sha1');
  const iv = ableiten(kennwort, salz, runden, 2, wie.ivBytes, 'sha1');

  try {
    const de = crypto.createDecipheriv(wie.name, schluessel, iv);
    return Buffer.concat([de.update(geheim), de.final()]);
  } catch {
    throw new SchluesseldateiFehler('Das Kennwort stimmt nicht.');
  }
}

function pbes2(parameter: Stueck, geheim: Buffer, kennwort: string): Buffer {
  const [kdfStueck, verfahrenStueck] = zerlege(parameter.inhalt);
  const kdf = zerlege(erwarte(kdfStueck, DER.SEQUENCE, 'Ableitung').inhalt);
  if (alsOid(erwarte(kdf[0], DER.OID, 'Ableitung').inhalt) !== B.pbkdf2) {
    throw new SchluesseldateiFehler('Unbekannte Schlüsselableitung.');
  }
  const kdfTeile = zerlege(erwarte(kdf[1], DER.SEQUENCE, 'Ableitungsangaben').inhalt);
  const salz = erwarte(kdfTeile[0], DER.OCTET_STRING, 'Salz').inhalt;
  const runden = Number(BigInt('0x' + erwarte(kdfTeile[1], DER.INTEGER, 'Runden').inhalt.toString('hex')));

  const prfStueck = kdfTeile.find((s) => s.kennung === DER.SEQUENCE);
  const prf = prfStueck ? alsOid(zerlege(prfStueck.inhalt)[0]!.inhalt) : B.hmacSha1;
  const prfName =
    { [B.hmacSha1]: 'sha1', [B.hmacSha224]: 'sha224', [B.hmacSha256]: 'sha256', [B.hmacSha384]: 'sha384', [B.hmacSha512]: 'sha512' }[prf];
  if (!prfName) throw new SchluesseldateiFehler('Unbekanntes Ableitungsverfahren.');

  const chiffre = zerlege(erwarte(verfahrenStueck, DER.SEQUENCE, 'Verschlüsselung').inhalt);
  const chiffreOid = alsOid(erwarte(chiffre[0], DER.OID, 'Verschlüsselung').inhalt);
  const wie: Record<string, { name: string; bytes: number }> = {
    [B.aes128Cbc]: { name: 'aes-128-cbc', bytes: 16 },
    [B.aes192Cbc]: { name: 'aes-192-cbc', bytes: 24 },
    [B.aes256Cbc]: { name: 'aes-256-cbc', bytes: 32 },
    [B.desEde3Cbc]: { name: 'des-ede3-cbc', bytes: 24 },
  };
  const gewaehlt = wie[chiffreOid];
  if (!gewaehlt) {
    throw new SchluesseldateiFehler(`Diese Datei ist mit ${benenne(chiffreOid)} verschlüsselt - das wird hier nicht gelesen.`);
  }

  const iv = erwarte(chiffre[1], DER.OCTET_STRING, 'Anfangswert').inhalt;
  const schluessel = crypto.pbkdf2Sync(kennwort, salz, runden, gewaehlt.bytes, prfName);
  try {
    const de = crypto.createDecipheriv(gewaehlt.name, schluessel, iv);
    return Buffer.concat([de.update(geheim), de.final()]);
  } catch {
    throw new SchluesseldateiFehler('Das Kennwort stimmt nicht.');
  }
}

// --- Die Datei ---

/**
 * Liest eine .p12/.pfx-Datei.
 *
 * Geprüft wird zuerst die Prüfsumme über die ganze Datei. Das ist nicht nur Sorgfalt: Sie
 * ist die einzige Stelle, an der sich ein falsches Kennwort SAUBER feststellen lässt.
 * Ohne sie liefe man in eine Entschlüsselung, deren Ergebnis bei falschem Kennwort
 * einfach Unsinn ist - manchmal mit Fehler, manchmal ohne, je nach Auffüllung. "Das
 * Kennwort stimmt nicht" wäre dann geraten statt gewusst.
 */
export function leseSchluesseldatei(daten: Buffer, kennwort: string): Schluesselpaar[] {
  let pfx: Stueck[];
  try {
    pfx = zerlege(erwarte(zerlegeEines(daten), DER.SEQUENCE, 'Schlüsseldatei').inhalt);
    /*
     * Die Fassungsnummer ganz vorn ist der einzige Anhaltspunkt, an dem sich eine .p12 von
     * etwas anderem unterscheiden lässt - ein Zertifikat beginnt ebenfalls mit einer Folge.
     * Ohne diese Prüfung liefe eine falsche Datei tief in die Zerlegung hinein und käme
     * dort mit einer Meldung heraus, die den Nutzer in die Irre schickt.
     */
    if (pfx[0]?.kennung !== DER.INTEGER || pfx[0].inhalt[0] !== 3) {
      throw new SchluesseldateiFehler('keine');
    }
  } catch {
    throw new SchluesseldateiFehler(
      'Das ist keine Schlüsseldatei. Erwartet wird eine .p12 oder .pfx, wie sie eine Ausgabestelle ausliefert.',
    );
  }

  const aussen = zerlege(erwarte(pfx[1], DER.SEQUENCE, 'Inhalt').inhalt);
  if (alsOid(erwarte(aussen[0], DER.OID, 'Inhaltstyp').inhalt) !== B.daten) {
    throw new SchluesseldateiFehler('Diese Schlüsseldatei ist unterschrieben statt verschlüsselt - das kommt hier nicht vor.');
  }
  const rumpf = erwarte(
    zerlegeEines(erwarte(aussen[1], 0xa0, 'Inhalt').inhalt),
    DER.OCTET_STRING,
    'Inhalt',
  ).inhalt;

  if (pfx[2]) pruefeMarke(pfx[2], rumpf, kennwort);

  const beutel: Stueck[] = [];
  for (const behaelter of zerlege(erwarte(zerlegeEines(rumpf), DER.SEQUENCE, 'Behälter').inhalt)) {
    const teile = zerlege(erwarte(behaelter, DER.SEQUENCE, 'Behälter').inhalt);
    const typ = alsOid(erwarte(teile[0], DER.OID, 'Behältertyp').inhalt);
    const huelle = erwarte(teile[1], 0xa0, 'Behälterinhalt');

    if (typ === B.daten) {
      const roh = erwarte(zerlegeEines(huelle.inhalt), DER.OCTET_STRING, 'Behälterinhalt').inhalt;
      beutel.push(...zerlege(erwarte(zerlegeEines(roh), DER.SEQUENCE, 'Beutel').inhalt));
    } else if (typ === B.verschluesselteDaten) {
      const ed = zerlege(erwarte(zerlegeEines(huelle.inhalt), DER.SEQUENCE, 'Verschlüsselt').inhalt);
      const inhalt = zerlege(erwarte(ed[1], DER.SEQUENCE, 'Verschlüsselt').inhalt);
      const verfahren = erwarte(inhalt[1], DER.SEQUENCE, 'Verfahren');
      const geheim = erwarte(inhalt[2], 0x80, 'Geheimtext').inhalt;
      const klar = entschluessle(verfahren, geheim, kennwort);
      beutel.push(...zerlege(erwarte(zerlegeEines(klar), DER.SEQUENCE, 'Beutel').inhalt));
    }
    // Andere Behältertypen gibt es in dieser Datei nicht; sie werden übergangen.
  }

  const zertifikate: Buffer[] = [];
  const schluessel: crypto.KeyObject[] = [];
  for (const b of beutel) {
    const teile = zerlege(erwarte(b, DER.SEQUENCE, 'Beutel').inhalt);
    const art = alsOid(erwarte(teile[0], DER.OID, 'Beutelart').inhalt);
    const wert = zerlegeEines(erwarte(teile[1], 0xa0, 'Beutelinhalt').inhalt);

    if (art === B.beutelZertifikat) {
      const cb = zerlege(wert.inhalt);
      if (alsOid(erwarte(cb[0], DER.OID, 'Zertifikatsart').inhalt) !== B.zertifikatX509) continue;
      zertifikate.push(erwarte(zerlegeEines(erwarte(cb[1], 0xa0, 'Zertifikat').inhalt), DER.OCTET_STRING, 'Zertifikat').inhalt);
    } else if (art === B.beutelSchluessel) {
      schluessel.push(crypto.createPrivateKey({ key: wert.roh, format: 'der', type: 'pkcs8' }));
    } else if (art === B.beutelSchluesselVerhuellt) {
      const epki = zerlege(wert.inhalt);
      const klar = entschluessle(
        erwarte(epki[0], DER.SEQUENCE, 'Verfahren'),
        erwarte(epki[1], DER.OCTET_STRING, 'Schlüssel').inhalt,
        kennwort,
      );
      schluessel.push(crypto.createPrivateKey({ key: klar, format: 'der', type: 'pkcs8' }));
    }
  }

  if (schluessel.length === 0) {
    throw new SchluesseldateiFehler('In dieser Datei steht kein geheimer Schlüssel.');
  }

  /*
   * Zusammengeführt wird über den öffentlichen Schlüssel, nicht über die Merkmale der
   * Beutel. PKCS#12 sieht dafür `localKeyId` vor, aber nicht jeder Ausgeber setzt es, und
   * wer es setzt, setzt es nicht immer richtig. Der öffentliche Teil eines geheimen
   * Schlüssels dagegen ist rechenbar und gehört zu genau einem Zertifikat.
   */
  const paare: Schluesselpaar[] = [];
  const verbraucht = new Set<Buffer>();
  for (const geheim of schluessel) {
    const meiner = oeffentlicherAnteil(geheim);
    const passend = zertifikate.find((z) => {
      if (verbraucht.has(z)) return false;
      try {
        return oeffentlicherAnteil(new crypto.X509Certificate(z).publicKey) === meiner;
      } catch {
        return false;
      }
    });
    if (!passend) continue;
    verbraucht.add(passend);
    paare.push({ zertifikat: passend, schluessel: geheim, kette: [] });
  }

  if (paare.length === 0) {
    throw new SchluesseldateiFehler(
      'In dieser Datei steht ein Schlüssel, aber kein Zertifikat, das dazu passt.',
    );
  }
  // Alles, was übrig bleibt, ist die Kette der Ausgabestelle - sie gehört zu jedem Paar.
  const rest = zertifikate.filter((z) => !verbraucht.has(z));
  for (const paar of paare) paar.kette = rest;
  return paare;
}

/**
 * Der öffentliche Anteil eines Schlüssels, als vergleichbare Zeichenkette.
 *
 * Ein geheimer Schlüssel enthält seinen öffentlichen Teil; ausgeführt als JWK stehen
 * beide nebeneinander, und die öffentlichen Felder heißen dort bei geheimem und
 * öffentlichem Schlüssel gleich. Damit lässt sich beides vergleichen, ohne den geheimen
 * Teil je in eine Zeichenkette zu schreiben - was der Umweg über PEM täte.
 */
function oeffentlicherAnteil(schluessel: crypto.KeyObject): string {
  const jwk = schluessel.export({ format: 'jwk' }) as Record<string, string | undefined>;
  return JSON.stringify([jwk['kty'], jwk['n'], jwk['e'], jwk['crv'], jwk['x'], jwk['y']]);
}

function pruefeMarke(macData: Stueck, rumpf: Buffer, kennwort: string): void {
  let stimmt: boolean;
  try {
    const teile = zerlege(erwarte(macData, DER.SEQUENCE, 'Prüfsumme').inhalt);
    const info = zerlege(erwarte(teile[0], DER.SEQUENCE, 'Prüfsumme').inhalt);
    const alg = zerlege(erwarte(info[0], DER.SEQUENCE, 'Streuverfahren').inhalt);
    const bezeichner = alsOid(erwarte(alg[0], DER.OID, 'Streuverfahren').inhalt);
    const soll = erwarte(info[1], DER.OCTET_STRING, 'Prüfsumme').inhalt;
    const salz = erwarte(teile[1], DER.OCTET_STRING, 'Salz').inhalt;
    const runden = teile[2] ? Number(BigInt('0x' + teile[2].inhalt.toString('hex'))) : 1;

    /*
     * Hier ist SHA-1 zugelassen, und das ist kein Widerspruch zu der Strenge weiter oben:
     * Diese Prüfsumme beweist niemandem etwas, sie stellt nur fest, ob das Kennwort
     * stimmt. Wer die Datei fälschen kann, kennt das Kennwort ohnehin.
     */
    const streuName =
      { [B.sha1]: 'sha1', [B.sha256]: 'sha256', [B.sha384]: 'sha384', [B.sha512]: 'sha512' }[
        bezeichner
      ];
    if (!streuName) throw new SchluesseldateiFehler('Unbekanntes Prüfverfahren.');

    const laenge = crypto.createHash(streuName).digest().length;
    const schluessel = ableiten(kennwort, salz, runden, 3, laenge, streuName);
    const ist = crypto.createHmac(streuName, schluessel).update(rumpf).digest();
    stimmt = ist.length === soll.length && crypto.timingSafeEqual(ist, soll);
  } catch (err) {
    if (err instanceof SchluesseldateiFehler) throw err;
    throw new SchluesseldateiFehler('Die Schlüsseldatei ist beschädigt.');
  }
  if (!stimmt) throw new SchluesseldateiFehler('Das Kennwort stimmt nicht.');
}
