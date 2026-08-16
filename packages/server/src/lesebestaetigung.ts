import path from 'node:path';
import {
  baueLesebestaetigung,
  sendRawMessage,
  type AccountConfig,
  type MessageSummary,
} from '@energy-mail/mail-core';
import { t } from '@energy-mail/mail-core/sprache';
import { getNutzerDir } from './paths.js';
import { liesGeschuetzt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { protokolliere } from './protokollDatei.js';

/**
 * Lesebestätigungen - und vor allem: wann keine hinausgeht.
 *
 * ## Was eine Lesebestätigung ist und was nicht
 *
 * Sie sagt: Diese Nachricht war auf einem Bildschirm. Sie sagt nicht, dass jemand sie
 * gelesen, verstanden oder zur Kenntnis genommen hat. Das steht so in RFC 8098, es steht
 * in der Bestätigung selbst (`Disposition: … displayed`), und es steht in BETRIEB.md -
 * denn im Geschäftsleben wird regelmäßig das Gegenteil behauptet.
 *
 * ## Warum das Verweigern der interessante Teil ist
 *
 * Eine Lesebestätigung ist eine Auskunft über einen Menschen an einen anderen, und sie
 * geht automatisch hinaus. Drei Arten, wie das schiefgeht:
 *
 *  - **Sie bestätigt einem Werbeversender, dass die Adresse gelesen wird.** Das ist mehr
 *    wert als ein Klick auf ein Zählpixel - hier antwortet ein Programm mit einer echten
 *    Mail von einer echten Adresse.
 *  - **Sie verrät Arbeitszeiten.** Wann eine Nachricht angezeigt wurde, sagt, wann jemand
 *    am Rechner saß. Über Wochen ergibt das ein Bild.
 *  - **Sie lässt sich als Waffe benutzen.** Eine Nachricht an einen Verteiler, deren
 *    `Disposition-Notification-To` auf ein fremdes Postfach zeigt, macht aus vierhundert
 *    Lesern vierhundert Absender. Deshalb wird bei abweichender Adresse NIE automatisch
 *    bestätigt - auch dann nicht, wenn der Nutzer "immer" eingestellt hat.
 *
 * ## Wer entscheidet, dass etwas "angezeigt" wurde
 *
 * Die Oberfläche, nicht dieser Server. Er weiß nur, dass jemand die Nachricht abgerufen
 * hat - das tut auch ein Zwischenspeicher, eine Vorschau oder eine Suche. Deshalb geht
 * von hier aus nie etwas von selbst hinaus; die Bestätigung wird ausdrücklich verlangt,
 * wenn die Nachricht wirklich vor jemandem steht. Alles andere hieße, "displayed" zu
 * behaupten, ohne es zu wissen.
 */

/** Wie mit Anforderungen umgegangen wird. */
export type Umgang = 'nie' | 'fragen' | 'immer';

/**
 * Voreingestellt ist "fragen", und das ist die einzige vertretbare Vorgabe.
 *
 * "Nie" wäre bevormundend - im Geschäftsleben wird die Bestätigung erwartet, und wer sie
 * nie schickt, bekommt Rückfragen. "Immer" wäre eine Auskunft über den Nutzer, die er nie
 * erlaubt hat. Bleibt "fragen": Es kostet einen Klick, und der Klick ist die Entscheidung.
 */
const VORGABE: Umgang = 'fragen';

type Einstellungen = Record<string, Umgang>;

const getPfad = () => path.join(getNutzerDir(), 'lesebestaetigung.json');

function lesen(): Einstellungen {
  const befund = liesGeschuetzt<Einstellungen>(getPfad(), {});
  return befund.wert && typeof befund.wert === 'object' ? befund.wert : {};
}

export function umgangFuer(accountId: string): Umgang {
  const wert = lesen()[accountId];
  return wert === 'nie' || wert === 'immer' || wert === 'fragen' ? wert : VORGABE;
}

export function setzeUmgang(accountId: string, umgang: Umgang): Umgang {
  const ablage = lesen();
  ablage[accountId] = umgang;
  schreibeGeschuetzt(getPfad(), JSON.stringify(ablage, null, 2));
  protokolliere('info', 'lesebestaetigung', `Umgang für ${accountId}: ${umgang}.`);
  return umgang;
}

export function umgangVerwerfen(accountId: string): void {
  const ablage = lesen();
  if (!(accountId in ablage)) return;
  delete ablage[accountId];
  schreibeGeschuetzt(getPfad(), JSON.stringify(ablage, null, 2));
  const erledigt = lesenErledigt();
  if (erledigt[accountId]) {
    delete erledigt[accountId];
    schreibeErledigt(erledigt);
  }
}

// --- Was schon entschieden wurde ---

/**
 * Je Konto: Nachrichtenkennung auf Entscheidung.
 *
 * Auf Platte, damit ein Neustart nicht dazu führt, dass derselbe Absender ein zweites Mal
 * eine Bestätigung bekommt - oder dass der Nutzer ein zweites Mal gefragt wird, obwohl er
 * schon Nein gesagt hat. "Nein" muss genauso haltbar sein wie "Ja"; sonst ist die Frage
 * eine, die so lange wiederkehrt, bis jemand aus Versehen zustimmt.
 */
type Erledigt = Record<string, Record<string, 'gesendet' | 'abgelehnt'>>;

const getErledigtPfad = () => path.join(getNutzerDir(), 'lesebestaetigungErledigt.json');
const MAX_EINTRAEGE = 5_000;

function lesenErledigt(): Erledigt {
  const befund = liesGeschuetzt<Erledigt>(getErledigtPfad(), {});
  return befund.wert && typeof befund.wert === 'object' ? befund.wert : {};
}

function schreibeErledigt(ablage: Erledigt): void {
  schreibeGeschuetzt(getErledigtPfad(), JSON.stringify(ablage));
}

/**
 * Die Kennung, unter der eine Entscheidung gemerkt wird.
 *
 * Bevorzugt die Message-ID: Sie bleibt dieselbe, auch wenn die Nachricht in einen anderen
 * Ordner wandert oder eine neue UID bekommt. Nur wenn sie fehlt - was vorkommt -, muss
 * Ordner und UID herhalten, und dann hält die Entscheidung nur, solange die Nachricht
 * liegen bleibt.
 */
export function nachrichtenSchluessel(
  nachricht: Pick<MessageSummary, 'messageId' | 'uid'>,
  ordner: string,
): string {
  return nachricht.messageId ?? `${ordner}:${nachricht.uid}`;
}

export function entscheidungZu(accountId: string, schluessel: string): 'gesendet' | 'abgelehnt' | null {
  return lesenErledigt()[accountId]?.[schluessel] ?? null;
}

export function merkeEntscheidung(
  accountId: string,
  schluessel: string,
  was: 'gesendet' | 'abgelehnt',
): void {
  const ablage = lesenErledigt();
  const je = ablage[accountId] ?? {};
  je[schluessel] = was;

  if (Object.keys(je).length > MAX_EINTRAEGE) {
    // Die ältesten fallen heraus. Ein Deckel ist nötig; welche genau gehen, ist bei
    // Nachrichten, die niemand mehr ansieht, ohne Bedeutung.
    const eintraege = Object.entries(je);
    ablage[accountId] = Object.fromEntries(eintraege.slice(eintraege.length - MAX_EINTRAEGE));
  } else {
    ablage[accountId] = je;
  }
  schreibeErledigt(ablage);
}

/** Nur für Prüfungen. */
export function vergissEntscheidungen(accountId: string): void {
  const ablage = lesenErledigt();
  if (!ablage[accountId]) return;
  delete ablage[accountId];
  schreibeErledigt(ablage);
}

// --- Die Entscheidung ---

export type Grund =
  | 'keine-anforderung'
  | 'aus'
  | 'schon-gesendet'
  | 'schon-abgelehnt'
  | 'maschinell'
  | 'verteiler'
  | 'zustellbericht'
  | 'eigene-adresse'
  | 'unbrauchbare-adresse';

export type Befund =
  | { was: 'senden'; an: string }
  | { was: 'fragen'; an: string; abweichend: boolean }
  | { was: 'nein'; grund: Grund };

/** Zieht die reine Adresse aus einem Kopfzeilenwert wie `Anna <anna@beispiel.de>`. */
export function adresseAus(roh: string | undefined): string {
  if (!roh) return '';
  const spitz = /<([^>]+)>/.exec(roh);
  const wert = (spitz?.[1] ?? roh).trim().toLowerCase();
  // Nur die erste - manche Programme schreiben mehrere hinein, und die Norm sieht
  // dafür keine Bedeutung vor. Mehrere Bestätigungen an mehrere Adressen zu schicken
  // wäre die schlechtere von zwei Auslegungen.
  const erste = wert.split(',')[0]?.trim() ?? '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(erste) ? erste : '';
}

export interface Umstaende {
  account: AccountConfig;
  nachricht: MessageSummary;
  umgang: Umgang;
  /** Was zu dieser Nachricht schon entschieden wurde. */
  erledigt: 'gesendet' | 'abgelehnt' | null;
}

/**
 * Darf eine Lesebestätigung hinaus - und ohne zu fragen?
 *
 * Rein rechnend, ohne Dateizugriff. Die Reihenfolge ist nicht beliebig: zuerst, was gar
 * nichts kostet, dann das Gefährliche, zuletzt das Persönliche.
 */
export function pruefeBestaetigung(u: Umstaende): Befund {
  const { account, nachricht, umgang } = u;

  const an = adresseAus(nachricht.bestaetigungAn);
  if (!nachricht.bestaetigungAn) return { was: 'nein', grund: 'keine-anforderung' };
  if (!an) return { was: 'nein', grund: 'unbrauchbare-adresse' };
  if (umgang === 'nie') return { was: 'nein', grund: 'aus' };

  if (u.erledigt === 'gesendet') return { was: 'nein', grund: 'schon-gesendet' };
  if (u.erledigt === 'abgelehnt') return { was: 'nein', grund: 'schon-abgelehnt' };

  // Ein Zustellbericht: `Return-Path: <>`. Wer darauf bestätigt, schreibt ins Leere und
  // bekommt die Bestätigung als unzustellbar zurück.
  if (nachricht.rueckweg === '') return { was: 'nein', grund: 'zustellbericht' };
  if (nachricht.maschinell) return { was: 'nein', grund: 'maschinell' };
  if (nachricht.listId || nachricht.listUnsubscribe) {
    return { was: 'nein', grund: 'verteiler' };
  }

  const meine = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)]
    .filter(Boolean)
    .map((a) => a.trim().toLowerCase());
  if (meine.includes(an)) return { was: 'nein', grund: 'eigene-adresse' };

  /*
   * Weicht die Bestätigungsadresse vom Absender ab, wird IMMER gefragt.
   *
   * Auch bei "immer", und das ist die eine Stelle, an der die Einstellung des Nutzers
   * überstimmt wird. Der Grund ist kein theoretischer: Eine Nachricht an einen Verteiler,
   * deren Bestätigungen an ein fremdes Postfach gehen, macht aus vierhundert Lesern
   * vierhundert Absender - und keiner von ihnen hat etwas davon geahnt. RFC 8098 nennt
   * genau das und verlangt, dass ein Mensch zustimmt.
   */
  const absender = adresseAus(nachricht.rueckweg || nachricht.from[0]?.address);
  const abweichend = Boolean(absender) && absender !== an;

  if (umgang === 'immer' && !abweichend) return { was: 'senden', an };
  return { was: 'fragen', an, abweichend };
}

