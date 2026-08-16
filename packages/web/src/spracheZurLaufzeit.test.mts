import assert from 'node:assert/strict';
import type { FolderInfo } from '@energy-mail/mail-core';
import { lerneKatalog, setzeSprache } from '@energy-mail/mail-core/sprache';
import { buildFolderView } from './folderTree.js';
import { categoryDescription, categoryLabel } from './gmailCategories.js';
import { dichten, beschreibeSortierung } from './sortierung.js';
import { werkzeuge, textfarben } from './formatierung.js';

/**
 * Texte, die aus einer Tabelle kommen, müssen die Sprache mitbekommen.
 *
 * Das ist die Falle, die diese Prüfung offenhält: Solche Tabellen standen durchweg als
 * `const` am Dateianfang - die Namen der Sonderordner, Gmails Einordnungen, die
 * Anzeigedichten, die Formatierleiste. Eine Konstante auf Modulebene wird beim
 * **Einbinden** gebaut, also bevor `richteSpracheEin()` überhaupt gelaufen ist. Sie
 * stünde damit für immer in der Vorgabesprache da, während alles ringsum übersetzt ist.
 *
 * Der Fehler ist deshalb so unangenehm, weil er sich nicht meldet: Es gibt keine
 * Ausnahme, keine leere Stelle, keinen Platzhalter. In der Seitenleiste stünde einfach
 * weiterhin "Posteingang", und wer die Oberfläche nicht tatsächlich umstellt, sieht nie
 * etwas davon. Genau deshalb steht hier eine Prüfung und kein Kommentar.
 *
 * Geprüft wird der Mechanismus, nicht der Katalog: Der Testkatalog wird hier angelegt, und
 * ob die echte englische Fassung diese Einträge schon hat, ist eine andere Frage.
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

lerneKatalog('en', {
  Posteingang: 'Inbox',
  Werbung: 'Promotions',
  'Angebote, Newsletter und Werbung': 'Offers, newsletters and advertising',
  Eng: 'Compact',
  'Neueste zuerst': 'Newest first',
  'Fett (Strg+B)': 'Bold (Ctrl+B)',
  F: 'B',
  Schwarz: 'Black',
});

const ordner: FolderInfo[] = [
  {
    path: 'INBOX',
    name: 'INBOX',
    delimiter: '/',
    specialUse: '\\Inbox',
    selectable: true,
    unseen: 0,
    flags: [],
    isAllMail: false,
  },
];

console.log('\nTexte aus Tabellen folgen der Sprache:');

pruefe('der Name des Posteingangs', () => {
  setzeSprache('de');
  assert.equal(buildFolderView(ordner).sonder[0]!.label, 'Posteingang');
  setzeSprache('en');
  assert.equal(buildFolderView(ordner).sonder[0]!.label, 'Inbox');
});

pruefe('Gmails Einordnungen samt Erklaerung', () => {
  setzeSprache('de');
  assert.equal(categoryLabel('promotions'), 'Werbung');
  setzeSprache('en');
  assert.equal(categoryLabel('promotions'), 'Promotions');
  assert.equal(categoryDescription('promotions'), 'Offers, newsletters and advertising');
});

pruefe('die Anzeigedichten', () => {
  setzeSprache('de');
  assert.equal(dichten()[0]!.name, 'Eng');
  setzeSprache('en');
  assert.equal(dichten()[0]!.name, 'Compact');
});

pruefe('die Beschriftung der Sortierung', () => {
  setzeSprache('de');
  assert.equal(beschreibeSortierung({ schluessel: 'datum', richtung: 'ab' }), 'Neueste zuerst');
  setzeSprache('en');
  assert.equal(beschreibeSortierung({ schluessel: 'datum', richtung: 'ab' }), 'Newest first');
});

pruefe('die Formatierleiste - Titel UND Aufschrift', () => {
  setzeSprache('de');
  const deutsch = werkzeuge()[0]![0]!;
  assert.equal(deutsch.titel, 'Fett (Strg+B)');
  assert.equal(deutsch.aufschrift, 'F');
  setzeSprache('en');
  const englisch = werkzeuge()[0]![0]!;
  assert.equal(englisch.titel, 'Bold (Ctrl+B)');
  // Auf einem englischen Rechner steht auf dem Fett-Knopf ein B - das ist die
  // Beschriftung, nach der jemand sucht, der aus Word oder Outlook kommt.
  assert.equal(englisch.aufschrift, 'B');
});

pruefe('die Namen der Textfarben', () => {
  setzeSprache('de');
  assert.equal(textfarben()[0]!.name, 'Schwarz');
  setzeSprache('en');
  assert.equal(textfarben()[0]!.name, 'Black');
});

pruefe('ohne Uebersetzung bleibt der deutsche Text stehen', () => {
  setzeSprache('en');
  // "Markiert" steht nicht im Testkatalog - und darf deshalb nicht leer sein, sondern
  // muss auf den deutschen Text zurueckfallen. Daran haengt, dass nichts kaputtgehen
  // kann, solange die Kataloge unvollstaendig sind.
  assert.equal(
    buildFolderView([{ ...ordner[0]!, specialUse: '\\Flagged', path: 'Flagged' }]).sonder[0]!.label,
    'Markiert',
  );
});

setzeSprache('de');

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
