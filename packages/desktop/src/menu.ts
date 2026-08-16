import { BrowserWindow, Menu, app, shell, type MenuItemConstructorOptions } from 'electron';
import { t } from '@energy-mail/mail-core/sprache';
import { sucheAktualisierung } from './autoUpdate.js';
import { zeigeUeber } from './kleineFenster.js';
import { einstellungen, setzeEinstellung, wendeAutostartAn } from './einstellungen.js';
import { wendeRechtschreibungAn } from './rechtschreibung.js';
import { richtlinien } from './richtlinien.js';
import { SPRACHWAHL, wendeSpracheAn } from './spracheWaehlen.js';
import {
  erzeugeFehlerbericht,
  leereZwischenspeicher,
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
         * Der Gegenpol zu den beiden darüber: nicht mitnehmen, sondern loswerden.
         *
         * Was das Programm zwischenspeichert - Betreffzeilen, Absender, den Wortlaut der
         * zuletzt gelesenen Nachrichten -, liegt unverschlüsselt im Benutzerordner, und
         * bis hierher gab es keinen Weg dorthin außer der Suche von Hand nach ablage.db.
         * Für einen Rechner, der weitergegeben wird, ist das der wichtigste Punkt in
         * diesem Menü.
         */
        {
          label: t('Zwischengespeicherte Nachrichten…'),
          click: () => void leereZwischenspeicher(SERVER),
        },
        { type: 'separator' },
        /*
         * Zwei Schalter, die die Hülle betreffen und nicht die Oberfläche.
         *
         * Bewusst hier und nicht im Einstellungsfenster der Anwendung: Fensterverhalten
         * und Autostart sind Sache des Betriebssystems, der Hauptprozess muss sie kennen,
         * bevor überhaupt eine Oberfläche geladen ist, und über das Menü brauchen sie
         * keinen neuen Kanal in der Brücke - die absichtlich schmal gehalten ist.
         */
        {
          label: t('Beim Schließen in den Infobereich'),
          type: 'checkbox',
          checked: einstellungen().imInfobereich,
          click: (eintrag) => {
            setzeEinstellung('imInfobereich', eintrag.checked);
            // Neu aufbauen, damit der Haken auch dann stimmt, wenn die Einstellung
            // anderswo geändert wurde (etwa über "Lieber beenden" im Hinweis).
            setzeMenue();
          },
        },
        {
          label: t('Mit Windows starten'),
          type: 'checkbox',
          checked: einstellungen().mitWindowsStarten,
          click: (eintrag) => {
            setzeEinstellung('mitWindowsStarten', eintrag.checked);
            wendeAutostartAn();
            setzeMenue();
          },
        },
        /*
         * Der einzige Schalter hier, der nicht das Fensterverhalten betrifft, sondern
         * eine Verbindung nach draußen.
         *
         * Die Prüfung ist die von Chromium, und die Wörterbücher, die Windows nicht
         * mitbringt, holt sie sich von einem Server von Google. Geschriebener Text geht
         * dabei nicht hinaus - aber ein Abruf ist es, und in einem Programm, das für sich
         * in Anspruch nimmt, nur mit dem Postfach zu sprechen, gehört er abstellbar.
         * Ausgeschrieben statt "Rechtschreibprüfung": ein Schalter, dessen Wirkung man
         * erst nach dem Umlegen versteht, ist keiner.
         */
        /*
         * Nicht der Rechner, sondern der Raum.
         *
         * Eine Meldung erscheint über allem, was gerade auf dem Bildschirm ist - im
         * Vortrag, in der Bildschirmübertragung, auf dem Sperrbildschirm, wo Windows sie
         * im Info-Center aufhebt. Wer daneben steht, liest mit.
         */
        {
          label: t('Absender und Betreff in Meldungen zeigen'),
          type: 'checkbox',
          checked: einstellungen().meldungsvorschau,
          click: (eintrag) => {
            setzeEinstellung('meldungsvorschau', eintrag.checked);
            // Nichts weiter anzuwenden: die nächste Meldung fragt den Wert selbst ab.
            setzeMenue();
          },
        },
        /*
         * Die Sprache der Oberfläche.
         *
         * Als Untermenü mit Punkten und nicht als Haken: „automatisch" ist eine eigene
         * Wahl und nicht die Abwesenheit einer Wahl - wer sie trifft, will die Sprache von
         * Windows, auch wenn die sich später ändert.
         *
         * Gibt die Organisation eine Sprache vor, steht sie hier ausgegraut. Den Punkt
         * ganz wegzulassen wäre der naheliegende Weg und der schlechtere: Wer die Sprache
         * sucht und nichts findet, hält es für ein fehlendes Merkmal statt für eine
         * Entscheidung seines Hauses.
         */
        {
          label: t('Sprache'),
          submenu: SPRACHWAHL.map(({ wert, name }) => ({
            label: name,
            type: 'radio' as const,
            checked: einstellungen().sprache === wert,
            enabled: !richtlinien().sprache,
            click: () => {
              setzeEinstellung('sprache', wert);
              wendeSpracheAn();
              // Das Menü ist bereits gebaut; seine Beschriftungen ändern sich nicht von
              // selbst. Neu aufbauen ist hier kein Umweg, sondern der ganze Vorgang.
              setzeMenue();
            },
          })),
        },
        {
          label: t('Rechtschreibprüfung (lädt Wörterbücher von Google)'),
          type: 'checkbox',
          checked: einstellungen().rechtschreibung,
          click: (eintrag) => {
            setzeEinstellung('rechtschreibung', eintrag.checked);
            wendeRechtschreibungAn();
            setzeMenue();
          },
        },
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
