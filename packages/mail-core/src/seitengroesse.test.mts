import assert from 'node:assert/strict';
import test from 'node:test';
import { brauchbareAnzahl } from './seitengroesse.js';

/**
 * Der Fehler, den diese Prüfung festhält.
 *
 * `Number('abc')` ist NaN, NaN wirft nicht, und `slice(-NaN)` ist `slice(0)` - also
 * ALLES. Aus einer Begrenzung wurde damit ihr Gegenteil, und zwar lautlos. Die Prüfung
 * unten führt beide Seiten vor: was die Zahl bewirken soll, und was `slice` ohne sie
 * getan hätte.
 */

test('eine brauchbare Anzahl bleibt, wie sie ist', () => {
  assert.equal(brauchbareAnzahl(25, 200), 25);
  assert.equal(brauchbareAnzahl(1, 200), 1);
  assert.equal(brauchbareAnzahl(100_000, 200), 100_000);
});

test('ohne Angabe gilt die Voreinstellung', () => {
  assert.equal(brauchbareAnzahl(undefined, 200), 200);
});

test('was keine Anzahl ist, ergibt die Voreinstellung und nicht "unbegrenzt"', () => {
  // Genau die Werte, die vorher durchrutschten - Number('abc'), Number(''), pageSize=0.
  assert.equal(brauchbareAnzahl(Number.NaN, 200), 200);
  assert.equal(brauchbareAnzahl(0, 200), 200);
  assert.equal(brauchbareAnzahl(-0, 200), 200);
  assert.equal(brauchbareAnzahl(-5, 200), 200);
  assert.equal(brauchbareAnzahl(Number.POSITIVE_INFINITY, 200), 200);
  assert.equal(brauchbareAnzahl(Number.NEGATIVE_INFINITY, 200), 200);
});

test('Nachkommastellen werden abgeschnitten statt an slice weitergereicht', () => {
  assert.equal(brauchbareAnzahl(25.9, 200), 25);
});

test('und das ist der Grund: was slice ohne die Prüfung getan hätte', () => {
  const alle = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  // So war es gemeint.
  assert.deepEqual(alle.slice(-3), [8, 9, 10]);

  // So verhielt es sich mit den Werten, die aus einer Adresszeile kommen konnten -
  // dreimal der GESAMTE Bestand statt einer Seite.
  assert.deepEqual(alle.slice(-Number.NaN), alle);
  assert.deepEqual(alle.slice(-0), alle);
  assert.deepEqual(alle.slice(-Number('abc')), alle);

  // Und mit einer negativen Anzahl wurde daraus etwas ganz anderes: kein Ausschnitt vom
  // Ende, sondern ein Sprung nach vorn.
  const negativ = -5;
  assert.deepEqual(alle.slice(-negativ), [6, 7, 8, 9, 10]);

  // Mit der Prüfung ist jeder dieser Fälle die Voreinstellung.
  for (const roh of [Number.NaN, 0, -0, Number('abc'), -5]) {
    assert.deepEqual(alle.slice(-brauchbareAnzahl(roh, 3)), [8, 9, 10]);
  }
});

test('die zweite Hälfte des Fehlers: dieselbe Zahl leerte das Ergebnis', () => {
  const treffer = [1, 2, 3, 4, 5];
  // In searchFolders stand `treffer.slice(0, limit)` - mit NaN kam nichts heraus.
  // Zusammen mit slice(-NaN) weiter oben hiess das: alles holen, nichts zurueckgeben.
  assert.deepEqual(treffer.slice(0, Number.NaN), []);
  assert.deepEqual(treffer.slice(0, brauchbareAnzahl(Number.NaN, 3)), [1, 2, 3]);
});
