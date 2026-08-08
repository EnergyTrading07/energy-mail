import type { Listeneintrag } from './listenTypen.js';
import { STANDARD_SORTIERUNG, vergleicheGespraeche, type Sortierung } from './sortierung.js';

/**
 * Fasst Nachrichten zu Gesprächen zusammen.
 *
 * Zwei Wege, weil die Anbieter unterschiedlich viel mitliefern:
 *
 * 1. Führt der Server eine Gesprächskennung (Gmail über X-GM-THRID), wird danach
 *    gruppiert. Das ist eindeutig und deckt sich mit dem, was Gmail selbst anzeigt.
 * 2. Sonst wird abgeleitet: über "In-Reply-To" verkettete Nachrichten gehören zusammen,
 *    und darüber hinaus solche mit gleichem Betreff, wenn eine davon eine Antwort ist.
 *
 * Der zweite Weg ist bewusst zurückhaltend. Nachrichten allein wegen gleichen Betreffs
 * zusammenzuwerfen ginge schief, sobald zwei Newsletter denselben Titel tragen - dann
 * verschwänden hundert Nachrichten hinter einer Zeile.
 *
 * Gruppiert wird, was geladen ist. Liegt die Antwort auf Seite eins und die Frage auf
 * Seite drei, finden sie erst zueinander, wenn Seite drei nachgeladen wurde.
 */

export interface Konversation {
  /** Kennung der Gruppe - stabil, solange dieselben Nachrichten geladen sind. */
  id: string;
  /** Nachrichten, jüngste zuerst. */
  nachrichten: Listeneintrag[];
  /** Die jüngste - sie bestimmt Zeile, Datum und Sortierung. */
  neueste: Listeneintrag;
  /** Ob mindestens eine Nachricht ungelesen ist. */
  ungelesen: boolean;
  /** Ob irgendwo ein Anhang hängt. */
  mitAnhang: boolean;
  /** Beteiligte Absender in der Reihenfolge ihres Auftretens. */
  beteiligte: string[];
}

/** Entfernt Antwort- und Weiterleitungskürzel, damit Betreffe vergleichbar werden. */
export function normalisierterBetreff(betreff: string): string {
  return betreff
    .replace(/^(\s*(re|aw|antw|fwd|fw|wg|weitergeleitet)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .trim()
    .toLowerCase();
}

/**
 * Verbund-Suche (union-find): jede Nachricht beginnt für sich, Verbindungen führen die
 * Gruppen zusammen. So entsteht in einem Durchgang die richtige Aufteilung, auch wenn
 * die Verbindungen kreuz und quer verlaufen.
 */
class Verbund {
  private eltern = new Map<string, string>();

  finde(x: string): string {
    const e = this.eltern.get(x);
    if (e === undefined) {
      this.eltern.set(x, x);
      return x;
    }
    if (e === x) return x;
    const wurzel = this.finde(e);
    this.eltern.set(x, wurzel);
    return wurzel;
  }

  vereine(a: string, b: string): void {
    const wa = this.finde(a);
    const wb = this.finde(b);
    if (wa !== wb) this.eltern.set(wa, wb);
  }
}

function absenderName(nachricht: Listeneintrag): string {
  const von = nachricht.from[0];
  return von?.name || von?.address || '(unbekannt)';
}

export function gruppiere(
  nachrichten: Listeneintrag[],
  /**
   * Nach welcher Ordnung die Gespraeche untereinander stehen.
   *
   * Muss die ganze Sortierung sein, nicht nur die Datumsrichtung. Vorher nahm das
   * Gruppieren immer das Datum, und "Absender A-Z" blieb wirkungslos - bei
   * eingeschalteten Gespraechen, also im Normalfall.
   */
  sortierung: Sortierung = STANDARD_SORTIERUNG,
): Konversation[] {
  const verbund = new Verbund();
  const schluesselVon = new Map<Listeneintrag, string>();

  // Erster Durchgang: jede Nachricht bekommt einen Anker.
  for (const m of nachrichten) {
    const anker = m.threadId ? `t:${m.threadId}` : `u:${m.folder ?? ''}:${m.uid}`;
    schluesselVon.set(m, anker);
    verbund.finde(anker);
    // Über die eigene Kennung erreichbar machen, damit Antworten andocken können.
    if (m.messageId && !m.threadId) verbund.vereine(anker, `m:${m.messageId}`);
  }

  // Zweiter Durchgang: Antworten mit ihrem Bezug verbinden.
  for (const m of nachrichten) {
    if (m.threadId) continue;
    const anker = schluesselVon.get(m)!;
    if (m.inReplyTo) verbund.vereine(anker, `m:${m.inReplyTo}`);
  }

  // Dritter Durchgang: gleicher Betreff verbindet nur dann, wenn dort geantwortet wird -
  // sonst würden gleichnamige Rundmails zu einem Klumpen.
  const nachBetreff = new Map<string, Listeneintrag[]>();
  for (const m of nachrichten) {
    if (m.threadId) continue;
    const betreff = normalisierterBetreff(m.subject);
    if (!betreff) continue;
    const liste = nachBetreff.get(betreff) ?? [];
    liste.push(m);
    nachBetreff.set(betreff, liste);
  }
  for (const gleiche of nachBetreff.values()) {
    const enthaeltAntwort = gleiche.some((m) => m.inReplyTo);
    if (!enthaeltAntwort || gleiche.length < 2) continue;
    for (let i = 1; i < gleiche.length; i++) {
      verbund.vereine(schluesselVon.get(gleiche[0])!, schluesselVon.get(gleiche[i])!);
    }
  }

  // Zusammentragen.
  const gruppen = new Map<string, Listeneintrag[]>();
  for (const m of nachrichten) {
    const wurzel = verbund.finde(schluesselVon.get(m)!);
    const liste = gruppen.get(wurzel) ?? [];
    liste.push(m);
    gruppen.set(wurzel, liste);
  }

  const alter = (m: Listeneintrag) => new Date(m.date ?? 0).getTime();

  return [...gruppen.entries()]
    .map(([id, liste]) => {
      const sortiert = [...liste].sort((a, b) => alter(b) - alter(a));
      const beteiligte: string[] = [];
      // Von alt nach neu durchgehen: so steht vorn, wer das Gespräch begonnen hat.
      for (const m of [...sortiert].reverse()) {
        const name = absenderName(m);
        if (!beteiligte.includes(name)) beteiligte.push(name);
      }
      return {
        id,
        nachrichten: sortiert,
        neueste: sortiert[0],
        ungelesen: sortiert.some((m) => !m.seen),
        mitAnhang: sortiert.some((m) => m.hasAttachments),
        beteiligte,
      };
    })
    .sort((a, b) =>
      vergleicheGespraeche(
        { erster: a.beteiligte[0] ?? '', neueste: a.neueste },
        { erster: b.beteiligte[0] ?? '', neueste: b.neueste },
        sortierung,
      ),
    );
}
