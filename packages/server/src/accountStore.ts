import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountAuth, AccountConfig } from '@energy-mail/mail-core';
import { getProviderPreset, type GefundeneEinstellungen } from '@energy-mail/mail-core';
import { getDataDir } from './paths.js';
import { decryptSecret, encryptSecret } from './secretCrypto.js';

// Bei jedem Zugriff neu gebildet statt einmalig beim Laden: der Ablageort wird von der
// Desktop-App beim Start gesetzt, und die Reihenfolge der Modulladung ist nichts, worauf
// man sich verlassen sollte.
const getStorePath = () => path.join(getDataDir(), 'accounts.json');

/**
 * Auf der Platte liegt statt des Passworts bzw. der OAuth-Token nur ein verschlüsselter
 * Block. Entschlüsselt wird erst beim Lesen, sodass Klartext-Zugangsdaten ausschließlich
 * im Arbeitsspeicher existieren.
 */
interface StoredAuth {
  type: 'password' | 'oauth2';
  user: string;
  provider?: 'google' | 'microsoft';
  expiresAt?: number;
  /** Verschlüsseltes JSON der geheimen Felder (pass bzw. accessToken/refreshToken). */
  secret: string;
}

type StoredAccount = Omit<AccountConfig, 'auth'> & { auth: StoredAuth | AccountAuth };

function encryptAuth(auth: AccountAuth): StoredAuth {
  if (auth.type === 'password') {
    return {
      type: 'password',
      user: auth.user,
      secret: encryptSecret(JSON.stringify({ pass: auth.pass })),
    };
  }
  return {
    type: 'oauth2',
    user: auth.user,
    provider: auth.provider,
    expiresAt: auth.expiresAt,
    secret: encryptSecret(
      JSON.stringify({ accessToken: auth.accessToken, refreshToken: auth.refreshToken }),
    ),
  };
}

function decryptAuth(stored: StoredAuth | AccountAuth): AccountAuth {
  // Altbestand aus der Zeit vor der Verschlüsselung: Felder liegen direkt im Klartext.
  if (!('secret' in stored)) return stored;

  const secrets = JSON.parse(decryptSecret(stored.secret)) as Record<string, string | undefined>;
  if (stored.type === 'password') {
    return { type: 'password', user: stored.user, pass: secrets.pass ?? '' };
  }
  return {
    type: 'oauth2',
    user: stored.user,
    provider: stored.provider ?? 'google',
    accessToken: secrets.accessToken ?? '',
    refreshToken: secrets.refreshToken,
    expiresAt: stored.expiresAt,
  };
}

function isPlaintext(auth: StoredAuth | AccountAuth): boolean {
  return !('secret' in auth);
}

function readAccounts(): AccountConfig[] {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) return [];
  const stored = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as StoredAccount[];

  // Einmalige Migration: bestehende Klartext-Konten werden beim ersten Lesen
  // verschlüsselt zurückgeschrieben.
  if (stored.some((account) => isPlaintext(account.auth))) {
    const migrated = stored.map((account) => ({ ...account, auth: decryptAuth(account.auth) }));
    writeAccounts(migrated);
    return migrated;
  }

  return stored.map((account) => ({ ...account, auth: decryptAuth(account.auth) }));
}

function writeAccounts(accounts: AccountConfig[]): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  const stored: StoredAccount[] = accounts.map((account) => ({
    ...account,
    auth: encryptAuth(account.auth),
  }));
  fs.writeFileSync(getStorePath(), JSON.stringify(stored, null, 2), 'utf-8');
}

type ConnectionOverrides = Partial<
  Pick<AccountConfig, 'imapHost' | 'imapPort' | 'imapSecure' | 'smtpHost' | 'smtpPort' | 'smtpSecure'>
>;

export interface CreatePasswordAccountInput {
  email: string;
  password: string;
  overrides?: ConnectionOverrides;
  /**
   * Was die Serversuche ermittelt hat. Der Aufrufer besorgt es, weil die Suche ins Netz
   * greift und diese Funktion ohne Wartezeit auskommen soll.
   */
  gefunden?: GefundeneEinstellungen | null;
}

/**
 * Baut die Kontokonfiguration, ohne sie zu speichern. Getrennt vom Speichern, damit der
 * Aufrufer die Verbindung erst prüfen kann.
 *
 * Drei Quellen in dieser Reihenfolge: was der Nutzer selbst eingetragen hat, dann was
 * die Serversuche ergeben hat, zuletzt die eingebauten Voreinstellungen. Von Hand
 * Eingetragenes gewinnt immer - wer die Felder ausfüllt, weiß in der Regel, warum.
 */
