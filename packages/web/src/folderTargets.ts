import type { FolderInfo } from '@energy-mail/mail-core';

/**
 * Ordner, in die sich Nachrichten sinnvoll verschieben lassen.
 *
 * Aussortiert werden:
 * - der aktuelle Ordner (Verschieben auf sich selbst),
 * - Container ohne eigene Nachrichten - Gmail führt "[Gmail]" als solchen, ein
 *   Verschieben dorthin würde der Server ablehnen,
 * - "Alle Nachrichten": dort liegt bei Gmail ohnehin jede Nachricht, ein Verschieben
 *   ist in Gmails Etikettenmodell bedeutungslos.
 */
export function moveTargets(folders: FolderInfo[], currentFolder: string | null): FolderInfo[] {
  return folders.filter(
    (folder) => folder.path !== currentFolder && folder.selectable && !folder.isAllMail,
  );
}

/**
 * Ordner, in den "Archivieren" verschiebt - oder null, wenn der Anbieter kein Archiv hat.
 *
 * Die Anbieter unterscheiden sich hier im Modell, nicht nur im Namen:
 * - Outlook und andere führen einen eigenen Archivordner (\Archive).
 * - Gmail kennt keinen: dort bedeutet Archivieren, das Posteingang-Etikett zu entfernen.
 *   Die Nachricht bleibt in "Alle Nachrichten" - genau das bewirkt ein Verschieben dorthin.
 * - GMX und Web.de haben nichts Vergleichbares; dann entfällt der Knopf.
 *
 * Abgeleitet wird das aus den Rollen des Servers, nicht aus Anbieternamen.
 */
export function archiveTarget(
  folders: FolderInfo[],
  currentFolder: string | null,
): FolderInfo | null {
  const echtesArchiv = folders.find((f) => f.specialUse === '\\Archive' && f.selectable);
  const ziel = echtesArchiv ?? folders.find((f) => f.isAllMail && f.selectable) ?? null;
  // Im Archiv selbst ist der Knopf sinnlos.
  return ziel && ziel.path !== currentFolder ? ziel : null;
}
