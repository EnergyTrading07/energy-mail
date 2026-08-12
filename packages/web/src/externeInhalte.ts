/**
 * Entfernte Inhalte aus fremden Nachrichten unschädlich machen.
 *
 * Der Grund ist nicht Darstellung, sondern Rückmeldung an den Absender. Ein einziges
 * Bild von einem fremden Server verrät beim Öffnen: diese Adresse existiert, sie wird
 * gelesen, und zwar gerade jetzt, von diesem Anschluss aus. Werbeversender bauen genau
 * dafür ein Bild von einem Pixel Größe ein. Alle etablierten Mailprogramme laden fremde
 * Inhalte deshalb erst auf Zuruf.
 *
 * Nicht angerührt wird, was nichts nach draußen meldet: eingebettete Bilder der
 * Nachricht selbst (der Server hat sie schon zu Adressen auf uns umgeschrieben),
 * eingebaute Daten und Sprungmarken innerhalb der Nachricht.
 */

/** Attribute, über die ein Element von sich aus etwas nachlädt. */
const LADENDE_ATTRIBUTE = [
  'src',
  'srcset',
  'poster',
  'background',
  'data',
  'href',
  /*
   * Die alte Schreibweise innerhalb von SVG. <image xlink:href="..."> lädt genauso wie
   * ein gewöhnliches <img src="...">, und Programme schreiben sie bis heute.
   */
  'xlink:href',
] as const;

/**
 * Nur diese Elemente laden über "href" tatsächlich etwas nach. Ein gewöhnlicher Verweis
 * im Text tut das nicht - der würde nur beim Anklicken folgen, und dann will der Leser
 * es auch.
 *
 * Die beiden SVG-Elemente standen hier nicht, und das war eine Lücke: <svg><image
 * href="https://verfolger/pixel.png"> lädt beim bloßen Öffnen der Nachricht, ganz ohne
 * <img>. Dasselbe gilt für <use href="..."> auf eine fremde Datei. Die Leiste meldete
 * dabei "nichts zurückgehalten" - der Zählpixel ging durch, und der Nutzer bekam sogar
 * die Zusicherung, dass nichts passiert sei.
 *
 * Kleingeschrieben, weil tagName bei SVG-Elementen die Schreibweise aus dem Quelltext
 * behält: bei HTML-Elementen kommt "IMAGE", bei SVG "image".
 */
const HREF_LAEDT = new Set(['LINK', 'image', 'use', 'IMAGE', 'USE']);

/**
 * Ist die Adresse eine, die nach draußen führt?
 *
 * Alles ohne Schema bleibt: der Server hat die eingebetteten Bilder der Nachricht
 * bereits zu Adressen auf uns selbst umgeschrieben, und die sollen laden.
 */
function fuehrtNachDraussen(wert: string): boolean {
  const roh = wert.trim();
  if (!roh) return false;
  // "//beispiel.de/bild.png" erbt das Schema und führt genauso nach draußen.
  if (roh.startsWith('//')) return true;
  const schema = roh.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (!schema) return false;
  // "data:" trägt die Daten selbst, "cid:" zeigt in die Nachricht.
  return schema !== 'data' && schema !== 'cid';
}

/** In "url(...)" innerhalb von CSS steckt derselbe Abruf - auch in Kurzschreibweisen. */
const URL_IM_CSS = /url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi;

/**
 * "@import" ohne url() - die kurze Schreibweise.
 *
 * `@import "https://boese/x.css";` lädt genauso wie `@import url(...)`, wurde aber vom
 * Muster darüber nicht erfasst und blieb deshalb stehen.
 */
