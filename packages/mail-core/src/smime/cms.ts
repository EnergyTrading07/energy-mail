import crypto from 'node:crypto';
import { B, benenne, inhaltsVerfahren, streuNameVon } from './bezeichner.js';
import {
  BerFehler,
  DER,
  alsOid,
  alsZeit,
  erwarte,
  folge,
  huelle,
  kleineZahl,
  ktxEinfach,
  menge,
  mengeSortiert,
  mitKennung,
  nullwert,
  oid,
  oktette,
  verfahren,
  zeitAlsUtc,
  zerlege,
  zerlegeEines,
  type Stueck,
} from './der.js';
import { felderVon } from './zertifikat.js';

/**
 * CMS - der Umschlag, in dem S/MIME steckt (RFC 5652).
 *
 * Zwei Bauformen, mehr gibt es nicht:
 *
 *   **SignedData** - der Inhalt und eine oder mehrere Unterschriften darüber. Unterschrieben
 *   wird dabei fast nie der Inhalt selbst, sondern eine kleine Liste von Merkmalen, in der
 *   sein Abdruck steht. Das klingt nach einem Umweg und ist einer, aber ein nötiger: So
 *   lässt sich auch der Zeitpunkt mit unterschreiben, ohne ihn in den Text zu schreiben.
 *
 *   **EnvelopedData** - ein zufälliger Schlüssel, mit dem der Inhalt verschlüsselt ist,
 *   und dieser Schlüssel noch einmal für jeden Empfänger einzeln, mit dessen öffentlichem
 *   Schlüssel. Deshalb kostet ein zusätzlicher Empfänger nur ein paar hundert Bytes und
 *   nicht die ganze Nachricht noch einmal.
 *
 * ## Die eine Stelle, an der die meisten Umsetzungen falsch liegen
 *
 * Beim Prüfen einer Unterschrift mit Merkmalen muss dreierlei zusammenpassen, und wer nur
 * das Erste prüft, hat nichts geprüft:
 *
 *   1. Die Unterschrift geht über die Merkmale auf. (Das prüft jeder.)
 *   2. Der Abdruck IN den Merkmalen ist der des tatsächlichen Inhalts. Ohne diesen
 *      Schritt kann man eine gültige Unterschrift von einer Nachricht an eine beliebige
 *      andere hängen - sie geht auf, und der Inhalt ist ausgetauscht.
 *   3. Der Inhaltstyp in den Merkmalen ist der der Nachricht. Sonst ließe sich eine
 *      Unterschrift über etwas anderes als eine Mail auf eine Mail umdeuten.
 *
 * Alle drei stehen weiter unten in `pruefeUnterzeichner`, und alle drei sind einzeln
 * geprüft.
 */

export class CmsFehler extends Error {}

// --- Lesen ---

export interface Unterzeichner {
  /** `issuer` und `serialNumber` als rohe Bytes - so wird das Zertifikat zugeordnet. */
  aussteller?: Buffer;
  seriennummer?: Buffer;
  /** Die andere Art der Zuordnung: über die Schlüsselkennung. */
  schluesselKennung?: Buffer;
  streuVerfahren: string;
  unterschriftsVerfahren: string;
  /** Die Parameter des Unterschriftsverfahrens - bei PSS steht dort das Nötige. */
  unterschriftsParameter?: Buffer;
  /** Die unterschriebenen Merkmale, unverändert - über sie wird gerechnet. */
  merkmale?: Stueck;
  unterschrift: Buffer;
  /** Der Abdruck des Inhalts, wie ihn der Unterzeichner behauptet. */
  behaupteterAbdruck?: Buffer;
  behaupteterInhaltstyp?: string;
  zeitpunkt?: Date;
  /** Womit der Absender umgehen kann - siehe `besteVerschluesselung`. */
  faehigkeiten: string[];
}

export interface SignierteDaten {
  /** Bei der eingeschlossenen Form: der Inhalt selbst. Bei der abgetrennten: nichts. */
  inhalt?: Buffer;
  inhaltstyp: string;
  /** Alle mitgeschickten Zertifikate - Unterzeichner und Zwischenstellen. */
  zertifikate: Buffer[];
  unterzeichner: Unterzeichner[];
}

