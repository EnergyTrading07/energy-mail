import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';

/*
 * Die Anmeldebremse.
 *
 * Geprueft wird hier vor allem das, was sie vorher NICHT konnte: ueber einen Neustart
 * hinweg zaehlen. Das ist keine Feinheit - ein Neustart kommt bei jedem Einspielen einer
 * Fassung, und eine Bremse, die dabei vergisst, hat im Betrieb nie gegriffen.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-bremse-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { istGesperrt, merkeFehlversuch, merkeErfolg, vergissBremse } = await import(
  './anmeldebremse.js'
);

const DATEI = path.join(tempDir, 'anmeldebremse.json');

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  try {
    leere();
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/**
 * Jede Pruefung faengt bei null an - sonst zaehlt die vorige mit.
 *
 * Die `.bak` muss mit weg: schreibeAtomar legt bei jedem Schreiben die vorige Fassung
 * daneben, und liesJson greift bei einer kaputten Hauptdatei darauf zurueck. Bliebe sie
 * liegen, uebernaehme die naechste Pruefung stillschweigend die Zaehler der vorigen.
 */
function leere(): void {
  for (const datei of fs.readdirSync(tempDir)) {
    if (datei.startsWith('anmeldebremse.json')) fs.rmSync(path.join(tempDir, datei), { force: true });
  }
  vergissBremse();
}

/** Was ein Neustart des Servers tut: der Speicher ist weg, die Datei bleibt. */
function neustart(): void {
  vergissBremse();
}

const IP = '203.0.113.7';
const ANDERE_IP = '198.51.100.4';
const ADRESSE = 'anna@example.de';

console.log('\nAnmeldebremse - die Grenze:');

await pruefe('neun Fehlversuche lassen noch durch', () => {
  for (let i = 0; i < 9; i++) merkeFehlversuch(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), null);
});

await pruefe('der zehnte sperrt', () => {
  for (let i = 0; i < 10; i++) merkeFehlversuch(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), 'paar');
});

await pruefe('Fragen allein zaehlt nicht hoch', () => {
  for (let i = 0; i < 9; i++) merkeFehlversuch(IP, ADRESSE);
  // Hundertmal fragen darf die Sperre nicht ausloesen - sonst haette die Oberflaeche
  // durch blosses Nachsehen jemanden ausgesperrt.
  for (let i = 0; i < 100; i++) istGesperrt(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), null);
});

console.log('\nUeber den Neustart hinweg:');

await pruefe('die Sperre ueberlebt einen Neustart', () => {
  for (let i = 0; i < 10; i++) merkeFehlversuch(IP, ADRESSE);
  neustart();
  assert.equal(istGesperrt(IP, ADRESSE), 'paar');
});

await pruefe('auch der halbe Zaehler ueberlebt', () => {
  for (let i = 0; i < 9; i++) merkeFehlversuch(IP, ADRESSE);
  neustart();
  // Vorher waeren nach dem Neustart wieder zehn Versuche frei gewesen. Jetzt genuegt einer.
  merkeFehlversuch(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), 'paar');
});

await pruefe('nach Ablauf des Fensters ist wieder frei', () => {
  for (let i = 0; i < 10; i++) merkeFehlversuch(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), 'paar');

  // Die Uhr vorstellen, statt eine Viertelstunde zu warten.
  const echt = Date.now;
  Date.now = () => echt() + 16 * 60 * 1000;
  try {
    assert.equal(istGesperrt(IP, ADRESSE), null);
  } finally {
    Date.now = echt;
  }
});

console.log('\nDie zweite Ebene - Streuen ueber viele Adressen:');

await pruefe('fuenfzig Versuche gegen fuenfzig Adressen sperren den Anschluss', () => {
  // Je Adresse ein einziger Versuch: die Paar-Ebene greift nie.
  for (let i = 0; i < 50; i++) merkeFehlversuch(IP, `nutzer${i}@example.de`);
  assert.equal(istGesperrt(IP, 'nutzer99@example.de'), 'netz');
});

await pruefe('vierzig davon reichen noch nicht', () => {
  for (let i = 0; i < 40; i++) merkeFehlversuch(IP, `nutzer${i}@example.de`);
  assert.equal(istGesperrt(IP, 'nutzer99@example.de'), null);
});

