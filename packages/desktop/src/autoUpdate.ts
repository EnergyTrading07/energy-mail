import { app, dialog } from 'electron';
import electronUpdater from 'electron-updater';

// electron-updater ist ein CommonJS-Paket; aus einem ES-Modul heraus kommt es als
// Standardexport an und muss erst aufgeteilt werden.
const { autoUpdater } = electronUpdater;

/**
 * Selbstaktualisierung über die Veröffentlichungen (Releases) des GitHub-Repositorys.
 *
 * Ablauf: beim Start wird geprüft, ob dort eine neuere Fassung liegt. Ist das der Fall,
 * lädt sie im Hintergrund herunter - die Anwendung bleibt währenddessen benutzbar. Erst
 * wenn sie vollständig da ist, wird gefragt. Wer "Später" wählt, bekommt sie beim
 * nächsten Beenden eingespielt; es geht also nichts verloren.
 *
 * Wohin geschaut wird, steht in app-update.yml im Paket - electron-builder legt die
 * Datei beim Bauen aus dem publish-Eintrag an. Da das Repository öffentlich ist, braucht
 * es dafür keinen Zugriffsschlüssel in der Anwendung.
 */

/** Abstand zwischen zwei Prüfungen, solange die Anwendung durchgehend läuft. */
const PRUEFINTERVALL_MS = 6 * 60 * 60 * 1000;

export interface UpdateLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

export function starteAktualisierungspruefung(log: UpdateLogger): void {
  // Aus dem Quellbaum heraus gibt es keine app-update.yml; die Prüfung würde mit einem
  // Fehler abbrechen, der nichts bedeutet.
  if (!app.isPackaged) {
    log.info('Aktualisierung: übersprungen (läuft aus dem Quellbaum, nicht paketiert).');
    return;
  }

  // Herunterladen ja, Einspielen erst beim Beenden - mitten im Schreiben einer Mail
  // soll sich die Anwendung nicht selbst neu starten.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => log.info('Aktualisierung: suche…'));

  autoUpdater.on('update-not-available', (info: { version: string }) =>
    log.info(`Aktualisierung: bereits aktuell (${info.version}).`),
  );

  autoUpdater.on('update-available', (info: { version: string }) =>
    log.info(`Aktualisierung: Fassung ${info.version} gefunden, wird geladen…`),
  );

  autoUpdater.on('download-progress', (fortschritt: { percent: number }) =>
    log.info(`Aktualisierung: ${Math.round(fortschritt.percent)} % geladen`),
  );

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    log.info(`Aktualisierung: Fassung ${info.version} bereit.`);
    void dialog
      .showMessageBox({
        type: 'info',
        title: 'Aktualisierung bereit',
        message: `Energy Mail ${info.version} steht bereit.`,
        detail:
          'Die neue Fassung ist heruntergeladen. Sie wird beim nächsten Beenden ' +
          'eingespielt – oder sofort, wenn du jetzt neu startest.',
        buttons: ['Jetzt neu starten', 'Später'],
        defaultId: 1,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  // Eine fehlgeschlagene Prüfung darf die Anwendung nicht behelligen: ohne Internet,
  // hinter einer Firewall oder bei einer Störung bei GitHub ist das der Normalfall und
  // hat mit dem Mailabruf nichts zu tun.
  autoUpdater.on('error', (err: Error) =>
    log.warn(`Aktualisierung fehlgeschlagen (ohne Folgen für den Betrieb): ${err.message}`),
  );

  const pruefen = () => {
    autoUpdater.checkForUpdates().catch(() => {
      // Bereits über das error-Ereignis protokolliert.
    });
  };

  pruefen();
  const timer = setInterval(pruefen, PRUEFINTERVALL_MS);
  // Sonst hielte der Zeitgeber den Prozess am Leben.
  timer.unref?.();
}
