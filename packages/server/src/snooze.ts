import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createFolder, listFolders, setMessagesSeen, type AccountConfig } from '@energy-mail/mail-core';
import { verschiebeMitKennung } from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { liesJson, schreibeAtomar } from './atomar.js';
import { jeNutzer } from './nutzer/jeNutzer.js';
import { istVerbindungsfehler } from './verbindungsfehler.js';

/**
 * Wiedervorlage: eine Nachricht verschwindet aus dem Posteingang und kommt zur
 * gewünschten Zeit als ungelesen zurück.
 *
 * Umgesetzt über einen eigenen Ordner statt über eine Markierung. Eine Markierung wäre
 * einfacher, aber die Nachricht bliebe sichtbar - und genau das will man nicht: der
 * Zweck ist, den Posteingang frei zu bekommen, ohne etwas zu vergessen. Der Ordner hat
 * zudem den Vorteil, dass die zurückgestellten Nachrichten am Handy ebenfalls
 * auffindbar sind.
 *
 * Wiedergefunden wird über die Kennung, die der Server beim Verschieben mitteilt
 * (UIDPLUS). Meldet er keine, wird die Nachricht beim Zurückholen über Betreff und
 * Datum gesucht - das ist der einzige unsichere Punkt und deshalb ausdrücklich benannt.
 */

export const WIEDERVORLAGE_ORDNER = 'Wiedervorlage';

export interface Zurueckgestellt {
  id: string;
  accountId: string;
  /** Woher die Nachricht kam - dorthin geht sie zurück. */
  ursprung: string;
  /** Kennung im Wiedervorlage-Ordner; fehlt, wenn der Server keine mitteilt. */
  uidImOrdner?: number;
  betreff: string;
  faellig: number;
  /** Wie oft das Zurückholen schon fehlgeschlagen ist. Fehlt bei Altbestand. */
  versuche?: number;
}

const getPfad = () => path.join(getNutzerDir(), 'wiedervorlage.json');

/**
 * Wiedervorlagen und Zeitgeber JE NUTZER - aus demselben Grund wie bei der
 * Sendewarteschlange, und ebenfalls ohne Obergrenze: ein verworfener Eintrag hieße eine
 * Nachricht, die nie zurückkommt.
 */
interface NutzerWiedervorlage {
  offen: Map<string, Zurueckgestellt>;
  timer: Map<string, ReturnType<typeof setTimeout>>;
}

const wiedervorlagen = jeNutzer<NutzerWiedervorlage>(() => ({
  offen: new Map(),
  timer: new Map(),
}));

const offenVon = () => wiedervorlagen.hole().offen;
const timerVon = () => wiedervorlagen.hole().timer;

let kontoHolen: ((accountId: string) => AccountConfig | null) | null = null;
let log: (msg: string) => void = () => {};
let nachHolen: ((accountId: string, ordner: string) => void) | null = null;

export function setWiedervorlageUmgebung(
  konten: (accountId: string) => AccountConfig | null,
  logger: (msg: string) => void,
  beiRueckkehr: (accountId: string, ordner: string) => void,
): void {
  kontoHolen = konten;
  log = logger;
  nachHolen = beiRueckkehr;
}

function speichern(): void {
  try {
    schreibeAtomar(getPfad(), JSON.stringify([...offenVon().values()], null, 2));
  } catch (err) {
    log(`Wiedervorlagen konnten nicht gesichert werden: ${(err as Error).message}`);
  }
}

/** Legt den Ordner an, falls er fehlt. */
async function stelleOrdnerSicher(account: AccountConfig): Promise<void> {
  const vorhanden = await listFolders(account);
  if (vorhanden.some((f) => f.path === WIEDERVORLAGE_ORDNER)) return;
  await createFolder(account, WIEDERVORLAGE_ORDNER);
}