/** Schält die äußere Hülle ab und prüft, dass darin steht, was erwartet wird. */
function inhaltVon(der: Buffer, erwarteteTypen: readonly string[], wo: string): [Stueck, string] {
  const ganz = erwarte(zerlegeEines(der), DER.SEQUENCE, wo);
  const teile = zerlege(ganz.inhalt);
  const typ = alsOid(erwarte(teile[0], DER.OID, `${wo}: Inhaltstyp`).inhalt);
  if (!erwarteteTypen.includes(typ)) {
    throw new CmsFehler(
      `${wo}: Erwartet war ${erwarteteTypen.map(benenne).join(' oder ')}, gefunden ${typ}.`,
    );
  }
  const huelle = teile[1];
  if (!huelle || huelle.kennung !== 0xa0) throw new CmsFehler(`${wo}: Der Inhalt fehlt.`);
  return [zerlegeEines(huelle.inhalt), typ];
}

/**
 * Setzt einen OCTET STRING zusammen, der in Stücken vorliegen darf.
 *
 * In DER ist er ein Stück; BER erlaubt aber, ihn zusammengesetzt zu schreiben, und
 * manche Absender tun das bei großen Anhängen. Wer das nicht auffängt, bekommt bei genau
 * diesen Nachrichten einen unverständlichen Fehler.
 */
function alsOktette(stueck: Stueck, wo: string): Buffer {
  if (stueck.kennung === DER.OCTET_STRING) return stueck.inhalt;
  if (stueck.kennung === (DER.OCTET_STRING | 0x20)) {
    return Buffer.concat(zerlege(stueck.inhalt).map((s) => alsOktette(s, wo)));
  }
  throw new CmsFehler(`${wo}: Erwartet war eine Bytefolge.`);
}

export function leseSignierteDaten(der: Buffer): SignierteDaten {
  const daten = erwarte(
    inhaltVon(der, [B.signierteDaten], 'Signatur')[0],
    DER.SEQUENCE,
    'SignedData',
  );
  const teile = zerlege(daten.inhalt);

  erwarte(teile[0], DER.INTEGER, 'SignedData: Fassung');
  erwarte(teile[1], DER.SET, 'SignedData: Streuverfahren');

  const kapsel = erwarte(teile[2], DER.SEQUENCE, 'SignedData: Inhalt');
  const kapselTeile = zerlege(kapsel.inhalt);
  const inhaltstyp = alsOid(erwarte(kapselTeile[0], DER.OID, 'Inhaltstyp').inhalt);
  const inhaltHuelle = kapselTeile[1];
  const inhalt =
    inhaltHuelle && inhaltHuelle.kennung === 0xa0
      ? alsOktette(zerlegeEines(inhaltHuelle.inhalt), 'Inhalt')
      : undefined;

  const zertifikate: Buffer[] = [];
  let unterzeichnerMenge: Stueck | undefined;
  for (const stueck of teile.slice(3)) {
    if (stueck.kennung === 0xa0) {
      for (const zert of zerlege(stueck.inhalt)) {
        // Nur echte Zertifikate; die anderen Formen (Attribute, PGP) werden übergangen.
        if (zert.kennung === DER.SEQUENCE) zertifikate.push(zert.roh);
      }
    } else if (stueck.kennung === DER.SET) {
      unterzeichnerMenge = stueck;
    }
  }
  if (!unterzeichnerMenge) throw new CmsFehler('In der Signatur steht kein Unterzeichner.');

  return {
    inhalt,
    inhaltstyp,
    zertifikate,
    unterzeichner: zerlege(unterzeichnerMenge.inhalt).map(leseUnterzeichner),
  };
}

