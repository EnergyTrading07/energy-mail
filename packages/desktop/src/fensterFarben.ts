/**
 * Die wenigen Farbwerte, die auch außerhalb des Fensters gebraucht werden.
 *
 * Innerhalb der Oberfläche kommen alle Farben aus packages/web/src/design/tokens.css.
 * An drei Stellen geht das nicht, weil dort kein Stylesheet gilt: der Grund des
 * Fensters, bevor irgendetwas geladen ist (sonst blitzt Weiß auf), die von Windows
 * gezeichnete Leiste mit den Fensterknöpfen, und die kleinen eigenen Fenster (Start,
 * Startfehler, Über).
 *
 * Deshalb stehen sie hier ein zweites Mal - und nur diese. Ändert sich in tokens.css
 * einer der beiden Grundtöne, gehört er hier nachgezogen; es sind vier Werte.
 */

export interface Fensterfarben {
  /** Grund des Fensters, bevor die Oberfläche geladen ist. */
  grund: string;
  /** Fläche der Titelleiste - muss zu --flaeche-leise passen. */
  leiste: string;
  /** Zeichen der Fensterknöpfe - muss zu --text-2 passen. */
  zeichen: string;
}

export const FARBEN: Record<'hell' | 'dunkel', Fensterfarben> = {
  hell: { grund: '#eaeef5', leiste: '#f6f8fc', zeichen: '#4d5867' },
  dunkel: { grund: '#0d1117', leiste: '#11161e', zeichen: '#a2b0c1' },
};

/** Höhe der Titelleiste; muss zu --leiste-hoehe in tokens.css passen. */
export const LEISTE_HOEHE = 40;

export const MARKE = '#2f5fd8';
export const BLITZ = '#f5c518';
