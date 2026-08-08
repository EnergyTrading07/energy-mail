import fs from 'node:fs';
import path from 'node:path';
import {
  leseSchluessel,
  pruefeKennwort,
  type SchluesselAngaben,
} from '@energy-mail/mail-core';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secretCrypto.js';
import { getDataDir } from './paths.js';

/**
 * Der Schlüsselbund: fremde öffentliche Schlüssel und die eigenen geheimen.
 *
 * Die öffentlichen sind unbedenklich - sie sind zur Weitergabe gemacht und liegen im
 * Klartext. Die geheimen sind das genaue Gegenteil, und sie liegen darum verschlüsselt,
 * über denselben Weg wie die Zugangsdaten der Konten: an das Windows-Benutzerkonto
 * gebunden. Wer die Datei kopiert, kann damit auf einem anderen Rechner nichts anfangen.
 *
 * Das Kennwort des Schlüssels selbst wird NICHT gespeichert. Es ist die letzte Schranke,
 * die auch dann noch hält, wenn jemand am angemeldeten Rechner sitzt - sie einzureißen,
 * um sich das Eintippen zu sparen, wäre der Sinn der Sache verfehlt.
 */

const getPfad = () => path.join(getDataDir(), 'schluesselbund.json');

interface AbgelegterSchluessel {
  fingerabdruck: string;
  /** Der Schlüssel in Textform. Bei geheimen verschlüsselt abgelegt. */
  armored: string;
  angaben: SchluesselAngaben;
  /** Ob "armored" verschlüsselt ist - gilt für geheime Schlüssel. */
  verschluesselt?: boolean;
  /** Für welches Konto dieser geheime Schlüssel gilt. */
  fuerKonto?: string;
  hinzugefuegtAm: string;
}

interface Ablage {
  schluessel: AbgelegterSchluessel[];
}

function lesen(): Ablage {
  try {
    const roh = JSON.parse(fs.readFileSync(getPfad(), 'utf-8')) as Ablage;
    if (Array.isArray(roh?.schluessel)) return roh;
  } catch {
    // Keine Datei oder beschädigt - dann eben ein leerer Bund.
  }
  return { schluessel: [] };
}

function schreiben(ablage: Ablage): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const ziel = getPfad();
  const zwischen = `${ziel}.neu`;
  // Erst daneben, dann umbenennen: ein halb geschriebener Schlüsselbund wäre schlimmer
  // als gar keiner.
  fs.writeFileSync(zwischen, JSON.stringify(ablage, null, 2), 'utf-8');
  fs.renameSync(zwischen, ziel);
}

export class SchluesselFehler extends Error {}

/** Was nach außen sichtbar ist - der geheime Teil verlässt den Server nie. */
export interface SchluesselEintrag {
  fingerabdruck: string;
  angaben: SchluesselAngaben;
  fuerKonto?: string;
  hinzugefuegtAm: string;
}

const nachAussen = (s: AbgelegterSchluessel): SchluesselEintrag => ({
  fingerabdruck: s.fingerabdruck,
  angaben: s.angaben,
  fuerKonto: s.fuerKonto,
  hinzugefuegtAm: s.hinzugefuegtAm,
});

export function alleSchluessel(): SchluesselEintrag[] {
  return lesen()
    .schluessel.map(nachAussen)
    .sort((a, b) => {
      // Eigene zuerst, danach nach Adresse - so steht oben, was einen selbst betrifft.
      if (a.angaben.geheim !== b.angaben.geheim) return a.angaben.geheim ? -1 : 1;
      return (a.angaben.adressen[0] ?? '').localeCompare(b.angaben.adressen[0] ?? '', 'de');
    });
}

/**
 * Nimmt einen oder mehrere Schlüssel auf.
 *
 * Ein Schlüssel, den es schon gibt, wird ersetzt statt verdoppelt: eine neuere Fassung
 * kann Unterschriften oder eine verlängerte Gültigkeit mitbringen. Erkannt wird er am
 * Fingerabdruck - der ist das einzige, worauf man sich verlassen kann.
 */
