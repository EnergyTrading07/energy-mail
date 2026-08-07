import { Menu, MenuItem, type BrowserWindow } from 'electron';

/**
 * Rechtschreibprüfung beim Verfassen.
 *
 * Electron bringt sie mit (dieselbe wie Chrome), sie muss nur auf Deutsch gestellt und
 * mit einem Kontextmenü verbunden werden - ohne das sieht man zwar die rote Wellenlinie,
 * bekommt aber keine Vorschläge und kann kein Wort ins eigene Wörterbuch aufnehmen.
 *
 * Englisch bleibt daneben stehen: in Mails an Firmen und in weitergeleiteten Nachrichten
 * stehen ständig englische Wörter, die sonst allesamt angestrichen würden.
 */

/** Was Windows nicht selbst mitbringt, lädt Electron nach - hier die gewünschte Reihenfolge. */
const SPRACHEN = ['de-DE', 'en-US'];

export function richteRechtschreibungEin(fenster: BrowserWindow): void {
  const pruefer = fenster.webContents.session;

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
        menue.append(new MenuItem({ label: 'Keine Vorschläge', enabled: false }));
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
      menue.append(new MenuItem({ role: 'undo', label: 'Rückgängig' }));
      menue.append(new MenuItem({ role: 'redo', label: 'Wiederholen' }));
      menue.append(new MenuItem({ type: 'separator' }));
      menue.append(new MenuItem({ role: 'cut', label: 'Ausschneiden' }));
      menue.append(new MenuItem({ role: 'copy', label: 'Kopieren' }));
      menue.append(new MenuItem({ role: 'paste', label: 'Einfügen' }));
      menue.append(new MenuItem({ role: 'selectAll', label: 'Alles auswählen' }));
    } else if (angaben.selectionText) {
      menue.append(new MenuItem({ role: 'copy', label: 'Kopieren' }));
    }

    if (menue.items.length > 0) menue.popup({ window: fenster });
  });
}
