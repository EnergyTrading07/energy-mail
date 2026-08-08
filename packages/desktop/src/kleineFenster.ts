import { BrowserWindow, app, shell } from 'electron';
import { gespeicherteAnsicht } from './ansicht.js';
import { BLITZ, FARBEN, MARKE } from './fensterFarben.js';

/**
 * Die drei kleinen Fenster: Startbild, Startfehler, Über.
 *
 * Alle drei zeigten bisher entweder gar nichts (das Startbild fehlte, stattdessen kam
 * das Hauptfenster nach ein paar Sekunden aus dem Nichts) oder ein Systemfenster von
 * Windows, das mit der Anwendung nichts zu tun hat (dialog.showErrorBox: graue Fläche,
 * fettes Ausrufezeichen, ein OK-Knopf). Gerade der Startfehler ist die schlechteste
 * Stelle für so etwas - es ist unter Umständen das Einzige, was jemand von der
 * Anwendung je zu sehen bekommt.
 *
 * Aufgebaut als gewöhnliche Seiten, die unmittelbar aus einer Zeichenkette geladen
 * werden. Keine Dateien: sie müssten mitgepackt und gefunden werden, und sie sind
 * jeweils dreißig Zeilen lang.
 */

/** Das Programmsymbol als Vektorgrafik - dieselbe Form wie in der Oberfläche. */
function symbol(groesse: number): string {
  return `<svg viewBox="0 0 32 32" width="${groesse}" height="${groesse}">
    <defs><linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a7ce6"/><stop offset="1" stop-color="#1c42a8"/>
    </linearGradient></defs>
    <rect width="32" height="32" rx="7.5" fill="url(#v)"/>
    <rect x="5.5" y="9.5" width="21" height="13.5" rx="2" fill="#fff"/>
    <path d="M6.6 10.8 L16 18.4 L25.4 10.8" fill="none" stroke="#1b3a86" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M23.4 6.6 L16.4 18 L20 18 L18 27 L25.6 15.4 L22 15.4 Z" fill="${BLITZ}"
      stroke="#1b3a86" stroke-width="1.7" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * Gemeinsames Gerüst. Die Farbwerte stehen ausgeschrieben statt als Variablen: diese
 * Seiten haben kein Stylesheet, an dem sie hängen könnten, und sie sollen auch dann
 * richtig aussehen, wenn sonst nichts mehr geht.
 */
function seite(dunkel: boolean, inhalt: string, breite = 'auto'): string {
  const f = FARBEN[dunkel ? 'dunkel' : 'hell'];
  const text = dunkel ? '#e6ecf4' : '#131a24';
  const text2 = dunkel ? '#a2b0c1' : '#4d5867';
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{
    display:flex;align-items:center;justify-content:center;
    background:${f.grund};color:${text};
    font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;font-size:13px;
    -webkit-font-smoothing:antialiased;user-select:none;cursor:default;
    -webkit-app-region:drag;
  }
  .kasten{display:flex;flex-direction:column;align-items:center;gap:16px;
    padding:28px 34px;text-align:center;max-width:${breite}}
  h1{margin:0;font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;
    font-size:17px;font-weight:600;letter-spacing:-.01em}
  p{margin:0;color:${text2};line-height:1.6}
  code{display:block;margin-top:4px;padding:9px 11px;border-radius:6px;
    background:${dunkel ? '#11161e' : '#f6f8fc'};border:1px solid ${dunkel ? '#27313e' : '#dce2ec'};
    font-family:'Cascadia Mono',Consolas,monospace;font-size:11.5px;color:${text2};
    text-align:left;white-space:pre-wrap;user-select:text;cursor:text;-webkit-app-region:no-drag}
  .knoepfe{display:flex;gap:8px;-webkit-app-region:no-drag}
  button,a.btn{padding:7px 15px;border:1px solid transparent;border-radius:9px;
    background:${MARKE};color:#fff;font:inherit;font-weight:600;cursor:pointer;
    text-decoration:none;display:inline-block}
  button.still{background:transparent;border-color:${dunkel ? '#27313e' : '#dce2ec'};color:${text}}
  .balken{width:128px;height:3px;border-radius:99px;overflow:hidden;
    background:${dunkel ? '#27313e' : '#dce2ec'}}
  .balken::after{content:'';display:block;width:40%;height:100%;border-radius:99px;
    background:linear-gradient(90deg,${MARKE},${BLITZ});
    animation:lauf 1.1s cubic-bezier(.5,0,.5,1) infinite}
  @keyframes lauf{from{transform:translateX(-100%)}to{transform:translateX(320%)}}
  .fein{font-size:11.5px;color:${text2};opacity:.8}
</style></head><body><div class="kasten">${inhalt}</div></body></html>`)}`;
}

const gemeinsam = {
  resizable: false,
  minimizable: false,
  maximizable: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false },
} as const;

/**
 * Das Startbild.
 *
 * Steht vom ersten Moment an da und verschwindet, sobald das Hauptfenster zeichnen kann.
 * Der Grund dafür ist nicht Schmuck: die Anwendung startet einen eigenen Server und liest
 * die Konten, und das dauert je nach Rechner ein bis drei Sekunden. Vorher geschah in
 * dieser Zeit sichtbar nichts - wer zweimal auf die Verknüpfung klickte, hatte gute
 * Gründe.
 */
export function zeigeStartbild(): BrowserWindow {
  const dunkel = gespeicherteAnsicht() === 'dunkel';
  const fenster = new BrowserWindow({
    ...gemeinsam,
    width: 300,
    height: 220,
    frame: false,
    transparent: false,
    backgroundColor: FARBEN[dunkel ? 'dunkel' : 'hell'].grund,
    center: true,
    // Nicht in der Taskleiste: es ist kein Fenster, mit dem man etwas tun kann.
    skipTaskbar: true,
    alwaysOnTop: true,
  });
  void fenster.loadURL(
    seite(
      dunkel,
      `${symbol(48)}
       <div><h1>Energy Mail</h1><p class="fein">wird gestartet…</p></div>
       <div class="balken"></div>`,
    ),
  );
  return fenster;
}

/**
 * Der Start ist gescheitert.
 *
 * Ersetzt dialog.showErrorBox. Der Unterschied ist nicht nur das Aussehen: hier steht
 * die technische Meldung in einem eigenen, markierbaren Feld, und daneben steht in
 * gewöhnlichen Worten, was man tun kann. Ein Systemfenster kann beides nicht trennen und
 * wirft alles in einen Absatz.
 */
export function zeigeStartfehler(grund: string, hinweis: string): BrowserWindow {
  const dunkel = gespeicherteAnsicht() === 'dunkel';
  const fenster = new BrowserWindow({
    ...gemeinsam,
    width: 460,
    height: 330,
    backgroundColor: FARBEN[dunkel ? 'dunkel' : 'hell'].grund,
    title: 'Energy Mail konnte nicht starten',
    center: true,
  });
  fenster.setMenu(null);
  void fenster.loadURL(
    seite(
      dunkel,
      `${symbol(44)}
       <div>
         <h1>Energy Mail konnte nicht starten</h1>
         <p style="margin-top:8px">${hinweis}</p>
       </div>
       <code>${grund.replace(/[<>&]/g, (z) => `&#${z.charCodeAt(0)};`)}</code>
       <div class="knoepfe"><button onclick="window.close()">Schließen</button></div>`,
      '400px',
    ),
  );
  fenster.on('closed', () => app.quit());
  return fenster;
}

/** Was üblicherweise im Hilfemenü unter "Über …" steht. */
export function zeigeUeber(): BrowserWindow {
  const dunkel = gespeicherteAnsicht() === 'dunkel';
  const fenster = new BrowserWindow({
    ...gemeinsam,
    width: 380,
    height: 330,
    backgroundColor: FARBEN[dunkel ? 'dunkel' : 'hell'].grund,
    title: 'Über Energy Mail',
    center: true,
  });
  fenster.setMenu(null);

  // Verweise gehören in den Systembrowser, nicht in dieses Fenster.
  fenster.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  void fenster.loadURL(
    seite(
      dunkel,
      `${symbol(56)}
       <div>
         <h1>Energy Mail</h1>
         <p style="margin-top:6px">Fassung ${app.getVersion()}</p>
       </div>
       <p class="fein">E-Mail-Programm für beliebige IMAP/SMTP-Anbieter.<br>
         Zugangsdaten bleiben verschlüsselt auf diesem Rechner.</p>
       <div class="knoepfe">
         <a class="btn" href="https://github.com/EnergyTrading07/energy-mail" target="_blank">Projektseite</a>
         <button class="still" onclick="window.close()">Schließen</button>
       </div>
       <!--
         Die Lizenz gehört hierher: das ist die Stelle, an der jemand nachsieht, ob und
         wie er das Programm weitergeben darf. Der Installer fragt bewusst nicht danach
         - bei MIT gibt es nichts zuzustimmen, und eine Seite zum Wegklicken wäre nur
         Reibung.
       -->
       <p class="fein">
         <a href="https://github.com/EnergyTrading07/energy-mail/blob/main/LICENSE" target="_blank">MIT-Lizenz</a>
         · © ${new Date().getFullYear()} Hendrik Zeuch
       </p>
       <p class="fein">Electron ${process.versions.electron} · Chromium ${process.versions.chrome}</p>`,
      '320px',
    ),
  );
  return fenster;
}
