import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/*
 * Der Anmeldeweg ueber HTTP - so, wie ihn ein Browser geht.
 *
 * Die Pruefungen daneben nehmen die Bausteine einzeln. Hier laufen sie zusammen: Keks,
 * Zugangsriegel, Nutzerkontext und Routen. Genau an solchen Nahtstellen sitzen die
 * Fehler, die einzeln geprueften Teilen entgehen - etwa eine Route, die ohne Anmeldung
 * antwortet, weil der Haken sie versehentlich durchlaesst.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-anmeldeweg-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const { legeNutzerAn } = await import('./nutzerStore.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { KEKS_NAME } = await import('./anmelden.js');
const { buildServer } = await import('../app.js');

legeNutzerAn(
  { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  verpackeNutzerschluessel,
);

/*
 * Kein nutzerErmitteln uebergeben: der Server soll genau den Weg gehen, den er im
 * Serverbetrieb geht - Sitzung aus dem Keks. Ein Zugangsgeheimnis ist nicht gesetzt,
 * also greift der Huellen-Weg nicht.
 */
const app = await buildServer();

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

/** Holt den Sitzungskeks aus einer Antwort. */
function keksAus(antwort: { cookies: unknown[] }): string | undefined {
  const kekse = antwort.cookies as { name: string; value: string }[];
  return kekse.find((k) => k.name === KEKS_NAME)?.value;
}

console.log('\nDie Oberflaeche selbst kommt ohne Anmeldung heraus:');

await pruefe('"/" wird ausgeliefert, nicht mit 401 abgewiesen', async () => {
  /*
   * Der Fehler, den erst das Starten der paketierten Anwendung zutage gebracht hat:
   * das Fenster laedt "/" als gewoehnliche Navigation und kann dabei weder eine
   * Kopfzeile setzen noch einen Keks mitgeben, den es noch gar nicht gibt. Der Server
   * antwortete mit 401, und das Fenster zeigte die JSON-Fehlermeldung statt des
   * Mailprogramms.
   *
   * 404 ist hier in Ordnung: in der Pruefung gibt es kein gebautes Frontend, das
   * ausgeliefert werden koennte. Es geht darum, dass NICHT 401 zurueckkommt.
   */
  const antwort = await app.inject({ method: 'GET', url: '/' });
  assert.notEqual(antwort.statusCode, 401, 'die Oberflaeche wurde abgewiesen');
  assert.notEqual(antwort.statusCode, 403);
});

await pruefe('und ihre Bestandteile ebenso', async () => {
  for (const pfad of ['/index.html', '/assets/haupt.js', '/thema-vorab.js', '/favicon.ico']) {
    const antwort = await app.inject({ method: 'GET', url: pfad });
    assert.notEqual(antwort.statusCode, 401, `${pfad} wurde abgewiesen`);
  }
});

console.log('\nOhne Anmeldung kommt niemand an Postfachdaten:');

await pruefe('/accounts wird abgewiesen', async () => {
  const antwort = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(antwort.statusCode, 401);
  assert.ok(!antwort.body.includes('imapHost'));
});

await pruefe('auch schreibende Wege - die Wirkung genuegt dem Angreifer', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/accounts/irgendwas/send',
    payload: { to: ['opfer@beispiel.de'] },
  });
  assert.equal(antwort.statusCode, 401);
});

await pruefe('und die Sicherung, die das ganze Adressbuch herausgibt', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/sicherung' })).statusCode, 401);
});

await pruefe('ein erfundener Keks hilft nicht', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    cookies: { [KEKS_NAME]: 'ausgedacht' },
  });
  assert.equal(antwort.statusCode, 401);
});

console.log('\nAnmelden:');

await pruefe('mit falschem Kennwort gibt es keinen Keks', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'falsch-und-lang' },
  });
  assert.equal(antwort.statusCode, 401);
  assert.equal(keksAus(antwort), undefined);
});

await pruefe('die Meldung verraet nicht, ob es die Adresse gibt', async () => {
  const bekannt = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'falsch-und-lang' },
  });
  const unbekannt = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'gibtsnicht@beispiel.de', kennwort: 'falsch-und-lang' },
  });
  assert.equal(bekannt.body, unbekannt.body);
});

let keks = '';

await pruefe('mit richtigem Kennwort kommt ein Keks', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  });
  assert.equal(antwort.statusCode, 200);
  keks = keksAus(antwort) ?? '';
  assert.ok(keks, 'kein Sitzungskeks in der Antwort');
});

await pruefe('der Keks ist fuer Skript unerreichbar und nicht seitenuebergreifend', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  });
  const gesetzt = (antwort.cookies as { name: string; httpOnly?: boolean; sameSite?: string }[]).find(
    (k) => k.name === KEKS_NAME,
  );
  assert.equal(gesetzt?.httpOnly, true, 'ohne httpOnly liest ihn jedes Skript aus');
  assert.equal(
    String(gesetzt?.sameSite).toLowerCase(),
    'strict',
    'ohne Strict schickt der Browser ihn bei fremden Anfragen mit',
  );
});

await pruefe('das Kennwort steht nicht in der Antwort', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  });
  assert.ok(!antwort.body.includes('ein-langes-kennwort'));
  assert.ok(!antwort.body.includes('scrypt'), 'auch nicht die Pruefsumme');
});

console.log('\nMit Keks:');

await pruefe('/accounts antwortet', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.equal(antwort.statusCode, 200);
  assert.deepEqual(JSON.parse(antwort.body), [], 'Anna hat noch kein Konto');
});

await pruefe('/ich nennt den angemeldeten Nutzer', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/ich',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.deepEqual(JSON.parse(antwort.body), { angemeldet: true, nutzer: { id: 'anna' } });
});

await pruefe('/ich ohne Keks sagt "nicht angemeldet" statt 401', async () => {
  // Die Oberflaeche fragt beim Start danach und zeigt dann das Anmeldefenster - eine
  // Fehlermeldung waere hier das falsche Mittel.
  const antwort = await app.inject({ method: 'GET', url: '/ich' });
  assert.equal(antwort.statusCode, 200);
  assert.deepEqual(JSON.parse(antwort.body), { angemeldet: false });
});

console.log('\nAbmelden:');

await pruefe('danach gilt der Keks nicht mehr', async () => {
  const abgemeldet = await app.inject({
    method: 'POST',
    url: '/abmelden',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.equal(abgemeldet.statusCode, 200);

  const danach = await app.inject({
    method: 'GET',
    url: '/accounts',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.equal(danach.statusCode, 401, 'der Keks galt nach dem Abmelden weiter');
});

await app.close();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
