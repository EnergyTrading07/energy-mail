import type { Session } from 'electron';

/**
 * Was hinausgeht, wenn der Nutzer entfernte Inhalte freigibt - und was dabei nicht
 * hinausgehen soll.
 *
 * Bis hierher endet die Sorgfalt beim Zurückhalten: externeInhalte.ts nimmt jeder
 * Nachricht die ladenden Adressen, und erst auf ausdrückliches "Einmal laden" gehen sie
 * hinaus. Nur endete dort auch alles Weitere. Klickt der Nutzer, geht Chromium mit einer
 * fremden Werbeanlage so um wie mit jeder Webseite: es nimmt ihre Kekse an, hebt sie auf
 * und schickt sie beim nächsten Mal wieder mit.
 *
 * Das ist genau die Wiedererkennung, gegen die das Zurückhalten gedacht ist, nur einen
 * Schritt später. Der Zählpixel in Rundmail A setzt einen Keks, der in Rundmail B
 * bekommt ihn zurück - und der Versender weiß, dass beide derselbe Mensch gelesen hat,
 * über Wochen hinweg, obwohl zwischen den Nachrichten nichts liegt als dieselbe Anlage.
 * Freigegeben hat der Nutzer, dass ein Bild geladen wird. Nicht, dass eine Kennung
 * angelegt wird, die ihn beim nächsten Mal wiedererkennt.
 *
 * Dazu kommt, was in jedem Abruf ungefragt mitgeht: die Programmkennung. Chromium
 * schreibt "Energy Mail/0.2.1 … Electron/43.3.0" in jede Anfrage. Damit erfährt ein
 * Versender, der ein einziges Bild unterbringt, welches Mailprogramm in welcher Fassung
 * auf welchem System liest - eine Auskunft, um die niemand gebeten hat und die zusammen
 * mit der Adresse einen Menschen ziemlich genau beschreibt.
 *
 * Alles hier betrifft ausschließlich FREMDE Ziele. Der eigene Server bleibt unangetastet:
 * an ihm hängen die Sitzung, das Zugangsgeheimnis und die Anhänge.
 */

/** Wo die eigene Anwendung liegt - alles andere ist draußen. */
const EIGEN = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Ist diese Anfrage an den eigenen Server gerichtet?
 *
 * Im Zweifel nein: eine Adresse, die sich nicht lesen lässt, wird wie ein fremdes Ziel
 * behandelt. Der Schaden ist dann ein fehlender Keks, nicht ein durchgereichter.
 */
export function fuehrtNachDraussen(adresse: string): boolean {
  try {
    return !EIGEN.has(new URL(adresse).hostname);
  } catch {
    return true;
  }
}

/**
 * Nimmt aus der Programmkennung heraus, was das Programm benennt.
 *
 * Übrig bleibt die gewöhnliche Kennung eines Chromium-Browsers. Bewusst kein
 * ausgedachter Wert: was hier steht, stimmt weiterhin - es ist wirklich diese
 * Chromium-Fassung, die den Abruf macht. Es steht nur nicht mehr dabei, in welchem
 * Programm sie steckt.
 *
 * Aus "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)
 * Energy Mail/0.2.1 Chrome/140.0.0.0 Electron/43.3.0 Safari/537.36" wird damit dieselbe
 * Zeile ohne die beiden mittleren Angaben.
 */
