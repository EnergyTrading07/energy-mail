/**
 * Das Abzeichen über dem Symbol in der Taskleiste.
 *
 * Windows blendet dort ein kleines Bild über das Programmsymbol ein - dieselbe Stelle,
 * an der Mailprogramme üblicherweise die Zahl der ungelesenen Nachrichten zeigen. Die
 * Anwendung tat das bisher nicht; wer sie weggeklickt hatte, sah nur am Aufblitzen einer
 * Benachrichtigung, dass etwas eingetroffen war - und wenn er die verpasste, gar nichts.
 *
 * Gezeichnet wird hier und nicht in der Hülle, obwohl die es anzeigt. Der Grund ist die
 * Gestaltung: der Hauptprozess hat keine Zeichenfläche, er könnte nur vorgefertigte
 * Bilddateien anzeigen. Damit gäbe es einen zweiten Satz Farben und Formen neben
 * tokens.css - und der wird beim nächsten Umfärben vergessen. So bleibt alles an einer
 * Stelle, und die Hülle bekommt ein fertiges Bild.
 */

/** Windows erwartet für das Überlagerungsbild 16×16; doppelt gezeichnet für scharfe Kanten. */
const KANTE = 32;

/** Ab hier wird nicht mehr gezählt, sondern nur noch gemeldet, dass viel da ist. */
const HOECHSTZAHL = 99;

export function zeichneAbzeichen(anzahl: number): string | null {
  if (anzahl <= 0) return null;

  const flaeche = document.createElement('canvas');
  flaeche.width = KANTE;
  flaeche.height = KANTE;
  const stift = flaeche.getContext('2d');
  if (!stift) return null;

  // Die Farben aus dem Wertevorrat holen statt sie hier zu wiederholen - so folgt das
  // Abzeichen der hellen wie der dunklen Ansicht ohne zweite Festlegung.
  const stil = getComputedStyle(document.documentElement);
  const grund = stil.getPropertyValue('--marke').trim() || '#2f5fd8';

  stift.beginPath();
  stift.arc(KANTE / 2, KANTE / 2, KANTE / 2, 0, Math.PI * 2);
  stift.fillStyle = grund;
  stift.fill();

  const text = anzahl > HOECHSTZAHL ? '99+' : String(anzahl);
  // Dreistellig wird es eng - dann etwas schmaler setzen, statt über den Rand zu laufen.
  stift.font = `600 ${text.length > 2 ? 15 : 19}px "Segoe UI Variable Text", "Segoe UI", sans-serif`;
  stift.fillStyle = '#ffffff';
  stift.textAlign = 'center';
  stift.textBaseline = 'middle';
  // Ein Pixel tiefer: Ziffern sitzen optisch sonst zu hoch im Kreis.
  stift.fillText(text, KANTE / 2, KANTE / 2 + 1);

  return flaeche.toDataURL('image/png');
}
