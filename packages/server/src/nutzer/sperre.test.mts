import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/**
 * Die Sitzungssperre - am Draht und nicht nur in der Mechanik.
 *
 * Der Grund fuer diese Form steht in sprachAmDraht.test.mts: Eine Pruefung, die nur die
 * Bausteine anfasst, kann gruen sein, waehrend im Betrieb nichts davon greift. Hier haengt
 * genau daran alles - eine Sperre, die der Server nicht durchsetzt, ist ein Vorhang.
 *
 * Deshalb: echter Server, echter Keks, echte Route. Und die Frage, auf die es ankommt -
 * kommt ein zweiter Zugriff mit demselben Keks an den Daten vorbei?
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

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-sperre-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const { legeNutzerAn } = await import('./nutzerStore.js');
const { richteUmschlagEin } = await import('./einrichten.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { vergissSitzungen, sperreSitzung, sitzungsstand, eroeffneSitzung } = await import(
  './sitzung.js'
);

const EMAIL = 'anna@beispiel.de';
const KENNWORT = 'Sieben Pflaumen im Krug';
richteUmschlagEin();
const nutzer = legeNutzerAn({ email: EMAIL, kennwort: KENNWORT }, verpackeNutzerschluessel);

const { buildServer } = await import('../app.js');
const app = await buildServer({});

/** Meldet an und gibt den Keks zurueck. */
async function anmelden(): Promise<string> {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: EMAIL, kennwort: KENNWORT },
  });
  assert.equal(antwort.statusCode, 200, `Anmeldung ergab ${antwort.statusCode}`);
  const keks = antwort.cookies.find((c) => c.name === 'energy_mail_sitzung');
  assert.ok(keks, 'Kein Sitzungskeks gesetzt.');
  return keks.value;
}

const mitKeks = (keks: string) => ({ cookie: `energy_mail_sitzung=${keks}` });

console.log('\nDie Sperre am Draht:');

await pruefe('angemeldet kommt man an die Konten', async () => {
  const keks = await anmelden();
  const antwort = await app.inject({ method: 'GET', url: '/accounts', headers: mitKeks(keks) });
  assert.equal(antwort.statusCode, 200);
});

await pruefe('nach dem Sperren nicht mehr - und zwar mit 423', async () => {
  const keks = await anmelden();
  const zu = await app.inject({ method: 'POST', url: '/sperre', headers: mitKeks(keks) });
  assert.equal(zu.statusCode, 200);
  assert.equal(zu.json().gesperrt, true);

  const antwort = await app.inject({ method: 'GET', url: '/accounts', headers: mitKeks(keks) });
  /*
   * 423 und nicht 401: Der Unterschied traegt eine Auskunft. 401 hiesse "melde dich an"
   * und wuerfe alles weg, was offen war - auch den halb geschriebenen Brief.
   */
  assert.equal(antwort.statusCode, 423);
  assert.equal(antwort.json().gesperrt, true);
});

await pruefe('auch ein zweiter Zugriff mit demselben Keks kommt nicht vorbei', async () => {
  /*
   * Das ist der Grund, warum die Sperre am Server haengt und nicht in der Oberflaeche.
   * Ein Vorhang im Fenster liesse genau das durch: neuer Tab, derselbe Keks, die Post.
   */
  const keks = await anmelden();
  await app.inject({ method: 'POST', url: '/sperre', headers: mitKeks(keks) });
  for (const weg of ['/accounts', '/etiketten', '/sicherung']) {
    const antwort = await app.inject({ method: 'GET', url: weg, headers: mitKeks(keks) });
    assert.equal(antwort.statusCode, 423, `${weg} liess durch (${antwort.statusCode})`);
  }
});

await pruefe('das richtige Kennwort macht wieder auf', async () => {
  const keks = await anmelden();
  await app.inject({ method: 'POST', url: '/sperre', headers: mitKeks(keks) });
  const auf = await app.inject({
    method: 'POST',
    url: '/sperre/oeffnen',
    headers: mitKeks(keks),
    payload: { kennwort: KENNWORT },
  });
  assert.equal(auf.statusCode, 200);
  const antwort = await app.inject({ method: 'GET', url: '/accounts', headers: mitKeks(keks) });
  assert.equal(antwort.statusCode, 200);
});

