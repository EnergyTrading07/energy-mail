import assert from 'node:assert/strict';
import { pruefeAnhaenge } from './anhangErinnerung.js';

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

const fragt = (text: string, anhaenge = 0, betreff = 'Betreff') =>
  pruefeAnhaenge(betreff, text, anhaenge).nachfragen;

console.log('\nAngekuendigt, aber nichts angehaengt:');

pruefe('"anbei"', () => {
  assert.equal(fragt('Hallo,\n\nanbei die Rechnung.\n\nGruß'), true);
});

pruefe('"im Anhang"', () => {
  assert.equal(fragt('Die Unterlagen finden Sie im Anhang.'), true);
});

pruefe('"beigefügt", auch ohne Umlaut geschrieben', () => {
  assert.equal(fragt('Beigefügt der Vertrag.'), true);
  assert.equal(fragt('Beigefuegt der Vertrag.'), true);
});

pruefe('"als Anlage"', () => {
  assert.equal(fragt('Das Angebot als Anlage.'), true);
});

pruefe('englische Wendungen', () => {
  assert.equal(fragt('Please see the attached file.'), true);
  assert.equal(fragt('Find the attachment below.'), true);
  assert.equal(fragt('Please find enclosed our offer.'), true);
});

pruefe('auch wenn es nur im Betreff steht', () => {
  assert.equal(pruefeAnhaenge('Rechnung anbei', 'Guten Tag', 0).nachfragen, true);
});

pruefe('die Fundstelle wird mitgeteilt', () => {
  const e = pruefeAnhaenge('Betreff', 'Anbei die Zahlen.', 0);
  assert.equal(e.nachfragen, true);
  assert.match(e.fundstelle ?? '', /nbei/);
});

console.log('\nWann nicht gefragt werden darf:');

pruefe('wenn tatsaechlich etwas anhaengt', () => {
  assert.equal(fragt('Anbei die Rechnung.', 1), false);
});

pruefe('bei einer Nachricht ohne jede Ankuendigung', () => {
  assert.equal(fragt('Vielen Dank für das Gespräch. Bis nächste Woche.'), false);
});

pruefe('"Anhang" ohne Praeposition meint meist etwas anderes', () => {
  // "Anhang B des Vertrags" kuendigt keine Datei an.
  assert.equal(fragt('Die Regelung steht in Anhang B des Vertrags.'), false);
});

pruefe('nicht im zitierten Text einer Antwort', () => {
  // Die Ankuendigung stammt vom anderen, nicht von mir.
  const antwort = 'Danke, habe ich bekommen.\n\n> Hallo,\n> anbei die Rechnung.\n> Gruß';
  assert.equal(fragt(antwort), false);
});

pruefe('nicht unterhalb von "Am ... schrieb ..."', () => {
  const antwort = 'Passt so.\n\nAm 01.08.2026 schrieb Anna:\nAnbei die Unterlagen.';
  assert.equal(fragt(antwort), false);
});

pruefe('nicht unterhalb von "On ... wrote:"', () => {
  assert.equal(fragt('Thanks.\n\nOn Mon, Aug 3, Anna wrote:\nPlease find attached.'), false);
});

pruefe('nicht im weitergeleiteten Teil', () => {
  assert.equal(fragt('Zur Kenntnis.\n\n-------- Weitergeleitete Nachricht --------\nAnbei die Datei.'), false);
});

pruefe('nicht in der Signatur', () => {
  assert.equal(fragt('Kurze Rueckmeldung.\n\n--\nAnna Mueller\nAnbei GmbH'), false);
});

pruefe('aber sehr wohl oberhalb des Zitats', () => {
  const antwort = 'Anbei wie besprochen.\n\n> Koenntest du mir das schicken?';
  assert.equal(fragt(antwort), true);
});

pruefe('eine leere Nachricht fragt nichts', () => {
  assert.equal(pruefeAnhaenge('', '', 0).nachfragen, false);
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
