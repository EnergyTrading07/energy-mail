/**
 * Das Monogramm eines Absenders: ein Kürzel und ein Farbton.
 *
 * Warum überhaupt.
 *
 * Eine Nachrichtenliste ist eine Kolonne aus grauem Text. Wer sie überfliegt, liest -
 * und Lesen ist langsam. Ein farbiges Kürzel am Zeilenanfang wird dagegen gesehen, nicht
 * gelesen: Post von derselben Person hat dieselbe Farbe und dasselbe Zeichen, jeden Tag,
 * und das Auge findet sie, bevor es beim Namen angekommen ist. Es ist die einzige
 * Ergänzung an der Zeile, die den Platz wert ist, den sie kostet.
 *
 * Warum abgeleitet und nicht ausgewürfelt.
 *
 * Der Farbton kommt aus der Adresse, über eine feste Rechnung. Damit ist er auf jedem
 * Rechner und nach jedem Neustart derselbe - eine zufällige Zuteilung wäre schlimmer als
 * gar keine Farbe, weil sie jeden Tag ein anderes Muster ergäbe und man sich das Muster
 * gerade merken soll. Gespeichert wird dafür nichts.
 *
 * Warum nur der Farbton und nicht die ganze Farbe.
 *
 * Herausgegeben wird ein Winkel auf dem Farbkreis, mehr nicht. Helligkeit und Sättigung
 * setzt das Regelwerk (siehe .monogramm in index.css) - in OKLCH, wo gleiche Helligkeit
 * auch gleich hell aussieht. Ein Gelb und ein Blau mit denselben Zahlen haben dort
 * tatsächlich denselben Kontrast; in HSL hätte das Gelb geleuchtet und das Blau wäre
 * abgesoffen. Dadurch ist jedes Monogramm gleich gut lesbar, und die helle wie die
 * dunkle Ansicht bekommen ihre eigenen Werte, ohne dass diese Datei davon weiß.
 */

/**
 * So viele Farbtöne gibt es.
 *
 * Nicht 360: bei stufenlosem Farbkreis liegen zwei Absender leicht drei Grad
 * auseinander, und dann ist die Farbe zwar verschieden, aber nicht unterscheidbar - was
 * den ganzen Zweck aufhebt. 14 Stufen liegen rund 26 Grad auseinander; das erkennt man
 * nebeneinander noch als zwei Farben.
 */
const TOENE = 14;

/**
 * Die Rechnung: FNV-1a, 32 Bit.
 *
 * Klein, schnell und gut gestreut - ähnliche Adressen ("anna@" und "anne@") landen
 * weit auseinander, was bei einer einfachen Quersumme nicht der Fall wäre. Es geht hier
 * nicht um Sicherheit, sondern um Streuung; eine kryptografische Rechnung wäre für den
 * Zweck nur langsamer.
 */
function streuwert(text: string): number {
  let wert = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    wert ^= text.charCodeAt(i);
    // Multiplikation mit 16777619, aufgeteilt in Verschiebungen: das Ergebnis bliebe
    // sonst nicht in den 32 Bit, mit denen JavaScript bitweise rechnet.
    wert = (wert + (wert << 1) + (wert << 4) + (wert << 7) + (wert << 8) + (wert << 24)) >>> 0;
  }
  return wert >>> 0;
}

/** Nimmt den ersten Buchstaben eines Wortes - Ziffern und Zeichen zählen nicht. */
function ersterBuchstabe(wort: string): string {
  for (const zeichen of wort) {
    if (zeichen.toLowerCase() !== zeichen.toUpperCase()) return zeichen.toUpperCase();
  }
  return '';
}

/**
 * Ein bis zwei Buchstaben.
 *
 * Aus dem angezeigten Namen die Anfangsbuchstaben des ersten und des letzten Wortes -
 * bei "Anna Bauer" also "AB". Fehlt der Name, wird der Teil der Adresse vor dem @
 * zerlegt: "anna.bauer@..." ergibt ebenfalls "AB", "postfach42@..." nur "P".
 *
 * Absichtlich höchstens zwei: bei dreien wird die Schrift so klein, dass sie in einem
 * Kreis von 26 Pixeln nicht mehr zu lesen ist, und ein unlesbares Kürzel ist ein
 * Farbfleck mit Rauschen darauf.
 */
export function kuerzel(name: string | undefined, adresse: string | undefined): string {
  const woerter = (name ?? '')
    // Anführungszeichen und Klammern kommen aus fremden Kopfzeilen und sind kein Name.
    .replace(/["'<>()[\]]/g, ' ')
    .split(/[\s,]+/)
    .map(ersterBuchstabe)
    .filter(Boolean);

  if (woerter.length >= 2) return woerter[0] + woerter[woerter.length - 1];
  if (woerter.length === 1) return woerter[0];

  const lokal = (adresse ?? '').split('@')[0] ?? '';
  const teile = lokal.split(/[._\-+]+/).map(ersterBuchstabe).filter(Boolean);
  if (teile.length >= 2) return teile[0] + teile[1];
  if (teile.length === 1) return teile[0];

  // Weder Name noch brauchbare Adresse - das kommt bei kaputten Kopfzeilen vor.
  return '@';
}

/**
 * Der Farbton, als Winkel auf dem Farbkreis (0 bis 360).
 *
 * Grundlage ist die Adresse in Kleinschreibung, nicht der angezeigte Name: denselben
 * Namen führen viele ("Newsletter", "Support"), dieselbe Adresse nur einer. Und wer
 * seinen angezeigten Namen ändert, soll trotzdem seine Farbe behalten.
 */
export function farbton(adresse: string | undefined, name?: string): number {
  const grundlage = (adresse || name || '').trim().toLowerCase();
  if (!grundlage) return 0;
  // Der Versatz von 12 Grad rückt die Stufen aus dem reinen Rot heraus, das sonst der
  // erste Ton wäre - Rot heißt in dieser Anwendung überall "Fehler".
  return ((streuwert(grundlage) % TOENE) * (360 / TOENE) + 12) % 360;
}

export interface Monogramm {
  kuerzel: string;
  farbton: number;
}

export function monogramm(name: string | undefined, adresse: string | undefined): Monogramm {
  return { kuerzel: kuerzel(name, adresse), farbton: farbton(adresse, name) };
}
