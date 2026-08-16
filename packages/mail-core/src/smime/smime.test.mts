import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DER,
  alsOid,
  alsZeit,
  ktxEinfach,
  mengeSortiert,
  mitKennung,
  oid,
  zerlege,
  zerlegeEines,
  type Stueck,
} from './der.js';
import { B, streuNameVon } from './bezeichner.js';
import {
  baueSignierteDaten,
  baueUmschlag,
  besteVerschluesselung,
  empfaengerPasst,
  gehoertZuZertifikat,
  leseSignierteDaten,
  leseUmschlag,
  oeffneUmschlag,
  pruefeUnterzeichner,
} from './cms.js';
import { beschreibeZertifikat, felderVon, pruefeKette } from './zertifikat.js';
import { beurteileSmime } from './beurteilung.js';
import { leseSchluesseldatei } from './pkcs12.js';
import { alsBytes, baueSigniertePost, baueSigniertenTeil, erkenneSmime } from './nachricht.js';
import * as P from './pruefdaten/daten.mjs';

/**
 * S/MIME - Zertifikate, CMS, Schluesseldateien.
 *
 * ## Wie sich so etwas ueberhaupt pruefen laesst
 *
 * Genauso wenig wie bei LDAP gegen sich selbst. Eine eigene CMS-Umsetzung, die ihre
 * eigenen Bytes wieder einliest, trifft beim Schreiben dieselben Annahmen wie beim Lesen -
 * und ein Outlook, das die Norm kennt, verstuende sie trotzdem nicht. Die Beweislast
 * steht deshalb auf vier Beinen:
 *
 *  1. **Fremde Bytes lesen.** Alles unter pruefdaten/ hat OpenSSL erzeugt: Zertifikate,
 *     unterschriebene Nachrichten, verschluesselte, Schluesseldateien in zwei Bauarten.
 *     Was hier gelesen wird, hat also niemand aus diesem Programm geschrieben.
 *  2. **Eigene Bytes von OpenSSL lesen lassen.** Ganz unten steht die Gegenprobe: Unsere
 *     Unterschrift wird von `openssl cms -verify` geprueft, unser Umschlag von
 *     `openssl cms -decrypt` geoeffnet. Sie laeuft nur, wo OpenSSL vorhanden ist - auf
 *     dem Entwicklungsrechner also, in einer nackten CI nicht -, und sagt es sonst.
 *  3. **Den Aufbau gegen die Norm zaehlen.** Was wir schreiben, wird mit einem eigenen
 *     Leser Feld fuer Feld gegen RFC 5652 gehalten. Ein Verfahren, das ein Feld an der
 *     falschen Stelle hat, faellt nicht auf - es wird von der Gegenstelle nur anders
 *     gelesen.
 *  4. **Beweisen, was NICHT durchgeht.** Der groesste Teil dessen, was hier steht, prueft
 *     Ablehnungen: verfaelschter Inhalt, vertauschte Unterschrift, unbekannte Wurzel,
 *     eine Adresse, die nur im falschen Feld steht. Eine Signaturpruefung, die nie nein
 *     sagt, sagt auch nie etwas.
 */

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

const b = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64');
const caZert = b(P.caZertifikat);
const annaZert = b(P.annaZertifikat);
const bertZert = b(P.bertZertifikat);
const zwiegesichtZert = b(P.zwiegesichtZertifikat);
const serverZert = b(P.serverZertifikat);
const annaKey = crypto.createPrivateKey({ key: b(P.annaSchluessel), format: 'der', type: 'pkcs8' });
const bertKey = crypto.createPrivateKey({ key: b(P.bertSchluessel), format: 'der', type: 'pkcs8' });
const wurzeln = [new crypto.X509Certificate(caZert)];
/** Ein fester Zeitpunkt - eine Pruefung, die von der Uhr abhaengt, ist keine. */
const JETZT = new Date('2030-06-01T12:00:00Z');
const alsRoh = (text: string) => Buffer.from(text.replace(/\r?\n/g, '\r\n'), 'utf8');

console.log('\nDER und Objektbezeichner');

await pruefe('ein Objektbezeichner bekommt die Bytes, die in der Norm stehen', () => {
  // 1.2.840.113549.1.7.2 (signedData) - dieselbe Folge steht in jeder CMS-Nachricht.
  assert.equal(oid(B.signierteDaten).toString('hex'), '06092a864886f70d010702');
  // Und einer aus dem anderen Zweig, mit einer ersten Zahl von 2 und einer grossen zweiten.
  assert.equal(oid(B.sha256).toString('hex'), '06096086480165030402 01'.replace(/\s/g, ''));
});

await pruefe('Objektbezeichner gehen hin und zurueck', () => {
  for (const bezeichner of Object.values(B)) {
    assert.equal(alsOid(zerlegeEines(oid(bezeichner)).inhalt), bezeichner, bezeichner);
  }
});

