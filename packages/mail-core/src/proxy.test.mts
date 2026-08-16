import assert from 'node:assert/strict';
import {
  beschreibeProxy,
  fuerAnzeige,
  gehtDirekt,
  leseProxyadresse,
  waehleProxy,
} from './proxy.js';

/*
 * Welcher Proxy gilt - und woher.
 *
 * An dieser Reihenfolge haengt, ob die Vorgabe eines Unternehmens tatsaechlich gilt.
 * Deshalb ist die Entscheidung rein rechnend gehalten: ohne Umgebung, ohne Dateien, ohne
 * Netz - und damit vollstaendig pruefbar.
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

console.log('\nEine Adresse lesen:');

pruefe('die gewohnten Schreibweisen', () => {
  for (const [ein, aus] of [
    ['http://proxy.firma.de:3128', 'http://proxy.firma.de:3128'],
    ['socks5://proxy.firma.de:1080', 'socks5://proxy.firma.de:1080'],
    ['https://proxy.firma.de:8443', 'https://proxy.firma.de:8443'],
    // Die Kurzform ohne Schema - so tippt sie ein Administrator hin.
    ['proxy.firma.de:8080', 'http://proxy.firma.de:8080'],
    ['  proxy.firma.de:8080  ', 'http://proxy.firma.de:8080'],
  ] as const) {
    const gelesen = leseProxyadresse(ein);
    assert.ok(!('fehler' in gelesen), `${ein}: ${(gelesen as { fehler?: string }).fehler}`);
    assert.equal((gelesen as { adresse: string }).adresse, aus, ein);
  }
});

pruefe('mit Anmeldung', () => {
  const gelesen = leseProxyadresse('http://anna:geheim@proxy.firma.de:3128');
  assert.equal((gelesen as { adresse: string }).adresse, 'http://anna:geheim@proxy.firma.de:3128');
});

pruefe('was abgewiesen wird', () => {
  /*
   * Abweisen statt durchreichen: ein "ftp://" im Proxyfeld ergaebe sonst eine Verbindung,
   * die erst tief in einer fremden Bibliothek scheitert - mit einer Meldung, die niemandem
   * sagt, wo der Fehler wirklich steckt.
   */
  for (const unfug of ['', '   ', 'ftp://proxy.firma.de:21', 'http://proxy.firma.de', '::::']) {
    const gelesen = leseProxyadresse(unfug);
    assert.ok('fehler' in gelesen, `"${unfug}" haette abgewiesen werden muessen`);
  }
  // Der fehlende Port bekommt einen eigenen Grund - das ist der haeufigste Fehler.
  const ohnePort = leseProxyadresse('http://proxy.firma.de');
  assert.match((ohnePort as { fehler: string }).fehler, /Port/);
});

console.log('\nDie Anmeldung wird nirgends gezeigt:');

pruefe('Kennwort und Name verschwinden', () => {
  // Ein Proxy-Kennwort ist in Firmen oft dasselbe wie das Windows-Kennwort.
  const gezeigt = fuerAnzeige('http://anna:geheim@proxy.firma.de:3128');
  assert.ok(!gezeigt.includes('geheim'), gezeigt);
  assert.ok(!gezeigt.includes('anna'), gezeigt);
  assert.ok(gezeigt.includes('proxy.firma.de:3128'), gezeigt);
});

pruefe('ohne Anmeldung bleibt die Adresse ganz', () => {
  assert.equal(fuerAnzeige('http://proxy.firma.de:3128'), 'http://proxy.firma.de:3128');
  assert.equal(fuerAnzeige(undefined), 'direkt');
});

console.log('\nAusnahmen in der Schreibweise von NO_PROXY:');

pruefe('genauer Rechner, Domain und Stern', () => {
  assert.equal(gehtDirekt('mail.firma.de', 'mail.firma.de'), true);
  assert.equal(gehtDirekt('mail.firma.de', '.firma.de'), true);
  assert.equal(gehtDirekt('mail.firma.de', '*.firma.de'), true);
  assert.equal(gehtDirekt('firma.de', '.firma.de'), true, 'die Domain selbst gehoert dazu');
  assert.equal(gehtDirekt('mail.firma.de', '*'), true);
  assert.equal(gehtDirekt('imap.gmx.net', '.firma.de,localhost'), false);
});

pruefe('Schreibweise und Port sind gleichgueltig', () => {
  assert.equal(gehtDirekt('MAIL.Firma.DE', 'mail.firma.de'), true);
  assert.equal(gehtDirekt('mail.firma.de:993', 'mail.firma.de'), true);
});

