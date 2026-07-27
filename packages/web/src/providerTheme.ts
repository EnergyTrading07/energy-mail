import type { ProviderId } from '@energy-mail/mail-core';

/**
 * Farbgebung je Anbieter.
 *
 * Zweck ist nicht Dekoration: bei mehreren Konten zeigt die Farbe auf einen Blick, in
 * welchem man sich befindet - das verhindert, versehentlich aus der falschen Adresse zu
 * antworten. Verwendet werden die Hausfarben der Anbieter, aber bewusst keine Logos:
 * das sind geschützte Marken.
 */
export interface ProviderTheme {
  /** Akzentfarbe für Balken, Knöpfe und aktive Ordner. */
  accent: string;
  /** Kürzel im runden Kennzeichen neben dem Kontonamen. */
  initial: string;
  label: string;
}

const THEMES: Record<ProviderId, ProviderTheme> = {
  google: { accent: '#d93025', initial: 'G', label: 'Gmail' },
  microsoft: { accent: '#0f6cbd', initial: 'O', label: 'Outlook' },
  gmx: { accent: '#ff6a13', initial: 'X', label: 'GMX' },
  webde: { accent: '#e5b611', initial: 'W', label: 'Web.de' },
  icloud: { accent: '#3d8bd4', initial: 'i', label: 'iCloud' },
  yahoo: { accent: '#6001d2', initial: 'Y', label: 'Yahoo' },
  other: { accent: '#4a6cf7', initial: '@', label: 'IMAP' },
};

export function providerTheme(provider: ProviderId | undefined): ProviderTheme {
  return THEMES[provider ?? 'other'] ?? THEMES.other;
}
