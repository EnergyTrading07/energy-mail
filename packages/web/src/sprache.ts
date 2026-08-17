import {
  datum,
  gebietsschema,
  setzeSprache,
  t,
  tp,
  uhrzeit,
  waehleSprache,
  zahl,
} from '@energy-mail/mail-core/sprache';
import { ladeFuer } from '@energy-mail/mail-core/sprachen';

/**
 * Die Sprache der Oberfläche.
 *
 * Der Kern steht in mail-core und wird von der Hülle genauso benutzt; hier steht nur, was
 * im Browser anders ist - nämlich woher die Sprache kommt.
 *
 * ## Zwei Betriebsarten, zwei Quellen
 *
 * **Als Desktop-Anwendung** hat die Hülle bereits entschieden (Richtlinie, dann Wahl des
 * Nutzers, dann Windows) und reicht das Ergebnis über die Brücke herein. Es hier noch
 * einmal zu ermitteln wäre nicht nur überflüssig, sondern falsch: Die Hülle kennt die
 * Richtliniendatei des Unternehmens, der Browser nicht - herauskäme eine Anwendung mit
 * englischem Menü und deutscher Oberfläche.
 *
 * **Im Browser** (Serverbetrieb) gibt es keine Brücke. Dann entscheidet, was der Nutzer
 * hier gewählt hat, sonst die Spracheinstellung des Browsers.
 *
 * Die Wahl liegt im Browserspeicher und nicht auf dem Server: Sie gehört zum Gerät, nicht
 * zum Postfach. Wer im Büro einen englischen und zu Hause einen deutschen Rechner hat,
 * meint auch beides so.
 */

const SCHLUESSEL = 'energy-mail:sprache';

/** Was der Nutzer im Browser gewählt hat - "automatisch", wenn nichts gewählt ist. */
export function gewaehlteSprache(): string {
  try {
    return localStorage.getItem(SCHLUESSEL) ?? 'automatisch';
  } catch {
    // Ein Browser, der den Speicher sperrt, hat auch nichts hineingeschrieben.
    return 'automatisch';
  }
}

/**
 * Stellt die Sprache um und lädt die Seite neu.
 *
 * Neu laden statt alles neu zu zeichnen: Die Texte stecken in hunderten Bausteinen, von
 * denen die wenigsten auf eine Änderung horchen. Ein halb umgestelltes Fenster wäre
 * schlechter als eine Sekunde Wartezeit - und die Sprache stellt man einmal um, nicht
 * beim Arbeiten.
 *
 * Wohin die Wahl geht, hängt an der Betriebsart, und das ist keine Feinheit: In der
 * Desktop-Hülle spricht auch das Anwendungsmenü, sprechen die Meldungen von Windows und
 * die kleinen Fenster der Hülle - alle aus huelle.json, alle bevor überhaupt eine
 * Oberfläche geladen ist. Eine Wahl, die nur im Browserspeicher der Oberfläche landete,
 * ergäbe eine englische Oberfläche unter einem deutschen Menü. Im Browser gibt es diese
 * Kette nicht, dort ist der Browserspeicher der richtige Ort: Die Sprache gehört zum
 * Gerät, nicht zum Postfach.
 */
export async function waehleSpracheUndLadeNeu(wert: string): Promise<void> {
  const bruecke = window.energyMail;
  if (bruecke) {
    // Der Hauptprozess schreibt, stellt sein Menü um und meldet den Stand zurück; erst
    // danach neu laden, sonst liest das Vorschaltskript noch die alte Sprache.
    await bruecke.setzeHuelle('sprache', wert).catch(() => undefined);
  } else {
    try {
      localStorage.setItem(SCHLUESSEL, wert);
    } catch {
      // Dann gilt sie eben nur für diesen Lauf.
    }
  }
  window.location.reload();
}

/**
 * Richtet die Sprache ein. Muss VOR dem ersten Zeichnen abgewartet werden.
 *
 * Erst entscheiden, dann laden - und nicht umgekehrt: Geladen wird nur der Katalog, der
 * auch gebraucht wird (plus Englisch als Zwischenstufe). Alle zehn fest einzubinden wäre
 * die kürzere Zeile und die schlechtere Lösung; neun Zehntel davon lägen dann in jedem
 * Abruf mit dabei, für jeden Nutzer, ohne je gelesen zu werden.
 *
 * Warum abgewartet werden muss: `t()` liest den Katalog beim Aufruf. Ein Baustein, der
 * vorher entsteht, steht auf Deutsch da und bleibt es, bis er aus einem anderen Grund neu
 * gezeichnet wird. Das Ergebnis wären einzelne deutsche Reste in einer englischen
 * Oberfläche, die beim Klicken verschwinden - so etwas meldet niemand, weil es nicht wie
 * ein Fehler aussieht.
 */
export async function richteSpracheEin(): Promise<void> {
  const gewaehlt = waehleSprache({
    // Die Hülle hat entschieden; im Browser ist der Wert leer und fällt durch.
    richtlinie: window.energyMail?.sprache,
    nutzer: gewaehlteSprache(),
    system: navigator.language,
  });
  await ladeFuer(gewaehlt);
  setzeSprache(gewaehlt);
}

/*
 * Weitergereicht, damit die Bausteine nur aus einer Datei einbinden müssen und nicht aus
 * zweien - der Unterschied zwischen "aus dem Kern" und "von hier" interessiert dort nicht.
 *
 * `datum`, `uhrzeit` und `zahl` gehören mit dazu, und das ist keine Bequemlichkeit: Im
 * Quelltext stand fünfundzwanzigmal `toLocaleDateString('de-DE')` ausgeschrieben. Solange
 * es nur Deutsch gab, war das richtig - bei der ersten weiteren Sprache wäre daraus ein
 * Fehler geworden, den niemand sucht, weil die Oberfläche ja übersetzt ist.
 */
export { t, tp, datum, uhrzeit, zahl, gebietsschema };

/** Datum und Uhrzeit zusammen - der vollstaendige Zeitstempel einer Nachricht. */
export function zeitpunkt(wert: Date): string {
  return wert.toLocaleString(gebietsschema());
}