async function holeZurueck(id: string): Promise<void> {
  const eintrag = offenVon().get(id);
  if (!eintrag || !kontoHolen) return;
  const account = kontoHolen(eintrag.accountId);
  if (!account) {
    offenVon().delete(id);
    speichern();
    return;
  }

  try {
    if (eintrag.uidImOrdner === undefined) {
      throw new Error(
        'Der Server hat beim Zurückstellen keine Kennung mitgeteilt - die Nachricht ' +
          `liegt weiterhin im Ordner "${WIEDERVORLAGE_ORDNER}".`,
      );
    }
    const { neueUids } = await verschiebeMitKennung(
      account,
      WIEDERVORLAGE_ORDNER,
      [eintrag.uidImOrdner],
      eintrag.ursprung,
    );
    // Als ungelesen zurückgeben: sie soll auffallen, das war ja der Zweck.
    const zurueck = neueUids.get(eintrag.uidImOrdner);
    if (zurueck !== undefined) {
      await setMessagesSeen(account, eintrag.ursprung, [zurueck], false);
    }
    log(`Wiedervorlage: "${eintrag.betreff}" zurück in "${eintrag.ursprung}".`);
    nachHolen?.(eintrag.accountId, eintrag.ursprung);
    // Erst jetzt austragen: nur ein tatsächlich zurückgeholter Eintrag ist erledigt.
    offenVon().delete(id);
    timerVon().delete(id);
    speichern();
  } catch (err) {
    timerVon().delete(id);
    /*
     * Nicht löschen, sondern erneut versuchen.
     *
     * Vorher stand das Löschen im finally - also auch dann, wenn das Verschieben
     * fehlgeschlagen war. Wer eine Mail auf "morgen 9 Uhr" zurückstellte und um 9 Uhr
     * gerade den Rechner hochgefahren hatte, ohne dass das Netz schon stand, bekam sie
     * NIE zurück: sie verschwand aus der Wiedervorlage und lag unsichtbar im Ordner
     * "Wiedervorlage". Sichtbar war davon nur eine Zeile im Protokoll.
     *
     * Ein Verbindungsfehler ist vorübergehend und rechtfertigt einen neuen Anlauf. Alles
     * andere - der Ordner ist weg, die Nachricht gelöscht - wiederholt sich nicht von
     * selbst; dort wird nach einigen Versuchen aufgegeben, damit nichts endlos kreist.
     */
    const versuche = (eintrag.versuche ?? 0) + 1;
    const grund = (err as Error).message;
    const nochmal = istVerbindungsfehler(err) ? versuche <= 20 : versuche <= 3;

    if (!nochmal) {
      offenVon().delete(id);
      speichern();
      log(
        `Wiedervorlage "${eintrag.betreff}" nach ${versuche} Versuchen aufgegeben: ${grund}. ` +
          `Die Nachricht liegt weiterhin im Ordner "${WIEDERVORLAGE_ORDNER}".`,
      );
      return;
    }

    eintrag.versuche = versuche;
    // Wachsender Abstand, gedeckelt bei einer Stunde.
    eintrag.faellig = Date.now() + Math.min(60_000 * 2 ** (versuche - 1), 60 * 60_000);
    offenVon().set(id, eintrag);
    speichern();
    planen(eintrag);
    log(`Wiedervorlage "${eintrag.betreff}" fehlgeschlagen (Versuch ${versuche}): ${grund}`);
  }
}

/**
 * Node wartet höchstens 2^31-1 ms (rund 24,8 Tage); darüber feuert setTimeout SOFORT.
 * "Erinnere mich in zwei Monaten" holte die Nachricht damit augenblicklich zurück.
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function planen(eintrag: Zurueckgestellt): void {
  const wartezeit = Math.max(0, eintrag.faellig - Date.now());
  const t = setTimeout(() => {
    // In Etappen: ist die eigentliche Fälligkeit noch nicht erreicht, neu planen.
    if (Date.now() < eintrag.faellig) {
      planen(eintrag);
      return;
    }
    void holeZurueck(eintrag.id);
  }, Math.min(wartezeit, MAX_TIMEOUT_MS));
  t.unref?.();
  timerVon().set(eintrag.id, t);
}

export function ladeWiedervorlagen(): void {
  const befund = liesJson<unknown>(getPfad(), []);
  if (befund.beschaedigt) {
    log(
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  const roh = Array.isArray(befund.wert) ? (befund.wert as unknown[]) : [];
  const gespeichert = roh.filter((e): e is Zurueckgestellt => {
    const z = e as Partial<Zurueckgestellt> | null;
    return Boolean(
      z && typeof z === 'object' && typeof z.id === 'string' && Number.isFinite(z.faellig),
    );
  });
  for (const eintrag of gespeichert) {
    offenVon().set(eintrag.id, eintrag);
    planen(eintrag);
  }
  if (gespeichert.length > 0) log(`${gespeichert.length} Wiedervorlage(n) geladen.`);
}

export async function stelleZurueck(
  account: AccountConfig,
  ordner: string,
  uid: number,
  betreff: string,
  faellig: number,
): Promise<Zurueckgestellt> {
  await stelleOrdnerSicher(account);
  const { neueUids } = await verschiebeMitKennung(account, ordner, [uid], WIEDERVORLAGE_ORDNER);

  const eintrag: Zurueckgestellt = {
    id: randomUUID(),
    accountId: account.id,
    ursprung: ordner,
    uidImOrdner: neueUids.get(uid),
    betreff,
    faellig,
  };
  offenVon().set(eintrag.id, eintrag);
  speichern();
  planen(eintrag);

  if (eintrag.uidImOrdner === undefined) {
    log(
      `Wiedervorlage "${betreff}": der Server nennt keine neue Kennung (kein UIDPLUS). ` +
        'Die Nachricht liegt im Wiedervorlage-Ordner, kommt aber nicht von selbst zurück.',
    );
  }
  return eintrag;
}

export function listeWiedervorlagen(accountId?: string): Zurueckgestellt[] {
  return [...offenVon().values()]
    .filter((e) => !accountId || e.accountId === accountId)
    .sort((a, b) => a.faellig - b.faellig);
}

/** Holt eine Nachricht vorzeitig zurück. */
export async function sofortZurueck(id: string): Promise<boolean> {
  if (!offenVon().has(id)) return false;
  clearTimeout(timerVon().get(id));
  await holeZurueck(id);
  return true;
}