// --- Das Verschicken ---

/**
 * Verschickt die Bestätigung.
 *
 * `vonHand` steht in der Bestätigung selbst und ist keine Formsache: Es sagt der
 * Gegenseite, ob ein Mensch zugestimmt hat oder ein Programm entschieden hat. Wer das
 * Erste hinschreibt, wo das Zweite zutrifft, macht aus einer Auskunft eine Behauptung.
 */
export async function verschickeBestaetigung(
  account: AccountConfig,
  nachricht: Pick<MessageSummary, 'messageId' | 'subject' | 'date'>,
  an: string,
  vonHand: boolean,
): Promise<void> {
  const roh = baueLesebestaetigung(account, {
    an,
    originalId: nachricht.messageId,
    betreff: t('Gelesen: {betreff}', { betreff: nachricht.subject ?? '' }),
    vonHand,
    /*
     * Der lesbare Teil - für den Menschen, der die Bestätigung bekommt.
     *
     * "angezeigt" und nicht "gelesen", und der Satz danach sagt warum. Eine
     * Lesebestätigung ist kein Nachweis, und die einzige Stelle, an der sich das
     * klarstellen lässt, ist die Bestätigung selbst.
     */
    text: t(
      'Ihre Nachricht "{betreff}" wurde angezeigt.\n\nDas ist keine Bestätigung, dass sie gelesen oder zur Kenntnis genommen wurde – nur, dass sie auf einem Bildschirm stand.\n\nDiese Meldung wurde automatisch erzeugt.',
      { betreff: nachricht.subject ?? '' },
    ),
  });

  await sendRawMessage(account, roh, [an]);
  protokolliere(
    'info',
    'lesebestaetigung',
    `Bestätigung an ${an} für "${nachricht.subject ?? ''}" (${vonHand ? 'von Hand' : 'automatisch'}).`,
  );
}
