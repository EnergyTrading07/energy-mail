import * as openpgp from 'openpgp';
import { beurteileSignatur, type Signaturbefund } from './pgpErkennung.js';
import { t } from './sprache.js';

/**
 * OpenPGP: unterschreiben, prüfen, verschlüsseln, entschlüsseln.
 *
 * Gerechnet wird ausschließlich mit OpenPGP.js. Kryptographie selbst zu schreiben ist
 * auch für Erfahrene ein Fehler; hier steht nur, was darum herum nötig ist - und das ist
 * gerade beim Deuten der Ergebnisse mehr, als man vermutet.
 *
 * Die wichtigste Regel dieses Moduls: eine Unterschrift, die aufgeht, sagt nur, dass der
 * Besitzer eines bestimmten Schlüssels sie geleistet hat. Ob dieser Schlüssel dem
 * Absender gehört, ist eine andere Frage - und sie lässt sich nicht rechnen, nur
 * feststellen. Die Beurteilung dieses Unterschieds liegt in pgpErkennung.ts und ist dort
 * für sich geprüft.
 */

export interface SchluesselAngaben {
  /** Der Fingerabdruck in Großbuchstaben - die einzige verlässliche Kennung. */
  fingerabdruck: string;
  /** Die kurze Form, wie man sie sich zuruft. Zum Wiedererkennen, nicht zum Prüfen. */
  kennung: string;
  /** Adressen, die der Schlüssel für sich beansprucht. */
  adressen: string[];
  /** Namen aus den Benutzerkennungen. */
  namen: string[];
  /** Ob ein geheimer Teil dabei ist - dann kann man damit unterschreiben und lesen. */
  geheim: boolean;
  abgelaufen: boolean;
  zurueckgezogen: boolean;
  /** Wann er abläuft; fehlt, wenn er unbegrenzt gilt. */
  laeuftAb?: string;
  erzeugtAm?: string;
}

/** Zerlegt eine Benutzerkennung ("Anna Müller <anna@firma.de>") in ihre Teile. */
function ausBenutzerkennung(roh: string): { name?: string; adresse?: string } {
  const t = /^(.*?)\s*<([^>]+)>\s*$/.exec(roh.trim());
  if (t) return { name: t[1]?.trim() || undefined, adresse: t[2]?.trim().toLowerCase() };
  return roh.includes('@') ? { adresse: roh.trim().toLowerCase() } : { name: roh.trim() };
}

async function beschreibe(schluessel: openpgp.Key): Promise<SchluesselAngaben> {
  const adressen: string[] = [];
  const namen: string[] = [];
  for (const kennung of schluessel.getUserIDs()) {
    const { name, adresse } = ausBenutzerkennung(kennung);
    if (adresse && !adressen.includes(adresse)) adressen.push(adresse);
    if (name && !namen.includes(name)) namen.push(name);
  }

  // getExpirationTime() liefert Infinity bei unbegrenzter Gültigkeit und null, wenn der
  // Schlüssel zurückgezogen wurde - beides ist kein Datum.
  let ablauf: Date | number | null = null;
  try {
    ablauf = await schluessel.getExpirationTime();
  } catch {
    // Ein unbrauchbarer Schlüssel hat keine Gültigkeit - das ist keine Ausnahme wert.
  }
  const alsDatum = ablauf instanceof Date ? ablauf : null;

  const fingerabdruck = schluessel.getFingerprint().toUpperCase();
  return {
    fingerabdruck,
    kennung: fingerabdruck.slice(-16),
    adressen,
    namen,
    geheim: schluessel.isPrivate(),
    abgelaufen: alsDatum !== null && alsDatum.getTime() < Date.now(),
    zurueckgezogen: await schluessel.isRevoked().catch(() => false),
    laeuftAb: alsDatum?.toISOString(),
    erzeugtAm: schluessel.getCreationTime().toISOString(),
  };
}

export class PgpFehler extends Error {}

/**
 * Liest einen oder mehrere Schlüssel aus einem Textblock.
 *
 * Eine Schlüsseldatei enthält oft mehrere - etwa beim Ausführen eines ganzen Bundes.
 * Öffentliche und geheime werden beide angenommen; was es ist, steht in "geheim".
 */