export function buildPasswordAccount(input: CreatePasswordAccountInput): AccountConfig {
  const preset = getProviderPreset(input.email);
  const gefunden = input.gefunden;

  const imapHost = input.overrides?.imapHost ?? gefunden?.imapHost ?? preset?.imapHost;
  const smtpHost = input.overrides?.smtpHost ?? gefunden?.smtpHost ?? preset?.smtpHost;
  if (!imapHost || !smtpHost) {
    throw new Error(
      `Für "${input.email}" ließen sich die Serveradressen nicht ermitteln. ` +
        'Bitte IMAP- und SMTP-Server von Hand angeben.',
    );
  }

  /**
   * Manche Anbieter wollen als Benutzernamen nur den Teil vor dem Klammeraffen. Die
   * Serversuche sagt das mit; ohne diese Angabe ist die ganze Adresse das Übliche.
   */
  const benutzer =
    gefunden?.benutzername === 'ortsteil' ? (input.email.split('@')[0] ?? input.email) : input.email;

  return {
    id: randomUUID(),
    email: input.email,
    imapHost,
    imapPort: input.overrides?.imapPort ?? gefunden?.imapPort ?? preset?.imapPort ?? 993,
    imapSecure: input.overrides?.imapSecure ?? gefunden?.imapSecure ?? preset?.imapSecure ?? true,
    smtpHost,
    smtpPort: input.overrides?.smtpPort ?? gefunden?.smtpPort ?? preset?.smtpPort ?? 587,
    smtpSecure:
      input.overrides?.smtpSecure ?? gefunden?.smtpSecure ?? preset?.smtpSecure ?? false,
    auth: { type: 'password', user: benutzer, pass: input.password } satisfies AccountAuth,
  };
}

export function saveAccount(config: AccountConfig): void {
  const accounts = readAccounts();
  accounts.push(config);
  writeAccounts(accounts);
}

export function deleteAccount(id: string): boolean {
  const accounts = readAccounts();
  const remaining = accounts.filter((account) => account.id !== id);
  if (remaining.length === accounts.length) return false;
  writeAccounts(remaining);
  return true;
}

export function listAccounts(): AccountConfig[] {
  return readAccounts();
}

export function getAccount(id: string): AccountConfig | null {
  return readAccounts().find((account) => account.id === id) ?? null;
}

/**
 * Speichert erneuerte OAuth-Token; die übrigen Kontoangaben bleiben unberührt. Eine
 * geglückte Erneuerung hebt zugleich die Kennzeichnung "Anmeldung abgelaufen" auf.
 */
export function updateAccountAuth(id: string, auth: AccountAuth): void {
  const accounts = readAccounts();
  const account = accounts.find((entry) => entry.id === id);
  if (!account) return;
  account.auth = auth;
  account.authExpired = undefined;
  writeAccounts(accounts);
}

/**
 * Hält fest, dass die Anmeldung nicht mehr anerkannt wird. Wird beim Schreiben geprüft,
 * ob sich überhaupt etwas ändert: der Fehler tritt bei jedem Abrufversuch erneut auf,
 * und ohne diese Prüfung würde die Kontendatei im Sekundentakt neu geschrieben.
 */
export function setAuthExpired(id: string, expired: boolean): void {
  const accounts = readAccounts();
  const account = accounts.find((entry) => entry.id === id);
  if (!account) return;
  if (Boolean(account.authExpired) === expired) return;
  account.authExpired = expired || undefined;
  writeAccounts(accounts);
}

export interface CreateOAuthAccountInput {
  email: string;
  provider: 'google' | 'microsoft';
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  overrides?: ConnectionOverrides;
}

/** Legt ein Konto an, dessen Anmeldung über OAuth läuft. */
export function buildOAuthAccount(input: CreateOAuthAccountInput): AccountConfig {
  const preset = getProviderPreset(input.email);
  // Ohne Preset für die Domain (z.B. Firmenadresse bei Microsoft 365) die Standardserver
  // des Anbieters verwenden.
  const standard =
    input.provider === 'google'
      ? { imapHost: 'imap.gmail.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.gmail.com', smtpPort: 465, smtpSecure: true }
      : { imapHost: 'outlook.office365.com', imapPort: 993, imapSecure: true, smtpHost: 'smtp.office365.com', smtpPort: 587, smtpSecure: false };

  return {
    id: randomUUID(),
    email: input.email,
    imapHost: input.overrides?.imapHost ?? preset?.imapHost ?? standard.imapHost,
    imapPort: input.overrides?.imapPort ?? preset?.imapPort ?? standard.imapPort,
    imapSecure: input.overrides?.imapSecure ?? preset?.imapSecure ?? standard.imapSecure,
    smtpHost: input.overrides?.smtpHost ?? preset?.smtpHost ?? standard.smtpHost,
    smtpPort: input.overrides?.smtpPort ?? preset?.smtpPort ?? standard.smtpPort,
    smtpSecure: input.overrides?.smtpSecure ?? preset?.smtpSecure ?? standard.smtpSecure,
    auth: {
      type: 'oauth2',
      provider: input.provider,
      user: input.email,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      expiresAt: input.expiresAt,
    } satisfies AccountAuth,
  };
}

export type AccountSettings = Pick<AccountConfig, 'displayName' | 'signature'>;

/** Ändert die Einstellungen eines Kontos; Zugangsdaten bleiben unangetastet. */
export function updateAccountSettings(id: string, settings: AccountSettings): AccountConfig | null {
  const accounts = readAccounts();
  const account = accounts.find((entry) => entry.id === id);
  if (!account) return null;

  account.displayName = settings.displayName?.trim() || undefined;
  account.signature = settings.signature?.trim() || undefined;
  writeAccounts(accounts);
  return account;
}
