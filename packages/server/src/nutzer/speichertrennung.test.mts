import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';

/*
 * Die Trennung im ARBEITSSPEICHER, nicht nur in den Dateien.
 *
 * trennung.test.mts zeigt, dass jeder Nutzer seinen eigenen Ordner bekommt. Das genuegt
 * nicht: mehrere Speicher halten ihren Zustand zusaetzlich in prozessglobalen Maps und
 * in einem einzigen Datenbankgriff. Der Nutzerkontext schaltet dann zwar die Datei um,
 * gelesen wird aber weiterhin aus dem, was ein anderer Nutzer hineingelegt hat.
 *
 * Das ist keine Frage des Speicherverbrauchs, sondern eine Vermischung von Daten - die
 * eine Sorte Fehler, die ein Mailprogramm auf keinen Fall haben darf.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-speicher-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { alsNutzer } = await import('./kontext.js');
const { merkeKopfdaten, holeSeite, schliesseAblage } = await import('../lokaleAblage.js');
const { schreibe, lies, schreibeSofort } = await import('../cache.js');

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/** Eine Kopfzeile, wie sie aus dem Postfach kaeme. */
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

console.log('\nDie lokale Ablage gehoert je einem Nutzer:');

await pruefe('was Anna ablegt, sieht Bert nicht', () => {
  alsNutzer('anna', () => merkeKopfdaten('konto-1', 'INBOX', [nachricht(1, 'Annas Post')]));
  alsNutzer('bert', () => merkeKopfdaten('konto-1', 'INBOX', [nachricht(2, 'Berts Post')]));

  const beiAnna = alsNutzer('anna', () => holeSeite('konto-1', 'INBOX', { anzahl: 50 }));
  const beiBert = alsNutzer('bert', () => holeSeite('konto-1', 'INBOX', { anzahl: 50 }));

  const annasBetreffe = beiAnna.map((m) => m.subject);
  const bertsBetreffe = beiBert.map((m) => m.subject);

  assert.deepEqual(annasBetreffe, ['Annas Post'], `Anna sah: ${annasBetreffe.join(', ')}`);
  assert.deepEqual(bertsBetreffe, ['Berts Post'], `Bert sah: ${bertsBetreffe.join(', ')}`);
});

await pruefe('und die Datenbanken liegen getrennt auf der Platte', () => {
  for (const wer of ['anna', 'bert']) {
    const p = path.join(tempDir, 'nutzer', wer, 'ablage.db');
    assert.ok(fs.existsSync(p), `${wer} hat keine eigene Ablage`);
  }
});

console.log('\nDer Zwischenspeicher ebenso:');

await pruefe('ein Eintrag von Anna taucht bei Bert nicht auf', () => {
  alsNutzer('anna', () => schreibe('ordner:konto-1', ['Annas Ordner']));
  alsNutzer('bert', () => schreibe('ordner:konto-1', ['Berts Ordner']));

  assert.deepEqual(
    alsNutzer('anna', () => lies<string[]>('ordner:konto-1')?.wert),
    ['Annas Ordner'],
  );
  assert.deepEqual(
    alsNutzer('bert', () => lies<string[]>('ordner:konto-1')?.wert),
    ['Berts Ordner'],
  );
});

await pruefe('einer, den nur Anna hat, fehlt bei Bert ganz', () => {
  alsNutzer('anna', () => schreibe('einordnung:konto-9', ['nur Anna']));
  assert.equal(alsNutzer('bert', () => lies('einordnung:konto-9')), null);
});

await pruefe('geschrieben wird in getrennte Dateien', () => {
  alsNutzer('anna', () => schreibeSofort());
  alsNutzer('bert', () => schreibeSofort());
  const annas = fs.readFileSync(path.join(tempDir, 'nutzer', 'anna', 'cache.json'), 'utf-8');
  const berts = fs.readFileSync(path.join(tempDir, 'nutzer', 'bert', 'cache.json'), 'utf-8');
  assert.ok(annas.includes('Annas Ordner'));
  assert.ok(!annas.includes('Berts Ordner'), 'Berts Eintrag stand in Annas Datei');
  assert.ok(berts.includes('Berts Ordner'));
  assert.ok(!berts.includes('Annas Ordner'), 'Annas Eintrag stand in Berts Datei');
});

// Aufraeumen, damit die Datenbankdateien nicht offen bleiben.
for (const wer of ['anna', 'bert']) alsNutzer(wer, () => schliesseAblage());

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
