import { BrowserWindow, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { gespeicherteAnsicht } from './ansicht.js';
import { FARBEN, MARKE } from './fensterFarben.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Ein Fenster, das nach einem Kennwort fragt.
 *
 * Electron bringt keines mit: `dialog` kann melden, warnen und fragen, aber kein
 * Eingabefeld. Für die verschlossene Einstellungssicherung wird genau das gebraucht -
 * beim Schreiben ein neues Kennwort, beim Einlesen das vorhandene.
 *
 * ## Warum in der Hülle und nicht in der Oberfläche
 *
 * Die Oberfläche hat längst Dialoge mit Kennwortfeldern (OpenPGP), und es wäre weniger
 * Arbeit gewesen, den Weg dorthin zu legen. Dagegen spricht der Zweck: **Eine Sicherung
 * einzulesen ist ein Notweg.** Genau deshalb steht er im Menü der Hülle und nicht in der
 * Oberfläche - wenn die nicht mehr lädt, ist er noch da. Ein Kennwortfeld, das die
 * Oberfläche zeichnet, nähme ihm diese Eigenschaft.
 *
 * ## Warum ein eigenes Vorschaltskript
 *
 * Weil das der Oberfläche (preload.cts) unter anderem das Zugangsgeheimnis des Prozesses
 * herausgibt. Dieses Fenster bekommt stattdessen kennwortVorschalt.cts, das genau einen
 * Vorgang kennt: das Ergebnis zurückgeben.
 */

const VORSCHALT = fileURLToPath(new URL('kennwortVorschalt.cjs', import.meta.url));

/** Macht aus Text etwas, das in dieser Seite nur Text ist - wie in kleineFenster.ts. */
function maskiere(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface Kennwortfrage {
  titel: string;
  erklaerung: string;
  /** Beschriftung des bestätigenden Knopfes. */
  knopf: string;
  /**
   * Zweites Feld zur Wiederholung - beim VERGEBEN eines Kennworts, nicht beim Eingeben.
   *
   * Ein Tippfehler beim Vergeben fällt sonst erst auf, wenn die Datei gebraucht wird, und
   * dann ist sie verloren. Beim Öffnen wäre dasselbe Feld nur eine Schikane: Ein
   * Tippfehler zeigt sich dort sofort als "Kennwort stimmt nicht".
   */
  wiederholen?: boolean;
  /** Mindestlänge - nur beim Vergeben sinnvoll. */
  mindestens?: number;
}

/**
 * Fragt und liefert das Kennwort - oder `null`, wenn abgebrochen wurde.
 *
 * Modal zum übergebenen Fenster: Solange die Frage offen steht, soll niemand daneben
 * weiterklicken und den Vorgang doppelt auslösen.
 */
export function frageKennwort(
  eltern: BrowserWindow | null,
  frage: Kennwortfrage,
): Promise<string | null> {
  const dunkel = gespeicherteAnsicht() === 'dunkel';
  const f = FARBEN[dunkel ? 'dunkel' : 'hell'];
  const mindestens = frage.mindestens ?? 0;

  const fenster = new BrowserWindow({
    width: 420,
    height: frage.wiederholen ? 330 : 268,
    parent: eltern ?? undefined,
    modal: Boolean(eltern),
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: frage.titel,
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
  .fehler{color:#c2410c;min-height:16px;font-size:12px}
  .knoepfe{display:flex;gap:8px;justify-content:flex-end;margin-top:auto}
  button{padding:8px 15px;border:1px solid transparent;border-radius:11px;
    background:${MARKE};color:#fff;font:inherit;font-weight:600;cursor:pointer}
  button.still{background:${f.flaeche};border-color:${f.rand};color:${f.text}}
</style></head><body>
  <h1>${maskiere(frage.titel)}</h1>
  <p>${maskiere(frage.erklaerung)}</p>
  <label>${maskiere(t('Kennwort'))}<input id="a" type="password" autofocus></label>
  ${frage.wiederholen ? `<label>${maskiere(t('Kennwort wiederholen'))}<input id="b" type="password"></label>` : ''}
  <div class="fehler" id="fehler"></div>
  <div class="knoepfe">
    <button class="still" id="ab">${maskiere(t('Abbrechen'))}</button>
    <button id="ok">${maskiere(frage.knopf)}</button>
  </div>
<script>
  var a = document.getElementById('a');
  var b = document.getElementById('b');
  var fehler = document.getElementById('fehler');
  var MIN = ${mindestens};
  var ZU_KURZ = ${JSON.stringify(t('Bitte mindestens acht Zeichen.'))};
  var UNGLEICH = ${JSON.stringify(t('Die beiden Eingaben stimmen nicht überein.'))};

  function bestaetigen() {
    var wert = a.value;
    if (MIN > 0 && wert.length < MIN) { fehler.textContent = ZU_KURZ; a.focus(); return; }
    if (b && b.value !== wert) { fehler.textContent = UNGLEICH; b.focus(); b.select(); return; }
    window.energyMailKennwort.fertig(wert);
  }
  document.getElementById('ok').addEventListener('click', bestaetigen);
  document.getElementById('ab').addEventListener('click', function () {
    window.energyMailKennwort.fertig(null);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); bestaetigen(); }
    if (e.key === 'Escape') { e.preventDefault(); window.energyMailKennwort.fertig(null); }
  });
  a.focus();
</script></body></html>`)}`;

  return new Promise((aufloesen) => {
    let beantwortet = false;

    /*
     * Auf die Kennung DIESES Anzeigeprozesses hören und nicht auf den Kanal allgemein.
     *
     * Sonst beantwortete ein beliebiges anderes Fenster die Frage - und die Antwort wäre
     * das Kennwort, mit dem gleich eine Datei aufgeschlossen wird.
     */
    const meineKennung = fenster.webContents.id;
    const behandler = (e: Electron.IpcMainEvent, wert: unknown) => {
      if (e.sender.id !== meineKennung || beantwortet) return;
      beantwortet = true;
      aufloesen(typeof wert === 'string' ? wert : null);
      fenster.close();
    };

    ipcMain.on('kennwort:fertig', behandler);

    fenster.on('closed', () => {
      ipcMain.off('kennwort:fertig', behandler);
      // Über das Kreuz geschlossen zählt wie Abbrechen.
      if (!beantwortet) {
        beantwortet = true;
        aufloesen(null);
      }
    });

    void fenster.loadURL(seite);
    fenster.once('ready-to-show', () => fenster.show());
  });
}

/** Beim Schreiben einer Sicherung: ein neues Kennwort vergeben. */
export function frageNeuesKennwort(eltern: BrowserWindow | null): Promise<string | null> {
  return frageKennwort(eltern, {
    titel: t('Kennwort für die Sicherung'),
    erklaerung: t(
      'Die Datei wird damit verschlüsselt. Ohne dieses Kennwort lässt sie sich nicht mehr öffnen – es gibt keinen Weg zurück.',
    ),
    knopf: t('Verschließen'),
    wiederholen: true,
    mindestens: 8,
  });
}

/** Beim Einlesen: das vorhandene Kennwort erfragen. */
export function frageVorhandenesKennwort(
  eltern: BrowserWindow | null,
  hinweis?: string,
): Promise<string | null> {
  return frageKennwort(eltern, {
    titel: t('Kennwort der Sicherung'),
    erklaerung: hinweis ?? t('Diese Sicherung ist verschlüsselt.'),
    knopf: t('Öffnen'),
  });
}
