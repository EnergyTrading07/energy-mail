import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/**
 * Der zweite Faktor - am fertigen Weg, nicht an der Rechnung.
 *
 * Dass TOTP richtig rechnet, steht in totp.test.mts und haengt an den Zahlen aus dem RFC.
 * Hier geht es um die andere Haelfte, und die ist die gefaehrlichere: Ein Verfahren, das
 * stimmt, aber an der falschen Stelle eingehaengt ist, sieht von aussen genauso aus wie
 * eines, das schuetzt.
 *
 * Die Fragen, die diese Datei beantwortet:
 *
 *  - Entsteht beim ersten Schritt wirklich KEINE Sitzung? Eine Anmeldung, die schon nach
 *    dem Kennwort einen gueltigen Keks setzt, hat den zweiten Faktor zur Verzierung
 *    gemacht - und man sieht es der Oberflaeche nicht an, denn die fragt brav nach dem Code.
 *  - Laesst sich derselbe Code zweimal einloesen?
 *  - Kommt man mit der Zwischenmarke irgendwo anders hin?
 *  - Steht das Geheimnis verschluesselt in nutzer.json?
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

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-zweifaktor-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 9) });

const { legeNutzerAn, setzeRolle, hatZweiFaktor, liesZweiFaktor } = await import('./nutzerStore.js');
const { richteUmschlagEin } = await import('./einrichten.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { totp } = await import('./totp.js');
const { vergissBremse } = await import('./anmeldebremse.js');

richteUmschlagEin();

const CHEF = { email: 'chef@beispiel.de', kennwort: 'Sieben Pflaumen im Krug' };
const ANNA = { email: 'anna@beispiel.de', kennwort: 'Acht Birnen im Korb' };

const chef = legeNutzerAn(CHEF, verpackeNutzerschluessel);
const anna = legeNutzerAn(ANNA, verpackeNutzerschluessel);
setzeRolle(chef.id, true);

const { buildServer } = await import('../app.js');
const app = await buildServer({});

const KEKS = 'energy_mail_sitzung';
const mitKeks = (keks: string) => ({ cookie: `${KEKS}=${keks}` });

/**
 * Die Anmeldebremse zwischendurch leeren.
 *
 * Diese Datei probiert absichtlich falsche Kennwoerter und falsche Codes durch - mehr als
 * zehn in einer Viertelstunde, und die Bremse greift. Sie tut damit genau das Richtige;
 * nur wuerde die naechste Pruefung dann 429 statt der Antwort bekommen, die sie erwartet,
 * und man suchte den Fehler an der falschen Stelle.
 */
function bremseLoesen(): void {
  for (const datei of fs.readdirSync(ORDNER)) {
    if (datei.startsWith('anmeldebremse.json')) fs.rmSync(path.join(ORDNER, datei), { force: true });
  }
  vergissBremse();
}

async function anmelden(wer: { email: string; kennwort: string }) {
  return app.inject({ method: 'POST', url: '/anmelden', payload: wer });
}

/** Anmelden ohne zweiten Faktor - liefert den Keks. */
async function keksVon(wer: { email: string; kennwort: string }): Promise<string> {
  const antwort = await anmelden(wer);
  assert.equal(antwort.statusCode, 200, `Anmeldung ergab ${antwort.statusCode}`);
  const keks = antwort.cookies.find((c) => c.name === KEKS);
  assert.ok(keks, 'Es kam kein Keks zurueck.');
  return keks.value;
}

console.log('\nVorher - ohne zweiten Faktor:');

const keksAnna = await keksVon(ANNA);

await pruefe('die Anmeldung setzt einen Keks und /ich sagt "kein zweiter Faktor"', async () => {
  const antwort = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(keksAnna) });
  assert.equal(antwort.json().angemeldet, true);
  assert.equal(antwort.json().zweiFaktor, false);
  assert.equal(antwort.json().codesUebrig, 0);
});

console.log('\nEinrichten:');

let geheimnis = '';

await pruefe('das Beginnen liefert Geheimnis, Weg und ein QR-Bild', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/ich/zweifaktor/beginnen',
    headers: mitKeks(keksAnna),
    payload: {},
  });
  assert.equal(antwort.statusCode, 200);
  const koerper = antwort.json();
  geheimnis = koerper.geheimnis;
  assert.match(koerper.geheimnis, /^[A-Z2-7]{4}( [A-Z2-7]{4}){7}$/, 'Geheimnis in Vierergruppen');
  assert.match(koerper.weg, /^otpauth:\/\/totp\/Energy%20Mail:anna%40beispiel\.de\?secret=/);
  assert.equal(typeof koerper.qr.groesse, 'number');
  assert.equal(koerper.qr.zeilen.length, koerper.qr.groesse);
});

await pruefe('gespeichert ist dabei noch nichts', async () => {
  /*
   * Der Punkt, an dem sich jemand aussperren koennte: Waere das Geheimnis schon gueltig,
   * bevor der Nutzer einen Code daraus vorgezeigt hat, dann waere ein missglueckter Scan
   * gleichbedeutend mit einem verlorenen Konto.
   */
  assert.equal(hatZweiFaktor(anna.id), false);
  const antwort = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(keksAnna) });
  assert.equal(antwort.json().zweiFaktor, false);
});

