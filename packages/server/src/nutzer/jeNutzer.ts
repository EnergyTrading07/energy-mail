import { aktuellerNutzer, pruefeNutzerId } from './kontext.js';

/**
 * Zustand im Arbeitsspeicher, der einem Nutzer gehoert.
 *
 * Der Nutzerkontext sorgt dafuer, dass jeder Speicher in den richtigen ORDNER schreibt.
 * Das genuegt nicht: mehrere Speicher halten ihren Zustand zusaetzlich in einer
 * prozessglobalen Map oder in einem einzigen Datenbankgriff - und der wechselt mit dem
 * Kontext nicht mit.
 *
 * Der Fehler sah so aus: Anna legt Nachrichten in ihrer Ablage ab, Bert oeffnet seine -
 * und bekommt Annas zu sehen, weil `let db` EIN Griff auf EINE Datei war. Beim
 * Zwischenspeicher dasselbe, nur mit einer Map. Das ist keine Frage des
 * Speicherverbrauchs, sondern eine Vermischung von Daten.
 *
 * Dieses Modul haelt den Zustand je Nutzer und raeumt die aeltesten weg, wenn es zu
 * viele werden.
 */

export interface JeNutzerOptionen<T> {
  /**
   * Hoechstzahl gleichzeitig gehaltener Nutzer. Ohne Angabe unbegrenzt.
   *
   * Sinnvoll fuer alles, was Platz oder Handles kostet - offene Datenbanken,
   * Zwischenspeicher. NICHT sinnvoll fuer Zustand, dessen Verlust etwas kaputt macht:
   * eine verworfene Sendewarteschlange verloere ihre Zeitgeber.
   */
  hoechstens?: number;
  /** Wird gerufen, bevor ein Eintrag verworfen wird - zum Schliessen von Handles. */
  beimVerwerfen?: (wert: T, nutzerId: string) => void;
}

export interface JeNutzer<T> {
  /** Fuer den Nutzer, fuer den gerade gearbeitet wird. Legt bei Bedarf an. */
  hole(): T;
  /** Fuer einen bestimmten Nutzer - fuer Verwaltungsaufgaben. */
  holeFuer(nutzerId: string): T;
  /** Was da ist, ohne anzulegen. */
  vorhanden(nutzerId?: string): T | undefined;
  /** Verwirft einen Nutzer (oder den aktuellen) und ruft dabei beimVerwerfen. */
  verwirf(nutzerId?: string): void;
  /** Verwirft alle - beim Herunterfahren. */
  verwirfAlle(): void;
  /** Alle gehaltenen Eintraege, fuer Herunterfahren und Diagnose. */
  alle(): [string, T][];
}

export function jeNutzer<T>(
  erzeuge: (nutzerId: string) => T,
  optionen: JeNutzerOptionen<T> = {},
): JeNutzer<T> {
  const eintraege = new Map<string, T>();

  function verwerfeEinen(id: string): void {
    const wert = eintraege.get(id);
    if (wert === undefined) return;
    eintraege.delete(id);
    try {
      optionen.beimVerwerfen?.(wert, id);
    } catch {
      // Ein Fehler beim Aufraeumen darf den Aufrufer nicht mitreissen - er wollte nur
      // Platz schaffen.
    }
  }

  function holeFuer(nutzerId: string): T {
    const id = pruefeNutzerId(nutzerId);
    const vorhanden = eintraege.get(id);
    if (vorhanden !== undefined) {
      /*
       * Beim Zugriff ans Ende ruecken.
       *
       * Damit ist der erste Eintrag der Map immer der am laengsten nicht benutzte - das
       * ist der, der bei Platzmangel gehen soll. Ohne dieses Umsortieren fiele
       * ausgerechnet der Nutzer heraus, der zuerst da war und seitdem durchgehend
       * arbeitet.
       */
      eintraege.delete(id);
      eintraege.set(id, vorhanden);
      return vorhanden;
    }

    const neu = erzeuge(id);
    eintraege.set(id, neu);

    if (optionen.hoechstens !== undefined) {
      while (eintraege.size > optionen.hoechstens) {
        const aeltester = eintraege.keys().next().value;
        if (aeltester === undefined) break;
        verwerfeEinen(aeltester);
      }
    }
    return neu;
  }

  return {
    hole: () => holeFuer(aktuellerNutzer()),
    holeFuer,
    vorhanden: (nutzerId) => eintraege.get(nutzerId ?? aktuellerNutzer()),
    verwirf: (nutzerId) => verwerfeEinen(nutzerId ?? aktuellerNutzer()),
    verwirfAlle: () => {
      for (const id of [...eintraege.keys()]) verwerfeEinen(id);
    },
    alle: () => [...eintraege.entries()],
  };
}