await pruefe('ein falsches Kennwort macht nicht auf', async () => {
  const keks = await anmelden();
  await app.inject({ method: 'POST', url: '/sperre', headers: mitKeks(keks) });
  const auf = await app.inject({
    method: 'POST',
    url: '/sperre/oeffnen',
    headers: mitKeks(keks),
    payload: { kennwort: 'daneben' },
  });
  assert.equal(auf.statusCode, 401);
  const antwort = await app.inject({ method: 'GET', url: '/accounts', headers: mitKeks(keks) });
  assert.equal(antwort.statusCode, 423);
});

await pruefe('ohne Keks laesst sich nichts entsperren', async () => {
  const auf = await app.inject({
    method: 'POST',
    url: '/sperre/oeffnen',
    payload: { kennwort: KENNWORT },
  });
  assert.equal(auf.statusCode, 401);
});

console.log('\nWas /ich meldet:');

await pruefe('/ich nennt die Sperre, damit die Oberflaeche sie beim Start kennt', async () => {
  const keks = await anmelden();
  const vorher = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(keks) });
  assert.equal(vorher.json().gesperrt, false);

  await app.inject({ method: 'POST', url: '/sperre', headers: mitKeks(keks) });
  const nachher = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(keks) });
  // Angemeldet bleibt angemeldet - nur eben zu. Sonst zeigte die Oberflaeche nach einem
  // Neuladen ein leeres Anmeldefenster statt der Sperre mit dem Namen.
  assert.equal(nachher.json().angemeldet, true);
  assert.equal(nachher.json().gesperrt, true);
  assert.equal(nachher.json().nutzer.email, EMAIL);
});

console.log('\nDie Frist:');

await pruefe('Untaetigkeit sperrt, ohne die Sitzung zu beenden', async () => {
  const keks = await anmelden();
  vergissSitzungen();

  // Die Uhr um zwei Stunden vorstellen - die Voreinstellung ist eine Stunde.
  const echt = Date.now;
  Date.now = () => echt() + 2 * 60 * 60 * 1000;
  try {
    const stand = sitzungsstand(keks);
    assert.equal(stand.gesperrt, true, 'nach zwei Stunden nicht gesperrt');
    // Der Nutzer steht weiter fest: die Sitzung ist zu, nicht weg.
    assert.equal(stand.nutzerId, nutzer.id);
  } finally {
    Date.now = echt;
  }
});

await pruefe('eine frische Sitzung ist nicht gesperrt', async () => {
  const keks = await anmelden();
  vergissSitzungen();
  assert.equal(sitzungsstand(keks).gesperrt, false);
});

await pruefe('zweimal sperren ist kein Fehler', async () => {
  const keks = await anmelden();
  assert.equal(sperreSitzung(keks), true);
  assert.equal(sperreSitzung(keks), false);
  assert.equal(sitzungsstand(keks).gesperrt, true);
});

await pruefe('eine unbekannte Kennung sperrt nichts', () => {
  assert.equal(sperreSitzung('gibtesnicht'), false);
  assert.equal(sitzungsstand('gibtesnicht').nutzerId, null);
});

console.log('\nWas die Sperre NICHT betrifft:');

await pruefe('die Huelle ohne Sitzung bleibt unberuehrt', async () => {
  /*
   * Im Desktop-Betrieb weist sich das Fenster mit dem Zugangsgeheimnis des Prozesses aus.
   * Es gibt dort keine Sitzung und kein Kennwort - also darf dort auch nichts zufallen,
   * was niemand wieder aufmachen koennte.
   */
  const eigen = await buildServer({ nutzerErmitteln: () => nutzer.id });
  const keks = eroeffneSitzung(nutzer.id);
  sperreSitzung(keks);
  const antwort = await eigen.inject({ method: 'GET', url: '/accounts' });
  assert.equal(antwort.statusCode, 200);
  await eigen.close();
});

await app.close();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
