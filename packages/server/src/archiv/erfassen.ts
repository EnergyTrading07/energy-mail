import {
  getRawMessageBytes,
  type AccountConfig,
  type MessageSummary,
  type OutgoingMessage,
} from '@energy-mail/mail-core';
import { archiviere, wirdArchiviert } from './archiv.js';
import { protokolliere } from '../protokollDatei.js';

/**
 * Der Anschluss ans Archiv - die zwei Stellen, an denen Post entsteht.
 *
 * Bewusst ein eigenes kleines Modul und nicht zwei Blöcke in der Postfachüberwachung und
 * im Versand. Grund: Beide Stellen dürfen an einem Fehler hier **nicht scheitern**. Eine
 * Nachricht, die nicht ins Archiv kommt, ist ein Mangel; ein Versand, der deshalb
 * abbricht, ist ein Ausfall. Diese Abwägung an einer Stelle zu treffen ist besser, als
 * sie an zweien zu wiederholen - und beim dritten Aufrufer zu vergessen.
 *
 * Damit aus dem Mangel kein stiller Mangel wird, geht jeder Fehlschlag ins Protokoll,
 * und zwar als Warnung. Ein Archiv, das gelegentlich etwas ausfallen lässt, ohne dass es
 * jemand erfährt, ist schlechter als keines: Man verlässt sich darauf.
 */

/**
 * Nimmt eingegangene Post auf.
 *
 * Die Nachrichten müssen dafür ein zweites Mal geholt werden, im Original - die
 * Zusammenfassung aus der Überwachung enthält Kopfdaten, nicht die Bytes. Das kostet
 * einen IMAP-Abruf je Nachricht und ist nicht zu umgehen: Aufzubewahren ist das Original,
 * nicht unsere Lesart davon.
 */
export async function erfasseEingang(
  account: AccountConfig,
  ordner: string,
  neue: readonly MessageSummary[],
): Promise<number> {
  if (!wirdArchiviert(account.id) || neue.length === 0) return 0;

  let aufgenommen = 0;
  for (const nachricht of neue) {
    try {
      const bytes = await getRawMessageBytes(account, ordner, nachricht.uid);
      const eintrag = archiviere(bytes, {
        richtung: 'empfangen',
        kontoId: account.id,
        ordner,
        absender: nachricht.from[0]?.address ?? '',
        empfaenger: [...nachricht.to, ...nachricht.cc].map((a) => a.address).filter(Boolean),
        betreff: nachricht.subject ?? '',
        messageId: nachricht.messageId,
        /*
         * Das Datum der Nachricht, sonst der Zeitpunkt der Erfassung. Auf ein Datum
         * zurückzufallen ist wichtiger, als es genau zu treffen: Die Frist rechnet in
         * Kalenderjahren, und eine Nachricht ohne Datum bekäme sonst gar keine.
         */
        entstandenAm: nachricht.date ?? new Date(),
      });
      if (eintrag) aufgenommen++;
    } catch (err) {
      protokolliere(
        'warnung',
        'archiv',
        `Eingang nicht archiviert (${account.email}, ${ordner}, ${nachricht.uid}): ${(err as Error).message}`,
      );
    }
  }
  if (aufgenommen > 0) {
    protokolliere('info', 'archiv', `${aufgenommen} eingegangene Nachricht(en) aufgenommen.`);
  }
  return aufgenommen;
}

/**
 * Nimmt eine gesendete Nachricht auf.
 *
 * `raw` sind genau die Bytes, die hinausgegangen sind - sendMessage() reicht sie durch.
 * Eine nachgebaute Fassung wäre nicht die, die der Empfänger bekommen hat, und damit
 * nicht das Original.
 */
export function erfasseVersand(
  account: AccountConfig,
  message: Pick<OutgoingMessage, 'to' | 'cc' | 'bcc' | 'subject' | 'absender'>,
  raw: Buffer,
): void {
  if (!wirdArchiviert(account.id)) return;
  try {
    archiviere(raw, {
      richtung: 'gesendet',
      kontoId: account.id,
      absender: message.absender?.email ?? account.email,
      empfaenger: [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])],
      betreff: message.subject ?? '',
      messageId: leseMessageId(raw),
      entstandenAm: new Date(),
    });
  } catch (err) {
    protokolliere('warnung', 'archiv', `Versand nicht archiviert: ${(err as Error).message}`);
  }
}

/**
 * Die Kennung aus den Kopfzeilen der fertigen Nachricht.
 *
 * Aus den Bytes und nicht aus dem, was wir vorher gesetzt haben: Gebaut wird sie erst
 * beim Zusammensetzen der Nachricht, und beim Weg über nodemailer setzt sie die
 * Bibliothek. Nur der Kopf wird angesehen - der endet bei der ersten Leerzeile.
 */
function leseMessageId(raw: Buffer): string | undefined {
  const kopfEnde = raw.indexOf('\r\n\r\n');
  const kopf = raw.subarray(0, kopfEnde < 0 ? Math.min(raw.length, 16384) : kopfEnde).toString('utf8');
  return /^message-id:\s*(<[^>\r\n]+>)/im.exec(kopf)?.[1];
}
