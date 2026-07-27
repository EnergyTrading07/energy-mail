import type { FullMessage } from '@energy-mail/mail-core';

/**
 * Hält geöffnete Nachrichten im Arbeitsspeicher vor.
 *
 * Bewusst nicht auf Platte, anders als der Zwischenspeicher für Kopfdaten: eine
 * Nachricht wiegt im Mittel 80 KB und mit eingebetteten Bildern auch mal 200 KB. Auf
 * Platte geschrieben würde das eine Datei im dreistelligen Megabyte-Bereich ergeben, die
 * bei jeder Änderung vollständig neu geschrieben werden müsste - der Zwischenspeicher
 * wäre dann teurer als das, was er einspart.
 *
 * Verdrängt wird nach Alter der letzten Benutzung: wer zwischen zwei Nachrichten hin und
 * her springt, findet beide vor; wer sich durch hundert liest, verdrängt die ältesten.
 */

interface Eintrag {
  wert: FullMessage;
  bytes: number;
}

/**
 * Obergrenze. 24 MB reichen für rund 300 durchschnittliche Nachrichten und fallen neben
 * dem übrigen Speicherbedarf der Anwendung nicht ins Gewicht.
 */
const BUDGET_BYTES = 24 * 1024 * 1024;

const speicher = new Map<string, Eintrag>();
let belegt = 0;

export function nachrichtenSchluessel(accountId: string, ordner: string, uid: number): string {
  return `${accountId}:${ordner}:${uid}`;
}

export function liesNachricht(key: string): FullMessage | null {
  const eintrag = speicher.get(key);
  if (!eintrag) return null;
  // Neu einsortieren: Map behält die Einfügereihenfolge, dadurch steht das zuletzt
  // Benutzte hinten und das am längsten Unbenutzte vorn.
  speicher.delete(key);
  speicher.set(key, eintrag);
  return eintrag.wert;
}

export function merkeNachricht(key: string, wert: FullMessage): void {
  const bytes = grobeGroesse(wert);
  // Einzelne Riesen gar nicht erst aufnehmen - sie würden alles andere verdrängen.
  if (bytes > BUDGET_BYTES / 4) return;

  const vorhanden = speicher.get(key);
  if (vorhanden) belegt -= vorhanden.bytes;

  speicher.set(key, { wert, bytes });
  belegt += bytes;

  while (belegt > BUDGET_BYTES && speicher.size > 1) {
    const [aeltester] = speicher.keys();
    belegt -= speicher.get(aeltester)!.bytes;
    speicher.delete(aeltester);
  }
}

/**
 * Verwirft Nachrichten, deren Schlüssel mit dem Präfix beginnt. Nach dem Verschieben,
 * Löschen oder Ändern des Gelesen-Status: die vorgehaltene Fassung träfe sonst nicht
 * mehr zu - etwa mit einem Gelesen-Status, der nicht mehr stimmt.
 */
export function verwirfNachrichten(praefix: string): void {
  for (const key of [...speicher.keys()]) {
    if (key.startsWith(praefix)) {
      belegt -= speicher.get(key)!.bytes;
      speicher.delete(key);
    }
  }
}

/**
 * Setzt den Gelesen-Status vorgehaltener Nachrichten nach.
 *
 * Bewusst nachziehen statt verwerfen: eine Nachricht zu öffnen markiert sie als gelesen,
 * und würde das den vorgehaltenen Stand wegwerfen, wäre der Speicher genau dann leer,
 * wenn man zur eben gelesenen Nachricht zurückkehrt - also im häufigsten Fall überhaupt.
 */
export function aktualisiereGelesen(
  accountId: string,
  ordner: string,
  uids: number[],
  seen: boolean,
): void {
  for (const uid of uids) {
    const key = nachrichtenSchluessel(accountId, ordner, uid);
    const eintrag = speicher.get(key);
    if (eintrag) {
      eintrag.wert = {
        ...eintrag.wert,
        seen,
        flags: seen
          ? [...new Set([...eintrag.wert.flags, '\\Seen'])]
          : eintrag.wert.flags.filter((f) => f !== '\\Seen'),
      };
    }
  }
}

/** Für Protokoll und Prüfung. */
export function speicherStand(): { eintraege: number; bytes: number } {
  return { eintraege: speicher.size, bytes: belegt };
}

/**
 * Grobe Schätzung des Platzbedarfs. Die genaue Größe zu ermitteln wäre teurer als der
 * Nutzen: entscheidend ist nur, dass große Nachrichten stärker zählen als kleine, und
 * der Textinhalt macht praktisch alles aus.
 */
function grobeGroesse(nachricht: FullMessage): number {
  const html = typeof nachricht.html === 'string' ? nachricht.html.length : 0;
  return html + (nachricht.text?.length ?? 0) + 1024;
}
