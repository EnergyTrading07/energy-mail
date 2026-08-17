import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';

/*
 * Der Wechsel des Nutzerschluessels.
 *
 * Die Struktur dafuer stand von Anfang an: Der Eintrag traegt `schluessel[generation]` und
 * `aktuelleGeneration`, das Format der Geheimnisse fuehrt die Generation mit. Nur gab es
 * den Vorgang nicht - `setzeSchluesselGeneration` war geschrieben und wurde nirgends
 * gerufen. Ein abhandengekommener Schluessel liess sich damit nicht austauschen.
 *
 * Geprueft wird hier die Eigenschaft, an der alles haengt: Nach dem Wechsel muss Neues mit
 * dem neuen Schluessel verschluesselt werden UND Altes weiterhin lesbar bleiben. Faellt
 * eines von beiden weg, ist der Wechsel entweder wirkungslos oder er vernichtet Daten.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-wechsel-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { masterSchluesselAusDatei } = await import('./einrichten.js');
masterSchluesselAusDatei(path.join(tempDir, 'master.key'));

const { legeNutzerAn, findeNutzer } = await import('./nutzerStore.js');
const { alsNutzer } = await import('./kontext.js');
const {
  verschluessleFuerNutzer,
  entschluessleFuerNutzer,
  wechsleNutzerschluessel,
  verpackeNutzerschluessel,
} = await import('./schluesselHuelle.js');

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

console.log('\nWechsel des Nutzerschluessels:');

const anna = legeNutzerAn(
  { email: 'anna@beispiel.de', kennwort: 'geheim-genug-1234' },
  verpackeNutzerschluessel,
);

pruefe('ein frischer Nutzer beginnt bei Generation 1', () => {
  const eintrag = findeNutzer(anna.id);
  assert.equal(eintrag?.aktuelleGeneration, '1');
  assert.deepEqual(Object.keys(eintrag?.schluessel ?? {}), ['1']);
});

/** Vor dem Wechsel abgelegt - genau das muss den Wechsel ueberleben. */
let altesGeheimnis = '';

pruefe('vor dem Wechsel verschluesseltes traegt Generation 1', () => {
  alsNutzer(anna.id, () => {
    altesGeheimnis = verschluessleFuerNutzer('Kennwort des Postfachs');
  });
  assert.match(altesGeheimnis, /^v2\.1\./);
});

pruefe('der Wechsel legt eine neue Generation an', () => {
  const { generation } = wechsleNutzerschluessel(anna.id);
  assert.equal(generation, '2');

  const eintrag = findeNutzer(anna.id);
  assert.equal(eintrag?.aktuelleGeneration, '2');
  // Die alte BLEIBT stehen - sonst waere alles Bisherige unlesbar.
  assert.deepEqual(Object.keys(eintrag?.schluessel ?? {}).sort(), ['1', '2']);
  assert.notEqual(eintrag?.schluessel['1'], eintrag?.schluessel['2']);
});

pruefe('Neues traegt danach die neue Generation', () => {
  alsNutzer(anna.id, () => {
    assert.match(verschluessleFuerNutzer('etwas Neues'), /^v2\.2\./);
  });
});

pruefe('Altes bleibt lesbar - der Kern der ganzen Bauart', () => {
  alsNutzer(anna.id, () => {
    assert.equal(entschluessleFuerNutzer(altesGeheimnis), 'Kennwort des Postfachs');
  });
});

pruefe('auch das Neue laesst sich wieder oeffnen', () => {
  alsNutzer(anna.id, () => {
    const neu = verschluessleFuerNutzer('frisch');
    assert.equal(entschluessleFuerNutzer(neu), 'frisch');
  });
});

pruefe('mehrfaches Wechseln zaehlt weiter und wirft nichts weg', () => {
  wechsleNutzerschluessel(anna.id);
  const { generation } = wechsleNutzerschluessel(anna.id);
  assert.equal(generation, '4');
  assert.deepEqual(Object.keys(findeNutzer(anna.id)?.schluessel ?? {}).sort(), ['1', '2', '3', '4']);
  // Und das Aelteste von allen geht immer noch auf.
  alsNutzer(anna.id, () => {
    assert.equal(entschluessleFuerNutzer(altesGeheimnis), 'Kennwort des Postfachs');
  });
});

pruefe('der Wechsel trifft nur den genannten Nutzer', () => {
  const bert = legeNutzerAn(
    { email: 'bert@beispiel.de', kennwort: 'auch-geheim-5678' },
    verpackeNutzerschluessel,
  );
  wechsleNutzerschluessel(anna.id);
  assert.equal(findeNutzer(bert.id)?.aktuelleGeneration, '1');
});

pruefe('ein unbekannter Nutzer wirft, statt still nichts zu tun', () => {
  assert.throws(() => wechsleNutzerschluessel('gibtesnicht'));
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
