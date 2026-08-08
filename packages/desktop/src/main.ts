import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, ipcMain, nativeImage, shell } from 'electron';
import { buildServer } from '@energy-mail/server/app';
import { getDataDir, setDataDir } from '@energy-mail/server/paths';
import { setKeyProvider } from '@energy-mail/server/secrets';
import { speichereKontakteSofort } from '@energy-mail/server/kontakte';
import { sendeAusstehendeSofort } from '@energy-mail/server/sendqueue';
import { gespeicherteAnsicht, merkeAnsicht, type Ansicht } from './ansicht.js';
import {
  holeAktualisierungsstand,
  starteAktualisierungspruefung,
  sucheAktualisierung,
  spieleAktualisierungEin,
} from './autoUpdate.js';
import { FARBEN, LEISTE_HOEHE } from './fensterFarben.js';
import { zeigeStartbild, zeigeStartfehler, zeigeUeber } from './kleineFenster.js';
import { setzeMenue } from './menu.js';
import { starteBenachrichtigungen } from './notifications.js';
import { richteRechtschreibungEin } from './rechtschreibung.js';
import { createSafeStorageKeyProvider } from './safeStorageKey.js';
import { horcheAufFensterfehler, richteAbsturzbehandlungEin } from './diagnose.js';
import { protokolliere } from '@energy-mail/server/protokoll';

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

/** Das Vorschaltskript. .cjs, weil ein Vorschaltskript im Sandkasten CommonJS sein muss. */
const VORSCHALTSKRIPT = fileURLToPath(new URL('preload.cjs', import.meta.url));

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

/** Meldet dem Fenster, wie es gerade steht - die Titelleiste zeichnet sich danach. */
function meldeFensterzustand(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  win.webContents.send('fenster:zustand', {
    maximiert: win.isMaximized(),
    imVordergrund: win.isFocused(),
  });
}

function createWindow(url: string) {
  const ansicht = gespeicherteAnsicht();
  const farben = FARBEN[ansicht];

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    // Unterhalb davon rutschen die drei Spalten ineinander; die Nachrichtenliste hätte
    // dann weniger Platz als ihre Betreffzeile braucht.
    minWidth: 940,
    minHeight: 560,

    /**
     * Die Titelleiste zeichnet die Anwendung selbst (siehe Titelleiste.tsx).
     *
     * 'hidden' und nicht frame:false - der Unterschied ist wesentlich. Bei frame:false
     * verschwindet der ganze Fensterrahmen, und damit auch alles, was Windows daran
     * hängt: die Fassungen zum Ziehen der Ränder, die abgerundeten Ecken und der
     * Schatten von Windows 11, und vor allem die Ausrichtungshilfen, die aufklappen,
     * wenn man auf dem Maximieren-Knopf stehen bleibt. Das alles müsste man nachbauen,
     * und nachgebaut ist es nie ganz richtig.
     *
     * Mit 'hidden' bleibt der Rahmen, es entfällt nur die Beschriftungszeile; die drei
     * Knöpfe blendet Chromium darüber ein - in unseren Farben, aber mit dem Verhalten
     * von Windows.
     */
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: farben.leiste,
      symbolColor: farben.zeichen,
      height: LEISTE_HOEHE,
    },

    // Der Grund, bevor die Oberfläche geladen ist. Ohne ihn blitzt Weiß auf - in der
    // dunklen Ansicht bei jedem Start.
    backgroundColor: farben.grund,
    // Erst zeigen, wenn etwas darauf zu sehen ist; bis dahin steht das Startbild.
    show: false,

    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: VORSCHALTSKRIPT,
      // Die Fassung, ohne dafür einen eigenen Kanal zu brauchen (siehe preload.cts).
      additionalArguments: [`--energy-mail-fassung=${app.getVersion()}`],
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

  richteRechtschreibungEin(win);

  // Einzeln aufgeführt und nicht in einer Schleife: die Ereignisnamen sind für den
  // Übersetzer je eine eigene Überladung und lassen sich nicht gebündelt übergeben.
  const gemeldet = () => meldeFensterzustand(win);
  win.on('maximize', gemeldet);
  win.on('unmaximize', gemeldet);
  win.on('restore', gemeldet);
  win.on('focus', gemeldet);
  win.on('blur', gemeldet);

  win.on('closed', () => {
    if (hauptfenster === win) hauptfenster = null;
  });

  void win.loadURL(url);
  hauptfenster = win;
  return win;
}