await pruefe('die erste Zahl eines Bezeichners wird richtig zurueckgerechnet', () => {
  // Die ersten beiden teilen sich ein Byte als 40a+b - bei a=2 laeuft b ueber 40 hinaus.
  assert.equal(alsOid(Buffer.from([0x60])), '2.16'); // 96 = 40*2 + 16
  assert.equal(alsOid(Buffer.from([0x2a])), '1.2'); // 42 = 40*1 + 2
});

await pruefe('eine Menge wird in DER sortiert', () => {
  const menge = mengeSortiert(
    Buffer.from([0x04, 0x01, 0x63]),
    Buffer.from([0x04, 0x01, 0x61]),
    Buffer.from([0x04, 0x01, 0x62]),
  );
  assert.equal(menge.toString('hex'), '3109040161040162040163');
});

await pruefe('die Jahrhundertregel von UTCTime stimmt', () => {
  const zeit = (text: string): Stueck => zerlegeEines(
    Buffer.concat([Buffer.from([DER.UTC_TIME, text.length]), Buffer.from(text, 'ascii')]),
  );
  // Unter 50 heisst 20xx, ab 50 heisst 19xx - RFC 5280 §4.1.2.5.1.
  assert.equal(alsZeit(zeit('490101000000Z')).getUTCFullYear(), 2049);
  assert.equal(alsZeit(zeit('500101000000Z')).getUTCFullYear(), 1950);
});

await pruefe('eine Kennung laesst sich tauschen, ohne den Inhalt zu beruehren', () => {
  const menge = mengeSortiert(Buffer.from([0x04, 0x01, 0x61]));
  const alsHuelle = mitKennung(zerlegeEines(menge), 0xa0);
  assert.equal(alsHuelle[0], 0xa0);
  assert.equal(alsHuelle.subarray(1).toString('hex'), menge.subarray(1).toString('hex'));
});

console.log('\nZertifikate');

await pruefe('ein Zertifikat wird richtig gelesen', () => {
  const angaben = beschreibeZertifikat(annaZert);
  assert.deepEqual(angaben.adressen, ['anna@pruefung.example']);
  assert.equal(angaben.aussteller, 'Energy Mail Pruef-Wurzel');
  assert.equal(angaben.ausgabestelle, false);
  assert.equal(angaben.fuerMail, true);
  assert.equal(angaben.darfUnterschreiben, true);
  assert.equal(angaben.darfVerschluesseln, true);
  assert.equal(angaben.schluesselart, 'rsa');
  assert.equal(angaben.fingerabdruck.length, 64);
});

await pruefe('die Wurzel weist sich als Ausgabestelle aus', () => {
  assert.equal(beschreibeZertifikat(caZert).ausgabestelle, true);
});

/*
 * Der Kern der Adressfrage. In zwiegesicht.crt steht chef@ im Namen des Inhabers und
 * praktikant@ im alternativen Namen. RFC 8551 §3 sagt: Der alternative Name gilt. Wer
 * beide zusammenwirft, laesst sich mit diesem Zertifikat eine Unterschrift als die des
 * Chefs ausweisen - und das Zertifikat dafuer bekommt man voellig regulaer.
 */
await pruefe('bei zwei Adressfeldern gilt der alternative Name - und nur er', () => {
  const angaben = beschreibeZertifikat(zwiegesichtZert);
  assert.deepEqual(angaben.adressen, ['praktikant@pruefung.example']);
  assert.ok(!angaben.adressen.includes('chef@pruefung.example'));
});

await pruefe('ein Serverzertifikat gilt nicht als Mailzertifikat', () => {
  const angaben = beschreibeZertifikat(serverZert);
  // Die Adresse steht drin - der Verwendungszweck aber nicht.
  assert.deepEqual(angaben.adressen, ['anna@pruefung.example']);
  assert.equal(angaben.fuerMail, false);
});

await pruefe('eine Kette bis zu einer bekannten Wurzel traegt', () => {
  const befund = pruefeKette(annaZert, [caZert], JETZT, wurzeln);
  assert.equal(befund.lage, 'vertraut');
});

await pruefe('ohne die Wurzel bleibt die Kette offen', () => {
  const befund = pruefeKette(annaZert, [], JETZT, []);
  assert.equal(befund.lage, 'wurzel-unbekannt');
});

/*
 * Der Angriff, gegen den die Reihenfolge in pruefeKette() gebaut ist: Ein Absender legt
 * seine eigene "Wurzel" bei und laesst die Kette damit bei sich selbst enden. Gesucht
 * wird deshalb immer ZUERST im Speicher der Wurzeln und erst danach im Beipack.
 */
await pruefe('eine selbst mitgeschickte Wurzel schafft kein Vertrauen', () => {
  const befund = pruefeKette(annaZert, [caZert], JETZT, []);
  assert.equal(befund.lage, 'wurzel-unbekannt');
});

await pruefe('ausserhalb der Gueltigkeit traegt sie nicht', () => {
  const befund = pruefeKette(annaZert, [caZert], new Date('2000-01-01T00:00:00Z'), wurzeln);
  assert.equal(befund.lage, 'zeitlich-ungueltig');
});

