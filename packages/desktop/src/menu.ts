import { BrowserWindow, Menu, app, shell, type MenuItemConstructorOptions } from 'electron';
import { sucheAktualisierung } from './autoUpdate.js';
import { zeigeUeber } from './kleineFenster.js';
import { erzeugeFehlerbericht, oeffneProtokollordner } from './diagnose.js';

/**
 * Deutsches Anwendungsmenü.
 *
 * Electron setzt ohne Zutun ein englisches Standardmenü ("File, Edit, View…") mit
 * Einträgen, die zu einem Mailprogramm nicht passen. Hier steht stattdessen, was die
 * Anwendung wirklich kann - und vor allem stehen die Tastenkürzel daneben: ohne einen
 * Ort, an dem sie aufgeführt sind, findet sie niemand.
 *
 * Die Menüeinträge führen nichts selbst aus. Sie lösen im Fenster ein gewöhnliches
 * Browser-Ereignis aus, auf das die Oberfläche hört - dieselbe Verständigung wie bei den
 * Benachrichtigungen. Dadurch gibt es für jeden Befehl genau eine Umsetzung, gleich ob er
 * aus dem Menü, per Tastenkürzel oder per Mausklick kommt.
 */

/** Befehle, die die Oberfläche versteht. Muss zu useBefehle.ts im Web-Paket passen. */
type Befehl =
  | 'verfassen'
  | 'antworten'
  | 'allenAntworten'
  | 'weiterleiten'
  | 'gelesenUmschalten'
  | 'archivieren'
  | 'loeschen'
  | 'suchen'
  | 'neuLaden'
  | 'kontoWeiter'
  | 'regeln'
  | 'aufraeumen'
  | 'wartet'
  | 'ansichtUmschalten';

function sende(befehl: Befehl): void {
  const fenster = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!fenster) return;
  void fenster.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('energy-mail:befehl', { detail: ${JSON.stringify(befehl)} }))`,
  );
}

const eintrag = (
  label: string,
  befehl: Befehl,
  accelerator?: string,
): MenuItemConstructorOptions => ({ label, accelerator, click: () => sende(befehl) });

export function setzeMenue(): void {
  const vorlage: MenuItemConstructorOptions[] = [
    {
      label: '&Nachricht',
      submenu: [
        eintrag('Neue Nachricht', 'verfassen', 'CmdOrCtrl+N'),
        { type: 'separator' },
        eintrag('Antworten', 'antworten', 'CmdOrCtrl+R'),
        eintrag('Allen antworten', 'allenAntworten', 'CmdOrCtrl+Shift+R'),
        eintrag('Weiterleiten', 'weiterleiten', 'CmdOrCtrl+L'),
        { type: 'separator' },
        eintrag('Gelesen / ungelesen', 'gelesenUmschalten', 'CmdOrCtrl+U'),
        eintrag('Archivieren', 'archivieren', 'CmdOrCtrl+E'),
        // Bewusst ohne Menü-Kürzel: als solches gälte Entf überall und würde beim
        // Schreiben Zeichen statt Nachrichten löschen. Die Taste behandelt die
        // Oberfläche selbst, wo bekannt ist, worauf der Fokus liegt - der Hinweis im
        // Menü nennt sie trotzdem, damit man sie findet.
        eintrag('Löschen (Entf)', 'loeschen'),
        { type: 'separator' },
        { label: 'Beenden', role: 'quit' },
      ],
    },
    {
      label: '&Bearbeiten',
      submenu: [
        { label: 'Rückgängig', role: 'undo' },
        { label: 'Wiederholen', role: 'redo' },
        { type: 'separator' },
        { label: 'Ausschneiden', role: 'cut' },
        { label: 'Kopieren', role: 'copy' },
        { label: 'Einfügen', role: 'paste' },
        { label: 'Alles auswählen', role: 'selectAll' },
        { type: 'separator' },
        eintrag('Suchen', 'suchen', 'CmdOrCtrl+F'),
      ],
    },
    {
      label: '&Ansicht',
      submenu: [
        // Auch über den Knopf in der Titelleiste erreichbar - im Menü steht es, weil
        // dort das Tastenkürzel dabeisteht und man es sonst nirgends nachschlagen kann.
        eintrag('Hell / dunkel umschalten', 'ansichtUmschalten', 'CmdOrCtrl+Shift+D'),
        { type: 'separator' },
        eintrag('Neu laden', 'neuLaden', 'F5'),
        eintrag('Nächstes Konto', 'kontoWeiter', 'CmdOrCtrl+Tab'),
        { type: 'separator' },
        { label: 'Vergrößern', role: 'zoomIn' },
        { label: 'Verkleinern', role: 'zoomOut' },
        { label: 'Normale Größe', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Vollbild', role: 'togglefullscreen' },
        { label: 'Entwicklerwerkzeuge', role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Extras',
      submenu: [
        eintrag('Offen (Liegengebliebenes & Geplantes)…', 'wartet'),
        eintrag('Postfach aufräumen…', 'aufraeumen'),
        eintrag('Regeln…', 'regeln'),
      ],
    },
    {
      label: '&Hilfe',
      submenu: [
        {
          label: 'Nach Aktualisierungen suchen',
          click: () => sucheAktualisierung(),
        },
        {
          label: 'Projektseite öffnen',
          click: () => void shell.openExternal('https://github.com/EnergyTrading07/energy-mail'),
        },
        { type: 'separator' },
        /*
         * Der Weg, einen Fehler zu melden.
         *
         * Ohne ihn bleibt es bei "es geht nicht" - und damit lässt sich nichts
         * anfangen. Der Bericht enthält das Protokoll und die Angaben zur Umgebung,
         * ohne Kennwörter, Zugangsmarken und Mailadressen.
         */
        {
          label: 'Fehlerbericht erzeugen…',
          click: () => void erzeugeFehlerbericht(),
        },
        {
          label: 'Protokollordner öffnen',
          click: () => oeffneProtokollordner(),
        },
        { type: 'separator' },
        // Ein eigenes Fenster statt einer gesperrten Zeile mit der Fassungsnummer: dort
        // steht auch, worauf die Anwendung aufsetzt und wo die Zugangsdaten liegen.
        { label: `Über Energy Mail ${app.getVersion()}`, click: () => void zeigeUeber() },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(vorlage));
}
