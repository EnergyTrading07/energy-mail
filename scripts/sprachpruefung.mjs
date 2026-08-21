#!/usr/bin/env node
/**
 * Prueft die Kataloge gegen den Quelltext.
 *
 * Beim Uebersetzen entstehen Fehler, die niemand bemerkt - und zwar aus einem einfachen
 * Grund: Wer den Katalog schreibt, liest die Sprache; wer die Oberflaeche benutzt, liest
 * sie auch. Nur sieht keiner von beiden den deutschen Schluessel daneben. Ein Satz, der
 * einen Platzhalter verloren hat, liest sich vollkommen richtig - er sagt nur nicht mehr,
 * um wie viele Nachrichten es geht.
 *
 * Geprueft wird deshalb genau das, was sich rechnend feststellen laesst:
 *
 *  1. **Waisen** - ein Eintrag, dessen deutscher Schluessel im Quelltext nicht mehr
 *     vorkommt. Entsteht bei jeder Umformulierung und faellt sonst nie auf, weil die
 *     Uebersetzung einfach stumm bleibt.
 *  2. **Platzhalter** - die Menge in der Uebersetzung muss der im Schluessel entsprechen.
 *     Ein verlorener `{anzahl}` nimmt die Auskunft mit; ein erfundener `{ordner}` bleibt
 *     als Text in der Oberflaeche stehen.
 *  3. **Mehrzahlformen** - Polnisch und Russisch brauchen drei Formen, nicht zwei. Wer
 *     nur `other` hinterlegt, baut Saetze, die fast richtig aussehen.
 *  4. **Leere Eintraege** - "" liefert eine leere Beschriftung, waehrend ein fehlender
 *     Eintrag wenigstens auf Deutsch zurueckfaellt. Ein leerer Knopf ist schlimmer als
 *     ein deutscher.
 *  5. **Unveraenderte Uebernahmen** - ein Eintrag, der genau dem deutschen Schluessel
 *     entspricht, ist mit einiger Wahrscheinlichkeit eine vergessene Zeile. Nur ein
 *     Hinweis, kein Fehler: "OK" heisst in jeder Sprache "OK".
 *
 * Aufruf: npm run sprachpruefung
 */
import { alleTexte, festeTexte, platzhalter } from './sprachtexte.mjs';

const SPRACHEN = ['en', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'tr', 'ru'];

/**
 * Welche Mehrzahlformen eine Sprache tatsaechlich verlangt.
 *
 * Nicht von Hand gepflegt, sondern bei Intl erfragt - dieselbe Quelle, die tp() zur
 * Laufzeit benutzt. Eine eigene Tabelle daneben liefe frueher oder spaeter auseinander,
 * und dann pruefte dieses Werkzeug etwas anderes, als das Programm tut.
 */
function verlangteFormen(kennung) {
  const schema = { en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', nl: 'nl-NL',
    pl: 'pl-PL', pt: 'pt-PT', tr: 'tr-TR', ru: 'ru-RU' }[kennung];
  const regeln = new Intl.PluralRules(schema);
  /*
   * Die Kategorien einer Sprache stehen in resolvedOptions().pluralCategories. Sie
   * enthalten auch Formen, die nur bei Bruchzahlen vorkommen (im Franzoesischen "many"
   * fuer 1000000) - deshalb wird zusaetzlich abgetastet, welche Formen bei ganzen Zahlen
   * ueberhaupt auftreten. Sonst verlangte die Pruefung Eintraege, die nie zum Zug kommen.
   */
  const vorkommend = new Set();
  for (let n = 0; n <= 120; n++) vorkommend.add(regeln.select(n));
  return [...vorkommend];
}

const texte = alleTexte();
const befunde = [];
const hinweise = [];

