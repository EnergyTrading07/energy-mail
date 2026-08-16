import { app } from 'electron';
import {
  SPRACHEN,
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
 * Was im Menü zur Wahl steht - aus SPRACHEN abgeleitet und nicht danebengeschrieben.
 *
 * Hier standen bis eben nur Deutsch und Englisch, während mail-core bereits zehn Sprachen
 * führte. Eine zweite Liste neben der ersten geht genau so lange gut, bis jemand nur eine
 * davon ergänzt - und dann fehlt die neue Sprache im Menü, obwohl ihr Katalog vorliegt.
 * Niemand sucht den Fehler dort, weil "die Sprache ist eingebaut" ja stimmt.
 *
 * Die Namen bleiben unübersetzt: Wer die Oberfläche auf einer Sprache vorfindet, die er
 * nicht liest, sucht seine eigene - und "Deutsch" erkennt er, "German" womöglich nicht.
 * So macht es jedes Betriebssystem.
 */
export const SPRACHWAHL: { wert: string; name: string }[] = [
  { wert: 'automatisch', name: 'Automatisch / Automatic' },
  ...(Object.entries(SPRACHEN) as [Sprache, { name: string }][]).map(([wert, angaben]) => ({
    wert,
    name: angaben.name,
  })),
];

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
