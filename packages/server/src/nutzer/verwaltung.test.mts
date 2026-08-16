import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/**
 * Rollen und die Verwaltung im Browser.
 *
 * Die Frage, an der hier alles haengt: Kommt ein gewoehnlicher Nutzer an die
 * Verwaltungswege? Eine Oberflaeche, die einen Knopf versteckt, hat nichts verboten -
 * geprueft wird deshalb der Weg selbst, mit einer Anmeldung als einfacher Nutzer.
 *
 * Und die zweite: Laesst sich der letzte Verwalter abraeumen? Danach koennte niemand mehr
 * Nutzer anlegen oder Rollen vergeben, und der Dienst waere nur noch ueber die
 * Befehlszeile auf dem Server zu retten.
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

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-verwaltung-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const {
  legeNutzerAn,
  setzeRolle,
  istVerwalter,
  alleNutzer,
  stelleVerwalterSicher,
  findeNutzer,
  setzeSperre,
  entferneNutzer,
} = await import('./nutzerStore.js');
const { richteUmschlagEin } = await import('./einrichten.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { EINPLATZ_NUTZER } = await import('./kontext.js');

richteUmschlagEin();

const CHEF = { email: 'chef@beispiel.de', kennwort: 'Sieben Pflaumen im Krug' };
const ANNA = { email: 'anna@beispiel.de', kennwort: 'Acht Birnen im Korb' };

const chef = legeNutzerAn(CHEF, verpackeNutzerschluessel);
const anna = legeNutzerAn(ANNA, verpackeNutzerschluessel);
setzeRolle(chef.id, true);

const { buildServer } = await import('../app.js');
const app = await buildServer({});

async function anmelden(wer: { email: string; kennwort: string }): Promise<string> {
  const antwort = await app.inject({ method: 'POST', url: '/anmelden', payload: wer });
  assert.equal(antwort.statusCode, 200, `Anmeldung ergab ${antwort.statusCode}`);
  return antwort.cookies.find((c) => c.name === 'energy_mail_sitzung')!.value;
}
const mitKeks = (keks: string) => ({ cookie: `energy_mail_sitzung=${keks}` });

const keksChef = await anmelden(CHEF);
const keksAnna = await anmelden(ANNA);

console.log('\nDer Riegel:');

await pruefe('der Verwalter kommt an die Nutzerliste', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/verwaltung/nutzer',
    headers: mitKeks(keksChef),
  });
  assert.equal(antwort.statusCode, 200);
  assert.ok(antwort.json().nutzer.length >= 2);
});

await pruefe('ein gewoehnlicher Nutzer nicht - und zwar auf JEDEM Weg', async () => {
  /*
   * Alle vier Verben, nicht nur das Lesen. Ein Riegel, der nur GET abfaengt, ist keiner:
   * Die Wirkung genuegt dem Angreifer, die Antwort braucht er nicht.
   */
  const wege = [
    { method: 'GET' as const, url: '/verwaltung/nutzer' },
    { method: 'POST' as const, url: '/verwaltung/nutzer', payload: { email: 'x@y.de' } },
    { method: 'PATCH' as const, url: `/verwaltung/nutzer/${chef.id}`, payload: { verwalter: false } },
    { method: 'DELETE' as const, url: `/verwaltung/nutzer/${chef.id}` },
    { method: 'POST' as const, url: `/verwaltung/nutzer/${chef.id}/sperren`, payload: {} },
  ];
  for (const weg of wege) {
    const antwort = await app.inject({ ...weg, headers: mitKeks(keksAnna) });
    assert.equal(antwort.statusCode, 403, `${weg.method} ${weg.url} ergab ${antwort.statusCode}`);
  }
  // Und der Verwalter ist danach immer noch Verwalter.
  assert.equal(istVerwalter(chef.id), true);
});

await pruefe('ohne Anmeldung erst recht nicht', async () => {
  const antwort = await app.inject({ method: 'GET', url: '/verwaltung/nutzer' });
  // 401 vom Nutzerkontext, nicht 403 - hier ist noch gar niemand.
  assert.equal(antwort.statusCode, 401);
});

console.log('\nWas ein Verwalter tun kann:');

await pruefe('einen Nutzer anlegen - mit einem Kennwort, das genau einmal erscheint', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/verwaltung/nutzer',
    headers: mitKeks(keksChef),
    payload: { email: 'neu@beispiel.de' },
  });
  assert.equal(antwort.statusCode, 200);
  const { nutzer, kennwort } = antwort.json();
  assert.equal(nutzer.email, 'neu@beispiel.de');
  assert.ok(kennwort.length >= 16, 'Das Kennwort ist zu kurz.');
  // Es steht nirgends sonst: der Eintrag traegt nur die Pruefsumme.
  assert.ok(!JSON.stringify(findeNutzer(nutzer.id)).includes(kennwort));
});

