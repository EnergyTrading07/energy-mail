import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Rückfall: ein "data"-Ordner neben dem Servercode. Gilt für den Standalone-Server und
 * für den Betrieb aus dem Quellbaum.
 */
const STANDARD = path.join(__dirname, '..', 'data');

let gesetzt: string | null = null;

/**
 * Legt fest, wo Konten, Schlüssel und Kontakte liegen.
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

export function getDataDir(): string {
  return gesetzt ?? STANDARD;
}
