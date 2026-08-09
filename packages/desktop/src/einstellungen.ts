import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Einstellungen der Hülle - nicht der Oberfläche.
 *
 * Was hier steht, betrifft das Fenster und das Betriebssystem: ob das Schließen die
 * Anwendung beendet, und ob sie mit Windows startet. Beides muss der Hauptprozess
 * wissen, bevor überhaupt eine Oberfläche geladen ist; über den Browserspeicher der
 * Oberfläche wäre es zu spät und aus dem Hauptprozess auch nicht erreichbar.
 *
 * Nach demselben Muster wie ansicht.ts: eine winzige Datei im Benutzerordner, und ein
 * Lesefehler ist kein Grund für eine Meldung - dann gelten eben die Vorgaben.
 */

export interface HuellenEinstellungen {
  /**
   * Ob das Schließen des Fensters die Anwendung im Infobereich weiterlaufen lässt.
   *
   * Vorgabe: an. Das ist die Einstellung, die zu dem passt, was die Anwendung ist -
   * notifications.ts beschreibt sie ausdrücklich als "Programm, das den ganzen Tag im
   * Hintergrund läuft". Vorher beendete das X die Anwendung, und damit hörten still
   * alle Benachrichtigungen auf: der Hauptzweck der Dauerverbindung entfiel, ohne dass
   * jemand darauf hingewiesen wurde.
   */
  imInfobereich: boolean;

  /** Ob Windows die Anwendung beim Anmelden startet. Vorgabe: aus. */
  mitWindowsStarten: boolean;

  /**
   * Ob der einmalige Hinweis beim ersten Schließen schon gezeigt wurde.
   *
   * Er erscheint genau einmal. Ein Programm, das nach dem Klick auf X einfach
   * verschwindet und weiterläuft, ohne das zu sagen, wirkt kaputt - man sucht es in der
   * Taskleiste und findet es nicht.
   */
  hinweisGezeigt: boolean;
}

const VORGABE: HuellenEinstellungen = {
  imInfobereich: true,
  mitWindowsStarten: false,
  hinweisGezeigt: false,
};

function datei(): string {
  return join(app.getPath('userData'), 'huelle.json');
}

let zwischenspeicher: HuellenEinstellungen | null = null;

export function einstellungen(): HuellenEinstellungen {
  if (zwischenspeicher) return zwischenspeicher;
  try {
    const roh = JSON.parse(readFileSync(datei(), 'utf8')) as Partial<HuellenEinstellungen>;
    zwischenspeicher = {
      imInfobereich: roh.imInfobereich !== false,
      mitWindowsStarten: roh.mitWindowsStarten === true,
      hinweisGezeigt: roh.hinweisGezeigt === true,
    };
  } catch {
    // Erster Start oder unlesbar - dann die Vorgaben.
    zwischenspeicher = { ...VORGABE };
  }
  return zwischenspeicher;
}

export function setzeEinstellung<S extends keyof HuellenEinstellungen>(
  name: S,
  wert: HuellenEinstellungen[S],
): void {
  const stand = { ...einstellungen(), [name]: wert };
  zwischenspeicher = stand;
  try {
    writeFileSync(datei(), JSON.stringify(stand, null, 2), 'utf8');
  } catch {
    // Nicht schlimm genug für eine Meldung: die Einstellung gilt für diesen Lauf, beim
    // nächsten Start steht wieder die Vorgabe.
  }
}

/**
 * Trägt die Anwendung in den Autostart ein oder wieder aus.
 *
 * Wird bei jedem Start mit dem gemerkten Wert aufgerufen: der Eintrag lebt in der
 * Registry und kann dort auch von außen verschwinden (Aufräumprogramme tun das gern).
 * Ihn jedes Mal nachzuziehen ist billiger, als sich zu wundern.
 */
export function wendeAutostartAn(): void {
  const soll = einstellungen().mitWindowsStarten;
  try {
    const ist = app.getLoginItemSettings().openAtLogin;
    if (ist !== soll) app.setLoginItemSettings({ openAtLogin: soll });
  } catch {
    // Auf Systemen ohne Autostart-Verwaltung schlicht nichts tun.
  }
}
