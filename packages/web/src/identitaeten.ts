import type { Identitaet } from '@energy-mail/mail-core';
import { t } from './sprache.js';

/**
 * Welche der eigenen Adressen beim Antworten die richtige ist.
 *
 * Der Alltagsfall, um den es geht: Post kommt an "info@meine-firma.de", man antwortet -
 * und die Antwort geht unter der privaten Adresse hinaus. Der Empfänger sieht eine ihm
 * unbekannte Adresse, und die nächste Antwort landet wieder woanders. Deshalb wird
 * genommen, wohin geschrieben wurde.
 */

export interface Absender {
  /** Leer bei der Adresse des Kontos selbst - sie ist keine zusätzliche Identität. */
  id: string | null;
  email: string;
  displayName?: string;
  signature?: string;
}

const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Alle Absender eines Kontos, das Konto selbst zuerst. Die Reihenfolge ist die der
 * Auswahlliste beim Verfassen.
 */
export function alleAbsender(konto: {
  email: string;
  displayName?: string;
  signature?: string;
  identitaeten?: Identitaet[];
}): Absender[] {
  return [
    { id: null, email: konto.email, displayName: konto.displayName, signature: konto.signature },
    ...(konto.identitaeten ?? []).map((i) => ({
      id: i.id,
      email: i.email,
      // Leer heißt "wie das Konto" - nicht "ohne Namen".
      displayName: i.displayName || konto.displayName,
      signature: i.signature || konto.signature,
    })),
  ];
}

/**
 * Sucht die Adresse heraus, an die eine Nachricht ging.
 *
 * Geprüft wird in der Reihenfolge, in der ein Mensch es täte: erst das direkte Feld
 * "An", dann "Kopie", zuletzt der Empfänger, den der Server beim Zustellen eingetragen
 * hat (Delivered-To). Das letzte hilft bei Weiterleitungen, wo die eigene Adresse in
 * keinem sichtbaren Feld steht.
 */
export function absenderFuerAntwort(
  konto: {
    email: string;
    displayName?: string;
    signature?: string;
    identitaeten?: Identitaet[];
  },
  nachricht: {
    to?: { address: string }[];
    cc?: { address: string }[];
    zugestelltAn?: string[];
  },
): Absender {
  const moegliche = alleAbsender(konto);
  const felder = [
    ...(nachricht.to ?? []).map((a) => a.address),
    ...(nachricht.cc ?? []).map((a) => a.address),
    ...(nachricht.zugestelltAn ?? []),
  ];

  for (const adresse of felder) {
    const treffer = moegliche.find((a) => gleich(a.email, adresse));
    if (treffer) return treffer;
  }

  // Nichts davon war eine eigene Adresse - dann bleibt die des Kontos.
  return moegliche[0]!;
}

/**
 * Prüft eine neu eingetragene Adresse. Gibt eine Beanstandung zurück oder null.
 *
 * Bewusst streng bei Dubletten: zwei gleiche Absender in der Auswahlliste wären nicht
 * auseinanderzuhalten, und beim Antworten entschiede der Zufall.
 */
export function pruefeIdentitaet(
  konto: { email: string; identitaeten?: Identitaet[] },
  email: string,
  ausserId?: string,
): string | null {
  const wert = email.trim();
  if (!wert) return t('Bitte eine Adresse eintragen.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(wert)) return t('Das sieht nicht nach einer Adresse aus.');
  if (gleich(wert, konto.email)) return t('Das ist bereits die Adresse des Kontos.');
  if ((konto.identitaeten ?? []).some((i) => i.id !== ausserId && gleich(i.email, wert))) {
    return t('Diese Adresse ist schon eingetragen.');
  }
  return null;
}
