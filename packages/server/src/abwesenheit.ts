import path from 'node:path';
import {
  sendRawMessage,
  buildRawMessage,
  type AccountConfig,
  type MessageSummary,
} from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { liesGeschuetzt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { protokolliere } from './protokollDatei.js';
import { findeKontakt } from './contactStore.js';

/**
 * Die Abwesenheitsnotiz.
 *
 * ## Warum hier und nicht beim Anbieter
 *
 * Weil kaum ein Anbieter sie kontenübergreifend anbietet und die, die es tun, es jeweils
 * anders bedienen lassen. Vor allem aber: Ein Teil der Anbieter hat gar keine. Hier gilt
 * dieselbe Notiz für jedes Konto, gleich wo es liegt.
 *
 * Der Preis steht offen in BETRIEB.md: **Sie antwortet nur, solange der Dienst läuft.**
 * Eine serverseitige Notiz (Sieve) läge beim Anbieter und liefe auch, wenn hier niemand
 * eingeschaltet ist. Diese hier hängt an der Postfachüberwachung. Für einen Dienst, der
 * ohnehin durchläuft, ist das der richtige Tausch - für einen Rechner, der abends
 * ausgeht, wäre es der falsche.
 *
 * ## Warum dieses Modul fast nur aus Verboten besteht
 *
 * Weil das Verschicken der leichte Teil ist. Der schwere ist zu wissen, wann man den Mund
 * hält. Eine Abwesenheitsnotiz, die zu viel antwortet, ist kein Schönheitsfehler:
 *
 *  - Sie antwortet einem Zustellbericht, der Bericht kommt zurück, sie antwortet wieder -
 *    zwei Postfächer laufen über.
 *  - Sie antwortet einem Verteiler, und vierhundert Menschen erfahren, dass jemand, den
 *    sie nicht kennen, bis zum 14. im Urlaub ist.
 *  - Sie antwortet auf Werbung und bestätigt damit einem Versender, dass die Adresse
 *    gelesen wird.
 *  - Sie antwortet einer anderen Abwesenheitsnotiz, und die beiden schreiben sich das
 *    Wochenende über.
 *
 * Deshalb ist `pruefeAntwort()` die eigentliche Arbeit dieses Moduls, und deshalb gibt sie
 * einen **Grund** zurück statt eines Ja/Nein: Was nicht beantwortet wurde, muss sich im
 * Protokoll nachlesen lassen, sonst sucht man bei einer ausgebliebenen Antwort im Nebel.
 *
 * Maßgeblich ist RFC 3834 ("Recommendations for Automatic Responses to Electronic Mail").
 */

export interface Abwesenheit {
  aktiv: boolean;
  /** Ab wann sie gilt (ISO-Datum). Leer heißt: sofort. */
  von?: string;
  /** Bis wann - einschließlich dieses Tages. Leer heißt: bis auf Widerruf. */
  bis?: string;
  /** Der Betreff der Antwort. Leer heißt: die Vorgabe. */
  betreff?: string;
  text: string;
  /**
   * Nur an Menschen antworten, die im Adressbuch stehen.
   *
   * Für den, der die Notiz nicht an jeden Fremden geben will. Aus, weil das Übliche ist,
   * jedem zu antworten, der schreibt - und weil ein Kunde, der zum ersten Mal schreibt,
   * gerade nicht im Adressbuch steht.
   */
  nurBekannte?: boolean;
  /**
   * Nach wie vielen Tagen derselbe Absender wieder eine bekommt.
   *
   * Vier Tage als Vorgabe. Null wäre falsch verstandene Gründlichkeit: Wer in einem
   * Vorgang fünfmal schreibt, bekommt sonst fünfmal dieselbe Notiz, und das ist genau
   * das Verhalten, wegen dessen Abwesenheitsnotizen einen schlechten Ruf haben.
   */
  wiederholungTage?: number;
}

const VORGABE: Abwesenheit = { aktiv: false, text: '', wiederholungTage: 4 };

type Ablage = Record<string, Abwesenheit>;

const getPfad = () => path.join(getNutzerDir(), 'abwesenheit.json');

function lesen(): Ablage {
  const befund = liesGeschuetzt<Ablage>(getPfad(), {});
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'abwesenheit',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  return befund.wert && typeof befund.wert === 'object' ? befund.wert : {};
}

function schreiben(ablage: Ablage): void {
  schreibeGeschuetzt(getPfad(), JSON.stringify(ablage, null, 2));
}

export function abwesenheitFuer(accountId: string): Abwesenheit {
  return { ...VORGABE, ...lesen()[accountId] };
}

export function setzeAbwesenheit(accountId: string, wert: Abwesenheit): Abwesenheit {
  const ablage = lesen();
  const fertig: Abwesenheit = {
    aktiv: Boolean(wert.aktiv),
    von: wert.von || undefined,
    bis: wert.bis || undefined,
    betreff: wert.betreff?.trim() || undefined,
    text: typeof wert.text === 'string' ? wert.text : '',
    nurBekannte: wert.nurBekannte ? true : undefined,
    wiederholungTage:
      Number.isFinite(wert.wiederholungTage) && wert.wiederholungTage! >= 0
        ? Math.min(90, Math.round(wert.wiederholungTage!))
        : 4,
  };
  ablage[accountId] = fertig;
  schreiben(ablage);
  protokolliere(
    'info',
    'abwesenheit',
    `Abwesenheitsnotiz für ${accountId} ${fertig.aktiv ? 'eingeschaltet' : 'ausgeschaltet'}.`,
  );
  return { ...VORGABE, ...fertig };
}

/** Beim Entfernen eines Kontos verschwindet auch dessen Notiz. */
export function abwesenheitVerwerfen(accountId: string): void {
  const ablage = lesen();
  if (!(accountId in ablage)) return;
  delete ablage[accountId];
  schreiben(ablage);
  const gesendet = lesenGesendet();
  if (gesendet[accountId]) {
    delete gesendet[accountId];
    schreibenGesendet(gesendet);
  }
}

/** Welche Konten gerade wirklich antworten - für die Anzeige in der Seitenleiste. */
export function aktiveAbwesenheiten(accountIds: string[], jetzt = new Date()): string[] {
  return accountIds.filter((id) => {
    const notiz = abwesenheitFuer(id);
    return notiz.aktiv && imZeitraum(notiz, jetzt);
  });
}

// --- Wem schon geantwortet wurde ---

/**
 * Je Konto: Adresse (klein) auf Zeitstempel der letzten Antwort.
 *
 * Auf Platte und nicht im Speicher - das ist der Unterschied zwischen einer Bremse, die
 * greift, und einer, die es nur bis zum nächsten Neustart tut. Ein Neustart kommt bei
 * jedem Einspielen einer Fassung, und ein Kollege, der jeden Tag schreibt, bekäme sonst
 * jedes Mal aufs Neue dieselbe Notiz.
 */
type Gesendet = Record<string, Record<string, number>>;

const getGesendetPfad = () => path.join(getNutzerDir(), 'abwesenheitGesendet.json');

/** Deckel gegen unbegrenztes Wachsen - bei Erreichen fliegen die ältesten Einträge. */
const MAX_ADRESSEN = 5_000;

function lesenGesendet(): Gesendet {
  const befund = liesGeschuetzt<Gesendet>(getGesendetPfad(), {});
  return befund.wert && typeof befund.wert === 'object' ? befund.wert : {};
}

function schreibenGesendet(ablage: Gesendet): void {
  schreibeGeschuetzt(getGesendetPfad(), JSON.stringify(ablage));
}

export function zuletztGeantwortet(accountId: string, adresse: string): number | undefined {
  return lesenGesendet()[accountId]?.[adresse.trim().toLowerCase()];
}

export function merkeAntwort(accountId: string, adresse: string, wann = Date.now()): void {
  const ablage = lesenGesendet();
  const je = ablage[accountId] ?? {};
  je[adresse.trim().toLowerCase()] = wann;

  if (Object.keys(je).length > MAX_ADRESSEN) {
    const sortiert = Object.entries(je).sort((a, b) => b[1] - a[1]);
    ablage[accountId] = Object.fromEntries(sortiert.slice(0, MAX_ADRESSEN));
  } else {
    ablage[accountId] = je;
  }
  schreibenGesendet(ablage);
}

/** Nur für Prüfungen und für "von vorn beginnen" beim Einschalten. */
export function vergissGeantwortete(accountId: string): void {
  const ablage = lesenGesendet();
  if (!ablage[accountId]) return;
  delete ablage[accountId];
  schreibenGesendet(ablage);
}

// --- Die Entscheidung ---

export type Ablehnungsgrund =
  | 'aus'
  | 'zeitraum'
  | 'ohne-text'
  | 'kein-absender'
  | 'zustellbericht'
  | 'eigene-adresse'
  | 'maschinell'
  | 'nicht-erwuenscht'
  | 'verteiler'
  | 'automat'
  | 'nicht-an-mich'
  | 'unbekannt'
  | 'schon-geantwortet';

export type Befund =
  | { antworten: true; an: string; absender: string }
  | { antworten: false; grund: Ablehnungsgrund };

function imZeitraum(notiz: Abwesenheit, jetzt: Date): boolean {
  /*
   * Verglichen wird auf den Tag genau, nicht auf die Sekunde.
   *
   * Wer "bis 14.08." einträgt, meint den 14. mit. Ein Vergleich gegen Mitternacht des
   * 14. schaltete die Notiz einen Tag zu früh ab - und zwar an dem Tag, an dem der
   * Mensch noch weg ist.
   */
  const tag = jetzt.toISOString().slice(0, 10);
  if (notiz.von && tag < notiz.von) return false;
  if (notiz.bis && tag > notiz.bis) return false;
  return true;
}

/** Alle Adressen, unter denen dieses Konto Post bekommt. */
function eigeneAdressen(account: AccountConfig): string[] {
  return [account.email, ...(account.identitaeten ?? []).map((i) => i.email)]
    .filter(Boolean)
    .map((a) => a.trim().toLowerCase());
}

/**
 * Absender, denen grundsätzlich niemand antwortet.
 *
 * Kein vollständiges Verzeichnis - das gibt es nicht -, sondern die Handvoll Namen, hinter
 * denen nachweislich nie ein Mensch sitzt. Geprüft wird der Teil vor dem @, damit
 * "noreply@irgendwas.de" ebenso trifft wie "no-reply@".
 */
const AUTOMATEN = /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply|bounce[sd]?|abuse|nobody)$/i;

