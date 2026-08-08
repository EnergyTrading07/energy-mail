import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enthaeltGeheimnisse } from '@energy-mail/mail-core/protokoll';
import { setDataDir } from './paths.js';
import {
  fastifyProtokollZiel,
  lesProtokoll,
  protokollDatei,
  protokolliere,
  vorherigeProtokollDatei,
} from './protokollDatei.js';

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

// Eigener Ordner, damit die Prüfung nicht in das echte Protokoll schreibt.
const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-protokoll-'));
setDataDir(ORDNER);

/** Wartet, bis der Schreibstrom seine Arbeit getan hat. */
function inhalt(): string {
  return fs.existsSync(protokollDatei()) ? fs.readFileSync(protokollDatei(), 'utf8') : '';
}

console.log('\nDas Protokoll auf der Platte:');

pruefe('die Datei entsteht beim ersten Eintrag', () => {
  assert.equal(fs.existsSync(protokollDatei()), false, 'sie war schon da');
  protokolliere('info', 'probe', 'Erste Zeile');
  assert.ok(fs.existsSync(protokollDatei()), 'sie wurde nicht angelegt');
  assert.match(inhalt(), /INFO \[probe\] Erste Zeile/);
});

pruefe('ein Kennwort kommt nicht auf die Platte', () => {
  // Der eigentliche Zweck: der Bericht soll verschickt werden können, ohne dass ihn
  // jemand vorher Zeile für Zeile liest.
  protokolliere('fehler', 'probe', 'Anmeldung für anna@firma.de mit password=Hunter2! abgelehnt');
  const text = inhalt();
  assert.ok(!text.includes('Hunter2'), text);
  assert.ok(!text.includes('anna@'), text);
  assert.ok(text.includes('abgelehnt'), 'der Zusammenhang ging mit verloren');
  assert.ok(text.includes('@firma.de'), 'der Anbieter soll stehen bleiben');
});

pruefe('das Protokollieren wirft nie', () => {
  /*
   * Von hier aus werden auch Abstürze festgehalten - dann ist ohnehin schon etwas
   * schiefgelaufen, und ein Fehler beim Schreiben dürfte die Anwendung nicht
   * vollends mitnehmen.
   */
  const vorher = protokollDatei();
  setDataDir('Z:/gibt-es-nicht/und-laesst-sich-nicht-anlegen');
  assert.doesNotThrow(() => protokolliere('fehler', 'probe', 'ins Nichts'));
  setDataDir(ORDNER);
  assert.equal(protokollDatei(), vorher);
});

pruefe('bei zu großer Datei wird umgeschaltet', () => {
  // Über eine Million Zeichen: die Grenze, ab der die laufende Datei zur vorherigen wird.
  for (let i = 0; i < 1300; i++) protokolliere('info', 'fuell', 'x'.repeat(900));
  assert.ok(fs.existsSync(vorherigeProtokollDatei()), 'die vorherige Datei fehlt');
  assert.ok(
    fs.statSync(protokollDatei()).size < 1_000_000,
    'die laufende Datei wurde nicht kleiner',
  );
});

pruefe('es bleiben genau zwei Stände', () => {
  // Nicht mehr: was vor drei Tagen war, hilft bei einem Fehler von heute nicht, und
  // eine unbegrenzt wachsende Sammlung ist ihr eigenes Problem.
  for (let i = 0; i < 1300; i++) protokolliere('info', 'fuell', 'y'.repeat(900));
  const dateien = fs.readdirSync(path.dirname(protokollDatei()));
  assert.equal(dateien.length, 2, `stattdessen: ${dateien.join(', ')}`);
});

pruefe('gelesen werden beide Stände, älterer Teil zuerst', () => {
  // Eine Marke in den laufenden Stand, dann umschalten - danach steht sie im
  // vorherigen und muss beim Lesen vor der neuen kommen.
  protokolliere('info', 'probe', 'MARKE-ALT');
  for (let i = 0; i < 1300; i++) protokolliere('info', 'fuell', 'z'.repeat(900));
  protokolliere('info', 'probe', 'MARKE-NEU');

  const alles = lesProtokoll();
  assert.ok(alles.includes('MARKE-ALT'), 'der vorherige Stand fehlt');
  assert.ok(alles.includes('MARKE-NEU'), 'der laufende Stand fehlt');
  assert.ok(
    alles.indexOf('MARKE-ALT') < alles.indexOf('MARKE-NEU'),
    'die Reihenfolge stimmt nicht - der ältere Teil gehört nach oben',
  );
});

pruefe('der gelesene Stand ist frei von Geheimnissen', () => {
  assert.deepEqual(enthaeltGeheimnisse(lesProtokoll()), []);
});

console.log('\nWas vom Server durchgereicht wird:');

pruefe('eine Anfrage ergibt eine Zeile, nicht zwei', () => {
  // pino meldet jede Anfrage zweimal - beim Eingang und beim Abschluss. In der Datei
  // steht sonst alles doppelt.
  const ziel = fastifyProtokollZiel();
  const vorher = inhalt().length;
  ziel.write(JSON.stringify({ level: 30, req: { method: 'GET', url: '/accounts' } }) + '\n');
  ziel.write(JSON.stringify({ level: 30, res: { statusCode: 200 }, responseTime: 3 }) + '\n');
  const neu = inhalt().slice(vorher);
  assert.equal(neu.split('\n').filter(Boolean).length, 1, `stattdessen: ${JSON.stringify(neu)}`);
  assert.match(neu, /\[http\] GET \/accounts/);
});

pruefe('die Stufe kommt mit', () => {
  const ziel = fastifyProtokollZiel();
  const vorher = inhalt().length;
  ziel.write(JSON.stringify({ level: 50, msg: 'Verbindung abgebrochen' }) + '\n');
  assert.match(inhalt().slice(vorher), /FEHL \[server\] Verbindung abgebrochen/);
});

pruefe('was kein JSON ist, wird wörtlich übernommen', () => {
  const ziel = fastifyProtokollZiel();
  const vorher = inhalt().length;
  ziel.write('einfach nur Text\n');
  assert.match(inhalt().slice(vorher), /\[server\] einfach nur Text/);
});

console.log('\nDer Fall, um den es geht - ein Absturz:');

pruefe('die Zeile steht sofort auf der Platte, nicht erst später', () => {
  /*
   * Der eigentliche Grund für das synchrone Schreiben - und der Fall, um dessentwillen
   * es das Protokoll überhaupt gibt.
   *
   * Ein Schreibstrom puffert. Bricht der Prozess gleich nach dem Protokollieren ab, ist
   * die Zeile womöglich nie angekommen - genau die, um die es dann geht. Zuerst hatte
   * ich einen Strom benutzt, und eine Prüfung hat es mir vorgeführt: geschrieben,
   * unmittelbar darauf gelesen, nichts da.
   *
   * Deshalb hier bewusst ohne Wartezeit gelesen. Wer auf einen Strom zurückgeht, sieht
   * genau an dieser Stelle, was er sich einhandelt.
   */
  const vorher = inhalt().length;
  protokolliere('fehler', 'hauptprozess', 'Absturz zur Probe');
  assert.ok(
    inhalt().slice(vorher).includes('Absturz zur Probe'),
    'die Zeile wurde gepuffert statt geschrieben - beim Absturz wäre sie verloren',
  );
});

// Aufräumen.
fs.rmSync(ORDNER, { recursive: true, force: true });

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
