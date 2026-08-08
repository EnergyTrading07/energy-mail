import {
  entschluessle,
  erkenneInlineSchutz,
  erkenneMimeSchutz,
  getRawMessageBytes,
  leseGrenze,
  pruefeAbgetrennteSignatur,
  schneideSigniertenTeil,
  type AccountConfig,
  type FullMessage,
  type MimeKnoten,
  type Signaturbefund,
} from '@energy-mail/mail-core';
import { alleOeffentlichen, geheimeFuer } from './schluesselbund.js';

/**
 * Wendet OpenPGP auf eine geladene Nachricht an: Unterschrift prüfen, Geheimtext öffnen.
 *
 * Die Aufteilung ist Absicht. mail-core weiß, wie man rechnet und wie man erkennt; hier
 * kommt beides mit dem Schlüsselbund zusammen. Was der Nutzer am Ende sieht - Schloss,
 * Warnung oder gar nichts - entsteht hier.
 *
 * Eine Regel zieht sich durch: im Zweifel wird nichts behauptet. Lieber "die Unterschrift
 * ließ sich nicht prüfen" als ein Haken, der nichts bedeutet.
 */

export interface PgpBefund {
  /** Ob die Nachricht verschlüsselt ankam. */
  verschluesselt: boolean;
  /** Ob sie sich öffnen ließ. */
  geoeffnet: boolean;
  /** Der entschlüsselte Text, sofern er vorliegt. */
  klartext?: string;
  signatur?: Signaturbefund;
  /**
   * Bei Inline-PGP: ob die Unterschrift den ganzen angezeigten Text abdeckt. Tut sie es
   * nicht, ist sie praktisch wertlos - ein Angreifer kann daneben schreiben, was er will.
   */
  deckungGanzerText?: boolean;
  /** Warum es nicht ging, in Worten. */
  grund?: string;
}

/** Die Kopfzeile Content-Type der gesamten Nachricht, aus dem Rohtext. */
function contentTypeAusRoh(roh: Buffer): string | undefined {
  // Nur der Kopf, und der endet bei der ersten Leerzeile.
  const kopfEnde = roh.indexOf('\r\n\r\n');
  const kopf = roh.subarray(0, kopfEnde < 0 ? Math.min(roh.length, 8192) : kopfEnde).toString('utf8');

  const zeilen = kopf.split(/\r?\n/);
  let gesammelt: string | null = null;
  for (const zeile of zeilen) {
    if (gesammelt !== null) {
      // Fortsetzungszeilen sind eingerückt und gehören zur vorigen.
      if (/^[ \t]/.test(zeile)) {
        gesammelt += ' ' + zeile.trim();
        continue;
      }
      return gesammelt;
    }
    const t = /^content-type:\s*(.*)$/i.exec(zeile);
    if (t) gesammelt = t[1]!.trim();
  }
  return gesammelt ?? undefined;
}

/**
 * Prüft und öffnet, was an einer Nachricht mit OpenPGP geschützt ist.
 *
 * "kennwort" wird nur durchgereicht und nirgends festgehalten. Fehlt es bei einem
 * verschlossenen Schlüssel, wird das gemeldet - die Oberfläche fragt dann danach.
 */
export async function pruefePgp(
  account: AccountConfig,
  folder: string,
  nachricht: FullMessage,
  struktur: unknown,
  kennwort?: string,
): Promise<PgpBefund | undefined> {
  const absender = nachricht.from[0]?.address?.toLowerCase();
  const mime = erkenneMimeSchutz(struktur as MimeKnoten | undefined);

  if (mime.art === 'mime-signiert') {
    const roh = await getRawMessageBytes(account, folder, nachricht.uid);
    const grenze = leseGrenze(contentTypeAusRoh(roh));
    const teil = grenze ? schneideSigniertenTeil(roh, grenze) : null;
    if (!teil) {
      return {
        verschluesselt: false,
        geoeffnet: true,
        signatur: {
          vertrauen: 'ungueltig',
          grund: 'Der unterschriebene Teil ließ sich nicht aus der Nachricht herauslösen.',
        },
      };
    }

    // Die Unterschrift selbst steht im zweiten Teil.
    const signatur = await holeTeilAlsText(account, folder, nachricht.uid, mime.signaturTeil);
    if (!signatur) {
      return {
        verschluesselt: false,
        geoeffnet: true,
        signatur: { vertrauen: 'ungueltig', grund: 'Die Unterschrift fehlt in der Nachricht.' },
      };
    }

    return {
      verschluesselt: false,
      geoeffnet: true,
      signatur: await pruefeAbgetrennteSignatur(teil, signatur, alleOeffentlichen(), absender),
    };
  }

  if (mime.art === 'mime-verschluesselt') {
    const geheimtext = await holeTeilAlsText(account, folder, nachricht.uid, mime.geheimTeil);
    if (!geheimtext) {
      return { verschluesselt: true, geoeffnet: false, grund: 'Der Geheimtext fehlt.' };
    }
    return oeffne(account, geheimtext, absender, kennwort);
  }

  // Inline: der Schutz steckt im Text selbst.
  const text = typeof nachricht.text === 'string' ? nachricht.text : undefined;
  const inline = erkenneInlineSchutz(text);

  if (inline.art === 'inline-verschluesselt') {
    return oeffne(account, text!, absender, kennwort);
  }

  if (inline.art === 'inline-signiert') {
    const befund = await entschluessleOderPruefeInline(text!, absender);
    return {
      verschluesselt: false,
      geoeffnet: true,
      klartext: befund.klartext,
      signatur: befund.signatur,
      deckungGanzerText: inline.vollstaendig,
    };
  }

  return undefined;
}

