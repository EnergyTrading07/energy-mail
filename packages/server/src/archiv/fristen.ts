/**
 * Wie lange etwas aufbewahrt werden muss.
 *
 * ## Die eine Regel, an der sich fast jeder vertut
 *
 * Die Frist läuft **nicht ab dem Tag des Schreibens**, sondern ab dem Schluss des
 * Kalenderjahres, in dem es entstanden ist - § 147 Abs. 4 AO. Eine Rechnung vom
 * 3. Februar 2025 und eine vom 28. Dezember 2025 haben denselben Ablauf: den
 * 31.12.2033. Wer vom Datum an rechnet, wirft die eine elf Monate zu früh weg.
 *
 * Deshalb steht diese Rechnung hier allein, getrennt von allem anderen, und ist für sich
 * geprüft. Es sind zehn Zeilen, und sie entscheiden darüber, ob eine Betriebsprüfung
 * etwas vorfindet oder nicht.
 *
 * ## Die Fristen selbst
 *
 * `§ 147 Abs. 3 AO` kennt zwei Längen. Sechs Jahre für Handels- und Geschäftsbriefe -
 * das ist der Regelfall bei Post. Acht Jahre für Buchungsbelege; das waren bis Ende 2024
 * zehn Jahre, verkürzt durch das Vierte Bürokratieentlastungsgesetz. Eine Rechnung im
 * Anhang macht aus einer Mail einen Buchungsbeleg.
 *
 * ## Was hier NICHT entschieden wird
 *
 * Ob eine bestimmte Nachricht überhaupt aufbewahrungspflichtig ist. Das ist keine
 * Rechenfrage, sondern eine Frage des Inhalts, und sie lässt sich nicht raten: Eine
 * Terminabsprache ist ein Geschäftsbrief, eine Mittagsverabredung nicht, und beide sehen
 * gleich aus. Diese Entscheidung trifft der Betrieb - hier steht nur, was daraus folgt.
 */

/** Wofür eine Nachricht gilt - danach richtet sich die Frist. */
export type Aufbewahrungsart =
  /** Handels- oder Geschäftsbrief: sechs Jahre. Der Regelfall. */
  | 'geschaeftsbrief'
  /** Buchungsbeleg - eine Rechnung etwa: acht Jahre. */
  | 'buchungsbeleg'
  /**
   * Ausdrücklich nicht aufbewahrungspflichtig.
   *
   * Wird gebraucht, weil in jedem Geschäftspostfach private Post liegt. Sie mit
   * aufzubewahren wäre nicht nur unnötig, sondern gegenüber dem Betroffenen falsch.
   */
  | 'ohne-pflicht';

/** Die Längen in Jahren, an einer Stelle. */
export const FRISTEN: Record<Aufbewahrungsart, number> = {
  geschaeftsbrief: 6,
  buchungsbeleg: 8,
  'ohne-pflicht': 0,
};

/**
 * Wann eine Nachricht frühestens weg darf.
 *
 * Zurück kommt der letzte Tag der Frist, 23:59:59.999 Uhr UTC des 31. Dezember. Ein
 * Datum und keine Dauer: Eine Dauer müsste bei jedem Vergleich neu gerechnet werden, und
 * eine später geänderte Frist würde rückwirkend Bestände freigeben, die längst als
 * gebunden vermerkt waren.
 *
 * `entstanden` ist der Zeitpunkt der Nachricht. Bei empfangener Post der Eingang, bei
 * gesendeter der Versand - beides steht in der Nachricht selbst.
 */
export function aufbewahrenBis(entstanden: Date, art: Aufbewahrungsart): string {
  const jahre = FRISTEN[art];
  if (jahre === 0) return new Date(entstanden.getTime()).toISOString();
  /*
   * Der Schluss des Kalenderjahres, in dem die Nachricht entstand, plus die Frist. In
   * UTC gerechnet und nicht in Ortszeit: Der Server steht womöglich in einer anderen
   * Zeitzone als der Betrieb, und ein Ablauf, der sich mit der Sommerzeit verschiebt,
   * wäre nicht zu erklären.
   */
  const jahr = entstanden.getUTCFullYear() + jahre;
  return new Date(Date.UTC(jahr, 11, 31, 23, 59, 59, 999)).toISOString();
}

/** Ob die Frist zu einem gegebenen Zeitpunkt abgelaufen ist. */
export function fristAbgelaufen(bis: string, jetzt: Date): boolean {
  return new Date(bis).getTime() < jetzt.getTime();
}

/**
 * Die längere von zwei Fristen.
 *
 * Gebraucht beim Umtragen einer Nachricht in eine andere Art. Eine Frist darf sich
 * verlängern - jemand erkennt nachträglich eine Rechnung im Anhang -, aber niemals
 * verkürzen. Sonst ließe sich eine unbequeme Nachricht dadurch loswerden, dass man sie
 * kurz vor der Prüfung zur Privatpost erklärt.
 */
export function laengere(a: string, b: string): string {
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}
