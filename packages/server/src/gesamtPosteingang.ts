import {
  listMessages,
  verschmelzePosteingaenge,
  type AccountConfig,
  type MessageSummary,
  type SearchHit,
} from '@energy-mail/mail-core';

/**
 * Der Posteingang aller Konten in einer Liste.
 *
 * Wer zwei oder drei Adressen hat, will morgens nicht dreimal nachsehen. Jedes große
 * Mailprogramm bietet das; hier fehlte es bislang.
 *
 * Zusammengesetzt wird ohne jeden Zwischenspeicher: die Marke für die nächste Seite
 * enthält für jedes Konto die zuletzt ausgegebene UID, und daraus lässt sich jede Seite
 * neu herleiten. Ein Vorrat im Serverspeicher wäre schneller, ginge aber bei jedem
 * Neustart verloren und liefe bei zwei Fenstern durcheinander.
 *
 * Das Heikle am Blättern - dass eine später nachgereichte Nachricht zwischen zwei
 * bereits angezeigte gehört hätte - löst verschmelzePosteingaenge() in mail-core.
 */

/** Wie weit jedes Konto schon ausgegeben wurde. */
export type Marke = Record<string, number>;

/** Ein Eintrag weiß, aus welchem Konto er stammt - sonst ließe er sich nicht öffnen. */
export type GesamtEintrag = SearchHit;

export interface GesamtSeite {
  messages: GesamtEintrag[];
  /** Nachrichten in allen Posteingängen zusammen. */
  total: number;
  nextCursor: Marke | null;
  hasMore: boolean;
  /** Konten, die gerade nicht erreichbar waren - die Liste ist dann unvollständig. */
  fehlende: { accountId: string; email: string; grund: string }[];
}

/**
 * Wie viel je Runde von einem Konto geholt wird.
 *
 * Großzügiger als die Seitengröße: sonst müsste fast jede Runde nachladen, und jedes
 * Nachladen ist eine weitere Anfrage an den Anbieter.
 */
const VORRAT_JE_KONTO = 40;

/** Mehr Runden braucht es nicht - danach stimmt etwas mit den Daten nicht. */
const HOECHSTENS_RUNDEN = 6;

const zeitVon = (m: GesamtEintrag) => (m.date ? new Date(m.date).getTime() : null);

/**
 * Holt die nächste Seite des kontenübergreifenden Posteingangs.
 *
 * Ein Konto, das nicht antwortet, hält die anderen nicht auf: es wird unter "fehlende"
 * gemeldet und ausgelassen. Die Liste ohne Hinweis um ein Konto zu kürzen wäre die
 * schlechtere Wahl - man suchte dann eine Nachricht, die es zu geben scheint.
 */