pruefe('kein Treffer aus Versehen', () => {
  // "boesefirma.de" endet zwar auf "firma.de", gehoert aber jemand anderem.
  assert.equal(gehtDirekt('boesefirma.de', '.firma.de'), false);
  assert.equal(gehtDirekt('mail.firma.de', ''), false);
  assert.equal(gehtDirekt('mail.firma.de', undefined), false);
});

console.log('\nDie Reihenfolge:');

const R = 'http://richtlinie.firma.de:3128';
const K = 'http://konto.firma.de:3128';
const U = 'http://umgebung.firma.de:3128';
const S = 'http://system.firma.de:3128';

pruefe('die Richtlinie schlaegt alles', () => {
  /*
   * Die Entscheidung, um die es geht. Duerfte das Konto gewinnen, genuegte ein eigener
   * Eintrag im Kontodialog, um die Ausgangskontrolle des Unternehmens zu umgehen - und
   * dann waere die Richtliniendatei keine Richtlinie, sondern ein Vorschlag.
   */
  const b = waehleProxy('imap.gmx.net', { richtlinie: R, konto: K, umgebung: U, system: S });
  assert.equal(b.adresse, R);
  assert.equal(b.quelle, 'richtlinie');
});

pruefe('ohne Richtlinie gewinnt das Konto', () => {
  const b = waehleProxy('imap.gmx.net', { konto: K, umgebung: U, system: S });
  assert.equal(b.adresse, K);
  assert.equal(b.quelle, 'konto');
});

pruefe('dann die Umgebung, dann das System', () => {
  assert.equal(waehleProxy('imap.gmx.net', { umgebung: U, system: S }).adresse, U);
  assert.equal(waehleProxy('imap.gmx.net', { system: S }).quelle, 'system');
});

pruefe('und sonst direkt', () => {
  const b = waehleProxy('imap.gmx.net', {});
  assert.equal(b.adresse, undefined);
  assert.equal(b.quelle, 'keiner');
});

pruefe('eine leere Angabe zaehlt nicht als Angabe', () => {
  // Ein leeres Feld im Kontodialog darf die Umgebung nicht ausschalten.
  const b = waehleProxy('imap.gmx.net', { konto: '   ', umgebung: U });
  assert.equal(b.adresse, U);
});

console.log('\nAusnahmen gegen die Reihenfolge:');

pruefe('ohne Richtlinie greift die Ausnahmeliste', () => {
  const b = waehleProxy('mail.imhaus.local', { umgebung: U, ausnahmen: '.imhaus.local' });
  assert.equal(b.quelle, 'keiner');
  // Fuer andere Rechner gilt der Proxy weiterhin.
  assert.equal(waehleProxy('imap.gmx.net', { umgebung: U, ausnahmen: '.imhaus.local' }).adresse, U);
});

pruefe('gegen die Richtlinie greift sie NICHT', () => {
  /*
   * Sonst waere es ein Loch: wer die Ausnahmeliste bestimmt, bestimmte damit auch, was am
   * vorgeschriebenen Proxy vorbeigeht.
   */
  const b = waehleProxy('mail.imhaus.local', { richtlinie: R, ausnahmen: '*' });
  assert.equal(b.adresse, R, 'die Ausnahmeliste hat die Richtlinie ausgehebelt');
});

console.log('\nWenn eine Angabe nicht taugt:');

pruefe('sie wird uebersprungen und gemeldet', () => {
  /*
   * Uebersprungen, damit der Nutzer ueber die naechste Quelle arbeiten kann. Gemeldet,
   * weil ein Tippfehler in der Richtliniendatei sonst hundert Arbeitsplaetze still am
   * Proxy vorbeigreifen liesse.
   */
  const b = waehleProxy('imap.gmx.net', { richtlinie: 'ftp://falsch:21', umgebung: U });
  assert.equal(b.adresse, U);
  assert.equal(b.quelle, 'umgebung');
  assert.match(b.beanstandet ?? '', /richtlinie/);
});

pruefe('taugt gar nichts, steht der Grund trotzdem da', () => {
  const b = waehleProxy('imap.gmx.net', { konto: 'proxy ohne alles ://' });
  assert.equal(b.quelle, 'keiner');
  assert.match(b.beanstandet ?? '', /konto/);
});

console.log('\nDer Satz fuer das Protokoll:');

pruefe('nennt Adresse und Quelle, aber kein Kennwort', () => {
  const satz = beschreibeProxy(
    waehleProxy('imap.gmx.net', { richtlinie: 'http://anna:geheim@proxy.firma.de:3128' }),
  );
  assert.ok(!satz.includes('geheim'), satz);
  assert.match(satz, /proxy\.firma\.de:3128/);
  assert.match(satz, /Richtliniendatei/);
});

pruefe('und sagt auch, wenn es keinen gibt', () => {
  assert.match(beschreibeProxy({ quelle: 'keiner' }), /direkt/);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
