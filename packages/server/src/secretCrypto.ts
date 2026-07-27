import crypto from 'node:crypto';

/**
 * Liefert den 32-Byte-Schlüssel, mit dem Zugangsdaten verschlüsselt werden. Woher der
 * kommt, entscheidet der jeweilige Prozess: die Desktop-App bindet ihn über Electrons
 * safeStorage an das Windows-Benutzerkonto, der Standalone-Server leitet ihn aus einem
 * Master-Passwort ab.
 */
export interface KeyProvider {
  /** Für Log- und Fehlermeldungen, damit erkennbar ist welcher Weg aktiv ist. */
  name: string;
  getKey: () => Buffer;
}

const PREFIX = 'v1';
const IV_BYTES = 12;

let provider: KeyProvider | null = null;
let cachedKey: Buffer | null = null;

export function setKeyProvider(next: KeyProvider): void {
  provider = next;
  cachedKey = null;
}

export function getKeyProviderName(): string | null {
  return provider?.name ?? null;
}

export function isEncryptionAvailable(): boolean {
  return provider !== null;
}

function requireKey(): Buffer {
  if (!provider) {
    throw new Error(
      'Keine Verschlüsselung eingerichtet - Zugangsdaten würden im Klartext liegen. ' +
        'In der Desktop-App passiert das automatisch; beim Standalone-Server muss ' +
        'ENERGY_MAIL_MASTER_KEY gesetzt sein.',
    );
  }
  if (!cachedKey) {
    const key = provider.getKey();
    if (key.length !== 32) {
      throw new Error(`Schlüssel von "${provider.name}" hat ${key.length} statt 32 Bytes.`);
    }
    cachedKey = key;
  }
  return cachedKey;
}

/** AES-256-GCM: verschlüsselt und authentifiziert zugleich (erkennt Manipulation). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    PREFIX,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Verschlüsselte Zugangsdaten haben ein unbekanntes Format.');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      requireKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Der häufigste Grund ist ein anderer Schlüssel, nicht ein defekter Datensatz.
    throw new Error(
      'Zugangsdaten konnten nicht entschlüsselt werden. Wurden sie unter einem anderen ' +
        'Windows-Benutzer angelegt oder fehlt die Schlüsseldatei (data/key.enc)?',
    );
  }
}

/** Leitet einen Schlüssel aus einem Master-Passwort ab (nur Standalone-Server). */
export function createPassphraseKeyProvider(passphrase: string, salt: Buffer): KeyProvider {
  return {
    name: 'Master-Passwort (ENERGY_MAIL_MASTER_KEY)',
    getKey: () => crypto.scryptSync(passphrase, salt, 32),
  };
}