function leseUnterzeichner(stueck: Stueck): Unterzeichner {
  const teile = zerlege(erwarte(stueck, DER.SEQUENCE, 'SignerInfo').inhalt);
  let i = 0;
  erwarte(teile[i++], DER.INTEGER, 'SignerInfo: Fassung');

  const kennzeichen = teile[i++];
  let aussteller: Buffer | undefined;
  let seriennummer: Buffer | undefined;
  let schluesselKennung: Buffer | undefined;
  if (kennzeichen?.kennung === DER.SEQUENCE) {
    const [aus, nr] = zerlege(kennzeichen.inhalt);
    aussteller = aus?.roh;
    seriennummer = nr?.roh;
  } else if (kennzeichen?.kennung === ktxEinfach(0)) {
    schluesselKennung = kennzeichen.inhalt;
  } else {
    throw new CmsFehler('SignerInfo: Der Unterzeichner ist nicht gekennzeichnet.');
  }

  const streu = zerlege(erwarte(teile[i++], DER.SEQUENCE, 'Streuverfahren').inhalt);
  const streuVerfahren = alsOid(erwarte(streu[0], DER.OID, 'Streuverfahren').inhalt);

  let merkmale: Stueck | undefined;
  if (teile[i]?.kennung === 0xa0) merkmale = teile[i++];

  const sig = zerlege(erwarte(teile[i++], DER.SEQUENCE, 'Unterschriftsverfahren').inhalt);
  const unterschriftsVerfahren = alsOid(erwarte(sig[0], DER.OID, 'Unterschriftsverfahren').inhalt);
  const unterschrift = alsOktette(erwarte(teile[i++], DER.OCTET_STRING, 'Unterschrift'), 'Unterschrift');

  const eintrag: Unterzeichner = {
    aussteller,
    seriennummer,
    schluesselKennung,
    streuVerfahren,
    unterschriftsVerfahren,
    unterschriftsParameter: sig[1]?.roh,
    merkmale,
    unterschrift,
    faehigkeiten: [],
  };

  if (merkmale) {
    for (const merkmal of zerlege(merkmale.inhalt)) {
      const [typ, werte] = zerlege(erwarte(merkmal, DER.SEQUENCE, 'Merkmal').inhalt);
      if (!typ || !werte) continue;
      const bezeichner = alsOid(typ.inhalt);
      const wert = zerlege(werte.inhalt)[0];
      if (!wert) continue;
      try {
        if (bezeichner === B.merkmalAbdruck) eintrag.behaupteterAbdruck = wert.inhalt;
        else if (bezeichner === B.merkmalInhaltstyp) eintrag.behaupteterInhaltstyp = alsOid(wert.inhalt);
        else if (bezeichner === B.merkmalZeitpunkt) eintrag.zeitpunkt = alsZeit(wert);
        else if (bezeichner === B.merkmalFaehigkeiten) {
          for (const koennen of zerlege(wert.inhalt)) {
            const [was] = zerlege(koennen.inhalt);
            if (was?.kennung === DER.OID) eintrag.faehigkeiten.push(alsOid(was.inhalt));
          }
        }
      } catch {
        // Ein unlesbares Merkmal darf die anderen nicht mitreißen. Fehlt dadurch der
        // Abdruck, schlägt die Prüfung weiter unten ohnehin fehl - und zwar sichtbar.
      }
    }
  }
  return eintrag;
}

/** Ob ein Unterzeichner zu einem Zertifikat gehört. */
export function gehoertZuZertifikat(unterzeichner: Unterzeichner, zertifikat: Buffer): boolean {
  let felder;
  try {
    felder = felderVon(zertifikat);
  } catch {
    return false;
  }
  if (unterzeichner.schluesselKennung) {
    return (
      felder.schluesselKennung !== undefined &&
      felder.schluesselKennung.equals(unterzeichner.schluesselKennung)
    );
  }
  return (
    unterzeichner.aussteller !== undefined &&
    unterzeichner.seriennummer !== undefined &&
    // Byteweise, nicht nach Bedeutung: Zwei Namen, die dasselbe bedeuten, aber anders
    // geschrieben sind, sind für eine Zuordnung nicht dasselbe.
    felder.aussteller.equals(unterzeichner.aussteller) &&
    felder.seriennummer.equals(unterzeichner.seriennummer)
  );
}

export type Unterschriftsbefund =
  | { stimmt: true }
  | { stimmt: false; grund: string; verfahrenFehlt?: boolean };

/**
 * Prüft eine Unterschrift - alle drei Bedingungen aus dem Kopf dieser Datei.
 *
 * `inhalt` sind die Bytes, über die unterschrieben wurde: bei der abgetrennten Form der
 * MIME-Teil aus der Nachricht, bei der eingeschlossenen der Inhalt aus der Signatur
 * selbst. Die Unterscheidung trifft der Aufrufer, weil nur er die Nachricht kennt.
 */
