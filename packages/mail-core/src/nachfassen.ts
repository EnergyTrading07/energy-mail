import type { EmailAddress, MessageSummary } from './types.js';

/**
 * Was liegengeblieben ist.
 *
 * Zwei Fragen, die sich in jedem Postfach stellen und die keine Ordnerliste beantwortet:
 * worauf warte ich noch, und wem schulde ich noch eine Antwort? Beides ist dieselbe
 * Auswertung - man muss nur wissen, von wem die letzte Nachricht eines Gesprächs kam.
 *
 * Bewusst ohne eigenen Merkspeicher: alles wird aus dem abgeleitet, was ohnehin im
 * Postfach steht. Damit stimmt es auch dann, wenn die Antwort auf einem anderen Gerät
 * geschrieben wurde.
 */

export type VorgangsArt = 'wartetAufAntwort' | 'nichtBeantwortet';

export interface OffenerVorgang {
  art: VorgangsArt;
  /** Die jüngste Nachricht des Gesprächs - an ihr hängt der Vorgang. */
  uid: number;
  ordner: string;
  betreff: string;
  /** Die Gegenseite: an wen geschrieben wurde beziehungsweise wer geschrieben hat. */
  gegenueber: EmailAddress[];
  datum: Date | null;
  /** Volle Tage seit der jüngsten Nachricht - Grundlage der Sortierung. */
  tageOffen: number;
  /** Wie viele Nachrichten das Gespräch umfasst, eigene und fremde zusammen. */
  umfang: number;
}

export interface NachfassEingabe {
  /** Empfangene Nachrichten, gewöhnlich aus dem Posteingang. */
  posteingang: MessageSummary[];
  /** Eigene Nachrichten aus dem Gesendet-Ordner. */
  gesendet: MessageSummary[];
  /** Name des Gesendet-Ordners, damit der Vorgang zurückverweisen kann. */
  gesendetOrdner: string;
  posteingangOrdner?: string;
}

export interface NachfassOptionen {
  /** Eigene Adressen - daran wird erkannt, welche Seite geschrieben hat. */
  eigeneAdressen: string[];
  /**
   * Erst ab so vielen Tagen gilt etwas als liegengeblieben. Ohne diese Schwelle stünde
   * die Post von heute Vormittag schon als Vorwurf in der Liste.
   */
  mindestTage?: number;
  /**
   * Ab hier nicht mehr melden. Was ein Vierteljahr liegt, ist keine offene Sache mehr,
   * sondern erledigt oder aufgegeben - ohne Deckel würde die Liste zum Friedhof.
   */
  hoechstTage?: number;
  /**
   * Ob auch einseitige Nachrichten von Unbekannten gemeldet werden.
   *
   * Standardmäßig nicht, und dafür gibt es einen gemessenen Grund: im Postfach des
   * Nutzers blieben sonst 47 vermeintlich offene Vorgänge stehen, von denen rund zehn
   * wirklich welche waren - der Rest Versandbestätigungen, Rechnungen und Hinweise auf
   * geänderte Geschäftsbedingungen. Eine Liste, in der man suchen muss, wird nicht
   * gelesen. Wer den Vollbestand sehen will, schaltet es an.
   */
  auchUnbekannte?: boolean;
  jetzt?: Date;
}

const TAG_MS = 86_400_000;

const normalisiere = (adresse: string) => adresse.trim().toLowerCase();

/** Kennungen kommen mal mit, mal ohne spitze Klammern - ohne sie vergleicht es sich. */
const alsKennung = (roh: string) => roh.trim().replace(/^<|>$/g, '').toLowerCase();

/**
 * Absender, von denen keine Antwort zu erwarten ist. Sie als offenen Vorgang zu führen
 * wäre schlicht falsch - niemand schuldet einem Versandsystem eine Antwort.
 *
 * Nicht nur am Anfang gesucht: im Postfach fanden sich "notifications-noreply@" und
 * "messages-noreply@", die eine Prüfung auf den Wortanfang allein durchgelassen hätte.
 */
const KEINE_ANTWORT = /(^|[.\-_+])(no-?reply|do-?not-?reply|bounce|mailer-daemon|postmaster)/i;

/**
 * Ab so vielen unbeantworteten Gesprächen gilt ein Absender als Rundfunk und nicht als
 * Gegenüber - vorausgesetzt, man hat ihm nie selbst geschrieben.
 *
 * Nötig, weil die Kopfzeilen allein nicht reichen: im Postfach standen 121
 * unbeantwortete Nachrichten eines Absenders, der weder eine Abmeldezeile noch eine
 * Verteilerkennung mitschickt. Wer in einem Vierteljahr dreimal schreibt und nie eine
 * Antwort bekommt, erwartet auch keine.
 */