await pruefe('ein verfaelschtes Zertifikat bricht die Kette', () => {
  const kaputt = Buffer.from(annaZert);
  // In den Rumpf hinein, nicht in die Unterschrift - so bleibt es lesbar und stimmt nicht.
  kaputt[200] = kaputt[200]! ^ 0xff;
  const befund = pruefeKette(kaputt, [caZert], JETZT, wurzeln);
  assert.ok(befund.lage === 'wurzel-unbekannt' || befund.lage === 'gebrochen', befund.lage);
});

console.log('\nUnterschriften lesen (von OpenSSL erzeugt)');

const signiertRoh = alsRoh(P.signiertAbgetrennt);
const erkannt = erkenneSmime(signiertRoh);
assert.equal(erkannt.art, 'signiert');
const signiert = erkannt as Extract<typeof erkannt, { art: 'signiert' }>;
const gelesen = leseSignierteDaten(signiert.signatur);
const unterzeichner = gelesen.unterzeichner[0]!;

await pruefe('die abgetrennte Form wird als solche erkannt', () => {
  assert.equal(signiert.unterschriebeneBytes.toString('utf8'), P.klartext.replace(/\n/g, '\r\n'));
});

await pruefe('die Signatur enthaelt Zertifikat und Kette', () => {
  assert.equal(gelesen.zertifikate.length, 2);
  assert.equal(gelesen.unterzeichner.length, 1);
  assert.equal(gelesen.inhaltstyp, B.daten);
});

await pruefe('der Unterzeichner nennt Verfahren, Zeitpunkt und Faehigkeiten', () => {
  assert.equal(unterzeichner.streuVerfahren, B.sha256);
  assert.equal(unterzeichner.unterschriftsVerfahren, B.rsa);
  assert.ok(unterzeichner.zeitpunkt instanceof Date);
  assert.ok(unterzeichner.faehigkeiten.includes(B.aes256Cbc));
});

await pruefe('das Zertifikat wird ueber Aussteller und Seriennummer zugeordnet', () => {
  const passend = gelesen.zertifikate.filter((z) => gehoertZuZertifikat(unterzeichner, z));
  assert.equal(passend.length, 1);
  assert.equal(beschreibeZertifikat(passend[0]!).adressen[0], 'anna@pruefung.example');
  // Und die Wurzel, die daneben liegt, wird eben nicht zugeordnet.
  assert.ok(!gehoertZuZertifikat(unterzeichner, caZert));
});

await pruefe('die Unterschrift von OpenSSL geht auf', () => {
  const befund = pruefeUnterzeichner(unterzeichner, signiert.unterschriebeneBytes, annaZert);
  assert.equal(befund.stimmt, true);
});

await pruefe('ein veraendertes Byte im Inhalt faellt auf', () => {
  const kaputt = Buffer.from(signiert.unterschriebeneBytes);
  kaputt[0] = kaputt[0]! ^ 1;
  const befund = pruefeUnterzeichner(unterzeichner, kaputt, annaZert);
  assert.equal(befund.stimmt, false);
  assert.match((befund as { grund: string }).grund, /nicht der, der unterschrieben/);
});

await pruefe('ein veraendertes Byte in der Unterschrift faellt auf', () => {
  const verdreht = { ...unterzeichner, unterschrift: Buffer.from(unterzeichner.unterschrift) };
  verdreht.unterschrift[10] = verdreht.unterschrift[10]! ^ 1;
  const befund = pruefeUnterzeichner(verdreht, signiert.unterschriebeneBytes, annaZert);
  assert.equal(befund.stimmt, false);
  assert.match((befund as { grund: string }).grund, /geht nicht auf/);
});

await pruefe('ein fremdes Zertifikat prueft die Unterschrift nicht', () => {
  const befund = pruefeUnterzeichner(unterzeichner, signiert.unterschriebeneBytes, bertZert);
  assert.equal(befund.stimmt, false);
});

/*
 * Die Stelle, an der die meisten Umsetzungen scheitern - und der Beweis, dass sie hier
 * bedacht ist. Unterschrieben wurde die Merkmalsliste mit der Kennung einer SET OF (0x31),
 * in der Nachricht steht sie mit 0xA0. Wer das uebersieht, rechnet ueber andere Bytes.
 */
await pruefe('die Merkmale werden als SET OF geprueft, nicht wie sie dastehen', () => {
  const alsMenge = mitKennung(unterzeichner.merkmale!, DER.SET);
  const alsHuelle = mitKennung(unterzeichner.merkmale!, 0xa0);
  const schluessel = new crypto.X509Certificate(annaZert).publicKey;
  assert.equal(crypto.verify('sha256', alsMenge, schluessel, unterzeichner.unterschrift), true);
  assert.equal(crypto.verify('sha256', alsHuelle, schluessel, unterzeichner.unterschrift), false);
});