export function pruefeUnterzeichner(
  unterzeichner: Unterzeichner,
  inhalt: Buffer,
  zertifikat: Buffer,
): Unterschriftsbefund {
  const streuName = streuNameVon(unterzeichner.streuVerfahren);
  if (!streuName) {
    return {
      stimmt: false,
      verfahrenFehlt: true,
      grund: `Das Streuverfahren ${benenne(unterzeichner.streuVerfahren)} wird hier nicht als Nachweis anerkannt.`,
    };
  }

  let zuPruefen: Buffer;
  if (unterzeichner.merkmale) {
    // (2) Der behauptete Abdruck muss der des wirklichen Inhalts sein.
    const wirklich = crypto.createHash(streuName).update(inhalt).digest();
    if (!unterzeichner.behaupteterAbdruck) {
      return { stimmt: false, grund: 'In den unterschriebenen Merkmalen fehlt der Abdruck.' };
    }
    if (
      unterzeichner.behaupteterAbdruck.length !== wirklich.length ||
      !crypto.timingSafeEqual(unterzeichner.behaupteterAbdruck, wirklich)
    ) {
      return { stimmt: false, grund: 'Der Inhalt ist nicht der, der unterschrieben wurde.' };
    }
    // (3) Und er muss über den richtigen Inhaltstyp geleistet worden sein.
    if (unterzeichner.behaupteterInhaltstyp && unterzeichner.behaupteterInhaltstyp !== B.daten) {
      return { stimmt: false, grund: 'Die Unterschrift gilt einem anderen Inhaltstyp.' };
    }
    /*
     * (1) Unterschrieben wurde die Merkmalsliste als SET OF - nicht so, wie sie in der
     * Nachricht steht. RFC 5652 §5.4 sagt es ausdrücklich, und es ist die Stelle, an der
     * eine sonst richtige Umsetzung an jeder Unterschrift scheitert.
     */
    zuPruefen = mitKennung(unterzeichner.merkmale, DER.SET);
  } else {
    zuPruefen = inhalt;
  }

  try {
    const schluessel = new crypto.X509Certificate(zertifikat).publicKey;
    return rechne(unterzeichner, streuName, zuPruefen, schluessel)
      ? { stimmt: true }
      : { stimmt: false, grund: 'Die Unterschrift geht nicht auf.' };
  } catch (err) {
    return { stimmt: false, grund: (err as Error).message };
  }
}

function rechne(
  unterzeichner: Unterzeichner,
  streuName: string,
  daten: Buffer,
  schluessel: crypto.KeyObject,
): boolean {
  const art = unterzeichner.unterschriftsVerfahren;

  if (art === B.ed25519) {
    // Ed25519 streut selbst; ein Streuverfahren davorzuschalten wäre falsch.
    return crypto.verify(null, daten, schluessel, unterzeichner.unterschrift);
  }

  if (art === B.rsaPss) {
    const pss = lesePssParameter(unterzeichner.unterschriftsParameter);
    return crypto.verify(pss.streuName, daten, {
      key: schluessel,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: pss.salzLaenge,
    }, unterzeichner.unterschrift);
  }

  /*
   * Alles andere - rsaEncryption, sha256WithRSA, ecdsa-with-SHA256 - läuft über denselben
   * Weg. Welches Streuverfahren dabei gilt, steht NICHT im Unterschriftsverfahren:
   * `rsaEncryption` allein sagt gar nichts darüber. Maßgeblich ist das Feld
   * `digestAlgorithm` des Unterzeichners, und genau das wird hier benutzt.
   */
  return crypto.verify(streuName, daten, schluessel, unterzeichner.unterschrift);
}

/** RSA-PSS bringt seine Einstellungen mit; ohne sie gelten die Vorgaben aus RFC 4055. */
function lesePssParameter(roh: Buffer | undefined): { streuName: string; salzLaenge: number } {
  const vorgabe = { streuName: 'sha1', salzLaenge: 20 };
  if (!roh) return vorgabe;
  try {
    const teile = zerlege(zerlegeEines(roh).inhalt);
    let streuName = vorgabe.streuName;
    let salzLaenge = vorgabe.salzLaenge;
    for (const teil of teile) {
      if (teil.kennung === 0xa0) {
        const [alg] = zerlege(zerlegeEines(teil.inhalt).inhalt);
        streuName = (alg && streuNameVon(alsOid(alg.inhalt))) || streuName;
      } else if (teil.kennung === 0xa2) {
        const [zahl] = zerlege(teil.inhalt);
        if (zahl) salzLaenge = Number(BigInt('0x' + zahl.inhalt.toString('hex')));
      }
    }
    return { streuName, salzLaenge };
  } catch {
    return vorgabe;
  }
}

// --- Schreiben ---

export interface Unterschreiben {
  /** Die Bytes, die unterschrieben werden. */
  inhalt: Buffer;
  /** Das eigene Zertifikat in DER. */
  zertifikat: Buffer;
  /** Der geheime Schlüssel dazu. */
  schluessel: crypto.KeyObject;
  /** Zwischenstellen, die mitgeschickt werden sollen. */
  kette?: readonly Buffer[];
  /** Ob der Inhalt in die Signatur eingeschlossen wird (`nodetach`). */
  eingeschlossen?: boolean;
  zeitpunkt?: Date;
}

/**
 * Baut eine SignedData.
 *
 * Die Merkmale werden immer mitgeschickt, auch wenn CMS es freistellt. Ohne sie ließe
 * sich kein Zeitpunkt und keine Angabe über die eigenen Fähigkeiten unterbringen - und
 * genau diese Angabe entscheidet später darüber, ob der andere uns verschlüsselte Post
 * mit einem gescheiten Verfahren schicken kann.
 */