export interface Umstaende {
  account: AccountConfig;
  notiz: Abwesenheit;
  nachricht: MessageSummary;
  ordner: string;
  jetzt?: Date;
  /** Wann diesem Absender zuletzt geantwortet wurde - `undefined`, wenn noch nie. */
  zuletzt?: number;
  /** Ob die Adresse im Adressbuch steht. Nur gefragt, wenn `nurBekannte` gilt. */
  istBekannt?: (adresse: string) => boolean;
}

/**
 * Darf auf diese Nachricht geantwortet werden - und an welche Adresse?
 *
 * Rein rechnend: kein Dateizugriff, kein Netz. Alles, was von außen kommt, steht in
 * `Umstaende`. Nur so lässt sich das Wesentliche an diesem Modul prüfen, ohne ein
 * Postfach zu haben.
 *
 * Die Reihenfolge der Prüfungen ist nicht beliebig. Zuerst kommt, was gar nichts kostet
 * (ist sie überhaupt an?), dann das Gefährliche (Schleifen), dann das Unhöfliche
 * (Verteiler), zuletzt das Persönliche (schon geantwortet). So steht im Protokoll immer
 * der triftigste Grund und nicht der zufällig erste.
 */
export function pruefeAntwort(u: Umstaende): Befund {
  const { account, notiz, nachricht } = u;
  const jetzt = u.jetzt ?? new Date();

  if (!notiz.aktiv) return { antworten: false, grund: 'aus' };
  if (!notiz.text.trim()) return { antworten: false, grund: 'ohne-text' };
  if (!imZeitraum(notiz, jetzt)) return { antworten: false, grund: 'zeitraum' };

  /*
   * Nur der Posteingang.
   *
   * Nicht der Spamordner - eine Antwort dorthin bestätigt einem Versender, dass die
   * Adresse gelesen wird. Nicht der Gesendet-Ordner, denn dort steht die eigene Post.
   * Und nicht irgendein Ordner, den der Nutzer gerade offen hat: Überwacht werden auch
   * angesehene Ordner, und in einem Archiv liegt Post von vor drei Jahren.
   */
  if (!/^inbox$/i.test(u.ordner)) return { antworten: false, grund: 'nicht-an-mich' };

  /*
   * Der leere Rückweg: ein Zustellbericht.
   *
   * Die wichtigste Zeile hier. `Return-Path: <>` heißt "hierauf wird nicht geantwortet",
   * und wer es doch tut, bekommt seine Antwort als unzustellbar zurück, antwortet
   * darauf, und so fort. Genau davor warnt RFC 3834 an erster Stelle.
   */
  if (nachricht.rueckweg === '') return { antworten: false, grund: 'zustellbericht' };

  const an = (nachricht.rueckweg || nachricht.from[0]?.address || '').trim().toLowerCase();
  if (!an || !an.includes('@')) return { antworten: false, grund: 'kein-absender' };

  const meine = eigeneAdressen(account);
  // Die eigene Post - etwa eine Kopie an sich selbst oder ein Konto, das sich selbst
  // schreibt. Eine Antwort darauf ist eine Schleife mit nur einem Beteiligten.
  if (meine.includes(an)) return { antworten: false, grund: 'eigene-adresse' };

  if (nachricht.maschinell) return { antworten: false, grund: 'maschinell' };
  if (nachricht.keineAutoAntwort) return { antworten: false, grund: 'nicht-erwuenscht' };
  if (nachricht.listId || nachricht.listUnsubscribe) {
    return { antworten: false, grund: 'verteiler' };
  }
  if (AUTOMATEN.test(an.split('@')[0] ?? '')) return { antworten: false, grund: 'automat' };

  /*
   * Steht eine meiner Adressen in An oder Kopie?
   *
   * Sonst kam die Nachricht über einen Verteiler, eine Weiterleitung oder als Blindkopie.
   * In allen drei Fällen ist eine Antwort verkehrt: Der Absender hat nicht mir
   * geschrieben, und meine Notiz verrät ihm, wo seine Post überall landet.
   *
   * Zugleich ist das die Stelle, an der sich der Absender der Antwort entscheidet: Wurde
   * an eine Zweitadresse geschrieben, geht die Notiz auch von dieser hinaus - alles
   * andere wäre eine Auskunft über die eigenen Aliase.
   */
  const angeschrieben = [...nachricht.to, ...nachricht.cc]
    .map((a) => a.address?.trim().toLowerCase())
    .filter((a): a is string => Boolean(a));
  const getroffen = meine.find((m) => angeschrieben.includes(m));
  if (!getroffen) return { antworten: false, grund: 'nicht-an-mich' };

  if (notiz.nurBekannte && !u.istBekannt?.(an)) {
    return { antworten: false, grund: 'unbekannt' };
  }

  const frist = (notiz.wiederholungTage ?? 4) * 24 * 60 * 60 * 1000;
  if (u.zuletzt !== undefined && frist > 0 && jetzt.getTime() - u.zuletzt < frist) {
    return { antworten: false, grund: 'schon-geantwortet' };
  }

  return { antworten: true, an, absender: getroffen };
}

