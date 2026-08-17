/**
 * Die Sprache der Oberfläche.
 *
 * Energy Mail war durchgehend deutsch - jede Beschriftung, jede Meldung, jeder Dialog fest
 * im Quelltext. Für einen deutschen Mittelständler ist das kein Problem; für jeden Kunden
 * mit auch nur einer nicht deutschsprachigen Abteilung ist es ein Ausschlusskriterium.
 * Der Aufwand steckt dabei nicht im Übersetzen, sondern darin, die Texte überhaupt
 * herauslösbar zu machen.
 *
 * ## Der deutsche Text IST der Schlüssel
 *
 * `t('Neue Nachricht')` statt `t('nachricht.neu')`. Das ist die wichtigste Entscheidung
 * hier, und sie ist gegen die übliche Lehre getroffen:
 *
 * - **Nichts kann kaputtgehen.** Fehlt eine Übersetzung, steht der deutsche Text da - also
 *   genau das, was heute schon dort steht. Bei symbolischen Schlüsseln stünde
 *   "nachricht.neu" in der Oberfläche, und ein vergessener Eintrag wäre ein sichtbarer
 *   Fehler statt einer stillen Rückfallebene.
 * - **Die Umstellung geht Datei für Datei.** Es braucht keinen Katalog, den man vorher
 *   erfinden und pflegen muss, und keine Runde, in der alles halb umgestellt ist.
 * - **Der Quelltext bleibt lesbar.** Wer `t('Postfach aufräumen…')` liest, weiß, was dort
 *   steht. Bei `t('extras.aufraeumen')` muss er nachschlagen.
 *
 * Der Preis, ehrlich benannt: Ändert jemand den deutschen Text, ist die Übersetzung
 * verwaist und fällt auf Deutsch zurück. Das ist verkraftbar - und `npm run sprachstand`
 * findet solche Waisen.
 *
 * ## Kein fremdes Paket
 *
 * i18next und Verwandte bringen Namensräume, Kontexte, Ordinalzahlen und ein Ladesystem
 * mit. Gebraucht werden hier zwei Dinge: einsetzen und Mehrzahl. Der Rest wäre eine
 * Abhängigkeit, die bei jeder Aktualisierung mitgeprüft werden will.
 */

export type Sprache = 'de' | 'en' | 'fr' | 'es' | 'it' | 'nl' | 'pl' | 'pt' | 'tr' | 'ru';

/**
 * Was zu einer Sprache gehört - über den Katalog hinaus.
 *
 * Der eigene Name steht in der eigenen Sprache: Wer eine Oberfläche vorfindet, die er
 * nicht liest, sucht "Français" und nicht "Französisch". So macht es jedes
 * Betriebssystem.
 *
 * Das Gebietsschema entscheidet über Datum, Zahlen und Sortierung. Es steht hier und
 * nicht an fünfundzwanzig Stellen im Quelltext - genau dort stand es nämlich, fest
 * verdrahtet als 'de-DE', und ein französischer Nutzer hätte deutsche Datumsformate
 * gesehen.
 */
export interface Sprachangaben {
  name: string;
  gebietsschema: string;
  /** Von rechts nach links. Heute bei keiner - das Feld ist der Platzhalter dafür. */
  vonRechts?: boolean;
}

/**
 * Die Sprachen, die es gibt. Deutsch ist die Quelle und braucht keinen Katalog.
 *
 * Ausgewählt nach dem, was ein Mailprogramm in Europa antrifft, plus Türkisch und
 * Russisch. Was hier steht, ist eine Zusage: Für jede dieser Sprachen gilt die
 * Mehrzahlregel, das Datumsformat und die Sortierung - auch dann, wenn der Katalog noch
 * lückenhaft ist. Eine Sprache aufzunehmen kostet also nichts außer Übersetzung.
 */
