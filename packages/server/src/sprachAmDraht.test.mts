import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';
import { setKeyProvider } from './secretCrypto.js';

/**
 * Kommt die Sprache tatsächlich am Draht an?
 *
 * Diese Datei gibt es wegen eines Fehlers, den die vorhandene Prüfung nicht finden
 * konnte - und der Grund dafür ist lehrreich genug, um ihn hier festzuhalten.
 *
 * `sprachkontext.test.mts` prüft die Mechanik: zwei verschränkte Anfragen, jede bekommt
 * ihre Sprache. Sie bestand, durchgehend. Nur hinterlegte sie ihre Kataloge selbst, mit
 * `lerneKatalog('en', { … })` am Dateianfang. Im echten Server rief diese Zeile niemand:
 * Die Sprache je Anfrage wurde ermittelt, `t()` stand an sechsundachtzig Stellen, und
 * jede Meldung fiel auf Deutsch zurück - auch für einen Browser, der ausdrücklich
 * Englisch verlangte.
 *
 * Ein Fehler ohne Symptom: keine Ausnahme, keine leere Stelle, nur weiterhin Deutsch. Und
 * eine grüne Prüfung daneben, die das Rohr geprüft hatte, aber nicht, ob Wasser
 * hindurchläuft.
 *
 * Deshalb geht diese Prüfung den ganzen Weg: echter Server, echte Kataloge, echte
 * Kopfzeile - und sieht nach, was im Antwortkörper steht.
 */

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => Promise<void> | void): Promise<void> {
  gesamt++;
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ok   ${name}`);
      ok++;
    })
    .catch((err: Error) => {
      console.log(`  FEHL ${name}\n       ${err.message}`);
    });
}

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-sprache-'));
setDataDir(ORDNER);
betreteNutzerFuerProzess('pruefung');
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const { stelleEinplatznutzerSicher } = await import('./nutzer/einrichten.js');
stelleEinplatznutzerSicher('pruefung', 'pruefung@beispiel.de');

const { buildServer } = await import('./app.js');
const app = await buildServer({ nutzerErmitteln: () => 'pruefung' });

/*
 * buildServer stößt das Laden der Kataloge an, wartet es aber nicht ab - der Server soll
 * horchen können, bevor sie da sind. Hier wird gewartet, denn hier geht es um genau sie.
 */
const { ladeAlle } = await import('@energy-mail/mail-core/sprachen');
await ladeAlle();

const ERFUNDEN = '00000000-0000-0000-0000-000000000000';

/** Holt die Fehlermeldung zu einem Konto, das es nicht gibt - in der gewünschten Sprache. */
async function meldung(acceptLanguage?: string): Promise<string> {
  const antwort = await app.inject({
    method: 'GET',
    url: `/accounts/${ERFUNDEN}/folders`,
    ...(acceptLanguage ? { headers: { 'accept-language': acceptLanguage } } : {}),
  });
  return (antwort.json() as { error?: string }).error ?? '';
}

console.log('\nDie Sprache am Draht:');

await pruefe('ohne Angabe kommt Deutsch', async () => {
  assert.equal(await meldung(), 'Konto nicht gefunden');
});

await pruefe('mit Accept-Language kommt Englisch', async () => {
  /*
   * DIE Prüfung dieser Datei. Sie schlug fehl, solange der Server keinen Katalog lud -
   * und zwar mit "Konto nicht gefunden" statt "Account not found".
   */
  assert.equal(await meldung('en-GB,en;q=0.9'), 'Account not found');
});

await pruefe('eine unbekannte Sprache fällt auf Deutsch zurück', async () => {
  assert.equal(await meldung('ja-JP,ja;q=0.9'), 'Konto nicht gefunden');
});

await pruefe('die Gewichtung wird gelesen, nicht die Reihenfolge', async () => {
  // "ja" steht vorn, ist aber schwächer gewichtet - und für Japanisch gibt es hier
  // ohnehin keinen Katalog. Genommen wird die erste Sprache, die es gibt.
  assert.equal(await meldung('ja;q=0.5,en;q=0.9'), 'Account not found');
});

await pruefe('auch die Eingangskontrolle antwortet uebersetzt', async () => {
  /*
   * Die Pruefung, die den zweiten stummen Fehler festhaelt.
   *
   * Fastify ruft die onRequest-Haken in der Reihenfolge ihrer Anmeldung. Der Sprachhaken
   * stand hinter der Zugangspruefung - die lief also ausserhalb des Sprachkontexts, und
   * ihre Meldung kam deutsch heraus, obwohl sie uebersetzt war.
   *
   * Aufgefallen ist das an der laufenden Anwendung und nicht hier, denn diese Meldung
   * entsteht nur bei einer ABGEWIESENEN Anfrage - und jede Pruefung fragt ordnungsgemaess
   * an. Deshalb wird hier ausdruecklich eine fremde Herkunft vorgetaeuscht.
   */
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { origin: 'https://fremde-seite.example', 'accept-language': 'en-GB' },
  });
  const meldung = (antwort.json() as { error?: string }).error ?? '';
  assert.equal(antwort.statusCode, 403);
  assert.equal(meldung, 'Request from a foreign origin');
});

await pruefe('zwei Anfragen gleichzeitig bleiben getrennt', async () => {
  /*
   * Über den echten Server, nicht über inSprache() von Hand. Eine Variable im Modul
   * käme hier durch - erst verschränkte Anfragen zeigen den Unterschied.
   */
  const [deutsch, englisch] = await Promise.all([meldung(), meldung('en')]);
  assert.equal(deutsch, 'Konto nicht gefunden');
  assert.equal(englisch, 'Account not found');
});

await app.close();
fs.rmSync(ORDNER, { recursive: true, force: true });

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
