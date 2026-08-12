import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  baueUnterlage,
  schluesselHinterlegt,
  sha512VonDatei,
  unterschriftStimmt,
  OEFFENTLICHER_SCHLUESSEL,
} from './updateSignatur.js';

/*
 * Die Unterschrift unter einer Aktualisierung.
 *
 * Das ist die Pruefung, die verhindert, dass ein uebernommener GitHub-Zugang genuegt, um
 * Schadcode auf jeden Rechner zu bringen, auf dem Energy Mail laeuft. Ein Fehlschlag hier
 * heisst nicht "eine Kleinigkeit stimmt nicht", sondern "die Selbstaktualisierung nimmt
 * an, was ihr vorgesetzt wird" - oder, andersherum, "sie nimmt gar nichts mehr an".
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-freigabe-test-'));
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

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

/** Ein Schluesselpaar wie das aus scripts/schluessel-erzeugen.mjs. */
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const oeffentlich = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

/** Unterschreibt wie scripts/freigeben.mjs es tut. */
function unterschreibe(version: string, sha512: string, schluessel = privateKey): string {
  return crypto.sign(null, baueUnterlage(version, sha512), schluessel).toString('base64');
}

console.log('\nEine gueltige Unterschrift:');

await pruefe('wird angenommen', () => {
  const sha = 'a'.repeat(128);
  assert.equal(unterschriftStimmt('0.3.0', sha, unterschreibe('0.3.0', sha), oeffentlich), true);
});

await pruefe('Grossschreibung der Pruefsumme stoert nicht', () => {
  // Die latest.yml und unsere eigene Rechnung koennen sich in der Schreibweise
  // unterscheiden; an einem Buchstaben soll keine Freigabe scheitern.
  const sha = 'ABCDEF'.repeat(21) + 'ab';
  const sig = unterschreibe('0.3.0', sha.toLowerCase());
  assert.equal(unterschriftStimmt('0.3.0', sha, sig, oeffentlich), true);
});

console.log('\nWas abgewiesen werden muss:');

await pruefe('eine andere Datei - selbe Fassung, andere Pruefsumme', () => {
  /*
   * Der Hauptfall: jemand tauscht in der Veroeffentlichung die .exe aus und laesst die
   * Unterschrift stehen. Sie bezieht sich auf die Pruefsumme, also passt sie nicht mehr.
   */
  const echt = 'a'.repeat(128);
  const untergeschoben = 'b'.repeat(128);
  const sig = unterschreibe('0.3.0', echt);
  assert.equal(unterschriftStimmt('0.3.0', untergeschoben, sig, oeffentlich), false);
});

await pruefe('eine wiederverwendete Unterschrift aus einer anderen Fassung', () => {
  /*
   * Deshalb steht die Fassung mit in der Unterlage. Ohne sie liesse sich eine gueltige
   * Unterschrift von frueher fuer eine andere Fassung derselben Datei einsetzen.
   */
  const sha = 'a'.repeat(128);
  const sig = unterschreibe('0.2.9', sha);
  assert.equal(unterschriftStimmt('0.3.0', sha, sig, oeffentlich), false);
});

await pruefe('ein fremder Schluessel', () => {
  // Der Fall, um den es eigentlich geht: wer den GitHub-Zugang hat, aber nicht den
  // Schluessel, kann keine gueltige Freigabe erzeugen.
  const fremd = crypto.generateKeyPairSync('ed25519');
  const sha = 'a'.repeat(128);
  const sig = unterschreibe('0.3.0', sha, fremd.privateKey);
  assert.equal(unterschriftStimmt('0.3.0', sha, sig, oeffentlich), false);
});

await pruefe('Unfug statt einer Unterschrift', () => {
  const sha = 'a'.repeat(128);
  for (const unfug of ['', 'nicht base64!!', Buffer.from('zu kurz').toString('base64')]) {
    assert.equal(unterschriftStimmt('0.3.0', sha, unfug, oeffentlich), false, `durch: ${unfug}`);
  }
});