export async function leseSchluessel(
  armored: string,
): Promise<{ angaben: SchluesselAngaben; armored: string }[]> {
  const roh = armored.trim();
  if (!roh) throw new PgpFehler('Der Text enthält keinen Schlüssel.');

  const geheim = roh.includes('BEGIN PGP PRIVATE KEY BLOCK');
  try {
    const schluessel = geheim
      ? await openpgp.readPrivateKeys({ armoredKeys: roh })
      : await openpgp.readKeys({ armoredKeys: roh });
    if (schluessel.length === 0) throw new PgpFehler('Der Text enthält keinen Schlüssel.');

    return Promise.all(
      schluessel.map(async (s) => ({ angaben: await beschreibe(s), armored: s.armor() })),
    );
  } catch (err) {
    if (err instanceof PgpFehler) throw err;
    throw new PgpFehler(`Der Schlüssel ließ sich nicht lesen: ${(err as Error).message}`);
  }
}

/**
 * Schließt einen geheimen Schlüssel mit seinem Kennwort auf.
 *
 * Nicht jeder geheime Schlüssel ist verschlossen; wer keines gesetzt hat, braucht auch
 * keines. Ein falsches Kennwort wird als solches gemeldet und nicht als allgemeiner
 * Fehler - das ist der mit Abstand häufigste Grund.
 */
async function schliesseAuf(armored: string, kennwort?: string): Promise<openpgp.PrivateKey> {
  const schluessel = await openpgp.readPrivateKey({ armoredKey: armored });
  if (schluessel.isDecrypted()) return schluessel;

  if (!kennwort) throw new PgpFehler('Für diesen Schlüssel wird das Kennwort gebraucht.');
  try {
    return await openpgp.decryptKey({ privateKey: schluessel, passphrase: kennwort });
  } catch {
    throw new PgpFehler('Das Kennwort des Schlüssels stimmt nicht.');
  }
}

/** Prüft, ob ein Kennwort zu einem geheimen Schlüssel passt - ohne etwas zu verändern. */
export async function pruefeKennwort(armored: string, kennwort: string): Promise<boolean> {
  try {
    await schliesseAuf(armored, kennwort);
    return true;
  } catch {
    return false;
  }
}

/** Ein Schlüssel, wie ihn der Schlüsselbund vorhält. */
export interface BundSchluessel {
  armored: string;
  angaben: SchluesselAngaben;
}

/**
 * Prüft eine abgetrennte Unterschrift (PGP/MIME).
 *
 * "inhalt" muss byteweise das sein, was unterschrieben wurde - bei PGP/MIME also der
 * gesamte Teil samt seiner Kopfzeilen und mit CRLF als Zeilenende. Wird hier auch nur
 * ein Zeilenende umgeschrieben, schlägt die Prüfung fehl, obwohl alles in Ordnung ist.
 */
export async function pruefeAbgetrennteSignatur(
  inhalt: Uint8Array | string,
  signatur: string,
  moeglicheSchluessel: readonly BundSchluessel[],
  absender?: string,
): Promise<Signaturbefund> {
  try {
    const nachricht =
      typeof inhalt === 'string'
        ? await openpgp.createMessage({ text: inhalt })
        : await openpgp.createMessage({ binary: inhalt });
    const unterschrift = await openpgp.readSignature({ armoredSignature: signatur });

    // Wer hat unterschrieben? Steht in der Unterschrift selbst - danach wird der
    // passende Schlüssel gesucht.
    const kennungen = unterschrift.packets.map((p) =>
      'issuerKeyID' in p && p.issuerKeyID ? p.issuerKeyID.toHex().toUpperCase() : '',
    );
    const passend = moeglicheSchluessel.filter((s) =>
      kennungen.some((k) => k && s.angaben.fingerabdruck.endsWith(k)),
    );

    if (passend.length === 0) {
      return {
        vertrauen: 'schluessel-fehlt',
        fingerabdruck: kennungen.find(Boolean) || undefined,
        grund: t('Der Schlüssel des Unterzeichners liegt nicht vor.'),
      };
    }

    const schluessel = await Promise.all(
      passend.map((s) => openpgp.readKey({ armoredKey: s.armored })),
    );
    const ergebnis = await openpgp.verify({
      message: nachricht,
      signature: unterschrift,
      verificationKeys: schluessel,
      // Ein abgelaufener Schlüssel soll nicht zu "Unterschrift falsch" führen - das ist
      // etwas anderes und wird unten getrennt gemeldet.
      expectSigned: false,
      config: { allowInsecureVerificationWithReformattedKeys: false },
    });

    const erste = ergebnis.signatures[0];
    let stimmt = false;
    let grund: string | undefined;
    try {
      stimmt = await erste!.verified;
    } catch (err) {
      grund = (err as Error).message;
    }

    const genutzt = passend[0]!;
    return {
      vertrauen: beurteileSignatur({
        stimmt,
        schluesselBekannt: true,
        schluesselAbgelaufen: genutzt.angaben.abgelaufen,
        schluesselZurueckgezogen: genutzt.angaben.zurueckgezogen,
        absender,
        schluesselAdressen: genutzt.angaben.adressen,
      }),
      fingerabdruck: genutzt.angaben.fingerabdruck,
      schluesselAdressen: genutzt.angaben.adressen,
      grund,
    };
  } catch (err) {
    return { vertrauen: 'ungueltig', grund: (err as Error).message };
  }
}

