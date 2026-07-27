import { appendMessage, deleteMessages, findDraftsFolder } from './imapClient.js';
import { buildRawMessage } from './smtpClient.js';
import type { AccountConfig, OutgoingMessage } from './types.js';

export interface SaveDraftResult {
  folder: string;
  /** UID des neu abgelegten Entwurfs - beim nächsten Speichern zu übergeben. */
  uid: number | null;
}

/**
 * Legt einen Entwurf im Entwürfe-Ordner ab.
 *
 * IMAP kennt kein Ändern bestehender Nachrichten: jedes Speichern erzeugt eine neue.
 * Die vorherige Fassung wird daher gelöscht, sonst sammeln sich beim Tippen dutzende
 * Zwischenstände an.
 */
export async function saveDraft(
  config: AccountConfig,
  message: OutgoingMessage,
  previousUid?: number,
): Promise<SaveDraftResult> {
  const folder = await findDraftsFolder(config);
  if (!folder) {
    throw new Error('Für dieses Konto wurde kein Entwürfe-Ordner gefunden.');
  }

  const raw = await buildRawMessage(config, message);
  const uid = await appendMessage(config, folder, raw, ['\\Draft', '\\Seen']);

  if (previousUid) {
    try {
      await deleteMessages(config, folder, [previousUid]);
    } catch {
      // Bleibt eine alte Fassung liegen, ist das unschön aber harmlos - der neue
      // Entwurf ist bereits gespeichert und darf nicht daran scheitern.
    }
  }

  return { folder, uid };
}

/** Entfernt einen Entwurf, etwa nachdem die Nachricht tatsächlich versendet wurde. */
export async function discardDraft(
  config: AccountConfig,
  folder: string,
  uid: number,
): Promise<void> {
  await deleteMessages(config, folder, [uid]);
}