console.log('\nWas ausdruecklich NICHT gesperrt wird:');

await pruefe('eine gesperrte Adresse ist von anderswo weiter erreichbar', () => {
  // Sonst waere die Bremse eine Waffe: Wer eine Adresse kennt, sperrte ihren Inhaber mit
  // zehn falschen Kennwoertern aus - von jedem Anschluss aus.
  for (let i = 0; i < 10; i++) merkeFehlversuch(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), 'paar');
  assert.equal(istGesperrt(ANDERE_IP, ADRESSE), null);
});

await pruefe('ein Erfolg loest das Paar', () => {
  for (let i = 0; i < 9; i++) merkeFehlversuch(IP, ADRESSE);
  merkeErfolg(IP, ADRESSE);
  // Der Zaehler steht wieder bei null: neun weitere sperren immer noch nicht.
  for (let i = 0; i < 9; i++) merkeFehlversuch(IP, ADRESSE);
  assert.equal(istGesperrt(IP, ADRESSE), null);
});

await pruefe('ein Erfolg loest den Anschluss NICHT', () => {
  for (let i = 0; i < 50; i++) merkeFehlversuch(IP, `nutzer${i}@example.de`);
  assert.equal(istGesperrt(IP, 'fremd@example.de'), 'netz');

  /*
   * Sonst genuegte EIN gueltiges Kennwort, um den Zaehler zurueckzusetzen - und wer ein
   * Konto auf dem Server hat, duerfte von derselben Leitung aus unbegrenzt gegen die
   * Postfaecher seiner Kollegen probieren.
   */
  merkeErfolg(IP, ADRESSE);
  assert.equal(istGesperrt(IP, 'fremd@example.de'), 'netz');
});

console.log('\nWas in der Datei steht:');

await pruefe('weder Adresse noch Anschlusskennung stehen im Klartext', () => {
  merkeFehlversuch(IP, ADRESSE);
  const inhalt = fs.readFileSync(DATEI, 'utf-8');
  assert.ok(!inhalt.includes(ADRESSE), 'Die Mailadresse steht in der Datei.');
  assert.ok(!inhalt.includes(IP), 'Die Anschlusskennung steht in der Datei.');
  // Gezaehlt wird trotzdem - die Pruefsumme genuegt zum Vergleichen.
  assert.equal(JSON.parse(inhalt).eintraege.length, 2);
});

await pruefe('das Salz ist je Installation ein anderes', () => {
  merkeFehlversuch(IP, ADRESSE);
  const erstes = JSON.parse(fs.readFileSync(DATEI, 'utf-8')).salz as string;
  leere();
  merkeFehlversuch(IP, ADRESSE);
  const zweites = JSON.parse(fs.readFileSync(DATEI, 'utf-8')).salz as string;
  assert.notEqual(erstes, zweites);
  assert.ok(erstes.length >= 16);
});

await pruefe('eine kaputte Datei wird aus der Sicherungskopie geheilt', () => {
  for (let i = 0; i < 10; i++) merkeFehlversuch(IP, ADRESSE);
  // Zweimal schreiben, damit eine .bak mit dem gesperrten Stand danebenliegt.
  merkeFehlversuch(IP, 'noch.jemand@example.de');
  fs.writeFileSync(DATEI, '{ das ist kein JSON', 'utf-8');
  neustart();
  // Die Sperre steht weiter: ein abgeschnittener Schreibvorgang ist kein Freibrief.
  assert.equal(istGesperrt(IP, ADRESSE), 'paar');
});

await pruefe('ist auch die Sicherungskopie hin, sperrt es niemanden aus', () => {
  for (let i = 0; i < 10; i++) merkeFehlversuch(IP, ADRESSE);
  fs.writeFileSync(DATEI, '{ kaputt', 'utf-8');
  fs.writeFileSync(`${DATEI}.bak`, '{ auch kaputt', 'utf-8');
  neustart();
  /*
   * Im Zweifel durchlassen. Andersherum - im Zweifel sperren - machte aus einem
   * Schreibfehler einen Ausfall fuer alle: niemand kaeme mehr an seine Post, und der
   * Grund staende in einer Datei, die gerade unlesbar ist.
   */
  assert.equal(istGesperrt(IP, ADRESSE), null);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
