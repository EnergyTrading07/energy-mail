import { app } from 'electron';
import electronUpdater from 'electron-updater';
import { protokolliere } from '@energy-mail/server/protokoll';
import { pruefeAktualisierung, schluesselHinterlegt } from './updateSignatur.js';
import { richtlinien } from './richtlinien.js';
import { t } from '@energy-mail/mail-core/sprache';

// electron-updater ist ein CommonJS-Paket; aus einem ES-Modul heraus kommt es als
// Standardexport an und muss erst aufgeteilt werden.
const { autoUpdater, NsisUpdater } = electronUpdater;

/**
 * Wo die Veröffentlichungen liegen. Muss zum "repository"-Eintrag der package.json
 * passen - daraus baut electron-builder die app-update.yml, und daraus wird hier die
 * Adresse der Freigabedatei.
 */
const BESITZER = 'EnergyTrading07';
const ABLAGE = 'energy-mail';

/**
 * Die Fassung, die gerade geladen wird.
 *
 * Der Prüfhaken von electron-updater bekommt nur den Pfad der heruntergeladenen Datei -
 * nicht, zu welcher Fassung sie gehört. Die steht aber in der Auskunft, die kurz vorher
 * eintrifft, und ohne sie ließe sich die zugehörige Freigabe nicht finden.
 */
let geladeneFassung: string | null = null;

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
  /*
   * Die Organisation hat entschieden - und sagt das auch.
   *
   * Den Knopf stillschweigend wirkungslos zu machen wäre schlimmer als eine Absage: der
   * Nutzer klickte, bekäme nichts und wüsste nicht warum. Siehe richtlinien.ts.
   */
  if (richtlinien().aktualisierungAbschalten) {
    setze({
      phase: 'fehler',
      grund: t('Die Aktualisierung wird von Ihrer Organisation vorgegeben. {wohin}', {
        wohin: richtlinien().ansprechpartner ?? t('Wenden Sie sich an Ihre IT-Abteilung.'),
      }),
    });
    return;
  }
  if (!app.isPackaged) {
    setze({
      phase: 'fehler',
      grund: t(
        'Aus dem Quellbaum gestartet gibt es nichts zu aktualisieren – die Selbstaktualisierung gilt nur für die installierte Fassung.',
      ),
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

  /*
   * Vor allem anderen: hat die Organisation es untersagt?
   *
   * Muss hier stehen und nicht erst bei der Suche - autoDownload und
   * autoInstallOnAppQuit weiter unten machen aus einer bloßen Prüfung sonst ein
   * Herunterladen und ein Einspielen beim nächsten Beenden. Genau das soll in einer
   * verwalteten Aufstellung nicht passieren: dort bestimmt die IT, welche Fassung wann
   * auf welchen Rechner kommt.
   */
  if (richtlinien().aktualisierungAbschalten) {
    log.info('Aktualisierung: von der Organisation abgeschaltet (richtlinien.json).');
    return;
  }

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

  /**
   * Die eigene Unterschrift prüfen, bevor die Datei als brauchbar gilt.
   *
   * Gehängt wird es an genau diesen Haken und nicht an ein späteres Ereignis, und das
   * ist wesentlich: electron-updater ruft ihn INNERHALB des Ladevorgangs, und ein
   * Befund führt dort zu einem Abbruch mit ERR_UPDATER_INVALID_SIGNATURE. Damit sind
   * beide Wege abgedeckt - der Knopf in der Oberfläche und das stille Einspielen beim
   * Beenden (autoInstallOnAppQuit). Eine Prüfung erst vor quitAndInstall() ließe den
   * zweiten Weg offen, und der ist der häufigere.
   *
   * Der Haken wird nur gerufen, wenn in der app-update.yml ein publisherName steht -
   * sonst steigt verifySignature() vorher aus. Deshalb steht dort einer, obwohl es
   * (noch) kein Zertifikat gibt; siehe electron-builder.yml.
   *
   * Die Abfrage auf NsisUpdater ist keine Formsache: den Haken gibt es nur dort. Auf
   * einem anderen Betriebssystem ist `autoUpdater` ein MacUpdater oder AppImageUpdater,
   * und ein Zuweisen ginge ins Leere - still, versteht sich. Heute wird ohnehin nur für
   * Windows gebaut; die Abfrage ist der Riegel für den Tag, an dem sich das ändert.
   */
  if (!(autoUpdater instanceof NsisUpdater)) {
    protokolliere(
      'warnung',
      'aktualisierung',
      `Keine Freigabeprüfung: ${process.platform} kennt den Prüfhaken nicht.`,
    );
    return;
  }

  autoUpdater.verifyUpdateCodeSignature = async (_namen: string[], datei: string) => {
    if (!schluesselHinterlegt()) {
      /*
       * Noch kein Schlüssel erzeugt (scripts/schluessel-erzeugen.mjs).
       *
       * Hier NICHT abweisen: das schaltete die Selbstaktualisierung ganz ab, und zwar
       * für einen Zustand, der eine fehlende Einrichtung ist und kein Angriff. Es bleibt
       * damit beim Stand von vorher - keine Prüfung -, aber es steht laut im Protokoll,
       * statt still zu geschehen.
       */
      protokolliere(
        'warnung',
        'aktualisierung',
        'Keine Freigabeprüfung: es ist kein öffentlicher Schlüssel hinterlegt ' +
          '(scripts/schluessel-erzeugen.mjs).',
      );
      return null;
    }

    if (!geladeneFassung) {
      return t(
        'Zu dieser Datei ist keine Fassung bekannt - die Freigabe lässt sich nicht zuordnen.',
      );
    }

    const befund = await pruefeAktualisierung(datei, geladeneFassung, BESITZER, ABLAGE);
    if (befund) {
      protokolliere('fehler', 'aktualisierung', `Freigabe abgelehnt: ${befund}`);
    } else {
      protokolliere('info', 'aktualisierung', `Freigabe für ${geladeneFassung} geprüft und in Ordnung.`);
    }
    return befund;
  };

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
      // Merken für den Prüfhaken: er bekommt später nur den Dateipfad und wüsste sonst
      // nicht, zu welcher Veröffentlichung die Freigabe zu holen ist.
      geladeneFassung = info.version;
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
