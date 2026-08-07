import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Das Modul arbeitet mit DOMParser, den es in Node nicht gibt.
const fenster = new JSDOM('').window;
globalThis.DOMParser = fenster.DOMParser as unknown as typeof DOMParser;

const { entschaerfeExterneInhalte, enthaeltZaehlpixel } = await import('./externeInhalte.js');

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void): void {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

console.log('\nWas nach draussen fuehrt, wird angehalten:');

pruefe('ein fremdes Bild wird nicht geladen', () => {
  const { html, anzahl } = entschaerfeExterneInhalte('<img src="https://werbung.de/pixel.gif">');
  assert.equal(anzahl, 1);
  assert.ok(!/(?<!data-extern-)src=/.test(html), `noch ein src drin: ${html}`);
  assert.match(html, /data-extern-src="https:\/\/werbung\.de\/pixel\.gif"/);
});

pruefe('auch ohne Schema angegebene Adressen', () => {
  // "//host/bild.png" erbt das Schema der Seite und laedt genauso.
  assert.equal(entschaerfeExterneInhalte('<img src="//werbung.de/p.gif">').anzahl, 1);
});

pruefe('Hintergrundbilder in Stilangaben', () => {
  const { html, anzahl } = entschaerfeExterneInhalte(
    '<div style="background-image:url(https://werbung.de/bg.png)">x</div>',
  );
  assert.equal(anzahl, 1);
  assert.ok(!html.includes('werbung.de/bg.png') || html.includes('data-extern-style'));
  assert.match(html, /about:blank/);
});

pruefe('Hintergrundbilder in ganzen Stilbloecken', () => {
  const { anzahl } = entschaerfeExterneInhalte(
    '<style>.a{background:url("https://werbung.de/x.png")}</style><div class="a"></div>',
  );
  assert.equal(anzahl, 1);
});

pruefe('das alte background-Attribut in Tabellen', () => {
  // So bauen viele aeltere Rundmails ihre Hintergruende.
  const { anzahl } = entschaerfeExterneInhalte('<table background="https://werbung.de/b.gif"><tr><td>x</td></tr></table>');
  assert.equal(anzahl, 1);
});

pruefe('srcset mit mehreren Groessen', () => {
  const { html, anzahl } = entschaerfeExterneInhalte(
    '<img srcset="https://w.de/a.png 1x, https://w.de/b.png 2x">',
  );
  // Zwei verschiedene Bilder, also zwei angehaltene Adressen.
  assert.equal(anzahl, 2);
  assert.match(html, /data-extern-srcset/);
  assert.ok(!/\ssrcset=/.test(html), `srcset noch da: ${html}`);
});

pruefe('eingebundene fremde Stilvorlagen', () => {
  const { anzahl } = entschaerfeExterneInhalte('<link rel="stylesheet" href="https://werbung.de/s.css">');
  assert.equal(anzahl, 1);
});

pruefe('mehrere verschiedene Adressen werden alle gezaehlt', () => {
  const { anzahl } = entschaerfeExterneInhalte(
    '<img src="https://a.de/1.png"><img src="https://a.de/2.png"><div style="background:url(https://a.de/3.png)"></div>',
  );
  assert.equal(anzahl, 3);
});

pruefe('dieselbe Adresse mehrfach zaehlt einmal', () => {
  // Beim GMX-Magazin standen 29 Verweise auf 13 Bilder. "29 Inhalte" zu melden und
  // dann 13 Abrufe auszuloesen waere falsch gezaehlt.
  const { anzahl } = entschaerfeExterneInhalte(
    '<img src="https://a.de/logo.png"><img src="https://a.de/logo.png"><img src="https://a.de/logo.png">',
  );
  assert.equal(anzahl, 1);
});


console.log('\nWas bleiben muss:');

pruefe('eingebettete Bilder der Nachricht selbst', () => {
  // Der Server hat "cid:"-Verweise schon zu Adressen auf uns umgeschrieben.
  const { html, anzahl } = entschaerfeExterneInhalte(
    '<img src="/accounts/abc/folders/INBOX/messages/5/attachments/2">',
  );
  assert.equal(anzahl, 0);
  assert.match(html, /src="\/accounts\/abc/);
});

pruefe('noch nicht umgeschriebene cid-Verweise', () => {
  assert.equal(entschaerfeExterneInhalte('<img src="cid:teil1@mail">').anzahl, 0);
});

pruefe('mitgelieferte Daten', () => {
  const { html, anzahl } = entschaerfeExterneInhalte('<img src="data:image/png;base64,iVBORw0K">');
  assert.equal(anzahl, 0);
  assert.match(html, /src="data:image/);
});

pruefe('gewoehnliche Verweise im Text bleiben anklickbar', () => {
  // Ein Verweis laedt von sich aus nichts - er folgt erst, wenn man ihn anklickt.
  const { html, anzahl } = entschaerfeExterneInhalte('<a href="https://beispiel.de">hin</a>');
  assert.equal(anzahl, 0);
  assert.match(html, /href="https:\/\/beispiel\.de"/);
});

pruefe('Sprungmarken innerhalb der Nachricht', () => {
  assert.equal(entschaerfeExterneInhalte('<a href="#unten">runter</a>').anzahl, 0);
});

pruefe('der Text der Nachricht bleibt unveraendert', () => {
  const { html } = entschaerfeExterneInhalte(
    '<p>Sehr geehrte Damen und Herren,</p><img src="https://w.de/p.gif"><p>mit freundlichen Gr&uuml;&szlig;en</p>',
  );
  assert.match(html, /Sehr geehrte Damen und Herren/);
  assert.match(html, /mit freundlichen Grüßen/);
});

pruefe('eine Nachricht ohne entfernte Inhalte bleibt unangetastet', () => {
  const { anzahl } = entschaerfeExterneInhalte('<p>Nur Text.</p>');
  assert.equal(anzahl, 0);
});

console.log('\nZaehlpixel erkennen:');

pruefe('ein Bild von einem Pixel gilt als Zaehlpixel', () => {
  assert.equal(enthaeltZaehlpixel('<img src="https://w.de/t.gif" width="1" height="1">'), true);
});

pruefe('ein richtiges Bild nicht', () => {
  assert.equal(enthaeltZaehlpixel('<img src="https://w.de/foto.jpg" width="600" height="400">'), false);
});

pruefe('ein eingebettetes Ein-Pixel-Bild auch nicht', () => {
  // Es meldet nichts nach draussen, also ist es kein Zaehlpixel.
  assert.equal(enthaeltZaehlpixel('<img src="data:image/gif;base64,R0lGOD" width="1" height="1">'), false);
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