await pruefe('SHA-1 wird nicht als Nachweis anerkannt', () => {
  assert.equal(streuNameVon(B.sha1), null);
  assert.equal(streuNameVon(B.md5), null);
  const mitSha1 = { ...unterzeichner, streuVerfahren: B.sha1 };
  const befund = pruefeUnterzeichner(mitSha1, signiert.unterschriebeneBytes, annaZert);
  assert.equal(befund.stimmt, false);
  assert.equal((befund as { verfahrenFehlt?: boolean }).verfahrenFehlt, true);
});

await pruefe('die eingeschlossene Form traegt ihren Inhalt bei sich', () => {
  const art = erkenneSmime(alsRoh(P.signiertOpak));
  assert.equal(art.art, 'signiert-eingeschlossen');
  const daten = leseSignierteDaten((art as { signatur: Buffer }).signatur);
  assert.equal(daten.inhalt?.toString('utf8'), P.klartext.replace(/\n/g, '\r\n'));
  const befund = pruefeUnterzeichner(daten.unterzeichner[0]!, daten.inhalt!, annaZert);
  assert.equal(befund.stimmt, true);
});

console.log('\nUnterschriften schreiben');

const eigenerTeil = baueSigniertenTeil('Hallo Welt.\nZweite Zeile mit Umlaut: äöü');
const eigeneSignatur = baueSignierteDaten({
  inhalt: Buffer.from(eigenerTeil, 'utf8'),
  zertifikat: annaZert,
  schluessel: annaKey,
  kette: [caZert],
  zeitpunkt: JETZT,
});

await pruefe('unsere eigene Unterschrift geht bei uns selbst auf', () => {
  const daten = leseSignierteDaten(eigeneSignatur);
  assert.equal(daten.zertifikate.length, 2);
  const u = daten.unterzeichner[0]!;
  assert.equal(pruefeUnterzeichner(u, Buffer.from(eigenerTeil, 'utf8'), annaZert).stimmt, true);
  assert.equal(u.zeitpunkt?.toISOString(), JETZT.toISOString());
});

/*
 * Der Aufbau gegen RFC 5652, Feld fuer Feld. Zerlegt wird hier mit einem Leser, der von
 * der Umsetzung nichts weiss - es zaehlt nur, was in den Bytes steht.
 */
await pruefe('der Aufbau entspricht RFC 5652 §5.1', () => {
  const aussen = zerlege(zerlegeEines(eigeneSignatur).inhalt);
  assert.equal(alsOid(aussen[0]!.inhalt), B.signierteDaten, 'contentType');
  assert.equal(aussen[1]!.kennung, 0xa0, 'content ist [0] EXPLICIT');

  const sd = zerlege(zerlegeEines(aussen[1]!.inhalt).inhalt);
  assert.equal(sd[0]!.kennung, DER.INTEGER, 'version');
  assert.equal(sd[1]!.kennung, DER.SET, 'digestAlgorithms');
  assert.equal(sd[2]!.kennung, DER.SEQUENCE, 'encapContentInfo');
  assert.equal(sd[3]!.kennung, 0xa0, 'certificates ist [0] IMPLICIT');
  assert.equal(sd[4]!.kennung, DER.SET, 'signerInfos');
  // Abgetrennt heisst: im encapContentInfo steht nur der Typ und kein Inhalt.
  assert.equal(zerlege(sd[2]!.inhalt).length, 1);
});

await pruefe('der Aufbau eines SignerInfo entspricht RFC 5652 §5.3', () => {
  const sd = zerlege(zerlegeEines(zerlege(zerlegeEines(eigeneSignatur).inhalt)[1]!.inhalt).inhalt);
  const si = zerlege(zerlege(sd[4]!.inhalt)[0]!.inhalt);
  assert.equal(si[0]!.kennung, DER.INTEGER, 'version');
  assert.equal(si[1]!.kennung, DER.SEQUENCE, 'sid als issuerAndSerialNumber');
  assert.equal(si[2]!.kennung, DER.SEQUENCE, 'digestAlgorithm');
  assert.equal(si[3]!.kennung, 0xa0, 'signedAttrs ist [0] IMPLICIT');
  assert.equal(si[4]!.kennung, DER.SEQUENCE, 'signatureAlgorithm');
  assert.equal(si[5]!.kennung, DER.OCTET_STRING, 'signature');

  // Aussteller und Seriennummer stehen byteweise so da wie im Zertifikat.
  const felder = felderVon(annaZert);
  const sid = zerlege(si[1]!.inhalt);
  assert.ok(sid[0]!.roh.equals(felder.aussteller));
  assert.ok(sid[1]!.roh.equals(felder.seriennummer));
});

await pruefe('die unterschriebenen Merkmale sind sortiert und vollstaendig', () => {
  const sd = zerlege(zerlegeEines(zerlege(zerlegeEines(eigeneSignatur).inhalt)[1]!.inhalt).inhalt);
  const si = zerlege(zerlege(sd[4]!.inhalt)[0]!.inhalt);
  const merkmale = zerlege(si[3]!.inhalt);

  for (let i = 1; i < merkmale.length; i++) {
    assert.ok(
      Buffer.compare(merkmale[i - 1]!.roh, merkmale[i]!.roh) < 0,
      `Merkmal ${i} steht vor seinem Vorgaenger - dann ist es kein DER.`,
    );
  }
  const typen = merkmale.map((m) => alsOid(zerlege(m.inhalt)[0]!.inhalt));
  assert.ok(typen.includes(B.merkmalInhaltstyp));
  assert.ok(typen.includes(B.merkmalAbdruck));
  assert.ok(typen.includes(B.merkmalZeitpunkt));
  assert.ok(typen.includes(B.merkmalFaehigkeiten));
});

