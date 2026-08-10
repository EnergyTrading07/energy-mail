import assert from 'node:assert/strict';
import { farbton, kuerzel, monogramm } from './monogramm.js';

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

console.log('\nDas Kuerzel eines Absenders:');

pruefe('zwei Woerter ergeben zwei Buchstaben', () => {
  assert.equal(kuerzel('Anna Bauer', 'anna@example.org'), 'AB');
});

pruefe('drei Woerter nehmen das erste und das letzte', () => {
  // Nicht die ersten beiden: bei "Anna von Bauer" waere "AV" nichtssagend.
  assert.equal(kuerzel('Anna von Bauer', 'anna@example.org'), 'AB');
});

pruefe('ein Wort ergibt einen Buchstaben', () => {
  assert.equal(kuerzel('Newsletter', 'news@example.org'), 'N');
});

pruefe('ohne Namen wird die Adresse zerlegt', () => {
  assert.equal(kuerzel(undefined, 'anna.bauer@example.org'), 'AB');
  assert.equal(kuerzel('', 'postfach42@example.org'), 'P');
});

pruefe('Anfuehrungszeichen aus fremden Kopfzeilen zaehlen nicht', () => {
  // "Bauer, Anna" <...> kommt so aus Outlook-Verteilern.
  assert.equal(kuerzel('"Bauer, Anna"', 'a@example.org'), 'BA');
});

pruefe('Umlaute und Akzente sind Buchstaben und bleiben stehen', () => {
  // Nicht zu "OA" entschaerfen: der Kreis zeigt den Anfangsbuchstaben des Namens, und
  // der ist bei Örk nun einmal ein Ö.
  assert.equal(kuerzel('Örk Ångström', 'o@example.org'), 'ÖÅ');
});

pruefe('Ziffern am Wortanfang werden uebersprungen', () => {
  // "1. Vorsitzender Meier" soll nicht zu "1M" werden.
  assert.equal(kuerzel('1. Vorsitzender Meier', 'v@example.org'), 'VM');
});

pruefe('bleibt nichts uebrig, steht das Klammeraffenzeichen da', () => {
  assert.equal(kuerzel(undefined, undefined), '@');
  assert.equal(kuerzel('...', '###'), '@');
});

pruefe('hoechstens zwei Buchstaben', () => {
  // Sonst passt es nicht in den Kreis von 26 Pixeln.
  assert.ok(kuerzel('Anna Maria Sophie Bauer', 'a@example.org').length <= 2);
});

console.log('\nDer Farbton:');

pruefe('dieselbe Adresse ergibt immer denselben Ton', () => {
  // Das ist der ganze Zweck: wer die Farbe wiedererkennen soll, muss sie wiedersehen.
  assert.equal(farbton('anna@example.org'), farbton('anna@example.org'));
});

pruefe('Gross- und Kleinschreibung machen keinen Unterschied', () => {
  assert.equal(farbton('Anna@Example.ORG'), farbton('anna@example.org'));
});

pruefe('der angezeigte Name aendert den Ton nicht', () => {
  // Wer seinen Namen umstellt, behaelt seine Farbe.
  assert.equal(farbton('anna@example.org', 'Anna Bauer'), farbton('anna@example.org', 'A. Bauer'));
});

pruefe('aehnliche Adressen landen nicht nebeneinander', () => {
  // Bei einer Quersumme waeren "anna@" und "anne@" praktisch dieselbe Farbe.
  assert.notEqual(farbton('anna@example.org'), farbton('anne@example.org'));
});

pruefe('der Ton liegt auf dem Farbkreis', () => {
  for (const adresse of ['a@x.de', 'b@y.de', 'lange.adresse+kennung@sub.beispiel.example']) {
    const t = farbton(adresse);
    assert.ok(t >= 0 && t < 360, `${adresse} ergab ${t}`);
  }
});

pruefe('die Toene verteilen sich ueber den ganzen Kreis', () => {
  // Bei schlechter Streuung saessen alle Absender in einem Viertel und die Liste
  // saehe einfarbig aus.
  const gesehen = new Set<number>();
  for (let i = 0; i < 400; i++) gesehen.add(farbton(`nutzer${i}@example.org`));
  assert.ok(gesehen.size >= 12, `nur ${gesehen.size} verschiedene Toene`);
});

pruefe('kein Ton liegt im reinen Rot', () => {
  // Rot heisst in dieser Anwendung ueberall "Fehler" - ein Absender darf so nicht aussehen.
  for (let i = 0; i < 400; i++) {
    const t = farbton(`nutzer${i}@example.org`);
    assert.ok(t < 350 && t > 8, `Ton ${t} liegt im Rot`);
  }
});

pruefe('monogramm liefert beides zusammen', () => {
  assert.deepEqual(monogramm('Anna Bauer', 'anna@example.org'), {
    kuerzel: 'AB',
    farbton: farbton('anna@example.org'),
  });
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
