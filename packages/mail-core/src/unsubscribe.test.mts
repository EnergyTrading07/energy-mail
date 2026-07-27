import assert from 'node:assert/strict';
import { bestimmeAbmeldung, leseAbmeldeWege } from './unsubscribe.js';

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

console.log('\nAbmeldezeile lesen:');

pruefe('nur eine Web-Adresse', () => {
  const w = leseAbmeldeWege('<https://example.de/abmelden?id=7>');
  assert.equal(w.http, 'https://example.de/abmelden?id=7');
  assert.equal(w.mailto, undefined);
});

pruefe('nur eine Mailadresse', () => {
  const w = leseAbmeldeWege('<mailto:unsubscribe@example.de>');
  assert.equal(w.mailto?.adresse, 'unsubscribe@example.de');
  assert.equal(w.http, undefined);
});

pruefe('beide Wege, Reihenfolge egal', () => {
  const a = leseAbmeldeWege('<mailto:x@y.de>, <https://y.de/ab>');
  assert.equal(a.mailto?.adresse, 'x@y.de');
  assert.equal(a.http, 'https://y.de/ab');

  const b = leseAbmeldeWege('<https://y.de/ab>, <mailto:x@y.de>');
  assert.equal(b.mailto?.adresse, 'x@y.de');
  assert.equal(b.http, 'https://y.de/ab');
});

pruefe('Betreff und Text aus der Mailadresse', () => {
  // Manche Verteiler werten nur eine Mail mit genau diesem Betreff als Abmeldung.
  const w = leseAbmeldeWege('<mailto:leave@x.de?subject=unsubscribe%20me&body=bitte>');
  assert.equal(w.mailto?.adresse, 'leave@x.de');
  assert.equal(w.mailto?.betreff, 'unsubscribe me');
  assert.equal(w.mailto?.text, 'bitte');
});

pruefe('eine echte Zeile aus dem Postfach', () => {
  const w = leseAbmeldeWege(
    '<mailto:unsubscribe@post.pinterest.com?subject=unsubscribe%3A123>, <https://pinterest.com/ab>',
  );
  assert.equal(w.mailto?.adresse, 'unsubscribe@post.pinterest.com');
  assert.equal(w.mailto?.betreff, 'unsubscribe:123');
  assert.equal(w.http, 'https://pinterest.com/ab');
});

pruefe('unbrauchbare Zeile ergibt keinen Weg', () => {
  const w = leseAbmeldeWege('abmelden Sie sich auf unserer Webseite');
  assert.equal(w.http, undefined);
  assert.equal(w.mailto, undefined);
});

console.log('\nWeg auswählen:');

pruefe('Ein-Klick hat Vorrang', () => {
  const w = leseAbmeldeWege('<mailto:x@y.de>, <https://y.de/ab>', true);
  assert.deepEqual(bestimmeAbmeldung(w), { art: 'ein-klick', ziel: 'https://y.de/ab' });
});

pruefe('ohne Ein-Klick-Zusage wird die Mail bevorzugt', () => {
  // Sie wirkt ohne weiteres Zutun; die Webseite verlangt eine Bestätigung.
  const w = leseAbmeldeWege('<mailto:x@y.de>, <https://y.de/ab>', false);
  assert.deepEqual(bestimmeAbmeldung(w), { art: 'mail', adresse: 'x@y.de', betreff: undefined, text: undefined });
});

pruefe('nur eine Webadresse ohne Zusage geht in den Browser', () => {
  const w = leseAbmeldeWege('<https://y.de/ab>', false);
  assert.deepEqual(bestimmeAbmeldung(w), { art: 'im-browser', ziel: 'https://y.de/ab' });
});

pruefe('Ein-Klick-Zusage ohne Webadresse faellt auf die Mail zurueck', () => {
  const w = leseAbmeldeWege('<mailto:x@y.de>', true);
  assert.equal(bestimmeAbmeldung(w)?.art, 'mail');
});

pruefe('ohne jeden Weg wird nichts erfunden', () => {
  assert.equal(bestimmeAbmeldung(leseAbmeldeWege('Unsinn')), null);
});

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
