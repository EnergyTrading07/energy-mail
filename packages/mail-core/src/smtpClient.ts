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
  const composer = new MailComposer({
    from: config.displayName ? { name: config.displayName, address: config.email } : config.email,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.text,
    html: message.html,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments: message.attachments,
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
    await transport.sendMail({
      envelope: { from: config.email, to: recipients },
      raw,
    });
  } finally {
    transport.close();
  }
}
