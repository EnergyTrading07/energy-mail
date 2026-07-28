import { app, BrowserWindow, dialog, shell } from 'electron';
import { buildServer } from '@energy-mail/server/app';
import { getDataDir, setDataDir } from '@energy-mail/server/paths';
import { setKeyProvider } from '@energy-mail/server/secrets';
import { speichereKontakteSofort } from '@energy-mail/server/kontakte';
import { sendeAusstehendeSofort } from '@energy-mail/server/sendqueue';
import { starteAktualisierungspruefung } from './autoUpdate.js';
import { setzeMenue } from './menu.js';
import { starteBenachrichtigungen } from './notifications.js';
import { createSafeStorageKeyProvider } from './safeStorageKey.js';

// Gleicher Port wie der Standalone-Server (siehe packages/server), damit der ohne
// zusätzliche Konfiguration gebaute Web-Client (Default VITE_API_URL) auch hier passt.
const LOCAL_PORT = 4000;
const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}`;

/**
 * Name, unter dem Electron seinen Benutzerordner anlegt.
 *
 * Fest verdrahtet statt aus der package.json übernommen, und das aus einem handfesten
 * Grund: an diesem Ordner hängt der Schlüssel, mit dem safeStorage arbeitet. Aus dem
 * Quellbaum gestartet ergäbe der Name "@energy-mail/desktop", aus dem Installationspaket
 * dagegen "Energy Mail" - die gespeicherten Zugangsdaten wären nach dem Umstieg auf die
 * installierte Fassung nicht mehr zu entschlüsseln, und zwar ohne dass man den Grund
 * ansähe. Ein fester Wert hält beide Betriebsarten auf demselben Ordner.
 *
 * Der Name taucht nirgends in der Oberfläche auf; sichtbar ist er nur als Ordner unter
 * %APPDATA%. Programmname, Startmenü-Eintrag und Verknüpfung heißen "Energy Mail".
 */
const USER_DATA_NAME = '@energy-mail/desktop';

async function startLocalServer() {
  const server = await buildServer();
  await server.listen({ port: LOCAL_PORT, host: '127.0.0.1' });
  return server;
}

/**
 * Das Hauptfenster - die Benachrichtigungen brauchen es, um es bei einem Klick nach
 * vorn zu holen und die gemeldete Nachricht zu öffnen.
 */
let hauptfenster: BrowserWindow | null = null;

function createWindow(url: string) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  /**
   * Alles, was die Anwendung in einem neuen Fenster öffnen will, geht in den
   * Systembrowser. Nötig für die OAuth-Anmeldung: Google und Microsoft weisen
   * Anmeldeseiten in eingebetteten Fenstern ab, weil dort nicht erkennbar ist, wem
   * man sein Passwort gibt. Nebeneffekt: Links aus Mails öffnen auch außerhalb.
   */
  win.webContents.setWindowOpenHandler(({ url: ziel }) => {
    if (/^https?:$/.test(new URL(ziel).protocol)) {
      void shell.openExternal(ziel);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => {
    if (hauptfenster === win) hauptfenster = null;
  });

  win.loadURL(url);
  hauptfenster = win;
}

// Muss vor app.whenReady() stehen - danach ist der Benutzerordner bereits festgelegt.
app.setName(USER_DATA_NAME);

/**
 * Anwendungskennung für Windows. Ohne sie ordnet Windows Meldungen keiner Anwendung zu
 * und zeigt sie unter Umständen gar nicht an; außerdem gruppiert es die Fenster in der
 * Taskleiste nicht richtig. Muss mit der appId aus electron-builder.yml übereinstimmen,
 * damit paketiert dieselbe Kennung gilt wie die der Verknüpfung.
 */
app.setAppUserModelId('de.energymail.desktop');

app.whenReady().then(async () => {
  // Der lokale Server liefert auch das gebaute Frontend aus, daher wird die UI über
  // http:// geladen (nicht file://) - der Vite-Build referenziert /assets absolut.
  // ENERGY_MAIL_WEB_URL zeigt bei Bedarf stattdessen auf den Vite-Dev-Server.
  const url = process.env.ENERGY_MAIL_WEB_URL ?? LOCAL_URL;

  // Konten, Schlüssel und Kontakte in den Benutzerordner. Paketiert liegt der
  // Programmcode in einem schreibgeschützten Archiv - der Standardort neben dem
  // Servercode wäre dort nicht beschreibbar.
  setDataDir(app.getPath('userData'));

  // Muss vor buildServer() stehen: der Server liest beim Start die Konten (für die
  // Postfach-Watcher) und braucht dafür bereits den Entschlüsselungsschlüssel.
  setKeyProvider(createSafeStorageKeyProvider(getDataDir()));

  try {
    await startLocalServer();
  } catch (err) {
    dialog.showErrorBox(
      'Energy Mail konnte nicht starten',
      `Der lokale Server auf Port ${LOCAL_PORT} konnte nicht gestartet werden.\n\n` +
        `${(err as Error).message}\n\n` +
        'Läuft eventuell schon eine zweite Instanz oder "npm run dev:server"?',
    );
    app.quit();
    return;
  }

  // Vor dem Fenster: sonst blitzt kurz Electrons englisches Standardmenü auf.
  setzeMenue();

  createWindow(url);

  // Erst nach dem Fenster: die Prüfung läuft im Hintergrund und darf den Start nicht
  // aufhalten. Ohne Internet passiert schlicht nichts.
  starteAktualisierungspruefung({
    info: (msg) => console.log(msg),
    warn: (msg) => console.warn(msg),
  });

  starteBenachrichtigungen(() => hauptfenster);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
});

/**
 * Beim Beenden noch abschicken, was in der Bedenkzeit steht.
 *
 * Wer auf "Senden" gedrückt und nichts widerrufen hat, will die Nachricht draußen haben -
 * sie beim Schließen verfallen zu lassen wäre die schlechteste aller Möglichkeiten. Weit
 * in der Zukunft geplante Nachrichten bleiben dagegen liegen und gehen beim nächsten
 * Start hinaus.
 */
let beendenLaeuft = false;
app.on('before-quit', (event) => {
  if (beendenLaeuft) return;
  event.preventDefault();
  beendenLaeuft = true;
  // Adressen werden gebündelt geschrieben - die letzten Sekunden sonst verloren.
  speichereKontakteSofort();
  void sendeAusstehendeSofort()
    .then((anzahl) => {
      if (anzahl > 0) console.log(`${anzahl} wartende Nachricht(en) vor dem Beenden versendet.`);
    })
    .catch((err) => console.warn(`Beim Beenden nicht versendet: ${(err as Error).message}`))
    .finally(() => app.quit());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
