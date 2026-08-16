#!/usr/bin/env node
/**
 * Wie weit ist die Umstellung auf mehrere Sprachen?
 *
 * Eine Übersetzung ist nie "fertig", sie ist immer "zu soundsoviel Prozent". Ohne eine
 * Zahl bleibt der Stand eine Behauptung - und die Erfahrung mit solchen Vorhaben ist, dass
 * sie bei achtzig Prozent aufhören und niemandem auffällt, weil die restlichen zwanzig
 * genau die selten benutzten Ecken sind.
 *
 * Dieses Werkzeug zählt zweierlei:
 *
 *  1. **Was schon durch t() geht** - und ob es dafür eine englische Übersetzung gibt.
 *     Eine Waise (Text umformuliert, Katalog nicht nachgezogen) faellt hier auf.
 *  2. **Was noch als deutscher Text im Quelltext steht.** Das ist die eigentliche Arbeit,
 *     und die Zahl daneben sagt, wie viel davon noch aussteht.
 *
 * Aufruf: npm run sprachstand [--liste]
 *
 * Bewusst eine Naeherung und kein Parser: gesucht wird nach dem, was ein Mensch als
 * Beschriftung schreiben wuerde. Es zaehlt lieber ein Wort zu viel als eines zu wenig -
 * eine Zahl, die zu gut aussieht, waere schlimmer als gar keine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LISTE = process.argv.includes('--liste');

/** Wo ueberall Beschriftungen stehen, die ein Nutzer zu sehen bekommt. */
const BEREICHE = [
  { name: 'Oberflaeche (web)', ordner: 'packages/web/src' },
  { name: 'Huelle (desktop)', ordner: 'packages/desktop/src' },
  { name: 'Server (Meldungen)', ordner: 'packages/server/src' },
  { name: 'Kern (mail-core)', ordner: 'packages/mail-core/src' },
];

/** Deutsche Woerter, an denen sich ein Text als Beschriftung zu erkennen gibt. */
const DEUTSCH =
  /\b(der|die|das|und|oder|nicht|ist|sind|wird|werden|kein|keine|eine|einen|einem|dieser|diese|dieses|Sie|wurde|kann|muss|soll|noch|schon|beim|vom|zum|zur|fuer|für|mit|ohne|auf|aus|nach|bei|von)\b/i;