export async function fuegeSchluesselHinzu(
  armored: string,
  fuerKonto?: string,
): Promise<{ aufgenommen: SchluesselEintrag[]; ersetzt: number }> {
  const gelesen = await leseSchluessel(armored);
  const ablage = lesen();
  const aufgenommen: SchluesselEintrag[] = [];
  let ersetzt = 0;

  for (const { angaben, armored: text } of gelesen) {
    if (angaben.geheim && !isEncryptionAvailable()) {
      throw new SchluesselFehler(
        'Ohne eingerichtete Verschlüsselung würde der geheime Schlüssel im Klartext liegen - das wird abgelehnt.',
      );
    }

    const eintrag: AbgelegterSchluessel = {
      fingerabdruck: angaben.fingerabdruck,
      armored: angaben.geheim ? encryptSecret(text) : text,
      verschluesselt: angaben.geheim,
      angaben,
      fuerKonto: angaben.geheim ? fuerKonto : undefined,
      hinzugefuegtAm: new Date().toISOString(),
    };

    const stelle = ablage.schluessel.findIndex(
      (s) => s.fingerabdruck === angaben.fingerabdruck && s.angaben.geheim === angaben.geheim,
    );
    if (stelle >= 0) {
      // Die Zuordnung zum Konto bleibt, wenn beim Ersetzen keine angegeben wurde.
      eintrag.fuerKonto = eintrag.fuerKonto ?? ablage.schluessel[stelle]!.fuerKonto;
      ablage.schluessel[stelle] = eintrag;
      ersetzt++;
    } else {
      ablage.schluessel.push(eintrag);
    }
    aufgenommen.push(nachAussen(eintrag));
  }

  schreiben(ablage);
  return { aufgenommen, ersetzt };
}

export function entferneSchluessel(fingerabdruck: string, geheim: boolean): boolean {
  const ablage = lesen();
  const vorher = ablage.schluessel.length;
  ablage.schluessel = ablage.schluessel.filter(
    (s) => !(s.fingerabdruck === fingerabdruck && s.angaben.geheim === geheim),
  );
  if (ablage.schluessel.length === vorher) return false;
  schreiben(ablage);
  return true;
}

/** Der öffentliche Schlüssel eines Eintrags - zum Weitergeben. */
export function oeffentlicherText(fingerabdruck: string): string | null {
  const eintrag = lesen().schluessel.find(
    (s) => s.fingerabdruck === fingerabdruck && !s.angaben.geheim,
  );
  return eintrag?.armored ?? null;
}

/**
 * Sucht die öffentlichen Schlüssel zu einer Adresse.
 *
 * Mehrere sind möglich - jemand kann den Schlüssel gewechselt haben, ohne den alten
 * zurückzuziehen. Beim Prüfen einer Unterschrift werden alle in Betracht gezogen; beim
 * Verschlüsseln wird der jüngste gültige genommen.
 */
export function oeffentlicheFuer(adresse: string): { armored: string; angaben: SchluesselAngaben }[] {
  const wer = adresse.trim().toLowerCase();
  return lesen()
    .schluessel.filter((s) => !s.angaben.geheim && s.angaben.adressen.includes(wer))
    .map((s) => ({ armored: s.armored, angaben: s.angaben }));
}

/** Alle öffentlichen Schlüssel - zum Prüfen einer Unterschrift unbekannter Herkunft. */
export function alleOeffentlichen(): { armored: string; angaben: SchluesselAngaben }[] {
  return lesen()
    .schluessel.filter((s) => !s.angaben.geheim)
    .map((s) => ({ armored: s.armored, angaben: s.angaben }));
}

/**
 * Die geheimen Schlüssel eines Kontos, entschlüsselt.
 *
 * Bewusst keine Funktion, die "alle geheimen Schlüssel" herausgibt: gebraucht werden sie
 * immer nur für ein bestimmtes Konto, und je enger der Kreis, desto besser.
 */
export function geheimeFuer(accountId: string, adressen: readonly string[]): string[] {
  const gesuchte = adressen.map((a) => a.trim().toLowerCase());
  return lesen()
    .schluessel.filter(
      (s) =>
        s.angaben.geheim &&
        (s.fuerKonto === accountId || s.angaben.adressen.some((a) => gesuchte.includes(a))),
    )
    .map((s) => (s.verschluesselt ? decryptSecret(s.armored) : s.armored));
}

/** Ob für ein Konto überhaupt ein geheimer Schlüssel vorliegt. */
export function hatGeheimen(accountId: string, adressen: readonly string[]): boolean {
  return geheimeFuer(accountId, adressen).length > 0;
}

/**
 * Prüft ein Kennwort gegen die geheimen Schlüssel eines Kontos.
 *
 * Damit lässt sich vor dem Senden feststellen, ob das eingetippte Kennwort stimmt -
 * besser, als die Nachricht erst zu bauen und dann zu scheitern.
 */
export async function kennwortStimmt(
  accountId: string,
  adressen: readonly string[],
  kennwort: string,
): Promise<boolean> {
  for (const geheim of geheimeFuer(accountId, adressen)) {
    if (await pruefeKennwort(geheim, kennwort)) return true;
  }
  return false;
}
