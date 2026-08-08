/*
 * Setzt das Erscheinungsbild, bevor irgendetwas gezeichnet wird.
 *
 * Läuft synchron im Kopf der Seite und damit vor dem ersten Bild. Ohne diesen Schritt
 * blitzt beim Start kurz die helle Ansicht auf, bevor React die gespeicherte Wahl
 * anwendet - bei einem Programm, das jemand morgens um sechs im Dunkeln öffnet, ist
 * das kein Schönheitsfehler.
 *
 * Eine eigene Datei und nicht mehr im HTML: das Schutzregelwerk (Content-Security-
 * Policy) lässt keine unmittelbar eingebetteten Skripte zu. Ein Hash wäre die
 * Alternative gewesen - der müsste aber bei jeder Änderung von Hand nachgezogen
 * werden, und vergisst man es einmal, blitzt es wieder, ohne dass jemand die Ursache
 * ahnt. Die zusätzliche Anfrage kostet beim eigenen Server unter einer Millisekunde.
 */
(function () {
  try {
    var wahl = localStorage.getItem('energy-mail:thema');
    var dunkel =
      wahl === 'dunkel' ||
      ((!wahl || wahl === 'system') &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.thema = dunkel ? 'dunkel' : 'hell';
  } catch (e) {
    // Ohne lesbaren Speicher bleibt es bei hell - kein Grund, den Start abzubrechen.
  }
})();
