import { randomBytes } from 'node:crypto';
import type { AccountConfig } from './types.js';

/**
 * Der Bau einer Lesebestätigung (MDN, RFC 8098).
 *
 * ## Warum das nicht einfach eine Mail mit dem Satz "wurde gelesen" ist
 *
 * Weil sie dann niemand als Bestätigung erkennt. Der Absender soll in seinem Programm
 * sehen, dass seine Nachricht angezeigt wurde - dafür muss die Antwort eine festgelegte
 * Gestalt haben: `multipart/report` mit `report-type=disposition-notification`, darin ein
 * lesbarer Teil für den Menschen und ein maschinenlesbarer für sein Programm. Kommt
 * stattdessen eine gewöhnliche Mail, steht sie als unerklärter Zweizeiler im Posteingang,
 * und der Haken beim Absender bleibt aus.
 *
 * ## Was hier bewusst nicht steht
 *
 * Die Frage, OB eine hinausgehen darf. Die ist die eigentliche Arbeit und steht in
 * server/lesebestaetigung.ts. Hier wird gebaut, was dort beschlossen wurde.
 *
 * ## Von Hand gebaut und nicht über MailComposer
 *
 * `multipart/report` mit einem `message/disposition-notification`-Teil lässt sich damit
 * nicht ausdrücken. Und der Aufbau ist so festgelegt, dass jede Bequemlichkeit an anderer
 * Stelle wieder herauskäme: Die Reihenfolge der Felder im zweiten Teil ist Vorschrift.
 */

export interface Lesebestaetigung {
  /** An welche Adresse - die aus "Disposition-Notification-To". */
  an: string;
  /** Die Message-ID der Nachricht, um die es geht. */
  originalId?: string;
  /** Ihr Betreff - für den lesbaren Teil. */
  betreff: string;
  /** Wann sie angezeigt wurde. */
  gelesenAm?: Date;
  /**
   * Ob der Mensch ausdrücklich zugestimmt hat.
   *
   * Steht im maschinenlesbaren Teil und ist keine Formsache: `manual-action` heißt, ein
   * Mensch hat entschieden; `automatic-action` heißt, das Programm hat es selbst getan.
   * Wer das Zweite hinschreibt, wo das Erste zutrifft, macht aus einer Auskunft eine
   * Behauptung.
   */
  vonHand: boolean;
  /** Der Text für den Menschen - übersetzt vom Aufrufer, damit dieses Modul stumm bleibt. */
  text: string;
}

/** Kopfzeilenwerte dürfen keine Zeilenumbrüche tragen - sonst schmuggelt man Kopfzeilen ein. */
function sicher(wert: string): string {
  return wert.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * Kodiert einen Kopfzeilenwert, wenn er nicht reines ASCII ist (RFC 2047).
 *
 * Der Betreff einer Bestätigung trägt den der ursprünglichen Nachricht - und deutsche
 * Betreffzeilen haben Umlaute. Ohne das käme beim Empfänger Buchstabensalat an.
 */
function kodiere(wert: string): string {
  const sauber = sicher(wert);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(sauber)) return sauber;
  return `=?UTF-8?B?${Buffer.from(sauber, 'utf8').toString('base64')}?=`;
}

/**
 * Baut die fertige Nachricht.
 *
 * Verschickt wird sie über `sendRawMessage` - unverändert, denn was hier entsteht, darf
 * kein Programm mehr anfassen.
 */
export function baueLesebestaetigung(
  config: AccountConfig,
  b: Lesebestaetigung,
): Buffer {
  const absender = config.email;
  const name = config.displayName;
  const domain = (absender.split('@')[1] ?? 'localhost').trim();
  const grenze = `----=_MDN_${randomBytes(12).toString('hex')}`;
  const jetzt = b.gelesenAm ?? new Date();

  const kopf = [
    `From: ${name ? `${kodiere(name)} <${sicher(absender)}>` : sicher(absender)}`,
    `To: ${sicher(b.an)}`,
    `Subject: ${kodiere(b.betreff)}`,
    `Date: ${jetzt.toUTCString().replace(/GMT$/, '+0000')}`,
    `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
    ...(b.originalId ? [`In-Reply-To: ${sicher(b.originalId)}`] : []),
    ...(b.originalId ? [`References: ${sicher(b.originalId)}`] : []),
    /*
     * Die drei Zeilen, ohne die eine Lesebestätigung gefährlich wäre.
     *
     * `Auto-Submitted: auto-replied` sagt der Gegenseite, dass hier eine Maschine
     * geantwortet hat - ohne sie könnte deren Abwesenheitsnotiz auf die Bestätigung
     * antworten, unsere auf die Antwort, und so fort. Und `Precedence: bulk` sagt
     * dasselbe noch einmal in der alten Sprache.
     *
     * Was hier ausdrücklich NICHT steht, ist ein eigenes `Disposition-Notification-To`.
     * Eine Lesebestätigung, die selbst eine anfordert, ist eine Endlosschleife mit zwei
     * höflichen Teilnehmern.
     */
    'Auto-Submitted: auto-replied',
    'Precedence: bulk',
    'MIME-Version: 1.0',
    `Content-Type: multipart/report; report-type=disposition-notification; boundary="${grenze}"`,
  ].join('\r\n');

  /*
   * Der zweite Teil ist der, auf den es ankommt.
   *
   * `Disposition` sagt in drei Angaben, was geschehen ist: von wem die Handlung ausging
   * (manuell oder maschinell), wie die Bestätigung zustande kam, und was mit der
   * Nachricht passiert ist ("displayed" - angezeigt, nicht notwendigerweise gelesen).
   * Genau diese Unterscheidung ist der Grund, warum eine Lesebestätigung nie ein Beweis
   * ist: Angezeigt heißt, sie war auf einem Bildschirm.
   */
  const art = b.vonHand ? 'manual-action/MDN-sent-manually' : 'automatic-action/MDN-sent-automatically';
  const bericht = [
    `Reporting-UA: ${sicher(domain)}; Energy Mail`,
    `Final-Recipient: rfc822;${sicher(absender)}`,
    ...(b.originalId ? [`Original-Message-ID: ${sicher(b.originalId)}`] : []),
    `Disposition: ${art}; displayed`,
  ].join('\r\n');

  const koerper = [
    '',
    `--${grenze}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    b.text,
    '',
    `--${grenze}`,
    'Content-Type: message/disposition-notification',
    '',
    bericht,
    '',
    `--${grenze}--`,
    '',
  ].join('\r\n');

  return Buffer.from(kopf + koerper, 'utf8');
}
