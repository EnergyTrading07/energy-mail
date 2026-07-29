import { contextBridge, ipcRenderer } from 'electron';

/**
 * Die Brücke zwischen Oberfläche und Hülle.
 *
 * Bis zur Neugestaltung kam die Anwendung ohne aus: der Hauptprozess führte im Fenster
 * unmittelbar JavaScript aus und löste dort ein gewöhnliches Ereignis aus. Das reicht,
 * solange nur von außen nach innen gerufen wird. Eine eigene Titelleiste braucht aber
 * den Weg zurück, und dasselbe gilt für das Umschalten der Ansicht (die Fensterkanten
 * zeichnet Windows, nicht die Anwendung) und für den Aktualisierungsablauf.
 *
 * Bewusst schmal: hier steht kein allgemeiner Kanal, über den beliebige Nachrichten an
 * den Hauptprozess gingen, sondern eine Handvoll benannter Vorgänge. Was nicht
 * aufgeführt ist, geht nicht - und das bleibt auch dann so, wenn in einer angezeigten
 * Mail einmal fremdes Skript steckt.
 *
 * Die Dateiendung .cts ist kein Versehen. Der Arbeitsbereich ist ein ES-Modul, ein
 * Vorschaltskript im Sandkasten muss aber CommonJS sein - mit .cts erzeugt TypeScript
 * genau das (dist/preload.cjs), und der Sandkasten kann anbleiben. Als ES-Modul müsste
 * er abgeschaltet werden, und das für nichts: hier wird nur weitergereicht.
 *
 * Muss zu packages/web/src/bruecke.d.ts passen.
 */

/** Meldet an und liefert die Abmeldung zurück - so kann React sie beim Aufräumen rufen. */
function hoeren<T>(kanal: string, rueckruf: (wert: T) => void): () => void {
  const behandler = (_e: unknown, wert: T) => rueckruf(wert);
  ipcRenderer.on(kanal, behandler);
  return () => {
    ipcRenderer.off(kanal, behandler);
  };
}

/**
 * Die Fassung wird beim Erzeugen des Fensters als Startparameter mitgegeben.
 *
 * Nicht über process.env: im Sandkasten ist das nicht verlässlich vererbt. Und nicht
 * über eine synchrone Rückfrage: die hielte den Start des Fensters auf, für eine
 * Angabe, die sich nie ändert.
 */
const FASSUNG =
  process.argv.find((a) => a.startsWith('--energy-mail-fassung='))?.split('=')[1] ?? '';

contextBridge.exposeInMainWorld('energyMail', {
  fassung: FASSUNG,
  plattform: process.platform,

  minimieren: () => ipcRenderer.send('fenster:minimieren'),
  maximierenUmschalten: () => ipcRenderer.send('fenster:maximieren'),
  schliessen: () => ipcRenderer.send('fenster:schliessen'),
  aufFensterzustand: (h: (z: unknown) => void) => hoeren('fenster:zustand', h),
  fensterzustand: () => ipcRenderer.invoke('fenster:zustand-abfragen'),

  setzeAnsicht: (ansicht: 'hell' | 'dunkel') => ipcRenderer.send('ansicht:setzen', ansicht),

  aufAktualisierung: (h: (s: unknown) => void) => hoeren('aktualisierung:stand', h),
  aktualisierungStand: () => ipcRenderer.invoke('aktualisierung:abfragen'),
  aktualisierungSuchen: () => ipcRenderer.send('aktualisierung:suchen'),
  jetztNeuStarten: () => ipcRenderer.send('aktualisierung:neustart'),

  setzeUngelesen: (anzahl: number, bild: string | null) =>
    ipcRenderer.send('taskleiste:ungelesen', anzahl, bild),

  ueberOeffnen: () => ipcRenderer.send('ueber:oeffnen'),
});
