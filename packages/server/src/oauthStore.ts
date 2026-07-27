import fs from 'node:fs';
import path from 'node:path';
import type { OAuthClientCredentials, OAuthProviderId } from '@energy-mail/mail-core';
import { getDataDir } from './paths.js';
import { decryptSecret, encryptSecret } from './secretCrypto.js';

const getStorePath = () => path.join(getDataDir(), 'oauth-clients.json');

interface StoredClient {
  clientId: string;
  /** Verschlüsselt, wie die Kontozugangsdaten - es ist ein Geheimnis. */
  clientSecretEncrypted?: string;
}

type StoreFile = Partial<Record<OAuthProviderId, StoredClient>>;

function read(): StoreFile {
  const storePath = getStorePath();
  if (!fs.existsSync(storePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8')) as StoreFile;
  } catch {
    return {};
  }
}

function write(data: StoreFile): void {
  fs.mkdirSync(getDataDir(), { recursive: true });
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8');
}

export function setOAuthClient(
  provider: OAuthProviderId,
  credentials: OAuthClientCredentials,
): void {
  const data = read();
  data[provider] = {
    clientId: credentials.clientId.trim(),
    clientSecretEncrypted: credentials.clientSecret?.trim()
      ? encryptSecret(credentials.clientSecret.trim())
      : undefined,
  };
  write(data);
}

export function removeOAuthClient(provider: OAuthProviderId): void {
  const data = read();
  delete data[provider];
  write(data);
}

export function getOAuthClient(provider: OAuthProviderId): OAuthClientCredentials | null {
  const entry = read()[provider];
  if (!entry) return null;
  return {
    clientId: entry.clientId,
    clientSecret: entry.clientSecretEncrypted ? decryptSecret(entry.clientSecretEncrypted) : undefined,
  };
}

/** Für die Oberfläche: welche Anbieter eingerichtet sind - ohne die Geheimnisse. */
export function listOAuthClients(): Record<string, { configured: boolean; clientId?: string }> {
  const data = read();
  const result: Record<string, { configured: boolean; clientId?: string }> = {};
  for (const provider of ['google', 'microsoft'] as OAuthProviderId[]) {
    const entry = data[provider];
    result[provider] = entry
      ? { configured: true, clientId: entry.clientId }
      : { configured: false };
  }
  return result;
}
