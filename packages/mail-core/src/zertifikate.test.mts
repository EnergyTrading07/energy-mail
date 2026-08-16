import assert from 'node:assert/strict';
import tls from 'node:tls';
import { beschreibeZertifikate, nutzeSystemZertifikate } from './zertifikate.js';

/*
 * Wem beim Verbinden geglaubt wird.
 *
 * Node benutzt ausschliesslich seine eigene Liste von Wurzelzertifikaten und sieht den
 * Speicher des Betriebssystems nicht an. Auf einem privaten Rechner faellt das nie auf.
 * In einem Firmennetz ist es der Unterschied zwischen "laeuft" und "laeuft nicht": der
 * pruefende Vorbau (Zscaler, Fortinet, Sophos) bricht TLS auf und unterschreibt mit einer
 * firmeneigenen Wurzel, die per Gruppenrichtlinie im Windows-Speicher liegt. Ohne sie
 * bricht JEDE IMAP- und SMTP-Verbindung ab, ohne dass Nutzer oder Administrator etwas
 * einstellen koennten.
 */

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

/** Ob dieser Node den Systemspeicher ueberhaupt kennt (ab 22.15 bzw. 24). */
const kannSystemspeicher =
  typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function';

console.log('\nDer Zertifikatsspeicher des Betriebssystems:');

pruefe('wird dazugenommen', () => {
  if (!kannSystemspeicher) {
    console.log('       (uebersprungen: dieser Node kennt den Systemspeicher nicht)');
    return;
  }
  const vorher = tls.getCACertificates('default').length;
  const befund = nutzeSystemZertifikate();
  assert.equal(befund.angewendet, true, befund.grund ?? 'nicht angewendet');
  assert.ok(befund.mitgeliefert > 0, 'keine mitgelieferten Wurzeln gefunden');

  const nachher = tls.getCACertificates('default').length;
  assert.ok(
    nachher >= vorher,
    `es sind weniger geworden: ${vorher} -> ${nachher}. Kein Anbieter darf durch die ` +
      'Umstellung unerreichbar werden.',
  );
});

pruefe('nichts geht dabei verloren', () => {
  if (!kannSystemspeicher) return;
  /*
   * Der Grund fuer die Vereinigung statt "nur der Systemspeicher": manche Unternehmen
   * raeumen den Windows-Speicher per Richtlinie aus. Wuerde er die mitgelieferte Liste
   * ERSETZEN, waeren danach Postfachanbieter unerreichbar, die vorher gingen.
   *
   * Verglichen wird der INHALT und nicht der Text. setDefaultCACertificates() gibt die
   * Zertifikate neu umbrochen zurueck - anderer Zeilenumbruch im Base64-Teil, ein
   * Zeilenende mehr am Schluss. Ein woertlicher Vergleich meldete deshalb ALLE 146
   * Wurzeln als verschwunden, obwohl keine einzige fehlte: eine Pruefung, die rot ist,
   * ohne dass etwas kaputt waere, ist genauso wertlos wie eine, die immer gruen ist.
   */
  const nurInhalt = (pem: string) => pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const wirksam = new Set(tls.getCACertificates('default').map(nurInhalt));
  const fehlend = tls.getCACertificates('bundled').filter((c) => !wirksam.has(nurInhalt(c)));
  assert.equal(fehlend.length, 0, `${fehlend.length} mitgelieferte Wurzeln sind herausgefallen`);
});

pruefe('und laesst sich abschalten', () => {
  const vorher = process.env.ENERGY_MAIL_SYSTEM_ZERTIFIKATE;
  process.env.ENERGY_MAIL_SYSTEM_ZERTIFIKATE = 'nein';
  try {
    const befund = nutzeSystemZertifikate();
    assert.equal(befund.angewendet, false);
    assert.match(befund.grund ?? '', /abgeschaltet/);
  } finally {
    if (vorher === undefined) delete process.env.ENERGY_MAIL_SYSTEM_ZERTIFIKATE;
    else process.env.ENERGY_MAIL_SYSTEM_ZERTIFIKATE = vorher;
  }
});

pruefe('der Befund steht als Satz im Protokoll', () => {
  // Er landet im Fehlerbericht - dort muss ohne Nachfrage erkennbar sein, was gilt.
  const satz = beschreibeZertifikate({
    mitgeliefert: 120,
    ausDemSystem: 183,
    hinzugekommen: 70,
    angewendet: true,
  });
  assert.match(satz, /120/);
  assert.match(satz, /70/);

  const aus = beschreibeZertifikate({
    mitgeliefert: 0,
    ausDemSystem: 0,
    hinzugekommen: 0,
    angewendet: false,
    grund: 'per ENERGY_MAIL_SYSTEM_ZERTIFIKATE abgeschaltet',
  });
  assert.match(aus, /abgeschaltet/);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