/** Holt einen Teil der Nachricht als Text - für Unterschrift und Geheimtext. */
async function holeTeilAlsText(
  account: AccountConfig,
  folder: string,
  uid: number,
  partId: string,
): Promise<string | null> {
  const { downloadAttachment } = await import('@energy-mail/mail-core');
  try {
    const teil = await downloadAttachment(account, folder, uid, partId);
    return teil.content.toString('utf8');
  } catch {
    return null;
  }
}

/** Öffnet einen Geheimtext mit den eigenen Schlüsseln. */
async function oeffne(
  account: AccountConfig,
  geheimtext: string,
  absender: string | undefined,
  kennwort?: string,
): Promise<PgpBefund> {
  const eigene = geheimeFuer(account.id, [
    account.email,
    ...(account.identitaeten ?? []).map((i) => i.email),
  ]);
  if (eigene.length === 0) {
    return {
      verschluesselt: true,
      geoeffnet: false,
      grund: 'Für dieses Konto ist kein geheimer Schlüssel hinterlegt.',
    };
  }

  try {
    const auf = await entschluessle(
      geheimtext,
      eigene.map((armored) => ({ armored, kennwort })),
      alleOeffentlichen(),
      absender,
    );
    return {
      verschluesselt: true,
      geoeffnet: true,
      klartext: auf.text,
      signatur: auf.signatur,
    };
  } catch (err) {
    return { verschluesselt: true, geoeffnet: false, grund: (err as Error).message };
  }
}

/**
 * Prüft einen inline unterschriebenen Block und gibt den Klartext zurück.
 *
 * OpenPGP.js liest den Klartextblock selbst; herausgelöst wird nur, was zwischen den
 * Marken steht.
 */
async function entschluessleOderPruefeInline(
  text: string,
  absender: string | undefined,
): Promise<{ klartext?: string; signatur?: Signaturbefund }> {
  const openpgp = await import('openpgp');
  const { beurteileSignatur } = await import('@energy-mail/mail-core');
  const bekannte = alleOeffentlichen();

  try {
    const nachricht = await openpgp.readCleartextMessage({ cleartextMessage: text });
    const klartext = nachricht.getText();

    if (bekannte.length === 0) {
      return {
        klartext,
        signatur: {
          vertrauen: 'schluessel-fehlt',
          grund: 'Es liegt kein einziger öffentlicher Schlüssel vor.',
        },
      };
    }

    // Gegen alle bekannten zugleich: OpenPGP.js sucht sich den passenden selbst heraus.
    const schluessel = await Promise.all(
      bekannte.map((s) => openpgp.readKey({ armoredKey: s.armored })),
    );
    const ergebnis = await openpgp.verify({ message: nachricht, verificationKeys: schluessel });
    const erste = ergebnis.signatures[0];

    if (!erste) {
      return { klartext, signatur: { vertrauen: 'ungueltig', grund: 'Keine Unterschrift gefunden.' } };
    }

    let stimmt = false;
    let grund: string | undefined;
    try {
      stimmt = await erste.verified;
    } catch (err) {
      grund = (err as Error).message;
    }

    const kennung = erste.keyID.toHex().toUpperCase();
    const genutzt = bekannte.find((s) => s.angaben.fingerabdruck.endsWith(kennung));
    if (!genutzt) {
      return {
        klartext,
        signatur: {
          vertrauen: 'schluessel-fehlt',
          fingerabdruck: kennung,
          grund: 'Der Schlüssel des Unterzeichners liegt nicht vor.',
        },
      };
    }

    return {
      klartext,
      signatur: {
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
      },
    };
  } catch (err) {
    return { signatur: { vertrauen: 'ungueltig', grund: (err as Error).message } };
  }
}
