import { app } from 'electron';
import {
  setzeSprache,
  waehleSprache,
  type Sprache,
} from '@energy-mail/mail-core/sprache';
import { ladeFuer } from '@energy-mail/mail-core/sprachen';
import { einstellungen } from './einstellungen.js';
import { richtlinien } from './richtlinien.js';

/**
 * Welche Sprache die Hülle spricht.
 *
 * Die Entscheidung selbst steht in mail-core (waehleSprache) und ist dort rein rechnend
 * und geprüft. Hier werden nur die drei Quellen zusammengetragen, die es in einer
 * Electron-Anwendung gibt - dieselbe Aufteilung wie beim Proxy, und aus demselben Grund:
 * die Regel soll sich prüfen lassen, ohne dass dafür Windows, eine Datei und ein
 * laufendes Electron gebraucht werden.
 *
 * Muss laufen, BEVOR das Menü gebaut wird und bevor das erste Fenster aufgeht. Danach
 * umzustellen geht auch - das Menü wird dann neu gebaut -, aber beim Start ist die
 * Reihenfolge nicht gleichgültig.
 */

/**
 * Was im Menü zur Wahl steht.
 *
 * Die Liste stand einmal hier und wurde aus SPRACHEN abgeleitet. Inzwischen steht sie in
 * mail-core neben SPRACHEN selbst - die Oberfläche im Browser braucht dieselbe Auswahl,
 * und zwei Ableitungen derselben Tabelle sind wieder zwei Listen. Hier bleibt nur die
 * Weitergabe stehen, damit das Menü nichts von der Umstellung merkt.
 */
export { SPRACHWAHL } from '@energy-mail/mail-core/sprache';

/**
 * Ermittelt die Sprache und stellt sie ein.
 *
 * Gibt zurück, was gilt - für die Zeile im Protokoll. Bei einem Fehlerbericht aus einem
 * Unternehmen ist das eine der Fragen, die man sonst stellen müsste.
 */
export function wendeSpracheAn(): Sprache {
  const gewaehlt = waehleSprache({
    richtlinie: richtlinien().sprache,
    nutzer: einstellungen().sprache,
    // app.getLocale() liefert die Sprache, auf die Windows eingestellt ist - "de-DE",
    // "en-GB". Erst nach 'ready' verlässlich; wendeSpracheAn() läuft entsprechend spät.
    system: app.getLocale(),
  });
  setzeSprache(gewaehlt);
  /*
   * Der Katalog kommt nach, die Sprache gilt sofort.
   *
   * Absichtlich nicht abgewartet: Diese Funktion muss vor dem Menübau laufen und wird von
   * dort aus rechnend gerufen. Bis der Abschnitt geladen ist, steht Deutsch da - das sind
   * Millisekunden aus dem Dateisystem, und danach baut `wendeSpracheAn` das Menü ohnehin
   * neu. Wer hier `await` erzwingen wollte, müsste den halben Start umbauen, um wenige
   * Millisekunden zu gewinnen, in denen niemand hinsieht.
   */
  void ladeFuer(gewaehlt);
  return gewaehlt;
}

/** Eine Zeile fürs Protokoll - woher die Sprache kommt, ist die zweite Frage. */
export function beschreibeSprache(): string {
  const woher = richtlinien().sprache
    ? 'aus der Richtliniendatei'
    : einstellungen().sprache !== 'automatisch'
      ? 'vom Nutzer gewählt'
      : `vom System (${app.getLocale()})`;
  return `Sprache: ${wendeSpracheAn()} (${woher}).`;
}
