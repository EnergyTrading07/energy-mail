/**
 * Wie viele es höchstens sein dürfen.
 *
 * ## Warum dafür eine eigene Datei
 *
 * Weil eine Seitengröße früher oder später in `slice(-n)` landet, und dort verhält sich
 * JavaScript genau falschherum:
 *
 * ```
 * alle.slice(-25)    die letzten 25          - gemeint
 * alle.slice(-NaN)   ALLE                    - NaN wird zu 0
 * alle.slice(-0)     ALLE                    - -0 ist 0
 * alle.slice(5)      alles ab dem sechsten   - bei einer negativen Anzahl
 * ```
 *
 * Aus einer Begrenzung wird damit ihr Gegenteil: keine Begrenzung. Und zwar lautlos - NaN
 * wirft nicht, es wandert weiter.
 *
 * ## Der Fehler, der dahinterstand
 *
 * Gefunden an fünf Wegen des Servers, alle nach demselben Muster
 * (`Number(request.query.pageSize)` ohne Prüfung):
 *
 *  - Die Suche holte mit `?pageSize=abc` die Kopfdaten *jeder* Nachricht in *jedem*
 *    durchsuchten Ordner - und gab am Ende null Treffer zurück, weil dieselbe Zahl weiter
 *    unten in `slice(0, NaN)` steckte. Der teuerste denkbare Weg zu einem leeren Ergebnis.
 *  - Die Absenderübersicht nahm statt einer Stichprobe den ganzen Ordner.
 *  - Am schwersten wog `apply-rules`: Dort wurden die Regeln nicht auf die neuesten
 *    zweihundert Nachrichten angewandt, sondern auf alle - und Regeln verschieben und
 *    löschen. Ein Tippfehler in einer Adresszeile hätte ein Postfach umgeräumt.
 *
 * ## Zwei Sicherungen, nicht eine
 *
 * Der Server weist unbrauchbare Angaben mit 400 ab (`zahlAus` in app.ts) - dort gehört es
 * hin, denn dort ist bekannt, dass eine Eingabe eines Menschen vorliegt. Hier steht die
 * zweite: Eine Bibliothek, die aus einer unbrauchbaren Grenze "unbegrenzt" macht, ist eine
 * Falle für jeden künftigen Aufrufer. Der Rückfall auf die Voreinstellung ist nie
 * schlimmer als das, was gemeint war.
 */

/**
 * Eine Anzahl, auf die man sich verlassen kann.
 *
 * Alles, was keine brauchbare Anzahl ist - `undefined`, NaN, Unendlich, null, negativ -
 * ergibt die Voreinstellung. Nachkommastellen werden abgeschnitten: `slice` täte es
 * ohnehin, nur unausgesprochen.
 */
export function brauchbareAnzahl(wert: number | undefined, standard: number): number {
  if (wert === undefined) return standard;
  if (!Number.isFinite(wert) || wert < 1) return standard;
  return Math.floor(wert);
}