// --- Das Verschicken ---

/**
 * Wie viele Antworten je Konto und Stunde höchstens hinausgehen.
 *
 * Ein Notaus, keine Feineinstellung. Die Wiederholungsbremse fängt denselben Absender;
 * dieser Deckel fängt den Fall, den sie nicht sieht - eine Werbewelle mit dreihundert
 * verschiedenen Absendern, oder ein Anbieter, der nach einer Störung den halben
 * Posteingang noch einmal als "neu" meldet. Ohne ihn verschickte der Dienst dann
 * dreihundert Nachrichten und stünde danach auf jeder Sperrliste.
 */
const MAX_JE_STUNDE = 50;

const zaehler = new Map<string, { fenster: number; anzahl: number }>();

function darfNoch(accountId: string, jetzt: number): boolean {
  const fenster = Math.floor(jetzt / (60 * 60 * 1000));
  const stand = zaehler.get(accountId);
  if (!stand || stand.fenster !== fenster) {
    zaehler.set(accountId, { fenster, anzahl: 1 });
    return true;
  }
  if (stand.anzahl >= MAX_JE_STUNDE) return false;
  stand.anzahl += 1;
  return true;
}

/** Nur für Prüfungen. */
export function vergissDeckel(): void {
  zaehler.clear();
}

