import assert from 'node:assert/strict';
import type { FolderInfo } from '@energy-mail/mail-core';
import {
  alsFracht,
  ausFracht,
  bringtDateien,
  darfAblegen,
  frachtFuer,
  ziehtext,
} from './ziehen.js';

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

const ordner = (pfad: string, zusatz: Partial<FolderInfo> = {}): FolderInfo => ({
  path: pfad,
  name: pfad,
  flags: [],
  delimiter: '/',
  selectable: true,
  isAllMail: false,
  ...zusatz,
});

const FRACHT = { accountId: 'konto1', ordner: 'INBOX', uids: [12, 13] };

console.log('\nWas am Zeiger haengt:');

pruefe('hin und zurueck ergibt dasselbe', () => {
  assert.deepEqual(ausFracht(alsFracht(FRACHT)), FRACHT);
});

pruefe('Unsinn ergibt null, keine Ausnahme', () => {
  assert.equal(ausFracht('kein JSON'), null);
  assert.equal(ausFracht(''), null);
  assert.equal(ausFracht(null), null);
  assert.equal(ausFracht('{}'), null);
});

pruefe('eine Fracht ohne Nachrichten zaehlt nicht', () => {
  assert.equal(ausFracht(JSON.stringify({ accountId: 'k', ordner: 'INBOX', uids: [] })), null);
});

pruefe('unbrauchbare Nummern werden abgewiesen', () => {
  // Sonst ginge eine Anfrage mit "uid=0" oder "uid=-1" an den Server.
  assert.equal(ausFracht(JSON.stringify({ accountId: 'k', ordner: 'I', uids: [0] })), null);
  assert.equal(ausFracht(JSON.stringify({ accountId: 'k', ordner: 'I', uids: [-5] })), null);
  assert.equal(ausFracht(JSON.stringify({ accountId: 'k', ordner: 'I', uids: [1.5] })), null);
  assert.equal(ausFracht(JSON.stringify({ accountId: 'k', ordner: 'I', uids: ['x'] })), null);
});

console.log('\nWohin darf abgelegt werden?');

pruefe('in einen anderen Ordner desselben Kontos: ja', () => {
  assert.deepEqual(darfAblegen(FRACHT, ordner('Archiv'), 'konto1'), { erlaubt: true });
});

pruefe('in den Ordner, in dem sie schon liegt: nein', () => {
  // Bei manchen Servern waere das ein Kopieren samt Loeschen des Originals - mit neuen
  // Nummern und einem Eintrag im Papierkorb.
  const p = darfAblegen(FRACHT, ordner('INBOX'), 'konto1');
  assert.equal(p.erlaubt, false);
  assert.match(p.grund ?? '', /schon hier/);
});

pruefe('in ein anderes Konto: nein', () => {
  // IMAP kann das nicht - es waere Herunterladen und neu Hochladen.
  const p = darfAblegen(FRACHT, ordner('INBOX'), 'konto2');
  assert.equal(p.erlaubt, false);
  assert.match(p.grund ?? '', /zwei Konten/i);
});

pruefe('in einen Ordner, der keine Nachrichten aufnimmt: nein', () => {
  // Gmails "[Gmail]" ist reine Gliederung.
  const p = darfAblegen(FRACHT, ordner('[Gmail]', { selectable: false }), 'konto1');
  assert.equal(p.erlaubt, false);
  assert.match(p.grund ?? '', /keine Nachrichten/);
});

pruefe('ohne Fracht oder ohne Ziel: nein, und ohne Grund', () => {
  // Kein Grund, weil hier gar nichts gezogen wird - ein Hinweis waere Laerm.
  assert.deepEqual(darfAblegen(null, ordner('Archiv'), 'konto1'), { erlaubt: false });
  assert.deepEqual(darfAblegen(FRACHT, undefined, 'konto1'), { erlaubt: false });
});

pruefe('derselbe Pfad in einem anderen Konto wird nicht verwechselt', () => {
  // "INBOX" gibt es in jedem Konto - ohne die Kennung landete GMX-Post bei Gmail.
  assert.equal(darfAblegen(FRACHT, ordner('INBOX'), 'konto2').erlaubt, false);
  assert.equal(darfAblegen(FRACHT, ordner('Archiv'), 'konto2').erlaubt, false);
});

console.log('\nWelche Nachrichten werden gezogen?');

pruefe('an einer angekreuzten gezogen: die ganze Auswahl', () => {
  assert.deepEqual(frachtFuer(12, new Set([12, 13, 14])).sort(), [12, 13, 14]);
});

pruefe('an einer nicht angekreuzten gezogen: nur diese', () => {
  // Und die Auswahl bleibt unberuehrt - ein versehentliches Ziehen soll die muehsam
  // zusammengeklickte Liste nicht kosten.
  const auswahl = new Set([12, 13]);
  assert.deepEqual(frachtFuer(99, auswahl), [99]);
  assert.deepEqual([...auswahl], [12, 13]);
});

pruefe('ohne Auswahl: nur die angefasste', () => {
  assert.deepEqual(frachtFuer(7, new Set()), [7]);
});

console.log('\nWas am Zeiger steht:');

pruefe('Einzahl und Mehrzahl', () => {
  assert.equal(ziehtext(1), '1 Nachricht');
  assert.equal(ziehtext(2), '2 Nachrichten');
  assert.equal(ziehtext(17), '17 Nachrichten');
});

console.log('\nDateien in das Verfassen-Fenster:');

pruefe('erkennt Dateien schon beim Ueberfahren', () => {
  // Beim Ueberfahren sind die Dateien noch nicht lesbar - nur ihre Art steht fest.
  // Wer auf "files.length" prueft, bekommt dort null und zeigt die Flaeche nie.
  assert.equal(bringtDateien(['Files']), true);
  assert.equal(bringtDateien(['text/plain', 'Files']), true);
});

pruefe('gezogener Text ist keine Datei', () => {
  assert.equal(bringtDateien(['text/plain', 'text/html']), false);
  assert.equal(bringtDateien([]), false);
  assert.equal(bringtDateien(undefined), false);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
