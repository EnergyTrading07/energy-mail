import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { resolveAccessToken } from './oauth/tokenAccess.js';
import { baueSigniertenTeil } from './pgpErkennung.js';
import type { AccountConfig, OutgoingMessage } from './types.js';

async function buildSmtpAuth(config: AccountConfig) {
  if (config.auth.type === 'password') {
    return { user: config.auth.user, pass: config.auth.pass };
  }
  return {
    type: 'OAuth2' as const,
    user: config.auth.user,
    // Frisch anfordern statt der im Konto gespeicherten, möglicherweise verfallenen Fassung.
    accessToken: await resolveAccessToken(config),
  };
}

async function createTransport(config: AccountConfig) {
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: await buildSmtpAuth(config),
  });
}

/** Prüft Erreichbarkeit und Zugangsdaten des SMTP-Servers, ohne eine Mail zu senden. */
export async function verifySmtpConnection(config: AccountConfig): Promise<void> {
  const transport = await createTransport(config);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/**
 * Baut die vollständige MIME-Nachricht. Bewusst getrennt vom Versand, damit exakt
 * dieselben Bytes verschickt und im Gesendet-Ordner abgelegt werden können - sonst
 * unterschieden sich Message-ID und Zeitstempel zwischen Versand und Ablage.
 */
/**
 * Kodiert eine Kopfzeile, falls sie Zeichen jenseits von ASCII enthält (RFC 2047).
 *
 * Ein Betreff mit Umlauten ginge sonst als rohe Bytes hinaus, und Mailserver dürfen
 * solche Kopfzeilen abweisen oder verstümmeln.
 */
function kodiereKopfzeile(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (!/[^\x00-\x7F]/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/**
 * Baut eine mit OpenPGP geschützte Nachricht nach RFC 3156.
 *
 * Von Hand zusammengesetzt und nicht über den üblichen Weg, und das aus einem zwingenden
 * Grund: bei einer unterschriebenen Nachricht muss der geschützte Teil beim Empfänger
 * Byte für Byte so ankommen, wie er unterschrieben wurde. Jede Bibliothek, die den Teil
 * noch einmal anfasst - ihn umbricht, neu kodiert oder auch nur ein Zeilenende ändert -,
 * macht die Unterschrift ungültig. Also wird hier nichts angefasst.
 */
function baueGeschuetzteNachricht(
  kopfzeilen: string[],
  message: OutgoingMessage,
): Buffer | null {
  const grenze = `=_EnergyMail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  if (message.pgpGeheimtext) {
    const teile = [
      ...kopfzeilen,
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${grenze}"`,
      '',
      'Diese Nachricht ist mit OpenPGP verschlüsselt.',
      `--${grenze}`,
      'Content-Type: application/pgp-encrypted',
      'Content-Description: PGP/MIME version identification',
      '',
      'Version: 1',
      `--${grenze}`,
      'Content-Type: application/octet-stream; name="encrypted.asc"',
      'Content-Description: OpenPGP encrypted message',
      'Content-Disposition: inline; filename="encrypted.asc"',
      '',
      message.pgpGeheimtext.trimEnd(),
      `--${grenze}--`,
      '',
    ];
    return Buffer.from(teile.join('\r\n'), 'utf8');
  }

  if (message.pgpSignatur) {
    /**
     * Genau dieser Block wurde unterschrieben, Byte für Byte - er wird hier nicht mehr
     * angefasst. Gebaut hat ihn baueSigniertenTeil(), und zwar dieselbe Funktion, die
     * auch der Unterschrift zugrunde lag. Zwei Stellen, die denselben Teil unabhängig
     * voneinander zusammensetzen, laufen unweigerlich irgendwann auseinander.
     */
    const geschuetzt = message.pgpSignierterTeil ?? baueSigniertenTeil(message.text ?? '');

    const teile = [
      ...kopfzeilen,
      `Content-Type: multipart/signed; micalg=pgp-sha256; protocol="application/pgp-signature"; boundary="${grenze}"`,
      '',
      'Diese Nachricht ist mit OpenPGP unterschrieben.',
      `--${grenze}`,
      geschuetzt,
      `--${grenze}`,
      'Content-Type: application/pgp-signature; name="signature.asc"',
      'Content-Description: OpenPGP digital signature',
      'Content-Disposition: attachment; filename="signature.asc"',
      '',
      message.pgpSignatur.trimEnd(),
      `--${grenze}--`,
      '',
    ];
    return Buffer.from(teile.join('\r\n'), 'utf8');
  }

  return null;
}

export async function buildRawMessage(
  config: AccountConfig,
  message: OutgoingMessage,
): Promise<Buffer> {
  /**
   * Unter welcher Adresse die Nachricht hinausgeht. Ohne Angabe die des Kontos; sonst
   * eine der weiteren Identitäten - verschickt wird in beiden Fällen über denselben
   * Server, nur der Kopf nennt einen anderen Absender.
   */
  const absender = message.absender?.email ?? config.email;
  const name = message.absender?.displayName ?? config.displayName;

  if (message.pgpSignatur || message.pgpGeheimtext) {
    const alsAdresse = (a: string) => a;
    const kopfzeilen = [
      `From: ${name ? `${name} <${absender}>` : absender}`,
      `To: ${message.to.map(alsAdresse).join(', ')}`,
      ...(message.cc?.length ? [`Cc: ${message.cc.map(alsAdresse).join(', ')}`] : []),
      `Subject: ${kodiereKopfzeile(message.subject)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${absender.split('@')[1]}>`,
      ...(message.inReplyTo ? [`In-Reply-To: ${message.inReplyTo}`] : []),
      ...(message.references?.length ? [`References: ${message.references.join(' ')}`] : []),
      'MIME-Version: 1.0',
    ];
    const gebaut = baueGeschuetzteNachricht(kopfzeilen, message);
    if (gebaut) return gebaut;
  }

  const composer = new MailComposer({
    from: name ? { name, address: absender } : absender,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.text,
    html: message.html,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments: message.attachments,
    /**
     * Die Antwort auf eine Besprechungseinladung.
     *
     * Sie muss als gleichrangige Fassung neben dem Text stehen ("multipart/alternative"),
     * nicht als Anhang: nur dann erkennt das Programm des Organisators sie als Antwort
     * und trägt die Zu- oder Absage im Termin ein. Als Anhang beigelegt bekäme er eine
     * Datei, die er von Hand öffnen müsste.
     *
     * Der Zusatz "method=REPLY" gehört in den Typ - ohne ihn nimmt Outlook die Datei
     * zwar an, deutet sie aber als neue Einladung.
     */
    alternatives: message.kalenderAntwort
      ? [
          {
            contentType: 'text/calendar; charset=utf-8; method=REPLY',
            content: message.kalenderAntwort,
          },
        ]
      : undefined,
  });
  return composer.compile().build();
}

/** Verschickt eine fertig gebaute Nachricht unverändert über SMTP. */
export async function sendRawMessage(
  config: AccountConfig,
  raw: Buffer,
  recipients: string[],
): Promise<void> {
  const transport = await createTransport(config);
  try {
    // envelope muss explizit gesetzt werden: bei "raw" liest Nodemailer die Empfänger
    // nicht aus den Kopfzeilen - und Bcc darf ohnehin nicht im Versand stehen.
    //
    // Der Absender im Umschlag bleibt bewusst der des Kontos, auch wenn im Kopf eine
    // andere Adresse steht: hierhin gehen Unzustellbarkeitsmeldungen, und die
    // Absenderprüfung der Gegenseite rechnet mit der Adresse, unter der wir angemeldet
    // sind. Ein fremder Umschlagabsender führte dort geradewegs in den Spamordner.
    await transport.sendMail({
      envelope: { from: config.email, to: recipients },
      raw,
    });
  } finally {
    transport.close();
  }
}
