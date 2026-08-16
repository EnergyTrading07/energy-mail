import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir, getNutzerDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';
import { setKeyProvider } from './secretCrypto.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-schluessel-test-'));
setDataDir(tempDir);
// Die Pruefungen rufen die Speicher unmittelbar auf - ohne Anfrage, die den
// Nutzerkontext mitbraechte. Dieser Prozess arbeitet durchgehend als ein Nutzer.
betreteNutzerFuerProzess('pruefung');

// Die Speicher legen ihre Dateien im Ordner des Nutzers ab, nicht in der Wurzel.
const datenDir = getNutzerDir();
// Anlegen, bevor eine Pruefung hineinsieht - die Speicher taeten es erst beim Schreiben.
fs.mkdirSync(datenDir, { recursive: true });


// Ein fester Schluessel fuer die Probe - sonst laesst sich das Verschluesseln der
// geheimen Schluessel gar nicht pruefen.
const SCHLUESSEL = crypto.randomBytes(32);
setKeyProvider({ name: 'Probe', getKey: () => SCHLUESSEL });

const {
  alleOeffentlichen,
  alleSchluessel,
  entferneSchluessel,
  fuegeSchluesselHinzu,
  geheimeFuer,
  hatGeheimen,
  kennwortStimmt,
  oeffentlicheFuer,
  oeffentlicherText,
} = await import('./schluesselbund.js');
const { erzeugeSchluesselpaar } = await import('@energy-mail/mail-core');

let bestanden = 0;
let gescheitert = 0;

async function pruefe(name: string, fn: () => Promise<void>): Promise<void> {
  fs.rmSync(path.join(datenDir, 'schluesselbund.json'), { force: true });
  try {
    await fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

console.log('\nSchluessel erzeugen (dauert einen Augenblick):');
const anna = await erzeugeSchluesselpaar({ name: 'Anna Müller', adresse: 'anna@firma.de' });
const bernd = await erzeugeSchluesselpaar({
  name: 'Bernd Schmidt',
  adresse: 'bernd@firma.de',
  kennwort: 'geheim123',
});
console.log('  ok   zwei Paare bereit');

console.log('\nOeffentliche Schluessel:');

await pruefe('einen aufnehmen und wiederfinden', async () => {
  const { aufgenommen } = await fuegeSchluesselHinzu(anna.oeffentlich);
  assert.equal(aufgenommen.length, 1);
  assert.equal(aufgenommen[0]?.angaben.geheim, false);
  assert.equal(alleSchluessel().length, 1);
  assert.equal(oeffentlicheFuer('anna@firma.de').length, 1);
});

await pruefe('die Suche nach der Adresse ist nicht schreibungsempfindlich', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  assert.equal(oeffentlicheFuer('ANNA@Firma.DE').length, 1);
  assert.equal(oeffentlicheFuer('  anna@firma.de  ').length, 1);
});

await pruefe('eine fremde Adresse findet nichts', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  assert.equal(oeffentlicheFuer('mallory@woanders.de').length, 0);
});

await pruefe('derselbe Schluessel zweimal ersetzt, statt zu verdoppeln', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  const zweitens = await fuegeSchluesselHinzu(anna.oeffentlich);
  assert.equal(zweitens.ersetzt, 1);
  assert.equal(alleSchluessel().length, 1);
});

await pruefe('der oeffentliche Text laesst sich herausgeben', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  const text = oeffentlicherText(anna.angaben.fingerabdruck);
  assert.ok(text?.includes('BEGIN PGP PUBLIC KEY BLOCK'));
  assert.ok(!text?.includes('PRIVATE'), 'ein geheimer Teil ist mit herausgegangen!');
});

await pruefe('entfernen nimmt ihn heraus', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  assert.equal(entferneSchluessel(anna.angaben.fingerabdruck, false), true);
  assert.equal(alleSchluessel().length, 0);
  assert.equal(entferneSchluessel(anna.angaben.fingerabdruck, false), false);
});

console.log('\nGeheime Schluessel - hier zaehlt jedes Detail:');

await pruefe('ein geheimer Schluessel liegt NICHT im Klartext auf der Platte', async () => {
  // Der wichtigste Punkt des ganzen Moduls.
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  const roh = fs.readFileSync(path.join(datenDir, 'schluesselbund.json'), 'utf-8');
  assert.ok(
    !roh.includes('BEGIN PGP PRIVATE KEY BLOCK'),
    'der geheime Schluessel steht im Klartext in der Datei!',
  );
  assert.ok(roh.includes('"verschluesselt": true'));
});

