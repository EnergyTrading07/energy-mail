import assert from 'node:assert/strict';
import { istVerbindungsfehler } from './verbindungsfehler.js';

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

const mitCode = (code: string) => Object.assign(new Error('Command failed'), { code });

console.log('\nWas als "kein Netz" gilt:');

pruefe('Name nicht aufloesbar', () => {
  assert.equal(istVerbindungsfehler(mitCode('ENOTFOUND')), true);
  assert.equal(istVerbindungsfehler(mitCode('EAI_AGAIN')), true);
});

pruefe('Verbindung abgelehnt oder abgebrochen', () => {
  for (const c of ['ECONNREFUSED', 'ECONNRESET', 'EPIPE']) {
    assert.equal(istVerbindungsfehler(mitCode(c)), true, c);
  }
});

pruefe('Rechner oder Netz nicht erreichbar', () => {
  for (const c of ['EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'ETIMEDOUT']) {
    assert.equal(istVerbindungsfehler(mitCode(c)), true, c);
  }
});

pruefe('auch als errno statt code', () => {
  assert.equal(istVerbindungsfehler(Object.assign(new Error('x'), { errno: 'ECONNRESET' })), true);
});

pruefe('an der Meldung erkannt, wenn kein Code mitkommt', () => {
  for (const m of [
    'Socket closed unexpectedly',
    'Connection lost',
    'getaddrinfo ENOTFOUND imap.gmx.net',
    'Command timed out',
    'Zeitüberschreitung – Server nicht erreichbar.',
  ]) {
    assert.equal(istVerbindungsfehler(new Error(m)), true, m);
  }
});

console.log('\nWas NICHT als "kein Netz" gelten darf:');

pruefe('eine abgelehnte Anmeldung', () => {
  // Sonst zeigte das Programm einen alten Stand und verschwiege, dass die Anmeldung
  // abgelaufen ist - man suchte den Grund an der voellig falschen Stelle.
  const e = Object.assign(new Error('Invalid credentials'), { authenticationFailed: true });
  assert.equal(istVerbindungsfehler(e), false);
});

pruefe('eine abgelaufene Anmeldung, auch mit Netzcode daneben', () => {
  const e = Object.assign(new Error('Token has been expired or revoked.'), {
    authenticationFailed: true,
    code: 'ECONNRESET',
  });
  assert.equal(istVerbindungsfehler(e), false);
});

pruefe('ein fehlender Ordner', () => {
  assert.equal(istVerbindungsfehler(new Error('Mailbox does not exist')), false);
});

pruefe('eine Nachricht, die es nicht gibt', () => {
  assert.equal(istVerbindungsfehler(new Error('Nachricht 42 nicht gefunden in INBOX')), false);
});

pruefe('ein Fehler des Anbieters', () => {
  assert.equal(istVerbindungsfehler(new Error('Server error: too many requests')), false);
  assert.equal(istVerbindungsfehler(new Error('OVERQUOTA')), false);
});

pruefe('etwas, das gar kein Fehler ist', () => {
  assert.equal(istVerbindungsfehler(null), false);
  assert.equal(istVerbindungsfehler(undefined), false);
  assert.equal(istVerbindungsfehler('kaputt'), false);
  assert.equal(istVerbindungsfehler(42), false);
});

pruefe('ein unbekannter Code', () => {
  assert.equal(istVerbindungsfehler(mitCode('EPERM')), false);
  assert.equal(istVerbindungsfehler(mitCode('ENOENT')), false);
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
