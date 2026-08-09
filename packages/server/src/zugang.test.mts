import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { setDataDir } from './paths.js';

/*
 * Der Zugangsriegel des lokalen Servers.
 *
 * Er ist neu, und er ist die Stelle, an der frueher jede beliebige Webseite im Browser
 * das gesamte Postfach lesen konnte: der Server lauschte zwar nur auf 127.0.0.1, aber
 * `cors { origin: true }` spiegelte jede Herkunft zurueck, und eine Anmeldung gab es
 * nicht. Genau deshalb gehoert hier eine Pruefung hin - nicht erst, wenn es das naechste
 * Mal auffaellt.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-zugang-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { ZUGANG_KOPFZEILE, erzeugeZugangsgeheimnis, registriereZugangspruefung, setzeZugangsgeheimnis } =
  await import('./zugang.js');

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => Promise<void> | void): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/** Ein kleiner Server mit demselben Riegel wie der echte. */
function baueProbe(geheimnis: string | null) {
  setzeZugangsgeheimnis(geheimnis);
  const app = Fastify();
  registriereZugangspruefung(app, 4000);
  app.get('/accounts', async () => [{ id: '1', email: 'a@b.de' }]);
  app.get('/', async () => 'Oberflaeche');
  app.get('/assets/haupt.js', async () => 'skript');
  app.post('/accounts/1/send', async () => ({ ok: true }));
  return app;
}

const GEHEIM = erzeugeZugangsgeheimnis();

console.log('\nOhne Geheimnis kommt niemand an die Postfachdaten:');

await pruefe('eine Anfrage ohne Geheimnis wird abgewiesen', async () => {
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(antwort.statusCode, 401);
  assert.ok(!antwort.body.includes('a@b.de'), 'und liefert nichts aus dem Postfach mit');
  await app.close();
});

await pruefe('mit dem richtigen Geheimnis geht sie durch', async () => {
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { [ZUGANG_KOPFZEILE]: GEHEIM },
  });
  assert.equal(antwort.statusCode, 200);
  await app.close();
});

await pruefe('ein falsches Geheimnis genuegt nicht', async () => {
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { [ZUGANG_KOPFZEILE]: erzeugeZugangsgeheimnis() },
  });
  assert.equal(antwort.statusCode, 401);
  await app.close();
});

await pruefe('auch ein Praefix des richtigen Geheimnisses nicht', async () => {
  // Der Vergleich laeuft ueber timingSafeEqual und prueft zuerst die Laenge.
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { [ZUGANG_KOPFZEILE]: GEHEIM.slice(0, -1) },
  });
  assert.equal(antwort.statusCode, 401);
  await app.close();
});

await pruefe('das Geheimnis geht auch als Abfrageparameter (fuer den WebSocket)', async () => {
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({ method: 'GET', url: `/accounts?zugang=${GEHEIM}` });
  assert.equal(antwort.statusCode, 200);
  await app.close();
});

await pruefe('auch schreibende Wege sind zu - nicht nur lesende', async () => {
  // Der schwerere Fall: der Angreifer braucht die Antwort gar nicht, ihm genuegt die
  // Wirkung. Mail im Namen des Nutzers zu versenden war so moeglich.
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({
    method: 'POST',
    url: '/accounts/1/send',
    payload: { to: ['angreifer@example.org'] },
  });
  assert.equal(antwort.statusCode, 401);
  await app.close();
});

console.log('\nDie Herkunft wird getrennt davon geprueft:');

await pruefe('eine fremde Herkunft wird abgewiesen, auch mit richtigem Geheimnis', async () => {
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { [ZUGANG_KOPFZEILE]: GEHEIM, origin: 'https://boese.example' },
  });
  assert.equal(antwort.statusCode, 403);
  await app.close();
});

await pruefe('die eigene Herkunft geht durch', async () => {
  const app = baueProbe(GEHEIM);
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { [ZUGANG_KOPFZEILE]: GEHEIM, origin: 'http://127.0.0.1:4000' },
  });
  assert.equal(antwort.statusCode, 200);
  await app.close();
});

await pruefe('der Riegel greift auch ohne gesetztes Geheimnis', async () => {
  // Im Entwicklungsbetrieb ist die Geheimnispruefung aus - die Herkunftspruefung nicht.
  const app = baueProbe(null);
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { origin: 'https://boese.example' },
  });
  assert.equal(antwort.statusCode, 403);
  await app.close();
});

console.log('\nWas ohne Geheimnis durchmuss:');

await pruefe('die Oberflaeche selbst - sie wird als Seite geladen', async () => {
  // Bei einer Navigation laesst sich keine Kopfzeile setzen. Ausgeliefert wird dabei
  // nur, was ohnehin im Installationspaket steht.
  const app = baueProbe(GEHEIM);
  assert.equal((await app.inject({ method: 'GET', url: '/' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/assets/haupt.js' })).statusCode, 200);
  await app.close();
});

console.log('\nOhne Geheimnis (Entwicklungsbetrieb):');

await pruefe('bleibt alles offen - sonst liesse sich nicht entwickeln', async () => {
  const app = baueProbe(null);
  assert.equal((await app.inject({ method: 'GET', url: '/accounts' })).statusCode, 200);
  await app.close();
});

console.log('\nDas Geheimnis selbst:');

await pruefe('ist lang genug und bei jedem Aufruf ein anderes', () => {
  const a = erzeugeZugangsgeheimnis();
  const b = erzeugeZugangsgeheimnis();
  assert.equal(a.length, 64, '32 Byte als Hex');
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]+$/);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
