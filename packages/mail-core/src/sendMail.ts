import { appendMessage, findSentFolder } from './imapClient.js';
import { buildRawMessage, sendRawMessage } from './smtpClient.js';
import type { AccountConfig, OutgoingMessage } from './types.js';

export interface SendResult {
  /** Der Versand selbst war erfolgreich - sonst wäre eine Ausnahme geworfen worden. */
  sent: true;
  /** Ob eine Kopie im Gesendet-Ordner abgelegt werden konnte. */
  savedToSent: boolean;
  sentFolder?: string;
  /** Grund, falls die Ablage nicht geklappt hat; der Versand bleibt davon unberührt. */
  saveError?: string;
}

/**
 * Verschickt eine Nachricht und legt eine Kopie im Gesendet-Ordner ab.
 *
 * SMTP übermittelt nur an den Empfänger; ohne diesen zweiten Schritt gäbe es im eigenen
 * Postfach keinerlei Nachweis über gesendete Nachrichten.
 *
 * Scheitert die Ablage, wird das gemeldet - aber nicht als Fehler geworfen: die Mail ist
 * dann bereits unterwegs, und ein "fehlgeschlagen" würde zu einem zweiten Versand verleiten.
 */
export async function sendMessage(
  config: AccountConfig,
  message: OutgoingMessage,
): Promise<SendResult> {
  const recipients = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
  if (recipients.length === 0) {
    throw new Error('Es ist kein Empfänger angegeben.');
  }

  const raw = await buildRawMessage(config, message);
  await sendRawMessage(config, raw, recipients);

  try {
    const sentFolder = await findSentFolder(config);
    if (!sentFolder) {
      return {
        sent: true,
        savedToSent: false,
        saveError: 'Für dieses Konto wurde kein Gesendet-Ordner gefunden.',
      };
    }
    await appendMessage(config, sentFolder, raw, ['\\Seen']);
    return { sent: true, savedToSent: true, sentFolder };
  } catch (err) {
    return { sent: true, savedToSent: false, saveError: (err as Error).message };
  }
}
