import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beschreibeRichtlinien, richtlinien, vergissRichtlinien } from './richtlinien.js';

/*
 * Vorgaben der Organisation.
 *
 * Der Anlass ist die Selbstaktualisierung. Auf einem Privatrechner ist sie richtig - sie
 * schliesst Luecken, ohne dass jemand daran denken muss. In einem Unternehmen ist sie
 * genau verkehrt herum: dort entscheidet die IT, welche Fassung wann auf welchen Rechner
 * kommt. Ein Programm, das sich das nicht abgewoehnen laesst, wird dort gar nicht erst
 * zugelassen.
 *
 * Die Datei liegt unter %PROGRAMDATA% und nicht im Profil des Nutzers: sonst waere sie
 * keine Vorgabe, sondern ein Vorschlag.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-richtlinien-'));
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const urspruenglich = process.env.ProgramData;
process.env.ProgramData = tempDir;
process.on('exit', () => {
  if (urspruenglich === undefined) delete process.env.ProgramData;
  else process.env.ProgramData = urspruenglich;
});

const ziel = path.join(tempDir, 'Energy Mail', 'richtlinien.json');

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

function hinterlege(inhalt: string): void {
  fs.mkdirSync(path.dirname(ziel), { recursive: true });
  fs.writeFileSync(ziel, inhalt, 'utf8');
  vergissRichtlinien();
}

console.log('\nOhne hinterlegte Datei:');

pruefe('gilt die Vorgabe - nichts ist eingeschraenkt', () => {
  // Der Normalfall, und der haeufigste: ein Privatrechner hat keine Richtlinien.
  vergissRichtlinien();
  assert.equal(richtlinien().aktualisierungAbschalten, false);
  assert.equal(richtlinien().ansprechpartner, undefined);
  assert.match(beschreibeRichtlinien(), /keine hinterlegt/);
});

console.log('\nMit hinterlegter Datei:');

pruefe('die Aktualisierung laesst sich abschalten', () => {
  hinterlege(JSON.stringify({ aktualisierungAbschalten: true }));
  assert.equal(richtlinien().aktualisierungAbschalten, true);
  assert.match(beschreibeRichtlinien(), /abgeschaltet/);
});

pruefe('ein Ansprechpartner erscheint statt der Projektseite', () => {
  // Sonst wendet sich ein Mitarbeiter mit einem Problem an Fremde statt an seine eigene IT.
  hinterlege(
    JSON.stringify({ aktualisierungAbschalten: true, ansprechpartner: 'IT-Hotline: 4711' }),
  );
  assert.equal(richtlinien().ansprechpartner, 'IT-Hotline: 4711');
});

pruefe('ausdrueckliches Erlauben bleibt erlaubt', () => {
  hinterlege(JSON.stringify({ aktualisierungAbschalten: false }));
  assert.equal(richtlinien().aktualisierungAbschalten, false);
  assert.match(beschreibeRichtlinien(), /erlaubt/);
});

console.log('\nWenn die Datei nicht stimmt:');

pruefe('kaputtes JSON haelt das Programm nicht auf', () => {
  /*
   * Der Fall, der zaehlt: eine Richtliniendatei wird von Hand geschrieben oder von einem
   * Verteilwerkzeug erzeugt, und ein Komma zu viel ist schnell drin. Dann darf nicht das
   * Mailprogramm ausfallen - sonst haette ein Tippfehler dieselbe Wirkung wie ein
   * Totalausfall.
   */
  hinterlege('{ das ist kein JSON');
  assert.doesNotThrow(() => richtlinien());
  assert.equal(richtlinien().aktualisierungAbschalten, false);
});

pruefe('unerwartete Werte werden nicht geglaubt', () => {
  // "ja" ist kein true. Wer eine Vorgabe setzen will, soll sie richtig setzen - ein
  // halb verstandener Wert, der zufaellig wirkt, ist schlimmer als einer, der nicht wirkt.
  hinterlege(JSON.stringify({ aktualisierungAbschalten: 'ja', ansprechpartner: 42 }));
  assert.equal(richtlinien().aktualisierungAbschalten, false);
  assert.equal(richtlinien().ansprechpartner, undefined);
});

pruefe('ein ueberlanger Ansprechpartner wird gekuerzt', () => {
  // Er landet in einem Fenster; ein Roman darin waere kein Fenster mehr.
  hinterlege(JSON.stringify({ ansprechpartner: 'x'.repeat(5000) }));
  assert.equal(richtlinien().ansprechpartner?.length, 300);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
