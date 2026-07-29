import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, nativeTheme } from 'electron';

/**
 * Welche Ansicht zuletzt galt - hell oder dunkel.
 *
 * Gewählt wird sie in der Oberfläche und dort im Browserspeicher abgelegt; an den kommt
 * der Hauptprozess nicht heran. Er braucht die Angabe aber vor dem Fenster: der Grund
 * (backgroundColor) und die Farbe der Leiste mit den Fensterknöpfen müssen beim Erzeugen
 * feststehen. Ohne das erscheint für einen Sekundenbruchteil eine weiße Fläche mit
 * heller Leiste - und dann, wenn die Oberfläche geladen ist, springt beides um.
 *
 * Deshalb meldet die Oberfläche jede Umschaltung hierher, und der Wert wird in einer
 * winzigen Datei neben den Konten abgelegt. Beim allerersten Start gibt es sie noch
 * nicht; dann entscheidet, was Windows vorgibt - dieselbe Vorgabe, die die Oberfläche
 * gleich darauf selbst wählen wird.
 */

export type Ansicht = 'hell' | 'dunkel';

function datei(): string {
  return join(app.getPath('userData'), 'ansicht.json');
}

export function gespeicherteAnsicht(): Ansicht {
  try {
    const inhalt = JSON.parse(readFileSync(datei(), 'utf8')) as { ansicht?: string };
    if (inhalt.ansicht === 'hell' || inhalt.ansicht === 'dunkel') return inhalt.ansicht;
  } catch {
    // Erster Start oder unlesbar - beides kein Grund für eine Meldung.
  }
  return nativeTheme.shouldUseDarkColors ? 'dunkel' : 'hell';
}

export function merkeAnsicht(ansicht: Ansicht): void {
  try {
    writeFileSync(datei(), JSON.stringify({ ansicht }), 'utf8');
  } catch (err) {
    // Nicht schlimm: beim nächsten Start blitzt es einmal, mehr passiert nicht.
    console.warn(`Ansicht konnte nicht gemerkt werden: ${(err as Error).message}`);
  }
}