export const SPRACHEN: Record<Sprache, Sprachangaben> = {
  de: { name: 'Deutsch', gebietsschema: 'de-DE' },
  en: { name: 'English', gebietsschema: 'en-GB' },
  fr: { name: 'Français', gebietsschema: 'fr-FR' },
  es: { name: 'Español', gebietsschema: 'es-ES' },
  it: { name: 'Italiano', gebietsschema: 'it-IT' },
  nl: { name: 'Nederlands', gebietsschema: 'nl-NL' },
  pl: { name: 'Polski', gebietsschema: 'pl-PL' },
  pt: { name: 'Português', gebietsschema: 'pt-PT' },
  tr: { name: 'Türkçe', gebietsschema: 'tr-TR' },
  ru: { name: 'Русский', gebietsschema: 'ru-RU' },
};

const KENNUNGEN = Object.keys(SPRACHEN) as Sprache[];

/**
 * Was einer Sprachwahl zur Auswahl steht - abgeleitet und nicht danebengeschrieben.
 *
 * Steht hier und nicht in einer der beiden Oberflächen, weil es beide brauchen: das Menü
 * der Desktop-Hülle und die Auswahl im Browser. Eine zweite Liste neben der ersten geht
 * genau so lange gut, bis jemand nur eine davon ergänzt - und dann fehlt die neue Sprache
 * an einer Stelle, obwohl ihr Katalog vorliegt. Niemand sucht den Fehler dort, weil "die
 * Sprache ist eingebaut" ja stimmt.
 *
 * Die Namen bleiben unübersetzt: Wer die Oberfläche auf einer Sprache vorfindet, die er
 * nicht liest, sucht seine eigene - und "Deutsch" erkennt er, "German" womöglich nicht.
 * So macht es jedes Betriebssystem.
 */
export const SPRACHWAHL: { wert: string; name: string }[] = [
  { wert: 'automatisch', name: 'Automatisch / Automatic' },
  ...(Object.entries(SPRACHEN) as [Sprache, Sprachangaben][]).map(([wert, angaben]) => ({
    wert,
    name: angaben.name,
  })),
];

/**
 * Ein Katalog: deutscher Text auf übersetzten Text.
 *
 * Bewusst flach und ohne Namensräume. Bei 500 Einträgen ist eine Ebene übersichtlicher
 * als eine Verschachtelung, in der man erst den Ast suchen muss.
 *
 * Der Wert ist entweder ein Text oder - bei Mehrzahlformen - eine Zuordnung nach den
 * Kategorien von CLDR (`one`, `few`, `many`, `other`, …). Deutsch und Englisch kommen mit
 * zwei Formen aus, Polnisch braucht drei, Russisch ebenfalls. Wer nur zwei kennt, baut
 * für diese Sprachen falsche Sätze - und merkt es nie, weil sie grammatisch fast richtig
 * aussehen.
 */
export type Katalogeintrag = string | Partial<Record<Intl.LDMLPluralRule, string>>;
export type Katalog = Record<string, Katalogeintrag>;

const kataloge = new Map<Sprache, Katalog>();
let aktuell: Sprache = 'de';

/** Hinterlegt die Übersetzungen einer Sprache. */
export function lerneKatalog(sprache: Sprache, katalog: Katalog): void {
  kataloge.set(sprache, { ...(kataloge.get(sprache) ?? {}), ...katalog });
}

export function setzeSprache(neu: Sprache): void {
  aktuell = neu in SPRACHEN ? neu : 'de';
}

/**
 * Woher die geltende Sprache kommt.
 *
 * In der Hülle und in der Oberfläche ist es eine Einstellung des Programms - ein Wert,
 * der beim Start feststeht. Im Server ist es das nicht: Dort bedient ein Prozess viele
 * Menschen gleichzeitig, und die Sprache gehört zur ANFRAGE, nicht zum Programm. Eine
 * Variable im Modul wäre dort schlicht falsch - der eine bekäme die Sprache des anderen,
 * je nachdem, wer zuletzt geschrieben hat.
 *
 * Deshalb ist die Quelle austauschbar. Der Server hängt hier seinen Anfragekontext ein
 * (siehe server/src/sprachkontext.ts), alle anderen lassen es, wie es ist.
 */
