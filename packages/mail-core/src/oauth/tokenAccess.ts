import type { AccountConfig } from '../types.js';

/**
 * Beschafft ein gültiges Zugriffstoken für ein Konto.
 *
 * Die Erneuerung muss das Ergebnis dauerhaft speichern - das ist Aufgabe der Ebene, die
 * den Kontenspeicher kennt. Daher hinterlegt der Server hier eine Funktion, statt dass
 * mail-core selbst Dateien schreibt.
 */
export type AccessTokenResolver = (config: AccountConfig) => Promise<string>;

let resolver: AccessTokenResolver | null = null;

export function setAccessTokenResolver(next: AccessTokenResolver): void {
  resolver = next;
}

/**
 * Liefert das zu verwendende Zugriffstoken. Ohne hinterlegte Erneuerung wird das im
 * Konto gespeicherte Token genommen - das funktioniert, solange es nicht verfallen ist.
 */
export async function resolveAccessToken(config: AccountConfig): Promise<string> {
  if (config.auth.type !== 'oauth2') {
    throw new Error('Kein OAuth-Konto.');
  }
  if (resolver) {
    return resolver(config);
  }
  return config.auth.accessToken;
}

/** Etwas Vorlauf, damit ein Token nicht mitten in einer Verbindung verfällt. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export function isTokenExpired(expiresAt: number | undefined): boolean {
  if (!expiresAt) return false;
  return Date.now() + EXPIRY_MARGIN_MS >= expiresAt;
}
