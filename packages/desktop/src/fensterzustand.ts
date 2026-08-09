import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type BrowserWindow, app, screen } from 'electron';

/**
 * Wo das Fenster stand und wie groß es war.
 *
 * Vorher wurde davon nichts gemerkt: jeder Start erzeugte ein Fenster von genau
 * 1280x840, mittig auf dem Hauptbildschirm. Wer sein Mailprogramm maximiert oder auf dem
 * zweiten Monitor betreibt - bei einer Dreispaltenansicht die Regel -, musste es bei
 * JEDEM Start neu einrichten. Das ist die auffälligste Abweichung von der Sorgfalt, die
 * der übrige Code an allen Ecken zeigt.
 *
 * Nach demselben Muster wie ansicht.ts: eine winzige Datei im Benutzerordner, Lesefehler
 * sind kein Grund für eine Meldung.
 */

export interface Fensterzustand {
  x?: number;
  y?: number;
  breite: number;
  hoehe: number;
  maximiert: boolean;
}

/** Was gilt, solange nichts gemerkt wurde. */
export const VORGABE: Fensterzustand = { breite: 1280, hoehe: 840, maximiert: false };

/** Unterhalb davon rutschen die drei Spalten ineinander. */
export const MINDEST_BREITE = 940;
export const MINDEST_HOEHE = 560;

function datei(): string {
  return join(app.getPath('userData'), 'fenster.json');
}

/**
 * Prüft, ob die gemerkte Lage heute noch auf einen Bildschirm fällt.
 *
 * Das ist der Fehler, den fast jede Umsetzung dieser Funktion macht: Wer die Anwendung
 * an der Dockingstation auf dem zweiten Monitor beendet und sie unterwegs ohne diesen
 * startet, bekäme ein Fenster bei x=2400 - also außerhalb jeder sichtbaren Fläche. Für
 * den Nutzer ist das Programm dann "gestartet, aber unsichtbar", und es gibt keinen
 * naheliegenden Weg zurück.
 *
 * Verlangt wird eine Überlappung von mindestens 100x100 Pixeln mit irgendeinem
 * Arbeitsbereich - eine Ecke, an der sich das Fenster noch greifen lässt.
 */
export function liegtSichtbar(zustand: Fensterzustand): boolean {
  if (zustand.x === undefined || zustand.y === undefined) return true;
  const noetig = 100;
  return screen.getAllDisplays().some((bildschirm) => {
    const b = bildschirm.workArea;
    const breiteUeberlappung =
      Math.min(zustand.x! + zustand.breite, b.x + b.width) - Math.max(zustand.x!, b.x);
    const hoeheUeberlappung =
      Math.min(zustand.y! + zustand.hoehe, b.y + b.height) - Math.max(zustand.y!, b.y);
    return breiteUeberlappung >= noetig && hoeheUeberlappung >= noetig;
  });
}

export function gespeicherterFensterzustand(): Fensterzustand {
  let roh: Partial<Fensterzustand>;
  try {
    roh = JSON.parse(readFileSync(datei(), 'utf8')) as Partial<Fensterzustand>;
  } catch {
    // Erster Start oder unlesbar - beides kein Grund für eine Meldung.
    return { ...VORGABE };
  }

  const zustand: Fensterzustand = {
    breite: Math.max(Number(roh.breite) || VORGABE.breite, MINDEST_BREITE),
    hoehe: Math.max(Number(roh.hoehe) || VORGABE.hoehe, MINDEST_HOEHE),
    maximiert: roh.maximiert === true,
    ...(Number.isFinite(roh.x) && Number.isFinite(roh.y) ? { x: roh.x, y: roh.y } : {}),
  };

  // Der Bildschirm von damals ist heute vielleicht nicht mehr da.
  if (!liegtSichtbar(zustand)) {
    return { breite: zustand.breite, hoehe: zustand.hoehe, maximiert: zustand.maximiert };
  }
  return zustand;
}

/**
 * Merkt sich die Lage.
 *
 * Im maximierten und im Vollbildzustand wird die MAße nicht überschrieben, sondern die
 * zuletzt bekannten Normalmaße behalten (getNormalBounds). Sonst stünde nach dem
 * Wiederherstellen ein bildschirmfüllendes "normales" Fenster da, und die eigentliche
 * Größe wäre für immer verloren.
 */
export function merkeFensterzustand(fenster: BrowserWindow): void {
  if (fenster.isDestroyed()) return;
  try {
    const masse = fenster.getNormalBounds();
    const zustand: Fensterzustand = {
      x: masse.x,
      y: masse.y,
      breite: masse.width,
      hoehe: masse.height,
      maximiert: fenster.isMaximized() || fenster.isFullScreen(),
    };
    writeFileSync(datei(), JSON.stringify(zustand), 'utf8');
  } catch {
    // Nicht schlimm: beim nächsten Start steht das Fenster eben wieder in der Vorgabe.
  }
}
