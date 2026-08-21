/**
 * Umwandlungen zwischen formatiertem und reinem Text.
 *
 * Jede versendete Nachricht bekommt beide Fassungen: Empfänger mit abgeschalteter
 * HTML-Anzeige - und viele Spamfilter - erwarten eine brauchbare Textalternative.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ESCAPES[c]);
}

/** Reiner Text zu HTML: Absätze und Zeilenumbrüche bleiben erhalten. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((absatz) => `<p>${escapeHtml(absatz).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * HTML zu lesbarem Text. Nutzt den Browser zum Auswerten statt eigener
 * Zeichenkettenakrobatik - so werden auch verschachtelte Elemente korrekt behandelt.
 */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('script, style').forEach((el) => el.remove());

  // Listenpunkte als "- " kennzeichnen, damit die Struktur im Text erkennbar bleibt.
  doc.querySelectorAll('li').forEach((li) => li.prepend(doc.createTextNode('- ')));

  // Blockelemente durch Umbrüche trennen; ohne das klebt alles in einer Zeile.
  doc.querySelectorAll('br').forEach((br) => br.replaceWith(doc.createTextNode('\n')));
  doc.querySelectorAll('p, div, li, tr, h1, h2, h3, h4, h5, h6, blockquote').forEach((el) => {
    el.append(doc.createTextNode('\n'));
  });

  return (doc.body.textContent ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