/**
 * Was die Oberfläche an der Hülle auslösen darf.
 *
 * Alles benannt und ohne freie Parameter; die Gegenseite steht in preload.cts. Einmal
 * beim Start eingerichtet und nicht je Fenster, damit nach einem Neuladen nichts doppelt
 * hängt.
 */
function richteBrueckeEin(): void {
  const fenster = (): BrowserWindow | null => hauptfenster;

  ipcMain.on('fenster:minimieren', () => fenster()?.minimize());
  ipcMain.on('fenster:maximieren', () => {
    const win = fenster();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('fenster:schliessen', () => fenster()?.close());
  ipcMain.handle('fenster:zustand-abfragen', () => {
    const win = fenster();
    return {
      maximiert: win?.isMaximized() ?? false,
      imVordergrund: win?.isFocused() ?? true,
    };
  });

  /**
   * Die Oberfläche hat die Ansicht gewechselt. Zwei Dinge folgen daraus: die von Windows
   * gezeichnete Knopfleiste muss umgefärbt werden (sie ist nicht Teil der Seite), und
   * die Wahl wird gemerkt, damit der nächste Start gleich richtig anfängt.
   */
  ipcMain.on('ansicht:setzen', (_e, ansicht: Ansicht) => {
    if (ansicht !== 'hell' && ansicht !== 'dunkel') return;
    const farben = FARBEN[ansicht];
    const win = fenster();
    if (win && !win.isDestroyed()) {
      win.setTitleBarOverlay({
        color: farben.leiste,
        symbolColor: farben.zeichen,
        height: LEISTE_HOEHE,
      });
      win.setBackgroundColor(farben.grund);
    }
    merkeAnsicht(ansicht);
  });

  ipcMain.handle('aktualisierung:abfragen', () => holeAktualisierungsstand());
  ipcMain.on('aktualisierung:suchen', () => sucheAktualisierung());
  ipcMain.on('aktualisierung:neustart', () => spieleAktualisierungEin());

  /**
   * Zahl im Abzeichen über dem Taskleistensymbol.
   *
   * Das Bild wird in der Oberfläche gezeichnet und fertig hierher gereicht. Das klingt
   * umständlich, ist aber der einzige Weg, der die Gestaltung an einer Stelle hält: der
   * Hauptprozess hat keine Zeichenfläche, er könnte die Zahl nur als vorgefertigte Datei
   * anzeigen - und damit gäbe es einen zweiten Satz Farben, der beim nächsten Umfärben
   * vergessen wird.
   */
  ipcMain.on('taskleiste:ungelesen', (_e, anzahl: number, bild: string | null) => {
    const win = fenster();
    if (!win || win.isDestroyed() || process.platform !== 'win32') return;
    if (!anzahl || !bild) {
      win.setOverlayIcon(null, '');
      return;
    }
    win.setOverlayIcon(
      nativeImage.createFromDataURL(bild),
      `${anzahl} ungelesene ${anzahl === 1 ? 'Nachricht' : 'Nachrichten'}`,
    );
  });

  ipcMain.on('ueber:oeffnen', () => zeigeUeber());
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

/*
 * Nur eine Ausfertigung zur Zeit.
 *
 * Vorher scheiterte der zweite Start am belegten Port 4000, und der Nutzer bekam ein
 * Fehlerfenster zu sehen - fuer ein voellig gewoehnliches Verhalten. Auf einem Symbol
 * wird nun einmal zweimal geklickt, und wer die Anwendung in der Taskleiste nicht
 * findet, startet sie eben neu.
 *
 * Wer das Schloss nicht bekommt, ist der Zweite: er beendet sich sofort, und der Erste
 * holt sein Fenster nach vorn. Muss vor whenReady stehen, damit der Zweite gar nicht
 * erst anfaengt, einen Server hochzufahren.
 */
const alleinig = app.requestSingleInstanceLock();
if (!alleinig) {
  /*
   * exit statt quit: quit beendet erst nach dem Aufraeumen, und bis dahin laeuft
   * whenReady weiter. Gemessen hiess das, dass der Zweite noch einen Server hochfuhr
   * und Verbindungen zu den Postfaechern aufbaute, bevor er verschwand - unnoetige Last
   * beim Anbieter, und zwei Prozesse an derselben Ablagedatei.
   */
  app.exit(0);
} else {
  app.on('second-instance', () => {
    const fenster = hauptfenster ?? BrowserWindow.getAllWindows()[0];
    if (!fenster) return;
    // Minimiert oder hinter anderen Fenstern - beides kommt vor, und beides soll der
    // zweite Klick aufloesen.
    if (fenster.isMinimized()) fenster.restore();
    fenster.show();
    fenster.focus();
  });
}

app.whenReady().then(async () => {
  // Zweiter Gurt zum exit oben: sollte das Beenden doch einen Wimpernschlag brauchen,
  // faengt diese Zeile alles ab, was danach kaeme.
  if (!alleinig) return;

  // Der lokale Server liefert auch das gebaute Frontend aus, daher wird die UI über
  // http:// geladen (nicht file://) - der Vite-Build referenziert /assets absolut.
  // ENERGY_MAIL_WEB_URL zeigt bei Bedarf stattdessen auf den Vite-Dev-Server.
  const url = process.env.ENERGY_MAIL_WEB_URL ?? LOCAL_URL;

  // Konten, Schlüssel und Kontakte in den Benutzerordner. Paketiert liegt der
  // Programmcode in einem schreibgeschützten Archiv - der Standardort neben dem
  // Servercode wäre dort nicht beschreibbar.
  setDataDir(app.getPath('userData'));

  /*
   * Ab hier wird protokolliert und nichts geht mehr lautlos verloren.
   *
   * Muss nach setDataDir stehen, weil das Protokoll in den Benutzerordner schreibt -
   * und so früh wie irgend möglich, denn was davor abbricht, bleibt unbemerkt.
   */
  richteAbsturzbehandlungEin();
  protokolliere('info', 'start', `Energy Mail ${app.getVersion()} startet`);

  // Als Allererstes, noch vor dem Server: von hier an dauert es je nach Rechner ein bis
  // drei Sekunden, und in dieser Zeit soll etwas zu sehen sein.
  const startbild = zeigeStartbild();

  // Muss vor buildServer() stehen: der Server liest beim Start die Konten (für die
  // Postfach-Watcher) und braucht dafür bereits den Entschlüsselungsschlüssel.
  setKeyProvider(createSafeStorageKeyProvider(getDataDir()));

  try {
    await startLocalServer();
  } catch (err) {
    startbild.destroy();
    zeigeStartfehler(
      (err as Error).message,
      `Der lokale Server auf Port ${LOCAL_PORT} ließ sich nicht starten. ` +
        'Meist läuft bereits eine zweite Instanz von Energy Mail – oder ein ' +
        '"npm run dev:server" aus dem Quellbaum.',
    );
    return;
  }

  // Vor dem Fenster: sonst blitzt kurz Electrons englisches Standardmenü auf.
  setzeMenue();
  richteBrueckeEin();

  const fenster = createWindow(url);
  horcheAufFensterfehler(fenster);

  /**
   * Erst tauschen, wenn tatsächlich etwas zu sehen ist.
   *
   * ready-to-show meldet den Zeitpunkt, zu dem der erste Bildinhalt steht. Vorher zu
   * wechseln hieße, das Startbild gegen eine leere Fläche zu tauschen - genau das, was
   * es verhindern soll.
   */
  const zeigeHauptfenster = () => {
    if (!fenster.isDestroyed() && !fenster.isVisible()) fenster.show();
    if (!startbild.isDestroyed()) startbild.destroy();
  };
  fenster.once('ready-to-show', zeigeHauptfenster);

  /**
   * Sicherung: ein Fenster, das nicht zeichnen kann, meldet auch kein ready-to-show.
   *
   * Ohne diese Frist bliebe in dem Fall für immer das Startbild stehen - ein Programm,
   * das ewig "wird gestartet…" sagt und nie hochkommt. So erscheint stattdessen das
   * Hauptfenster, und was dort schiefgelaufen ist, sieht man wenigstens.
   */
  setTimeout(zeigeHauptfenster, 15_000).unref?.();

  // Erst nach dem Fenster: die Prüfung läuft im Hintergrund und darf den Start nicht
  // aufhalten. Ohne Internet passiert schlicht nichts.
  starteAktualisierungspruefung(
    {
      info: (msg) => console.log(msg),
      warn: (msg) => console.warn(msg),
    },
    (stand) => {
      if (hauptfenster && !hauptfenster.isDestroyed()) {
        hauptfenster.webContents.send('aktualisierung:stand', stand);
      }
    },
  );

  starteBenachrichtigungen(() => hauptfenster);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url).show();
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
