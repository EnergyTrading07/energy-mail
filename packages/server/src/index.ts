import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './app.js';
import { getDataDir } from './paths.js';
import { createPassphraseKeyProvider, setKeyProvider } from './secretCrypto.js';

/**
 * Der Standalone-Server hat kein Electron und damit keinen Zugriff auf die
 * Betriebssystem-Verschlüsselung. Er leitet den Schlüssel stattdessen aus
 * ENERGY_MAIL_MASTER_KEY ab. Das Salt wird einmalig erzeugt und abgelegt, damit
 * dasselbe Passwort über Neustarts hinweg denselben Schlüssel ergibt.
 *
 * Wichtig: Konten aus der Desktop-App sind hier nicht lesbar (anderer Schlüssel) -
 * beide Betriebsarten haben getrennte Kontenbestände.
 */
function configureEncryption(): void {
  const passphrase = process.env.ENERGY_MAIL_MASTER_KEY;
  if (!passphrase) {
    console.warn(
      '[energy-mail] ENERGY_MAIL_MASTER_KEY ist nicht gesetzt. Konten können weder ' +
        'gelesen noch angelegt werden. Für die Desktop-App ist das irrelevant - dort ' +
        'übernimmt Windows die Schlüsselverwaltung.',
    );
    return;
  }

  const saltFile = path.join(getDataDir(), 'salt.bin');
  fs.mkdirSync(getDataDir(), { recursive: true });
  if (!fs.existsSync(saltFile)) {
    fs.writeFileSync(saltFile, crypto.randomBytes(16));
  }
  setKeyProvider(createPassphraseKeyProvider(passphrase, fs.readFileSync(saltFile)));
}

configureEncryption();

const app = await buildServer();
const port = Number(process.env.PORT ?? 4000);

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => app.log.info(`Server läuft auf Port ${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
