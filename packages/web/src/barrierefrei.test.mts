import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ansteuerbare,
  ersterFokus,
  kaestchenBeschriftung,
  naechstesZiel,
  ordnerBeschriftung,
  zeilenBeschriftung,
} from './barrierefrei.js';

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

console.log('\nWas vorgelesen wird:');

pruefe('eine ungelesene Zeile sagt das als Erstes', () => {
  // Auf dem Bildschirm ist es Fettdruck - den hoert niemand.
  const satz = zeilenBeschriftung({
    absender: 'Anna Bauer',
    betreff: 'Angebot',
    datum: '3. Mai',
    gelesen: false,
  });
  assert.ok(satz.startsWith('Ungelesen,'), satz);
});

pruefe('eine gelesene Zeile faengt beim Absender an', () => {
  const satz = zeilenBeschriftung({
    absender: 'Anna Bauer',
    betreff: 'Angebot',
    datum: '3. Mai',
    gelesen: true,
  });
  assert.equal(satz, 'Anna Bauer, Angebot, 3. Mai');
});

pruefe('der Anhang wird genannt', () => {
  // Auf dem Bildschirm eine Bueroklammer.
  const satz = zeilenBeschriftung({
    absender: 'Anna',
    betreff: 'Rechnung',
    datum: 'gestern',
    gelesen: true,
    mitAnhang: true,
  });
  assert.ok(satz.includes('mit Anhang'), satz);
});

pruefe('ein Gespraech nennt seine Anzahl, eine einzelne Nachricht nicht', () => {
  const viele = zeilenBeschriftung({
    absender: 'Anna',
    betreff: 'Angebot',
    datum: 'heute',
    gelesen: true,
    imGespraech: 4,
  });
  assert.ok(viele.includes('Gespräch mit 4 Nachrichten'), viele);

  const eine = zeilenBeschriftung({
    absender: 'Anna',
    betreff: 'Angebot',
    datum: 'heute',
    gelesen: true,
    imGespraech: 1,
  });
  assert.ok(!eine.includes('Gespräch'), eine);
});

pruefe('leere Angaben ergeben keine Luecke im Satz', () => {
  // Sonst hoerte man "Anna Bauer, , 3. Mai" - und wuesste nicht, ob etwas fehlt.
  const satz = zeilenBeschriftung({ absender: '', betreff: '   ', datum: '', gelesen: true });
  assert.equal(satz, 'Unbekannter Absender, Ohne Betreff');
});

pruefe('die Herkunft steht dabei, wenn die Liste gemischt ist', () => {
  const satz = zeilenBeschriftung({
    absender: 'Anna',
    betreff: 'Angebot',
    datum: 'heute',
    gelesen: true,
    herkunft: 'zeuch.hendrik@gmx.de',
  });
  assert.ok(satz.includes('zeuch.hendrik@gmx.de'), satz);
});

pruefe('ein Ordner sagt, wovon die Zahl daneben spricht', () => {
  // Vorher las die Vorlesesoftware eine nackte "3".
  assert.equal(ordnerBeschriftung('Posteingang', 3), 'Posteingang, 3 ungelesen');
});

pruefe('ohne ungelesene Post bleibt es beim Namen', () => {
  assert.equal(ordnerBeschriftung('Papierkorb', 0), 'Papierkorb');
  assert.equal(ordnerBeschriftung('Papierkorb', undefined), 'Papierkorb');
});

pruefe('ein Kaestchen sagt, was es ankreuzt', () => {
  // Siebzehn Kaestchen, die alle "Kontrollkaestchen" heissen, sind siebzehnmal dasselbe.
  assert.equal(kaestchenBeschriftung('Angebot'), 'Angebot auswählen');
  assert.equal(kaestchenBeschriftung('  '), 'Nachricht ohne Betreff auswählen');
});

console.log('\nFokus im Fenster halten:');

