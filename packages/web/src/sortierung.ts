import type { Listeneintrag } from './listenTypen.js';
import { t } from './sprache.js';

/**
 * Sortierung und Anzeigedichte der Nachrichtenliste.
 *
 * Beim Sortieren gibt es eine Grenze, die man kennen muss, und die dieses Modul deshalb
 * ausdrücklich mitführt:
 *
 * Nach Datum kann über den gesamten Ordner sortiert werden. Das kostet nichts - der
 * Server liefert beim Öffnen ohnehin die Liste aller Nummern, und die umzudrehen ist
 * die ganze Arbeit.
 *
 * Nach Absender, Betreff oder Größe geht das nicht. Dafür müsste man die Kopfdaten aller
 * Nachrichten holen; bei 31.967 Stück im Posteingang des Nutzers wäre das eine Wartezeit
 * von Minuten für eine Ansichtssache. Sortiert wird deshalb, was geladen ist - und die
 * Liste sagt das auch. Eine Sortierung, die nur so tut, als umfasse sie alles, wäre
 * schlimmer als keine: man sucht dann oben nach etwas, das weiter unten steht.
 */

export type Sortierschluessel = 'datum' | 'absender' | 'betreff';
export type Richtung = 'ab' | 'auf';

export interface Sortierung {
  schluessel: Sortierschluessel;
  richtung: Richtung;
}

export const STANDARD_SORTIERUNG: Sortierung = { schluessel: 'datum', richtung: 'ab' };

/**
 * Ob diese Sortierung den ganzen Ordner erfasst oder nur das Geladene.
 *
 * Nur das Datum kann der Server ohne Mehraufwand liefern; alles andere braucht die
 * Kopfdaten jeder einzelnen Nachricht.
 */
export function umfasstAlles(sortierung: Sortierung): boolean {
  return sortierung.schluessel === 'datum';
}

/** Der Name des Absenders, sonst seine Adresse - danach wird sortiert. */
function absenderText(eintrag: Listeneintrag): string {
  const von = eintrag.from[0];
  return (von?.name || von?.address || '').trim();
}

/**
 * Betreff ohne die Antwort- und Weiterleitungsvorsätze.
 *
 * Sonst stünden sämtliche Antworten unter "A" und "R" beieinander statt bei ihrem
 * eigentlichen Thema - was das Sortieren nach Betreff wertlos machte.
 */
export function betreffZumSortieren(betreff: string): string {
  return (
    betreff
      .replace(/^\s*((re|aw|antw|antwort|fwd?|wg|weiterleitung)\s*(\[\d+\])?\s*:\s*)+/i, '')
      /*
       * Was vor dem ersten Buchstaben oder der ersten Ziffer steht, zaehlt nicht mit.
       *
       * Sonst stehen unter "Betreff A-Z" zuerst alle Betreffe, die mit einem Emoji
       * oder einer Klammer anfangen - gemessen: "[AktienInsight]", "⏳ Don't miss",
       * "📦BESTELLUNG" allesamt vor "A". Wer unter B nach "BESTELLUNG" sucht, findet
       * es ganz oben und nirgends sonst.
       */
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .trim()
  );
}

const zeit = (eintrag: Listeneintrag) =>
  eintrag.date ? new Date(eintrag.date).getTime() : Number.NEGATIVE_INFINITY;

/**
 * Vergleicht zwei Einträge nach der gewählten Ordnung.
 *
 * Bei Gleichstand entscheidet immer das Datum, neueste zuerst. Ohne diesen zweiten
 * Maßstab hinge die Reihenfolge von Nachrichten desselben Absenders davon ab, in welcher
 * Reihenfolge sie geladen wurden - und sprünge bei jedem Nachladen um.
 */
export function vergleiche(
  a: Listeneintrag,
  b: Listeneintrag,
  sortierung: Sortierung,
): number {
  /**
   * "auf" ist immer die aufsteigende Ordnung des zugrunde liegenden Wertes, "ab" die
   * umgekehrte. Beim Datum heißt aufsteigend "älteste zuerst", beim Text "A bis Z" -
   * dass beides in der Beschriftung verschieden klingt, ändert daran nichts.
   *
   * Zuerst hatte ich es andersherum gerechnet, und die Namen standen von Z nach A,
   * während der Knopf "A–Z" versprach.
   */
  const umdrehen = sortierung.richtung === 'ab' ? -1 : 1;

  if (sortierung.schluessel === 'datum') {
    return (zeit(a) - zeit(b)) * umdrehen;
  }

  const werte: [string, string] =
    sortierung.schluessel === 'absender'
      ? [absenderText(a), absenderText(b)]
      : [betreffZumSortieren(a.subject), betreffZumSortieren(b.subject)];

  // Nach deutscher Ordnung: "Ärger" gehört zu "A", nicht hinter "Z".
  const vergleich = werte[0].localeCompare(werte[1], 'de', { sensitivity: 'base', numeric: true });
  if (vergleich !== 0) return vergleich * umdrehen;

  // Gleichstand: das Datum entscheidet - und zwar immer gleich herum.
  return zeit(b) - zeit(a);
}

