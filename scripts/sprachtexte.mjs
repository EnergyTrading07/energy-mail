/**
 * Welche Texte im Quelltext durch den Übersetzer gehen - und was zu ihnen gehört.
 *
 * Eine Stelle, an der das ermittelt wird, und nicht zwei. Vorher stand die Erkennung nur
 * in sprachstand.mjs; sobald eine zweite Prüfung dieselbe Frage stellt, laufen die beiden
 * Fassungen auseinander, und die eine meldet dann etwas, was die andere nicht sieht.
 *
 * Ermittelt wird zu jedem Text:
 *
 * - **die Platzhalter** (`{anzahl}`, `{ordner}`), damit sich prüfen lässt, ob eine
 *   Übersetzung sie mitbringt. Ein verlorener Platzhalter ist der teuerste Fehler in
 *   einem Katalog: Die Auskunft, die er tragen sollte, fehlt danach ersatzlos, und
 *   auffallen tut das niemandem, der die Sprache nicht liest.
 * - **ob er eine Mehrzahlform ist**, denn dann braucht Polnisch und Russisch mehr als
 *   einen Eintrag.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const BEREICHE = [
  { name: 'Oberflaeche (web)', ordner: 'packages/web/src' },
  { name: 'Huelle (desktop)', ordner: 'packages/desktop/src' },
  { name: 'Server (Meldungen)', ordner: 'packages/server/src' },
  { name: 'Kern (mail-core)', ordner: 'packages/mail-core/src' },
];

/** Alle .ts/.tsx/.mts unter einem Ordner - ohne Pruefdateien und ohne die Kataloge. */
export function dateien(ordner) {
  const ergebnis = [];
  const gehe = (p) => {
    for (const eintrag of fs.readdirSync(p, { withFileTypes: true })) {
      const voll = path.join(p, eintrag.name);
      // Die Kataloge selbst zaehlen nicht mit: dort sind die deutschen Texte die
      // SCHLUESSEL, nicht offene Posten.
      if (eintrag.isDirectory() && eintrag.name === 'sprachen') continue;
      if (eintrag.isDirectory()) gehe(voll);
      else if (/\.(ts|tsx|mts)$/.test(eintrag.name) && !eintrag.name.includes('.test.')) {
        ergebnis.push(voll);
      }
    }
  };
  if (fs.existsSync(path.join(WURZEL, ordner))) gehe(path.join(WURZEL, ordner));
  return ergebnis;
}

/** Kommentare heraus - dort stehen Beispiele, die kein Text der Oberflaeche sind. */
export function entferneKommentare(inhalt) {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** Die Platzhalter eines Textes, als sortierte Liste ohne Doppelte. */
export function platzhalter(text) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/**
 * Alle uebersetzbaren Texte des Quelltextes.
 *
 * Liefert eine Zuordnung Text -> { platzhalter, mehrzahl, fundorte }.
 *
 * `mehrzahl` ist gesetzt, wenn der Text als Mehrzahlform in einem tp() vorkommt. Genau
 * diese Texte brauchen in Polnisch und Russisch mehr als einen Eintrag - und nur diese;
 * fuer die Einzahlform waere eine Kategorientabelle wirkungslos, weil tp() die Mehrzahl
 * nachschlaegt.
 */
export function alleTexte() {
  const gefunden = new Map();

  const merke = (text, datei, alsMehrzahl, imTp = alsMehrzahl) => {
    const vorhanden = gefunden.get(text);
    if (vorhanden) {
      vorhanden.mehrzahl ||= alsMehrzahl;
      vorhanden.imTp ||= imTp;
      if (!vorhanden.fundorte.includes(datei)) vorhanden.fundorte.push(datei);
      return;
    }
    gefunden.set(text, {
      platzhalter: platzhalter(text),
      mehrzahl: alsMehrzahl,
      /*
       * Ob der Text ueberhaupt in einem tp() vorkommt - auch als EINZAHLform.
       *
       * Das entscheidet, ob eine Uebersetzung `{anzahl}` verwenden darf, obwohl der
       * deutsche Text ihn nicht hat. Sie darf: tp() reicht die Zahl immer mit, in beiden
       * Formen. Deutsch schreibt "Eine neue Nachricht" aus, Franzoesisch schreibt
       * "1 nouveau message" - und das ist kein Fehler, sondern eine Entscheidung, die dem
       * Uebersetzer zusteht.
       *
       * Ohne diese Unterscheidung meldete die Pruefung genau das als Befund und zwaenge
       * jede Sprache in die deutsche Schreibweise.
       */
      imTp,
      fundorte: [datei],
    });
  };

  for (const bereich of BEREICHE) {
    for (const voll of dateien(bereich.ordner)) {
      const kurz = path.relative(WURZEL, voll).replace(/\\/g, '/');
      const inhalt = entferneKommentare(fs.readFileSync(voll, 'utf-8'));

      /*
       * tp() zuerst - und das ist keine Geschmacksfrage.
       *
       * Das Muster fuer t() passt auch auf das `t` in `tp`, denn `\bt\(` greift nicht:
       * in "tp(" steht vor der Klammer ein p. Umgekehrt aber wuerde ein spaeter
       * laufendes tp()-Muster die beiden Formen nur noch als gewoehnliche Texte sehen,
       * und die Mehrzahl-Kennzeichnung ginge verloren. Wer zuerst kommt, entscheidet
       * also, ob Polnisch spaeter richtige Saetze bekommt.
       */
      for (const m of inhalt.matchAll(
        /\btp\(\s*[^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
      )) {
        merke(entmaskiere(m[1]), kurz, false, true);
        merke(entmaskiere(m[2]), kurz, true, true);
      }

      for (const m of inhalt.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        merke(entmaskiere(m[1]), kurz, false);
      }
    }
  }

  return gefunden;
}

/**
 * Aus der Schreibweise im Quelltext den tatsaechlichen Text machen.
 *
 * Im Quelltext steht `\n` als zwei Zeichen; zur Laufzeit ist es eines. Der Katalog wird
 * mit dem Laufzeitwert nachgeschlagen - ohne diesen Schritt bekaeme jeder Text mit einem
 * Zeilenumbruch einen Schluessel, den es zur Laufzeit nie gibt, und die Uebersetzung
 * griffe stillschweigend nicht.
 */
export function entmaskiere(roh) {
  return roh
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}
