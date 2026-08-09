/**
 * Was die Desktop-Hülle der Oberfläche anbietet.
 *
 * Bis hierher kam die Anwendung ohne jede Brücke aus: der Hauptprozess führte im Fenster
 * unmittelbar JavaScript aus und löste dort ein gewöhnliches Ereignis aus. Das reicht,
 * solange nur von außen nach innen gerufen wird - für Fensterknöpfe, das Umschalten der
 * Ansicht und den Aktualisierungsablauf muss die Oberfläche aber auch zurückrufen können,
 * und dafür führt kein Weg an einem Vorschaltskript (preload) vorbei.
 *
 * Bewusst schmal gehalten: hier steht kein allgemeiner Kanal, über den beliebiges an den
 * Hauptprozess ginge, sondern eine Handvoll benannter Vorgänge. Was nicht aufgeführt ist,
 * geht nicht - das ist der ganze Sinn der Trennung.
 *
 * Muss zu packages/desktop/src/preload.ts passen. Im Browser betrieben fehlt die Brücke;
 * jede Verwendung muss deshalb mit ihrem Fehlen rechnen (window.energyMail?.…).
 */

/** Wo der Aktualisierungsablauf gerade steht. Siehe packages/desktop/src/autoUpdate.ts. */
type Aktualisierungsstand =
  | { phase: 'ruhe' }
  | { phase: 'suche' }
  | { phase: 'aktuell'; fassung: string }
  | { phase: 'gefunden'; fassung: string; neuerungen?: string }
  | { phase: 'laedt'; fassung: string; prozent: number; proSekunde: number }
  | { phase: 'bereit'; fassung: string; neuerungen?: string }
  | { phase: 'fehler'; grund: string };

interface Fensterzustand {
  maximiert: boolean;
  /** Unbeteiligte Fenster treten zurück - die Titelleiste zeichnet sich dann blasser. */
  imVordergrund: boolean;
}

interface EnergyMailBruecke {
  /** Fassung der Anwendung, für das Über-Fenster und den Fehlerbericht. */
  readonly fassung: string;
  /**
   * Zugangsgeheimnis für den lokalen Server, bei jedem Start neu.
   *
   * Ohne es beantwortet der Server keine Anfrage. api.ts hängt es an jede Anfrage,
   * useMailEvents.ts an den WebSocket. Siehe packages/server/src/zugang.ts.
   */
  readonly zugang: string;
  /** 'win32', 'darwin', 'linux' - die Fensterknöpfe stehen je nach System anders. */
  readonly plattform: string;

  // --- Fenster ---
  minimieren(): void;
  maximierenUmschalten(): void;
  schliessen(): void;
  /** Meldet Änderungen; liefert die Abmeldung zurück. */
  aufFensterzustand(hoeren: (zustand: Fensterzustand) => void): () => void;
  fensterzustand(): Promise<Fensterzustand>;

  // --- Ansicht ---
  /** Färbt die von Windows gezeichneten Fensterknöpfe passend zur gewählten Ansicht. */
  setzeAnsicht(ansicht: 'hell' | 'dunkel'): void;

  // --- Aktualisierung ---
  aufAktualisierung(hoeren: (stand: Aktualisierungsstand) => void): () => void;
  aktualisierungStand(): Promise<Aktualisierungsstand>;
  aktualisierungSuchen(): void;
  jetztNeuStarten(): void;

  // --- Taskleiste ---
  /**
   * Zahl im Abzeichen über dem Symbol in der Taskleiste, 0 entfernt es. Das Bild wird
   * in der Oberfläche gezeichnet (design/abzeichen.ts) und fertig übergeben - der
   * Hauptprozess hat keine Zeichenfläche.
   */
  setzeUngelesen(anzahl: number, bild: string | null): void;

  // --- Sonstiges ---
  ueberOeffnen(): void;
}

interface Window {
  energyMail?: EnergyMailBruecke;
}
