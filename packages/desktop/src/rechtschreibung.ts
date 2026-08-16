import { Menu, MenuItem, session, type BrowserWindow } from 'electron';
import { einstellungen } from './einstellungen.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Rechtschreibprüfung beim Verfassen.
 *
 * Electron bringt sie mit (dieselbe wie Chrome), sie muss nur auf Deutsch gestellt und
 * mit einem Kontextmenü verbunden werden - ohne das sieht man zwar die rote Wellenlinie,
 * bekommt aber keine Vorschläge und kann kein Wort ins eigene Wörterbuch aufnehmen.
 *
 * Englisch bleibt daneben stehen: in Mails an Firmen und in weitergeleiteten Nachrichten
 * stehen ständig englische Wörter, die sonst allesamt angestrichen würden.
 *
 * Und die Stelle, an der ein Mailprogramm, das "nichts geht nach draußen" verspricht,
 * doch nach draußen greift: die Wörterbücher liegen nicht bei, Chromium lädt sie beim
 * ersten Bedarf von einem Server von Google (redirector.gvt1.com). Das steht in keiner
 * Zeile dieses Quelltextes - es passiert eine Ebene tiefer, und genau deshalb stand es
 * lange in keiner Aufzählung dessen, was die Anwendung tut.
 *
 * Was dabei hinausgeht, ist ein gewöhnlicher Dateiabruf: IP-Adresse und Sprachkennung,
 * einmal, dann liegt die Datei im Benutzerordner. Geschriebener Text geht NICHT hinaus -
 * die Prüfung selbst läuft vollständig auf dem Rechner. Das ist ein Unterschied ums
 * Ganze, und trotzdem bleibt es ein Abruf bei einem Dritten, von dem der Nutzer wissen
 * und den er abstellen können soll. Deshalb der Schalter in den Einstellungen und der
 * Absatz in DATENSCHUTZ.md.
 */

/** Was Windows nicht selbst mitbringt, lädt Electron nach - hier die gewünschte Reihenfolge. */
const SPRACHEN = ['de-DE', 'en-US'];

/**
 * Setzt den Schalter aus den Einstellungen durch.
 *
 * Getrennt vom Einrichten des Kontextmenüs, weil es zweimal gebraucht wird: beim Bauen
 * eines Fensters und beim Umlegen des Schalters im Menü. Auf der gemeinsamen Sitzung und
 * nicht je Fenster - die Prüfung hängt dort, und ein zweites Fenster brächte sonst die
 * Einstellung des ersten durcheinander.
 */
export function wendeRechtschreibungAn(): void {
  const pruefer = session.defaultSession;

  if (!einstellungen().rechtschreibung) {
    /*
     * Abgeschaltet heißt: kein Wörterbuch, also auch kein Abruf.
     *
     * Die Sprachliste vorher zu leeren wäre der nächstliegende Weg und der falsche -
     * Chromium erkennt eine leere Liste als "nimm die Systemsprache" und lädt doch.
     */
    pruefer.setSpellCheckerEnabled(false);
    return;
  }

  pruefer.setSpellCheckerEnabled(true);

  /**
   * Nur setzen, was der Rechner auch kennt. Eine unbekannte Kennung wirft, und die
   * verfügbaren Sprachen unterscheiden sich je nach Windows-Installation.
   */
  const verfuegbar = new Set(pruefer.availableSpellCheckerLanguages);
  const gewaehlt = SPRACHEN.filter((s) => verfuegbar.has(s));
  if (gewaehlt.length > 0) {
    pruefer.setSpellCheckerLanguages(gewaehlt);
  } else {
    console.warn(
      `Keine der Sprachen ${SPRACHEN.join(', ')} steht zur Rechtschreibprüfung bereit.`,
    );
  }
}

export function richteRechtschreibungEin(fenster: BrowserWindow): void {
  const pruefer = fenster.webContents.session;

  wendeRechtschreibungAn();

  fenster.webContents.on('context-menu', (_ereignis, angaben) => {
    const menue = new Menu();

    for (const vorschlag of angaben.dictionarySuggestions) {
      menue.append(
        new MenuItem({
          label: vorschlag,
          click: () => fenster.webContents.replaceMisspelling(vorschlag),
        }),
      );
    }

    if (angaben.misspelledWord) {
      if (angaben.dictionarySuggestions.length === 0) {
        menue.append(new MenuItem({ label: t('Keine Vorschläge'), enabled: false }));
      }
      menue.append(new MenuItem({ type: 'separator' }));
      menue.append(
        new MenuItem({
          label: `„${angaben.misspelledWord}“ ins Wörterbuch aufnehmen`,
          click: () => pruefer.addWordToSpellCheckerDictionary(angaben.misspelledWord),
        }),
      );
      menue.append(new MenuItem({ type: 'separator' }));
    }

    // Die üblichen Befehle gehören auch dann hierher, wenn nichts falsch geschrieben ist -
    // ohne sie hätte ein Rechtsklick im Textfeld gar kein Menü.
    if (angaben.isEditable) {
      menue.append(new MenuItem({ role: 'undo', label: t('Rückgängig') }));
      menue.append(new MenuItem({ role: 'redo', label: 'Wiederholen' }));
      menue.append(new MenuItem({ type: 'separator' }));
      menue.append(new MenuItem({ role: 'cut', label: 'Ausschneiden' }));
      menue.append(new MenuItem({ role: 'copy', label: 'Kopieren' }));
      menue.append(new MenuItem({ role: 'paste', label: t('Einfügen') }));
      menue.append(new MenuItem({ role: 'selectAll', label: t('Alles auswählen') }));
    } else if (angaben.selectionText) {
      menue.append(new MenuItem({ role: 'copy', label: 'Kopieren' }));
    }

    if (menue.items.length > 0) menue.popup({ window: fenster });
  });
}
