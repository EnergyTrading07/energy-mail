import { BrowserWindow, Notification } from 'electron';
import { POSTEINGANG, subscribe, type MailEvent } from '@energy-mail/server/events';
import { programmSymbolPfad } from './programmSymbol.js';

/**
 * Meldungen des Betriebssystems bei neuer Post.
 *
 * Die Überwachung per IMAP läuft ohnehin dauerhaft; hier wird nur noch weitergereicht,
 * was sie meldet. Ohne das erfährt man von neuer Post erst beim nächsten Blick ins
 * Fenster - bei einem Programm, das den ganzen Tag im Hintergrund läuft, der wesentliche
 * Zweck einer Überwachung.
 */

/**
 * Höchstzahl gleichzeitiger Meldungen. Treffen mehr Nachrichten auf einmal ein - etwa
 * nachdem der Rechner aus dem Standby kommt -, wird der Rest zusammengefasst, statt den
 * Bildschirm zuzustellen.
 */
const MAX_MELDUNGEN = 3;

/**
 * Das Programmsymbol für die Meldungen.
 *
 * Ohne Angabe nimmt Windows das Symbol der Verknüpfung - was meistens klappt, aber
 * nicht, wenn die Anwendung ohne Installation läuft (portable Fassung) oder die
 * Verknüpfung fehlt. Dann steht dort das leere Standardsymbol, und die Meldung sieht
 * aus, als käme sie von irgendwoher.
 *
 * Die Datei liegt im Paket (siehe files in electron-builder.yml).
 *
 * Hier stand einmal, aus dem Quellbaum gestartet zeige derselbe Pfad ebenfalls auf sie -
 * "build/ liegt in beiden Fällen unmittelbar unter dem Wurzelverzeichnis der Anwendung".
 * Das stimmt nicht: paketiert ist app.getAppPath() die Wurzel des Archivs, aus dem
 * Quellbaum dagegen packages/desktop, und ein packages/desktop/build/ gibt es nicht. Im
 * Entwicklungsbetrieb bekamen die Meldungen deshalb immer das leere Standardsymbol -
 * aufgefallen ist es nie, weil es paketiert richtig aussah.
 *
 * programmSymbolPfad() sucht beide Orte ab.
 */
const SYMBOL = programmSymbolPfad() ?? '';

function absenderName(nachricht: { from: { name?: string; address: string }[] }): string {
  const erster = nachricht.from[0];
  return erster?.name || erster?.address || 'Unbekannter Absender';
}

/**
 * Öffnet die gemeldete Nachricht im Fenster.
 *
 * Ohne Vorschaltskript (preload) gibt es keinen IPC-Kanal zur Oberfläche - der
 * Hauptprozess kann aber unmittelbar JavaScript im Fenster ausführen. Darüber wird ein
 * gewöhnliches Browser-Ereignis ausgelöst, auf das die Anwendung hört. Bewusst so
 * herum: die Oberfläche bleibt eine gewöhnliche Webanwendung ohne Sonderrechte.
 */
function zeigeNachricht(fenster: BrowserWindow, accountId: string, folder: string, uid: number): void {
  if (fenster.isMinimized()) fenster.restore();
  fenster.focus();
  void fenster.webContents.executeJavaScript(
    `window.dispatchEvent(new CustomEvent('energy-mail:oeffne', { detail: ${JSON.stringify({
      accountId,
      folder,
      uid,
    })} }))`,
  );
}

/**
 * @param nutzerId Wessen Eingänge gemeldet werden. In der Hülle immer der
 *   Einplatznutzer - der Ereignisstrom ist seit der Trennung je Nutzer geführt, und wer
 *   zuhören will, muss sagen, wem er zuhört.
 */
export function starteBenachrichtigungen(
  nutzerId: string,
  fensterHolen: () => BrowserWindow | null,
): () => void {
  if (!Notification.isSupported()) {
    console.warn('Benachrichtigungen: vom System nicht unterstützt.');
    return () => {};
  }
  console.log('Benachrichtigungen: aktiv.');

  return subscribe(nutzerId, (event: MailEvent) => {
    if (event.type !== 'new-mail') return;
    // Seit auch angesehene Ordner überwacht werden, treffen hier Eingänge aus Gesendet
    // oder Entwürfe ein. Eine Meldung über die eigene, gerade abgeschickte Nachricht
    // wäre unsinnig - gemeldet wird nur, was tatsächlich ankommt.
    if (event.folder !== POSTEINGANG) return;
    if (event.neue.length === 0) {
      console.log('Benachrichtigung entfällt: keine Kopfdaten zur neuen Nachricht.');
      return;
    }

    const fenster = fensterHolen();
    // Wer gerade in der Anwendung arbeitet, sieht die neue Post ohnehin sofort in der
    // Liste - eine Meldung darüber wäre nur im Weg.
    //
    // isFocused() allein genügt dafür nicht: bei einem minimierten Fenster meldet es
    // weiterhin Vordergrund. Ohne die beiden anderen Abfragen bliebe die Meldung
    // ausgerechnet dann aus, wenn man sie braucht - nämlich bei weggeklickter Anwendung.
    const imBlick =
      Boolean(fenster) && fenster!.isFocused() && fenster!.isVisible() && !fenster!.isMinimized();
    if (imBlick) {
      console.log('Benachrichtigung entfällt: Fenster ist im Vordergrund.');
      return;
    }
    console.log(
      `Benachrichtigung für ${event.email}: ${event.neue.length} neue Nachricht(en) von ` +
        event.neue.map(absenderName).join(', '),
    );

    for (const nachricht of event.neue.slice(0, MAX_MELDUNGEN)) {
      const meldung = new Notification({
        title: absenderName(nachricht),
        body: nachricht.subject || '(kein Betreff)',
        // Bei mehreren Konten muss erkennbar sein, welches gemeint ist.
        subtitle: event.email,
        icon: SYMBOL,
        silent: false,
      });
      meldung.on('click', () => {
        const aktuell = fensterHolen();
        if (aktuell) zeigeNachricht(aktuell, event.accountId, event.folder, nachricht.uid);
      });
      // Windows meldet hierüber, wenn die Anzeige nicht geklappt hat - etwa weil
      // Meldungen für die Anwendung abgeschaltet sind oder der Fokus-Assistent sie
      // gerade unterdrückt. Ohne diesen Hinweis bliebe unklar, warum nichts erscheint.
      meldung.on('failed', (_e, fehler) =>
        console.warn(`Benachrichtigung wurde nicht angezeigt: ${fehler}`),
      );
      meldung.show();
    }

    const weitere = event.neue.length - MAX_MELDUNGEN;
    if (weitere > 0) {
      new Notification({
        title: event.email,
        body: `und ${weitere} weitere neue ${weitere === 1 ? 'Nachricht' : 'Nachrichten'}`,
        icon: SYMBOL,
      }).show();
    }
  });
}