let quelle: (() => Sprache) | null = null;

export function setzeSprachquelle(fn: (() => Sprache) | null): void {
  quelle = fn;
}

export function sprache(): Sprache {
  return quelle?.() ?? aktuell;
}

/** Das Gebietsschema der geltenden Sprache - für Datum, Zahlen und Sortierung. */
export function gebietsschema(): string {
  return SPRACHEN[sprache()].gebietsschema;
}

/**
 * Zahl, Datum und Uhrzeit in der geltenden Sprache.
 *
 * Diese drei stehen hier, weil sie sonst nirgends stünden: Im Quelltext war
 * `toLocaleDateString('de-DE')` fünfundzwanzigmal ausgeschrieben. Solange es nur Deutsch
 * gab, war das richtig; bei der ersten weiteren Sprache wird daraus ein Fehler, den
 * niemand sucht, weil die Oberfläche ja übersetzt ist.
 */
export function zahl(wert: number): string {
  return wert.toLocaleString(gebietsschema());
}

export function datum(wert: Date, optionen?: Intl.DateTimeFormatOptions): string {
  return wert.toLocaleDateString(gebietsschema(), optionen);
}

export function uhrzeit(wert: Date, optionen?: Intl.DateTimeFormatOptions): string {
  return wert.toLocaleTimeString(gebietsschema(), optionen);
}

/** Vergleicht zwei Texte so, wie es die geltende Sprache erwartet. */
export function vergleiche(a: string, b: string): number {
  return a.localeCompare(b, gebietsschema());
}

/**
 * Entscheidet, welche Sprache gilt.
 *
 * Rein rechnend, damit sich jeder Fall prüfen lässt - und die Reihenfolge ist dieselbe wie
 * beim Proxy und bei der Anmeldung, weil dieselben Gründe gelten:
 *
 * 1. **Richtlinie.** In einem Unternehmen mit englischer Arbeitssprache soll nicht jeder
 *    Arbeitsplatz eine andere Oberfläche zeigen, nur weil Windows verschieden eingestellt
 *    ist.
 * 2. **Die Wahl des Nutzers.** Wer umstellt, meint es.
 * 3. **Das Betriebssystem.** Der Regelfall, und er kommt ohne jede Einstellung aus.
 *
 * Was nicht erkannt wird, ergibt Deutsch: Das ist die Quelle, und für sie gibt es
 * garantiert einen vollständigen Text.
 */
export function waehleSprache(quellen: {
  richtlinie?: string;
  nutzer?: string;
  system?: string;
}): Sprache {
  for (const wert of [quellen.richtlinie, quellen.nutzer, quellen.system]) {
    const erkannt = alsSprache(wert);
    if (erkannt) return erkannt;
  }
  return 'de';
}

/**
 * Liest eine Sprachangabe, wie sie tatsächlich vorkommt.
 *
 * Betriebssysteme und Browser liefern "de-DE", "en-GB", "de_AT" oder "en". Verglichen wird
 * deshalb nur der Teil davor - die Unterscheidung zwischen britischem und amerikanischem
 * Englisch führte zu zwei Katalogen, die sich in nichts unterscheiden.
 *
 * "automatisch" ist ausdrücklich KEINE Sprache: So heißt die Einstellung "nimm das
 * Betriebssystem", und sie muss durchfallen, damit die nächste Quelle drankommt.
 */
export function alsSprache(wert: string | undefined | null): Sprache | null {
  const kurz = (wert ?? '').trim().toLowerCase().split(/[-_]/)[0];
  if (!kurz || kurz === 'automatisch' || kurz === 'auto') return null;
  return KENNUNGEN.includes(kurz as Sprache) ? (kurz as Sprache) : null;
}