/** Baut ein Fenster mit ein paar Bedienelementen. */
function fenster(html: string) {
  const dom = new JSDOM(`<body><button id="aussen">draussen</button><div id="f">${html}</div></body>`);
  // JSDOM misst nichts - ohne Groesse hielte ansteuerbare() alles fuer ausgeblendet.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { get: () => 10 });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', { get: () => 10 });
  const bereich = dom.window.document.getElementById('f')!;
  return { dom, bereich, elemente: ansteuerbare(bereich) };
}

pruefe('gezaehlt wird nur, was im Fenster steht', () => {
  const { elemente } = fenster('<input id="a"><button id="b">ok</button>');
  assert.deepEqual(
    elemente.map((e) => e.id),
    ['a', 'b'],
  );
});

pruefe('Abgeschaltetes und Ausgeblendetes zaehlt nicht mit', () => {
  // Ein Rundlauf ueber einen abgeschalteten Knopf bliebe dort haengen.
  const { elemente } = fenster(
    '<input id="a"><button id="b" disabled>aus</button><input id="c" type="hidden"><div id="d" aria-hidden="true" tabindex="0"></div>',
  );
  assert.deepEqual(
    elemente.map((e) => e.id),
    ['a'],
  );
});

pruefe('vom letzten Element geht es wieder an den Anfang', () => {
  const { elemente } = fenster('<input id="a"><button id="b">ok</button>');
  assert.equal(naechstesZiel(elemente, elemente[1]!, false)?.id, 'a');
});

pruefe('rueckwaerts vom ersten ans Ende', () => {
  const { elemente } = fenster('<input id="a"><button id="b">ok</button>');
  assert.equal(naechstesZiel(elemente, elemente[0]!, true)?.id, 'b');
});

pruefe('mittendrin macht der Browser es selbst', () => {
  // Sonst muesste jeder Tabulatorschritt hier nachgebaut werden - und die Reihenfolge
  // waere ein zweites Mal festgelegt.
  const { elemente } = fenster('<input id="a"><input id="b"><button id="c">ok</button>');
  assert.equal(naechstesZiel(elemente, elemente[1]!, false), null);
  assert.equal(naechstesZiel(elemente, elemente[1]!, true), null);
});

pruefe('steht der Fokus draussen, fuehrt die Taste hinein', () => {
  const { dom, elemente } = fenster('<input id="a"><button id="b">ok</button>');
  const draussen = dom.window.document.getElementById('aussen')!;
  assert.equal(naechstesZiel(elemente, draussen, false)?.id, 'a');
  assert.equal(naechstesZiel(elemente, draussen, true)?.id, 'b');
  assert.equal(naechstesZiel(elemente, null, false)?.id, 'a');
});

pruefe('ein Fenster ohne Bedienelemente blockiert nicht', () => {
  const { elemente } = fenster('<p>nur Text</p>');
  assert.equal(naechstesZiel(elemente, null, false), null);
});

console.log('\nWohin der Fokus beim Oeffnen geht:');

pruefe('auf das erste Eingabefeld', () => {
  const { bereich } = fenster('<button id="x">Schließen</button><input id="a"><input id="b">');
  assert.equal(ersterFokus(bereich).id, 'a');
});

pruefe('ein Kaestchen ist kein Eingabefeld in diesem Sinne', () => {
  // Der Fokus soll dort landen, wo man tippt - nicht auf einem Haken.
  const { bereich } = fenster('<input id="k" type="checkbox"><input id="a" type="text">');
  assert.equal(ersterFokus(bereich).id, 'a');
});

pruefe('gibt es kein Feld, bekommt das Fenster selbst den Fokus', () => {
  // Dann nennt die Vorlesesoftware seinen Namen statt irgendeines Knopfes aus der Mitte.
  const { bereich } = fenster('<button id="x">Abbrechen</button><button id="y">Löschen</button>');
  assert.equal(ersterFokus(bereich).id, 'f');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