await pruefe('ein Kennwort zuruecksetzen', async () => {
  const antwort = await app.inject({
    method: 'PATCH',
    url: `/verwaltung/nutzer/${anna.id}`,
    headers: mitKeks(keksChef),
    payload: { kennwortZuruecksetzen: true },
  });
  assert.equal(antwort.statusCode, 200);
  assert.ok(antwort.json().kennwort);
  // Und die alte Anmeldung gilt nicht mehr - sonst waere das Zuruecksetzen wirkungslos.
  const alt = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: mitKeks(keksAnna),
  });
  assert.equal(alt.statusCode, 401);
});

await pruefe('sperren beendet die offenen Sitzungen', async () => {
  const keks = await anmelden({ email: ANNA.email, kennwort: ANNA.kennwort }).catch(() => null);
  // Annas Kennwort wurde eben zurueckgesetzt - sie kommt mit dem alten nicht mehr herein.
  assert.equal(keks, null);
});

console.log('\nDer letzte Verwalter:');

await pruefe('laesst sich nicht absetzen', async () => {
  const antwort = await app.inject({
    method: 'PATCH',
    url: `/verwaltung/nutzer/${chef.id}`,
    headers: mitKeks(keksChef),
    // Ueber sich selbst geht es ohnehin nicht - deshalb prueft das hier der Speicher.
    payload: { verwalter: false },
  });
  assert.equal(antwort.statusCode, 400);
  assert.equal(istVerwalter(chef.id), true);
});

await pruefe('laesst sich nicht entfernen und nicht sperren', () => {
  assert.throws(() => setzeSperre(chef.id, true));
  assert.throws(() => entferneNutzer(chef.id));
  assert.equal(istVerwalter(chef.id), true);
});

await pruefe('mit einem zweiten Verwalter geht beides', async () => {
  const zweiter = legeNutzerAn(
    { email: 'zweiter@beispiel.de', kennwort: 'Neun Nuesse im Sack' },
    verpackeNutzerschluessel,
  );
  setzeRolle(zweiter.id, true);
  setzeRolle(chef.id, false);
  assert.equal(istVerwalter(chef.id), false);
  // Und wieder zurueck, damit die naechsten Pruefungen einen Verwalter haben.
  setzeRolle(chef.id, true);
  setzeRolle(zweiter.id, false);
});

console.log('\nAn sich selbst:');

await pruefe('kein Sperren und kein Entfernen der eigenen Kennung', async () => {
  for (const [method, payload] of [
    ['PATCH', { gesperrt: true }],
    ['DELETE', undefined],
  ] as const) {
    const antwort = await app.inject({
      method,
      url: `/verwaltung/nutzer/${chef.id}`,
      headers: mitKeks(keksChef),
      payload,
    });
    assert.equal(antwort.statusCode, 400, `${method} ergab ${antwort.statusCode}`);
  }
});

console.log('\nDie Rolle beim Start:');

await pruefe('der Pseudo-Nutzer der Huelle wird NIE Verwalter', () => {
  /*
   * Er ist der zuerst angelegte Eintrag und waere damit der naheliegende Kandidat. Sein
   * Kennwort sind zufaellige Bytes, die niemand je sieht - er als Verwalter hiesse: Die
   * Verwaltung gehoert einem Konto, an das niemand herankommt.
   */
  assert.equal(istVerwalter(EINPLATZ_NUTZER), false);
});

await pruefe('/ich meldet die Rolle', async () => {
  const alsChef = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(keksChef) });
  assert.equal(alsChef.json().verwalter, true);

  const neuAnna = await anmelden({
    email: ANNA.email,
    kennwort: (
      await app
        .inject({
          method: 'PATCH',
          url: `/verwaltung/nutzer/${anna.id}`,
          headers: mitKeks(keksChef),
          payload: { kennwortZuruecksetzen: true },
        })
        .then((a) => a.json())
    ).kennwort as string,
  });
  const alsAnna = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(neuAnna) });
  assert.equal(alsAnna.json().verwalter, false);
});

await pruefe('ohne jeden Verwalter wird der zuerst Angelegte ernannt', () => {
  // Der Fall einer bestehenden Aufstellung: In deren nutzer.json steht keine Rolle.
  for (const n of alleNutzer()) if (n.verwalter && n.id !== chef.id) setzeRolle(n.id, false);
  // Den letzten kann setzeRolle nicht nehmen - deshalb von Hand aus der Datei.
  const pfad = path.join(ORDNER, 'nutzer.json');
  const roh = JSON.parse(fs.readFileSync(pfad, 'utf-8'));
  for (const n of roh.nutzer) delete n.rolle;
  fs.writeFileSync(pfad, JSON.stringify(roh, null, 2), 'utf-8');

  stelleVerwalterSicher(EINPLATZ_NUTZER);
  const verwalter = alleNutzer().filter((n) => n.verwalter);
  assert.equal(verwalter.length, 1);
  assert.equal(verwalter[0]!.id, chef.id, 'Nicht der zuerst angelegte Nutzer.');
});

await app.close();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