/**
 * Liest eine Accept-Language-Kopfzeile - fuer den Serverbetrieb.
 *
 * Sie sieht so aus: "fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7". Die Zahl dahinter ist die
 * Gewichtung; ohne Angabe gilt 1. Genommen wird die erste Sprache in der Reihenfolge der
 * Gewichtung, die es hier ueberhaupt gibt - nicht einfach die erste, denn die kann eine
 * sein, fuer die es keinen Katalog gibt.
 */
export function ausAcceptLanguage(kopfzeile: string | undefined): Sprache | null {
  if (!kopfzeile) return null;
  const wuensche = kopfzeile
    .split(',')
    .map((teil) => {
      const [wert, ...rest] = teil.trim().split(';');
      const q = rest.find((r) => r.trim().startsWith('q='));
      return { wert: wert ?? '', gewicht: q ? Number(q.split('=')[1]) || 0 : 1 };
    })
    .sort((a, b) => b.gewicht - a.gewicht);

  for (const wunsch of wuensche) {
    const erkannt = alsSprache(wunsch.wert);
    if (erkannt) return erkannt;
  }
  return null;
}

/**
 * Übersetzt - und setzt Werte ein.
 *
 * Die Platzhalter stehen in geschweiften Klammern: `t('{anzahl} neue Nachrichten',
 * { anzahl: 3 })`. Sie bleiben in der Übersetzung dieselben, damit ein Katalog die
 * Wortstellung ändern darf, ohne dass hier etwas nachgezogen werden muss - im Englischen
 * steht die Zahl oft an anderer Stelle als im Deutschen.
 *
 * Ein Platzhalter ohne Wert bleibt stehen, statt zu "undefined" zu werden: Im Zweifel ist
 * "{anzahl} neue Nachrichten" eine Auskunft, "undefined neue Nachrichten" ist keine.
 */
/**
 * Wo nachgeschlagen wird, und in welcher Reihenfolge.
 *
 * Englisch steht bei jeder anderen Sprache dazwischen, und das ist keine Formsache: Ein
 * französischer Nutzer, dem ein Eintrag fehlt, versteht "Save search" mit einiger
 * Wahrscheinlichkeit - "Suche merken" versteht er nicht. Der deutsche Quelltext bleibt
 * die letzte Zuflucht, weil er als einziger garantiert vollständig ist.
 */
function kette(fuer: Sprache): Sprache[] {
  return fuer === 'de' ? [] : fuer === 'en' ? ['en'] : [fuer, 'en'];
}

/** Schlägt einen Eintrag nach - über die ganze Kette. */
function nachschlagen(text: string): Katalogeintrag | undefined {
  for (const s of kette(sprache())) {
    const eintrag = kataloge.get(s)?.[text];
    if (eintrag !== undefined) return eintrag;
  }
  return undefined;
}

function einsetzen(text: string, werte?: Record<string, string | number>): string {
  if (!werte) return text;
  return text.replace(/\{(\w+)\}/g, (ganzes, name: string) =>
    name in werte ? String(werte[name]) : ganzes,
  );
}

export function t(deutsch: string, werte?: Record<string, string | number>): string {
  const eintrag = nachschlagen(deutsch);
  const uebersetzt =
    typeof eintrag === 'string' ? eintrag : (eintrag?.other ?? deutsch);
  return einsetzen(uebersetzt, werte);
}

/**
 * Übersetzt mit Einzahl und Mehrzahl.
 *
 * Deutsch und Englisch teilen dieselbe Regel - eins gegen alles andere, und die Null
 * gehört zur Mehrzahl ("0 Nachrichten", "0 messages"). Für eine Sprache mit mehr Formen
 * (Polnisch, Russisch) genügt das nicht; dann gehört hier eine Tabelle hin und nicht ein
 * weiterer Sonderfall.
 *
 * `{anzahl}` steht in beiden Formen zur Verfügung.
 */
