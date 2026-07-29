import { app } from 'electron';
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
 *
 * Was sich mit der Neugestaltung geändert hat: der Ablauf ist nicht mehr unsichtbar.
 * Jeder Schritt wird als Zustand gemeldet, und die Oberfläche macht daraus die Karte
 * unten rechts (Aktualisierung.tsx). Vorher lief alles im Stillen und meldete sich
 * genau einmal, ganz am Ende, mit einem Systemfenster - wer wissen wollte, warum das
 * Programm Daten zieht, fand nirgends eine Auskunft.
 */

/** Abstand zwischen zwei Prüfungen, solange die Anwendung durchgehend läuft. */
const PRUEFINTERVALL_MS = 6 * 60 * 60 * 1000;

export interface UpdateLogger {
  info: (msg: string) => void;
  warn: (msg: string) => void;
}

/** Muss zu packages/web/src/bruecke.d.ts passen. */
export type Aktualisierungsstand =
  | { phase: 'ruhe' }
  | { phase: 'suche' }
  | { phase: 'aktuell'; fassung: string }
  | { phase: 'gefunden'; fassung: string; neuerungen?: string }
  | { phase: 'laedt'; fassung: string; prozent: number; proSekunde: number }
  | { phase: 'bereit'; fassung: string; neuerungen?: string }
  | { phase: 'fehler'; grund: string };

let stand: Aktualisierungsstand = { phase: 'ruhe' };
let melde: (stand: Aktualisierungsstand) => void = () => {};

/**
 * Für die Abfrage beim Öffnen des Fensters.
 *
 * Nötig, weil die Prüfung schon läuft, bevor die Oberfläche zuhören kann - und weil sie
 * nach einem Neuladen (F5) wieder von vorn zuhört. Ohne diesen Abruf wüsste sie danach
 * nichts von einer bereits geladenen Fassung.
 */
export function holeAktualisierungsstand(): Aktualisierungsstand {
  return stand;
}

function setze(neu: Aktualisierungsstand): void {
  stand = neu;
  melde(neu);
}

/**
 * Die Angaben zur Veröffentlichung kommen als HTML von GitHub.
 *
 * Fremdes Markup gehört nicht ins Fenster - schon gar nicht ungeprüft aus dem Netz.
 * Deshalb wird hier daraus schlichter Text: Aufzählungen behalten ihren Punkt, Absätze
 * ihren Umbruch, alles andere fällt weg. Das reicht vollkommen; in einer Liste von
 * Änderungen steht ohnehin nie mehr als ein Aufzählungspunkt je Zeile.
 */
function alsText(roh: string | { note: string | null }[] | null | undefined): string | undefined {
  if (!roh) return undefined;
  const html = Array.isArray(roh) ? roh.map((e) => e.note ?? '').join('\n') : roh;
  const text = html
    .replace(/<li[^>]*>/gi, '\n· ')
    .replace(/<\/(p|div|h\d|ul|ol|li)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Mehr als eine Leerzeile hintereinander wirkt in der schmalen Karte wie ein Bruch.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}

/** Von Hand angestoßen (Knopf in der Titelleiste). */
export function sucheAktualisierung(): void {
  if (!app.isPackaged) {
    setze({
      phase: 'fehler',
      grund:
        'Aus dem Quellbaum gestartet gibt es nichts zu aktualisieren – ' +
        'die Selbstaktualisierung gilt nur für die installierte Fassung.',
    });
    return;
  }
  setze({ phase: 'suche' });
  autoUpdater.checkForUpdates().catch(() => {
    // Bereits über das error-Ereignis gemeldet.
  });
}

export function spieleAktualisierungEin(): void {
  autoUpdater.quitAndInstall();
}

export function starteAktualisierungspruefung(
  log: UpdateLogger,
  aufStand: (stand: Aktualisierungsstand) => void,
): void {
  melde = aufStand;

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

  autoUpdater.on('checking-for-update', () => {
    log.info('Aktualisierung: suche…');
    setze({ phase: 'suche' });
  });

  autoUpdater.on('update-not-available', (info: { version: string }) => {
    log.info(`Aktualisierung: bereits aktuell (${info.version}).`);
    setze({ phase: 'aktuell', fassung: info.version });
  });

  autoUpdater.on(
    'update-available',
    (info: { version: string; releaseNotes?: string | { note: string | null }[] | null }) => {
      log.info(`Aktualisierung: Fassung ${info.version} gefunden, wird geladen…`);
      setze({ phase: 'gefunden', fassung: info.version, neuerungen: alsText(info.releaseNotes) });
    },
  );

  autoUpdater.on(
    'download-progress',
    (fortschritt: { percent: number; bytesPerSecond: number }) => {
      log.info(`Aktualisierung: ${Math.round(fortschritt.percent)} % geladen`);
      setze({
        phase: 'laedt',
        // Beim Wechsel von "gefunden" auf "laedt" ist die Fassung schon bekannt; das
        // Fortschrittsereignis selbst nennt sie nicht.
        fassung: 'fassung' in stand ? stand.fassung : '',
        prozent: fortschritt.percent,
        proSekunde: fortschritt.bytesPerSecond,
      });
    },
  );

  autoUpdater.on(
    'update-downloaded',
    (info: { version: string; releaseNotes?: string | { note: string | null }[] | null }) => {
      log.info(`Aktualisierung: Fassung ${info.version} bereit.`);
      setze({ phase: 'bereit', fassung: info.version, neuerungen: alsText(info.releaseNotes) });
    },
  );

  /**
   * Eine fehlgeschlagene Prüfung darf die Anwendung nicht behelligen: ohne Internet,
   * hinter einer Firewall oder bei einer Störung bei GitHub ist das der Normalfall und
   * hat mit dem Mailabruf nichts zu tun.
   *
   * Gemeldet wird es trotzdem - aber nur an die Karte, und die zeigt sich dafür nicht
   * von selbst, wenn die Suche im Hintergrund lief. Wer selbst gesucht hat, sieht das
   * Ergebnis; wer nicht, merkt nichts davon.
   */
  autoUpdater.on('error', (err: Error) => {
    log.warn(`Aktualisierung fehlgeschlagen (ohne Folgen für den Betrieb): ${err.message}`);
    setze({ phase: 'fehler', grund: err.message });
  });

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
