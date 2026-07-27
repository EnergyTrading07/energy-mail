import { BrowserWindow, Menu, app, shell, type MenuItemConstructorOptions } from 'electron';

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
  | 'kontoWeiter';

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
      label: '&Hilfe',
      submenu: [
        {
          label: 'Projektseite öffnen',
          click: () => void shell.openExternal('https://github.com/EnergyTrading07/energy-mail'),
        },
        { type: 'separator' },
        { label: `Energy Mail ${app.getVersion()}`, enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(vorlage));
}