export function tp(
  anzahl: number,
  einzahl: string,
  mehrzahl: string,
  werte?: Record<string, string | number>,
): string {
  /*
   * Die richtige Form über Intl.PluralRules statt über "=== 1".
   *
   * Hier stand vorher genau das: `anzahl === 1 ? einzahl : mehrzahl`. Für Deutsch,
   * Englisch, Niederländisch, Italienisch und Spanisch ist das richtig. Für Polnisch ist
   * es falsch - dort heißt es "1 wiadomość", "2 wiadomości", aber "5 wiadomości" mit
   * einer DRITTEN Form; Russisch ebenso, Türkisch dagegen kennt nur eine. Wer mit zwei
   * Formen auskommen will, baut in diesen Sprachen Sätze, die fast richtig aussehen und
   * es nicht sind - und niemand meldet das, weil die Oberfläche ja "übersetzt" ist.
   *
   * Der Katalog darf deshalb eine Zuordnung nach Kategorien hinterlegen. Tut er es nicht,
   * gilt weiter die einfache Regel - damit bleiben alle bestehenden Einträge gültig, und
   * eine Sprache mit zwei Formen braucht keinen zusätzlichen Aufwand.
   */
  const eintrag = nachschlagen(mehrzahl);

  if (eintrag && typeof eintrag !== 'string') {
    const form = pluralkategorie(anzahl);
    const text = eintrag[form] ?? eintrag.other;
    if (text) return einsetzen(text, { anzahl, ...werte });
  }

  /*
   * Auch ohne Kategorientabelle entscheidet Intl - und nicht `anzahl === 1`.
   *
   * Genau das stand hier, und für Deutsch, Englisch, Niederländisch, Italienisch,
   * Spanisch, Portugiesisch und Türkisch ist es richtig. Für Französisch nicht: Dort
   * gehört die NULL zur Einzahl. "0 message", nicht "0 messages" - und das ist keine
   * Feinheit, sondern das, was jeder französische Leser sofort sieht.
   *
   * Aufgefallen ist es beim Vorbereiten des französischen Katalogs, nicht im Betrieb, und
   * es wäre auch dort nie aufgefallen: Die Prüfung verlangt eine Kategorientabelle erst
   * ab drei Formen, Französisch hat zwei - der Eintrag wäre also formal in Ordnung
   * gewesen und die Beugung trotzdem falsch.
   *
   * `one` gegen alles andere ist die richtige Frage, denn genau diese Unterscheidung
   * treffen die beiden übergebenen Texte. Eine Sprache mit drei Formen braucht ohnehin
   * die Tabelle oben; dass sie da ist, prüft `npm run sprachpruefung`.
   */
  return t(pluralkategorie(anzahl) === 'one' ? einzahl : mehrzahl, { anzahl, ...werte });
}

/**
 * Welche Mehrzahlform gilt - nach den Regeln von CLDR.
 *
 * Die Regeln bringt jede Laufzeit mit; sie hier nachzubauen hieße, eine Tabelle zu
 * pflegen, die anderswo gepflegt wird. Fehlt Intl (sehr alte Umgebung), bleibt es bei der
 * einfachen Unterscheidung - dann ist die Sprache falsch gebeugt, aber lesbar.
 */
function pluralkategorie(anzahl: number): Intl.LDMLPluralRule {
  try {
    return new Intl.PluralRules(gebietsschema()).select(anzahl);
  } catch {
    return anzahl === 1 ? 'one' : 'other';
  }
}

/**
 * Alle deutschen Texte, für die es in dieser Sprache KEINE Übersetzung gibt.
 *
 * Für das Prüfwerkzeug (scripts/sprachstand.mjs): Es soll eine Zahl geben, an der sich der
 * Stand der Umstellung ablesen lässt, statt "wird noch gemacht".
 */
export function fehlendeUebersetzungen(sprache: Sprache, texte: string[]): string[] {
  const katalog = kataloge.get(sprache) ?? {};
  return texte.filter((text) => !(text in katalog));
}
