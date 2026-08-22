import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * Einstellungen der Hülle - nicht der Oberfläche.
 *
 * Was hier steht, betrifft das Fenster und das Betriebssystem: ob das Schließen die
 * Anwendung beendet, und ob sie mit Windows startet. Beides muss der Hauptprozess
 * wissen, bevor überhaupt eine Oberfläche geladen ist; über den Browserspeicher der
 * Oberfläche wäre es zu spät und aus dem Hauptprozess auch nicht erreichbar.
 *
 * Nach demselben Muster wie ansicht.ts: eine winzige Datei im Benutzerordner, und ein
 * Lesefehler ist kein Grund für eine Meldung - dann gelten eben die Vorgaben.
 */

export interface HuellenEinstellungen {
  /**
   * Ob das Schließen des Fensters die Anwendung im Infobereich weiterlaufen lässt.
   *
   * Vorgabe: an. Das ist die Einstellung, die zu dem passt, was die Anwendung ist -
   * notifications.ts beschreibt sie ausdrücklich als "Programm, das den ganzen Tag im
   * Hintergrund läuft". Vorher beendete das X die Anwendung, und damit hörten still
   * alle Benachrichtigungen auf: der Hauptzweck der Dauerverbindung entfiel, ohne dass
   * jemand darauf hingewiesen wurde.
   */
  imInfobereich: boolean;

  /** Ob Windows die Anwendung beim Anmelden startet. Vorgabe: aus. */
  mitWindowsStarten: boolean;

  /**
   * Ob beim Verfassen auf Rechtschreibung geprüft wird. Vorgabe: an.
   *
   * Steht hier, weil daran etwas hängt, das man ihr nicht ansieht: die Prüfung ist die
   * von Chromium, und Chromium holt sich die Wörterbücher, die Windows nicht mitbringt,
   * von einem Server von Google. Das ist der einzige Abruf der Anwendung, der weder dem
   * Postfach noch der Aktualisierungssuche gilt - und der einzige, den DATENSCHUTZ.md
   * lange nicht nannte, weil er in Electron steckt und nicht in diesem Quelltext.
   *
   * Übertragen wird dabei nichts über den Nutzer außer dem, was jeder Abruf überträgt
   * (IP-Adresse, gewünschte Sprache) - insbesondere geht kein geschriebener Text hinaus,
   * die Prüfung läuft danach vollständig auf dem Rechner. Wem auch das zu viel ist, der
   * schaltet es hier ab; dann unterbleibt der Abruf.
   */
  rechtschreibung: boolean;

  /**
   * Ob in einer Meldung des Betriebssystems steht, von wem sie kommt und worum es geht.
   * Vorgabe: an.
   *
   * Der Grund für den Schalter ist nicht der Rechner, sondern der Raum. Eine Meldung
   * erscheint über allem, was gerade auf dem Bildschirm ist - im Vortrag, in der
   * Bildschirmübertragung einer Besprechung, auf dem Sperrbildschirm, wo Windows sie im
   * Info-Center aufhebt. Wer daneben steht, liest mit, ohne etwas dafür tun zu müssen.
   * „Praxis Dr. Behrens: Ihr Befund liegt vor“ ist eine Auskunft, die man nicht
   * zurücknehmen kann.
   *
   * Vorgabe an, weil eine Meldung ohne Absender und Betreff die Frage offenlässt, für
   * die es sie gibt - lohnt sich das Hinsehen? Wer den Bildschirm regelmäßig teilt,
   * schaltet um; die Meldung nennt dann nur noch das Konto.
   */
  meldungsvorschau: boolean;

  /**
   * Die Sprache der Oberfläche: "automatisch", "de" oder "en".
   *
   * Vorgabe: automatisch, also die Sprache von Windows. Das ist für den Regelfall richtig
   * und kommt ohne jede Einstellung aus. Wer umstellt, meint es - und wird nicht beim
   * nächsten Start überstimmt.
   *
   * Muss in der Hülle stehen und nicht im Browserspeicher der Oberfläche: das Menü, die
   * Meldungen und die Fenster der Hülle brauchen die Sprache, bevor überhaupt eine
   * Oberfläche geladen ist.
   */
  sprache: string;