const IMPORT_IM_CSS = /@import\s+(['"])([^'"]+)\1/gi;

/**
 * Ersetzt jede nach draußen führende Adresse in einem Stück CSS.
 *
 * Gibt getrennt zurück, ob etwas geändert wurde - und stützt das nicht auf das Wachsen
 * der Adressmenge. Genau daran scheiterte es zuvor: eine Rundmail nannte dasselbe Bild
 * einmal im "background"-Attribut und einmal in der Stilangabe desselben Elements. Beim
 * zweiten Mal war die Adresse schon bekannt, die Menge wuchs nicht, und die Stilangabe
 * blieb stehen - das Bild wurde geladen.
 */
function cssEntschaerfen(
  css: string,
  gesehen: Set<string>,
): { css: string; geaendert: boolean } {
  let geaendert = false;
  let neu = css.replace(URL_IM_CSS, (ganzes, anfuehrung, adresse) => {
    if (!fuehrtNachDraussen(adresse)) return ganzes;
    gesehen.add(adresse.trim());
    geaendert = true;
    // Der Wert bleibt lesbar erhalten, verweist aber ins Nichts: so bleibt das
    // Seitenlayout erhalten, ohne dass etwas geladen wird.
    return `url(${anfuehrung}about:blank${anfuehrung})`;
  });
  neu = neu.replace(IMPORT_IM_CSS, (ganzes, anfuehrung, adresse) => {
    if (!fuehrtNachDraussen(adresse)) return ganzes;
    gesehen.add(adresse.trim());
    geaendert = true;
    return `@import ${anfuehrung}about:blank${anfuehrung}`;
  });
  return { css: neu, geaendert };
}

export interface EntschaerftesErgebnis {
  html: string;
  /**
   * Wie viele verschiedene Adressen nicht abgerufen wurden.
   *
   * Verschiedene, nicht Verweise: eine Rundmail nennt dasselbe Bild oft mehrfach - beim
   * GMX-Magazin standen 29 Verweise auf 13 Bilder. "29 Inhalte" zu melden und dann 13
   * Abrufe auszulösen wäre schlicht falsch gezählt.
   */
  anzahl: number;
}

/**
 * Nimmt das HTML einer Nachricht und gibt es ohne Abrufe nach draußen zurück.
 *
 * Die ursprünglichen Werte bleiben in "data-extern-*" stehen. Damit lässt sich später
 * ohne erneuten Abruf umschalten - der Leser sieht sofort die Bilder, wenn er sie will.
 */
export function entschaerfeExterneInhalte(html: string): EntschaerftesErgebnis {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const gesehen = new Set<string>();

  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attribut of LADENDE_ATTRIBUTE) {
      if ((attribut === 'href' || attribut === 'xlink:href') && !HREF_LAEDT.has(el.tagName)) {
        continue;
      }
      const wert = el.getAttribute(attribut);
      if (!wert) continue;

      // srcset enthält mehrere Adressen mit Größenangaben.
      const adressen =
        attribut === 'srcset' ? wert.split(',').map((t) => t.trim().split(/\s+/)[0] ?? '') : [wert];
      const draussen = adressen.filter(fuehrtNachDraussen);
      if (draussen.length === 0) continue;

      for (const a of draussen) gesehen.add(a.trim());
      el.setAttribute(`data-extern-${attribut}`, wert);
      el.removeAttribute(attribut);
    }

    // Stilangaben am Element selbst.
    const stil = el.getAttribute('style');
    if (stil) {
      const { css, geaendert } = cssEntschaerfen(stil, gesehen);
      if (geaendert) {
        el.setAttribute('data-extern-style', stil);
        el.setAttribute('style', css);
      }
    }
  }

  // Ganze Stilblöcke.
  for (const block of Array.from(doc.querySelectorAll('style'))) {
    block.textContent = cssEntschaerfen(block.textContent ?? '', gesehen).css;
  }

  /*
   * Die Weiterleitung per <meta http-equiv="refresh">.
   *
   * Sie braucht kein Skript und stand deshalb außerhalb von allem, was hier bisher
   * geprüft wurde: das Ziel steht im "content"-Attribut, und das ist kein ladendes
   * Attribut im obigen Sinn. Eine Werbemail konnte damit beim bloßen Öffnen einen Abruf
   * nach draußen auslösen - während die Leiste dem Nutzer meldete, es sei nichts
   * zurückgehalten worden.
   */
  for (const meta of Array.from(doc.querySelectorAll('meta'))) {
    if (meta.getAttribute('http-equiv')?.toLowerCase() !== 'refresh') continue;
    const inhalt = meta.getAttribute('content') ?? '';
    const ziel = inhalt.match(/url\s*=\s*(['"]?)([^'";]+)\1/i)?.[2];
    if (ziel && fuehrtNachDraussen(ziel)) gesehen.add(ziel.trim());
    meta.setAttribute('data-extern-refresh', inhalt);
    meta.removeAttribute('content');
  }

  /*
   * <base href> biegt ALLE relativen Adressen um - auch die cid:-Bilder, die der Server
   * bereits auf sich selbst umgeschrieben hat. Ein einziges solches Element hebelt die
   * gesamte Entschärfung aus. Es gibt keinen Grund, warum eine E-Mail eines braucht.
   */
  for (const base of Array.from(doc.querySelectorAll('base'))) {
    const wert = base.getAttribute('href');
    if (wert && fuehrtNachDraussen(wert)) gesehen.add(wert.trim());
    base.remove();
  }

  /*
   * Kopf UND Rumpf zurückgeben.
   *
   * Vorher stand hier nur doc.body.innerHTML. Die meisten Rundmails sind vollständige
   * Dokumente, deren <style>-Blöcke nach dem Einlesen im <head> liegen - sie gingen
   * damit verloren, und die entschärfte Fassung erschien als unformatierter Textklumpen.
   * Nach einer Freigabe wurde dagegen das rohe HTML samt Kopf gezeigt: dieselbe
   * Nachricht sah vor und nach "Einmal laden" völlig verschieden aus. Die Stilblöcke im
   * Kopf sind oben bereits entschärft worden.
   */
  return { html: doc.head.innerHTML + doc.body.innerHTML, anzahl: gesehen.size };
}

/**
 * Grobe Zählung, ohne das HTML umzubauen - für die Frage "hat diese Nachricht
 * überhaupt entfernte Inhalte?", bevor entschieden ist, ob entschärft wird.
 */
export function zaehleExterneInhalte(html: string): number {
  return entschaerfeExterneInhalte(html).anzahl;
}

/** Nur der Sonderfall Zählpixel: winzige Bilder, die nichts darstellen sollen. */
export function enthaeltZaehlpixel(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return Array.from(doc.querySelectorAll('img')).some((img) => {
    const quelle = img.getAttribute('src') ?? img.getAttribute('data-extern-src') ?? '';
    if (!fuehrtNachDraussen(quelle)) return false;
    const breite = Number(img.getAttribute('width'));
    const hoehe = Number(img.getAttribute('height'));
    return breite > 0 && breite <= 3 && hoehe > 0 && hoehe <= 3;
  });
}
