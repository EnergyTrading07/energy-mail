import { contextBridge, ipcRenderer } from 'electron';

/**
 * Das Vorschaltskript des Kennwortfensters - und nur dieses eine.
 *
 * Bewusst NICHT preload.cts: Das ist die Brücke der Oberfläche, und über sie geht unter
 * anderem das Zugangsgeheimnis des Prozesses hinaus. Ein Fenster, dessen einzige Aufgabe
 * darin besteht, eine Zeile Text entgegenzunehmen, hat darauf nichts zu suchen.
 *
 * Hier steht deshalb genau ein Vorgang: das Ergebnis zurückgeben. Mehr kann diese Seite
 * nicht, auch dann nicht, wenn an ihr einmal jemand etwas ändert.
 *
 * Die Endung .cts ist kein Versehen - siehe preload.cts: ein Vorschaltskript im Sandkasten
 * muss CommonJS sein, und .cts erzeugt genau das.
 */
contextBridge.exposeInMainWorld('energyMailKennwort', {
  /** `null` heißt abgebrochen. */
  fertig: (wert: string | null) => ipcRenderer.send('kennwort:fertig', wert),
});
