import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir, getNutzerDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';

/*
 * Die Umstellung der Ablage von einer Fassung zur naechsten.
 *
 * Vorher gab es keine: eine einzelne Zahl, und wich sie ab, wurde die gesamte Datenbank
 * geloescht und neu angelegt. Fuer ein Einplatzprogramm vertretbar - fuer einen Dienst
 * hiesse jede Aktualisierung, die das Schema anfasst, dass saemtliche Nutzer im selben
 * Augenblick ihren Offline-Bestand neu laden.
 *
 * Die entscheidende Frage dieser Datei ist deshalb nicht "laeuft die Umstellung durch",
 * sondern "ueberlebt der Bestand sie".
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-migration-test-'));
setDataDir(tempDir);
betreteNutzerFuerProzess('pruefung');
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { ablage, merkeKopfdaten, holeSeite, schliesseAblage, ablageFassung } = await import(
  './lokaleAblage.js'
);

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

function nachricht(uid: number, betreff: string) {
  return {
    uid,
    subject: betreff,
    from: [{ address: 'wer@beispiel.de' }],
    to: [],
    cc: [],
    date: new Date('2026-01-01'),
    seen: false,
    flags: [] as string[],
    hasAttachments: false,
  };
}

/** Setzt die eingetragene Fassung von Hand - so sieht eine aeltere Ablage aus. */
function setzeFassung(wert: number): void {
  const d = ablage();
  d.prepare("insert or replace into stand (schluessel, wert) values ('fassung', ?)").run(
    String(wert),
  );
  schliesseAblage();
}

function gemerkteFassung(): number {
  const zeile = ablage().prepare("select wert from stand where schluessel = 'fassung'").get() as
    | { wert?: string }
    | undefined;
  return Number(zeile?.wert ?? 0);
}

console.log('\nEine frische Ablage:');

pruefe('traegt die aktuelle Fassung', () => {
  merkeKopfdaten('konto-1', 'INBOX', [nachricht(1, 'Erste')]);
  assert.equal(gemerkteFassung(), ablageFassung());
  assert.ok(ablageFassung() >= 1);
});

console.log('\nEine aeltere Ablage wird umgestellt, nicht geleert:');

pruefe('der Bestand ueberlebt die Umstellung', () => {
  /*
   * Der Kern der Sache. Vorher waere die Datei an dieser Stelle geloescht worden - bei
   * 31.700 Nachrichten Stunden des Nachladens, und das bei jedem Nutzer gleichzeitig.
   */
  merkeKopfdaten('konto-1', 'INBOX', [nachricht(2, 'Soll bleiben')]);
  setzeFassung(0);

  const danach = holeSeite('konto-1', 'INBOX', { anzahl: 50 }).map((m) => m.subject);
  assert.ok(danach.includes('Soll bleiben'), `nach der Umstellung: ${danach.join(', ')}`);
  assert.ok(danach.includes('Erste'), 'auch aeltere Eintraege sind noch da');
});

pruefe('und die Fassung steht danach wieder auf dem aktuellen Stand', () => {
  assert.equal(gemerkteFassung(), ablageFassung());
});

pruefe('ein zweites Oeffnen stellt nichts noch einmal um', () => {
  // Nichts zu tun ist der haeufigste Fall - er darf nichts anfassen.
  const vorher = holeSeite('konto-1', 'INBOX', { anzahl: 50 }).length;
  schliesseAblage();
  assert.equal(holeSeite('konto-1', 'INBOX', { anzahl: 50 }).length, vorher);
  assert.equal(gemerkteFassung(), ablageFassung());
});

console.log('\nEine Ablage aus einer NEUEREN Fassung:');

pruefe('wird neu aufgebaut statt rueckwaerts umgestellt', () => {
  /*
   * Passiert, wenn jemand nach einer Aktualisierung wieder die aeltere Fassung startet.
   * Rueckwaerts umstellen geht nicht; die Ablage ist ein Abbild und kein Original, also
   * wird sie neu aufgebaut. Wichtig ist nur, dass das Programm nicht stehenbleibt.
   */
  setzeFassung(9999);
  const danach = holeSeite('konto-1', 'INBOX', { anzahl: 50 });
  assert.deepEqual(danach, [], 'die Ablage haette neu aufgebaut werden muessen');
  assert.equal(gemerkteFassung(), ablageFassung());
});

console.log('\nEine beschaedigte Datei:');

pruefe('haelt das Programm nicht auf', () => {
  schliesseAblage();
  fs.writeFileSync(path.join(getNutzerDir(), 'ablage.db'), 'das ist keine Datenbank', 'utf-8');

  // Darf nicht werfen - die Ablage baut sich neu auf.
  merkeKopfdaten('konto-1', 'INBOX', [nachricht(7, 'Nach dem Schaden')]);
  const danach = holeSeite('konto-1', 'INBOX', { anzahl: 50 }).map((m) => m.subject);
  assert.deepEqual(danach, ['Nach dem Schaden']);
});

schliesseAblage();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