for (const kennung of SPRACHEN) {
  let katalog;
  try {
    ({ KATALOG: katalog } = await import(
      new URL(`../packages/mail-core/dist/sprachen/${kennung}.js`, import.meta.url).href
    ));
  } catch {
    befunde.push(`${kennung}: Katalog nicht gebaut (erst "npm run build -w packages/mail-core").`);
    continue;
  }

  const formen = verlangteFormen(kennung);

  /*
   * Fehlende Eintraege sind ein Befund - seit alle neun Kataloge vollstaendig sind.
   *
   * Vorher waren sie es nicht, und das war richtig: Solange ein Katalog erst zur Haelfte
   * stand, haette diese Pruefung bei jedem Lauf dreihundert Zeilen gemeldet und waere
   * damit wertlos gewesen. Jetzt ist die Lage umgekehrt. Alle neun sind vollstaendig, und
   * genau ab hier faengt das Problem an: Wer morgen einen deutschen Satz in die
   * Oberflaeche schreibt, hat neun Sprachen um einen Eintrag aermer gemacht - und merkt es
   * nie, weil die Ruecklaufkette ihn stillschweigend auffaengt. Nach zwanzig solchen
   * Saetzen ist die tuerkische Oberflaeche wieder halb deutsch.
   *
   * Deshalb bricht die Pruefung. Wer einen Text hinzufuegt, traegt ihn nach - das ist
   * dieselbe Arbeit wie bisher, nur zum richtigen Zeitpunkt statt in einem halben Jahr.
   */
  const fehlend = [...texte.keys()].filter((schluessel) => !(schluessel in katalog));
  if (fehlend.length) {
    befunde.push(
      `${kennung}: ${fehlend.length} Text(e) ohne Uebersetzung. Der Katalog muss ` +
        'vollstaendig bleiben - sonst faellt die Oberflaeche stillschweigend zurueck:',
    );
    for (const s of fehlend.slice(0, 10)) befunde.push(`      "${kuerze(s)}"`);
    if (fehlend.length > 10) befunde.push(`      … und ${fehlend.length - 10} weitere`);
  }

  for (const [schluessel, wert] of Object.entries(katalog)) {
    const angaben = texte.get(schluessel);

    if (!angaben) {
      befunde.push(`${kennung}: Waise - "${kuerze(schluessel)}" kommt im Quelltext nicht vor.`);
      continue;
    }

    /*
     * In einem tp() darf `{anzahl}` auch dann stehen, wenn der deutsche Text ihn nicht hat.
     *
     * tp() reicht die Zahl immer mit, in BEIDEN Formen. Deutsch schreibt die Einzahl aus
     * ("Eine neue Nachricht"), Franzoesisch setzt die Ziffer ("1 nouveau message") - beides
     * ist richtig, und die Entscheidung steht dem Uebersetzer zu. Ohne diese Ausnahme
     * meldete die Pruefung sie als Fehler und zwaenge jede Sprache in die deutsche Form.
     */
    const zusaetzlich = angaben.imTp && !angaben.platzhalter.includes('anzahl') ? 'anzahl' : null;
    const erwartet = angaben.platzhalter.join(',');

    if (typeof wert === 'string') {
      pruefeEinen(kennung, schluessel, wert, erwartet, zusaetzlich);
      /*
       * Eine Mehrzahlform als schlichter Text ist nur dort ein Befund, wo die Sprache
       * mehr als zwei Formen kennt. Englisch, Franzoesisch, Niederlaendisch und die
       * uebrigen kommen mit der eingebauten Regel aus - dort ist ein einzelner Text
       * genau richtig und keine Nachlaessigkeit.
       */
      if (angaben.mehrzahl && formen.length > 2) {
        befunde.push(
          `${kennung}: "${kuerze(schluessel)}" ist eine Mehrzahlform, steht aber als ` +
            `einzelner Text. ${kennung} braucht ${formen.length} Formen (${formen.join(', ')}).`,
        );
      }
      continue;
    }

    if (!angaben.mehrzahl) {
      befunde.push(
        `${kennung}: "${kuerze(schluessel)}" hat Mehrzahlformen, wird aber nicht ` +
          'ueber tp() gerufen - die Kategorien kommen nie zum Zug.',
      );
    }

    for (const form of formen) {
      if (!(form in wert)) {
        befunde.push(`${kennung}: "${kuerze(schluessel)}" fehlt die Form "${form}".`);
        continue;
      }
      pruefeEinen(kennung, `${schluessel} [${form}]`, wert[form], erwartet, zusaetzlich);
    }
    for (const form of Object.keys(wert)) {
      // "other" ist in tp() die ausdrueckliche Rueckfallebene und darf ueberall stehen,
      // auch wo es bei ganzen Zahlen nie gewaehlt wird - im Russischen etwa.
      if (form !== 'other' && !formen.includes(form)) {
        hinweise.push(
          `${kennung}: "${kuerze(schluessel)}" hat die Form "${form}", die in dieser ` +
            'Sprache bei ganzen Zahlen nie vorkommt.',
        );
      }
    }
  }
}