export function baueSignierteDaten(auftrag: Unterschreiben): Buffer {
  const streuName = 'sha256';
  const abdruck = crypto.createHash(streuName).update(auftrag.inhalt).digest();
  const felder = felderVon(auftrag.zertifikat);

  const merkmale = [
    folge(oid(B.merkmalInhaltstyp), menge(oid(B.daten))),
    folge(oid(B.merkmalZeitpunkt), menge(zeitAlsUtc(auftrag.zeitpunkt ?? new Date()))),
    folge(oid(B.merkmalAbdruck), menge(oktette(abdruck))),
    folge(oid(B.merkmalFaehigkeiten), menge(folge(...UNSERE_FAEHIGKEITEN.map((f) => folge(oid(f)))))),
  ];
  // Sortiert - siehe mengeSortiert(). Unterschrieben wird genau diese Bytefolge.
  const merkmaleAlsMenge = mengeSortiert(...merkmale);

  const art = auftrag.schluessel.asymmetricKeyType;
  const unterschrift =
    art === 'ed25519'
      ? crypto.sign(null, merkmaleAlsMenge, auftrag.schluessel)
      : crypto.sign(streuName, merkmaleAlsMenge, auftrag.schluessel);

  const verfahrenDerUnterschrift =
    art === 'ec'
      ? verfahren(B.ecdsaMitSha256)
      : art === 'ed25519'
        ? verfahren(B.ed25519)
        : verfahren(B.rsa, nullwert());

  const unterzeichner = folge(
    kleineZahl(1),
    folge(felder.aussteller, felder.seriennummer),
    verfahren(B.sha256, nullwert()),
    // In der Nachricht steht dieselbe Liste als [0] IMPLICIT - derselbe Inhalt, andere Kennung.
    mitKennung(zerlegeEines(merkmaleAlsMenge), 0xa0),
    verfahrenDerUnterschrift,
    oktette(unterschrift),
  );

  const zertifikate = [auftrag.zertifikat, ...(auftrag.kette ?? [])];
  const kapsel = auftrag.eingeschlossen
    ? folge(oid(B.daten), huelle(0, oktette(auftrag.inhalt)))
    : folge(oid(B.daten));

  return folge(
    oid(B.signierteDaten),
    huelle(
      0,
      folge(
        kleineZahl(1),
        menge(verfahren(B.sha256, nullwert())),
        kapsel,
        mitKennung(zerlegeEines(menge(...zertifikate)), 0xa0),
        menge(unterzeichner),
      ),
    ),
  );
}

/**
 * Was dieses Programm entgegennehmen kann - für das Merkmal "Fähigkeiten".
 *
 * Die Reihenfolge ist die Aussage: Sie steht für die Vorliebe, vom Liebsten zum
 * Erträglichen. Wer uns schreibt, soll das Erste nehmen, das er auch kann.
 */
const UNSERE_FAEHIGKEITEN = [B.aes256Gcm, B.aes256Cbc, B.aes192Cbc, B.aes128Cbc];

/**
 * Wählt das Verfahren, mit dem an eine Runde von Empfängern verschlüsselt wird.
 *
 * GCM erkennt eine nachträgliche Veränderung des Geheimtextes, CBC nicht - und
 * unerkannte Veränderbarkeit ist genau das, worauf die EFAIL-Angriffe von 2018 aufsetzten.
 * GCM ist deshalb die erste Wahl. Sie lässt sich aber nur treffen, wenn JEDER Empfänger
 * damit umgehen kann: Ein einziger, der es nicht kann, bekommt sonst eine Nachricht, die
 * er nicht öffnen kann - und das ist der schlechtere Ausgang.
 *
 * Woher wir das wissen: aus den Fähigkeiten, die derselbe Empfänger in einer eigenen
 * unterschriebenen Nachricht mitgeschickt hat. Wer noch nie unterschrieben geschrieben
 * hat, gilt als unbekannt, und dann fällt die Wahl auf CBC.
 */
export function besteVerschluesselung(faehigkeitenJeEmpfaenger: readonly (readonly string[])[]): string {
  const alleKoennenGcm =
    faehigkeitenJeEmpfaenger.length > 0 &&
    faehigkeitenJeEmpfaenger.every((f) => f.includes(B.aes256Gcm));
  return alleKoennenGcm ? B.aes256Gcm : B.aes256Cbc;
}

export interface Verschluesseln {
  inhalt: Buffer;
  /** Die Zertifikate der Empfänger - der eigene gehört dazu, sonst liest man die eigene Kopie nie wieder. */
  empfaenger: readonly Buffer[];
  /** Vorgabe ist AES-256-CBC; siehe besteVerschluesselung(). */
  verfahren?: string;
}

