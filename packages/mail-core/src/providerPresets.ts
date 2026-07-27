/** Kennung des Anbieters - Grundlage für Farbgebung und anbietereigene Eigenheiten. */
export type ProviderId = 'google' | 'microsoft' | 'gmx' | 'webde' | 'icloud' | 'yahoo' | 'other';

export interface ProviderPreset {
  providerId: ProviderId;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  oauthProvider?: 'google' | 'microsoft';
}

const PRESETS_BY_DOMAIN: Record<string, ProviderPreset> = {
  'gmail.com': {
    providerId: 'google',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    oauthProvider: 'google',
  },
  'outlook.com': {
    providerId: 'microsoft',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    oauthProvider: 'microsoft',
  },
  'hotmail.com': {
    providerId: 'microsoft',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    oauthProvider: 'microsoft',
  },
  'live.com': {
    providerId: 'microsoft',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    oauthProvider: 'microsoft',
  },
  'gmx.net': {
    providerId: 'gmx',
    imapHost: 'imap.gmx.net',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'mail.gmx.net',
    smtpPort: 587,
    smtpSecure: false,
  },
  'gmx.de': {
    providerId: 'gmx',
    imapHost: 'imap.gmx.net',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'mail.gmx.net',
    smtpPort: 587,
    smtpSecure: false,
  },
  'web.de': {
    providerId: 'webde',
    imapHost: 'imap.web.de',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.web.de',
    smtpPort: 587,
    smtpSecure: false,
  },
  'icloud.com': {
    providerId: 'icloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecure: false,
  },
  'yahoo.com': {
    providerId: 'yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecure: true,
  },
};

export function getProviderPreset(email: string): ProviderPreset | null {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;
  return PRESETS_BY_DOMAIN[domain] ?? null;
}

/**
 * Kennung des Anbieters zu einer Adresse. Für Konten mit OAuth ist die Kennung
 * eindeutig; bei Passwort-Konten wird sie aus der Domain abgeleitet. Firmenadressen
 * hinter Microsoft 365 lassen sich so nicht erkennen - dann greift 'other'.
 */
export function getProviderId(email: string, oauthProvider?: 'google' | 'microsoft'): ProviderId {
  if (oauthProvider) return oauthProvider;
  return getProviderPreset(email)?.providerId ?? 'other';
}