await pruefe('der Abdruck in den Merkmalen ist der des Inhalts', () => {
  const u = leseSignierteDaten(eigeneSignatur).unterzeichner[0]!;
  const soll = crypto.createHash('sha256').update(Buffer.from(eigenerTeil, 'utf8')).digest();
  assert.ok(u.behaupteterAbdruck!.equals(soll));
});

console.log('\nUmschlaege');

const umschlagRoh = erkenneSmime(alsRoh(P.verschluesselt));
assert.equal(umschlagRoh.art, 'verschluesselt');
const fremderUmschlag = leseUmschlag((umschlagRoh as { umschlag: Buffer }).umschlag);

await pruefe('ein Umschlag von OpenSSL wird gelesen', () => {
  assert.equal(fremderUmschlag.empfaenger.length, 2);
  assert.equal(fremderUmschlag.inhaltsVerfahrenBezeichner, B.aes256Cbc);
});

await pruefe('beide Empfaenger oeffnen denselben Inhalt', () => {
  for (const [zert, key] of [
    [annaZert, annaKey],
    [bertZert, bertKey],
  ] as const) {
    const eintrag = fremderUmschlag.empfaenger.find((e) => empfaengerPasst(e, zert));
    assert.ok(eintrag, 'Empfaenger nicht gefunden');
    assert.equal(
      oeffneUmschlag(fremderUmschlag, eintrag, key).toString('utf8'),
      P.klartext.replace(/\n/g, '\r\n'),
    );
  }
});

/*
 * Ein falscher Schluessel bekommt DENSELBEN Satz wie ein beschaedigter Umschlag. Ein
 * Unterschied waere eine Auskunft, aus der sich der Klartext Bit fuer Bit erraten laesst -
 * der Angriff von Bleichenbacher, seit 1998 bekannt und immer noch wirksam.
 */