export function baueUmschlag(auftrag: Verschluesseln): Buffer {
  if (auftrag.empfaenger.length === 0) {
    throw new CmsFehler('Ohne das Zertifikat des Empfängers lässt sich nichts verschlüsseln.');
  }
  const bezeichner = auftrag.verfahren ?? B.aes256Cbc;
  const wie = inhaltsVerfahren(bezeichner);
  if (!wie) throw new CmsFehler(`Unbekanntes Verfahren: ${benenne(bezeichner)}`);

  /*
   * Der Inhaltsschlüssel wird für jede Nachricht neu gezogen und nirgends behalten. Er
   * ist der einzige Wert, aus dem sich der Klartext ableiten lässt - alles andere in der
   * Nachricht ist ohne ihn nutzlos.
   */
  const inhaltsSchluessel = crypto.randomBytes(wie.schluesselBytes);
  const iv = crypto.randomBytes(wie.gcm ? 12 : 16);

  let geheim: Buffer;
  let parameter: Buffer;
  let pruefsumme: Buffer | undefined;
  if (wie.gcm) {
    const ci = crypto.createCipheriv(wie.name as crypto.CipherGCMTypes, inhaltsSchluessel, iv, {
      authTagLength: 16,
    });
    geheim = Buffer.concat([ci.update(auftrag.inhalt), ci.final()]);
    /*
     * Die Prüfsumme kommt NICHT hinten an den Geheimtext, sondern in ein eigenes Feld -
     * RFC 5083, und der Umschlag heißt dann auch anders. Genau daran ist die erste
     * Fassung dieser Zeile gescheitert: gebaut, selbst wieder gelesen, alles schien gut,
     * und OpenSSL hat sie abgelehnt.
     */
    pruefsumme = ci.getAuthTag();
    parameter = folge(oktette(iv), kleineZahl(16));
  } else {
    const ci = crypto.createCipheriv(wie.name, inhaltsSchluessel, iv);
    geheim = Buffer.concat([ci.update(auftrag.inhalt), ci.final()]);
    parameter = oktette(iv);
  }

  const empfaenger = auftrag.empfaenger.map((zert) => {
    const felder = felderVon(zert);
    const schluessel = new crypto.X509Certificate(zert).publicKey;
    const verpackt = crypto.publicEncrypt(
      { key: schluessel, padding: crypto.constants.RSA_PKCS1_PADDING },
      inhaltsSchluessel,
    );
    return folge(
      kleineZahl(0),
      folge(felder.aussteller, felder.seriennummer),
      verfahren(B.rsa, nullwert()),
      oktette(verpackt),
    );
  });

  const inhaltsteil = folge(
    oid(B.daten),
    verfahren(bezeichner, parameter),
    // encryptedContent ist [0] IMPLICIT OCTET STRING - also nur die Kennung getauscht.
    mitKennung(zerlegeEines(oktette(geheim)), ktxEinfach(0)),
  );

  return folge(
    oid(pruefsumme ? B.authUmschlageneDaten : B.umschlageneDaten),
    huelle(
      0,
      folge(
        kleineZahl(0),
        menge(...empfaenger),
        inhaltsteil,
        // Beim Umschlag mit Prüfsumme steht sie hier - hinter dem Inhalt, ohne authAttrs.
        ...(pruefsumme ? [oktette(pruefsumme)] : []),
      ),
    ),
  );
}

// --- Umschlag öffnen ---

export interface Empfaengerangabe {
  aussteller?: Buffer;
  seriennummer?: Buffer;
  schluesselKennung?: Buffer;
  verfahren: string;
  verschluesselterSchluessel: Buffer;
}

export interface Umschlag {
  /** Ob es der Umschlag mit Prüfsumme ist (RFC 5083). */
  authentisiert: boolean;
  empfaenger: Empfaengerangabe[];
  inhaltsVerfahrenBezeichner: string;
  parameter?: Buffer;
  geheimtext: Buffer;
  /** Nur beim authentisierten Umschlag: die Prüfsumme aus ihrem eigenen Feld. */
  pruefsumme?: Buffer;
  /** Ebenfalls nur dort: die mitgeschützten Merkmale, über die mitgerechnet wird. */
  merkmale?: Stueck;
}

