import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';
import { createPassphraseKeyProvider, setKeyProvider, setzeUmschlag } from '../secretCrypto.js';
import {
  entschluessleFuerNutzer,
  verpackeNutzerschluessel,
  verschluessleFuerNutzer,
} from './schluesselHuelle.js';
import { findeNutzer, legeNutzerAn, nutzerAnzahl } from './nutzerStore.js';

/**
 * Was einmal beim Start passieren muss, damit Nutzer und Schlüssel zusammenpassen.
 */

/**
 * Hängt die Umschlagverschlüsselung ein.
 *
 * Ab hier gehen neue Geheimnisse durch den Schlüssel des jeweiligen Nutzers statt
 * unmittelbar durch den des Servers. Muss vor dem ersten Speichern laufen - danach wäre
 * es nicht falsch, aber die zuerst geschriebenen Datensätze trügen noch das alte Format.
 */
export function richteUmschlagEin(): void {
  setzeUmschlag({ hinein: verschluessleFuerNutzer, heraus: entschluessleFuerNutzer });
}

/**
 * Der Masterschlüssel des Servers, aus einer Datei.
 *
 * Für den Serverbetrieb - die Desktop-Hülle bringt ihren eigenen mit (DPAPI, an das
 * Windows-Benutzerkonto gebunden).
 *
 * Warum eine Datei und nicht eine Umgebungsvariable: Letztere steht unter Linux in
 * /proc/<pid>/environ, taucht in `docker inspect` auf und landet in Shell-Historien. Eine
 * Datei mit engen Rechten ist der einfachere und zugleich bessere Weg. Ein Schlüsseldienst
 * wäre der nächste Schritt, wenn der Dienst größer wird; die Stelle dafür ist genau hier.
 */
export function masterSchluesselAusDatei(pfad?: string): void {
  const datei = pfad ?? process.env.ENERGY_MAIL_MASTER_KEY_FILE ?? path.join(getWurzelDir(), 'master.key');

  fs.mkdirSync(path.dirname(datei), { recursive: true, mode: 0o700 });

  if (!fs.existsSync(datei)) {
    /*
     * Beim ersten Start selbst erzeugen.
     *
     * Ein Schlüssel, den ein Mensch sich ausdenkt, ist schwächer als 32 zufällige Bytes -
     * und einer, den man erst von Hand anlegen muss, führt dazu, dass jemand
     * "test123" einträgt, um weiterzukommen.
     */
    fs.writeFileSync(datei, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
    protokolliere(
      'warnung',
      'schluessel',
      `Masterschlüssel neu erzeugt: ${datei}. OHNE DIESE DATEI sind alle hinterlegten ` +
        'Zugangsdaten unwiederbringlich verloren - sie gehört in die Sicherung, und zwar ' +
        'getrennt von den Daten.',
    );
  }

  const roh = fs.readFileSync(datei, 'utf-8').trim();
  const schluessel = Buffer.from(roh, 'base64');
  if (schluessel.length !== 32) {
    throw new Error(
      `Der Masterschlüssel in ${datei} hat ${schluessel.length} statt 32 Bytes. ` +
        'Erwartet werden 32 zufällige Bytes in base64.',
    );
  }

  setKeyProvider({ name: `Masterschlüssel (${path.basename(datei)})`, getKey: () => schluessel });
}

/**
 * Sorgt dafür, dass es den Einplatznutzer gibt.
 *
 * Die Desktop-Hülle kennt keine Anmeldung: ein Rechner, ein Mensch. Trotzdem braucht auch
 * dieser eine Nutzer einen Eintrag - dort liegt sein Schlüssel, und ohne den ließe sich
 * kein Geheimnis mehr verschlüsseln.
 *
 * Das Kennwort ist hier ohne Bedeutung und wird zufällig gesetzt: Angemeldet wird sich in
 * der Hülle über das Zugangsgeheimnis des Prozesses, nicht über eine Eingabe. Ein
 * bekanntes Kennwort ("lokal"/"lokal") wäre ein offenes Tor, sobald derselbe Server
 * einmal aus dem Netz erreichbar ist.
 */
export function stelleEinplatznutzerSicher(id: string, email: string): void {
  if (findeNutzer(id)) return;

  legeNutzerAn(
    { id, email, kennwort: crypto.randomBytes(24).toString('base64') },
    verpackeNutzerschluessel,
  );
  protokolliere(
    'info',
    'nutzer',
    `Einplatznutzer "${id}" eingerichtet (${nutzerAnzahl()} Nutzer insgesamt).`,
  );
}
