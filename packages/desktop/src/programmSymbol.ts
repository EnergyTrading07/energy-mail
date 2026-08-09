import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Wo das Programmsymbol liegt - paketiert wie aus dem Quellbaum.
 *
 * Vorher stand in notifications.ts schlicht `join(app.getAppPath(), 'build', 'icon.png')`.
 * Paketiert stimmt das: dort ist app.getAppPath() die Wurzel des Archivs, und build/
 * liegt darin. Aus dem Quellbaum gestartet ist app.getAppPath() aber `packages/desktop` -
 * und ein `packages/desktop/build/` gibt es nicht. Im Entwicklungsbetrieb fand die
 * Benachrichtigung ihr Symbol also nie und bekam von Windows das leere Standardsymbol;
 * aufgefallen ist es nicht, weil es paketiert richtig aussah.
 *
 * Beim Infobereichssymbol wöge derselbe Fehler schwerer: ein Tray ohne Bild ist eine
 * leere, aber anklickbare Fläche neben der Uhr. Deshalb wird der Pfad hier einmal
 * ordentlich gesucht, statt ihn an zwei Stellen zu raten.
 */

/** Erst der paketierte Ort, dann der aus dem Quellbaum, dann der entpackte. */
function kandidaten(): string[] {
  const wurzel = app.getAppPath();
  return [
    join(wurzel, 'build', 'icon.png'),
    // Aus dem Quellbaum: packages/desktop -> zwei Ebenen hoch zur Projektwurzel.
    join(wurzel, '..', '..', 'build', 'icon.png'),
    // Falls das Bild über asarUnpack neben dem Archiv liegt.
    join(process.resourcesPath ?? '', 'app.asar.unpacked', 'build', 'icon.png'),
    join(process.resourcesPath ?? '', 'build', 'icon.png'),
  ];
}

let gefunden: string | null | undefined;

/**
 * Der Pfad zum Programmsymbol, oder `null`, wenn es keines gibt.
 *
 * Das Ergebnis wird gemerkt: die Suche kostet ein paar Dateisystemzugriffe, und der Ort
 * ändert sich während eines Programmlaufs nicht.
 */
export function programmSymbolPfad(): string | null {
  if (gefunden !== undefined) return gefunden;
  gefunden = kandidaten().find((p) => p && existsSync(p)) ?? null;
  return gefunden;
}
