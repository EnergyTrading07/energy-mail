import fs from 'node:fs';
import path from 'node:path';

/**
 * Dateien so schreiben und lesen, dass ein Absturz sie nicht zerstoert.
 *
 * Der Anlass: `accounts.json` wurde mit einem einfachen writeFileSync ueberschrieben -
 * und zwar bei jeder Token-Erneuerung, also im Stundentakt. Ein Stromausfall genau in
 * diesem Moment hinterliess eine abgeschnittene Datei. Da readAccounts kein try/catch um
 * JSON.parse hatte, warf danach jeder Aufruf: /accounts lieferte 500, requireAccount
 * scheiterte, die Watcher stiegen aus. Der Nutzer hatte alle Konten samt gespeicherter
 * Kennwoerter verloren, und es gab ueber die Oberflaeche keinen Weg zurueck.
 *
 * Dasselbe Muster steckte in acht Dateien. Zwei machten es richtig (contactStore,
 * trustedSenders) - dieses Modul zieht deren Verfahren heraus und ergaenzt, was auch
 * dort fehlte: fsync, und eine Sicherungskopie des letzten heilen Standes.
 */

/** Endung der Zwischendatei. Bleibt sie liegen, war der Schreibvorgang unvollstaendig. */
const ZWISCHEN = '.neu';

/** Endung der letzten als heil bekannten Fassung. */
const SICHERUNG = '.bak';

/**
 * Schreibt eine Datei so, dass sie entweder vollstaendig alt oder vollstaendig neu ist.
 *
 * Der Ablauf, und warum jeder Schritt noetig ist:
 *  1. In eine Zwischendatei schreiben - die Zieldatei bleibt bis zuletzt unangetastet.
 *  2. fsync auf die Zwischendatei: ohne das liegen die Daten unter Umstaenden noch im
 *     Schreibpuffer des Betriebssystems. Ein rename waere dann zwar erfolgt, die Datei
 *     danach aber leer - genau der Fall, den das Verfahren verhindern soll.
 *  3. Die bisherige Fassung zur Seite legen (.bak), bevor sie ueberschrieben wird.
 *  4. rename - auf allen ueblichen Dateisystemen ein einzelner, unteilbarer Schritt.
 */
export function schreibeAtomar(ziel: string, inhalt: string): void {
  const ordner = path.dirname(ziel);
  fs.mkdirSync(ordner, { recursive: true, mode: 0o700 });

  const zwischen = `${ziel}${ZWISCHEN}`;
  const griff = fs.openSync(zwischen, 'w', 0o600);
  try {
    fs.writeFileSync(griff, inhalt, 'utf-8');
    fs.fsyncSync(griff);
  } finally {
    fs.closeSync(griff);
  }

  // Die bisherige Fassung aufheben. Schlaegt das fehl, ist das kein Grund, den neuen
  // Stand nicht zu schreiben - die Sicherungskopie ist ein Zusatz, keine Bedingung.
  try {
    if (fs.existsSync(ziel)) fs.copyFileSync(ziel, `${ziel}${SICHERUNG}`);
  } catch {
    // Kein Platz oder keine Rechte fuer die Kopie - der Hauptvorgang laeuft weiter.
  }

  fs.renameSync(zwischen, ziel);
}

/** Was beim Lesen herauskam, und ob dabei etwas nicht stimmte. */
export type Lesebefund<T> = {
  wert: T;
  /**
   * Gesetzt, wenn eine vorhandene Datei nicht lesbar war. Der Aufrufer soll das melden
   * statt es zu verschlucken - siehe die Begruendung bei liesJson.
   */
  beschaedigt?: { pfad: string; grund: string; beiseite?: string };
};

/**
 * Liest eine JSON-Datei und unterscheidet dabei zwei Faelle, die vorher zusammenfielen.
 *
 * Vorher stand in fuenf Speichern dieselbe Zeile: `try { ... } catch { return {} }`.
 * Damit war "die Datei gibt es noch nicht" - beim ersten Start voellig richtig - nicht
 * von "die Datei ist da, aber unlesbar" zu unterscheiden. Und weil der naechste
 * Schreibvorgang die zurueckgelieferte Voreinstellung ueber die noch teilweise
 * vorhandene Datei schrieb, war der Rest danach endgueltig weg: eine einzige halb
 * geschriebene regeln.json genuegte, um beim naechsten Regel-Speichern alle uebrigen
 * Regeln zu verlieren. Dasselbe fuer Etiketten, gemerkte Suchen und das Adressbuch.
 *
 * Jetzt gilt: fehlt die Datei, ist die Voreinstellung richtig. Ist sie unlesbar, wird
 * zuerst die Sicherungskopie versucht; hilft die auch nicht, wandert die kaputte Datei
 * zur Seite (damit der naechste Schreibvorgang sie nicht endgueltig ueberschreibt) und
 * der Befund geht nach oben.
 */
