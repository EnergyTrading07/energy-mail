import { fileURLToPath } from 'node:url';
import { BrowserWindow, app, dialog, ipcMain, nativeImage, powerMonitor, shell } from 'electron';
import { mailtoAusArgumenten } from '@energy-mail/mail-core';
import { buildServer } from '@energy-mail/server/app';
import { erzeugeZugangsgeheimnis, setzeZugangsgeheimnis } from '@energy-mail/server/zugang';
import { listAccounts } from '@energy-mail/server/konten';
import { restartWatcher } from '@energy-mail/server/events';
import { getWurzelDir, setDataDir } from '@energy-mail/server/paths';
import { setKeyProvider } from '@energy-mail/server/secrets';
import { speichereKontakteSofort } from '@energy-mail/server/kontakte';
import { sendeAusstehendeSofort } from '@energy-mail/server/sendqueue';
import { gespeicherteAnsicht, merkeAnsicht, type Ansicht } from './ansicht.js';
import {
  MINDEST_BREITE,
  MINDEST_HOEHE,
  gespeicherterFensterzustand,
  merkeFensterzustand,
} from './fensterzustand.js';
import {
  holeAktualisierungsstand,
  starteAktualisierungspruefung,
  sucheAktualisierung,
  spieleAktualisierungEin,
} from './autoUpdate.js';
import { FARBEN, LEISTE_HOEHE } from './fensterFarben.js';
import { zeigeStartbild, zeigeStartfehler, zeigeUeber } from './kleineFenster.js';
import { sendeBefehl, setzeMenue } from './menu.js';
import { einstellungen, setzeEinstellung, wendeAutostartAn } from './einstellungen.js';
import {
  raeumeInfobereichAb,
  richteInfobereichEin,
  setzeUngelesenImInfobereich,
} from './infobereich.js';
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

/**
 * Das Zugangsgeheimnis dieses Laufs.
 *
 * Bei jedem Start neu und nirgends gespeichert. Es geht nur an zwei Stellen: an den
 * Server (der es verlangt) und an das eigene Fenster (das es mitschickt). Damit ist der
 * lokale Server fuer alles andere auf dem Rechner verschlossen - siehe zugang.ts.
 */
const ZUGANG = erzeugeZugangsgeheimnis();

/** Das laufende Serverobjekt - beim Beenden wird es geordnet geschlossen. */
let laufenderServer: Awaited<ReturnType<typeof buildServer>> | null = null;

/**
 * Ob wirklich beendet werden soll.
 *
 * Unterscheidet das Schließen des Fensters (dann wird nur versteckt) vom Beenden der
 * Anwendung (Infobereichsmenü, Menü → Beenden, Windows fährt herunter). Ohne diese
 * Unterscheidung ließe sich die Anwendung mit aktivem Infobereichssymbol gar nicht mehr
 * beenden - das Fenster verstünde jedes Beenden als Schließen.
 */
let beendenGewollt = false;

/** Die Adresse der Oberfläche - das Infobereichsmenü braucht sie, um neu zu öffnen. */
let oberflaechenAdresse = LOCAL_URL;

/**
 * Holt die Anwendung nach vorn - aus dem Infobereich, aus der Taskleiste, von überall.
 *
 * Baut das Fenster notfalls neu: wer alle Fenster geschlossen hat und dann auf das
 * Infobereichssymbol klickt, will die Anwendung sehen und nicht erfahren, dass es kein
 * Fenster mehr gibt.
 */
