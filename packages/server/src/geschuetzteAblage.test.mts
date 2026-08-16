import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setKeyProvider } from './secretCrypto.js';
import { istVerschluesselt, liesGeschuetzt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { schreibeAtomar } from './atomar.js';

/*
 * Die Dateien, in denen Post steht.
 *
 * Bis zu dieser Umstellung galt eine Trennung, die DATENSCHUTZ.md offen benannte und die
 * trotzdem an der falschen Stelle lag: verschluesselt waren die Zugangsdaten, nicht das,
 * wofuer man sie braucht. contacts.json fuehrte Namen und Adressen aller
 * Korrespondenzpartner - von Menschen, die nie gefragt wurden -, sendungen.json den
 * vollen Text wartender Nachrichten. Wer den Benutzerordner kopierte, las alles davon.
 *
 * Zwei Dinge muessen zugleich gelten, und keines allein genuegt: es steht nicht mehr im
 * Klartext da, und es kommt unveraendert zurueck. Dazu ein dritter Fall, der ueber jede
 * Umstellung entscheidet - was mit dem vorhandenen Klartext geschieht.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-geschuetzt-'));
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

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

const SCHLUESSEL = { name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) };
const pfad = (name: string) => path.join(tempDir, name);

/** Ein Adressbuch, wie es wirklich aussieht. */
const ADRESSBUCH = {
  kontakte: [
    { address: 'dr.behrens@praxis-am-park.de', name: 'Dr. Behrens', count: 12 },
    { address: 'anwalt@kanzlei-mueller.de', name: 'RA Müller', count: 3 },
  ],
};

console.log('\nMit eingerichtetem Schluessel:');

setKeyProvider(SCHLUESSEL);

pruefe('die Adressen stehen nicht in der Datei', () => {
  const ziel = pfad('contacts.json');
  schreibeGeschuetzt(ziel, JSON.stringify(ADRESSBUCH));
  const roh = fs.readFileSync(ziel, 'utf-8');
  assert.ok(!roh.includes('praxis-am-park'), `die Adresse steht im Klartext da: ${roh.slice(0, 80)}`);
  assert.ok(!roh.includes('Behrens'), 'der Name steht im Klartext da');
  assert.ok(istVerschluesselt(roh), roh.slice(0, 40));
});

pruefe('und kommen unveraendert zurueck', () => {
  // Verschluesseln, das beim Lesen etwas anderes ergibt, waere schlimmer als keines.
  const befund = liesGeschuetzt<typeof ADRESSBUCH | null>(pfad('contacts.json'), null);
  assert.deepEqual(befund.wert, ADRESSBUCH);
  assert.equal(befund.beschaedigt, undefined);
});

pruefe('Umlaute ueberstehen den Weg', () => {
  const ziel = pfad('umlaute.json');
  const wert = { text: 'Grüße aus Köln – schöne Straße, 20 °C' };
  schreibeGeschuetzt(ziel, JSON.stringify(wert));
  assert.deepEqual(liesGeschuetzt<typeof wert | null>(ziel, null).wert, wert);
});

console.log('\nDer Umstieg aus einer aelteren Installation:');

pruefe('vorhandener Klartext wird weiter gelesen', () => {
  /*
   * Der Fall, an dem eine Umstellung scheitert oder nicht. Ein Zwangsdurchlauf ueber alle
   * Dateien waere ein Vorgang, bei dem viel schiefgehen kann; eine Datei, die sich nicht
   * mehr lesen laesst, ist eine verlorene Datei. Also: Klartext bleibt lesbar.
   */
  const ziel = pfad('alt.json');
  schreibeAtomar(ziel, JSON.stringify(ADRESSBUCH));
  assert.deepEqual(liesGeschuetzt<typeof ADRESSBUCH | null>(ziel, null).wert, ADRESSBUCH);
});

pruefe('und ist danach sofort weg - nicht erst beim naechsten Schreiben', () => {
  /*
   * Genau das war beim ersten Start am echten Bestand zu sehen: contacts.json und
   * cache.json waren sofort verschluesselt, weil sie ohnehin dauernd geschrieben werden.
   * regeln.json und etiketten.json standen weiter im Klartext da - die werden nur
   * geschrieben, wenn jemand eine Regel aendert, also womoeglich nie.
   *
   * Der Lesevorgang oben hat die Datei deshalb bereits ersetzt.
   */
  const ziel = pfad('alt.json');
  const roh = fs.readFileSync(ziel, 'utf-8');
  assert.ok(istVerschluesselt(roh), `steht immer noch im Klartext da: ${roh.slice(0, 60)}`);
  assert.ok(!roh.includes('praxis-am-park'));
  assert.deepEqual(liesGeschuetzt<typeof ADRESSBUCH | null>(ziel, null).wert, ADRESSBUCH);
});

console.log('\nWenn etwas nicht stimmt:');

pruefe('eine fehlende Datei ist kein Schaden', () => {
  // Beim ersten Start voellig richtig - und deshalb streng von "unlesbar" zu trennen.
  const befund = liesGeschuetzt<string[]>(pfad('gibtesnicht.json'), []);
  assert.deepEqual(befund.wert, []);
  assert.equal(befund.beschaedigt, undefined);
});

pruefe('ein fremder Schluessel meldet einen Befund, statt still zu leeren', () => {
  /*
   * Der Ordner liegt auf einem anderen Rechner oder unter einem anderen Windows-Konto.
   * Dann ist die Datei nicht zu oeffnen - aber sie darf nicht wortlos als "leer" gelten
   * und beim naechsten Schreiben ueberbuegelt werden. liesJson legt sie zur Seite und
   * meldet es nach oben; genau daran haengt, dass ein Adressbuch nicht verschwindet.
   */
  const ziel = pfad('fremd.json');
  schreibeGeschuetzt(ziel, JSON.stringify(ADRESSBUCH));

  setKeyProvider({ name: 'Fremder', getKey: () => Buffer.alloc(32, 9) });
  try {
    const befund = liesGeschuetzt<typeof ADRESSBUCH | null>(ziel, null);
    assert.equal(befund.wert, null);
    assert.ok(befund.beschaedigt, 'der Fehlschlag wurde verschluckt');
    assert.ok(
      befund.beschaedigt!.beiseite && fs.existsSync(befund.beschaedigt!.beiseite),
      'die unlesbare Datei wurde nicht beiseitegelegt',
    );
  } finally {
    setKeyProvider(SCHLUESSEL);
  }
});

/*
 * Nicht hier geprueft, aber belegt: der Rueckfall auf Klartext, wenn kein Schluessel
 * eingerichtet ist (Werkzeuge, Standalone-Server ohne Master-Passwort). Der Zustand "kein
 * Anbieter" laesst sich von aussen nicht wiederherstellen - setKeyProvider kennt nur den
 * Weg hinein. Belegt ist er stattdessen durch jede andere Pruefdatei dieses Pakets: sie
 * laufen ohne Schluessel und schreiben ueber genau diesen Weg. Fiele der Rueckfall weg,
 * braechen sie alle ab.
 */

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