  /**
   * Ob der einmalige Hinweis beim ersten Schließen schon gezeigt wurde.
   *
   * Er erscheint genau einmal. Ein Programm, das nach dem Klick auf X einfach
   * verschwindet und weiterläuft, ohne das zu sagen, wirkt kaputt - man sucht es in der
   * Taskleiste und findet es nicht.
   */
  hinweisGezeigt: boolean;

  /**
   * Der Server, mit dem dieses Programm arbeitet - leer heisst: noch nicht eingerichtet.
   *
   * Die wichtigste Angabe dieser Datei, seit die Huelle keinen eigenen Server mehr
   * mitbringt. Sie steht HIER und nicht im Browserspeicher der Oberflaeche, und das ist
   * keine Geschmacksfrage: Der Hauptprozess muss sie kennen, bevor ueberhaupt eine
   * Oberflaeche geladen ist - er entscheidet daran, WAS er laedt. Im Browserspeicher
   * waere sie erst lesbar, wenn die Seite schon steht, und die kaeme nie.
   *
   * Gespeichert wird die Herkunft (Schema, Rechner, Port) und nichts weiter; alles
   * andere schneidet normalisiereServer() ab.
   */
  serverAdresse: string;
}

const VORGABE: HuellenEinstellungen = {
  serverAdresse: '',
  imInfobereich: true,
  mitWindowsStarten: false,
  rechtschreibung: true,
  meldungsvorschau: true,
  sprache: 'automatisch',
  hinweisGezeigt: false,
};

function datei(): string {
  return join(app.getPath('userData'), 'huelle.json');
}

let zwischenspeicher: HuellenEinstellungen | null = null;

export function einstellungen(): HuellenEinstellungen {
  if (zwischenspeicher) return zwischenspeicher;
  try {
    const roh = JSON.parse(readFileSync(datei(), 'utf8')) as Partial<HuellenEinstellungen>;
    zwischenspeicher = {
      imInfobereich: roh.imInfobereich !== false,
      mitWindowsStarten: roh.mitWindowsStarten === true,
      rechtschreibung: roh.rechtschreibung !== false,
      meldungsvorschau: roh.meldungsvorschau !== false,
      sprache: typeof roh.sprache === 'string' ? roh.sprache : 'automatisch',
      hinweisGezeigt: roh.hinweisGezeigt === true,
      serverAdresse: typeof roh.serverAdresse === 'string' ? roh.serverAdresse : '',
    };
  } catch {
    // Erster Start oder unlesbar - dann die Vorgaben.
    zwischenspeicher = { ...VORGABE };
  }
  return zwischenspeicher;
}

export function setzeEinstellung<S extends keyof HuellenEinstellungen>(
  name: S,
  wert: HuellenEinstellungen[S],
): void {
  const stand = { ...einstellungen(), [name]: wert };
  zwischenspeicher = stand;
  try {
    writeFileSync(datei(), JSON.stringify(stand, null, 2), 'utf8');
  } catch {
    // Nicht schlimm genug für eine Meldung: die Einstellung gilt für diesen Lauf, beim
    // nächsten Start steht wieder die Vorgabe.
  }
}

/**
 * Trägt die Anwendung in den Autostart ein oder wieder aus.
 *
 * Wird bei jedem Start mit dem gemerkten Wert aufgerufen: der Eintrag lebt in der
 * Registry und kann dort auch von außen verschwinden (Aufräumprogramme tun das gern).
 * Ihn jedes Mal nachzuziehen ist billiger, als sich zu wundern.
 */
export function wendeAutostartAn(): void {
  const soll = einstellungen().mitWindowsStarten;
  try {
    const ist = app.getLoginItemSettings().openAtLogin;
    if (ist !== soll) app.setLoginItemSettings({ openAtLogin: soll });
  } catch {
    // Auf Systemen ohne Autostart-Verwaltung schlicht nichts tun.
  }
}
