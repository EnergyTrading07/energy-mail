/**
 * Mehrere Posteingänge zu einer Liste zusammenführen.
 *
 * Klingt harmlos, ist aber die Stelle, an der ein kontenübergreifender Posteingang still
 * Nachrichten verliert. Der Grund ist das Blättern.
 *
 * Jedes Konto liefert seine Nachrichten für sich, neueste zuerst, in Seiten. Legt man
 * die Seiten einfach zusammen und sortiert nach Datum, sieht das Ergebnis richtig aus -
 * bis man weiterblättert. Dann kommt vom zweiten Konto eine Nachricht nach, die zwischen
 * zwei bereits angezeigte gehört hätte. Sie erscheint dann weiter unten, an einer Stelle,
 * an der niemand sie sucht, oder sie fällt ganz heraus.
 *
 * Der Ausweg ist eine Grenze: ausgegeben wird nur, was neuer ist als die älteste
 * Nachricht, die von einem noch nicht erschöpften Konto vorliegt. Was älter ist, könnte
 * sich mit noch ungeholten Nachrichten dieses Kontos verschränken und wartet deshalb auf
 * die nächste Runde.
 *
 * Beispiel: Konto A hat noch mehr und liegt bis zum 5. Juni vor, Konto B ist vollständig
 * bis zum 1. Januar. Dann ist alles ab dem 6. Juni sicher, der Rest nicht - denn A könnte
 * noch etwas vom 20. Mai haben, das vor B's 15. Mai gehört.
 */

/** Was von einem Konto vorliegt. */
export interface Vorrat<T> {
  accountId: string;
  /** Bereits geholte Einträge, neueste zuerst. */
  eintraege: T[];
  /** Ob der Server dieses Kontos noch ältere hat. */
  hasMore: boolean;
}

export interface Verschmelzung<T> {
  /** Die Einträge, die sicher ausgegeben werden können - neueste zuerst. */
  seite: T[];
  /** Was je Konto übrigbleibt; Grundlage für den nächsten Aufruf. */
  rest: Record<string, T[]>;
  /**
   * Konten, von denen nachgeladen werden muss, um überhaupt weiterzukommen. Ihr Vorrat
   * ist aufgebraucht, der Server hat aber noch etwas - solange bleibt die Grenze oben
   * und es lässt sich nichts weiter ausgeben.
   */
  nachladen: string[];
  /** Ob es überhaupt noch etwas zu holen gäbe. */
  hasMore: boolean;
}

/**
 * Führt die Vorräte mehrerer Konten zu einer Seite zusammen.
 *
 * "datumVon" liefert den Zeitpunkt als Zahl. Nachrichten ohne Datum kommen ans Ende;
 * sie sind selten, aber es gibt sie, und ohne diese Festlegung landeten sie durch
 * NaN-Vergleiche an zufälligen Stellen.
 */
export function verschmelzePosteingaenge<T>(
  vorraete: Vorrat<T>[],
  datumVon: (eintrag: T) => number | null,
  pageSize: number,
): Verschmelzung<T> {
  const zeit = (eintrag: T) => datumVon(eintrag) ?? Number.NEGATIVE_INFINITY;

  const rest: Record<string, T[]> = {};
  for (const vorrat of vorraete) rest[vorrat.accountId] = [];

  const offene = vorraete.filter((v) => v.hasMore);

  /**
   * Die Grenze. Ein Konto mit leerem Vorrat, das noch mehr hätte, hebt sie ins
   * Unendliche: über dessen nächste Nachricht ist nichts bekannt, also ist gar nichts
   * sicher, bevor nachgeladen wurde.
   */
  let grenze = Number.NEGATIVE_INFINITY;
  for (const vorrat of offene) {
    const aeltester = vorrat.eintraege[vorrat.eintraege.length - 1];
    grenze = aeltester === undefined ? Number.POSITIVE_INFINITY : Math.max(grenze, zeit(aeltester));
  }

  const alle = vorraete
    .flatMap((v) => v.eintraege.map((eintrag) => ({ eintrag, accountId: v.accountId })))
    .sort((a, b) => zeit(b.eintrag) - zeit(a.eintrag));

  const seite: T[] = [];
  for (const { eintrag, accountId } of alle) {
    // Hat kein Konto mehr etwas nachzureichen, gibt es nichts, womit sich noch etwas
    // verschränken könnte - dann ist alles sicher. Ohne diesen Zweig bliebe eine
    // Nachricht ohne Datum für immer liegen: ihr Zeitpunkt liegt bei minus unendlich
    // und wäre damit nie größer als die Grenze.
    //
    // Die Grenze selbst gehört sonst noch nicht dazu: bei gleichem Zeitpunkt hinge die
    // Reihenfolge davon ab, welches Konto zuerst geantwortet hat.
    const sicher = offene.length === 0 || zeit(eintrag) > grenze;
    if (sicher && seite.length < pageSize) seite.push(eintrag);
    else rest[accountId]!.push(eintrag);
  }

  /**
   * Welche Konten nachladen müssen, damit es weitergeht.
   *
   * Nicht nur die mit leerem Vorrat. Wer die Grenze setzt, blockiert sich sonst selbst:
   * Konto A hat noch eine Nachricht vom 5. Juni und weiß von weiteren - damit steht die
   * Grenze auf dem 5. Juni, und A's eigene Nachricht von diesem Tag kommt nie heraus.
   * Genau daran blieb die Zusammenführung beim Durchspielen nach sechs von zwanzig
   * Nachrichten hängen.
   *
   * Nachgeladen wird deshalb bei jedem offenen Konto, dessen ältester verbliebener
   * Eintrag die Grenze setzt - das sind die, die den Fortschritt aufhalten.
   */
  const nachladen = offene
    .filter((v) => {
      const uebrig = rest[v.accountId]!;
      if (uebrig.length === 0) return true;
      return zeit(uebrig[uebrig.length - 1]!) >= grenze;
    })
    .map((v) => v.accountId);

  // Erst jetzt, nachdem feststeht, was liegen bleibt: vorher gezählt hieße "es gab
  // etwas" statt "es ist noch etwas da", und die Liste böte ewig ein Weiterblättern an.
  const hasMore = offene.length > 0 || Object.values(rest).some((r) => r.length > 0);

  return { seite, rest, nachladen, hasMore };
}
