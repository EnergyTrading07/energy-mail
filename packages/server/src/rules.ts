import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  findSpecialFolder,
  moveMessages,
  setMessagesFlagged,
  setMessagesSeen,
  type AccountConfig,
  type MessageSummary,
  type Regel,
} from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { liesGeschuetzt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { protokolliere } from './protokollDatei.js';

/**
 * Regeln, die beim Eintreffen einer Nachricht angewendet werden.
 *
 * Bewusst hier und nicht beim Anbieter: Gmail und GMX haben eigene Filter, aber jeder
 * anders bedienbar und keiner kontenübergreifend. Hier gilt dieselbe Regel für alle
 * Konten, und sie greift auch bei Anbietern, die gar keine Filter anbieten.
 *
 * Angewendet wird auf neu eingetroffene Nachrichten - dafür meldet die Überwachung
 * ohnehin bereits deren Kopfdaten. Zusätzlich lassen sich Regeln von Hand auf einen
 * bestehenden Ordner anwenden; das ist der Weg, ein zugewachsenes Postfach aufzuräumen.
 */

const getPfad = () => path.join(getNutzerDir(), 'regeln.json');

/** Regeln je Konto. Getrennt, weil Zielordner von Konto zu Konto verschieden heißen. */
type Ablage = Record<string, Regel[]>;

/**
 * Liest die Regeln.
 *
 * Die 48 Byte kleine regeln.json enthaelt Arbeit von Stunden. Frueher fing hier ein
 * leeres catch jeden Lesefehler ab und lieferte ein leeres Verzeichnis - der naechste
 * Schreibvorgang schrieb genau das ueber die noch teilweise vorhandene Datei, und alle
 * uebrigen Regeln waren unwiederbringlich weg. liesJson trennt "gibt es noch nicht" von
 * "ist beschaedigt" und legt Letzteres zur Seite, statt es ueberschreiben zu lassen.
 */
function lesen(): Ablage {
  const befund = liesGeschuetzt<Ablage>(getPfad(), {});
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'regeln',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  return befund.wert && typeof befund.wert === 'object' ? befund.wert : {};
}

function schreiben(ablage: Ablage): void {
  schreibeGeschuetzt(getPfad(), JSON.stringify(ablage, null, 2));
}

export function regelnFuer(accountId: string): Regel[] {
  return lesen()[accountId] ?? [];
}

export function regelSpeichern(accountId: string, regel: Omit<Regel, 'id'> & { id?: string }): Regel {
  const ablage = lesen();
  const liste = ablage[accountId] ?? [];
  const fertig: Regel = { ...regel, id: regel.id ?? randomUUID() };

  const stelle = liste.findIndex((r) => r.id === fertig.id);
  if (stelle >= 0) liste[stelle] = fertig;
  else liste.push(fertig);

  ablage[accountId] = liste;
  schreiben(ablage);
  return fertig;
}

export function regelLoeschen(accountId: string, id: string): boolean {
  const ablage = lesen();
  const liste = ablage[accountId] ?? [];
  const uebrig = liste.filter((r) => r.id !== id);
  if (uebrig.length === liste.length) return false;
  ablage[accountId] = uebrig;
  schreiben(ablage);
  return true;
}

/** Beim Entfernen eines Kontos verschwinden auch dessen Regeln. */
export function regelnVerwerfen(accountId: string): void {
  const ablage = lesen();
  if (!(accountId in ablage)) return;
  delete ablage[accountId];
  schreiben(ablage);
}

const enthaelt = (heuhaufen: string | undefined, nadel: string) =>
  (heuhaufen ?? '').toLowerCase().includes(nadel.toLowerCase());

/** Ob eine Regel überhaupt etwas einschränkt - sonst träfe sie auf alles zu. */
export function istBrauchbar(regel: Pick<Regel, 'bedingungen' | 'aktionen'>): boolean {
  const b = regel.bedingungen;
  const hatBedingung = Boolean(b.von || b.betreff || b.an || b.listId || b.nurRundmail);
  const a = regel.aktionen;
  const hatAktion = Boolean(a.verschiebeNach || a.alsGelesen || a.markieren || a.inDenPapierkorb);
  return hatBedingung && hatAktion;
}

/**
 * Ob eine Regel auf eine Nachricht passt. Alle gesetzten Bedingungen müssen zutreffen -
 * ein ODER wäre für den Zweck (Rundmail von X wegsortieren) fast nie das Gemeinte und
 * würde bei einem Tippfehler zu viel treffen.
 */
export function passt(regel: Regel, nachricht: MessageSummary): boolean {
  const b = regel.bedingungen;

  if (b.von) {
    const treffer = nachricht.from.some(
      (a) => enthaelt(a.address, b.von!) || enthaelt(a.name, b.von!),
    );
    if (!treffer) return false;
  }
  if (b.betreff && !enthaelt(nachricht.subject, b.betreff)) return false;
  if (b.an) {
    const treffer = [...nachricht.to, ...nachricht.cc].some((a) => enthaelt(a.address, b.an!));
    if (!treffer) return false;
  }
  if (b.listId && !enthaelt(nachricht.listId, b.listId)) return false;
  if (b.nurRundmail && !nachricht.listUnsubscribe) return false;

  return true;
}

export interface Anwendung {
  /** Zahl der Nachrichten, auf die mindestens eine Regel gepasst hat. */
  betroffen: number;
  /** Was im Einzelnen geschah - für Protokoll und Rückmeldung. */
  schritte: string[];
}

/**
 * Wendet die Regeln eines Kontos auf eine Menge Nachrichten an.
 *
 * Reihenfolge der Aktionen ist wesentlich: erst Markierungen setzen, dann verschieben.
 * Andersherum zeigten die UIDs nach dem Verschieben ins Leere, und das Markieren liefe
 * ins Nichts. Aus demselben Grund wird je Nachricht nur die erste passende Regel
 * ausgeführt - zwei Regeln, die in verschiedene Ordner verschieben, könnten sonst nicht
 * beide gelten.
 */
export async function wendeRegelnAn(
  account: AccountConfig,
  ordner: string,
  nachrichten: MessageSummary[],
  log?: (msg: string) => void,
): Promise<Anwendung> {
  const regeln = regelnFuer(account.id).filter((r) => r.aktiv && istBrauchbar(r));
  if (regeln.length === 0 || nachrichten.length === 0) return { betroffen: 0, schritte: [] };

  const gelesen: number[] = [];
  const markiert: number[] = [];
  const verschieben = new Map<string, number[]>();
  const schritte: string[] = [];
  let betroffen = 0;

  const papierkorb = regeln.some((r) => r.aktionen.inDenPapierkorb)
    ? await findSpecialFolder(account, '\\Trash', ['trash', 'papierkorb', 'gelöscht', 'deleted'])
    : null;

  for (const nachricht of nachrichten) {
    const regel = regeln.find((r) => passt(r, nachricht));
    if (!regel) continue;
    betroffen++;

    if (regel.aktionen.alsGelesen) gelesen.push(nachricht.uid);
    if (regel.aktionen.markieren) markiert.push(nachricht.uid);

    const ziel = regel.aktionen.inDenPapierkorb ? papierkorb : regel.aktionen.verschiebeNach;
    if (ziel && ziel !== ordner) {
      verschieben.set(ziel, [...(verschieben.get(ziel) ?? []), nachricht.uid]);
    }
  }

  if (gelesen.length > 0) {
    await setMessagesSeen(account, ordner, gelesen, true);
    schritte.push(`${gelesen.length} als gelesen markiert`);
  }
  if (markiert.length > 0) {
    await setMessagesFlagged(account, ordner, markiert, true);
    schritte.push(`${markiert.length} markiert`);
  }
  for (const [ziel, uids] of verschieben) {
    await moveMessages(account, ordner, uids, ziel);
    schritte.push(`${uids.length} nach "${ziel}" verschoben`);
  }

  if (schritte.length > 0) log?.(`Regeln für ${account.email}: ${schritte.join(', ')}`);
  return { betroffen, schritte };
}
