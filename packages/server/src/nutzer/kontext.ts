import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Für wen der Server gerade arbeitet.
 *
 * Bis hierher gab es die Frage nicht: ein Rechner, ein Mensch, ein Datenordner. Sobald
 * mehrere Nutzer denselben Server benutzen, muss jeder Speicherzugriff wissen, wessen
 * Daten gemeint sind - und zwar jeder, ausnahmslos.
 *
 * ---
 *
 * Warum ein Kontext und kein Parameter.
 *
 * Der naheliegende Weg wäre, `nutzerId` durch alles durchzureichen. Bei 49 Routen mit
 * Kontobezug und einem Dutzend Speichern sind das hunderte Aufrufstellen - und man
 * vergisst genau eine. Eine vergessene Stelle heißt hier nicht "Fehlermeldung", sondern
 * "Nutzer A sieht die Post von Nutzer B". Das ist der klassische Weg, auf dem
 * Mehrmandantenfähigkeit schiefgeht, und man sieht es dem Code nicht an.
 *
 * AsyncLocalStorage ist für genau diesen Zweck gebaut: ein Wert, der an einem
 * Ausführungsstrang hängt und über await, Promises und Zeitgeber hinweg erhalten bleibt.
 * Die Speicher fragen ihn, statt ihn gereicht zu bekommen.
 *
 * ---
 *
 * Die Eigenschaft, auf die es ankommt: KEIN RÜCKFALLWERT.
 *
 * Ohne gesetzten Kontext wirft `aktuellerNutzer()`. Nicht "dann eben der Standardordner" -
 * denn dann läse eine vergessene Stelle stillschweigend fremde Post, und niemand merkte
 * es. Ein Ausnahmefehler ist laut, sofort sichtbar und beim ersten Durchlauf zu finden;
 * ein falscher Nutzer ist es nie.
 *
 * Das ist der Grund, warum diese Umstellung überhaupt sicher durchführbar ist: alles, was
 * ich zu wickeln vergesse, meldet sich beim ersten Aufruf.
 */

export interface Nutzerkontext {
  /** Kennung des Nutzers. Wird als Ordnername verwendet - siehe pruefeNutzerId. */
  id: string;
}

const speicher = new AsyncLocalStorage<Nutzerkontext>();

/**
 * Erlaubte Nutzerkennungen.
 *
 * Die Kennung wird zu einem Ordnernamen. Ohne diese Prüfung wäre eine Kennung wie
 * `../../andererNutzer` oder `..%2F..` ein Weg aus dem eigenen Ordner heraus - und damit
 * genau die Vermischung, die das ganze Modul verhindern soll. Deshalb streng und
 * ausdrücklich: Kleinbuchstaben, Ziffern, Bindestrich, Unterstrich. Nichts sonst.
 *
 * Bewusst eine Erlaubnisliste und keine Sperrliste: bei einer Sperrliste vergisst man
 * eine Schreibweise, bei einer Erlaubnisliste nicht.
 */
const ERLAUBTE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function istGueltigeNutzerId(id: unknown): id is string {
  return typeof id === 'string' && ERLAUBTE_ID.test(id);
}

export function pruefeNutzerId(id: unknown): string {
  if (!istGueltigeNutzerId(id)) {
    throw new Error(
      `Unbrauchbare Nutzerkennung: ${JSON.stringify(id)}. Erlaubt sind Kleinbuchstaben, ` +
        'Ziffern, Bindestrich und Unterstrich, höchstens 64 Zeichen.',
    );
  }
  return id;
}

/**
 * Führt etwas im Namen eines Nutzers aus.
 *
 * Alles, was innerhalb läuft - auch über `await`, `then` und `setTimeout` hinweg -, sieht
 * diesen Nutzer. Das gilt ausdrücklich auch für Zeitgeber, die drinnen angelegt und erst
 * viel später ausgelöst werden: die Warteschlange für geplante Sendungen und die
 * Wiedervorlage hängen genau daran.
 */
export function alsNutzer<T>(id: string, fn: () => T): T {
  return speicher.run({ id: pruefeNutzerId(id) }, fn);
}

/**
 * Der Nutzer, für den gerade gearbeitet wird. Wirft, wenn keiner gesetzt ist.
 *
 * Das Werfen ist Absicht und keine Bequemlichkeitslücke - siehe oben.
 */
export function aktuellerNutzer(): string {
  const kontext = speicher.getStore();
  if (!kontext) {
    throw new Error(
      'Kein Nutzerkontext gesetzt. Jeder Zugriff auf Nutzerdaten muss innerhalb von ' +
        'alsNutzer(...) laufen. Bei Arbeit im Hintergrund (Zeitgeber, Überwachung, ' +
        'Markenerneuerung) muss der Kontext ausdrücklich betreten werden - eine Anfrage, ' +
        'die ihn mitbrächte, gibt es dort nicht.',
    );
  }
  return kontext.id;
}

/**
 * Wie oben, aber ohne zu werfen.
 *
 * Nur für Stellen, die ehrlich beides können müssen - etwa eine Protokollzeile, die den
 * Nutzer nennt, wenn einer da ist. Wer damit einen Speicherzugriff absichert, hebelt den
 * Schutz aus; dafür ist es nicht gedacht.
 */
export function aktuellerNutzerOderNull(): string | null {
  return speicher.getStore()?.id ?? null;
}

/** Ob gerade überhaupt ein Kontext gesetzt ist. */
export function hatNutzerkontext(): boolean {
  return speicher.getStore() !== undefined;
}

/**
 * Setzt den Nutzer für den weiteren Verlauf - ohne umschließende Funktion.
 *
 * NUR für Prozesse, die von Anfang bis Ende für genau einen Nutzer arbeiten: die
 * Prüfungen, und Werkzeuge auf der Befehlszeile (Umzug, Sicherung, Wartung).
 *
 * NIEMALS in der Behandlung von Anfragen. Der Unterschied zu alsNutzer() ist
 * wesentlich: dieses hier setzt den Wert für alles Folgende, ohne ihn je wieder
 * zurückzunehmen. In einem Server, der viele Anfragen nebeneinander bearbeitet, hieße
 * das, dass der Nutzer der einen Anfrage in die nächste hinüberleckt - also genau die
 * Vermischung, gegen die dieses Modul gebaut ist. alsNutzer() hat einen Anfang und ein
 * Ende und kann das nicht.
 *
 * Der Name sagt es absichtlich deutlich: wer "FuerProzess" schreibt, soll merken, dass
 * er über den ganzen Prozess entscheidet.
 */
export function betreteNutzerFuerProzess(id: string): void {
  speicher.enterWith({ id: pruefeNutzerId(id) });
}
