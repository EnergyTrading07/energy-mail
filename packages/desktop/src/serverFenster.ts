import { BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { gespeicherteAnsicht } from './ansicht.js';
import { FARBEN, MARKE } from './fensterFarben.js';
import { pruefeServer } from './serverwahl.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Das Fenster, das nach dem Server fragt.
 *
 * Es erscheint beim ersten Start und immer dann, wenn keine brauchbare Adresse
 * hinterlegt ist. Danach nie wieder - wer den Server wechselt, tut das über das Menü.
 *
 * ## Warum die Prüfung im Hauptprozess läuft
 *
 * Weil nur der durch das Netz kommt, in dem dieses Programm steht: Er kennt den
 * Systemproxy samt PAC-Skript und den Zertifikatsspeicher von Windows, in dem die
 * firmeneigene Wurzel liegt. Ein `fetch` aus dieser Seite sähe beides nicht - und
 * scheiterte damit ausgerechnet in den Aufstellungen, für die die Prüfung gedacht ist.
 *
 * ## Warum es hier keine Anmeldung gibt
 *
 * Weil sie in die Oberfläche gehört und dort längst steht - mit zweitem Faktor,
 * Anmeldebremse und allem, was dazugehört. Dieses Fenster beantwortet genau eine Frage
 * ("wohin?"), und danach übernimmt der Server. Eine zweite Anmeldemaske daneben wäre
 * eine zweite Stelle, an der etwas mit Kennwörtern passiert.
 */

const VORSCHALT = fileURLToPath(new URL('serverVorschalt.cjs', import.meta.url));

/** Macht aus Text etwas, das in dieser Seite nur Text ist - wie in kleineFenster.ts. */
function maskiere(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Fragt nach dem Server und gibt die geprüfte Adresse zurück - oder `null`.
 *
 * `null` heißt: Der Mensch hat abgebrochen. Der Aufrufer beendet die Anwendung dann,
 * denn ohne Server gibt es nichts zu zeigen.
 */
export function frageServer(vorgabe = ''): Promise<string | null> {
  const dunkel = gespeicherteAnsicht() === 'dunkel';
  const f = FARBEN[dunkel ? 'dunkel' : 'hell'];

  const fenster = new BrowserWindow({
    width: 460,
    height: 340,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: t('Energy Mail einrichten'),
    backgroundColor: f.grund,
    autoHideMenuBar: true,
    webPreferences: {
      preload: VORSCHALT,
      contextIsolation: true,
      nodeIntegration: false,
      // Nichts nachzuladen: die Seite steht vollständig in dieser Datei.
      sandbox: true,
    },
  });
  fenster.setMenu(null);

  const seite = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="de"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  *{box-sizing:border-box}
  html,body{height:100%;margin:0}
  body{background:${f.grund};color:${f.text};
    font-family:'Segoe UI Variable Text','Segoe UI',system-ui,sans-serif;font-size:13px;
    -webkit-font-smoothing:antialiased;display:flex;flex-direction:column;
    padding:22px 24px;gap:14px}
  h1{margin:0;font-size:14px;font-weight:600}
  p{margin:0;color:${f.text2};line-height:1.55}
  label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:${f.text2}}
  input{padding:9px 11px;border-radius:9px;border:1px solid ${f.rand};
    background:${f.flaeche};color:${f.text};font:inherit;font-size:13px}
  input:focus{outline:2px solid ${MARKE};outline-offset:1px}
  .meldung{min-height:32px;font-size:12px;line-height:1.5}
  .fehler{color:#c2410c}
  .gut{color:#15803d}
  .knoepfe{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}
  button{padding:8px 15px;border:1px solid transparent;border-radius:11px;
    background:${MARKE};color:#fff;font:inherit;font-weight:600;cursor:pointer}
  button.still{background:${f.flaeche};border-color:${f.rand};color:${f.text}}
  button:disabled{opacity:.55;cursor:default}
</style></head><body>
  <h1>${maskiere(t('Mit welchem Server arbeiten Sie?'))}</h1>
  <p>${maskiere(t('Energy Mail holt Ihre Postfächer von einem Server. Fragen Sie die Adresse bei dem, der ihn betreibt – es ist dieselbe, unter der Sie im Browser arbeiten.'))}</p>
  <label>${maskiere(t('Adresse des Servers'))}
    <input id="a" type="text" placeholder="https://mail.firma.de" value="${maskiere(vorgabe)}" autofocus>
  </label>
  <div class="meldung" id="meldung"></div>
  <div class="knoepfe">
    <button class="still" id="ab">${maskiere(t('Beenden'))}</button>
    <button id="ok">${maskiere(t('Verbinden'))}</button>
  </div>
<script>
  var a = document.getElementById('a');
  var meldung = document.getElementById('meldung');
  var ok = document.getElementById('ok');
  var PRUEFE = ${JSON.stringify(t('Wird geprüft…'))};
  var GEFUNDEN = ${JSON.stringify(t('Verbunden – Energy Mail {fassung}'))};
  var LEER = ${JSON.stringify(t('Ohne Adresse geht es nicht.'))};

  var laeuft = false;

  function verbinden() {
    if (laeuft) return;
    var wert = a.value.trim();
    if (!wert) { meldung.className = 'meldung fehler'; meldung.textContent = LEER; a.focus(); return; }

    laeuft = true;
    ok.disabled = true;
    meldung.className = 'meldung';
    meldung.textContent = PRUEFE;

    window.energyMailServer.pruefe(wert).then(function (befund) {
      laeuft = false;
      ok.disabled = false;
      if (befund && befund.ok) {
        meldung.className = 'meldung gut';
        meldung.textContent = GEFUNDEN.replace('{fassung}', befund.fassung || '');
        /*
         * Erst melden, dann weitergeben. Die halbe Sekunde ist keine Zierde: Ohne sie
         * verschwindet das Fenster im selben Augenblick, in dem die Antwort kommt, und
         * niemand erfaehrt, dass ueberhaupt geprueft wurde.
         */
        setTimeout(function () { window.energyMailServer.fertig(befund.adresse || wert); }, 500);
        return;
      }
      meldung.className = 'meldung fehler';
      meldung.textContent = (befund && befund.fehler) || '';
      a.focus();
      a.select();
    });
  }

  ok.addEventListener('click', verbinden);
  document.getElementById('ab').addEventListener('click', function () {
    window.energyMailServer.fertig(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); verbinden(); }
    if (e.key === 'Escape') { e.preventDefault(); window.energyMailServer.fertig(null); }
  });
  a.focus();
  a.select();
</script></body></html>`)}`;

  return new Promise((aufloesen) => {
    let beantwortet = false;
    const meineKennung = fenster.webContents.id;

    /*
     * Die Prüfung hängt an DIESEM Anzeigeprozess.
     *
     * Sonst könnte ein beliebiges anderes Fenster dieselbe Antwort auslösen - und das
     * Ergebnis wäre die Adresse, mit der sich dieses Programm gleich verbindet.
     */
    const pruefer = async (e: Electron.IpcMainInvokeEvent, adresse: unknown) => {
      if (e.sender.id !== meineKennung) return { ok: false, fehler: '' };
      return pruefeServer(typeof adresse === 'string' ? adresse : '');
    };
    ipcMain.handle('server:pruefen', pruefer);

    const behandler = (e: Electron.IpcMainEvent, wert: unknown) => {
      if (e.sender.id !== meineKennung || beantwortet) return;
      beantwortet = true;
      aufloesen(typeof wert === 'string' ? wert : null);
      fenster.close();
    };
    ipcMain.on('server:fertig', behandler);

    fenster.on('closed', () => {
      ipcMain.off('server:fertig', behandler);
      ipcMain.removeHandler('server:pruefen');
      // Über das Kreuz geschlossen zählt wie Beenden.
      if (!beantwortet) {
        beantwortet = true;
        aufloesen(null);
      }
    });

    void fenster.loadURL(seite);
    fenster.once('ready-to-show', () => fenster.show());
  });
}