export function liesJson<T>(
  pfad: string,
  standard: T,
  /**
   * Was vor dem Auswerten mit dem Dateiinhalt geschieht - fuer verschluesselte Speicher.
   *
   * Als Haken und nicht als eigene Lesefunktion, weil sonst alles darunter zweimal
   * dastuende: die Sicherungskopie, das Beiseitelegen der kaputten Datei, die
   * Unterscheidung von "gibt es noch nicht" und "unlesbar". Genau daran haengt, dass ein
   * halb geschriebenes Adressbuch nicht das ganze Adressbuch kostet - das soll nicht
   * davon abhaengen, ob eine Datei verschluesselt ist.
   *
   * Wirft der Haken, gilt der Kandidat als unlesbar, und die Sicherungskopie ist dran.
   * Das ist richtig so: ein Schluesselwechsel und eine abgeschnittene Datei sehen von
   * hier aus gleich aus, und in beiden Faellen ist die vorige Fassung der bessere
   * Versuch.
   */
  entpacke?: (roh: string) => string,
): Lesebefund<T> {
  if (!fs.existsSync(pfad)) return { wert: standard };

  const versuche: string[] = [pfad, `${pfad}${SICHERUNG}`];
  let ersterGrund = '';

  for (const kandidat of versuche) {
    if (!fs.existsSync(kandidat)) continue;
    try {
      const roh = fs.readFileSync(kandidat, 'utf-8');
      // Eine leere Datei ist kein gueltiges JSON, aber auch kein Schaden: sie entsteht,
      // wenn der Schreibvorgang genau zwischen Anlegen und Fuellen abbrach.
      if (!roh.trim()) throw new Error('Datei ist leer');
      const wert = JSON.parse(entpacke ? entpacke(roh) : roh) as T;
      if (kandidat === pfad) return { wert };

      /*
       * Aus der Sicherungskopie gelesen - ein Befund, auch wenn es gutging.
       *
       * Hier wird die Datei auch tatsaechlich geheilt: die kaputte wandert zur Seite,
       * und der gerettete Stand tritt an ihre Stelle. Nur zu lesen genuegt nicht - beim
       * naechsten Aufruf faende liesJson sonst gar keine Datei mehr und lieferte die
       * Voreinstellung, und damit waere der Verlust doch eingetreten, nur eine Runde
       * spaeter.
       */
      const beiseite = legeBeiseite(pfad);
      try {
        schreibeAtomar(pfad, roh);
      } catch {
        // Nicht schreibbar (voller Datentraeger, fehlende Rechte): der Wert stimmt
        // trotzdem, und der Befund unten sagt, dass etwas nicht in Ordnung war.
      }
      return {
        wert,
        beschaedigt: { pfad, grund: ersterGrund || 'unlesbar', beiseite },
      };
    } catch (err) {
      if (!ersterGrund) ersterGrund = (err as Error).message;
    }
  }

  return {
    wert: standard,
    beschaedigt: { pfad, grund: ersterGrund || 'unlesbar', beiseite: legeBeiseite(pfad) },
  };
}

/**
 * Schiebt eine unlesbare Datei zur Seite, statt sie ueberschreiben zu lassen.
 *
 * Der Zeitstempel im Namen, damit mehrere Vorfaelle nebeneinander stehen bleiben. Was
 * hier landet, ist im Zweifel der einzige verbliebene Stand - jemand mit einem Editor
 * bekommt daraus oft noch das meiste zurueck.
 */
function legeBeiseite(pfad: string): string | undefined {
  try {
    const marke = new Date().toISOString().replace(/[:.]/g, '-');
    const ziel = `${pfad}.kaputt-${marke}`;
    fs.renameSync(pfad, ziel);
    return ziel;
  } catch {
    return undefined;
  }
}
