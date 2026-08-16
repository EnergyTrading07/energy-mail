#!/usr/bin/env node
/**
 * Traegt Uebersetzungen in einen Katalog ein - aus JSON, nicht von Hand.
 *
 * Der Grund ist die Maskierung. Ein Katalog ist eine TypeScript-Datei mit einfach
 * zitierten Zeichenketten; das franzoesische "l'adresse", das italienische "un'altra" und
 * jeder Zeilenumbruch muessen darin maskiert werden. Bei siebentausend Eintraegen ueber
 * neun Sprachen ist das keine Frage von Sorgfalt mehr, sondern eine Frage der Zeit, bis
 * einer durchrutscht - und ein durchgerutschter Apostroph ist kein Schoenheitsfehler,
 * sondern ein Syntaxfehler, der die ganze Sprache unbrauchbar macht.
 *
 * Deshalb: Der Mensch schreibt JSON, das Werkzeug schreibt TypeScript.
 *
 * Aufruf: node scripts/katalog-einfuegen.mjs <sprache> <datei.json>
 *
 * Die JSON-Datei ordnet deutschen Text auf Uebersetzung zu. Ein Wert darf auch ein Objekt
 * mit Mehrzahlformen sein ({"one": "…", "few": "…", "many": "…", "other": "…"}).
 * Vorhandene Eintraege werden ueberschrieben, fehlende ergaenzt; die Reihenfolge der
 * Ausgabe folgt dem Quelltext, damit ein Katalog dieselbe Gliederung hat wie die
 * Oberflaeche.
 */
import fs from 'node:fs';
import path from 'node:path';
import { alleTexte, WURZEL } from './sprachtexte.mjs';

const [kennung, jsonPfad] = process.argv.slice(2);
if (!kennung || !jsonPfad) {
  console.error('Aufruf: node scripts/katalog-einfuegen.mjs <sprache> <datei.json>');
  process.exit(1);
}

const ziel = path.join(WURZEL, 'packages/mail-core/src/sprachen', `${kennung}.ts`);
if (!fs.existsSync(ziel)) {
  console.error(`Kein Katalog fuer "${kennung}" unter ${ziel}.`);
  process.exit(1);
}

const neue = JSON.parse(fs.readFileSync(path.resolve(jsonPfad), 'utf-8'));

/*
 * Den bestehenden Katalog lesen - aus dem gebauten Stand, nicht aus dem Quelltext.
 *
 * Den TypeScript-Quelltext zu zerlegen hiesse, einen halben Uebersetzer zu schreiben.
 * Das Gebaute ist bereits reines JavaScript und laesst sich einbinden.
 */
let bestand = {};
const gebaut = path.join(WURZEL, 'packages/mail-core/dist/sprachen', `${kennung}.js`);
if (fs.existsSync(gebaut)) {
  /*
   * Ist das Gebaute aelter als der Quelltext, wird abgebrochen - und das ist die
   * wichtigste Zeile in dieser Datei.
   *
   * Der Bestand kommt aus dem gebauten Katalog, geschrieben wird der Quelltext. Wer zwei
   * Stapel hintereinander eintraegt und dazwischen nicht baut, liest beim zweiten Mal
   * einen veralteten Bestand - und der erste Stapel ist danach spurlos weg. Genau das ist
   * beim russischen Katalog passiert: 130 fertige Eintraege verschwanden, und gemeldet
   * wurde es nur als beilaeufiges "130 offen" in einer Zeile, die man fuer normal haelt.
   *
   * Verglichen werden die Zeitstempel, weil das die Frage genau trifft und nichts kostet.
   */
  const alterQuelltext = fs.statSync(ziel).mtimeMs;
  if (fs.statSync(gebaut).mtimeMs < alterQuelltext) {
    console.error(
      `Der gebaute Katalog fuer "${kennung}" ist aelter als sein Quelltext.\n` +
        'Wuerde jetzt eingetragen, gingen die Eintraege des letzten Stapels verloren.\n' +
        'Erst bauen: npm run build -w packages/mail-core',
    );
    process.exit(1);
  }
  ({ KATALOG: bestand } = await import(`file://${gebaut.replace(/\\/g, '/')}`));
}

const zusammen = { ...bestand, ...neue };

/** Ein Text als einfach zitierte TypeScript-Zeichenkette. */
function alsQuelltext(wert) {
  return `'${wert
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`;
}

/*
 * Die Reihenfolge folgt dem Quelltext, gruppiert nach Datei.
 *
 * Ein Katalog, der alphabetisch sortiert ist, laesst sich nicht durchsehen: Dort steht
 * eine Menuebeschriftung neben einer Fehlermeldung des Servers. Nach Fundort gruppiert
 * liest er sich wie die Oberflaeche selbst - und wer eine Ecke uebersetzt, sieht ihre
 * Nachbarn.
 */
const texte = alleTexte();
const proDatei = new Map();
for (const [schluessel, angaben] of texte) {
  if (!(schluessel in zusammen)) continue;
  const datei = angaben.fundorte[0];
  if (!proDatei.has(datei)) proDatei.set(datei, []);
  proDatei.get(datei).push(schluessel);
}

/** Was im Katalog steht, aber nirgends im Quelltext - soll nicht stillschweigend wegfallen. */
const waisen = Object.keys(zusammen).filter((k) => !texte.has(k));

const zeilen = [];
for (const [datei, schluessel] of proDatei) {
  zeilen.push(`\n  // --- ${datei} ---`);
  for (const s of schluessel) {
    const wert = zusammen[s];
    if (typeof wert === 'string') {
      zeilen.push(`  ${alsQuelltext(s)}: ${alsQuelltext(wert)},`);
    } else {
      const formen = Object.entries(wert)
        .map(([form, text]) => `    ${form}: ${alsQuelltext(text)},`)
        .join('\n');
      zeilen.push(`  ${alsQuelltext(s)}: {\n${formen}\n  },`);
    }
  }
}

const alt = fs.readFileSync(ziel, 'utf-8');
const kopf = alt.slice(0, alt.indexOf('export const KATALOG: Katalog = {'));
fs.writeFileSync(
  ziel,
  `${kopf}export const KATALOG: Katalog = {${zeilen.join('\n')}\n};\n`,
  'utf-8',
);

/*
 * Gezaehlt wird, was tatsaechlich in der Datei steht - nicht, was zusammengerechnet wurde.
 *
 * Vorher stand hier Object.keys(zusammen).length, und darin steckten auch die Waisen, die
 * eine Zeile spaeter verworfen werden. Bei einem umformulierten Text meldete das Werkzeug
 * dann "783 Eintraege (11 eingetragen, -1 offen)" - eine Zahl zu gross und eine Zahl, die
 * es gar nicht geben kann. Wer "-1 offen" liest, glaubt der naechsten Zahl auch nicht mehr.
 */
const geschrieben = [...proDatei.values()].reduce((summe, s) => summe + s.length, 0);
console.log(
  `${kennung}: ${geschrieben} Eintraege ` +
    `(${Object.keys(neue).length} eingetragen, ${texte.size - geschrieben} offen)`,
);
if (waisen.length) {
  console.log(`  Achtung: ${waisen.length} Eintrag/Eintraege ohne Fundstelle wurden verworfen:`);
  for (const w of waisen.slice(0, 5)) console.log(`    ${w}`);
}