function pruefeEinen(kennung, wo, wert, erwartet, zusaetzlich) {
  if (typeof wert !== 'string') {
    befunde.push(`${kennung}: "${kuerze(wo)}" ist kein Text.`);
    return;
  }
  if (wert.trim() === '') {
    befunde.push(
      `${kennung}: "${kuerze(wo)}" ist leer. Ein leerer Knopf ist schlimmer als ein ` +
        'deutscher - dann lieber den Eintrag weglassen.',
    );
    return;
  }
  // Der zusaetzlich erlaubte Platzhalter zaehlt nicht mit, wenn er da ist.
  const haben = platzhalter(wert)
    .filter((p) => p !== zusaetzlich)
    .join(',');
  if (haben !== erwartet) {
    befunde.push(
      `${kennung}: "${kuerze(wo)}" - Platzhalter stimmen nicht. ` +
        `Erwartet {${erwartet || '-'}}, gefunden {${haben || '-'}}.`,
    );
  }
}

/*
 * Unveraenderte Uebernahmen - nur als Hinweis.
 *
 * Ein Eintrag, der genau dem deutschen Schluessel entspricht, ist meistens eine vergessene
 * Zeile. Manchmal aber auch richtig: "OK", "IMAP" und "Energy Mail" heissen ueberall so.
 * Deshalb kein Fehler, sondern eine Liste zum Durchsehen.
 */
for (const kennung of SPRACHEN) {
  let katalog;
  try {
    ({ KATALOG: katalog } = await import(
      new URL(`../packages/mail-core/dist/sprachen/${kennung}.js`, import.meta.url).href
    ));
  } catch {
    continue;
  }
  const gleich = Object.entries(katalog).filter(
    ([schluessel, wert]) => typeof wert === 'string' && wert === schluessel && schluessel.length > 3,
  );
  if (gleich.length) {
    hinweise.push(
      `${kennung}: ${gleich.length} Eintrag/Eintraege stehen unveraendert auf Deutsch ` +
        `(z. B. "${kuerze(gleich[0][0])}").`,
    );
  }
}

/*
 * Und zuletzt die Gegenprobe: deutscher Text, der gar nicht erst durch t() geht.
 *
 * Alles darueber prueft die Kataloge gegen den Quelltext - also das, was uebersetzbar
 * IST. Die haeufigere Luecke liegt davor: ein Satz, der nie beim Uebersetzer ankommt.
 * Er faellt in keiner der obigen Pruefungen auf, denn wo kein Schluessel ist, fehlt auch
 * keine Uebersetzung; die Oberflaeche sieht auf Deutsch tadellos aus und meldet "kein
 * Befund", waehrend auf Tuerkisch ein deutscher Halbsatz mitten im Text steht.
 *
 * Ein Befund und kein Hinweis: Ein Hinweis waechst mit, bis ihn niemand mehr liest -
 * genau so sind die 79 Stellen entstanden, mit denen diese Pruefung eingefuehrt wurde.
 */
for (const { text, ort } of await festeTexte()) {
  befunde.push(`${ort}: "${kuerze(text)}" steht fest im Quelltext - gehoert durch t().`);
}

function kuerze(text) {
  const eine = text.replace(/\n/g, '\\n');
  return eine.length > 60 ? `${eine.slice(0, 57)}…` : eine;
}

console.log('\nPruefung der Kataloge\n');

if (hinweise.length) {
  console.log(`${hinweise.length} Hinweis(e):`);
  for (const h of hinweise) console.log(`  · ${h}`);
  console.log('');
}

if (befunde.length === 0) {
  console.log(`Kein Befund. ${texte.size} Texte im Quelltext, ${SPRACHEN.length} Kataloge.\n`);
  process.exit(0);
}

console.log(`${befunde.length} Befund(e):`);
for (const b of befunde) console.log(`  FEHL ${b}`);
console.log('');
process.exit(1);