export function leseUmschlag(der: Buffer): Umschlag {
  const [rumpf, typ] = inhaltVon(der, [B.umschlageneDaten, B.authUmschlageneDaten], 'Umschlag');
  const authentisiert = typ === B.authUmschlageneDaten;
  const daten = erwarte(rumpf, DER.SEQUENCE, 'EnvelopedData');
  const teile = zerlege(daten.inhalt);
  let i = 0;
  erwarte(teile[i++], DER.INTEGER, 'EnvelopedData: Fassung');
  if (teile[i]?.kennung === 0xa0) i++; // originatorInfo - hier ohne Belang

  const empfaengerMenge = erwarte(teile[i++], DER.SET, 'EnvelopedData: Empfänger');
  const empfaenger: Empfaengerangabe[] = [];
  for (const eintrag of zerlege(empfaengerMenge.inhalt)) {
    /*
     * Nur die Schlüsselübertragung (KeyTransRecipientInfo) wird gelesen. Die anderen
     * Formen - Schlüsseleinigung für elliptische Kurven, vorab verteilte Schlüssel -
     * sind eigene Verfahren. Sie zu übergehen ist richtig: Ein Empfänger, für den es
     * keinen passenden Eintrag gibt, bekommt eine klare Auskunft, statt dass hier etwas
     * halb Gelesenes weiterläuft.
     */
    if (eintrag.kennung !== DER.SEQUENCE) continue;
    const stuecke = zerlege(eintrag.inhalt);
    let j = 0;
    erwarte(stuecke[j++], DER.INTEGER, 'Empfänger: Fassung');

    const kennzeichen = stuecke[j++];
    const angabe: Partial<Empfaengerangabe> = {};
    if (kennzeichen?.kennung === DER.SEQUENCE) {
      const [aus, nr] = zerlege(kennzeichen.inhalt);
      angabe.aussteller = aus?.roh;
      angabe.seriennummer = nr?.roh;
    } else if (kennzeichen?.kennung === ktxEinfach(0)) {
      angabe.schluesselKennung = kennzeichen.inhalt;
    } else {
      continue;
    }

    const alg = zerlege(erwarte(stuecke[j++], DER.SEQUENCE, 'Empfänger: Verfahren').inhalt);
    empfaenger.push({
      ...angabe,
      verfahren: alsOid(erwarte(alg[0], DER.OID, 'Empfänger: Verfahren').inhalt),
      verschluesselterSchluessel: alsOktette(
        erwarte(stuecke[j++], DER.OCTET_STRING, 'Empfänger: Schlüssel'),
        'Schlüssel',
      ),
    });
  }

  const inhaltsteil = erwarte(teile[i++], DER.SEQUENCE, 'EnvelopedData: Inhalt');
  const inhaltsteile = zerlege(inhaltsteil.inhalt);
  const alg = zerlege(erwarte(inhaltsteile[1], DER.SEQUENCE, 'Inhaltsverfahren').inhalt);
  const geheim = inhaltsteile[2];
  if (!geheim) throw new CmsFehler('Der Umschlag ist leer.');

  // Beim authentisierten Umschlag folgen dahinter noch die Merkmale ([1], freiwillig)
  // und die Prüfsumme.
  const merkmale = authentisiert ? teile.slice(i).find((s) => s.kennung === 0xa1) : undefined;
  const pruefsumme = authentisiert
    ? teile.slice(i).find((s) => s.kennung === DER.OCTET_STRING)?.inhalt
    : undefined;
  if (authentisiert && !pruefsumme) throw new CmsFehler('Dem Umschlag fehlt die Prüfsumme.');

  return {
    authentisiert,
    empfaenger,
    inhaltsVerfahrenBezeichner: alsOid(erwarte(alg[0], DER.OID, 'Inhaltsverfahren').inhalt),
    parameter: alg[1]?.roh,
    geheimtext:
      geheim.kennung === ktxEinfach(0) ? geheim.inhalt : alsOktette(geheim, 'Geheimtext'),
    pruefsumme,
    merkmale,
  };
}

/** Ob ein Empfängereintrag zu einem eigenen Zertifikat gehört. */
export function empfaengerPasst(eintrag: Empfaengerangabe, zertifikat: Buffer): boolean {
  let felder;
  try {
    felder = felderVon(zertifikat);
  } catch {
    return false;
  }
  if (eintrag.schluesselKennung) {
    return (
      felder.schluesselKennung !== undefined &&
      felder.schluesselKennung.equals(eintrag.schluesselKennung)
    );
  }
  return (
    eintrag.aussteller !== undefined &&
    eintrag.seriennummer !== undefined &&
    felder.aussteller.equals(eintrag.aussteller) &&
    felder.seriennummer.equals(eintrag.seriennummer)
  );
}

