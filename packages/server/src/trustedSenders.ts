import fs from 'node:fs';
import path from 'node:path';
import { getNutzerDir } from './paths.js';
import { istVerschluesselt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { decryptSecret } from './secretCrypto.js';

/**
 * Absender, deren entfernte Inhalte ohne Rückfrage geladen werden dürfen.
 *
 * Entfernte Bilder sind standardmäßig angehalten, weil sie dem Absender das Lesen
 * melden. Bei manchen Absendern will man das trotzdem nicht jedes Mal freigeben - beim
 * Newsletter, den man wirklich liest, oder bei der eigenen Firma. Diese Liste ist die
 * Ausnahme dazu.
 *
 * Je Konto getrennt: was im dienstlichen Postfach selbstverständlich ist, muss es im
 * privaten nicht sein.
 */

const getPfad = () => path.join(getNutzerDir(), 'vertraute-absender.json');

type Ablage = Record<string, string[]>;

function lesen(): Ablage {
  try {
    const datei = fs.readFileSync(getPfad(), 'utf-8');
    // Klartext aus der Zeit vor der Umstellung wird weiter gelesen - siehe
    // geschuetzteAblage.ts. Die Datei führt auf, mit wem jemand regelmäßig zu tun hat.
    return JSON.parse(istVerschluesselt(datei) ? decryptSecret(datei.trim()) : datei) as Ablage;
  } catch {
    // Fehlende oder beschädigte Datei heißt: niemandem vertraut. Das ist die sichere
    // Seite - im Zweifel wird gefragt statt geladen.
    return {};
  }
}

function schreiben(ablage: Ablage): void {
  fs.mkdirSync(getNutzerDir(), { recursive: true });
  schreibeGeschuetzt(getPfad(), JSON.stringify(ablage, null, 2));
}

const normalisiere = (adresse: string) => adresse.trim().toLowerCase();

export function vertrauteAbsender(accountId: string): string[] {
  return lesen()[accountId] ?? [];
}

/**
 * Gilt einem Absender vertraut? Neben der Adresse selbst zählt die Wohnadresse: wer
 * "newsletter@firma.de" freigibt, meint in aller Regel nicht ausgerechnet diese eine
 * Absenderkennung, sondern das Haus dahinter - und Versender wechseln die Kennung
 * ohnehin ständig.
 */
export function istVertraut(accountId: string, adresse: string): boolean {
  const gesucht = normalisiere(adresse);
  const haus = gesucht.split('@')[1];
  return vertrauteAbsender(accountId).some((eintrag) => {
    const e = normalisiere(eintrag);
    return e === gesucht || (e.startsWith('@') && haus === e.slice(1));
  });
}

export function vertrauenGeben(accountId: string, adresse: string): string[] {
  const wert = normalisiere(adresse);
  if (!wert) return vertrauteAbsender(accountId);

  const ablage = lesen();
  const bisher = ablage[accountId] ?? [];
  if (!bisher.some((e) => normalisiere(e) === wert)) {
    ablage[accountId] = [...bisher, wert];
    schreiben(ablage);
  }
  return ablage[accountId] ?? bisher;
}

export function vertrauenEntziehen(accountId: string, adresse: string): string[] {
  const wert = normalisiere(adresse);
  const ablage = lesen();
  const bisher = ablage[accountId] ?? [];
  ablage[accountId] = bisher.filter((e) => normalisiere(e) !== wert);
  schreiben(ablage);
  return ablage[accountId];
}

/** Beim Entfernen eines Kontos mit aufräumen. */
export function vertrauenVerwerfen(accountId: string): void {
  const ablage = lesen();
  if (!(accountId in ablage)) return;
  delete ablage[accountId];
  schreiben(ablage);
}