await pruefe('er laesst sich trotzdem wieder herausholen', async () => {
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  const geheime = geheimeFuer('konto1', []);
  assert.equal(geheime.length, 1);
  assert.ok(geheime[0]?.includes('BEGIN PGP PRIVATE KEY BLOCK'));
});

await pruefe('ein anderes Konto bekommt ihn nicht ueber die Kontokennung', async () => {
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  assert.equal(geheimeFuer('konto2', []).length, 0);
});

await pruefe('ueber die Adresse findet ihn das passende Konto doch', async () => {
  // Wer denselben Schluessel fuer mehrere Konten nutzt, soll ihn nicht mehrfach anlegen.
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  assert.equal(geheimeFuer('konto2', ['bernd@firma.de']).length, 1);
  assert.equal(geheimeFuer('konto2', ['jemand@anders.de']).length, 0);
});

await pruefe('hatGeheimen sagt die Wahrheit', async () => {
  assert.equal(hatGeheimen('konto1', ['bernd@firma.de']), false);
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  assert.equal(hatGeheimen('konto1', []), true);
});

await pruefe('das Kennwort wird nirgends abgelegt', async () => {
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  const roh = fs.readFileSync(path.join(datenDir, 'schluesselbund.json'), 'utf-8');
  assert.ok(!roh.includes('geheim123'), 'das Kennwort steht in der Datei!');
});

await pruefe('ein Kennwort laesst sich pruefen, ohne es zu speichern', async () => {
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  assert.equal(await kennwortStimmt('konto1', [], 'geheim123'), true);
  assert.equal(await kennwortStimmt('konto1', [], 'falsch'), false);
});

await pruefe('der geheime Teil verlaesst die Auflistung nie', async () => {
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  const alsText = JSON.stringify(alleSchluessel());
  assert.ok(!alsText.includes('PRIVATE'), 'der geheime Schluessel steht in der Auflistung!');
  assert.ok(!alsText.includes('armored'), 'der Schluesseltext steht in der Auflistung!');
  // Die Angaben selbst schon - sonst waere die Liste nutzlos.
  assert.ok(alsText.includes(bernd.angaben.fingerabdruck));
});

await pruefe('geheim und oeffentlich desselben Paares stehen nebeneinander', async () => {
  // Sie haben denselben Fingerabdruck - ohne die Unterscheidung wuerde einer den
  // anderen ueberschreiben, und man verloere entweder das Lesen oder das Weitergeben.
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  await fuegeSchluesselHinzu(bernd.oeffentlich);
  assert.equal(alleSchluessel().length, 2);
  assert.equal(geheimeFuer('konto1', []).length, 1);
  assert.equal(oeffentlicheFuer('bernd@firma.de').length, 1);
});

await pruefe('das Entfernen trifft nur die gemeinte Haelfte', async () => {
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  await fuegeSchluesselHinzu(bernd.oeffentlich);
  entferneSchluessel(bernd.angaben.fingerabdruck, true);
  assert.equal(geheimeFuer('konto1', []).length, 0);
  assert.equal(oeffentlicheFuer('bernd@firma.de').length, 1, 'der oeffentliche ging mit');
});

console.log('\nDer Bund als Ganzes:');

await pruefe('alleOeffentlichen liefert nur oeffentliche', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  const alle = alleOeffentlichen();
  assert.equal(alle.length, 1);
  assert.ok(alle.every((s) => !s.angaben.geheim));
});

await pruefe('eigene stehen in der Liste oben', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  await fuegeSchluesselHinzu(bernd.geheim, 'konto1');
  assert.equal(alleSchluessel()[0]?.angaben.geheim, true);
});

await pruefe('der Stand ueberdauert einen Neustart', async () => {
  await fuegeSchluesselHinzu(anna.oeffentlich);
  const wieder = JSON.parse(fs.readFileSync(path.join(datenDir, 'schluesselbund.json'), 'utf-8'));
  assert.equal(wieder.schluessel.length, 1);
});

await pruefe('eine beschaedigte Datei ergibt einen leeren Bund, keinen Absturz', async () => {
  fs.writeFileSync(path.join(datenDir, 'schluesselbund.json'), '{kaputt', 'utf-8');
  assert.deepEqual(alleSchluessel(), []);
});

await pruefe('was kein Schluessel ist, wird abgewiesen', async () => {
  await assert.rejects(() => fuegeSchluesselHinzu('Guten Tag, anbei der Vertrag.'));
  assert.equal(alleSchluessel().length, 0);
});

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Pruefungen bestanden`);
if (gescheitert > 0) process.exit(1);