await pruefe('ohne richtiges Kennwort wird nicht bestaetigt', async () => {
  // Sonst richtet ein Voruebergehender an einem unbeaufsichtigten Bildschirm den zweiten
  // Faktor auf sein eigenes Telefon ein und sperrt den rechtmaessigen Nutzer aus.
  const antwort = await app.inject({
    method: 'POST',
    url: '/ich/zweifaktor/bestaetigen',
    headers: mitKeks(keksAnna),
    payload: { kennwort: 'falsch falsch falsch', code: totp(geheimnis) },
  });
  assert.equal(antwort.statusCode, 401);
  assert.equal(hatZweiFaktor(anna.id), false);
});

await pruefe('mit falschem Code auch nicht', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/ich/zweifaktor/bestaetigen',
    headers: mitKeks(keksAnna),
    payload: { kennwort: ANNA.kennwort, code: '000000' },
  });
  assert.equal(antwort.statusCode, 400);
  assert.equal(hatZweiFaktor(anna.id), false);
});

let codes: string[] = [];

await pruefe('mit beidem schon - und die Wiederherstellungscodes kommen einmal heraus', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/ich/zweifaktor/bestaetigen',
    headers: mitKeks(keksAnna),
    payload: { kennwort: ANNA.kennwort, code: totp(geheimnis) },
  });
  assert.equal(antwort.statusCode, 200, antwort.body);
  codes = antwort.json().codes;
  assert.equal(codes.length, 10);
  for (const code of codes) assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/, code);
  assert.equal(hatZweiFaktor(anna.id), true);
});

await pruefe('das Geheimnis steht verschluesselt in nutzer.json - nicht im Klartext', async () => {
  /*
   * Anders als ein Kennwort laesst sich ein TOTP-Geheimnis nicht als Pruefsumme ablegen:
   * Der Server muss den Code selbst ausrechnen. Damit ist die Verschluesselung das
   * Einzige, was zwischen einer abhandengekommenen nutzer.json und einem Angreifer steht,
   * der jeden Code erzeugen kann, den die App des Nutzers anzeigt.
   */
  const roh = fs.readFileSync(path.join(ORDNER, 'nutzer.json'), 'utf8');
  const blank = geheimnis.replace(/ /g, '');
  assert.ok(!roh.includes(blank), 'Das Geheimnis steht im Klartext in der Datei.');
  assert.ok(!roh.includes(geheimnis), 'Das Geheimnis steht lesbar in der Datei.');
  for (const code of codes) {
    assert.ok(!roh.includes(code), `Der Wiederherstellungscode ${code} steht im Klartext da.`);
  }
  assert.match(liesZweiFaktor(anna.id)!.geheimnis, /^v1\./, 'Kein verschluesseltes Format.');
});

console.log('\nAnmelden mit zweitem Faktor:');

let marke = '';

await pruefe('das Kennwort allein eroeffnet KEINE Sitzung mehr', async () => {
  /*
   * Die wichtigste Pruefung dieser Datei. Wenn hier ein Keks zurueckkaeme, waere der
   * zweite Faktor eine Abfrage in der Oberflaeche und sonst nichts - wer sie mit einem
   * eigenen Abruf uebergeht, waere drin.
   */
  const antwort = await anmelden(ANNA);
  assert.equal(antwort.statusCode, 200);
  assert.equal(antwort.json().zweiFaktor, true);
  assert.equal(
    antwort.cookies.find((c) => c.name === KEKS),
    undefined,
    'Es kam ein Sitzungskeks zurueck, obwohl der zweite Faktor noch fehlt.',
  );
  marke = antwort.json().marke;
  assert.ok(marke && marke.length > 20);
});

await pruefe('mit der Marke allein kommt man an keine Route', async () => {
  // Sie ist kein Keks und darf sich auch nicht wie einer verhalten - auch dann nicht, wenn
  // jemand sie als einen einsetzt.
  const antwort = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(marke) });
  assert.equal(antwort.json().angemeldet, false);
});

await pruefe('ein falscher Code ergibt 401 und keinen Keks', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke, code: '000000' },
  });
  assert.equal(antwort.statusCode, 401);
  assert.equal(antwort.cookies.find((c) => c.name === KEKS), undefined);
});

let keksMitFaktor = '';
let benutzterCode = '';

await pruefe('der richtige Code oeffnet die Sitzung', async () => {
  benutzterCode = totp(geheimnis);
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke, code: benutzterCode },
  });
  assert.equal(antwort.statusCode, 200, antwort.body);
  const keks = antwort.cookies.find((c) => c.name === KEKS);
  assert.ok(keks, 'Kein Keks nach richtigem Code.');
  keksMitFaktor = keks.value;

  const ich = await app.inject({ method: 'GET', url: '/ich', headers: mitKeks(keksMitFaktor) });
  assert.equal(ich.json().angemeldet, true);
  assert.equal(ich.json().zweiFaktor, true);
  assert.equal(ich.json().codesUebrig, 10);
});