await pruefe('jeder Fehlschlag am Schluessel bekommt denselben Satz', () => {
  const eintrag = fremderUmschlag.empfaenger.find((e) => empfaengerPasst(e, annaZert))!;
  const saetze = new Set<string>();
  const versuche = [
    // Ein fremder Schluessel.
    () => oeffneUmschlag(fremderUmschlag, eintrag, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey),
    // Ein verfaelschter verschluesselter Schluessel - die Auffuellung geht nicht auf.
    () => {
      const kaputt = { ...eintrag, verschluesselterSchluessel: Buffer.from(eintrag.verschluesselterSchluessel) };
      kaputt.verschluesselterSchluessel[7] = kaputt.verschluesselterSchluessel[7]! ^ 0xff;
      return oeffneUmschlag(fremderUmschlag, kaputt, annaKey);
    },
    // Und einer, der zwar aufgeht, aber die falsche Laenge hat.
    () => {
      const kurz = crypto.publicEncrypt(
        { key: new crypto.X509Certificate(annaZert).publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
        Buffer.alloc(16),
      );
      return oeffneUmschlag(fremderUmschlag, { ...eintrag, verschluesselterSchluessel: kurz }, annaKey);
    },
  ];
  for (const versuch of versuche) {
    try {
      versuch();
      throw new Error('durchgelassen');
    } catch (err) {
      saetze.add((err as Error).message);
    }
  }
  assert.deepEqual([...saetze], ['Die Nachricht ließ sich nicht öffnen.']);
});

/*
 * Der Gegenbeweis zu GCM weiter unten - und der Grund, warum es GCM ueberhaupt gibt.
 *
 * Bei AES-CBC laesst sich der Geheimtext veraendern, ohne dass es beim Oeffnen auffaellt:
 * Es kommt anderer Klartext heraus, und niemand merkt etwas. Genau darauf setzten die
 * EFAIL-Angriffe von 2018 auf. Das steht hier als Pruefung, weil es sonst wie eine
 * Behauptung aussaehe - und weil es die Zeile ist, die "GCM erkennt es" ueberhaupt erst
 * zu einer Aussage macht.
 */
await pruefe('bei CBC bleibt eine Veraenderung des Geheimtextes unbemerkt', () => {
  const eintrag = fremderUmschlag.empfaenger.find((e) => empfaengerPasst(e, annaZert))!;
  const kaputt = { ...fremderUmschlag, geheimtext: Buffer.from(fremderUmschlag.geheimtext) };
  kaputt.geheimtext[5] = kaputt.geheimtext[5]! ^ 0xff;
  const heraus = oeffneUmschlag(kaputt, eintrag, annaKey);
  assert.notEqual(heraus.toString('utf8'), P.klartext.replace(/\n/g, '\r\n'));
});

await pruefe('unser eigener Umschlag geht an mehrere Empfaenger', () => {
  const umschlag = leseUmschlag(
    baueUmschlag({ inhalt: Buffer.from('Geheim.\r\n'), empfaenger: [annaZert, bertZert] }),
  );
  assert.equal(umschlag.empfaenger.length, 2);
  for (const [zert, key] of [
    [annaZert, annaKey],
    [bertZert, bertKey],
  ] as const) {
    const eintrag = umschlag.empfaenger.find((e) => empfaengerPasst(e, zert))!;
    assert.equal(oeffneUmschlag(umschlag, eintrag, key).toString('utf8'), 'Geheim.\r\n');
  }
});

/*
 * Der Grund, warum GCM ueberhaupt eingebaut ist. Bei CBC laesst sich der Geheimtext
 * veraendern, ohne dass es beim Oeffnen auffaellt - darauf setzten die EFAIL-Angriffe von
 * 2018 auf. GCM merkt es. Genau das wird hier nachgewiesen.
 */
await pruefe('mit GCM faellt eine Veraenderung des Geheimtextes auf', () => {
  const gebaut = baueUmschlag({
    inhalt: Buffer.from('Geheim und unversehrt.\r\n'),
    empfaenger: [annaZert],
    verfahren: B.aes256Gcm,
  });
  const umschlag = leseUmschlag(gebaut);
  assert.equal(umschlag.inhaltsVerfahrenBezeichner, B.aes256Gcm);
  // Und der Umschlag heisst dann auch anders - RFC 5083 statt RFC 5652.
  assert.equal(umschlag.authentisiert, true);
  assert.ok(umschlag.pruefsumme, 'Die Pruefsumme steht in einem eigenen Feld.');
  const eintrag = umschlag.empfaenger.find((e) => empfaengerPasst(e, annaZert))!;
  assert.equal(
    oeffneUmschlag(umschlag, eintrag, annaKey).toString('utf8'),
    'Geheim und unversehrt.\r\n',
  );

  const kaputt = { ...umschlag, geheimtext: Buffer.from(umschlag.geheimtext) };
  kaputt.geheimtext[3] = kaputt.geheimtext[3]! ^ 0x01;
  assert.throws(() => oeffneUmschlag(kaputt, eintrag, annaKey));
});

await pruefe('das Verfahren richtet sich nach dem schwaechsten Empfaenger', () => {
  assert.equal(besteVerschluesselung([[B.aes256Gcm], [B.aes256Gcm]]), B.aes256Gcm);
  assert.equal(besteVerschluesselung([[B.aes256Gcm], [B.aes256Cbc]]), B.aes256Cbc);
  // Niemand bekannt heisst: nichts angenommen.
  assert.equal(besteVerschluesselung([]), B.aes256Cbc);
  assert.equal(besteVerschluesselung([[]]), B.aes256Cbc);
});

console.log('\nDie Nachricht drumherum');

await pruefe('eine verschluesselte Nachricht mit Unterschrift darin geht ganz auf', () => {
  const aussen = erkenneSmime(alsRoh(P.signiertUndVerschluesselt));
  assert.equal(aussen.art, 'verschluesselt');
  const umschlag = leseUmschlag((aussen as { umschlag: Buffer }).umschlag);
  const eintrag = umschlag.empfaenger.find((e) => empfaengerPasst(e, annaZert))!;
  const klar = oeffneUmschlag(umschlag, eintrag, annaKey);

  // Und was herauskommt, ist selbst wieder eine unterschriebene Nachricht.
  const innen = erkenneSmime(klar);
  assert.equal(innen.art, 'signiert');
  const teil = innen as Extract<typeof innen, { art: 'signiert' }>;
  const daten = leseSignierteDaten(teil.signatur);
  assert.equal(
    pruefeUnterzeichner(daten.unterzeichner[0]!, teil.unterschriebeneBytes, annaZert).stimmt,
    true,
  );
});

await pruefe('unsere eigene unterschriebene Post laesst sich wieder auseinandernehmen', () => {
  const einheit = baueSigniertePost(eigenerTeil, eigeneSignatur, '=_Pruefung_1');
  const nachricht = Buffer.concat([
    Buffer.from('From: anna@pruefung.example\r\nSubject: Probe\r\n', 'utf8'),
    alsBytes(einheit),
  ]);
  const art = erkenneSmime(nachricht);
  assert.equal(art.art, 'signiert');
  const teil = art as Extract<typeof art, { art: 'signiert' }>;
  // Byte fuer Byte derselbe Teil, der unterschrieben wurde - daran haengt alles.
  assert.equal(teil.unterschriebeneBytes.toString('utf8'), eigenerTeil);
  const daten = leseSignierteDaten(teil.signatur);
  assert.equal(
    pruefeUnterzeichner(daten.unterzeichner[0]!, teil.unterschriebeneBytes, annaZert).stimmt,
    true,
  );
});

await pruefe('ein multipart/signed ohne pkcs7-Unterschrift gilt nicht als S/MIME', () => {
  const nachricht = alsRoh(
    [
      'Content-Type: multipart/signed; protocol="application/pgp-signature"; boundary="g"',
      '',
      '--g',
      'Content-Type: text/plain',
      '',
      'Hallo',
      '--g',
      'Content-Type: application/pgp-signature',
      '',
      'nicht unser Fall',
      '--g--',
      '',
    ].join('\n'),
  );
  assert.equal(erkenneSmime(nachricht).art, 'keine');
});

await pruefe('ein Paket ohne smime-type wird an seinem Inhalt erkannt', () => {
  const umschlag = baueUmschlag({ inhalt: Buffer.from('x'), empfaenger: [annaZert] });
  const nachricht = alsRoh(
    ['Content-Type: application/pkcs7-mime; name="smime.p7m"', 'Content-Transfer-Encoding: base64', '', umschlag.toString('base64'), ''].join('\n'),
  );
  assert.equal(erkenneSmime(nachricht).art, 'verschluesselt');
});

console.log('\nSchluesseldateien');

for (const [name, datei] of [
  ['der heutige Aufbau (PBES2 mit AES-256)', P.annaP12],
  ['der alte Aufbau (SHA-1 mit 3DES)', P.annaP12Alt],
] as const) {
  await pruefe(`${name} laesst sich lesen`, () => {
    const paare = leseSchluesseldatei(b(datei), 'geheim123');
    assert.equal(paare.length, 1);
    const paar = paare[0]!;
    assert.deepEqual(beschreibeZertifikat(paar.zertifikat).adressen, ['anna@pruefung.example']);
    // Der Beweis, dass Schluessel und Zertifikat zusammengehoeren: unterschreiben und pruefen.
    const probe = Buffer.from('probe');
    const sig = crypto.sign('sha256', probe, paar.schluessel);
    assert.equal(
      crypto.verify('sha256', probe, new crypto.X509Certificate(paar.zertifikat).publicKey, sig),
      true,
    );
  });
}

await pruefe('ein falsches Kennwort wird als solches gemeldet', () => {
  for (const datei of [P.annaP12, P.annaP12Alt]) {
    assert.throws(
      () => leseSchluesseldatei(b(datei), 'falsch'),
      /Kennwort stimmt nicht/,
    );
  }
});

await pruefe('eine veraenderte Datei faellt an ihrer Pruefsumme auf', () => {
  const kaputt = b(P.annaP12);
  // Mitten in den Rumpf hinein - die Pruefsumme deckt ihn ab.
  kaputt[400] = kaputt[400]! ^ 0xff;
  assert.throws(() => leseSchluesseldatei(kaputt, 'geheim123'));
});

await pruefe('etwas, das keine Schluesseldatei ist, bekommt eine brauchbare Auskunft', () => {
  assert.throws(() => leseSchluesseldatei(annaZert, 'geheim123'), /keine Schlüsseldatei/);
});

console.log('\nDie Beurteilung - was der Nutzer am Ende sieht');

const grundlage = {
  stimmt: true,
  zertifikatVorhanden: true,
  verfahrenAnerkannt: true,
  kette: { lage: 'vertraut', ueber: ['W'] } as const,
  fuerMail: true,
  absender: 'anna@pruefung.example',
  zertifikatAdressen: ['anna@pruefung.example'],
};

await pruefe('alles zusammen ergibt gueltig', () => {
  assert.equal(beurteileSmime(grundlage), 'gueltig');
});

await pruefe('das Schlimmste gewinnt: falsche Unterschrift schlaegt abgelaufen', () => {
  const befund = beurteileSmime({
    ...grundlage,
    stimmt: false,
    kette: { lage: 'zeitlich-ungueltig', grund: 'abgelaufen' },
  });
  assert.equal(befund, 'ungueltig');
});

await pruefe('eine unbekannte Wurzel schlaegt die passende Adresse', () => {
  const befund = beurteileSmime({
    ...grundlage,
    kette: { lage: 'wurzel-unbekannt', ueber: [], wurzel: 'CN=Selbst' },
  });
  assert.equal(befund, 'gueltig-wurzel-unbekannt');
});

await pruefe('eine fremde Adresse wird als solche ausgewiesen', () => {
  assert.equal(
    beurteileSmime({ ...grundlage, absender: 'jemand@anders.example' }),
    'gueltig-fremde-adresse',
  );
});

await pruefe('ein Zertifikat ohne Mailzweck gilt nicht als Nachweis', () => {
  assert.equal(beurteileSmime({ ...grundlage, fuerMail: false }), 'zweck-passt-nicht');
});

await pruefe('ohne Zertifikat und ohne anerkanntes Verfahren wird nichts behauptet', () => {
  assert.equal(beurteileSmime({ ...grundlage, zertifikatVorhanden: false }), 'nicht-pruefbar');
  assert.equal(beurteileSmime({ ...grundlage, verfahrenAnerkannt: false }), 'nicht-pruefbar');
});

await pruefe('eine gebrochene Kette ist dasselbe wie eine falsche Unterschrift', () => {
  assert.equal(
    beurteileSmime({ ...grundlage, kette: { lage: 'gebrochen', grund: 'x' } }),
    'ungueltig',
  );
});

console.log('\nGegenprobe mit OpenSSL');

/**
 * Nimmt OpenSSL an, was wir bauen?
 *
 * Das ist die Frage, die alle anderen Pruefungen nicht beantworten koennen. Sie laeuft
 * nur, wo OpenSSL vorhanden ist. Fehlt es, wird das gesagt und nicht stillschweigend
 * uebergangen - eine Pruefung, die heimlich nichts tut, ist schlimmer als keine.
 */
function habenWirOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

if (!habenWirOpenssl()) {
  console.log('  --   uebersprungen: openssl ist auf diesem Rechner nicht vorhanden');
} else {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'smime-'));
  const pem = (marke: string, roh: Buffer) =>
    `-----BEGIN ${marke}-----\n${roh.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END ${marke}-----\n`;
  const weg = (name: string) => path.join(ordner, name);
  fs.writeFileSync(weg('ca.pem'), pem('CERTIFICATE', caZert));
  fs.writeFileSync(weg('anna.pem'), pem('CERTIFICATE', annaZert));
  fs.writeFileSync(weg('anna.key'), pem('PRIVATE KEY', b(P.annaSchluessel)));
  fs.writeFileSync(weg('inhalt.bin'), Buffer.from(eigenerTeil, 'utf8'));
  fs.writeFileSync(weg('eigene.p7s'), eigeneSignatur);

  await pruefe('OpenSSL nimmt unsere Unterschrift an', () => {
    execFileSync(
      'openssl',
      ['cms', '-verify', '-inform', 'DER', '-in', weg('eigene.p7s'), '-content',
        weg('inhalt.bin'), '-binary', '-CAfile', weg('ca.pem'), '-out', weg('raus.txt')],
      { stdio: 'pipe' },
    );
    assert.equal(fs.readFileSync(weg('raus.txt'), 'utf8'), eigenerTeil);
  });

  await pruefe('OpenSSL lehnt unsere Unterschrift ueber verfaelschtem Inhalt ab', () => {
    fs.writeFileSync(weg('falsch.bin'), Buffer.from(eigenerTeil.replace('Hallo', 'Hallo!'), 'utf8'));
    assert.throws(() =>
      execFileSync(
        'openssl',
        ['cms', '-verify', '-inform', 'DER', '-in', weg('eigene.p7s'), '-content',
          weg('falsch.bin'), '-binary', '-CAfile', weg('ca.pem'), '-out', weg('raus2.txt')],
        { stdio: 'pipe' },
      ),
    );
  });

  await pruefe('OpenSSL oeffnet unseren Umschlag', () => {
    const umschlag = baueUmschlag({
      inhalt: Buffer.from('Von uns fuer OpenSSL.\r\n'),
      empfaenger: [annaZert],
    });
    fs.writeFileSync(weg('eigen.p7m'), umschlag);
    /*
     * Ueber eine Datei und nicht ueber die Standardausgabe: Unter Windows oeffnet OpenSSL
     * seine Ausgabe im Textmodus und macht aus jedem \n ein \r\n - aus dem CRLF der
     * Nachricht wuerde damit \r\r\n. Das ist ein Fehler des Weges und nicht der Bytes,
     * verdeckt aber genau die Bytes, um die es hier geht.
     */
    execFileSync(
      'openssl',
      ['cms', '-decrypt', '-inform', 'DER', '-in', weg('eigen.p7m'), '-recip', weg('anna.pem'),
        '-inkey', weg('anna.key'), '-binary', '-out', weg('umschlag-raus.bin')],
      { stdio: 'pipe' },
    );
    assert.equal(fs.readFileSync(weg('umschlag-raus.bin'), 'utf8'), 'Von uns fuer OpenSSL.\r\n');
  });

  await pruefe('OpenSSL oeffnet auch unseren GCM-Umschlag', () => {
    const umschlag = baueUmschlag({
      inhalt: Buffer.from('Auch mit GCM.\r\n'),
      empfaenger: [annaZert],
      verfahren: B.aes256Gcm,
    });
    fs.writeFileSync(weg('gcm.p7m'), umschlag);
    execFileSync(
      'openssl',
      ['cms', '-decrypt', '-inform', 'DER', '-in', weg('gcm.p7m'), '-recip', weg('anna.pem'),
        '-inkey', weg('anna.key'), '-binary', '-out', weg('gcm-raus.bin')],
      { stdio: 'pipe' },
    );
    assert.equal(fs.readFileSync(weg('gcm-raus.bin'), 'utf8'), 'Auch mit GCM.\r\n');
  });

  fs.rmSync(ordner, { recursive: true, force: true });
}

console.log(`\n${ok}/${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);

// Ein Platzhalter, damit ktxEinfach beim Aufraeumen nicht verlorengeht - er beschreibt
// die Kennung, unter der der Geheimtext im Umschlag steht.
void ktxEinfach;