const RUNDFUNK_AB = 3;

function istRundmail(m: MessageSummary): boolean {
  // Wer eine Abmeldezeile mitschickt, schreibt an einen Verteiler und nicht an mich.
  return Boolean(m.listId || m.listUnsubscribe);
}

function istAutomatisch(m: MessageSummary): boolean {
  // Die Kennzeichnung des Absenders zählt zuerst - sie ist eine Aussage, keine Vermutung.
  if (m.maschinell) return true;
  const absender = m.from[0]?.address ?? '';
  return KEINE_ANTWORT.test(absender.split('@')[0] ?? '');
}

/**
 * Ordnet jeder Nachricht ein Gespräch zu.
 *
 * Wo der Server eine Kennung führt (Gmail), wird sie genommen. Sonst über die Kennungen
 * im Kopf: alles, was sich gegenseitig nennt, gehört zusammen. Der Betreff allein
 * gruppiert nie - "Rechnung" schreiben zu viele, die nichts miteinander zu tun haben.
 */
function gruppiere(alle: MessageSummary[]): Map<string, MessageSummary[]> {
  const eltern = new Map<string, string>();

  const finde = (x: string): string => {
    let wurzel = x;
    while (eltern.get(wurzel) && eltern.get(wurzel) !== wurzel) wurzel = eltern.get(wurzel)!;
    // Den Pfad kürzen, damit spätere Suchen kurz bleiben.
    let lauf = x;
    while (eltern.get(lauf) && eltern.get(lauf) !== wurzel) {
      const naechster = eltern.get(lauf)!;
      eltern.set(lauf, wurzel);
      lauf = naechster;
    }
    return wurzel;
  };

  const vereine = (a: string, b: string) => {
    if (!eltern.has(a)) eltern.set(a, a);
    if (!eltern.has(b)) eltern.set(b, b);
    const wa = finde(a);
    const wb = finde(b);
    if (wa !== wb) eltern.set(wb, wa);
  };

  /** Eindeutiger Name der Nachricht, auch wenn sie keine eigene Kennung trägt. */
  const anker = (m: MessageSummary, ordner: string) =>
    m.messageId ? alsKennung(m.messageId) : `uid:${ordner}:${m.uid}`;

  for (const m of alle) {
    const ordner = (m as MessageSummary & { ordner?: string }).ordner ?? '';
    const eigen = anker(m, ordner);
    if (!eltern.has(eigen)) eltern.set(eigen, eigen);

    if (m.threadId) vereine(`thr:${m.threadId}`, eigen);

    const bezuege = [m.inReplyTo, ...(m.references ?? [])].filter(Boolean) as string[];
    for (const bezug of bezuege) vereine(alsKennung(bezug), eigen);
  }

  const gespraeche = new Map<string, MessageSummary[]>();
  for (const m of alle) {
    const ordner = (m as MessageSummary & { ordner?: string }).ordner ?? '';
    const wurzel = finde(anker(m, ordner));
    const bisher = gespraeche.get(wurzel);
    if (bisher) bisher.push(m);
    else gespraeche.set(wurzel, [m]);
  }
  return gespraeche;
}

/**
 * Sucht Gespräche, in denen etwas offen ist.
 *
 * Der Kern ist einfach: pro Gespräch zählt nur die jüngste Nachricht. Kam sie von mir,
 * warte ich auf Antwort; kam sie von der Gegenseite, schulde ich eine. Alles Weitere
 * sind Filter gegen Fehlalarm.
 */
