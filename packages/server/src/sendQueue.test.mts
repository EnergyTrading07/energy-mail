import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';
import { setKeyProvider } from './secretCrypto.js';

/*
 * Die Warteschlange gibt nichts verloren.
 *
 * Die eine Eigenschaft, an der hier alles haengt: Ein Nachrichtenkoerper verschwindet erst
 * dann aus der Warteschlange, wenn er entweder versendet ODER nachweislich woanders
 * abgelegt ist. Vorher stand an dieser Stelle ein Loeschen und daneben ein Aufruf, den
 * niemand entgegennahm - `setAufgabeVerfahren` war geschrieben, exportiert und
 * dokumentiert, aber nirgends im Programm gesetzt. Nach fuenf Fehlschlaegen war die
 * Nachricht ersatzlos weg, und die einzige Spur war eine Zeile im Protokoll.
 *
 * Geprueft wird deshalb der Fehlerfall, nicht der Regelfall: Was passiert, wenn es NICHT
 * klappt.
 */

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-warteschlange-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 3) });

const { alsNutzer } = await import('./nutzer/kontext.js');
const {
  planeSendung,
  listeGeplanteSendungen,
  verwerfeKontoSendungen,
  sendeAusstehendeSofort,
  setSendeVerfahren,
  setAufgabeVerfahren,
} = await import('./sendQueue.js');

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

/** Was die Warteschlange beim Senden tun soll - je Pruefung neu gesetzt. */
let sendeVerhalten: () => void = () => {};
/** Ob und wie die Rettung als Entwurf ausgeht. */
let rettungsVerhalten: () => boolean = () => true;
let gerettet: string[] = [];

setSendeVerfahren(async () => {
  sendeVerhalten();
}, () => {});

setAufgabeVerfahren(async (sendung) => {
  const geglueckt = rettungsVerhalten();
  if (geglueckt) gerettet.push(sendung.betreff);
  return geglueckt;
});

/** Im Namen eines Nutzers - die Warteschlange liegt je Nutzer. */
const alsAnna = <T,>(fn: () => T): T => alsNutzer('anna', fn);

/**
 * Treibt die Warteschlange so oft an, bis sie aufgibt oder leer ist.
 *
 * Der Eintrag wird jeweils faellig gemacht statt neu eingeplant: Nach einem Fehlschlag
 * liegt `faellig` bis zu einer Stunde voraus, und sendeAusstehendeSofort() nimmt nur, was
 * innerhalb der naechsten fuenf Minuten ansteht. Ihn ueber stornieren/neu planen
 * vorzuziehen ginge auch - nur entstuende dabei ein NEUER Eintrag, dessen Versuchszaehler
 * wieder bei null steht, und die Aufgabegrenze waere nie zu erreichen.
 *
 * listeGeplanteSendungen() gibt die gehaltenen Objekte selbst heraus, nicht Kopien; ein
 * gesetztes `faellig` wirkt daher unmittelbar.
 */
async function treibeAn(male: number): Promise<void> {
  for (let i = 0; i < male; i++) {
    const offen = alsAnna(() => listeGeplanteSendungen());
    if (offen.length === 0) return;
    for (const s of offen) s.faellig = Date.now() - 1;
    await alsAnna(() => sendeAusstehendeSofort());
  }
}

console.log('\nDie Sendewarteschlange:');

await pruefe('was hinausgeht, verschwindet aus der Warteschlange', async () => {
  sendeVerhalten = () => {};
  alsAnna(() => planeSendung('k1', { subject: 'Geht raus', to: ['x@y.de'] }, Date.now() + 1));
  await alsAnna(() => sendeAusstehendeSofort());
  assert.equal(alsAnna(() => listeGeplanteSendungen()).length, 0);
});

await pruefe('ein Fehlschlag laesst den Koerper stehen', async () => {
  sendeVerhalten = () => {
    throw new Error('Der Server mag nicht');
  };
  alsAnna(() => planeSendung('k1', { subject: 'Bleibt liegen', to: ['x@y.de'] }, Date.now() + 1));
  await alsAnna(() => sendeAusstehendeSofort());

  const uebrig = alsAnna(() => listeGeplanteSendungen());
  assert.equal(uebrig.length, 1, 'Die Nachricht darf nach einem Fehlschlag nicht weg sein');
  assert.equal(uebrig[0]!.versuche, 1);
  assert.match(uebrig[0]!.letzterFehler ?? '', /mag nicht/);
});

await pruefe('nach genug Versuchen wird sie als Entwurf gerettet - und erst dann geloescht', async () => {
  gerettet = [];
  rettungsVerhalten = () => true;
  sendeVerhalten = () => {
    throw new Error('dauerhaft kaputt');
  };
  await treibeAn(8);

  assert.deepEqual(
    alsAnna(() => listeGeplanteSendungen()).map((s) => s.betreff),
    [],
    'Nach geglueckter Rettung darf nichts mehr in der Warteschlange stehen',
  );
  assert.ok(gerettet.includes('Bleibt liegen'), 'Der Koerper muss durch die Rettung gegangen sein');
});

await pruefe('misslingt die Rettung, BLEIBT sie in der Warteschlange', async () => {
  gerettet = [];
  rettungsVerhalten = () => false;
  sendeVerhalten = () => {
    throw new Error('kein Netz');
  };
  alsAnna(() => planeSendung('k1', { subject: 'Ohne Netz', to: ['x@y.de'] }, Date.now() + 1));
  await treibeAn(8);

  /*
   * Der Kern der Behebung. Vorher wurde hier geloescht, ohne dass irgendwo etwas
   * ankam - der haeufigste Grund fuer einen endgueltig gescheiterten Versand ist ein
   * fehlendes Netz, und dann scheitert auch das Ablegen des Entwurfs.
   */
  const uebrig = alsAnna(() => listeGeplanteSendungen());
  assert.equal(uebrig.length, 1, 'Ohne geglueckte Rettung darf nichts verschwinden');
  assert.equal(uebrig[0]!.betreff, 'Ohne Netz');
  assert.equal(gerettet.length, 0);
});

await pruefe('mit dem Konto gehen auch seine vorgemerkten Sendungen', async () => {
  const weg = alsAnna(() => verwerfeKontoSendungen('k1'));
  assert.ok(weg.length >= 1, 'Die Sendung des Kontos muss zurueckgemeldet werden');
  assert.equal(alsAnna(() => listeGeplanteSendungen('k1')).length, 0);
});

await pruefe('die Warteschlange bleibt je Nutzer getrennt', async () => {
  sendeVerhalten = () => {
    throw new Error('bleibt liegen');
  };
  alsAnna(() => planeSendung('k1', { subject: 'Annas', to: ['a@b.de'] }, Date.now() + 60_000));
  alsNutzer('bernd', () => planeSendung('k9', { subject: 'Bernds', to: ['c@d.de'] }, Date.now() + 60_000));

  assert.deepEqual(
    alsAnna(() => listeGeplanteSendungen()).map((s) => s.betreff),
    ['Annas'],
  );
  assert.deepEqual(
    alsNutzer('bernd', () => listeGeplanteSendungen()).map((s) => s.betreff),
    ['Bernds'],
  );
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
