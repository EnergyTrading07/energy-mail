import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { resolveAccessToken } from './oauth/tokenAccess.js';
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
