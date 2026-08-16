import crypto from 'node:crypto';
import { entschluesselMitMaster, verschluesselMitMaster } from '../secretCrypto.js';
import { aktuellerNutzer } from './kontext.js';
import { findeNutzer } from './nutzerStore.js';

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

/** Ob ein Nutzer überhaupt einen Schlüssel hat - für den Einplatz-Umstieg. */
export function hatNutzerschluessel(nutzerId: string): boolean {
  const nutzer = findeNutzer(nutzerId);
  return Boolean(nutzer && nutzer.schluessel[nutzer.aktuelleGeneration]);
}