export interface Entschluesselt {
  /** Der Klartext. */
  text: string;
  /** Ob die Nachricht zusätzlich unterschrieben war und wie es darum steht. */
  signatur?: Signaturbefund;
}

/**
 * Entschlüsselt eine Nachricht und prüft dabei eine eingeschlossene Unterschrift.
 *
 * Beides in einem Zug, und das ist wichtig: eine Unterschrift innerhalb des Geheimtextes
 * ist die einzige, die etwas beweist. Eine außerhalb ließe sich austauschen, ohne den
 * Inhalt zu berühren.
 */
export async function entschluessle(
  geheimtext: string,
  eigeneSchluessel: readonly { armored: string; kennwort?: string }[],
  moeglicheUnterzeichner: readonly BundSchluessel[] = [],
  absender?: string,
): Promise<Entschluesselt> {
  const nachricht = await openpgp
    .readMessage({ armoredMessage: geheimtext })
    .catch(() => null);
  if (!nachricht) throw new PgpFehler('Das ist keine lesbare OpenPGP-Nachricht.');

  const aufgeschlossen: openpgp.PrivateKey[] = [];
  const fehler: string[] = [];
  for (const eigener of eigeneSchluessel) {
    try {
      aufgeschlossen.push(await schliesseAuf(eigener.armored, eigener.kennwort));
    } catch (err) {
      fehler.push((err as Error).message);
    }
  }
  if (aufgeschlossen.length === 0) {
    throw new PgpFehler(
      fehler[0] ?? t('Für diese Nachricht liegt kein passender geheimer Schlüssel vor.'),
    );
  }

  const pruefSchluessel = await Promise.all(
    moeglicheUnterzeichner.map((s) => openpgp.readKey({ armoredKey: s.armored })),
  );

  let ergebnis;
  try {
    ergebnis = await openpgp.decrypt({
      message: nachricht,
      decryptionKeys: aufgeschlossen,
      verificationKeys: pruefSchluessel.length > 0 ? pruefSchluessel : undefined,
      expectSigned: false,
    });
  } catch (err) {
    throw new PgpFehler(`Die Nachricht ließ sich nicht entschlüsseln: ${(err as Error).message}`);
  }

  const text =
    typeof ergebnis.data === 'string'
      ? ergebnis.data
      : Buffer.from(ergebnis.data as Uint8Array).toString('utf8');

  const erste = ergebnis.signatures[0];
  if (!erste) return { text };

  let stimmt = false;
  let grund: string | undefined;
  try {
    stimmt = await erste.verified;
  } catch (err) {
    grund = (err as Error).message;
  }

  const kennung = erste.keyID.toHex().toUpperCase();
  const genutzt = moeglicheUnterzeichner.find((s) =>
    s.angaben.fingerabdruck.endsWith(kennung),
  );

  return {
    text,
    signatur: genutzt
      ? {
          vertrauen: beurteileSignatur({
            stimmt,
            schluesselBekannt: true,
            schluesselAbgelaufen: genutzt.angaben.abgelaufen,
            schluesselZurueckgezogen: genutzt.angaben.zurueckgezogen,
            absender,
            schluesselAdressen: genutzt.angaben.adressen,
          }),
          fingerabdruck: genutzt.angaben.fingerabdruck,
          schluesselAdressen: genutzt.angaben.adressen,
          grund,
        }
      : {
          vertrauen: 'schluessel-fehlt',
          fingerabdruck: kennung,
          grund: t('Der Schlüssel des Unterzeichners liegt nicht vor.'),
        },
  };
}

