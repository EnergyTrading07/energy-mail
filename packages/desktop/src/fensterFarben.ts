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
 * einer der Grundtöne, gehört er hier nachgezogen; es ist eine Handvoll Werte, und sie
 * stehen alle in diesem einen Block.
 */

export interface Fensterfarben {
  /** Grund des Fensters, bevor die Oberfläche geladen ist - muss zu --grund passen. */
  grund: string;
  /** Fläche der Titelleiste. Sie trägt seit der Umgestaltung denselben Ton wie der
      Grund: die Leiste ist der obere Rand der Anwendung und kein eigenes Band. */
  leiste: string;
  /** Zeichen der Fensterknöpfe - muss zu --text-2 passen. */
  zeichen: string;
  /** Fläche und Schrift der kleinen eigenen Fenster - muss zu --flaeche/--text passen. */
  flaeche: string;
  text: string;
  text2: string;
  rand: string;
}

export const FARBEN: Record<'hell' | 'dunkel', Fensterfarben> = {
  hell: {
    grund: '#f0ede6',
    leiste: '#f0ede6',
    zeichen: '#55504a',
    flaeche: '#fffdf9',
    text: '#1b1917',
    text2: '#55504a',
    rand: '#ded9ce',
  },
  dunkel: {
    grund: '#090b11',
    leiste: '#090b11',
    zeichen: '#a8a49c',
    flaeche: '#11141c',
    text: '#ebe8e2',
    text2: '#a8a49c',
    rand: '#242935',
  },
};

/** Höhe der Titelleiste; muss zu --leiste-hoehe in tokens.css passen. */
export const LEISTE_HOEHE = 42;

export const MARKE = '#2b48d4';
export const BLITZ = '#ffb225';
