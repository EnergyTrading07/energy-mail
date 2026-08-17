import crypto from 'node:crypto';
import { entschluesselMitMaster, verschluesselMitMaster } from '../secretCrypto.js';
import { aktuellerNutzer } from './kontext.js';
import { findeNutzer, setzeSchluesselGeneration } from './nutzerStore.js';

/**
 * Umschlagverschlüsselung: ein Schlüssel je Nutzer, verpackt mit dem des Servers.
 *
 *   Masterschlüssel (Datei / DPAPI, nie in einer Datenbank)
 *      └── verpackt →  Nutzerschlüssel (32 zufällige Bytes, je Nutzer einer)
 *                          └── verschlüsselt →  Postfachkennwörter, OAuth-Marken, PGP
 *
 * Warum nicht einfach alles mit dem Masterschlüssel, wie bisher? Drei Gründe, und alle
 * drei treffen einen Dienst mit mehreren Nutzern:
 *
 *  - Schlüsselwechsel: den Master zu tauschen heißt, N Nutzerschlüssel neu zu verpacken -
 *    nicht sämtliche Geheimnisse aller Nutzer neu zu verschlüsseln.
 *  - Löschen, das wirkt: den Nutzerschlüssel zu vernichten macht dessen Daten unlesbar,
 *    auch in jeder Sicherung. Ohne das müsste man Sicherungen durchsuchen, um ein
 *    Löschverlangen zu erfüllen.
 *  - Schadensbegrenzung: ein abhandengekommener Nutzerschlüssel ist ein Nutzer, nicht alle.
 */

const IV_BYTES = 12;

/**
 * Die entpackten Nutzerschlüssel dieses Prozesses.
 *
 * Gedeckelt, damit der Speicher bei vielen Nutzern nicht unbegrenzt wächst. Ein
 * herausgefallener Schlüssel wird beim nächsten Zugriff neu entpackt - das kostet eine
 * Entschlüsselung, sonst nichts.
 */
const entpackt = new Map<string, Map<string, Buffer>>();
const MAX_GEMERKTE_NUTZER = 200;

/** Verpackt einen frischen Nutzerschlüssel - beim Anlegen eines Nutzers. */
export function verpackeNutzerschluessel(roh: Buffer): string {
  return verschluesselMitMaster(roh.toString('base64'));
}

/** Nimmt einen Nutzer aus dem Zwischenspeicher - nach Löschen oder Schlüsselwechsel. */
export function vergissNutzerschluessel(id: string): void {
  entpackt.delete(id);
}

function schluesselFuer(nutzerId: string, generation: string): Buffer {
  const gemerkt = entpackt.get(nutzerId)?.get(generation);
  if (gemerkt) return gemerkt;

  const nutzer = findeNutzer(nutzerId);
  if (!nutzer) {
    throw new Error(
      `Zu "${nutzerId}" gibt es keinen Eintrag in nutzer.json - seine Geheimnisse sind ` +
        'ohne den dort hinterlegten Schlüssel nicht lesbar.',
    );
  }
  const verpackt = nutzer.schluessel[generation];
  if (!verpackt) {
    throw new Error(
      `Schlüsselgeneration ${generation} fehlt bei "${nutzerId}". Damit verschlüsselte ` +
        'Geheimnisse lassen sich nicht mehr öffnen.',
    );
  }

  const roh = Buffer.from(entschluesselMitMaster(verpackt), 'base64');
  if (roh.length !== 32) {
    throw new Error(`Der Schlüssel von "${nutzerId}" hat ${roh.length} statt 32 Bytes.`);
  }

  if (entpackt.size >= MAX_GEMERKTE_NUTZER && !entpackt.has(nutzerId)) {
    const aeltester = entpackt.keys().next().value;
    if (aeltester !== undefined) entpackt.delete(aeltester);
  }
  const je = entpackt.get(nutzerId) ?? new Map<string, Buffer>();
  je.set(generation, roh);
  entpackt.set(nutzerId, je);
  return roh;
}

/**
 * Verschlüsselt ein Geheimnis mit dem Schlüssel des aktuellen Nutzers.
 *
 * Format: v2.<generation>.<iv>.<tag>.<daten>
 *
 * Die Generation steht mit drin, damit sich der Schlüssel eines Nutzers wechseln lässt,
 * ohne im selben Augenblick alles neu verschlüsseln zu müssen: Neues bekommt die neue
 * Generation, Altes bleibt mit seiner lesbar, bis ein Umschlüsseln durchgelaufen ist.
 */