function holeNachVorn(): void {
  const win = hauptfenster;
  if (!win || win.isDestroyed()) {
    createWindow(oberflaechenAdresse).show();
    return;
  }
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

/**
 * Nimmt eine mailto:-Adresse aus der Befehlszeile entgegen.
 *
 * Windows startet die Anwendung damit, wenn sie als Standard-E-Mail-Programm eingetragen
 * ist und jemand im Browser oder im Explorer auf eine Adresse klickt. Ohne diese
 * Behandlung wäre die Eintragung ein leeres Versprechen: das Programm ginge auf und täte
 * sonst nichts - schlechter, als sich gar nicht erst einzutragen.
 *
 * Über dasselbe Fensterereignis wie die Menübefehle, damit es genau einen Weg von der
 * Hülle in die Oberfläche gibt.
 */
function behandleMailto(argv: readonly string[]): void {
  const angaben = mailtoAusArgumenten(argv);
  if (!angaben) return;

  const win = hauptfenster;
  if (!win || win.isDestroyed()) return;

  const zustellen = () => {
    void win.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('energy-mail:mailto', { detail: ${JSON.stringify(
        JSON.stringify(angaben),
      )} }))`,
    );
  };

  // Beim allerersten Start kann die Oberfläche noch nicht bereit sein - dann erst, wenn
  // sie es ist. Sonst ginge die Adresse ins Leere, und der Nutzer stünde vor einem
  // leeren Posteingang statt vor einem Entwurf.
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', zustellen);
  else zustellen();
}

/**
 * Der einmalige Hinweis beim ersten Schließen.
 *
 * Ein Programm, das nach dem Klick auf X einfach verschwindet und weiterläuft, ohne das
 * zu sagen, wirkt kaputt: man sucht es in der Taskleiste und findet es nicht. Einmal
 * erklären genügt - danach ist es bekannt, und eine Meldung, die jedes Mal käme, wäre
 * eine Belästigung.
 */
function zeigeInfobereichHinweis(): void {
  if (einstellungen().hinweisGezeigt) return;
  setzeEinstellung('hinweisGezeigt', true);

  const antwort = dialog.showMessageBoxSync({
    type: 'info',
    title: 'Energy Mail',
    message: 'Energy Mail läuft weiter',
    detail:
      'Das Fenster ist zu, das Programm nicht – nur so kann es neue Post melden. Sie ' +
      'finden es unten rechts im Infobereich neben der Uhr; ein Klick darauf holt es ' +
      'zurück.\n\n' +
      'Wenn Sie das nicht möchten, lässt es sich unter Extras → „Beim Schließen in den ' +
      'Infobereich" abschalten.',
    buttons: ['Verstanden', 'Lieber beenden'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });

  if (antwort === 1) {
    // Wer das hier wählt, meint das X so, wie er es von anderen Programmen kennt.
    setzeEinstellung('imInfobereich', false);
    app.quit();
  }
}

async function startLocalServer() {
  setzeZugangsgeheimnis(ZUGANG);
  const server = await buildServer({ port: LOCAL_PORT });
  await server.listen({ port: LOCAL_PORT, host: '127.0.0.1' });
  laufenderServer = server;
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
  const zustand = gespeicherterFensterzustand();

  const win = new BrowserWindow({
    width: zustand.breite,
    height: zustand.hoehe,
    // Fehlt die Lage (erster Start, oder der Bildschirm von damals ist weg), zentriert
    // Electron von selbst - genau das Verhalten, das vorher immer galt.
    ...(zustand.x !== undefined && zustand.y !== undefined
      ? { x: zustand.x, y: zustand.y }
      : { center: true }),
    // Unterhalb davon rutschen die drei Spalten ineinander; die Nachrichtenliste hätte
    // dann weniger Platz als ihre Betreffzeile braucht.
    minWidth: MINDEST_BREITE,
    minHeight: MINDEST_HOEHE,

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
      /*
       * Ausdrücklich gesetzt, obwohl es die Voreinstellungen sind.
       *
       * An dieser Stelle sind es Zusicherungen und keine Zufälligkeiten: dieses Fenster
       * zeigt fremdes HTML aus E-Mails an. Wer hier etwas ändert, soll sehen, was er
       * aufgibt - statt es einer Voreinstellung zu überlassen, die in einer künftigen
       * Electron-Fassung anders lauten kann.
       */
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      nodeIntegrationInSubFrames: false,
      // Die Fassung und das Zugangsgeheimnis, ohne dafür einen eigenen Kanal zu
      // brauchen (siehe preload.cts).
      additionalArguments: [
        `--energy-mail-fassung=${app.getVersion()}`,
        `--energy-mail-zugang=${ZUGANG}`,
      ],
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
  // Vollbild war bisher nicht dabei, obwohl das Menü es anbietet: die selbstgezeichnete
  // Titelleiste zeigte dort den falschen Knopf, und es gab keinen Weg zurück außer F11.
  win.on('enter-full-screen', gemeldet);
  win.on('leave-full-screen', gemeldet);

  /*
   * Lage und Maße merken - entprellt.
   *
   * Beim Ziehen des Fensters feuert 'move' dutzende Male je Sekunde; jedes Mal zu
   * schreiben hieße, während des Ziehens dauernd auf die Platte zu gehen.
   */
  let merkTimer: ReturnType<typeof setTimeout> | undefined;
  const merkeSpaeter = () => {
    clearTimeout(merkTimer);
    merkTimer = setTimeout(() => merkeFensterzustand(win), 400);
    merkTimer.unref?.();
  };
  win.on('resize', merkeSpaeter);
  win.on('move', merkeSpaeter);
  win.on('maximize', merkeSpaeter);
  win.on('unmaximize', merkeSpaeter);
  // Beim Schließen ohne Verzögerung - danach gibt es das Fenster nicht mehr.
  win.on('close', () => {
    clearTimeout(merkTimer);
    merkeFensterzustand(win);
  });

  /*
   * Das X schließt das Fenster, nicht die Anwendung.
   *
   * Vorher beendete es beides - und damit hörten still alle Benachrichtigungen auf. Für
   * ein Programm, das notifications.ts selbst als "den ganzen Tag im Hintergrund"
   * beschreibt, war das der Widerspruch zwischen Anspruch und Verhalten: der Nutzer
   * machte eine Geste, die er von jedem anderen Fenster kennt, und schaltete damit
   * unwissentlich den Hauptzweck ab.
   *
   * Muss VOR dem Zustand-Merken stehen? Nein - beide Behandler laufen, auch wenn dieser
   * abbricht. Das Merken der Maße ist beim Verstecken genauso richtig wie beim Beenden.
   */
  win.on('close', (e) => {
    if (beendenGewollt || !einstellungen().imInfobereich) return;
    e.preventDefault();
    win.hide();
    zeigeInfobereichHinweis();
  });

  win.on('closed', () => {
    if (hauptfenster === win) hauptfenster = null;
  });

  /*
   * Kein Navigieren aus der Anwendung heraus.
   *
   * setWindowOpenHandler oben fängt nur window.open und target="_blank". Eine Navigation
   * des Fensters selbst (location.href, ein Weiterleitungs-Statuscode) war ungebremst -
   * und die fremde Seite bekäme dann das Vorschaltskript samt window.energyMail
   * serviert. Dass es heute nicht dazu kommt, hängt an der Sandkastenregel des
   * Nachrichtenrahmens: eine Zusicherung an ganz anderer Stelle, die beim nächsten Umbau
   * still wegfallen kann.
   */
  win.webContents.on('will-navigate', (e, ziel) => {
    if (ziel === url || ziel.startsWith(`${url}/`) || ziel.startsWith(`${url}?`)) return;
    e.preventDefault();
    let erlaubt = false;
    try {
      erlaubt = /^https?:$/.test(new URL(ziel).protocol);
    } catch {
      // Unbrauchbare Adresse - dann eben gar nichts.
    }
    if (erlaubt) void shell.openExternal(ziel);
  });
  // Ein <webview> gibt es in dieser Anwendung nicht und soll es nie geben.
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  void win.loadURL(url);

  /*
   * Was zu sehen ist, wenn die Seite gar nicht lädt.
   *
   * Ohne diesen Behandler navigierte das Fenster bei einem Serverabsturz auf Chromiums
   * englische Fehlerseite - in einem rahmenlosen Fenster ohne Adressleiste und ohne
   * Zurück-Knopf. Für den Nutzer eine Sackgasse; das Menü bewirbt F5 sogar als
   * "Neu laden" und führte damit genau dorthin.
   */
  win.webContents.on('did-fail-load', (_e, code, beschreibung, adresse, hauptrahmen) => {
    if (!hauptrahmen) return;
    // -3 ist ABORTED: eine abgebrochene Navigation, etwa weil gleich die nächste kam.
    if (code === -3) return;
    protokolliere('fehler', 'anzeige', `Seite nicht geladen (${code} ${beschreibung}): ${adresse}`);
    zeigeStartfehler(
      `${beschreibung} (${code})`,
      'Die Oberfläche ließ sich nicht laden. Meist ist der lokale Server nicht mehr ' +
        'erreichbar – ein Neustart der Anwendung behebt das.',
    );
  });

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
    /*
     * Was aus dem Fenster kommt, wird geprüft, bevor es an eine Systemschnittstelle geht.
     *
     * Es ist der einzige Kanal mit freien Werten und war der einzige ungeprüfte -
     * 'ansicht:setzen' direkt darüber macht es vorbildlich. createFromDataURL mit einer
     * unbrauchbaren Zeichenkette liefert ein leeres Bild oder wirft, und eine Ausnahme in
     * einem ipcMain-Behandler landet in uncaughtException: die Anwendung meldete dann
     * "wurde beendet", obwohl nur eine Zahl nicht stimmte.
     */
    if (!Number.isInteger(anzahl) || anzahl < 0) return;

    // Der Infobereich zeigt die Zahl unabhängig davon, ob ein Fenster offen ist - sie
    // ist dort sogar die einzige Auskunft, solange keines da ist.
    setzeUngelesenImInfobereich(anzahl);

    const win = fenster();
    if (!win || win.isDestroyed() || process.platform !== 'win32') return;
    if (!anzahl || !bild) {
      win.setOverlayIcon(null, '');
      return;
    }
    // Nur PNG als eingebettete Daten, und nicht beliebig groß: ein Abzeichen von
    // 16 mal 16 Pixeln braucht keine hunderttausend Zeichen.
    if (typeof bild !== 'string' || !bild.startsWith('data:image/png;base64,')) return;
    if (bild.length > 100_000) return;

    try {
      win.setOverlayIcon(
        nativeImage.createFromDataURL(bild),
        `${anzahl} ungelesene ${anzahl === 1 ? 'Nachricht' : 'Nachrichten'}`,
      );
    } catch (err) {
      protokolliere('warnung', 'taskleiste', `Abzeichen nicht gesetzt: ${(err as Error).message}`);
    }
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
  app.on('second-instance', (_e, argv) => {
    /*
     * holeNachVorn statt eines eigenen Wegs.
     *
     * Vorher stand hier `if (!fenster) return;` - gab es kein Fenster mehr, tat der
     * zweite Start also GAR NICHTS. Für den Nutzer sah das aus, als ließe sich die
     * Anwendung nicht mehr starten: er klickte auf das Symbol, und nichts geschah.
     * holeNachVorn baut das Fenster in dem Fall neu.
     */
    holeNachVorn();
    // Ein Klick auf eine mailto:-Adresse startet die Anwendung nicht neu, sondern
    // reicht die Adresse an die laufende weiter - hier kommt sie an.
    behandleMailto(argv);
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
  oberflaechenAdresse = url;

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
  // Die Schlüsseldatei gehört in die Wurzel, nicht in den Ordner eines Nutzers: mit ihr
  // werden die Geheimnisse ALLER Nutzer verschlüsselt. Auf diesem Rechner ist das
  // derzeit genau einer, aber der Ort entscheidet sich hier und nicht später.
  setKeyProvider(createSafeStorageKeyProvider(getWurzelDir()));

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
    if (!fenster.isDestroyed() && !fenster.isVisible()) {
      // Erst maximieren, dann zeigen: andersherum blitzt das kleine Fenster auf und
      // springt danach auf, was optisch wie ein Fehler wirkt.
      if (gespeicherterFensterzustand().maximiert) fenster.maximize();
      fenster.show();
    }
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

  /*
   * Das Symbol im Infobereich.
   *
   * Erst hier, nach dem Fenster: vorher gäbe es nichts, was es zeigen könnte, und ein
   * Symbol, dessen Klick ins Leere geht, ist schlechter als keines.
   */
  richteInfobereichEin({
    zeigeFenster: holeNachVorn,
    neueNachricht: () => {
      holeNachVorn();
      sendeBefehl('verfassen');
    },
    jetztAbrufen: () => {
      holeNachVorn();
      sendeBefehl('neuLaden');
    },
    beenden: () => {
      beendenGewollt = true;
      app.quit();
    },
  });

  // Bei jedem Start nachziehen: der Autostart-Eintrag lebt in der Registry und kann dort
  // auch von außen verschwinden.
  wendeAutostartAn();

  /*
   * Als Standard-E-Mail-Programm anmelden.
   *
   * Die Eintragung in electron-builder.yml gilt für die installierte Fassung; dieser
   * Aufruf deckt den Fall ab, dass die Anwendung portabel oder aus dem Quellbaum läuft.
   * Windows entscheidet weiterhin selbst, ob es Energy Mail tatsächlich zuweist - der
   * Nutzer muss es in den Windows-Einstellungen bestätigen.
   */
  if (process.platform === 'win32' && app.isPackaged) {
    try {
      app.setAsDefaultProtocolClient('mailto');
    } catch (err) {
      protokolliere('warnung', 'start', `mailto nicht angemeldet: ${(err as Error).message}`);
    }
  }

  // Wurde die Anwendung überhaupt erst durch einen Klick auf eine mailto:-Adresse
  // gestartet? Dann steht sie in der eigenen Befehlszeile.
  behandleMailto(process.argv);

  /*
   * Nach Standby und Netzwechsel die Überwachung neu aufsetzen.
   *
   * Der Watcher verlässt sich darauf, dass ein Verbindungsabbruch als 'close' oder
   * 'error' gemeldet wird. Nach dem Zuklappen des Notebooks oder einem WLAN-Wechsel ist
   * die IMAP-IDLE-Verbindung aber typischerweise "halb offen": das Betriebssystem meldet
   * nichts, der Socket ist tot, es kommt kein Ereignis. Folge war, dass neue Post nach
   * dem Aufklappen unbemerkt und unbegrenzt lange nicht mehr gemeldet wurde -
   * ausgerechnet die eine Sache, für die eine Dauerverbindung überhaupt offen bleibt.
   *
   * Verschärfend kam hinzu, dass die Wartezeit zwischen den Versuchen bis auf fünf
   * Minuten anwächst und nur bei einem geglückten Aufbau zurückgesetzt wird - selbst im
   * Gutfall verging also viel Zeit, bevor überhaupt der erste neue Versuch lief.
   */
  const watcherNeuStarten = (grund: string) => {
    protokolliere('info', 'ueberwachung', `${grund} - Überwachung wird neu aufgebaut.`);
    for (const konto of listAccounts()) restartWatcher(konto.id);
  };
  powerMonitor.on('resume', () => watcherNeuStarten('Rechner aus dem Ruhezustand'));
  powerMonitor.on('unlock-screen', () => watcherNeuStarten('Bildschirm entsperrt'));

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
/** Wie lange das Beenden höchstens auf ausstehende Sendungen wartet. */
const BEENDEN_FRIST_MS = 8_000;

let beendenLaeuft = false;

/** Läuft eine bestimmte Arbeit nicht rechtzeitig, geht es ohne sie weiter. */
function mitFrist<T>(arbeit: Promise<T>, ms: number): Promise<T | 'zeitueberschreitung'> {
  return Promise.race([
    arbeit,
    new Promise<'zeitueberschreitung'>((auf) => setTimeout(() => auf('zeitueberschreitung'), ms)),
  ]);
}

/**
 * Alles geordnet zumachen.
 *
 * Vorher wurden genau zwei Dinge erledigt: Kontakte schreiben und Ausstehendes senden.
 * Nicht geschlossen wurden der Server selbst (sein Rückgabewert wurde nicht einmal
 * aufgehoben), die lokale Ablage und die IMAP-Verbindungen der Überwachung. Zwei
 * Folgen, beide im Alltag spürbar:
 *
 *  - Die SQLite-Datei blieb mit ihren -wal/-shm-Begleitern liegen und musste beim
 *    nächsten Start wiederhergestellt werden.
 *  - Bis zu neun IMAP-Verbindungen wurden ohne LOGOUT abgerissen. Anbieter halten die
 *    Sitzung danach noch minutenlang; GMX und Gmail begrenzen die Zahl gleichzeitiger
 *    Verbindungen. Ein schneller Neustart scheiterte dann an "Too many simultaneous
 *    connections" - ein Verbindungsfehler, den das Programm selbst verursacht hatte.
 */
async function fahreHerunter(): Promise<void> {
  // Adressen werden gebündelt geschrieben - die letzten Sekunden sonst verloren.
  speichereKontakteSofort();

  const gesendet = await mitFrist(sendeAusstehendeSofort(), BEENDEN_FRIST_MS).catch(
    (err: unknown) => {
      protokolliere('warnung', 'beenden', `Nicht versendet: ${(err as Error).message}`);
      return 0 as const;
    },
  );
  if (gesendet === 'zeitueberschreitung') {
    protokolliere(
      'warnung',
      'beenden',
      `Ausstehende Nachrichten waren nach ${BEENDEN_FRIST_MS / 1000} s nicht abgeschickt - ` +
        'sie gehen beim nächsten Start hinaus.',
    );
  } else if (typeof gesendet === 'number' && gesendet > 0) {
    protokolliere('info', 'beenden', `${gesendet} wartende Nachricht(en) vor dem Beenden versendet.`);
  }

  // Fastify schließt über seinen onClose-Haken zugleich Überwachung, Verbindungspool
  // und die lokale Ablage - siehe buildServer().
  if (laufenderServer) {
    const ergebnis = await mitFrist(laufenderServer.close(), BEENDEN_FRIST_MS).catch(() => null);
    if (ergebnis === 'zeitueberschreitung') {
      protokolliere('warnung', 'beenden', 'Der Server ließ sich nicht rechtzeitig schließen.');
    }
    laufenderServer = null;
  }

  // Sonst bleibt ein totes Symbol im Infobereich stehen, bis Windows von selbst
  // aufräumt - was es erst tut, wenn jemand mit der Maus darüberfährt.
  raeumeInfobereichAb();
}

app.on('before-quit', (event) => {
  // Ab hier ist das Beenden gewollt - das Fenster darf sich nicht mehr nur verstecken.
  beendenGewollt = true;

  /*
   * Der zweite Versuch beendet hart.
   *
   * Vorher stand hier nur `if (beendenLaeuft) return;` - und weil das erste Beenden
   * unbegrenzt auf einen SMTP-Server warten konnte, der nicht antwortet (Nodemailer
   * wartet je Nachricht bis zu zehn Minuten), blieb die Anwendung mit geschlossenem
   * Fenster als Prozess stehen. Ein zweiter Klick aufs Symbol half nicht: der sterbende
   * Prozess hielt das Einzelinstanz-Schloss, und "second-instance" fand kein Fenster
   * mehr, also passierte gar nichts. Für den Nutzer sah es aus, als starte das Programm
   * nicht mehr - der einzige Ausweg war der Task-Manager.
   */
  if (beendenLaeuft) {
    protokolliere('warnung', 'beenden', 'Zweiter Beenden-Versuch - es wird hart beendet.');
    app.exit(0);
    return;
  }
  event.preventDefault();
  beendenLaeuft = true;
  void fahreHerunter().finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  /*
   * Mit Infobereichssymbol ist ein geschlossenes Fenster kein Grund zu beenden.
   *
   * Erreicht wird diese Stelle dann ohnehin selten - das Schließen versteckt das Fenster,
   * statt es zu zerstören. Sie greift für den Fall, dass ein Fenster doch abgebaut wird,
   * etwa nach einem Absturz des Anzeigeprozesses: die Überwachung soll auch dann
   * weiterlaufen, und über das Symbol lässt sich ein neues Fenster öffnen.
   */
  if (einstellungen().imInfobereich && !beendenGewollt) return;
  if (process.platform !== 'darwin') app.quit();
});