/** Der Betreff, wenn der Nutzer keinen eigenen eingetragen hat. */
function betreffFuer(notiz: Abwesenheit, original: string): string {
  if (notiz.betreff) return notiz.betreff;
  /*
   * "Re:" davor, und der ursprüngliche Betreff dahinter.
   *
   * Damit landet die Notiz im Gesprächsfaden des Absenders und nicht als loser Zettel
   * daneben. Ein fester Betreff ("Abwesenheitsnotiz") wäre für den Empfänger schwerer
   * zuzuordnen - er weiß dann nicht, auf welche seiner drei Mails sie sich bezieht.
   */
  const sauber = original.replace(/^((re|aw|antw|fwd?|wg)\s*:\s*)+/i, '').trim();
  return sauber ? `Re: ${sauber}` : 'Abwesenheitsnotiz';
}

/**
 * Verschickt die Notiz.
 *
 * **Ohne Kopie im Gesendet-Ordner**, und das ist eine Entscheidung: Wer drei Wochen weg
 * ist, hat sonst hundert Zettel zwischen seiner wirklichen Post stehen, und die
 * Nachrichten, die er selbst geschrieben hat, sind darin nicht mehr zu finden. Was
 * hinausging, steht im Protokoll - mit Adresse und Zeitpunkt.
 */
