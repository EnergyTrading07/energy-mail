import type { EmailAddress, FullMessage } from '@energy-mail/mail-core';
import type { Draft } from './api.js';
import { escapeHtml, textToHtml } from './htmlText.js';
import { raeumeZitatAuf } from './formatierung.js';

function normalize(address: string): string {
  return address.trim().toLowerCase();
}

/** Entfernt Doppelte und die eigene Adresse - man schreibt sich nicht selbst an. */
function cleanRecipients(addresses: EmailAddress[], ownEmail: string): string[] {
  const own = normalize(ownEmail);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of addresses) {
    const key = normalize(entry.address);
    if (!key || key === own || seen.has(key)) continue;
    seen.add(key);
    result.push(entry.address);
  }
  return result;
}

function withPrefix(subject: string, prefix: 'Re' | 'Fwd' | 'Nachfrage'): string {
  // Kein zweites "Re:" anhängen, wenn schon eins davorsteht (auch "AW:" von Outlook).
  const alreadyPrefixed =
    prefix === 'Re'
      ? /^\s*(re|aw|antw)\s*:/i.test(subject)
      : prefix === 'Fwd'
        ? /^\s*(fwd?|wg)\s*:/i.test(subject)
        : /^\s*nachfrage\s*:/i.test(subject);
  return alreadyPrefixed ? subject : `${prefix}: ${subject}`;
}

/**
 * Betreff für ein Nachfassen zur eigenen, unbeantwortet gebliebenen Nachricht.
 *
 * Bewusst nicht "Re:" - man antwortet nicht auf sich selbst. Ein vorhandenes "Re:" oder
 * "AW:" fällt weg, sonst stünde am Ende "Nachfrage: Re: AW: Angebot" in der Betreffzeile.
 */
export function buildFollowUpSubject(subject: string): string {
  const ohneKuerzel = subject.replace(/^\s*((re|aw|antw|fwd?|wg)\s*:\s*)+/i, '').trim();
  // "(kein Betreff)" ist ein Platzhalter der Anzeige, kein Inhalt - er darf nicht in der
  // Betreffzeile der hinausgehenden Nachricht landen.
  if (!ohneKuerzel || ohneKuerzel === '(kein Betreff)') return 'Nachfrage';
  return withPrefix(ohneKuerzel, 'Nachfrage');
}

function formatAddressList(addresses: EmailAddress[]): string {
  return addresses.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

function formatDate(date: Date | null): string {
  return date ? new Date(date).toLocaleString('de-DE') : 'unbekannt';
}

/**
 * Der Inhalt der Originalnachricht, aufgeräumt.
 *
 * Vorher stand hier message.html unverändert. Gemessen an einer echten Werbenachricht
 * hiess das: beim Lesen wurden elf Inhalte von fremden Servern zurückgehalten, beim
 * Druck auf "Antworten" gingen genau diese elf hinaus - darunter ein Zählpixel. Der
 * Zählpixelschutz war damit umgangen.
 */
function inhaltAlsHtml(message: FullMessage, dokument: Document): string {
  if (typeof message.html === 'string' && message.html.trim()) {
    return raeumeZitatAuf(message.html, dokument);
  }
  return textToHtml(message.text ?? '');
}

/**
 * Baut das Zitat der Originalnachricht als HTML. Liegt die Nachricht selbst als HTML
 * vor, wird sie in ein blockquote gesetzt und bleibt damit formatiert; sonst wird der
 * Textteil umgewandelt.
 */
function quoteAsHtml(message: FullMessage, dokument: Document): string {
  const einleitung = `<p>Am ${formatDate(message.date)} schrieb ${escapeHtml(formatAddressList(message.from))}:</p>`;
  return `<p><br></p>${einleitung}<blockquote class="zitat">${inhaltAlsHtml(message, dokument)}</blockquote>`;
}

/**
 * Baut die Kopfzeilen, über die Mailprogramme eine Antwort dem richtigen Verlauf
 * zuordnen. Der Betreff mit "Re:" allein reicht dafür nicht - entscheidend sind
 * In-Reply-To (die direkte Vorgängernachricht) und References (die gesamte Kette).
 */
function threadHeaders(message: FullMessage): Pick<Draft, 'inReplyTo' | 'references'> {
  if (!message.messageId) return {};
  const chain = [...(message.references ?? []), message.messageId];
  // Sehr lange Ketten kürzen, wie es Mailprogramme üblicherweise tun: Anfang und Ende
  // sind für die Zuordnung entscheidend, die Mitte darf wegfallen.
  const trimmed = chain.length > 20 ? [...chain.slice(0, 3), ...chain.slice(-17)] : chain;
  return { inReplyTo: message.messageId, references: trimmed };
}

export function buildReply(
  message: FullMessage,
  ownEmail: string,
  toAll: boolean,
  /**
   * Wird gebraucht, um den zitierten Verlauf aufzuräumen. Ausdrücklich übergeben und
   * nicht aus der Umgebung geholt, damit sich das hier ohne Browser prüfen lässt.
   */
  dokument: Document,
): Partial<Draft> {
  // Reply-To hat Vorrang vor dem Absender - Verteiler setzen das bewusst.
  const primary = message.replyTo?.length ? message.replyTo : message.from;

  const to = toAll
    ? cleanRecipients([...primary, ...message.to], ownEmail)
    : cleanRecipients(primary, ownEmail);
  const cc = toAll ? cleanRecipients(message.cc, ownEmail) : [];

  return {
    to: to.length > 0 ? to : cleanRecipients(message.from, ownEmail),
    cc: cc.length > 0 ? cc : undefined,
    subject: withPrefix(message.subject, 'Re'),
    html: quoteAsHtml(message, dokument),
    ...threadHeaders(message),
  };
}

export function buildForward(message: FullMessage, dokument: Document): Partial<Draft> {
  const kopf = [
    `<p><br></p><p>---------- Weitergeleitete Nachricht ----------<br>`,
    `Von: ${escapeHtml(formatAddressList(message.from))}<br>`,
    `Datum: ${escapeHtml(formatDate(message.date))}<br>`,
    `Betreff: ${escapeHtml(message.subject)}<br>`,
    `An: ${escapeHtml(formatAddressList(message.to))}`,
    message.cc.length > 0 ? `<br>Kopie: ${escapeHtml(formatAddressList(message.cc))}` : '',
    `</p>`,
  ].join('');

  return {
    subject: withPrefix(message.subject, 'Fwd'),
    html: `${kopf}${inhaltAlsHtml(message, dokument)}`,
    // Anhänge übernimmt der Aufrufer über attachOriginal; References bleiben bewusst
    // weg, da eine Weiterleitung einen neuen Verlauf beginnt.
  };
}

/** Prüft, ob mehr Beteiligte existieren als nur der Absender. */
export function hasMultipleRecipients(message: FullMessage, ownEmail: string): boolean {
  const others = cleanRecipients([...message.from, ...message.to, ...message.cc], ownEmail);
  return others.length > 1;
}

/**
 * Setzt die Signatur über das Zitat, nicht ans Ende - sonst stünde sie bei Antworten
 * unterhalb des zitierten Verlaufs und wäre praktisch unsichtbar.
 */
export function withSignature(html: string, signature?: string): string {
  if (!signature?.trim()) return html;
  const block = `<p><br></p><div class="signatur">--<br>${signature}</div>`;
  return `<p><br></p>${block}${html}`;
}