/**
 * Öffnet einen Umschlag mit einem eigenen geheimen Schlüssel.
 *
 * ## Warum jeder Fehlschlag denselben Satz bekommt
 *
 * Weil ein Unterschied zwischen "die Auffüllung stimmt nicht" und "der Schlüssel hat die
 * falsche Länge" eine Auskunft ist, aus der sich der Klartext Bit für Bit erraten lässt -
 * das ist der Angriff von Bleichenbacher, und er ist über fünfundzwanzig Jahre alt und
 * immer noch wirksam. Wer Fehler unterscheidbar meldet, baut ihn sich selbst ein. Hier
 * gibt es deshalb genau eine Auskunft, und sie sagt nichts.
 */
export function oeffneUmschlag(
  umschlag: Umschlag,
  eintrag: Empfaengerangabe,
  schluessel: crypto.KeyObject,
): Buffer {
  const wie = inhaltsVerfahren(umschlag.inhaltsVerfahrenBezeichner);
  if (!wie) {
    throw new CmsFehler(
      `Diese Nachricht ist mit ${benenne(umschlag.inhaltsVerfahrenBezeichner)} verschlüsselt - das wird hier nicht gelesen.`,
    );
  }
  if (eintrag.verfahren !== B.rsa && eintrag.verfahren !== B.rsaOaep) {
    throw new CmsFehler(
      `Der Schlüssel wurde mit ${benenne(eintrag.verfahren)} übertragen - das wird hier nicht gelesen.`,
    );
  }

  let inhaltsSchluessel: Buffer;
  try {
    inhaltsSchluessel =
      eintrag.verfahren === B.rsaOaep
        ? crypto.privateDecrypt(
            { key: schluessel, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
            eintrag.verschluesselterSchluessel,
          )
        : crypto.privateDecrypt(
            { key: schluessel, padding: crypto.constants.RSA_PKCS1_PADDING },
            eintrag.verschluesselterSchluessel,
          );
  } catch {
    throw new CmsFehler('Die Nachricht ließ sich nicht öffnen.');
  }
  if (inhaltsSchluessel.length !== wie.schluesselBytes) {
    throw new CmsFehler('Die Nachricht ließ sich nicht öffnen.');
  }

  try {
    if (wie.gcm) {
      const [nonce, marke] = leseGcmParameter(umschlag.parameter);
      /*
       * Wo die Prüfsumme steht, entscheidet die Bauart des Umschlags. Im authentisierten
       * hat sie ein eigenes Feld (RFC 5083); im gewöhnlichen dürfte GCM gar nicht
       * vorkommen - kommt es doch vor, hängt sie erfahrungsgemäß hinten am Geheimtext,
       * und dann wird sie eben von dort genommen, statt die Nachricht abzuweisen.
       */
      const geheim = umschlag.pruefsumme
        ? umschlag.geheimtext
        : umschlag.geheimtext.subarray(0, umschlag.geheimtext.length - marke);
      const pruefsumme =
        umschlag.pruefsumme ?? umschlag.geheimtext.subarray(umschlag.geheimtext.length - marke);
      const de = crypto.createDecipheriv(
        wie.name as crypto.CipherGCMTypes,
        inhaltsSchluessel,
        nonce,
        { authTagLength: pruefsumme.length },
      );
      // Die mitgeschützten Merkmale zählen mit - als SET OF, dieselbe Regel wie bei der
      // Unterschrift. Fehlen sie, wird über nichts weiter gerechnet.
      if (umschlag.merkmale) de.setAAD(mitKennung(umschlag.merkmale, DER.SET));
      de.setAuthTag(pruefsumme);
      return Buffer.concat([de.update(geheim), de.final()]);
    }
    const iv = erwarte(zerlegeEines(umschlag.parameter ?? Buffer.alloc(0)), DER.OCTET_STRING, 'IV');
    const de = crypto.createDecipheriv(wie.name, inhaltsSchluessel, iv.inhalt);
    return Buffer.concat([de.update(umschlag.geheimtext), de.final()]);
  } catch (err) {
    if (err instanceof BerFehler) throw new CmsFehler('Die Nachricht ließ sich nicht öffnen.');
    throw new CmsFehler('Die Nachricht ließ sich nicht öffnen.');
  }
}

export function leseGcmParameter(roh: Buffer | undefined): [Buffer, number] {
  if (!roh) throw new CmsFehler('Der Nonce fehlt.');
  const teile = zerlege(zerlegeEines(roh).inhalt);
  const nonce = erwarte(teile[0], DER.OCTET_STRING, 'Nonce').inhalt;
  // Die Länge der Prüfsumme darf fehlen; dann sind es zwölf Bytes (RFC 5084).
  const laenge = teile[1] ? Number(BigInt('0x' + teile[1].inhalt.toString('hex'))) : 12;
  if (laenge < 12 || laenge > 16) throw new CmsFehler('Unbrauchbare Prüfsummenlänge.');
  return [nonce, laenge];
}