export async function verschickeNotiz(
  account: AccountConfig,
  notiz: Abwesenheit,
  nachricht: MessageSummary,
  an: string,
  absender: string,
): Promise<void> {
  const name =
    (account.identitaeten ?? []).find((i) => i.email.toLowerCase() === absender)?.displayName ??
    account.displayName;

  const roh = await buildRawMessage(account, {
    to: [an],
    subject: betreffFuer(notiz, nachricht.subject ?? ''),
    text: notiz.text,
    absender: { email: absender, displayName: name },
    // In den Faden einhängen, damit die Notiz beim Empfänger bei seiner eigenen Nachricht
    // steht und nicht irgendwo im Posteingang.
    inReplyTo: nachricht.messageId,
    references: nachricht.messageId ? [nachricht.messageId] : undefined,
    kopfzeilen: {
      /*
       * Die drei Zeilen, ohne die man das nicht verschicken darf.
       *
       * `Auto-Submitted: auto-replied` ist die aus RFC 3834: Daran erkennt die Gegenseite,
       * dass hier eine Maschine geantwortet hat - und antwortet nicht ihrerseits
       * maschinell zurück. Genau daran hängt, dass sich zwei Abwesenheitsnotizen nicht
       * gegenseitig das Wochenende über schreiben. Unser eigener Empfang wertet sie
       * ebenfalls aus (siehe `maschinell` in imapClient.ts), das gilt also in beide
       * Richtungen.
       *
       * `X-Auto-Response-Suppress` sagt dasselbe noch einmal in der Sprache, die Exchange
       * versteht, und `Precedence: bulk` in der alten, die manches Betagte noch spricht.
       */
      'Auto-Submitted': 'auto-replied',
      'X-Auto-Response-Suppress': 'All',
      Precedence: 'bulk',
    },
  });

  await sendRawMessage(account, roh, [an]);
}