export function verschluessleFuerNutzer(klartext: string): string {
  const nutzerId = aktuellerNutzer();
  const nutzer = findeNutzer(nutzerId);
  if (!nutzer) {
    throw new Error(`Zu "${nutzerId}" gibt es keinen Eintrag in nutzer.json.`);
  }
  const generation = nutzer.aktuelleGeneration;
  const schluessel = schluesselFuer(nutzerId, generation);

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', schluessel, iv);
  const daten = Buffer.concat([cipher.update(klartext, 'utf8'), cipher.final()]);
  return [
    'v2',
    generation,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    daten.toString('base64'),
  ].join('.');
}

/** Entschlüsselt ein v2-Geheimnis des aktuellen Nutzers. */
export function entschluessleFuerNutzer(nutzlast: string): string {
  const [version, generation, ivB64, tagB64, datenB64] = nutzlast.split('.');
  if (version !== 'v2' || !generation || !ivB64 || !tagB64 || !datenB64) {
    throw new Error('Verschlüsselte Daten haben ein unbekanntes Format.');
  }
  const schluessel = schluesselFuer(aktuellerNutzer(), generation);
  const decipher = crypto.createDecipheriv('aes-256-gcm', schluessel, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(datenB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Wechselt den Schlüssel eines Nutzers - der Vorgang, für den es die Generationen gibt.
 *
 * ## Warum das hier bisher fehlte
 *
 * Der Eintrag trägt seit jeher `schluessel[generation]` und `aktuelleGeneration`, das
 * Format der Geheimnisse führt die Generation mit, und `setzeSchluesselGeneration` stand
 * geschrieben und dokumentiert im Nutzerspeicher. Nur rief es niemand: Es gab keinen Weg,
 * einen Schlüssel tatsächlich zu wechseln. Die ganze Mehrgenerationen-Struktur kostete
 * Aufwand in jedem Lesepfad, ohne dass der Vorgang existierte, für den sie gebaut wurde -
 * und ein abhandengekommener Nutzerschlüssel war nicht austauschbar.
 *
 * ## Was hier geschieht, und was ausdrücklich nicht
 *
 * Angelegt wird eine neue Generation; ab dem nächsten Schreibvorgang trägt jedes Geheimnis
 * sie. Die alten Generationen BLEIBEN stehen, und das ist keine Nachlässigkeit, sondern
 * die Bauart: Bestehende Geheimnisse tragen ihre Generation im Format und bleiben damit
 * lesbar. Sie wandern nach und nach mit, sobald ihr Datensatz ohnehin neu geschrieben wird.
 *
 * Ein Zwangsdurchlauf über alle Dateien wäre ein Vorgang, bei dem viel schiefgehen kann,
 * für einen Gewinn, der sich auch von selbst einstellt - dieselbe Überlegung, die in
 * secretCrypto.ts schon für den Übergang von v1 auf v2 steht.
 *
 * Wer also einen kompromittierten Schlüssel loswerden will, wechselt ihn hier und muss die
 * alte Generation danach getrennt austragen, wenn nichts mehr auf sie zeigt. Das ist die
 * ehrliche Auskunft und steht so auch in der Meldung des Werkzeugs.
 */
export function wechsleNutzerschluessel(nutzerId: string): { generation: string } {
  const nutzer = findeNutzer(nutzerId);
  if (!nutzer) throw new Error(`Zu "${nutzerId}" gibt es keinen Eintrag in nutzer.json.`);

  /*
   * Die Generation ist eine fortlaufende Zahl als Text.
   *
   * Aus den vorhandenen abgeleitet und nicht aus `aktuelleGeneration` hochgezählt: Stünde
   * dort nach einem Rückspielen einer Sicherung eine kleinere Zahl, überschriebe der
   * nächste Wechsel eine bestehende Generation - und damit den Schlüssel, mit dem
   * vorhandene Geheimnisse verschlüsselt sind.
   */
  const hoechste = Object.keys(nutzer.schluessel)
    .map((g) => Number(g))
    .filter((n) => Number.isFinite(n))
    .reduce((a, b) => Math.max(a, b), 0);
  const generation = String(hoechste + 1);

  setzeSchluesselGeneration(nutzerId, generation, verpackeNutzerschluessel(crypto.randomBytes(32)));
  // Der Zwischenspeicher hält die entpackten Schlüssel je Generation - nach dem Wechsel
  // muss er neu einlesen, sonst verschlüsselt dieser Prozess weiter mit dem alten.
  vergissNutzerschluessel(nutzerId);
  return { generation };
}
