import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { KeyProvider } from '@energy-mail/server/secrets';

/**
 * Erzeugt einmalig einen zufälligen 32-Byte-Schlüssel und legt ihn - mit Electrons
 * safeStorage verschlüsselt - als Datei ab. Unter Windows steckt dahinter DPAPI: der
 * Schlüssel lässt sich nur unter demselben Windows-Benutzerkonto wieder entschlüsseln.
 * Wer die Dateien kopiert (Backup, USB-Stick, anderer Rechner), kann damit nichts anfangen.
 */
export function createSafeStorageKeyProvider(dataDir: string): KeyProvider {
  const keyFile = path.join(dataDir, 'key.enc');

  return {
    name: 'Windows-Benutzerkonto (Electron safeStorage)',
    getKey: () => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'Das Betriebssystem stellt gerade keine Verschlüsselung bereit ' +
            '(safeStorage nicht verfügbar). Zugangsdaten werden nicht gespeichert.',
        );
      }

      if (fs.existsSync(keyFile)) {
        const decrypted = safeStorage.decryptString(fs.readFileSync(keyFile));
        return Buffer.from(decrypted, 'hex');
      }

      const key = crypto.randomBytes(32);
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(keyFile, safeStorage.encryptString(key.toString('hex')));
      return key;
    },
  };
}