/**
 * Der ganze Vorgang für eine Menge frisch eingetroffener Nachrichten.
 *
 * Wird von der Postfachüberwachung gerufen, nachdem die Regeln gelaufen sind. Fehler
 * werden hier abgefangen und nicht geworfen: Eine Abwesenheitsnotiz, die nicht hinausgeht,
 * ist ärgerlich - eine, die die Postfachüberwachung mitreißt, ist ein Ausfall.
 */
export async function beantworteNeue(
  account: AccountConfig,
  ordner: string,
  nachrichten: MessageSummary[],
): Promise<number> {
  const notiz = abwesenheitFuer(account.id);
  if (!notiz.aktiv || nachrichten.length === 0) return 0;

  let gesendet = 0;
  for (const nachricht of nachrichten) {
    const befund = pruefeAntwort({
      account,
      notiz,
      nachricht,
      ordner,
      zuletzt: zuletztGeantwortetFuer(account.id, nachricht),
      istBekannt: (adresse) => Boolean(findeKontakt(adresse)),
    });

    if (!befund.antworten) {
      /*
       * Nur die Gründe protokollieren, bei denen sich jemand wundern könnte.
       *
       * "aus", "zeitraum" und "schon-geantwortet" treffen bei eingeschalteter Notiz auf
       * fast jede Nachricht zu und ergäben ein Protokoll, in dem der eine wichtige
       * Eintrag nicht mehr zu finden ist.
       */
      if (['zustellbericht', 'automat', 'verteiler', 'nicht-erwuenscht'].includes(befund.grund)) {
        protokolliere(
          'info',
          'abwesenheit',
          `Keine Notiz an "${nachricht.from[0]?.address ?? '?'}" (${befund.grund}).`,
        );
      }
      continue;
    }

    if (!darfNoch(account.id, Date.now())) {
      protokolliere(
        'warnung',
        'abwesenheit',
        `Deckel erreicht: mehr als ${MAX_JE_STUNDE} Notizen je Stunde für ${account.email}. ` +
          'Der Rest dieser Stunde bleibt unbeantwortet.',
      );
      break;
    }

    try {
      await verschickeNotiz(account, notiz, nachricht, befund.an, befund.absender);
      /*
       * Erst senden, dann merken - und nicht umgekehrt.
       *
       * Andersherum hätte ein misslungener Versand denselben Absender für vier Tage
       * gesperrt, ohne dass er je eine Notiz bekommen hätte. So ist der schlimmste Fall
       * eine zweite Notiz und nicht eine ausbleibende.
       */
      merkeAntwort(account.id, befund.an);
      gesendet += 1;
      protokolliere('info', 'abwesenheit', `Notiz an ${befund.an} von ${befund.absender}.`);
    } catch (err) {
      protokolliere(
        'warnung',
        'abwesenheit',
        `Notiz an ${befund.an} konnte nicht verschickt werden: ${(err as Error).message}`,
      );
    }
  }
  return gesendet;
}

function zuletztGeantwortetFuer(accountId: string, nachricht: MessageSummary): number | undefined {
  const an = (nachricht.rueckweg || nachricht.from[0]?.address || '').trim().toLowerCase();
  return an ? zuletztGeantwortet(accountId, an) : undefined;
}