export async function holeGesamtPosteingang(
  konten: AccountConfig[],
  marke: Marke,
  pageSize: number,
): Promise<GesamtSeite> {
  const fehlende: GesamtSeite['fehlende'] = [];
  const vorrat: Record<string, GesamtEintrag[]> = {};
  const nochMehr: Record<string, boolean> = {};
  const stand: Marke = { ...marke };
  let total = 0;

  /** Holt die nächsten Kopfdaten eines Kontos und hängt sie an dessen Vorrat. */
  const nachladen = async (konto: AccountConfig): Promise<void> => {
    const bisher = vorrat[konto.id] ?? [];
    const letzte = bisher[bisher.length - 1];
    // Weiter unterhalb der zuletzt geholten UID - oder, beim ersten Mal, unterhalb der
    // Marke aus der vorigen Seite.
    const ab = letzte ? letzte.uid : stand[konto.id];

    try {
      const seite = await listMessages(konto, 'INBOX', {
        pageSize: VORRAT_JE_KONTO,
        beforeUid: ab,
      });
      total += bisher.length === 0 ? seite.total : 0;
      vorrat[konto.id] = [
        ...bisher,
        ...seite.messages.map((m: MessageSummary) => ({
          ...m,
          folder: 'INBOX',
          accountId: konto.id,
          email: konto.email,
        })),
      ];
      // Kam nichts, ist Schluss - auch wenn der Server etwas anderes behauptet. Ohne
      // das drehte die Schleife unten leer.
      nochMehr[konto.id] = seite.hasMore && seite.messages.length > 0;
    } catch (err) {
      fehlende.push({ accountId: konto.id, email: konto.email, grund: (err as Error).message });
      vorrat[konto.id] = bisher;
      nochMehr[konto.id] = false;
    }
  };

  // Erste Runde: von jedem Konto etwas holen. Nebenläufig - nacheinander summierten
  // sich bei drei Konten drei Wartezeiten.
  await Promise.all(konten.map(nachladen));

  let seite: GesamtEintrag[] = [];
  for (let runde = 0; runde < HOECHSTENS_RUNDEN; runde++) {
    const ergebnis = verschmelzePosteingaenge(
      konten.map((k) => ({
        accountId: k.id,
        eintraege: vorrat[k.id] ?? [],
        hasMore: nochMehr[k.id] ?? false,
      })),
      zeitVon,
      pageSize,
    );

    seite = ergebnis.seite;
    for (const k of konten) vorrat[k.id] = ergebnis.rest[k.id] ?? [];

    // Genug beisammen oder nichts mehr zu holen: fertig.
    if (seite.length >= pageSize || ergebnis.nachladen.length === 0) break;

    const zuHolen = konten.filter((k) => ergebnis.nachladen.includes(k.id));
    await Promise.all(zuHolen.map(nachladen));
  }

  const nextCursor = naechsteMarke(marke, seite);

  const hasMore =
    konten.some((k) => (nochMehr[k.id] ?? false) || (vorrat[k.id]?.length ?? 0) > 0) &&
    seite.length > 0;

  return {
    messages: seite,
    total,
    nextCursor: hasMore ? nextCursor : null,
    hasMore,
    fehlende,
  };
}

/**
 * Bildet die Marke für die nächste Seite: je Konto die KLEINSTE ausgegebene UID.
 *
 * Der Unterschied zwischen "kleinste" und "zuletzt ausgegebene" ist der Fehler, an dem
 * es zuerst scheiterte. Weitergeblättert wird über "beforeUid", also über die Nummer -
 * sortiert wird aber nach Datum, und beides stimmt nicht immer überein: das Datum stammt
 * vom Absender, die Nummer vergibt der Server beim Eintreffen. Eine Nachricht, die
 * unterwegs hängenblieb, trägt eine höhere Nummer bei älterem Datum.
 *
 * Nahm man die zuletzt ausgegebene, stand dort mitunter eine höhere Nummer als bei einer
 * schon gezeigten - und die kam auf der nächsten Seite ein zweites Mal. Über 300
 * Nachrichten aus zwei echten Konten waren es drei Doppelungen und eine Nachricht an
 * falscher Stelle.
 *
 * Konten, von denen diesmal nichts kam, behalten ihre alte Marke - sonst finge ihre
 * Liste wieder von vorn an.
 */
export function naechsteMarke(
  bisher: Marke,
  seite: { accountId?: string; uid: number }[],
): Marke {
  const marke: Marke = { ...bisher };
  for (const eintrag of seite) {
    if (!eintrag.accountId) continue;
    const alt = marke[eintrag.accountId];
    marke[eintrag.accountId] = alt === undefined ? eintrag.uid : Math.min(alt, eintrag.uid);
  }
  return marke;
}

/** Wandelt die Marke in eine Zeichenkette für die Adresszeile und zurück. */
export function markeAlsText(marke: Marke): string {
  return Object.entries(marke)
    .map(([id, uid]) => `${id}:${uid}`)
    .join(',');
}

export function markeAusText(text: string | undefined): Marke {
  const marke: Marke = {};
  for (const stueck of (text ?? '').split(',')) {
    const trenner = stueck.lastIndexOf(':');
    if (trenner <= 0) continue;
    const uid = Number(stueck.slice(trenner + 1));
    if (Number.isInteger(uid) && uid > 0) marke[stueck.slice(0, trenner)] = uid;
  }
  return marke;
}
