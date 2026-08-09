import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SearchCriteria } from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { liesJson, schreibeAtomar } from './atomar.js';
import { protokolliere } from './protokollDatei.js';

/**
 * Gespeicherte Suchen - Ordner, die es gar nicht gibt.
 *
 * "Alles von der Bank aus diesem Jahr" ist keine Ablage, sondern eine Frage. Sie jedes
 * Mal neu einzutippen ist die Arbeit, die ein Programm einem abnehmen soll; sie in einen
 * echten Ordner zu verschieben wäre falsch, weil dieselbe Nachricht dann nur noch dort
 * liegt und beim nächsten Mal andere Nachrichten dazugehören.
 *
 * Gespeichert wird die Frage, nicht die Antwort. Ausgeführt wird sie beim Anklicken -
 * damit steht immer der heutige Stand da.
 */

const getPfad = () => path.join(getNutzerDir(), 'suchen.json');

export interface GespeicherteSuche {
  id: string;
  name: string;
  /** Welches Konto. Leer heißt: das gerade gewählte. */
  accountId?: string;
  /** In welchem Ordner gesucht wird. Leer heißt: der gerade offene. */
  folder?: string;
  kriterien: SearchCriteria;
}

type Ablage = { suchen: GespeicherteSuche[] };

function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'suchen',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  if (Array.isArray(befund.wert?.suchen)) return befund.wert;
  return { suchen: [] };
}

function schreiben(ablage: Ablage): void {
  schreibeAtomar(getPfad(), JSON.stringify(ablage, null, 2));
}

export function alleSuchen(): GespeicherteSuche[] {
  return lesen().suchen;
}

export class SucheFehler extends Error {}

/**
 * Verwirft, was leer ist. Ein gespeichertes Feld mit leerer Zeichenkette verhielte sich
 * beim Ausführen anders als ein fehlendes - IMAP sucht dann nach dem leeren Wort.
 */
function sauberekriterien(roh: SearchCriteria): SearchCriteria {
  const kriterien: SearchCriteria = {};
  if (roh.text?.trim()) kriterien.text = roh.text.trim();
  if (roh.from?.trim()) kriterien.from = roh.from.trim();
  if (roh.subject?.trim()) kriterien.subject = roh.subject.trim();
  if (roh.since?.trim()) kriterien.since = roh.since.trim();
  if (roh.before?.trim()) kriterien.before = roh.before.trim();
  if (roh.etikett?.trim()) kriterien.etikett = roh.etikett.trim();
  if (roh.unreadOnly) kriterien.unreadOnly = true;
  if (roh.withAttachment) kriterien.withAttachment = true;
  if (roh.category) kriterien.category = roh.category;
  return kriterien;
}

export function speichereSuche(
  eingabe: Omit<GespeicherteSuche, 'id'> & { id?: string },
): GespeicherteSuche {
  const name = eingabe.name?.trim() ?? '';
  if (!name) throw new SucheFehler('Die Suche braucht einen Namen.');

  const kriterien = sauberekriterien(eingabe.kriterien ?? {});
  // Eine Suche ohne jede Bedingung fände alles - das ist der Ordner selbst, und dafür
  // braucht es keinen Eintrag.
  if (Object.keys(kriterien).length === 0) {
    throw new SucheFehler('Ohne eine Bedingung findet die Suche einfach alles.');
  }

  const ablage = lesen();
  const doppelt = ablage.suchen.some(
    (s) => s.id !== eingabe.id && s.name.localeCompare(name, 'de', { sensitivity: 'base' }) === 0,
  );
  if (doppelt) throw new SucheFehler(`„${name}“ gibt es schon.`);

  const fertig: GespeicherteSuche = {
    id: eingabe.id ?? randomUUID(),
    name,
    accountId: eingabe.accountId,
    folder: eingabe.folder,
    kriterien,
  };

  const stelle = ablage.suchen.findIndex((s) => s.id === fertig.id);
  if (stelle >= 0) ablage.suchen[stelle] = fertig;
  else ablage.suchen.push(fertig);

  schreiben(ablage);
  return fertig;
}

export function loescheSuche(id: string): boolean {
  const ablage = lesen();
  const vorher = ablage.suchen.length;
  ablage.suchen = ablage.suchen.filter((s) => s.id !== id);
  if (ablage.suchen.length === vorher) return false;
  schreiben(ablage);
  return true;
}