await pruefe('ein unbrauchbarer oeffentlicher Schluessel wirft nicht, sondern lehnt ab', () => {
  const sha = 'a'.repeat(128);
  const sig = unterschreibe('0.3.0', sha);
  assert.equal(unterschriftStimmt('0.3.0', sha, sig, 'kein schluessel'), false);
});

console.log('\nDie Pruefsumme:');

await pruefe('sha512VonDatei rechnet dasselbe wie crypto.createHash', async () => {
  const datei = path.join(tempDir, 'probe.bin');
  const inhalt = crypto.randomBytes(200_000);
  fs.writeFileSync(datei, inhalt);
  const erwartet = crypto.createHash('sha512').update(inhalt).digest('hex');
  assert.equal(await sha512VonDatei(datei), erwartet);
});

console.log('\nBeide Seiten muessen dieselbe Unterlage bilden:');

await pruefe('das Freigabeskript und die Anwendung sind buchstabengleich', () => {
  /*
   * scripts/freigeben.mjs kann updateSignatur.ts nicht einbinden - das eine ist ein
   * gewoehnliches Skript, das andere uebersetztes TypeScript aus dem desktop-Paket. Die
   * Funktion steht deshalb zweimal da. Laufen die beiden Fassungen auseinander, ergibt
   * jede Freigabe eine Unterschrift, die keine Anwendung annimmt - und das faellt sonst
   * erst beim Nutzer auf, nach der Veroeffentlichung.
   *
   * Also wird hier der Quelltext des Skripts gelesen und die Funktion daraus gegen die
   * echte gehalten.
   */
  const skript = fs.readFileSync(
    path.join(import.meta.dirname, '..', '..', '..', 'scripts', 'freigeben.mjs'),
    'utf-8',
  );
  const treffer = skript.match(/return Buffer\.from\(\s*(`[^`]*`)\s*,\s*'utf-8'\s*\)/);
  assert.ok(treffer, 'baueUnterlage() im Freigabeskript nicht gefunden - wurde es umbenannt?');

  // Die Vorlage aus dem Skript mit denselben Werten ausfuellen wie die echte Funktion.
  const ausSkript = new Function(
    'version',
    'sha512',
    `return ${treffer[1].replace(/sha512\.toLowerCase\(\)/g, 'sha512.toLowerCase()')};`,
  )('0.3.0', 'AbC'.repeat(42) + 'de');

  const ausAnwendung = baueUnterlage('0.3.0', 'AbC'.repeat(42) + 'de').toString('utf-8');
  assert.equal(ausSkript, ausAnwendung, 'Skript und Anwendung bilden verschiedene Unterlagen');
});

console.log('\nDer hinterlegte Schluessel:');

await pruefe('schluesselHinterlegt() erkennt den Platzhalter', () => {
  /*
   * Solange kein Schluessel erzeugt wurde, steht ein Platzhalter im Programmtext. Die
   * Huelle darf dann NICHT jede Aktualisierung abweisen - das schaltete die
   * Selbstaktualisierung ganz ab, wegen einer fehlenden Einrichtung. Sie protokolliert
   * stattdessen laut. Diese Pruefung haelt fest, dass die Unterscheidung funktioniert.
   */
  assert.equal(typeof schluesselHinterlegt(), 'boolean');
  assert.equal(OEFFENTLICHER_SCHLUESSEL.includes('PLATZHALTER'), !schluesselHinterlegt());
});

await pruefe('ein eingetragener Schluessel ist ein brauchbarer Ed25519-Schluessel', () => {
  // Greift erst, sobald ein echter eingetragen ist - vorher gibt es nichts zu pruefen.
  if (!schluesselHinterlegt()) {
    console.log('       (uebersprungen: noch kein Schluessel eingetragen)');
    return;
  }
  const geladen = crypto.createPublicKey({
    key: Buffer.from(OEFFENTLICHER_SCHLUESSEL, 'base64'),
    format: 'der',
    type: 'spki',
  });
  assert.equal(geladen.asymmetricKeyType, 'ed25519');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
