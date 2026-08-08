import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  WERKZEUGE,
  befehlFuerTaste,
  istUnbedenklicheAdresse,
  normalisiereAdresse,
  raeumeEingefuegtesAuf,
} from './formatierung.js';

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

/** Raeumt einen HTML-Schnipsel auf und gibt zurueck, was uebrig bleibt. */
function aufgeraeumt(html: string): string {
  const dom = new JSDOM(`<div id="w">${html}</div>`);
  const wurzel = dom.window.document.getElementById('w')!;
  raeumeEingefuegtesAuf(wurzel, dom.window.document);
  return wurzel.innerHTML;
}

console.log('\nDie Leiste:');

pruefe('jeder Knopf hat Befehl, Titel und Aufschrift', () => {
  for (const gruppe of WERKZEUGE) {
    for (const w of gruppe) {
      assert.ok(w.befehl, 'ohne Befehl');
      assert.ok(w.titel, `${w.befehl}: ohne Titel`);
      assert.ok(w.aufschrift, `${w.befehl}: ohne Aufschrift`);
    }
  }
});

pruefe('kein Befehl steht zweimal in derselben Gruppe', () => {
  for (const gruppe of WERKZEUGE) {
    const schluessel = gruppe.map((w) => `${w.befehl}:${w.wert ?? ''}`);
    assert.equal(new Set(schluessel).size, schluessel.length);
  }
});

pruefe('jeder Titel nennt sein Tastenkuerzel, wenn es eines gibt', () => {
  const mitKuerzel = WERKZEUGE.flat().filter((w) => /Strg\+/.test(w.titel));
  assert.ok(mitKuerzel.length >= 4, `nur ${mitKuerzel.length}`);
});

console.log('\nTastenkuerzel:');

const taste = (key: string, zusatz: Partial<{ ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key,
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  ...zusatz,
});

pruefe('Strg+Umschalt+7 und +8 machen Listen', () => {
  // So halten es Word, LibreOffice und Google Docs.
  assert.deepEqual(befehlFuerTaste(taste('7', { shiftKey: true })), {
    befehl: 'insertOrderedList',
  });
  assert.deepEqual(befehlFuerTaste(taste('8', { shiftKey: true })), {
    befehl: 'insertUnorderedList',
  });
});

pruefe('Strg+Umschalt+X streicht durch', () => {
  assert.deepEqual(befehlFuerTaste(taste('x', { shiftKey: true })), { befehl: 'strikeThrough' });
});

pruefe('ohne Strg passiert nichts', () => {
  // Sonst liesse sich keine "7" mehr tippen.
  assert.equal(befehlFuerTaste({ key: '7', ctrlKey: false, metaKey: false, shiftKey: true }), null);
  assert.equal(befehlFuerTaste({ key: '7', ctrlKey: false, metaKey: false, shiftKey: false }), null);
});

pruefe('fett, kursiv und unterstrichen bleiben dem Browser ueberlassen', () => {
  // Er kann sie selbst; sie hier zu belegen brauechte nur eine zweite Stelle, an der
  // dasselbe steht.
  assert.equal(befehlFuerTaste(taste('b')), null);
  assert.equal(befehlFuerTaste(taste('i')), null);
  assert.equal(befehlFuerTaste(taste('u')), null);
});

pruefe('Strg+Z bleibt ebenfalls beim Browser, Strg+Y nicht', () => {
  assert.equal(befehlFuerTaste(taste('z')), null);
  assert.deepEqual(befehlFuerTaste(taste('y')), { befehl: 'redo' });
});

console.log('\nEinfuegen aus anderen Programmen:');

pruefe('Auszeichnung bleibt erhalten', () => {
  // Vorher wurde alles zu nacktem Text - ein Absatz aus einem Schreibprogramm verlor
  // Fettdruck, Listen und Verweise.
  assert.equal(aufgeraeumt('<b>fett</b> und <i>kursiv</i>'), '<b>fett</b> und <i>kursiv</i>');
  assert.equal(aufgeraeumt('<ul><li>eins</li><li>zwei</li></ul>'), '<ul><li>eins</li><li>zwei</li></ul>');
});

pruefe('Gestaltung faellt weg', () => {
  // Fremde Schriftarten, Farben und Groessen sehen in einer Mail aus wie ein Unfall.
  const raus = aufgeraeumt('<p style="font-family:Comic Sans;color:#f0f" class="x">Text</p>');
  assert.equal(raus, '<p>Text</p>');
});

pruefe('unbekannte Elemente werden aufgeloest, nicht weggeworfen', () => {
  // Ein <table> ganz zu entfernen kostete den Inhalt.
  assert.equal(aufgeraeumt('<table><tr><td>Zahl</td></tr></table>'), 'Zahl');
  assert.equal(aufgeraeumt('<font size="7">Gross</font>'), 'Gross');
});

