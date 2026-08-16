import {
  beschreibeZertifikat,
  beurteileSmime,
  erkenneSmime,
  gehoertZuZertifikat,
  getRawMessageBytes,
  leseSignierteDaten,
  leseUmschlag,
  oeffneUmschlag,
  pruefeKette,
  pruefeUnterzeichner,
  empfaengerPasst,
  type AccountConfig,
  type FullMessage,
  type SmimeSignaturbefund,
  type Unterzeichner,
} from '@energy-mail/mail-core';
import { simpleParser } from 'mailparser';
import { eigeneFuer, merkeFremdes, zertifikateFuer } from './smimeStore.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Wendet S/MIME auf eine geladene Nachricht an: Unterschrift prüfen, Umschlag öffnen.
 *
 * Dieselbe Aufteilung wie bei OpenPGP und aus demselben Grund: mail-core weiß, wie man
 * rechnet und wie man erkennt; hier kommt beides mit dem Zertifikatsspeicher zusammen.
 * Und dieselbe Regel zieht sich durch - im Zweifel wird nichts behauptet.
 *
 * ## Was hier zusätzlich passiert
 *
 * Aus einer Nachricht, deren Unterschrift restlos aufgegangen ist, wird das Zertifikat
 * des Absenders in den Speicher übernommen. Das ist der Weg, auf dem S/MIME in der Praxis
 * überhaupt in Gang kommt: Ohne ihn müsste jeder Nutzer für jeden Gesprächspartner von
 * Hand ein Zertifikat besorgen, und dann tut es niemand.
 *
 * "Restlos" heißt: Unterschrift geht auf, Kette trägt bis zu einer bekannten Wurzel, und
 * die Adresse im Zertifikat ist die des Absenders. Alles andere wäre gefährlich - wer ein
 * Zertifikat auf eine fremde Adresse mitschickt, bekäme sonst die Post, die dieser
 * Adresse gilt.
 */

export interface SmimeBefund {
  verschluesselt: boolean;
  geoeffnet: boolean;
  /** Der Klartext, wenn er vorliegt - bei verschlüsselter oder eingeschlossener Form. */
  klartext?: string;
  /** Dasselbe formatiert, falls der Absender es so geschickt hat. */
  html?: string;
  signatur?: SmimeSignaturbefund;
  /** Ob das Zertifikat des Absenders neu in den Speicher aufgenommen wurde. */
  zertifikatGelernt?: boolean;
  grund?: string;
}

/**
 * Prüft und öffnet, was an einer Nachricht mit S/MIME geschützt ist.
 *
 * Gibt `undefined` zurück, wenn nichts davon vorliegt - dann ist es eine gewöhnliche
 * Nachricht und die Oberfläche zeigt nichts an.
 */
export async function pruefeSmime(
  account: AccountConfig,
  folder: string,
  nachricht: FullMessage,
  kennwort?: string,
): Promise<SmimeBefund | undefined> {
  const absender = nachricht.from[0]?.address?.toLowerCase();

  /*
   * Die ganze Nachricht, roh. Bei S/MIME führt kein Weg daran vorbei: Unterschrieben ist
   * eine Bytefolge samt Kopfzeilen, und die bekommt man nur so - siehe den Kopf von
   * smime/nachricht.ts.
   */
  let roh: Buffer;
  try {
    roh = await getRawMessageBytes(account, folder, nachricht.uid);
  } catch (err) {
    return { verschluesselt: false, geoeffnet: false, grund: (err as Error).message };
  }

  const art = erkenneSmime(roh);
  if (art.art === 'keine') return undefined;

  if (art.art === 'nur-zertifikate') {
    /*
     * Eine Nachricht, die nichts als ein Zertifikat enthält. Gelernt wird daraus NICHTS:
     * Hier hat niemand etwas unterschrieben, es ist eine bloße Behauptung. Sie anzunehmen
     * hieße, jedem zu glauben, der ein Zertifikat auf eine fremde Adresse schickt.
     */
    return {
      verschluesselt: false,
      geoeffnet: true,
      grund: t('Diese Nachricht enthält nur ein Zertifikat. Es wurde nicht übernommen - dazu müsste sie unterschrieben sein.'),
    };
  }

  if (art.art === 'verschluesselt') {
    return oeffne(account, art.umschlag, absender, kennwort);
  }

  if (art.art === 'signiert') {
    const befund = pruefeSignatur(art.signatur, art.unterschriebeneBytes, absender);
    return {
      verschluesselt: false,
      geoeffnet: true,
      signatur: befund.signatur,
      zertifikatGelernt: befund.gelernt,
    };
  }

  // Eingeschlossen: Inhalt und Unterschrift in einem Paket.
  return oeffneEingeschlossen(art.signatur, absender);
}