export function ohneProgrammkennung(kennung: string): string {
  return kennung
    .replace(/\s*Energy[ +]Mail\/\S+/gi, '')
    .replace(/\s*Electron\/\S+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Kopfzeilen, die ein fremder Server nicht bekommt.
 *
 * - `cookie`: die Wiedererkennung, um die es oben geht. Das Gegenstück `set-cookie` wird
 *   in der Antwort entfernt, damit gar nicht erst einer entsteht.
 * - `referer`: verriete, aus welcher Nachricht heraus geladen wurde. Der Rahmen der
 *   Leseansicht trägt zwar `referrerPolicy="no-referrer"`, aber ein srcdoc-Rahmen erbt
 *   seine Richtlinie vom Elterndokument - die Angabe am Element ist also kein Riegel, auf
 *   den man sich verlassen sollte.
 * - `sec-ch-ua*`: die Client Hints. Sie tragen dieselbe Auskunft wie die Programmkennung,
 *   nur in Einzelteilen, und werden gern übersehen, weil sie niemand von Hand setzt.
 */
const NICHT_NACH_DRAUSSEN = /^(cookie|referer|sec-ch-ua.*)$/i;

/**
 * Die Kopfzeilen einer Anfrage, wie sie ein fremder Server sehen darf.
 *
 * Getrennt vom Einrichten, damit es sich prüfen lässt: dass ein Keks durchgeht, sieht man
 * einer laufenden Anwendung nicht an.
 */
export function fuerFremdeAnfrage(
  kopfzeilen: Record<string, string>,
  kennung: string,
): Record<string, string> {
  const gefiltert: Record<string, string> = {};
  for (const [name, wert] of Object.entries(kopfzeilen)) {
    if (NICHT_NACH_DRAUSSEN.test(name)) continue;
    gefiltert[name] = wert;
  }
  // Nur ersetzen, wo schon eine steht: eine Anfrage ohne Programmkennung fällt bei
  // manchen Servern durch, und aufzufallen ist das Gegenteil des Ziels.
  for (const name of Object.keys(gefiltert)) {
    if (name.toLowerCase() === 'user-agent') gefiltert[name] = kennung;
  }
  return gefiltert;
}

/**
 * Die Kopfzeilen einer Antwort, so wie sie angenommen werden - ohne Keks.
 *
 * Arbeitet auf der übergebenen Sammlung, weil Electron dieselbe zurückerwartet.
 */
export function ohneKeksVergabe<T>(kopfzeilen: Record<string, T>): Record<string, T> {
  /*
   * Der Name kommt in jeder Schreibweise vor - "Set-Cookie", "set-cookie", "SET-COOKIE".
   * Ein Vergleich auf die eine gebräuchliche Form ließe die anderen durch, und ein
   * einziger durchgelassener Keks genügt für die Wiedererkennung.
   */
  for (const name of Object.keys(kopfzeilen)) {
    if (/^set-cookie2?$/i.test(name)) delete kopfzeilen[name];
  }
  return kopfzeilen;
}

/**
 * Richtet beides ein: was hinausgeht und was hereinkommt.
 *
 * Am Sitzungsobjekt und nicht am Fenster - so gilt es für jeden Abruf, den irgendein
 * Teil der Anwendung auslöst, auch für einen, den es heute noch nicht gibt.
 */
export function richteNetzhygieneEin(sitzung: Session): void {
  const gekuerzteKennung = ohneProgrammkennung(sitzung.getUserAgent());

  sitzung.webRequest.onBeforeSendHeaders((angaben, weiter) => {
    if (!fuehrtNachDraussen(angaben.url)) {
      weiter({ requestHeaders: angaben.requestHeaders });
      return;
    }
    weiter({ requestHeaders: fuerFremdeAnfrage(angaben.requestHeaders, gekuerzteKennung) });
  });

  sitzung.webRequest.onHeadersReceived((angaben, weiter) => {
    const kopfzeilen = angaben.responseHeaders;
    if (!kopfzeilen || !fuehrtNachDraussen(angaben.url)) {
      weiter({ responseHeaders: kopfzeilen ?? undefined });
      return;
    }
    weiter({ responseHeaders: ohneKeksVergabe(kopfzeilen) });
  });

  richteBerechtigungenEin(sitzung);
}

/**
 * Was eine Seite in diesem Fenster vom System verlangen darf.
 *
 * Ohne einen eigenen Behandler gewährt Electron die meisten Anfragen von sich aus - also
 * Standort, Kamera, Mikrofon, Systemmeldungen und Bildschirmaufnahme. Für ein Programm,
 * das fremdes HTML aus E-Mails anzeigt, ist das die falsche Vorgabe, auch wenn heute
 * niemand dorthin kommt: im Nachrichtenrahmen läuft kein Skript (siehe MessageView.tsx),
 * und ohne Skript fragt niemand nach dem Standort.
 *
 * Genau deshalb steht es hier. Der Schutz hängt sonst allein daran, dass an einer ganz
 * anderen Stelle `sandbox="allow-same-origin"` ohne `allow-scripts` steht - eine
 * Zusicherung, die beim nächsten Umbau der Leseansicht still wegfallen kann. Dann fiele
 * zugleich die Vorgabe "gewährt" auf einen Rahmen, in dem fremdes Skript läuft.
 *
 * Erlaubt bleibt eine einzige Sache: in die Zwischenablage schreiben. Das braucht der
 * Knopf "Quelltext kopieren" (QuelltextModal.tsx). LESEN aus der Zwischenablage ist
 * ausdrücklich nicht dabei - das wäre der Weg zu allem, was der Nutzer zuletzt anderswo
 * kopiert hat.
 */
function richteBerechtigungenEin(sitzung: Session): void {
  const ERLAUBT = new Set(['clipboard-sanitized-write']);

  sitzung.setPermissionRequestHandler((_inhalt, recht, antworte) => {
    antworte(ERLAUBT.has(recht));
  });

  /*
   * Beide Behandler, nicht nur einer.
   *
   * Die meisten Web-Schnittstellen fragen zuerst, ob ein Recht schon besteht, und stellen
   * erst dann eine Anfrage. Bliebe die Prüfung bei der Vorgabe, käme es zur Anfrage gar
   * nicht - der obige Behandler liefe ins Leere, und es sähe trotzdem so aus, als sei
   * alles geregelt.
   */
  sitzung.setPermissionCheckHandler((_inhalt, recht) => ERLAUBT.has(recht));
}
