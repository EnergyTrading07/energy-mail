import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';

// Vor dem ersten Zugriff umlenken: der Zwischenspeicher liegt sonst im echten
// Benutzerordner und würde die Stände der laufenden Anwendung überschreiben.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-cache-test-'));
setDataDir(tempDir);
/*
 * Diese Pruefung arbeitet als ein Nutzer.
 *
 * Sie stand nicht in der Reihe derer, die beim Einziehen des Nutzerbegriffs sofort
 * scheiterten - und das war kein gutes Zeichen, sondern ein verschluckter Fehler:
 * laden() rief getNutzerDir() innerhalb seines try/catch, und der fehlende Kontext kam
 * dort als "Datei nicht vorhanden" heraus. Seit der Zwischenspeicher je Nutzer gehalten
 * wird, faellt es auf.
 */
betreteNutzerFuerProzess('pruefung');

const { ausSpeicherOderHolen, lies, schreibe, verwerfe, verwerfeKonto } = await import('./cache.js');

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  return (async () => {
    try {
      await fn();
      console.log(`  ok   ${name}`);
      bestanden++;
    } catch (err) {
      console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
      gescheitert++;
    }
  })();
}

/** Wartet, bis die im Hintergrund angestoßene Auffrischung durch ist. */
const kurzWarten = () => new Promise((r) => setTimeout(r, 30));

console.log('\nZwischenspeicher:');

await pruefe('ohne Stand wird geholt und abgelegt', async () => {
  const { wert, ausSpeicher } = await ausSpeicherOderHolen('a', async () => 'frisch', {
    maxAlterMs: 1000,
  });
  assert.equal(wert, 'frisch');
  assert.equal(ausSpeicher, false);
  assert.equal(lies<string>('a')?.wert, 'frisch');
});

await pruefe('gültiger Stand wird ohne Abfrage geliefert', async () => {
  schreibe('b', 'alt');
  let gerufen = 0;
  const { wert, ausSpeicher } = await ausSpeicherOderHolen(
    'b',
    async () => {
      gerufen++;
      return 'neu';
    },
    { maxAlterMs: 60_000 },
  );
  assert.equal(wert, 'alt');
  assert.equal(ausSpeicher, true);
  assert.equal(gerufen, 0, 'innerhalb der Frist darf gar nicht abgefragt werden');
});

await pruefe('abgelaufener Stand wird sofort geliefert, nicht abgewartet', async () => {
  schreibe('c', 'alt');
  let angestossen = false;
  const t0 = Date.now();
  const { wert, ausSpeicher } = await ausSpeicherOderHolen(
    'c',
    // Eine Abfrage, die spürbar dauert - käme sie in den Weg, fiele es an der Zeit auf.
    () => {
      angestossen = true;
      return new Promise((r) => setTimeout(() => r('neu'), 200));
    },
    { maxAlterMs: 0 },
  );
  const gedauert = Date.now() - t0;
  assert.equal(wert, 'alt', 'es muss der bekannte Stand zurückkommen, nicht der neue');
  assert.equal(ausSpeicher, true);
  // Ohne diese beiden Zusicherungen bestünde der Test auch dann, wenn überhaupt nicht
  // aufgefrischt würde - genau daran ist er beim ersten Lauf durchgerutscht.
  assert.ok(angestossen, 'die Auffrischung muss angestoßen worden sein');
  assert.ok(gedauert < 100, `es wurde gewartet (${gedauert} ms statt sofort)`);
});

await pruefe('Auffrischung meldet, wenn sich etwas geändert hat', async () => {
  schreibe('d', 'alt');
  const meldungen: string[] = [];
  await ausSpeicherOderHolen('d', async () => 'neu', {
    maxAlterMs: 0,
    beiAenderung: (w) => meldungen.push(w),
  });
  await kurzWarten();
  assert.deepEqual(meldungen, ['neu']);
  assert.equal(lies<string>('d')?.wert, 'neu', 'der neue Stand muss abgelegt sein');
});

await pruefe('unveränderte Auffrischung meldet nichts', async () => {
  schreibe('e', { a: 1, b: [2, 3] });
  let gemeldet = 0;
  let abgefragt = false;
  await ausSpeicherOderHolen(
    'e',
    async () => {
      abgefragt = true;
      return { a: 1, b: [2, 3] };
    },
    { maxAlterMs: 0, beiAenderung: () => gemeldet++ },
  );
  await kurzWarten();
  assert.ok(abgefragt, 'es muss wirklich nachgesehen worden sein');
  assert.equal(gemeldet, 0, 'ohne Unterschied darf die Oberfläche nicht neu laden');
});

await pruefe('scheiternde Auffrischung lässt den alten Stand stehen', async () => {
  schreibe('f', 'alt');
  const { wert } = await ausSpeicherOderHolen(
    'f',
    async () => {
      throw new Error('kein Netz');
    },
    { maxAlterMs: 0 },
  );
  assert.equal(wert, 'alt');
  await kurzWarten();
  assert.equal(lies<string>('f')?.wert, 'alt', 'ohne Netz muss der bekannte Stand erhalten bleiben');
});

await pruefe('ohne Stand schlägt ein Fehler durch', async () => {
  await assert.rejects(
    () => ausSpeicherOderHolen('g', async () => { throw new Error('kein Netz'); }, { maxAlterMs: 0 }),
    /kein Netz/,
    'ohne etwas zu zeigen darf der Fehler nicht verschluckt werden',
  );
});

await pruefe('verwerfen wirkt auf den Präfix', () => {
  schreibe('nachrichten:kontoA:INBOX:', 1);
  schreibe('nachrichten:kontoA:Gesendet:', 2);
  schreibe('nachrichten:kontoB:INBOX:', 3);
  verwerfe('nachrichten:kontoA:');
  assert.equal(lies('nachrichten:kontoA:INBOX:'), null);
  assert.equal(lies('nachrichten:kontoA:Gesendet:'), null);
  assert.equal(lies<number>('nachrichten:kontoB:INBOX:')?.wert, 3, 'fremde Konten bleiben unberührt');
});

await pruefe('Konto entfernen räumt alles zu diesem Konto ab', () => {
  schreibe('ordner:kontoC', 1);
  schreibe('einordnung:kontoC', 2);
  schreibe('nachrichten:kontoC:INBOX:', 3);
  schreibe('ordner:kontoD', 4);
  verwerfeKonto('kontoC');
  assert.equal(lies('ordner:kontoC'), null);
  assert.equal(lies('einordnung:kontoC'), null);
  assert.equal(lies('nachrichten:kontoC:INBOX:'), null);
  assert.equal(lies<number>('ordner:kontoD')?.wert, 4);
});

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
