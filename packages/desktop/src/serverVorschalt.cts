import { contextBridge, ipcRenderer } from 'electron';

/**
 * Das Vorschaltskript des Einrichtungsfensters - und nur dieses eine.
 *
 * Bewusst NICHT preload.cts: Das ist die Brücke der Oberfläche und gibt ihr weit mehr.
 * Diese Seite kennt zwei Vorgänge, und beide sind harmlos: eine Adresse prüfen lassen
 * und das Ergebnis zurückgeben. Geprüft wird im Hauptprozess, weil nur der durch den
 * Firmenproxy und an den Zertifikatsspeicher von Windows kommt.
 *
 * Die Endung .cts ist kein Versehen - siehe preload.cts: ein Vorschaltskript im
 * Sandkasten muss CommonJS sein, und .cts erzeugt genau das.
 */
contextBridge.exposeInMainWorld('energyMailServer', {
  /** Klopft an und meldet, was dort steht. */
  pruefe: (adresse: string): Promise<{ ok: boolean; fehler?: string; fassung?: string }> =>
    ipcRenderer.invoke('server:pruefen', adresse),
  /** `null` heißt abgebrochen - dann beendet sich die Anwendung. */
  fertig: (adresse: string | null) => ipcRenderer.send('server:fertig', adresse),
});