/** Unterschreibt einen Text und liefert die abgetrennte Unterschrift (für PGP/MIME). */
export async function signiereAbgetrennt(
  inhalt: string,
  eigenerSchluessel: string,
  kennwort?: string,
): Promise<string> {
  const schluessel = await schliesseAuf(eigenerSchluessel, kennwort);
  const nachricht = await openpgp.createMessage({ text: inhalt });
  const signatur = await openpgp.sign({
    message: nachricht,
    signingKeys: schluessel,
    detached: true,
    format: 'armored',
  });
  return signatur as string;
}

/**
 * Verschlüsselt einen Text für die angegebenen Empfänger und unterschreibt ihn dabei.
 *
 * Der eigene Schlüssel gehört mit unter die Empfänger - ohne ihn ließe sich die eigene
 * Kopie im Gesendet-Ordner nicht mehr lesen. Das ist keine Nachlässigkeit, sondern das
 * übliche Vorgehen; jedes Programm macht es so.
 */
export async function verschluessle(
  inhalt: string,
  empfaengerSchluessel: readonly string[],
  eigenerSchluessel?: { armored: string; kennwort?: string },
): Promise<string> {
  if (empfaengerSchluessel.length === 0) {
    throw new PgpFehler('Ohne den Schlüssel des Empfängers lässt sich nichts verschlüsseln.');
  }

  const empfaenger = await Promise.all(
    empfaengerSchluessel.map((a) => openpgp.readKey({ armoredKey: a })),
  );
  const eigener = eigenerSchluessel
    ? await schliesseAuf(eigenerSchluessel.armored, eigenerSchluessel.kennwort)
    : undefined;

  const geheim = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: inhalt }),
    encryptionKeys: eigener ? [...empfaenger, eigener.toPublic()] : empfaenger,
    signingKeys: eigener,
    format: 'armored',
  });
  return geheim as string;
}

/**
 * Erzeugt ein neues Schlüsselpaar.
 *
 * Voreinstellung ist RSA, und das ist eine Notlösung mit gutem Grund: in Electron
 * scheitert das Verschlüsseln mit elliptischen Kurven. Nachgemessen in Electron 38.8.6
 * (Node 22.22) mit OpenPGP.js 6.3.1 - Curve25519 wie nistP256 brechen mit "The operation
 * failed for an operation-specific reason" ab, während Unterschreiben mit beiden geht und
 * RSA vollständig funktioniert. Unter reinem Node laufen alle drei.
 *
 * Ein Schlüssel, mit dem sich nichts verschlüsseln lässt, wäre die schlechtere Wahl -
 * auch wenn Curve25519 sonst überall die heute übliche ist. Einlesen lassen sich solche
 * Schlüssel weiterhin; nur erzeugt werden sie hier nicht.
 */
export async function erzeugeSchluesselpaar(optionen: {
  name?: string;
  adresse: string;
  kennwort?: string;
  art?: 'curve25519' | 'rsa4096';
}): Promise<{ geheim: string; oeffentlich: string; angaben: SchluesselAngaben }> {
  const erzeugt = await openpgp.generateKey({
    userIDs: [{ name: optionen.name, email: optionen.adresse }],
    passphrase: optionen.kennwort,
    format: 'armored',
    ...(optionen.art === 'curve25519'
      ? ({ type: 'ecc', curve: 'curve25519Legacy' } as const)
      : ({ type: 'rsa', rsaBits: 4096 } as const)),
  });

  return {
    geheim: erzeugt.privateKey,
    oeffentlich: erzeugt.publicKey,
    angaben: await beschreibe(await openpgp.readKey({ armoredKey: erzeugt.publicKey })),
  };
}
