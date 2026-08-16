import type { Kettenbefund } from './zertifikat.js';

/**
 * Was der Nutzer am Ende sehen soll - und was gerade nicht.
 *
 * Bewusst getrennt vom Rechnen, aus demselben Grund wie bei PGP: Diese Entscheidung ist
 * die sicherheitsrelevante. Sie wird dem Nutzer als Schloss, als Warnung oder als nichts
 * angezeigt, und danach handelt er. Ein Fehler hier ist teurer als ein Fehler in der
 * Rechnung darunter, denn die Rechnung merkt man - eine falsche Zuversicht nicht.
 *
 * ## Die Reihenfolge ist die Aussage
 *
 * Was zuerst geprüft wird, gewinnt. Und zuerst geprüft wird immer das Schlimmste. Eine
 * Nachricht mit falscher Unterschrift UND abgelaufenem Zertifikat ist keine abgelaufene,
 * sie ist eine gefälschte. Sie als "Zertifikat abgelaufen" auszuweisen wäre eine
 * Verharmlosung - der Nutzer denkt "ach, nur abgelaufen" und liest weiter.
 *
 * ## Warum eine unbekannte Wurzel die Adressprüfung schlägt
 *
 * Weil die Adresse im Zertifikat nichts mehr wert ist, wenn niemand für das Zertifikat
 * geradesteht. Wer sich selbst ein Zertifikat auf `vorstand@firma.de` ausstellt, bekommt
 * eine mathematisch einwandfreie Unterschrift und eine passende Adresse. Genau dann darf
 * hier NICHT "gültig, Adresse stimmt" stehen, sondern der Hinweis, dass die Herkunft
 * ungeprüft ist. Das ist der Unterschied zwischen S/MIME und einem Aufkleber.
 */

export type SmimeVertrauen =
  /** Alles zusammen: Unterschrift geht auf, Kette trägt, Adresse stimmt. */
  | 'gueltig'
  /** Die Unterschrift trägt, aber das Zertifikat lautet auf eine andere Adresse. */
  | 'gueltig-fremde-adresse'
  /** Die Unterschrift geht auf - für das Zertifikat steht aber niemand gerade. */
  | 'gueltig-wurzel-unbekannt'
  /** Das Zertifikat war zu diesem Zeitpunkt nicht (mehr) gültig. */
  | 'zertifikat-abgelaufen'
  /** Das Zertifikat ist gar nicht für Mail ausgestellt. */
  | 'zweck-passt-nicht'
  /** Geprüft und falsch. */
  | 'ungueltig'
  /** Es ließ sich nichts feststellen - fehlendes Zertifikat, überholtes Verfahren. */
  | 'nicht-pruefbar';

export interface SmimeSignaturbefund {
  vertrauen: SmimeVertrauen;
  /** SHA-256 über das Zertifikat des Unterzeichners. */
  fingerabdruck?: string;
  /** Der Name aus dem Zertifikat. */
  name?: string;
  /** Die Adressen, die das Zertifikat für sich beansprucht. */
  zertifikatAdressen?: string[];
  aussteller?: string;
  /** Der Weg bis zur Wurzel, für die Anzeige. */
  kette?: string[];
  giltBis?: string;
  /** Wann unterschrieben wurde - laut Absender, also ohne Beweiskraft. */
  zeitpunkt?: string;
  grund?: string;
}

export function beurteileSmime(pruefung: {
  /** Ob die Unterschrift mathematisch aufgeht. */
  stimmt: boolean;
  /** Ob überhaupt ein Zertifikat des Unterzeichners vorlag. */
  zertifikatVorhanden: boolean;
  /** Ob das Verfahren hier als Nachweis anerkannt wird. */
  verfahrenAnerkannt: boolean;
  kette: Kettenbefund;
  /** Ob das Zertifikat zum Schutz von Mail ausgestellt wurde. */
  fuerMail: boolean;
  absender?: string;
  zertifikatAdressen?: readonly string[];
}): SmimeVertrauen {
  if (!pruefung.zertifikatVorhanden) return 'nicht-pruefbar';
  if (!pruefung.verfahrenAnerkannt) return 'nicht-pruefbar';
  if (!pruefung.stimmt) return 'ungueltig';

  // Eine gebrochene Kette heißt: Ein Zertifikat darin ist gefälscht. Das ist derselbe
  // Befund wie eine falsche Unterschrift, nur eine Ebene höher.
  if (pruefung.kette.lage === 'gebrochen') return 'ungueltig';
  if (pruefung.kette.lage === 'zeitlich-ungueltig') return 'zertifikat-abgelaufen';
  if (pruefung.kette.lage === 'wurzel-unbekannt') return 'gueltig-wurzel-unbekannt';

  if (!pruefung.fuerMail) return 'zweck-passt-nicht';

  const wer = pruefung.absender?.trim().toLowerCase();
  const passt = wer !== undefined && wer !== '' && (pruefung.zertifikatAdressen ?? []).includes(wer);
  return passt ? 'gueltig' : 'gueltig-fremde-adresse';
}
