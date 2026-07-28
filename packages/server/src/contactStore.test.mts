import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';

// Vor dem ersten Zugriff umlenken, sonst landen Testadressen im echten Benutzerordner.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-kontakte-test-'));
setDataDir(tempDir);

const {
  contactCount,
  merkeAusListe,
  rememberAddresses,
  searchContacts,
  speichereKontakteSofort,
  verwirfKontaktSpeicher,
} = await import('./contactStore.js');

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void): void {
  // Jede Prüfung fängt bei null an - sonst schleppte sie die Adressen der vorigen mit.
  verwirfKontaktSpeicher();
  fs.rmSync(path.join(tempDir, 'contacts.json'), { force: true });
  try {
    fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

/** Baut eine Nachricht, wie sie aus der Ordnerliste kommt. */
const mail = (uid: number, absender: string, datum = '2026-07-01T10:00:00.000Z') => ({
  uid,
  date: new Date(datum),
  from: [{ address: absender }],
  to: [],
  cc: [],
});

/** Legt eine Ablage in der alten Fassung an - einer blanken Liste. */
function alteAblage(eintraege: { address: string; name?: string; count: number }[]): void {
  fs.writeFileSync(
    path.join(tempDir, 'contacts.json'),
    JSON.stringify(eintraege.map((e) => ({ ...e, lastSeen: '2026-01-01T00:00:00.000Z' }))),
    'utf-8',
  );
}

console.log('\nAdressen merken:');

pruefe('zählt eine Adresse und schlägt sie vor', () => {
  rememberAddresses([{ address: 'Anna@Beispiel.de', name: 'Anna' }]);
  const treffer = searchContacts('anna');
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.name, 'Anna');
});

pruefe('überschreibt einen bereits bekannten Namen nicht', () => {
  // Der erste Name ist meist der bessere - später kommt oft nur die Adresse selbst.
  rememberAddresses([{ address: 'a@b.de', name: 'Anna Müller' }]);
  rememberAddresses([{ address: 'a@b.de', name: 'a@b.de' }]);
  assert.equal(searchContacts('a@b')[0]?.name, 'Anna Müller');
});

pruefe('übergeht, was keine Adresse ist', () => {
  rememberAddresses([{ address: '' }, { address: 'ohne-klammeraffe' }, { address: '  ' }]);
  assert.equal(contactCount(), 0);
});

pruefe('stellt Häufigeres nach vorn', () => {
  rememberAddresses([{ address: 'selten@b.de' }]);
  for (let i = 0; i < 5; i++) rememberAddresses([{ address: 'oft@b.de' }]);
  assert.equal(searchContacts('b.de')[0]?.address, 'oft@b.de');
});

pruefe('stellt Treffer am Anfang der Adresse vor solche in der Mitte', () => {
  // Der hintere ist häufiger - der Anfangstreffer soll trotzdem gewinnen.
  for (let i = 0; i < 9; i++) rememberAddresses([{ address: 'x@mueller.de' }]);
  rememberAddresses([{ address: 'mueller@x.de' }]);
  assert.equal(searchContacts('mueller')[0]?.address, 'mueller@x.de');
});

console.log('\nAus der Ordnerliste einsammeln:');

pruefe('zählt dieselbe Seite nicht zweimal', () => {
  const seite = [mail(100, 'chef@firma.de'), mail(99, 'chef@firma.de')];
  merkeAusListe('konto1', 'INBOX', seite);
  assert.equal(searchContacts('chef')[0]?.count, 2);

  // Die Liste erneuert sich - dieselben Nachrichten kommen noch einmal herein.
  merkeAusListe('konto1', 'INBOX', seite);
  merkeAusListe('konto1', 'INBOX', seite);
  assert.equal(searchContacts('chef')[0]?.count, 2, 'die Auffrischung hat mitgezählt');
});

pruefe('zählt neu eingegangene Post über dem bekannten Bereich', () => {
  merkeAusListe('konto1', 'INBOX', [mail(100, 'chef@firma.de')]);
  merkeAusListe('konto1', 'INBOX', [mail(101, 'chef@firma.de'), mail(100, 'chef@firma.de')]);
  assert.equal(searchContacts('chef')[0]?.count, 2);
});

pruefe('zählt ältere nachgeladene Seiten unter dem bekannten Bereich', () => {
  merkeAusListe('konto1', 'INBOX', [mail(100, 'chef@firma.de')]);
  merkeAusListe('konto1', 'INBOX', [mail(99, 'chef@firma.de')]);
  assert.equal(searchContacts('chef')[0]?.count, 2);
});

pruefe('hält Ordner und Konten auseinander', () => {
  // Gleiche UID in einem anderen Ordner ist eine andere Nachricht.
  merkeAusListe('konto1', 'INBOX', [mail(7, 'chef@firma.de')]);
  merkeAusListe('konto1', 'Gesendet', [mail(7, 'chef@firma.de')]);
  merkeAusListe('konto2', 'INBOX', [mail(7, 'chef@firma.de')]);
  assert.equal(searchContacts('chef')[0]?.count, 3);
});

pruefe('kommt mit einer leeren Seite zurecht', () => {
  merkeAusListe('konto1', 'INBOX', []);
  assert.equal(contactCount(), 0);
});

console.log('\nGrenzen des Speichers:');

pruefe('wächst nicht über die Obergrenze hinaus', () => {
  for (let i = 0; i < 2500; i++) rememberAddresses([{ address: `nr${i}@massen.de` }]);
  speichereKontakteSofort();
  assert.ok(contactCount() <= 2000, `waren ${contactCount()}`);
});

pruefe('behält beim Aufräumen die häufig genutzten', () => {
  for (let i = 0; i < 20; i++) rememberAddresses([{ address: 'wichtig@b.de' }]);
  for (let i = 0; i < 2500; i++) rememberAddresses([{ address: `nr${i}@massen.de` }]);
  speichereKontakteSofort();
  assert.equal(searchContacts('wichtig').length, 1);
});

console.log('\nAblage auf der Platte:');

pruefe('liest einen gespeicherten Stand wieder ein', () => {
  merkeAusListe('konto1', 'INBOX', [mail(5, 'anna@b.de')]);
  speichereKontakteSofort();
  verwirfKontaktSpeicher();

  assert.equal(searchContacts('anna').length, 1);
  // Der ausgewertete Bereich hat den Neustart ebenfalls überdauert.
  merkeAusListe('konto1', 'INBOX', [mail(5, 'anna@b.de')]);
  assert.equal(searchContacts('anna')[0]?.count, 1, 'nach dem Neustart erneut gezählt');
});

pruefe('liest die alte Fassung, die nur eine Liste enthielt', () => {
  alteAblage([{ address: 'alt@b.de', name: 'Alt', count: 9 }]);
  const treffer = searchContacts('alt')[0];
  assert.equal(treffer?.name, 'Alt');
  // Gestaucht, weil die alten Zähler durch das mehrfache Zählen aufgebläht sind.
  assert.equal(treffer?.count, 3);
});

pruefe('behält beim Stauchen der alten Zähler die Reihenfolge', () => {
  alteAblage([
    { address: 'wenig@b.de', count: 13 },
    { address: 'viel@b.de', count: 4188 },
  ]);
  const treffer = searchContacts('b.de');
  assert.equal(treffer[0]?.address, 'viel@b.de');
  // Der Abstand ist so weit zusammengezogen, dass richtig Gezähltes aufholen kann.
  assert.ok(treffer[0]!.count < 100, `war ${treffer[0]?.count}`);
});

pruefe('lässt sich von einer beschädigten Datei nicht aufhalten', () => {
  fs.writeFileSync(path.join(tempDir, 'contacts.json'), '{kaputt', 'utf-8');
  assert.equal(contactCount(), 0);
  rememberAddresses([{ address: 'neu@b.de' }]);
  assert.equal(contactCount(), 1);
});

verwirfKontaktSpeicher();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
