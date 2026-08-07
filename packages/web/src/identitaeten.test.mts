import assert from 'node:assert/strict';
import { absenderFuerAntwort, alleAbsender, pruefeIdentitaet } from './identitaeten.js';

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

const KONTO = {
  email: 'hendrik@privat.de',
  displayName: 'Hendrik Zeuch',
  signature: '<p>Viele Grüße</p>',
  identitaeten: [
    { id: 'i1', email: 'info@meine-firma.de', displayName: 'Meine Firma', signature: '<p>MfG</p>' },
    { id: 'i2', email: 'zweit@privat.de' },
  ],
};

const an = (...adressen: string[]) => adressen.map((address) => ({ address }));

console.log('\nDie Auswahlliste:');

pruefe('das Konto steht an erster Stelle', () => {
  const alle = alleAbsender(KONTO);
  assert.equal(alle.length, 3);
  assert.equal(alle[0]?.email, 'hendrik@privat.de');
  assert.equal(alle[0]?.id, null);
});

pruefe('eine Identitaet ohne eigenen Namen erbt den des Kontos', () => {
  const zweit = alleAbsender(KONTO).find((a) => a.email === 'zweit@privat.de');
  assert.equal(zweit?.displayName, 'Hendrik Zeuch');
  assert.equal(zweit?.signature, '<p>Viele Grüße</p>');
});

pruefe('eine mit eigenem Namen behaelt ihren', () => {
  const firma = alleAbsender(KONTO).find((a) => a.email === 'info@meine-firma.de');
  assert.equal(firma?.displayName, 'Meine Firma');
  assert.equal(firma?.signature, '<p>MfG</p>');
});

pruefe('ein Konto ganz ohne Identitaeten hat genau einen Absender', () => {
  assert.equal(alleAbsender({ email: 'x@y.de' }).length, 1);
});

console.log('\nWelche Adresse beim Antworten:');

pruefe('die, an die geschrieben wurde', () => {
  // Der Alltagsfall: Post an "info@" wird unter "info@" beantwortet, nicht privat.
  const a = absenderFuerAntwort(KONTO, { to: an('info@meine-firma.de') });
  assert.equal(a.email, 'info@meine-firma.de');
  assert.equal(a.displayName, 'Meine Firma');
});

pruefe('Gross- und Kleinschreibung spielt keine Rolle', () => {
  assert.equal(absenderFuerAntwort(KONTO, { to: an('INFO@Meine-Firma.DE') }).email, 'info@meine-firma.de');
});

pruefe('das direkte Feld schlaegt die Kopie', () => {
  const a = absenderFuerAntwort(KONTO, {
    to: an('zweit@privat.de'),
    cc: an('info@meine-firma.de'),
  });
  assert.equal(a.email, 'zweit@privat.de');
});

pruefe('in Kopie zaehlt, wenn im direkten Feld nichts Eigenes steht', () => {
  const a = absenderFuerAntwort(KONTO, {
    to: an('jemand@fremd.de'),
    cc: an('info@meine-firma.de'),
  });
  assert.equal(a.email, 'info@meine-firma.de');
});

pruefe('der Zustellvermerk hilft bei Weiterleitungen', () => {
  // Bei einer Weiterleitung steht die eigene Adresse in keinem sichtbaren Feld.
  const a = absenderFuerAntwort(KONTO, {
    to: an('verteiler@fremd.de'),
    zugestelltAn: ['info@meine-firma.de'],
  });
  assert.equal(a.email, 'info@meine-firma.de');
});

pruefe('steht keine eigene Adresse drin, bleibt es beim Konto', () => {
  const a = absenderFuerAntwort(KONTO, { to: an('verteiler@fremd.de') });
  assert.equal(a.email, 'hendrik@privat.de');
  assert.equal(a.id, null);
});

pruefe('eine Nachricht ganz ohne Empfaenger faellt aufs Konto zurueck', () => {
  assert.equal(absenderFuerAntwort(KONTO, {}).email, 'hendrik@privat.de');
});

console.log('\nEine Adresse eintragen:');

pruefe('eine gueltige geht durch', () => {
  assert.equal(pruefeIdentitaet(KONTO, 'neu@firma.de'), null);
});

pruefe('leer nicht', () => {
  assert.ok(pruefeIdentitaet(KONTO, '   '));
});

pruefe('etwas ohne Klammeraffen nicht', () => {
  assert.ok(pruefeIdentitaet(KONTO, 'keine-adresse'));
  assert.ok(pruefeIdentitaet(KONTO, 'fehlt@punkt'));
});

pruefe('die Adresse des Kontos nicht', () => {
  assert.match(pruefeIdentitaet(KONTO, 'Hendrik@Privat.de') ?? '', /Konto/);
});

pruefe('eine schon eingetragene nicht', () => {
  // Zwei gleiche waeren in der Auswahlliste nicht auseinanderzuhalten.
  assert.match(pruefeIdentitaet(KONTO, 'info@meine-firma.de') ?? '', /schon/);
});

pruefe('beim Bearbeiten stoert die eigene Adresse nicht', () => {
  assert.equal(pruefeIdentitaet(KONTO, 'info@meine-firma.de', 'i1'), null);
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