export function findeOffeneVorgaenge(
  eingabe: NachfassEingabe,
  optionen: NachfassOptionen,
): OffenerVorgang[] {
  const jetzt = optionen.jetzt ?? new Date();
  const mindestTage = optionen.mindestTage ?? 3;
  const hoechstTage = optionen.hoechstTage ?? 90;
  const eigene = new Set(optionen.eigeneAdressen.map(normalisiere));

  const posteingangOrdner = eingabe.posteingangOrdner ?? 'INBOX';
  const markiert = [
    ...eingabe.posteingang.map((m) => ({ ...m, ordner: posteingangOrdner, vonMir: false })),
    ...eingabe.gesendet.map((m) => ({ ...m, ordner: eingabe.gesendetOrdner, vonMir: true })),
  ];

  const vorgaenge: OffenerVorgang[] = [];

  for (const gespraech of gruppiere(markiert).values()) {
    // Ohne Datum lässt sich nichts über den Verlauf sagen - solche Gespräche übergehen.
    const datiert = gespraech.filter((m) => m.date);
    if (datiert.length === 0) continue;

    const juengste = datiert.reduce((a, b) => (a.date!.getTime() >= b.date!.getTime() ? a : b));
    const alter = Math.floor((jetzt.getTime() - juengste.date!.getTime()) / TAG_MS);
    if (alter < mindestTage || alter > hoechstTage) continue;

    const meins = (juengste as (typeof markiert)[number]).vonMir;

    if (meins) {
      // Eigene Nachricht zuletzt: es steht eine Antwort aus. Ging sie an niemanden oder
      // nur an mich selbst, ist nichts zu erwarten.
      const gegenueber = [...juengste.to, ...juengste.cc].filter(
        (a) => !eigene.has(normalisiere(a.address)),
      );
      if (gegenueber.length === 0) continue;
      if (gegenueber.some((a) => KEINE_ANTWORT.test(a.address.split('@')[0] ?? ''))) continue;

      vorgaenge.push({
        art: 'wartetAufAntwort',
        uid: juengste.uid,
        ordner: (juengste as (typeof markiert)[number]).ordner,
        betreff: juengste.subject,
        gegenueber,
        datum: juengste.date,
        tageOffen: alter,
        umfang: gespraech.length,
      });
      continue;
    }

    // Fremde Nachricht zuletzt: ich habe nicht geantwortet.
    if (istRundmail(juengste) || istAutomatisch(juengste)) continue;

    // Nur was an mich gerichtet war - beim stillen Verteiler steht die eigene Adresse
    // in keinem Feld, und eine Antwort erwartet dort auch niemand.
    const anMich = [...juengste.to, ...juengste.cc].some((a) => eigene.has(normalisiere(a.address)));
    if (!anMich) continue;

    const gegenueber = juengste.from.filter((a) => !eigene.has(normalisiere(a.address)));
    if (gegenueber.length === 0) continue;

    vorgaenge.push({
      art: 'nichtBeantwortet',
      uid: juengste.uid,
      ordner: (juengste as (typeof markiert)[number]).ordner,
      betreff: juengste.subject,
      gegenueber,
      datum: juengste.date,
      tageOffen: alter,
      umfang: gespraech.length,
    });
  }

  // Wem ich je selbst geschrieben habe, der ist ein Gegenüber - egal wie oft er schreibt.
  // Auch die Wohnadresse zählt: wer sich bei einer Firma beworben hat, korrespondiert
  // danach mit mehreren Leuten desselben Hauses, nicht nur mit dem ersten.
  const bekannt = new Set<string>();
  const bekannteHaeuser = new Set<string>();
  for (const m of eingabe.gesendet) {
    for (const a of [...m.to, ...m.cc]) {
      const adresse = normalisiere(a.address);
      bekannt.add(adresse);
      const haus = adresse.split('@')[1];
      if (haus) bekannteHaeuser.add(haus);
    }
  }

  const wieOft = new Map<string, number>();
  for (const v of vorgaenge) {
    if (v.art !== 'nichtBeantwortet') continue;
    const adresse = normalisiere(v.gegenueber[0]?.address ?? '');
    wieOft.set(adresse, (wieOft.get(adresse) ?? 0) + 1);
  }

  const gefiltert = vorgaenge.filter((v) => {
    if (v.art !== 'nichtBeantwortet') return true;
    const adresse = normalisiere(v.gegenueber[0]?.address ?? '');

    // Bekannte immer: mit ihnen besteht Austausch, da zählt jede offene Nachricht.
    if (bekannt.has(adresse) || bekannteHaeuser.has(adresse.split('@')[1] ?? '')) return true;
    if (!optionen.auchUnbekannte) {
      // Von Unbekannten nur, wo es ein Hin und Her gab - eine einzelne Nachricht ohne
      // jede Vorgeschichte ist fast immer eine Bestätigung oder ein Hinweis.
      return v.umfang > 1;
    }
    return (wieOft.get(adresse) ?? 0) < RUNDFUNK_AB;
  });

  // Das am längsten Liegengebliebene zuerst - danach fragt man zuerst nach.
  return gefiltert.sort((a, b) => b.tageOffen - a.tageOffen);
}