await pruefe('die Marke ist danach verbraucht', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke, code: totp(geheimnis) },
  });
  assert.equal(antwort.statusCode, 401);
  assert.equal(antwort.json().neuAnmelden, true);
});

await pruefe('derselbe Code laesst sich kein zweites Mal einloesen', async () => {
  /*
   * Der Unterschied zwischen einem Einmalkennwort und einem Kennwort mit dreissig
   * Sekunden Haltbarkeit. Ohne diese Buchfuehrung koennte jeder, der dem Nutzer ueber die
   * Schulter geschaut hat, dessen Code in derselben halben Minute noch einmal benutzen.
   */
  bremseLoesen();
  const neu = await anmelden(ANNA);
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke: neu.json().marke, code: benutzterCode },
  });
  assert.equal(antwort.statusCode, 401);
  assert.match(antwort.json().error, /schon benutzt/);
  assert.equal(antwort.cookies.find((c) => c.name === KEKS), undefined);
});

console.log('\nWiederherstellungscodes:');

await pruefe('ein Wiederherstellungscode oeffnet die Sitzung ebenfalls', async () => {
  bremseLoesen();
  const neu = await anmelden(ANNA);
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke: neu.json().marke, code: codes[0] },
  });
  assert.equal(antwort.statusCode, 200, antwort.body);
  assert.ok(antwort.cookies.find((c) => c.name === KEKS));
  // Und der Nutzer erfaehrt gleich, wie viele er noch hat.
  assert.equal(antwort.json().wiederherstellung, 9);
});

await pruefe('derselbe Wiederherstellungscode ein zweites Mal nicht', async () => {
  bremseLoesen();
  const neu = await anmelden(ANNA);
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke: neu.json().marke, code: codes[0] },
  });
  assert.equal(antwort.statusCode, 401);
});

await pruefe('Schreibweise mit Kleinbuchstaben und ohne Strich geht auch', async () => {
  // Er wird von einem Zettel abgetippt. Wer daran scheitert, hat keinen Schutz gebaut,
  // sondern eine Falle.
  bremseLoesen();
  const neu = await anmelden(ANNA);
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke: neu.json().marke, code: codes[1]!.replace('-', '').toLowerCase() },
  });
  assert.equal(antwort.statusCode, 200, antwort.body);
});

await pruefe('ein frischer Satz macht die alten ungueltig', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/ich/zweifaktor/codes',
    headers: mitKeks(keksMitFaktor),
    payload: { kennwort: ANNA.kennwort },
  });
  assert.equal(antwort.statusCode, 200, antwort.body);
  const neueCodes: string[] = antwort.json().codes;
  assert.equal(neueCodes.length, 10);
  assert.equal(neueCodes.filter((c) => codes.includes(c)).length, 0);

  bremseLoesen();
  const anmeldung = await anmelden(ANNA);
  const alt = await app.inject({
    method: 'POST',
    url: '/anmelden/code',
    payload: { marke: anmeldung.json().marke, code: codes[2] },
  });
  assert.equal(alt.statusCode, 401, 'Ein alter Code galt noch.');
});

console.log('\nAbschalten und zuruecksetzen:');

await pruefe('ohne Kennwort geht das Abschalten nicht', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/ich/zweifaktor/aus',
    headers: mitKeks(keksMitFaktor),
    payload: { kennwort: 'irgendetwas anderes' },
  });
  assert.equal(antwort.statusCode, 401);
  assert.equal(hatZweiFaktor(anna.id), true);
});

await pruefe('ein Verwalter kann ihn entfernen - das verlorene Telefon', async () => {
  bremseLoesen();
  const keksChef = await keksVon(CHEF);
  const antwort = await app.inject({
    method: 'PATCH',
    url: `/verwaltung/nutzer/${anna.id}`,
    headers: mitKeks(keksChef),
    payload: { zweiFaktorEntfernen: true },
  });
  assert.equal(antwort.statusCode, 200, antwort.body);
  assert.equal(antwort.json().nutzer.zweiFaktor, false);
  assert.equal(hatZweiFaktor(anna.id), false);
});

await pruefe('danach geht die Anmeldung wieder mit dem Kennwort allein', async () => {
  bremseLoesen();
  const antwort = await anmelden(ANNA);
  assert.equal(antwort.statusCode, 200);
  assert.equal(antwort.json().zweiFaktor, undefined);
  assert.ok(antwort.cookies.find((c) => c.name === KEKS));
});

await pruefe('ein gewoehnlicher Nutzer kann fremde Faktoren nicht abraeumen', async () => {
  bremseLoesen();
  const keksAnna2 = await keksVon(ANNA);
  const antwort = await app.inject({
    method: 'PATCH',
    url: `/verwaltung/nutzer/${chef.id}`,
    headers: mitKeks(keksAnna2),
    payload: { zweiFaktorEntfernen: true },
  });
  assert.equal(antwort.statusCode, 403);
});

await app.close();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