/** Alle .ts/.tsx unter einem Ordner, ohne Pruefdateien. */
function dateien(ordner) {
  const ergebnis = [];
  const gehe = (p) => {
    for (const eintrag of fs.readdirSync(p, { withFileTypes: true })) {
      const voll = path.join(p, eintrag.name);
      /*
       * Die Kataloge selbst zaehlen nicht mit.
       *
       * In sprachen/en.ts stehen die deutschen Texte als SCHLUESSEL - das ist der Aufbau
       * dieses Katalogs und keine vergessene Stelle. Sie mitzuzaehlen hiesse, jede
       * Uebersetzung auch als offenen Posten zu fuehren: je weiter die Arbeit kaeme,
       * desto schlechter saehe die Zahl aus.
       */
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

/**
 * Texte, die bereits durch t() bzw. tp() gehen.
 *
 * Nur einfache Anfuehrungszeichen: so schreibt dieses Projekt durchgehend, und ein
 * Muster, das auch Backticks erfasst, faengt Vorlagen mit ${} ein - die sind keine
 * uebersetzbaren Texte, sondern zusammengesetzte.
 */
function schonUebersetzt(inhalt) {
  /*
   * Auch hier ohne Kommentare - und das hat das Werkzeug an sich selbst vorgefuehrt.
   *
   * In sprache.ts steht im erklaerenden Kommentar `t('nachricht.neu')` als Gegenbeispiel
   * fuer symbolische Schluessel. Ohne dieses Herausschneiden meldete der Lauf genau diese
   * erfundenen Schluessel als "geht durch t(), hat aber kein Englisch" - zwei Geister, die
   * sich nie haetten uebersetzen lassen und die bei jedem Lauf wieder dagestanden haetten.
   */
  const ohneKommentare = entferneKommentare(inhalt);
  const treffer = [];
  for (const m of ohneKommentare.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) treffer.push(m[1]);
  for (const m of ohneKommentare.matchAll(
    /\btp\(\s*[^,]+,\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'/g,
  )) {
    treffer.push(m[1], m[2]);
  }
  return treffer;
}

/** Kommentare heraus - sie sind fuer Entwickler und bleiben deutsch. */
function entferneKommentare(inhalt) {
  return inhalt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/**
 * Protokollzeilen heraus - sie bleiben deutsch, und zwar mit Absicht.
 *
 * Das ist keine Bequemlichkeit, sondern eine Entscheidung: Was `protokolliere()` und
 * `console.warn()` schreiben, landet im Protokoll und damit im Fehlerbericht. Den liest,
 * wer das Programm baut - und der liest Deutsch. Eine Fehlersuche, bei der die eine
 * Haelfte der Zeilen tuerkisch ist, weil der Nutzer die Oberflaeche umgestellt hat, waere
 * schwerer und nicht leichter.
 *
 * Ohne diese Zeilen zaehlte das Werkzeug rund achtzig Texte als "noch zu uebersetzen", die
 * niemand uebersetzen sollte - und die Zahl, an der sich der Fortschritt ablesen laesst,
 * waere dauerhaft zu hoch.
 *
 * Eine Naeherung: Gestrichen wird vom Aufruf bis zur ersten Klammer, die eine Zeile
 * abschliesst. Bei einem mehrzeiligen Aufruf mit eingebetteten Klammern kann sie zu frueh
 * greifen; dann zaehlt ein Text zu viel, und das ist die richtige Richtung fuer einen
 * Fehler in einem Messwerkzeug.
 */
function entferneProtokollzeilen(inhalt) {
  return inhalt.replace(
    /\b(protokolliere|console\.(?:warn|log|error|info|debug))\s*\([\s\S]*?\);\s*$/gm,
    '',
  );
}

/**
 * Deutsche Texte, die noch NICHT durch t() gehen.
 *
 * Was in einem Kommentar steht, zaehlt nicht - Kommentare sind fuer Entwickler und bleiben
 * deutsch. Das ist die groesste Fehlerquelle dieser Naeherung, denn dieses Projekt
 * kommentiert ausfuehrlich; deshalb werden Kommentare vorher herausgeschnitten.
 */
function nochDeutsch(inhalt) {
  const ohneKommentare = entferneProtokollzeilen(entferneKommentare(inhalt));

  const treffer = new Set();

  /*
   * Was diese Datei schon durch t() schickt, zaehlt hier nicht noch einmal.
   *
   * Der Blick auf die vier Zeichen davor (weiter unten) erkennt `t('Text')`, aber nicht
   * den umbrochenen Aufruf:
   *
   *     t(
   *       'Ein langer Satz, der nicht in eine Zeile passt.',
   *     )
   *
   * Und genau so steht es nach jeder Umstellung da, weil der Formatierer lange Texte
   * umbricht. Das Werkzeug meldete deshalb 56 Texte als "noch deutsch", die alle bereits
   * uebersetzt waren - die Zahl haette sich von da an nicht mehr bewegt, egal wie viel
   * Arbeit noch hineingeht. Ein Messwerkzeug, das den Fortschritt nicht mehr abbildet,
   * ist schlimmer als keines.
   */
  const bereits = new Set(schonUebersetzt(inhalt));

  /*
   * Zeichenketten in Anfuehrungszeichen, die nach einem Satz aussehen.
   *
   * Das \n in der Ausschlussmenge ist der wichtigste Teil dieser Zeile, und es fehlte in
   * der ersten Fassung. Ohne es lief das Muster vom einen Apostroph bis zum naechsten -
   * ueber Zeilenenden hinweg, quer durch den Quelltext. Es zaehlte dann ganze
   * Codebloecke als "ein deutscher Text", und die gemeldete Zahl fuer die Oberflaeche war
   * deshalb um ein Vielfaches zu hoch. Eine Messung, die zu schlecht aussieht, ist so
   * wertlos wie eine, die zu gut aussieht - nur faellt diese hier wenigstens auf, sobald
   * man die Liste liest.
   */
  for (const m of ohneKommentare.matchAll(/'((?:[^'\\\n]|\\.){4,})'/g)) {
    const text = m[1];
    if (bereits.has(text)) continue;
    if (!DEUTSCH.test(text) && !/[ÄÖÜäöüß]/.test(text)) continue;
    // Einbindungen und Schluesselnamen sind kein Text fuer den Nutzer.
    if (/^[a-z@./-]+$/.test(text) || text.includes('://')) continue;
    // Was schon durch t() geht, steht ebenfalls in Anfuehrungszeichen - es zaehlt hier
    // nicht noch einmal.
    const davor = ohneKommentare.slice(Math.max(0, m.index - 4), m.index);
    if (/\bt?p?\(\s*$/.test(davor) || /,\s*$/.test(davor)) continue;
    treffer.add(text);
  }

  // Text zwischen JSX-Marken: >Neue Nachricht<
  for (const m of ohneKommentare.matchAll(/>\s*([A-ZÄÖÜ][^<>{}\n]{3,})\s*</g)) {
    const text = m[1].trim();
    if (bereits.has(text)) continue;
    if (DEUTSCH.test(text) || /[ÄÖÜäöüß]/.test(text)) treffer.add(text);
  }

  return [...treffer];
}

const { EN } = await import(
  new URL('../packages/mail-core/dist/sprachen/en.js', import.meta.url).href
).catch(() => ({ EN: null }));

if (!EN) {
  console.error('Der Katalog ist nicht gebaut. Erst "npm run build -w packages/mail-core".');
  process.exit(1);
}

console.log('\nStand der Uebersetzung\n');
console.log('Bereich                 uebersetzbar   davon englisch   noch deutsch');
console.log('─'.repeat(72));

let gesamtT = 0;
let gesamtEn = 0;
let gesamtOffen = 0;
const offeneListe = [];
/**
 * Texte, die schon durch t() gehen, aber keine englische Fassung haben.
 *
 * Das Gegenstueck zu den Waisen weiter unten - und die haeufigere Nachlaessigkeit: Man
 * stellt eine Datei um und vergisst den Katalog. Sichtbar wird das sonst erst dem
 * englischen Nutzer, dem mitten in der Oberflaeche ein deutscher Satz begegnet.
 */
const ohneUebersetzung = [];

for (const bereich of BEREICHE) {
  let mitT = new Set();
  let offen = new Set();

  for (const datei of dateien(bereich.ordner)) {
    const inhalt = fs.readFileSync(datei, 'utf-8');
    for (const text of schonUebersetzt(inhalt)) mitT.add(text);
    for (const text of nochDeutsch(inhalt)) offen.add(text);
  }

  const uebersetzt = [...mitT].filter((text) => text in EN).length;
  for (const text of mitT) if (!(text in EN)) ohneUebersetzung.push(text);
  gesamtT += mitT.size;
  gesamtEn += uebersetzt;
  gesamtOffen += offen.size;
  if (LISTE && offen.size) offeneListe.push([bereich.name, [...offen]]);

  const anteil = mitT.size ? Math.round((uebersetzt / mitT.size) * 100) : 100;
  console.log(
    `${bereich.name.padEnd(22)} ${String(mitT.size).padStart(8)}   ${String(uebersetzt).padStart(9)} (${String(anteil).padStart(3)}%)   ${String(offen.size).padStart(9)}`,
  );
}

console.log('─'.repeat(72));
console.log(
  `${'Zusammen'.padEnd(22)} ${String(gesamtT).padStart(8)}   ${String(gesamtEn).padStart(9)} (${String(gesamtT ? Math.round((gesamtEn / gesamtT) * 100) : 100).padStart(3)}%)   ${String(gesamtOffen).padStart(9)}`,
);

if (ohneUebersetzung.length) {
  console.log(`\n${ohneUebersetzung.length} Text(e) gehen durch t(), haben aber kein Englisch:`);
  for (const text of ohneUebersetzung) console.log(`  ${JSON.stringify(text)}`);
}

const waisen = [...new Set(Object.keys(EN))].filter((text) => {
  for (const bereich of BEREICHE) {
    for (const datei of dateien(bereich.ordner)) {
      if (fs.readFileSync(datei, 'utf-8').includes(`'${text}'`)) return false;
    }
  }
  return true;
});

if (waisen.length) {
  console.log(`\n${waisen.length} Eintrag/Eintraege im Katalog ohne Fundstelle im Quelltext:`);
  for (const w of waisen.slice(0, 10)) console.log(`  ${w}`);
  console.log('  (Text umformuliert? Dann gehoert der Katalog nachgezogen.)');
}

if (LISTE) {
  for (const [name, texte] of offeneListe) {
    console.log(`\n${name} - noch nicht uebersetzbar:`);
    for (const text of texte.slice(0, 40)) console.log(`  ${text}`);
    if (texte.length > 40) console.log(`  … und ${texte.length - 40} weitere`);
  }
}

console.log('\nMit --liste stehen die offenen Texte einzeln da.\n');
