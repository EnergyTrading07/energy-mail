/**
 * Was eine Vorlesesoftware zu hören bekommt - und wie der Fokus in einem Fenster bleibt.
 *
 * Auf dem Bildschirm trägt vieles ohne Worte: Fettdruck heißt ungelesen, eine
 * Büroklammer heißt Anhang, eine Zahl neben dem Ordnernamen heißt ungelesene Post. Wer
 * die Anzeige nicht sieht, bekommt davon nichts mit - deshalb wird es hier
 * ausgeschrieben.
 *
 * Die Formulierungen stehen getrennt von der Darstellung, weil sie sich prüfen lassen
 * müssen: eine Zeile, die "3" sagt statt "3 ungelesen", fällt in keinem Bild auf.
 */

/** Die Angaben einer Listenzeile, soweit sie vorgelesen werden. */
export interface Zeilenangaben {
  absender: string;
  betreff: string;
  datum: string;
  gelesen: boolean;
  mitAnhang?: boolean;
  /** Nur in der Gesamtliste: aus welchem Postfach die Zeile stammt. */
  herkunft?: string;
  /** Anzahl der Nachrichten, wenn die Zeile ein ganzes Gespräch vertritt. */
  imGespraech?: number;
}

/**
 * Der Satz zu einer Listenzeile.
 *
 * Reihenfolge nach Wichtigkeit: Wer die Liste durchgeht, hört zuerst, ob die Nachricht
 * neu ist, dann von wem sie kommt und worum es geht. Das Datum steht hinten - danach
 * sucht man selten, und vorn hielte es nur auf.
 */
export function zeilenBeschriftung(z: Zeilenangaben): string {
  const teile: string[] = [];
  if (!z.gelesen) teile.push('Ungelesen');
  teile.push(z.absender || 'Unbekannter Absender');
  teile.push(z.betreff?.trim() || 'Ohne Betreff');
  if (z.imGespraech && z.imGespraech > 1) teile.push(`Gespräch mit ${z.imGespraech} Nachrichten`);
  if (z.mitAnhang) teile.push('mit Anhang');
  if (z.herkunft) teile.push(z.herkunft);
  if (z.datum) teile.push(z.datum);
  return teile.join(', ');
}

/**
 * Der Satz zu einer Ordnerzeile.
 *
 * Die Zahl daneben wurde bisher als nackte "3" vorgelesen - ohne zu sagen, wovon. Und
 * der Hinweis beim Überfahren nennt den Pfad auf dem Server ("INBOX"); der überdeckte
 * den angezeigten Namen, weil eine Vorlesesoftware title vor dem Textinhalt liest.
 */
export function ordnerBeschriftung(name: string, ungelesen?: number): string {
  if (!ungelesen) return name;
  return `${name}, ${ungelesen} ungelesen`;
}

/**
 * Der Satz zum Kästchen einer Zeile.
 *
 * Siebzehn Kästchen, die alle nur "Kontrollkästchen" heißen, sind siebzehnmal dieselbe
 * Auskunft. Es muss dabeistehen, was man da ankreuzt.
 */
export function kaestchenBeschriftung(betreff: string): string {
  return `${betreff?.trim() || 'Nachricht ohne Betreff'} auswählen`;
}

// --- Fokus in einem Fenster halten ------------------------------------------------

/**
 * Was sich mit der Tabulatortaste ansteuern lässt.
 *
 * Ohne diese Grenze wandert der Fokus aus einem geöffneten Fenster hinaus in die
 * Anwendung dahinter - man tippt dann in etwas, das man gar nicht sieht.
 */
const ANSTEUERBAR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Alles Ansteuerbare in einem Bereich, in der Reihenfolge, in der es im Baum steht. */
export function ansteuerbare(bereich: Element): HTMLElement[] {
  return [...bereich.querySelectorAll<HTMLElement>(ANSTEUERBAR)].filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    // Ausgeblendetes zählt nicht: sonst führte der Rundlauf ins Leere.
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

/**
 * Das nächste Ziel im Rundlauf.
 *
 * Am Ende geht es wieder an den Anfang und umgekehrt - so bleibt man mit der Tastatur
 * im Fenster, statt hinter ihm zu landen. Liefert null, wenn nichts zu tun ist; dann
 * soll der Browser die Taste selbst behandeln.
 */
export function naechstesZiel(
  elemente: readonly HTMLElement[],
  aktuell: Element | null,
  rueckwaerts: boolean,
): HTMLElement | null {
  if (elemente.length === 0) return null;
  const erstes = elemente[0]!;
  const letztes = elemente[elemente.length - 1]!;

  // Steht der Fokus gar nicht im Fenster - etwa gleich nach dem Öffnen -, führt die
  // Tabulatortaste hinein.
  const stelle = elemente.indexOf(aktuell as HTMLElement);
  if (stelle < 0) return rueckwaerts ? letztes : erstes;

  if (!rueckwaerts && aktuell === letztes) return erstes;
  if (rueckwaerts && aktuell === erstes) return letztes;
  return null;
}

/**
 * Worauf der Fokus beim Öffnen eines Fensters gehen soll.
 *
 * Auf das erste Eingabefeld, wenn es eines gibt - da will man ohnehin hin. Sonst auf
 * das Fenster selbst, damit die Vorlesesoftware seinen Namen nennt und nicht
 * irgendeinen Knopf aus der Mitte.
 */
export function ersterFokus(bereich: HTMLElement): HTMLElement {
  const felder = ansteuerbare(bereich).filter(
    (el) =>
      (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox') ||
      el.tagName === 'TEXTAREA' ||
      el.getAttribute('contenteditable') === 'true',
  );
  return felder[0] ?? bereich;
}
