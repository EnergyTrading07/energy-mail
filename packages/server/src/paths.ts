import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aktuellerNutzer, pruefeNutzerId } from './nutzer/kontext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rückfall: ein "data"-Ordner neben dem Servercode. Gilt für den Standalone-Server und
 * für den Betrieb aus dem Quellbaum.
 */
const STANDARD = path.join(__dirname, '..', 'data');

let gesetzt: string | null = null;

/**
 * Legt fest, wo alles liegt - die Wurzel, nicht der Ordner eines Nutzers.
 *
 * Die Desktop-App ruft das vor dem Serverstart mit ihrem Benutzerordner auf. Nötig,
 * sobald die Anwendung paketiert ist: der Programmcode liegt dann in einem
 * schreibgeschützten Archiv (app.asar), neben dem sich nichts anlegen ließe. Ein Konto
 * hinzuzufügen würde scheitern - und zwar erst beim Speichern, nach erfolgreicher
 * Verbindungsprüfung.
 */
export function setDataDir(dir: string): void {
  gesetzt = dir;
}

/**
 * Die Wurzel. Hier liegt, was allen gemeinsam ist und keinem einzelnen gehört:
 * die Schlüsseldatei, das Salt des Masterschlüssels und das Protokoll.
 *
 * Ausdrücklich NICHT für Nutzerdaten. Wer Konten, Kontakte, Regeln oder die Ablage
 * ablegen will, nimmt getNutzerDir() - sonst landen die Daten aller Nutzer im selben
 * Topf, und genau das soll die Trennung verhindern.
 */
export function getWurzelDir(): string {
  return gesetzt ?? STANDARD;
}

/**
 * Der Ordner des Nutzers, für den gerade gearbeitet wird.
 *
 * Wirft, wenn kein Nutzerkontext gesetzt ist - siehe nutzer/kontext.ts. Das ist die
 * tragende Sicherheitseigenschaft der ganzen Umstellung: eine Stelle, die den Kontext zu
 * setzen vergisst, bekommt einen lauten Fehler statt fremder Post.
 *
 * ---
 *
 * Hier hieß die Funktion einmal getDataDir() und gab die Wurzel zurück. Der Name ist
 * bewusst weg statt umgedeutet: hätte ich ihn behalten und nur die Bedeutung geändert,
 * wäre jede bestehende Aufrufstelle stillschweigend zu einer Nutzerstelle geworden - und
 * die drei, die tatsächlich die Wurzel meinen (Schlüssel, Salt, Protokoll), hätten
 * angefangen, ihre Dateien in den Ordner irgendeines Nutzers zu schreiben. Zwei
 * verschiedene Namen zwingen jede Stelle zu einer bewussten Entscheidung.
 */
export function getNutzerDir(): string {
  return path.join(getWurzelDir(), 'nutzer', aktuellerNutzer());
}

/**
 * Der Ordner eines bestimmten Nutzers, unabhängig vom Kontext.
 *
 * Für Verwaltungsaufgaben, die über Nutzer hinweggehen: Umzug der Bestandsdaten, Löschen
 * eines Nutzers, Sicherungen. Im laufenden Betrieb ist getNutzerDir() richtig.
 */
export function getNutzerDirFuer(id: string): string {
  return path.join(getWurzelDir(), 'nutzer', pruefeNutzerId(id));
}