/** Prüft eine abgetrennte oder eingeschlossene Unterschrift. */
function pruefeSignatur(
  signatur: Buffer,
  inhalt: Buffer,
  absender: string | undefined,
  jetzt = new Date(),
): { signatur: SmimeSignaturbefund; gelernt?: boolean } {
  let daten;
  try {
    daten = leseSignierteDaten(signatur);
  } catch (err) {
    return { signatur: { vertrauen: 'ungueltig', grund: (err as Error).message } };
  }

  const unterzeichner = daten.unterzeichner[0];
  if (!unterzeichner) {
    return { signatur: { vertrauen: 'nicht-pruefbar', grund: t('Es hat niemand unterschrieben.') } };
  }

  const zertifikat = findeZertifikat(unterzeichner, daten.zertifikate, absender);
  if (!zertifikat) {
    return {
      signatur: {
        vertrauen: 'nicht-pruefbar',
        grund: t('Das Zertifikat des Unterzeichners liegt nicht vor.'),
        zeitpunkt: unterzeichner.zeitpunkt?.toISOString(),
      },
    };
  }

  const rechnung = pruefeUnterzeichner(unterzeichner, inhalt, zertifikat);
  const angaben = beschreibeZertifikat(zertifikat);
  const kette = pruefeKette(zertifikat, daten.zertifikate, jetzt);

  const vertrauen = beurteileSmime({
    stimmt: rechnung.stimmt,
    zertifikatVorhanden: true,
    verfahrenAnerkannt: !(rechnung.stimmt === false && rechnung.verfahrenFehlt === true),
    kette,
    fuerMail: angaben.fuerMail,
    absender,
    zertifikatAdressen: angaben.adressen,
  });

  const befund: SmimeSignaturbefund = {
    vertrauen,
    fingerabdruck: angaben.fingerabdruck,
    name: angaben.name,
    zertifikatAdressen: angaben.adressen,
    aussteller: angaben.aussteller,
    kette: kette.lage === 'vertraut' || kette.lage === 'wurzel-unbekannt' ? kette.ueber : undefined,
    giltBis: angaben.giltBis,
    zeitpunkt: unterzeichner.zeitpunkt?.toISOString(),
    grund: rechnung.stimmt
      ? kette.lage === 'wurzel-unbekannt'
        ? t('Für dieses Zertifikat steht keine bekannte Stelle gerade.')
        : kette.lage === 'gebrochen' || kette.lage === 'zeitlich-ungueltig'
          ? kette.grund
          : undefined
      : rechnung.grund,
  };

  /*
   * Gelernt wird nur bei "gueltig" - also wenn wirklich alles zusammenpasst. Jede
   * schwächere Stufe hieße, ein Zertifikat aufzunehmen, dessen Zugehörigkeit zu dieser
   * Adresse gerade NICHT feststeht. Und der Speicher entscheidet später darüber, wohin
   * verschlüsselte Post geht.
   */
  const gelernt =
    vertrauen === 'gueltig' && merkeFremdes(zertifikat, unterzeichner.faehigkeiten) !== null;
  return { signatur: befund, gelernt };
}

/**
 * Sucht das Zertifikat des Unterzeichners.
 *
 * Erst in der Nachricht - dort schickt es fast jeder mit -, dann im eigenen Speicher.
 * Die Reihenfolge ist gleichgültig für das Ergebnis: Zugeordnet wird über Aussteller und
 * Seriennummer, und die passen entweder oder nicht. Ein untergeschobenes Zertifikat kann
 * die Prüfung nicht bestehen, weil es den geheimen Schlüssel dazu nicht gibt.
 */
function findeZertifikat(
  unterzeichner: Unterzeichner,
  ausDerNachricht: readonly Buffer[],
  absender: string | undefined,
): Buffer | null {
  const inNachricht = ausDerNachricht.find((z) => gehoertZuZertifikat(unterzeichner, z));
  if (inNachricht) return inNachricht;
  if (!absender) return null;
  const gespeichert = zertifikateFuer(absender).find((z) =>
    gehoertZuZertifikat(unterzeichner, z.zertifikat),
  );
  return gespeichert?.zertifikat ?? null;
}