pruefe('Skripte verschwinden samt ihrem Inhalt', () => {
  // Nicht nur die Klammern: sonst stuende "alert(1)" als sichtbarer Text im Brief.
  const raus = aufgeraeumt('<p>Hallo</p><script>alert(1)</script>');
  assert.ok(!raus.includes('<script'), raus);
  assert.ok(!raus.includes('alert'), raus);
  assert.ok(raus.includes('Hallo'), 'der uebrige Text ging mit verloren');
});

pruefe('Gestaltungsangaben ebenso', () => {
  const raus = aufgeraeumt('<style>p{color:red}</style><p>Text</p>');
  assert.ok(!raus.includes('color:red'), raus);
  assert.ok(raus.includes('Text'));
});

pruefe('ein Verweis bleibt, sein Ziel wird geprueft', () => {
  const raus = aufgeraeumt('<a href="https://beispiel.de">hin</a>');
  assert.ok(raus.includes('href="https://beispiel.de"'));
  // Nach draussen und im neuen Fenster - sonst ersetzte er das Verfassen-Fenster
  // samt Entwurf.
  assert.ok(raus.includes('target="_blank"'));
  assert.ok(raus.includes('rel="noopener noreferrer"'));
});

pruefe('ein Verweis, der etwas ausfuehren wuerde, verliert sein Ziel', () => {
  const raus = aufgeraeumt('<a href="javascript:alert(1)">klick</a>');
  assert.ok(!raus.includes('javascript'), raus);
  assert.ok(raus.includes('klick'), 'der Text ging mit verloren');
});

pruefe('verschleierte Adressen ebenso', () => {
  assert.equal(istUnbedenklicheAdresse('java script:alert(1)'), false);
  assert.equal(istUnbedenklicheAdresse('JaVaScRiPt:alert(1)'), false);
  assert.equal(istUnbedenklicheAdresse('data:text/html,<script>'), false);
  assert.equal(istUnbedenklicheAdresse('vbscript:msgbox'), false);
  assert.equal(istUnbedenklicheAdresse('file:///C:/Windows'), false);
});

pruefe('gewoehnliche Adressen sind unbedenklich', () => {
  assert.equal(istUnbedenklicheAdresse('https://beispiel.de'), true);
  assert.equal(istUnbedenklicheAdresse('http://beispiel.de'), true);
  assert.equal(istUnbedenklicheAdresse('mailto:anna@b.de'), true);
  assert.equal(istUnbedenklicheAdresse('/seite'), true);
  assert.equal(istUnbedenklicheAdresse('#anker'), true);
});

pruefe('Ereignismerkmale kommen nicht durch', () => {
  const raus = aufgeraeumt('<p onclick="alert(1)" onmouseover="x()">Text</p>');
  assert.ok(!raus.includes('onclick'), raus);
  assert.ok(!raus.includes('onmouseover'), raus);
});

pruefe('ein eingebettetes Bild von aussen kommt nicht durch', () => {
  // Es waere ein Zaehlpixel im eigenen Entwurf - und ginge beim Senden mit hinaus.
  const raus = aufgeraeumt('<p>Text<img src="https://fremd.de/zaehl.gif"></p>');
  assert.ok(!raus.includes('<img'), raus);
  assert.ok(raus.includes('Text'));
});

pruefe('verschachteltes Durcheinander wird sauber', () => {
  const raus = aufgeraeumt(
    '<div class="a"><table><tbody><tr><td><span style="color:red"><b>wichtig</b></span></td></tr></tbody></table></div>',
  );
  assert.ok(raus.includes('<b>wichtig</b>'), raus);
  assert.ok(!raus.includes('table'), raus);
  assert.ok(!raus.includes('style'), raus);
});

console.log('\nAdressen ergaenzen:');

pruefe('ohne Vorsatz wird https ergaenzt', () => {
  assert.equal(normalisiereAdresse('firma.de'), 'https://firma.de');
  assert.equal(normalisiereAdresse('www.firma.de/seite'), 'https://www.firma.de/seite');
});

pruefe('was schon einen Vorsatz hat, bleibt', () => {
  assert.equal(normalisiereAdresse('https://firma.de'), 'https://firma.de');
  assert.equal(normalisiereAdresse('http://firma.de'), 'http://firma.de');
  assert.equal(normalisiereAdresse('mailto:a@b.de'), 'mailto:a@b.de');
});

pruefe('eine Mailadresse wird zu mailto:', () => {
  assert.equal(normalisiereAdresse('anna@firma.de'), 'mailto:anna@firma.de');
});

pruefe('Leerraum stoert nicht, Leeres bleibt leer', () => {
  assert.equal(normalisiereAdresse('  firma.de  '), 'https://firma.de');
  assert.equal(normalisiereAdresse(''), '');
  assert.equal(normalisiereAdresse('   '), '');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
