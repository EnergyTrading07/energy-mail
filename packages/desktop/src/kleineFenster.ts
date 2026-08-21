import { BrowserWindow, app, shell } from 'electron';
import { gespeicherteAnsicht } from './ansicht.js';
import { BLITZ, FARBEN, MARKE } from './fensterFarben.js';
import { richtlinien } from './richtlinien.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Macht aus fremdem Text etwas, das in dieser Seite nur Text ist.
 *
 * Die Seiten hier werden als Zeichenketten zusammengesetzt und über eine data:-Adresse
 * geladen. Was von außen hineinkommt - der Ansprechpartner aus der Richtliniendatei -,
 * muss deshalb maskiert werden. Ein Administrator ist zwar nicht der Angreifer, gegen den
 * man sich hier wehrt; aber ein Kaufmännisches Und im Firmennamen soll das Fenster auch
 * nicht zerlegen.
 */
function maskiere(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

/**
 * Das Programmsymbol als Vektorgrafik - dieselbe Briefmarke wie in der Oberfläche.
 *
 * Der Zackenrand entsteht als Maske: ein Rechteck, aus dem entlang der Kanten Kreise
 * herausgeschnitten sind. Warum ausgerechnet eine Briefmarke, steht bei Marke() in
 * packages/web/src/components/Symbole.tsx - hier steht nur die Kopie davon, weil diese
 * Seiten kein React und kein Stylesheet haben.
 */
function symbol(groesse: number): string {
  const zacken = [7, 11.5, 16, 20.5, 25]
    .map(
      (p) =>
        `<circle cx="${p}" cy="2.5" r="1.6"/><circle cx="${p}" cy="29.5" r="1.6"/>` +
        `<circle cx="2.5" cy="${p}" r="1.6"/><circle cx="29.5" cy="${p}" r="1.6"/>`,
    )
    .join('');
  return `<svg viewBox="0 0 32 32" width="${groesse}" height="${groesse}">
    <defs>
      <linearGradient id="v" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3f5cf0"/><stop offset="1" stop-color="#1b2f9c"/>
      </linearGradient>
      <mask id="m">
        <rect x="2.5" y="2.5" width="27" height="27" rx="4.5" fill="#fff"/>
        <g fill="#000">${zacken}</g>
      </mask>
    </defs>
    <g mask="url(#m)">
      <rect x="2.5" y="2.5" width="27" height="27" rx="4.5" fill="url(#v)"/>
      <rect x="6.4" y="7.6" width="19.2" height="16.8" rx="2" fill="#fffdf9"/>
    </g>
    <path d="M19.6 4.4 L10.6 17.2 h4.4 L12.4 27.6 L21.4 14.8 h-4.4 Z" fill="${BLITZ}"
      stroke="#16205e" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

/**
 * Gemeinsames Gerüst. Die Farbwerte kommen aus fensterFarben.ts und stehen dort ein
 * zweites Mal neben tokens.css: diese Seiten haben kein Stylesheet, an dem sie hängen
 * könnten, und sie sollen auch dann richtig aussehen, wenn sonst nichts mehr geht.
 */
function seite(dunkel: boolean, inhalt: string, breite = 'auto'): string {
  const f = FARBEN[dunkel ? 'dunkel' : 'hell'];
  return `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{
    display:flex;align-items:center;justify-content:center;
    background:${f.grund};color:${f.text};
    font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;font-size:13px;
    -webkit-font-smoothing:antialiased;user-select:none;cursor:default;
    -webkit-app-region:drag;
  }
  .kasten{display:flex;flex-direction:column;align-items:center;gap:16px;
    padding:28px 34px;text-align:center;max-width:${breite}}
  /* Dasselbe Wortzeichen wie in der Titelleiste: gesperrte Versalien in der schmalen
     Schrift der Marke. Siehe --sf-marke in tokens.css. */
  h1{margin:0;font-family:'Bahnschrift','DIN Alternate','Segoe UI Variable Display',
    'Segoe UI',system-ui,sans-serif;
    font-size:15px;font-weight:600;letter-spacing:.17em;text-transform:uppercase}
  h1 span{color:${f.text2}}
  p{margin:0;color:${f.text2};line-height:1.6}
  code{display:block;margin-top:4px;padding:9px 11px;border-radius:7px;
    background:${f.flaeche};border:1px solid ${f.rand};
    font-family:'Cascadia Mono',Consolas,monospace;font-size:11.5px;color:${f.text2};
    text-align:left;white-space:pre-wrap;user-select:text;cursor:text;-webkit-app-region:no-drag}
  .knoepfe{display:flex;gap:8px;-webkit-app-region:no-drag}
  button,a.btn{padding:8px 15px;border:1px solid transparent;border-radius:11px;
    background:${MARKE};color:#fff;font:inherit;font-weight:600;cursor:pointer;
    text-decoration:none;display:inline-block}
  button.still{background:${f.flaeche};border-color:${f.rand};color:${f.text}}
  .balken{width:128px;height:3px;border-radius:99px;overflow:hidden;
    background:${f.rand}}
  .balken::after{content:'';display:block;width:40%;height:100%;border-radius:99px;
    background:linear-gradient(90deg,${MARKE},${BLITZ});
    animation:lauf 1.1s cubic-bezier(.5,0,.5,1) infinite}
  @keyframes lauf{from{transform:translateX(-100%)}to{transform:translateX(320%)}}
  .fein{font-size:11.5px;color:${f.text2};opacity:.8}
  a{color:${MARKE}}
  @media (prefers-reduced-motion:reduce){.balken::after{animation:none;width:100%}}
</style></head><body><div class="kasten">${inhalt}</div></body></html>`)}`;
}

/** Das Wortzeichen, in beiden Fenstern gleich. */
const WORTZEICHEN = '<h1>Energy <span>Mail</span></h1>';

const gemeinsam = {
  resizable: false,
  minimizable: false,
  maximizable: false,
  /*
   * Dieselben Zusicherungen wie im Hauptfenster - siehe main.ts.
   *
   * Diese Fenster zeigen ausschliesslich selbst erzeugtes Markup (Startbild, Ueber-
   * Fenster); heute kommt dort nichts Fremdes an. `sandbox` fehlte hier trotzdem, und
   * das ist der Unterschied zwischen "ist gerade ungefaehrlich" und "kann nicht
   * gefaehrlich werden": Die Begruendung in main.ts - wer etwas aendert, soll sehen, was
   * er aufgibt, statt es einer Voreinstellung zu ueberlassen - gilt fuer diese Fenster
   * genauso. Ein spaeterer Umbau, der hier eine Adresse oder einen Text von aussen
   * hereinreicht, faende sonst einen Anzeigeprozess ohne Sandkasten vor.
   */
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    allowRunningInsecureContent: false,
    nodeIntegrationInSubFrames: false,
  },
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
      `${symbol(52)}
       <div>${WORTZEICHEN}<p class="fein" style="margin-top:6px">wird gestartet…</p></div>
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
  /*
   * Auch der Hinweis wird maskiert.
   *
   * Er stand als einziger Wert dieser Datei ungefiltert im Text. Heute ist das harmlos:
   * beide Aufrufer reichen einen uebersetzten Festtext herein. Aber es ist die eine
   * Stelle, an der es beim naechsten Mal schiefgeht - wer hier die Meldung eines
   * Mailservers oder einen Dateinamen einsetzt, schreibt fremden Text in ein Fenster.
   * Dass der Grund daneben seit jeher maskiert wird, machte die Auslassung eher
   * gefaehrlicher: sie sah aus wie Absicht.
   */
  const dunkel = gespeicherteAnsicht() === 'dunkel';
  const fenster = new BrowserWindow({
    ...gemeinsam,
    width: 460,
    height: 330,
    backgroundColor: FARBEN[dunkel ? 'dunkel' : 'hell'].grund,
    title: t('Energy Mail konnte nicht starten'),
    center: true,
  });
  fenster.setMenu(null);
  void fenster.loadURL(
    seite(
      dunkel,
      `${symbol(44)}
       <div>
         <h1>${maskiere(t('Start gescheitert'))}</h1>
         <p style="margin-top:10px">${maskiere(hinweis)}</p>
       </div>
       <code>${grund.replace(/[<>&]/g, (z) => `&#${z.charCodeAt(0)};`)}</code>
       <div class="knoepfe"><button onclick="window.close()">${maskiere(t('Schließen'))}</button></div>`,
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
    title: t('Über Energy Mail'),
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
      `${symbol(60)}
       <div>
         ${WORTZEICHEN}
         <p style="margin-top:8px">${maskiere(t('Fassung {fassung}', { fassung: app.getVersion() }))}</p>
       </div>
       <p class="fein">${maskiere(t('E-Mail-Programm für beliebige IMAP/SMTP-Anbieter.'))}<br>
         ${maskiere(t('Zugangsdaten bleiben verschlüsselt auf diesem Rechner.'))}</p>
       ${
         /*
          * Wer im Haus zuständig ist, steht vor der Projektseite.
          *
          * In einer verwalteten Aufstellung ist das die wichtigere Auskunft: ein
          * Mitarbeiter mit einem Problem soll seine eigene IT erreichen und nicht bei
          * Fremden auf GitHub ein Ticket aufmachen. Ohne hinterlegte Richtlinie bleibt es
          * wie bisher. Der Text ist auf 300 Zeichen begrenzt und wird maskiert - er kommt
          * aus einer Datei, die ein Administrator schreibt, und in dieses Fenster gehört
          * kein Markup von dort.
          */
         richtlinien().ansprechpartner
           ? `<p class="fein"><strong>${maskiere(richtlinien().ansprechpartner!)}</strong></p>`
           : ''
       }
       <div class="knoepfe">
         <a class="btn" href="https://github.com/EnergyTrading07/energy-mail" target="_blank">${maskiere(t('Projektseite'))}</a>
         <button class="still" onclick="window.close()">${maskiere(t('Schließen'))}</button>
       </div>
       <!--
         Die Lizenz gehört hierher: das ist die Stelle, an der jemand nachsieht, ob und
         wie er das Programm weitergeben darf. Der Installer fragt bewusst nicht danach
         - bei MIT gibt es nichts zuzustimmen, und eine Seite zum Wegklicken wäre nur
         Reibung.
       -->
       <p class="fein">
         <a href="https://github.com/EnergyTrading07/energy-mail/blob/main/LICENSE" target="_blank">${maskiere(t('MIT-Lizenz'))}</a>
         · © ${new Date().getFullYear()} Hendrik Zeuch
       </p>
       <p class="fein">Electron ${process.versions.electron} · Chromium ${process.versions.chrome}</p>`,
      '320px',
    ),
  );
  return fenster;
}