/** Öffnet einen Umschlag mit den eigenen Schlüsseln. */
async function oeffne(
  account: AccountConfig,
  umschlagBytes: Buffer,
  absender: string | undefined,
  kennwort?: string,
): Promise<SmimeBefund> {
  const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
  const eigene = eigeneFuer(account.id, adressen);
  if (eigene.length === 0) {
    return {
      verschluesselt: true,
      geoeffnet: false,
      grund: t('Für dieses Konto ist kein eigenes Zertifikat hinterlegt.'),
    };
  }

  let umschlag;
  try {
    umschlag = leseUmschlag(umschlagBytes);
  } catch (err) {
    return { verschluesselt: true, geoeffnet: false, grund: (err as Error).message };
  }

  for (const eigenes of eigene) {
    const eintrag = umschlag.empfaenger.find((e) => empfaengerPasst(e, eigenes.zertifikat));
    if (!eintrag) continue;
    let klar: Buffer;
    try {
      klar = oeffneUmschlag(umschlag, eintrag, eigenes.schluessel(kennwort));
    } catch (err) {
      return { verschluesselt: true, geoeffnet: false, grund: (err as Error).message };
    }

    /*
     * Der geöffnete Inhalt ist selbst wieder eine MIME-Einheit - und die darf
     * unterschrieben sein. Genau so verschickt man beides zugleich, und nur die INNERE
     * Unterschrift beweist etwas: eine äußere ließe sich austauschen, ohne den Inhalt zu
     * berühren.
     */
    const innen = erkenneSmime(klar);
    if (innen.art === 'signiert') {
      const befund = pruefeSignatur(innen.signatur, innen.unterschriebeneBytes, absender);
      const anzeige = await alsAnzeige(klar);
      return {
        verschluesselt: true,
        geoeffnet: true,
        ...anzeige,
        signatur: befund.signatur,
        zertifikatGelernt: befund.gelernt,
      };
    }
    if (innen.art === 'signiert-eingeschlossen') {
      const befund = await oeffneEingeschlossen(innen.signatur, absender);
      return { ...befund, verschluesselt: true };
    }

    return { verschluesselt: true, geoeffnet: true, ...(await alsAnzeige(klar)) };
  }

  return {
    verschluesselt: true,
    geoeffnet: false,
    grund: t('Diese Nachricht ist nicht an eines der hinterlegten Zertifikate gerichtet.'),
  };
}

/** Die eingeschlossene Form: Inhalt und Unterschrift stecken in einem Paket. */
async function oeffneEingeschlossen(
  signatur: Buffer,
  absender: string | undefined,
): Promise<SmimeBefund> {
  let inhalt: Buffer | undefined;
  try {
    inhalt = leseSignierteDaten(signatur).inhalt;
  } catch (err) {
    return {
      verschluesselt: false,
      geoeffnet: false,
      signatur: { vertrauen: 'ungueltig', grund: (err as Error).message },
    };
  }
  if (!inhalt) {
    return {
      verschluesselt: false,
      geoeffnet: false,
      grund: t('In diesem Paket steht kein Inhalt.'),
    };
  }

  const befund = pruefeSignatur(signatur, inhalt, absender);
  return {
    verschluesselt: false,
    geoeffnet: true,
    ...(await alsAnzeige(inhalt)),
    signatur: befund.signatur,
    zertifikatGelernt: befund.gelernt,
  };
}

/**
 * Macht aus einer MIME-Einheit etwas Anzeigbares.
 *
 * Über mailparser, und nicht von Hand: Was hier ankommt, kann alles sein - eine einzelne
 * Textzeile, eine mehrteilige Nachricht mit Bildern, irgendeine Kodierung, irgendein
 * Zeichensatz. Das noch einmal selbst zu schreiben, während im selben Programm ein
 * geprüfter Leser dafür liegt, wäre die falsche Sorte Ehrgeiz.
 */
async function alsAnzeige(mime: Buffer): Promise<{ klartext?: string; html?: string }> {
  try {
    const gelesen = await simpleParser(mime);
    return {
      klartext: gelesen.text ?? undefined,
      html: typeof gelesen.html === 'string' ? gelesen.html : undefined,
    };
  } catch {
    return { klartext: mime.toString('utf8') };
  }
}
