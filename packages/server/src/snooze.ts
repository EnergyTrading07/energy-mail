import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createFolder, listFolders, setMessagesSeen, type AccountConfig } from '@energy-mail/mail-core';
import { verschiebeMitKennung } from '@energy-mail/mail-core';
import { getDataDir } from './paths.js';

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
}

const getPfad = () => path.join(getDataDir(), 'wiedervorlage.json');

const offen = new Map<string, Zurueckgestellt>();
const timer = new Map<string, ReturnType<typeof setTimeout>>();

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
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(getPfad(), JSON.stringify([...offen.values()], null, 2), 'utf-8');
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
  const eintrag = offen.get(id);
  if (!eintrag || !kontoHolen) return;
  const account = kontoHolen(eintrag.accountId);
  if (!account) {
    offen.delete(id);
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
  } catch (err) {
    log(`Wiedervorlage "${eintrag.betreff}" fehlgeschlagen: ${(err as Error).message}`);
  } finally {
    offen.delete(id);
    timer.delete(id);
    speichern();
  }
}

function planen(eintrag: Zurueckgestellt): void {
  const t = setTimeout(() => void holeZurueck(eintrag.id), Math.max(0, eintrag.faellig - Date.now()));
  t.unref?.();
  timer.set(eintrag.id, t);
}

export function ladeWiedervorlagen(): void {
  let gespeichert: Zurueckgestellt[] = [];
  try {
    gespeichert = JSON.parse(fs.readFileSync(getPfad(), 'utf-8')) as Zurueckgestellt[];
  } catch {
    return;
  }
  for (const eintrag of gespeichert) {
    offen.set(eintrag.id, eintrag);
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
  offen.set(eintrag.id, eintrag);
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
  return [...offen.values()]
    .filter((e) => !accountId || e.accountId === accountId)
    .sort((a, b) => a.faellig - b.faellig);
}

/** Holt eine Nachricht vorzeitig zurück. */
export async function sofortZurueck(id: string): Promise<boolean> {
  if (!offen.has(id)) return false;
  clearTimeout(timer.get(id));
  await holeZurueck(id);
  return true;
}
