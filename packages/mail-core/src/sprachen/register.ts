import { lerneKatalog, type Katalog, type Sprache } from '../sprache.js';

/**
 * Wo die Kataloge herkommen - und wann.
 *
 * Diese Datei ist die Antwort auf zwei Fehler, die beide erst mit der zweiten Sprache
 * sichtbar wurden.
 *
 * ## Der Server hatte gar keinen Katalog
 *
 * Die Sprache je Anfrage war gebaut (sprachkontext.ts), `t()` stand an sechsundachtzig
 * Stellen - und `lerneKatalog` wurde im Server nie gerufen. Jede Meldung fiel auf Deutsch
 * zurück, auch für einen Browser, der ausdrücklich Englisch verlangte. Der Aufbau war
 * vollständig und wirkungslos, und genau deshalb fiel es nicht auf: Es gab keine
 * Fehlermeldung, keine leere Stelle, nur weiterhin Deutsch.
 *
 * ## Die Oberfläche hätte alle zehn geladen
 *
 * `import { EN } from '.../sprachen/en'` ist eine feste Einbindung: Was so eingebunden
 * wird, liegt im Bündel, ob es gebraucht wird oder nicht. Bei einer Sprache ist das
 * gleichgültig. Bei zehn wären neun Zehntel der Kataloge in jedem Abruf mit dabei, für
 * jeden Nutzer, für immer - bei rund 770 Texten je Sprache ist das kein Rundungsfehler.
 *
 * Deshalb `import()` statt `import`: Der Bündler macht daraus einen eigenen Abschnitt je
 * Sprache und lädt genau den, der gebraucht wird.
 *
 * ## Zwei Sprachen, nicht eine
 *
 * `ladeFuer('fr')` lädt Französisch **und** Englisch. Das ist kein Versehen, sondern die
 * Rückfallkette aus sprache.ts: Was auf Französisch fehlt, wird auf Englisch versucht und
 * erst dann deutsch. Ohne den englischen Katalog daneben wäre diese Kette eine
 * Behauptung.
 */

/**
 * Deutsch fehlt hier, und zwar mit Absicht: Es ist die Quelle. Ein Katalog dafür wäre eine
 * Tabelle, in der links und rechts dasselbe steht.
 */
const LADER: Record<Exclude<Sprache, 'de'>, () => Promise<{ KATALOG: Katalog }>> = {
  en: () => import('./en.js'),
  fr: () => import('./fr.js'),
  es: () => import('./es.js'),
  it: () => import('./it.js'),
  nl: () => import('./nl.js'),
  pl: () => import('./pl.js'),
  pt: () => import('./pt.js'),
  tr: () => import('./tr.js'),
  ru: () => import('./ru.js'),
};

const schonGeladen = new Set<Sprache>();

async function laden(sprache: Sprache): Promise<void> {
  if (sprache === 'de' || schonGeladen.has(sprache)) return;
  const lader = LADER[sprache];
  if (!lader) return;
  try {
    const modul = await lader();
    lerneKatalog(sprache, modul.KATALOG);
    schonGeladen.add(sprache);
  } catch {
    /*
     * Ein fehlender Katalog darf den Start nicht verhindern.
     *
     * Was hier schiefgehen kann, ist ein nicht ausgelieferter Abschnitt - und die Folge
     * davon ist eine deutsche Oberfläche, nicht ein leeres Fenster. Zwischen "etwas
     * unschön" und "startet nicht" ist die Wahl eindeutig.
     */
  }
}

/**
 * Lädt, was für eine Sprache gebraucht wird: sie selbst und Englisch als Zwischenstufe.
 *
 * Muss abgewartet werden, bevor das erste Mal gezeichnet wird. Ein Baustein, der vorher
 * entsteht, steht auf Deutsch da und bleibt es, bis er aus einem anderen Grund neu
 * gezeichnet wird - einzelne deutsche Reste in einer englischen Oberfläche, die sich beim
 * Klicken auflösen. So etwas meldet niemand, weil es nicht wie ein Fehler aussieht.
 */
export async function ladeFuer(sprache: Sprache): Promise<void> {
  await Promise.all([laden(sprache), laden('en')]);
}

/**
 * Alle Kataloge - für den Serverbetrieb.
 *
 * Dort ist "die eine Sprache" die falsche Frage: Ein Prozess bedient viele Menschen
 * gleichzeitig, und zwischen zwei Anfragen liegt womöglich eine andere Sprache. Nachladen
 * je Anfrage wäre ein Umweg mit einer Wartezeit mitten in der Antwort; alles beim Start zu
 * laden kostet einmalig ein paar hundert Kilobyte Arbeitsspeicher.
 */
export async function ladeAlle(): Promise<void> {
  await Promise.all((Object.keys(LADER) as Exclude<Sprache, 'de'>[]).map(laden));
}

/** Nur für Prüfungen: den gemerkten Stand vergessen. */
export function vergissGeladene(): void {
  schonGeladen.clear();
}
