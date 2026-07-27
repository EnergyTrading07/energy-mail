import type { FolderInfo } from '@energy-mail/mail-core';

/**
 * Ordnet die Ordnerliste für die Anzeige.
 *
 * Server liefern sie in beliebiger Reihenfolge und mit Eigenheiten: Gmail hängt seine
 * Sonderordner unter einen Container "[Gmail]", GMX und Gmail führen zusätzlich leere
 * englische Doppel-Ordner ("Drafts" neben "Entwürfe"). Flach untereinander gezeigt ergibt
 * das eine unübersichtliche Liste, in der Wichtiges und Altlasten gleich aussehen.
 */

/** Reihenfolge, in der Sonderordner erwartet werden - unabhängig davon, was der Server liefert. */
const ROLLEN_REIHENFOLGE = [
  '\\Inbox',
  '\\Drafts',
  '\\Sent',
  '\\Archive',
  '\\Junk',
  '\\Trash',
  '\\Flagged',
  '\\All',
];

/** Anzeigenamen für Sonderordner - vereinheitlicht die Bezeichnungen der Anbieter. */
const ROLLEN_NAMEN: Record<string, string> = {
  '\\Inbox': 'Posteingang',
  '\\Drafts': 'Entwürfe',
  '\\Sent': 'Gesendet',
  '\\Junk': 'Spam',
  '\\Trash': 'Papierkorb',
  '\\Flagged': 'Markiert',
  '\\All': 'Alle Nachrichten',
  '\\Archive': 'Archiv',
};

/**
 * Namen, die typischerweise leere Altlasten sind, wenn der Anbieter für dieselbe Rolle
 * schon einen richtigen Ordner ausweist.
 */
const DOPPEL_NAMEN: Record<string, string> = {
  drafts: '\\Drafts',
  sent: '\\Sent',
  'sent items': '\\Sent',
  trash: '\\Trash',
  deleted: '\\Trash',
  junk: '\\Junk',
  spam: '\\Junk',
};

export interface AnzeigeOrdner {
  folder: FolderInfo;
  /** Einrückungstiefe im Baum. */
  tiefe: number;
  /** Anzeigename - bei Sonderordnern vereinheitlicht. */
  label: string;
}

export interface OrdnerAnsicht {
  /** Sonderordner in fester Reihenfolge, ohne Einrückung. */
  sonder: AnzeigeOrdner[];
  /** Übrige Ordner als Baum. */
  weitere: AnzeigeOrdner[];
  /** Wie viele Ordner als Altlast ausgeblendet wurden. */
  ausgeblendet: number;
}

function istDoppel(folder: FolderInfo, vorhandeneRollen: Set<string>): boolean {
  if (folder.specialUse) return false;
  const rolle = DOPPEL_NAMEN[folder.name.toLowerCase()];
  // Nur ausblenden, wenn die Rolle anderweitig abgedeckt ist und hier nichts Ungelesenes
  // liegt - sonst würde man Nachrichten verstecken.
  return Boolean(rolle) && vorhandeneRollen.has(rolle) && !folder.unseen;
}

export function buildFolderView(folders: FolderInfo[], alleZeigen = false): OrdnerAnsicht {
  const vorhandeneRollen = new Set(folders.map((f) => f.specialUse).filter(Boolean) as string[]);

  const sichtbar = alleZeigen ? folders : folders.filter((f) => !istDoppel(f, vorhandeneRollen));
  const ausgeblendet = folders.length - sichtbar.length;

  const sonder: AnzeigeOrdner[] = [];
  for (const rolle of ROLLEN_REIHENFOLGE) {
    const treffer = sichtbar.find((f) => f.specialUse === rolle);
    if (treffer) {
      sonder.push({ folder: treffer, tiefe: 0, label: ROLLEN_NAMEN[rolle] ?? treffer.name });
    }
  }

  const bereitsGezeigt = new Set(sonder.map((e) => e.folder.path));
  const rest = sichtbar.filter((f) => !bereitsGezeigt.has(f.path));

  // Nach Pfad sortieren, damit Eltern vor ihren Kindern stehen.
  rest.sort((a, b) => a.path.localeCompare(b.path));

  const weitere: AnzeigeOrdner[] = rest.map((folder) => {
    const teile = folder.path.split(folder.delimiter);
    // Nur Ebenen zählen, deren Eltern auch angezeigt werden - sonst entstehen Einrückungen
    // ohne sichtbaren Bezug.
    let tiefe = 0;
    for (let i = 1; i < teile.length; i++) {
      const elternPfad = teile.slice(0, i).join(folder.delimiter);
      if (rest.some((f) => f.path === elternPfad)) tiefe++;
    }
    return { folder, tiefe, label: folder.name };
  });

  return { sonder, weitere, ausgeblendet };
}