/**
 * Vergleicht zwei Gespräche nach derselben Ordnung.
 *
 * Nötig, weil ein Gespräch in der Zeile etwas anderes anzeigt als eine einzelne
 * Nachricht: vorn stehen alle Beteiligten, nicht nur der letzte Absender. Sortiert wird
 * nach dem, was dort steht - sonst sähe die Reihenfolge willkürlich aus.
 *
 * Vorher ordnete das Gruppieren die Gespräche immer nach Datum. Damit war "Absender
 * A–Z" wirkungslos, solange Gespräche eingeschaltet waren - und das sind sie von
 * Haus aus. Gemessen: dieselben acht Zeilen in derselben Reihenfolge wie unter
 * "Neueste zuerst".
 */
export function vergleicheGespraeche(
  a: { erster: string; neueste: Listeneintrag },
  b: { erster: string; neueste: Listeneintrag },
  sortierung: Sortierung,
): number {
  if (sortierung.schluessel === 'absender') {
    const umdrehen = sortierung.richtung === 'ab' ? -1 : 1;
    const v = a.erster.localeCompare(b.erster, 'de', { sensitivity: 'base', numeric: true });
    if (v !== 0) return v * umdrehen;
    return zeit(b.neueste) - zeit(a.neueste);
  }
  return vergleiche(a.neueste, b.neueste, sortierung);
}

/** Sortiert eine Liste, ohne die ursprüngliche anzufassen. */
export function sortiere(
  eintraege: readonly Listeneintrag[],
  sortierung: Sortierung,
): Listeneintrag[] {
  return [...eintraege].sort((a, b) => vergleiche(a, b, sortierung));
}

// --- Anzeigedichte ---

export type Dichte = 'eng' | 'normal' | 'weit';

export function dichten(): { wert: Dichte; name: string; erklaerung: string }[] {
  return [
    { wert: 'eng', name: t('Eng'), erklaerung: t('Mehr Nachrichten auf einen Blick') },
    { wert: 'normal', name: t('Normal'), erklaerung: t('Die gewohnte Höhe') },
    { wert: 'weit', name: t('Weit'), erklaerung: t('Mehr Luft zwischen den Zeilen') },
  ];
}

const DICHTE_WERTE: Dichte[] = ['eng', 'normal', 'weit'];

/** Liest eine gespeicherte Dichte; alles Unbekannte fällt auf "normal" zurück. */
export function alsDichte(wert: string | null | undefined): Dichte {
  return DICHTE_WERTE.includes(wert as Dichte) ? (wert as Dichte) : 'normal';
}

/** Liest eine gespeicherte Sortierung aus dem Text, den merkeSortierung() schreibt. */
export function alsSortierung(wert: string | null | undefined): Sortierung {
  const [schluessel, richtung] = (wert ?? '').split(':');
  const gueltig: Sortierschluessel[] = ['datum', 'absender', 'betreff'];
  if (!gueltig.includes(schluessel as Sortierschluessel)) return STANDARD_SORTIERUNG;
  return {
    schluessel: schluessel as Sortierschluessel,
    richtung: richtung === 'auf' ? 'auf' : 'ab',
  };
}

export const alsText = (sortierung: Sortierung) =>
  `${sortierung.schluessel}:${sortierung.richtung}`;

/** Wie die Sortierung in der Leiste heißt. */
export function beschreibeSortierung(sortierung: Sortierung): string {
  const wort = {
    datum: sortierung.richtung === 'ab' ? t('Neueste zuerst') : t('Älteste zuerst'),
    absender: sortierung.richtung === 'ab' ? t('Absender Z–A') : t('Absender A–Z'),
    betreff: sortierung.richtung === 'ab' ? t('Betreff Z–A') : t('Betreff A–Z'),
  };
  return wort[sortierung.schluessel];
}
