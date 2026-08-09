import { Menu, Tray, nativeImage } from 'electron';
import { protokolliere } from '@energy-mail/server/protokoll';
import { programmSymbolPfad } from './programmSymbol.js';

/**
 * Das Symbol im Infobereich (unten rechts neben der Uhr).
 *
 * Ohne es war die Anwendung in einer schiefen Lage: notifications.ts beschreibt sie als
 * "Programm, das den ganzen Tag im Hintergrund läuft", aber ein Klick auf das X beendete
 * sie - und damit hörten still alle Benachrichtigungen auf. Der Nutzer bekam davon nichts
 * mit; er hatte ja nur ein Fenster geschlossen, wie bei jedem anderen Programm auch.
 *
 * Das Symbol löst zwei Dinge auf einmal: es gibt der laufenden Anwendung einen sichtbaren
 * Ort (ein Programm, das man nicht sieht und nicht beenden kann, ist ein Ärgernis), und
 * es zeigt nebenbei, ob ungelesene Post da ist.
 */

let symbol: Tray | null = null;
let ungelesen = 0;

function bild() {
  const pfad = programmSymbolPfad();
  if (!pfad) return nativeImage.createEmpty();
  const roh = nativeImage.createFromPath(pfad);
  if (roh.isEmpty()) return roh;
  /*
   * Auf 16x16 verkleinern.
   *
   * Windows skaliert ein zu großes Symbol selbst, aber sichtbar schlechter - das Ergebnis
   * ist ein unscharfer Klecks zwischen lauter scharfen Nachbarn. Bei höherer Skalierung
   * nimmt Windows die größere Vorlage über den Skalierungsfaktor.
   */
  return roh.resize({ width: 16, height: 16 });
}

export interface InfobereichHaken {
  /** Holt das Hauptfenster nach vorn - oder baut es neu, falls es keines mehr gibt. */
  zeigeFenster: () => void;
  /** "Neue Nachricht" im Kontextmenü. */
  neueNachricht: () => void;
  /** "Jetzt abrufen". */
  jetztAbrufen: () => void;
  /** Beenden - der einzige Weg hinaus, wenn kein Fenster offen ist. */
  beenden: () => void;
}

let haken: InfobereichHaken | null = null;

function baueMenue(): Menu {
  const stand =
    ungelesen === 0
      ? 'Keine ungelesenen Nachrichten'
      : `${ungelesen} ungelesene ${ungelesen === 1 ? 'Nachricht' : 'Nachrichten'}`;

  return Menu.buildFromTemplate([
    { label: 'Energy Mail öffnen', click: () => haken?.zeigeFenster() },
    // Kein Klickziel, nur Auskunft - deshalb ausgegraut.
    { label: stand, enabled: false },
    { type: 'separator' },
    { label: 'Neue Nachricht', click: () => haken?.neueNachricht() },
    { label: 'Jetzt abrufen', click: () => haken?.jetztAbrufen() },
    { type: 'separator' },
    { label: 'Beenden', click: () => haken?.beenden() },
  ]);
}

function beschriftung(): string {
  return ungelesen === 0
    ? 'Energy Mail'
    : `Energy Mail – ${ungelesen} ungelesen${ungelesen === 1 ? '' : 'e'}`;
}

/** Legt das Symbol an. Mehrfach aufzurufen ist unschädlich. */
export function richteInfobereichEin(hakenEin: InfobereichHaken): void {
  haken = hakenEin;
  if (symbol) return;

  const grafik = bild();
  if (grafik.isEmpty()) {
    /*
     * Ohne Bild kein Symbol - Windows zeigte sonst eine leere Fläche, die sich zwar
     * anklicken lässt, aber wie ein Fehler aussieht. Lieber gar keines und eine Zeile
     * im Protokoll, an der sich das nachvollziehen lässt.
     */
    protokolliere(
      'warnung',
      'infobereich',
      'Programmsymbol nicht gefunden - kein Symbol im Infobereich.',
    );
    return;
  }

  symbol = new Tray(grafik);
  symbol.setToolTip(beschriftung());
  symbol.setContextMenu(baueMenue());
  // Linksklick öffnet - das erwartet man von einem Infobereichssymbol.
  symbol.on('click', () => haken?.zeigeFenster());
  symbol.on('double-click', () => haken?.zeigeFenster());
}

/**
 * Meldet die Zahl ungelesener Nachrichten.
 *
 * Kommt aus derselben Quelle wie das Abzeichen über dem Taskleistensymbol - die
 * Oberfläche zählt ohnehin, und zwei Zählungen liefen früher oder später auseinander.
 */
export function setzeUngelesenImInfobereich(anzahl: number): void {
  const neu = Number.isFinite(anzahl) && anzahl > 0 ? Math.floor(anzahl) : 0;
  if (neu === ungelesen) return;
  ungelesen = neu;
  if (!symbol || symbol.isDestroyed()) return;
  symbol.setToolTip(beschriftung());
  // Das Menü trägt die Zahl als Zeile - es muss also mitgehen.
  symbol.setContextMenu(baueMenue());
}

/** Beim Beenden abräumen, sonst bleibt ein totes Symbol stehen, bis Windows aufräumt. */
export function raeumeInfobereichAb(): void {
  if (symbol && !symbol.isDestroyed()) symbol.destroy();
  symbol = null;
}
