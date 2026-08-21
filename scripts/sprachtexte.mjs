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

/**
 * Deutscher Text, der in der Oberflaeche steht, ohne durch t() zu gehen.
 *
 * ## Warum das eine eigene Pruefung braucht
 *
 * alleTexte() oben findet, was uebersetzbar IST. Es kann nicht finden, was uebersetzbar
 * sein MUESSTE und es nicht ist - und genau das faellt niemandem auf: Die Oberflaeche
 * sieht auf Deutsch tadellos aus, die Sprachpruefung meldet "kein Befund", und auf
 * Tuerkisch steht mitten im Satz ein deutsches Wort. Gefunden wurden so 79 Stellen, davon
 * eine, die einen Satz zur Haelfte uebersetzte:
 *
 *     <strong>{t('Keine Verbindung.')}</strong> Gezeigt wird der zuletzt geholte Stand …
 *
 * Der uebersetzte Anfang und der deutsche Rest standen unmittelbar nebeneinander.
 *
 * ## Warum der TypeScript-Zerleger und kein Muster
 *
 * Mit einem Muster ueber den rohen Text ging es nicht, und zwar nicht wegen der Sorgfalt:
 * Ein t()-Aufruf ueber mehrere Zeilen laesst sich zeilenweise nicht als versorgt
 * erkennen, und JavaScript-Quelltext (`const [von, setVon] = useState('')`) sieht in
 * jedem hinreichend groben Muster wie Fliesstext aus. Der erste Versuch meldete 176
 * Stellen, von denen zwei Drittel Fehltreffer waren - eine Pruefung, der man nicht
 * glaubt, ist keine. Der Zerleger liefert die JSX-Knoten selbst; danach ist die Frage
 * nicht mehr "sieht das nach Text aus", sondern "IST das ein Textknoten".
 *
 * ## Was als deutsch gilt
 *
 * Umlaute, ein Funktionswort oder schlicht ein Leerzeichen. Ausgenommen sind
 * Beispielwerte, die in einem Eingabefeld stehen und in jeder Sprache gleich lauten -
 * Rechnernamen, Mailadressen, LDAP-Namen, ein PGP-Block. Sie zu uebersetzen waere kein
 * Gewinn, sondern eine Fehlerquelle.
 */

/** Attribute, deren Inhalt ein Mensch zu sehen oder zu hoeren bekommt. */
const SICHTBARE_ATTRIBUTE = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-placeholder',
  'aria-roledescription',
  'title',
  'placeholder',
  'alt',
]);

const FUNKTIONSWOERTER =
  /\b(der|die|das|den|dem|des|und|oder|nicht|ist|sind|wird|werden|war|ein|eine|einen|einem|einer|kein|keine|keinen|mit|von|vom|für|auf|aus|sich|noch|schon|nur|auch|wenn|dann|hier|dort|alle|alles|was|wer|wie|wo|sie|ihre|ihren|ihr|du|dein|deinem|deiner|dich|bitte|mehr|beim|zum|zur|im|am|es|als|bis|nach|vor|über|unter|ohne|gegen|um|damit|weil|dass|man|hat|haben|kann|können|muss|soll|wurde|bleibt|steht|geht|gibt|lässt)\b/i;

/** Ein Beispielwert in einem Eingabefeld - der bleibt in jeder Sprache derselbe. */
function istBeispielwert(text) {
  if (/^[\w.@:/-]+$/.test(text)) return true;
  if (/^-----BEGIN/.test(text)) return true;
  if (/\b(dc|cn|ou)=/.test(text)) return true;
  return /^[\w.-]+@[\w.-]+/.test(text);
}

function siehtDeutschAus(text) {
  if (!/[A-Za-zÄÖÜäöüß]/.test(text)) return false;
  if (istBeispielwert(text)) return false;
  return /[ÄÖÜäöüß]/.test(text) || FUNKTIONSWOERTER.test(text) || /\s/.test(text);
}

/**
 * Alle Stellen, an denen deutscher Text ohne t() in der Oberflaeche landet.
 *
 * Liefert eine Liste aus { text, ort }. Nur .tsx - dort steht das Markup.
 */
export async function festeTexte() {
  const ts = (await import('typescript')).default;
  const treffer = [];

  /** Steckt der Knoten in einem t()- oder tp()-Aufruf? Dann ist er versorgt. */
  const imUebersetzer = (knoten) => {
    for (let p = knoten.parent; p; p = p.parent) {
      if (ts.isCallExpression(p) && ts.isIdentifier(p.expression)) {
        if (p.expression.text === 't' || p.expression.text === 'tp') return true;
      }
    }
    return false;
  };

  for (const bereich of BEREICHE) {
    for (const voll of dateien(bereich.ordner)) {
      if (!/\.tsx$/.test(voll)) continue;
      const kurz = path.relative(WURZEL, voll).split(path.sep).join('/');
      const quelle = ts.createSourceFile(
        voll,
        fs.readFileSync(voll, 'utf-8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const ortVon = (k) =>
        `${kurz}:${quelle.getLineAndCharacterOfPosition(k.getStart(quelle)).line + 1}`;

      const gehe = (knoten) => {
        if (ts.isJsxAttribute(knoten) && knoten.initializer) {
          if (SICHTBARE_ATTRIBUTE.has(knoten.name.getText(quelle))) {
            const wert = knoten.initializer;
            if (ts.isStringLiteral(wert) && siehtDeutschAus(wert.text)) {
              treffer.push({ text: wert.text, ort: ortVon(knoten) });
            } else if (ts.isJsxExpression(wert) && wert.expression) {
              /*
               * Auch Ausdruecke - aria-label={'…'} und aria-label={`… ${x}`}.
               *
               * Diese Klasse fehlte im ersten Anlauf und ist die unauffaelligste: eine
               * Vorlage mit eingesetztem Wert sieht nach Code aus, steht aber woertlich
               * in der Oberflaeche. `aria-label={`Nachrichten in ${ordner}`}` war so ein
               * Fall - die Liste kuendigte sich einem Vorleseprogramm auf Deutsch an,
               * gleich welche Sprache eingestellt war.
               */
              const drin = (k) => {
                const roh =
                  ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k)
                    ? k.text
                    : ts.isTemplateExpression(k)
                      ? k.getText(quelle).slice(1, -1).replace(/\$\{[^}]*\}/g, '…')
                      : null;
                if (roh !== null && siehtDeutschAus(roh) && !imUebersetzer(k)) {
                  treffer.push({ text: roh, ort: ortVon(k) });
                }
                ts.forEachChild(k, drin);
              };
              drin(wert.expression);
            }
          }
        }
        if (ts.isJsxText(knoten)) {
          const text = knoten.text.replace(/\s+/g, ' ').trim();
          if (text.length >= 4 && siehtDeutschAus(text)) {
            treffer.push({ text, ort: ortVon(knoten) });
          }
        }
        ts.forEachChild(knoten, gehe);
      };
      gehe(quelle);
    }
  }
  return treffer;
}
