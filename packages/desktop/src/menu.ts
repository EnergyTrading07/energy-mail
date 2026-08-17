import { BrowserWindow, Menu, app, shell, type MenuItemConstructorOptions } from 'electron';
import { t } from '@energy-mail/mail-core/sprache';
import { sucheAktualisierung } from './autoUpdate.js';
import { zeigeUeber } from './kleineFenster.js';
import {
  erzeugeFehlerbericht,
  leseEinstellungen,
  oeffneProtokollordner,
  sichereEinstellungen,
} from './diagnose.js';

/** Der eingebettete Server - dieselbe Adresse, unter der auch die Oberfläche läuft. */
const SERVER = 'http://127.0.0.1:4000';

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
  | 'einstellungen'
  | 'ansichtUmschalten';

function sende(befehl: Befehl): void {
  const fenster = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!fenster) return;
  void fenster.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('energy-mail:befehl', { detail: ${JSON.stringify(befehl)} }))`,
  );
}

/**
 * Derselbe Weg für das Infobereichsmenü.
 *
 * Ausdrücklich weitergereicht statt dort nachgebaut: es gibt genau eine Stelle, an der
 * ein Befehl an die Oberfläche geht, und genau eine Liste der Befehle, die sie versteht.
 * Zwei Umsetzungen liefen früher oder später auseinander.
 */
export { sende as sendeBefehl };
export type { Befehl };

const eintrag = (
  label: string,
  befehl: Befehl,
  accelerator?: string,
): MenuItemConstructorOptions => ({ label, accelerator, click: () => sende(befehl) });

export function setzeMenue(): void {
  const vorlage: MenuItemConstructorOptions[] = [
    {
      label: t('&Nachricht'),
      submenu: [
        eintrag(t('Neue Nachricht'), 'verfassen', 'CmdOrCtrl+N'),
        { type: 'separator' },
        eintrag(t('Antworten'), 'antworten', 'CmdOrCtrl+R'),
        eintrag(t('Allen antworten'), 'allenAntworten', 'CmdOrCtrl+Shift+R'),
        eintrag(t('Weiterleiten'), 'weiterleiten', 'CmdOrCtrl+L'),
        { type: 'separator' },
        eintrag(t('Gelesen / ungelesen'), 'gelesenUmschalten', 'CmdOrCtrl+U'),
        eintrag(t('Archivieren'), 'archivieren', 'CmdOrCtrl+E'),
        // Bewusst ohne Menü-Kürzel: als solches gälte Entf überall und würde beim
        // Schreiben Zeichen statt Nachrichten löschen. Die Taste behandelt die
        // Oberfläche selbst, wo bekannt ist, worauf der Fokus liegt - der Hinweis im
        // Menü nennt sie trotzdem, damit man sie findet.
        eintrag(t('Löschen (Entf)'), 'loeschen'),
        { type: 'separator' },
        { label: t('Beenden'), role: 'quit' },
      ],
    },
    {
      label: t('&Bearbeiten'),
      submenu: [
        { label: t('Rückgängig'), role: 'undo' },
        { label: t('Wiederholen'), role: 'redo' },
        { type: 'separator' },
        { label: t('Ausschneiden'), role: 'cut' },
        { label: t('Kopieren'), role: 'copy' },
        { label: t('Einfügen'), role: 'paste' },
        { label: t('Alles auswählen'), role: 'selectAll' },
        { type: 'separator' },
        eintrag(t('Suchen'), 'suchen', 'CmdOrCtrl+F'),
      ],
    },
    {
      label: t('&Ansicht'),
      submenu: [
        // Auch über den Knopf in der Titelleiste erreichbar - im Menü steht es, weil
        // dort das Tastenkürzel dabeisteht und man es sonst nirgends nachschlagen kann.
        eintrag(t('Hell / dunkel umschalten'), 'ansichtUmschalten', 'CmdOrCtrl+Shift+D'),
        { type: 'separator' },
        eintrag(t('Neu laden'), 'neuLaden', 'F5'),
        eintrag(t('Nächstes Konto'), 'kontoWeiter', 'CmdOrCtrl+Tab'),
        { type: 'separator' },
        { label: t('Vergrößern'), role: 'zoomIn' },
        { label: t('Verkleinern'), role: 'zoomOut' },
        { label: t('Normale Größe'), role: 'resetZoom' },
        { type: 'separator' },
        { label: t('Vollbild'), role: 'togglefullscreen' },
        { label: t('Entwicklerwerkzeuge'), role: 'toggleDevTools' },
      ],
    },
    {
      label: t('&Extras'),
      submenu: [
        eintrag(t('Offen (Liegengebliebenes & Geplantes)…'), 'wartet'),
        eintrag(t('Postfach aufräumen…'), 'aufraeumen'),
        eintrag(t('Regeln…'), 'regeln'),
        { type: 'separator' },
        /*
         * Der eine Weg zu allem Einstellbaren.
         *
         * Darunter standen bis hierher fünf Punkte, die es nur hier gab: Sprache,
         * Rechtschreibung, Autostart, Infobereich, Meldungsvorschau. Die Begründung
         * dafür war, der Hauptprozess müsse sie kennen, bevor eine Oberfläche geladen
         * ist. Das stimmt weiter - es ist ein Grund dafür, WO sie liegen (huelle.json,
         * nicht der Browserspeicher), und keiner dafür, wo man sie umlegt. Solange sie
         * nur hier standen, suchte man sie im Menü statt in den Einstellungen, und im
         * Browserbetrieb gab es sie überhaupt nicht.
         *
         * Sie stehen jetzt in der Anwendung unter "Anwendung"; geschrieben werden sie
         * weiterhin nur vom Hauptprozess (siehe 'huelle:setzen' in main.ts).
         *
         * Strg+, weil es das Kürzel für Einstellungen ist, seit es Einstellungen gibt.
         */
        eintrag(t('Einstellungen…'), 'einstellungen', 'CmdOrCtrl+,'),
        { type: 'separator' },
        /*
         * Der Weg auf einen neuen Rechner.
         *
         * Im Benutzerordner liegen zwölf Dateien; welche davon Arbeit enthalten und
         * welche nur Zwischenspeicher sind, sieht man ihnen nicht an. Diese beiden
         * Punkte nehmen einem die Entscheidung ab.
         */
        {
          label: t('Einstellungen sichern…'),
          click: () => void sichereEinstellungen(SERVER),
        },
        {
          label: t('Sicherung einlesen…'),
          click: () => void leseEinstellungen(SERVER),
        },
        /*
         * Was zwischengespeichert auf der Platte liegt, steht nicht mehr hier.
         *
         * Der Punkt hieß "Zwischengespeicherte Nachrichten…" und öffnete eine Rückfrage
         * der Hülle, die dasselbe tat wie die Tafel "Bestand" im Einstellungsfenster:
         * nachsehen, wie viel dort liegt, und es löschen. Zwei Umsetzungen derselben
         * Sache laufen auseinander - und die in der Anwendung gibt es auch im Browser,
         * wo es kein Menü gibt.
         */
      ],
    },
    {
      label: t('&Hilfe'),
      submenu: [
        {
          label: t('Nach Aktualisierungen suchen'),
          click: () => sucheAktualisierung(),
        },
        {
          label: t('Projektseite öffnen'),
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
          label: t('Fehlerbericht erzeugen…'),
          click: () => void erzeugeFehlerbericht(),
        },
        {
          label: t('Protokollordner öffnen'),
          click: () => oeffneProtokollordner(),
        },
        { type: 'separator' },
        // Ein eigenes Fenster statt einer gesperrten Zeile mit der Fassungsnummer: dort
        // steht auch, worauf die Anwendung aufsetzt und wo die Zugangsdaten liegen.
        { label: t('Über Energy Mail {fassung}', { fassung: app.getVersion() }), click: () => void zeigeUeber() },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(vorlage));
}
