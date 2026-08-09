import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir, getNutzerDirFuer } from './paths.js';
import { alsNutzer, betreteNutzerFuerProzess } from './nutzer/kontext.js';
import { setKeyProvider } from './secretCrypto.js';

/*
 * Bekommt beim Start JEDER Nutzer seine Hintergrundarbeit - oder nur der erste?
 *
 * Im Aufbau des Servers stand eine Schleife über genau einen Namen:
 *
 *     for (const nutzer of [EINPLATZ_NUTZER]) { ... }
 *
 * Auf dem Einzelplatz war das richtig - dort gibt es nur diesen einen. Auf einem Server
 * mit mehreren Menschen hieß es: nach jedem Neustart läuft für alle anderen keine
 * Überwachung mehr (also keine neue Post, bis jemand von Hand nachlädt), eine geplante
 * Sendung geht nicht hinaus, und eine auf morgen zurückgestellte Nachricht kommt nicht
 * wieder. Ohne Fehlermeldung, ohne Eintrag im Protokoll - es passiert schlicht nichts.
 *
 * Geprüft wird das über die Wiedervorlage, weil sie die einzige der drei ist, die sich
 * ohne Postfach nachweisen lässt: sie liegt als Datei im Nutzerordner, und nach dem
 * Start muss sie im Speicher DIESES Nutzers stehen.
 */

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-hintergrund-'));
setDataDir(ORDNER);
betreteNutzerFuerProzess('pruefung');

// Ein Schlüssel, der nicht von der Maschine abhängt - die Prüfung läuft ohne Electron.
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const { legeNutzerAn, setzeSperre } = await import('./nutzer/nutzerStore.js');
const { verpackeNutzerschluessel } = await import('./nutzer/schluesselHuelle.js');
const { buildServer } = await import('./app.js');
const { listeWiedervorlagen } = await import('./snooze.js');

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

/** Legt eine Wiedervorlage direkt als Datei ab - so, wie sie ein Neustart vorfindet. */
function hinterlegeWiedervorlage(nutzerId: string, betreff: string): void {
  const ordner = getNutzerDirFuer(nutzerId);
  fs.mkdirSync(ordner, { recursive: true });
  fs.writeFileSync(
    path.join(ordner, 'wiedervorlage.json'),
    JSON.stringify([
      {
        id: `wv-${nutzerId}`,
        accountId: 'konto-1',
        ursprung: 'INBOX',
        betreff,
        // Weit in der Zukunft: der Eintrag soll geladen und eingeplant werden, nicht
        // sofort abgearbeitet.
        faellig: Date.now() + 30 * 24 * 60 * 60 * 1000,
      },
    ]),
    'utf-8',
  );
}

for (const wer of ['anna', 'bert', 'carl']) {
  legeNutzerAn(
    { id: wer, email: `${wer}@beispiel.de`, kennwort: 'einskommazwei' },
    verpackeNutzerschluessel,
  );
  hinterlegeWiedervorlage(wer, `Rueckruf ${wer}`);
}
setzeSperre('carl', true);

const app = await buildServer({ port: 4123, nutzerErmitteln: () => 'anna' });

console.log('\nNach dem Start des Servers:');

await pruefe('der erste Nutzer hat seine Wiedervorlage', () => {
  const offen = alsNutzer('anna', () => listeWiedervorlagen());
  assert.equal(offen.length, 1);
  assert.equal(offen[0]?.betreff, 'Rueckruf anna');
});

await pruefe('der ZWEITE Nutzer auch - hier lag der Fehler', () => {
  /*
   * Der eigentliche Befund. Vorher war diese Liste leer: Berts Nachricht wäre am
   * nächsten Morgen nicht zurückgekommen, und niemand hätte je erfahren, warum.
   */
  const offen = alsNutzer('bert', () => listeWiedervorlagen());
  assert.equal(offen.length, 1, 'Bert bekam keine Hintergrundarbeit');
  assert.equal(offen[0]?.betreff, 'Rueckruf bert');
});

await pruefe('die Nutzer sehen dabei nicht die Wiedervorlagen des anderen', () => {
  // Die Trennung aus Stufe 4 muss auch hier halten - je Nutzer ein eigener Speicher.
  const annas = alsNutzer('anna', () => listeWiedervorlagen()).map((e) => e.betreff);
  assert.deepEqual(annas, ['Rueckruf anna']);
});

await pruefe('ein gesperrter Nutzer bekommt keine', () => {
  /*
   * Wer nicht hereinkommt, soll auch im Hintergrund nichts tun: sonst hielte ein
   * gesperrtes Konto weiter IMAP-Verbindungen offen und verschickte geplante Post.
   */
  const offen = alsNutzer('carl', () => listeWiedervorlagen());
  assert.equal(offen.length, 0, 'für einen gesperrten Nutzer lief Hintergrundarbeit');
});

await app.close();
try {
  fs.rmSync(ORDNER, { recursive: true, force: true });
} catch {
  // Unter Windows hält SQLite die Ablagedatei noch einen Moment.
}

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);

// Ausdrücklich beenden: die eingeplanten Wiedervorlagen halten den Prozess sonst am
// Leben - siehe routen.test.mts.
process.exit(ok === gesamt ? 0 : 1);
