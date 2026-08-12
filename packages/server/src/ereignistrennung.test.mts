import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';
import { alsNutzer } from './nutzer/kontext.js';

/*
 * Die Trennung des Ereignisstroms.
 *
 * nutzer/trennung.test.mts prueft die Trennung der ABLAGE - dass Anna nicht in Berts
 * Ordner schreibt. Diese hier prueft die Trennung dessen, was ohne Datei auskommt: die
 * Meldungen, die der Server von sich aus an die offenen Fenster schickt.
 *
 * Genau dort fehlte sie. Der watcherRegistry hielt einen einzigen, prozessglobalen Satz
 * Zuhoerer; jede WebSocket-Verbindung haengte sich hinein, und emit() ging an alle. Der
 * Browser jedes Angemeldeten bekam damit die 'new-mail'-Ereignisse ALLER Nutzer - und
 * die tragen Betreff, Absender und Empfaenger mit sich. Die Ablage war sauber getrennt,
 * die Post floss trotzdem hinueber.
 *
 * Ein Fehlschlag hier heisst: jemand sieht fremde Post.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-ereignis-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { subscribe, meldeAktualisierung, meldeFortschritt } = await import('./watcherRegistry.js');
type Ereignis = Parameters<Parameters<typeof subscribe>[1]>[0];

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

/** Meldet einen Zuhoerer an und sammelt, was bei ihm ankommt. */
function horche(nutzerId: string): { gesehen: Ereignis[]; ab: () => void } {
  const gesehen: Ereignis[] = [];
  const ab = subscribe(nutzerId, (e) => gesehen.push(e));
  return { gesehen, ab };
}

console.log('\nEreignisse gehen nur an ihren eigenen Nutzer:');

await pruefe('Berts Fenster sieht Annas Aktualisierung nicht', () => {
  const anna = horche('anna');
  const bert = horche('bert');
  try {
    alsNutzer('anna', () =>
      meldeAktualisierung({ type: 'data-updated', accountId: 'konto-a', was: 'messages' }),
    );

    assert.equal(anna.gesehen.length, 1, 'Anna bekommt ihr eigenes Ereignis');
    assert.equal(bert.gesehen.length, 0, 'Bert sieht Annas Ereignis');
  } finally {
    anna.ab();
    bert.ab();
  }
});

await pruefe('und umgekehrt genauso', () => {
  const anna = horche('anna');
  const bert = horche('bert');
  try {
    alsNutzer('bert', () =>
      meldeFortschritt({
        type: 'fortschritt',
        accountId: 'konto-b',
        vorgang: 'sicherung',
        getan: 1,
        von: 2,
      }),
    );

    assert.equal(bert.gesehen.length, 1);
    assert.equal(anna.gesehen.length, 0, 'Anna sieht Berts Fortschritt');
  } finally {
    anna.ab();
    bert.ab();
  }
});

await pruefe('zwei Fenster desselben Nutzers bekommen beide etwas', () => {
  // Die Trennung darf nicht zu weit gehen: wer die Anwendung zweimal offen hat, soll in
  // beiden Fenstern denselben Stand sehen.
  const erstes = horche('anna');
  const zweites = horche('anna');
  try {
    alsNutzer('anna', () =>
      meldeAktualisierung({ type: 'data-updated', accountId: 'konto-a', was: 'folders' }),
    );

    assert.equal(erstes.gesehen.length, 1);
    assert.equal(zweites.gesehen.length, 1);
  } finally {
    erstes.ab();
    zweites.ab();
  }
});

await pruefe('nach dem Abmelden kommt nichts mehr an', () => {
  const anna = horche('anna');
  anna.ab();

  alsNutzer('anna', () =>
    meldeAktualisierung({ type: 'data-updated', accountId: 'konto-a', was: 'messages' }),
  );

  assert.equal(anna.gesehen.length, 0, 'ein abgemeldeter Zuhoerer bekam noch etwas');
});

await pruefe('ein Nutzer ohne Zuhoerer laesst die uebrigen unberuehrt', () => {
  // Kein Fenster offen ist der Normalfall bei einem Serverbetrieb - das darf weder
  // werfen noch die Meldung an jemand anderen umleiten.
  const anna = horche('anna');
  try {
    alsNutzer('carla', () =>
      meldeAktualisierung({ type: 'data-updated', accountId: 'konto-c', was: 'messages' }),
    );
    assert.equal(anna.gesehen.length, 0);
  } finally {
    anna.ab();
  }
});

console.log('\nOhne Nutzer wird nichts gemeldet:');

await pruefe('meldeAktualisierung wirft ohne Kontext', () => {
  /*
   * Der Riegel gegen den Rueckfall. Gaebe es hier einen Standardwert - "dann eben an
   * alle" -, waere die Trennung mit der ersten vergessenen Stelle wieder aufgehoben, und
   * zwar lautlos. Eine Ausnahme faellt beim ersten Durchlauf auf.
   */
  assert.throws(
    () => meldeAktualisierung({ type: 'data-updated', accountId: 'x', was: 'messages' }),
    /Kein Nutzerkontext/,
  );
  assert.throws(
    () =>
      meldeFortschritt({
        type: 'fortschritt',
        accountId: 'x',
        vorgang: 'absender',
        getan: 0,
        von: 1,
      }),
    /Kein Nutzerkontext/,
  );
});

await pruefe('subscribe weist eine unbrauchbare Kennung ab', () => {
  // Die Kennung wird zum Schluessel der Zuhoererliste. Eine wie "../andere" gehoert
  // hier genauso wenig hin wie im Ordnernamen.
  assert.throws(() => subscribe('../andere', () => undefined), /Unbrauchbare Nutzerkennung/);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
