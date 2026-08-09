import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './app.js';
import { getDataDir } from './paths.js';
import { createPassphraseKeyProvider, setKeyProvider } from './secretCrypto.js';
import { setzeZugangsgeheimnis } from './zugang.js';

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

/**
 * Der Auffangbehälter des Standalone-Servers.
 *
 * Die Desktop-Hülle hat beides (diagnose.ts) und deckt damit den eingebetteten Server
 * mit ab - der Standalone-Betrieb hatte es nicht. Eine Ausnahme in einem Zeitgeber
 * (Wiedervorlage, Sendewarteschlange, Verbindungsaufräumer) beendete den Prozess
 * kommentarlos: alle Clients verloren die Verbindung, und niemand erfuhr warum.
 */
function richteAuffangbehaelterEin(): void {
  process.on('uncaughtException', (err) => {
    console.error('[energy-mail] Unbehandelter Fehler:', err);
    // Weiterlaufen wäre schlimmer als beenden: der Zustand ist ab hier unbestimmt, und
    // in diesem Prozess hängen Schreibvorgänge auf Konten, Adressbuch und Ablage.
    process.exit(1);
  });
  process.on('unhandledRejection', (grund) => {
    console.error('[energy-mail] Unbehandelte Ablehnung:', grund);
    process.exit(1);
  });
}

richteAuffangbehaelterEin();
configureEncryption();

const port = Number(process.env.PORT ?? 4000);

/**
 * Voreinstellung 127.0.0.1 statt 0.0.0.0.
 *
 * Vorher lauschte der Standalone-Server auf allen Netzwerkschnittstellen. Zusammen mit
 * der fehlenden Anmeldung hieß das: im Hotel-WLAN, im Büro oder hinter einer
 * Portfreigabe konnte jeder im selben Netz das gesamte Postfach lesen, löschen und in
 * fremdem Namen versenden. Der Desktop-Pfad band immer schon auf 127.0.0.1 - die
 * Standalone-Variante war der Ausreißer.
 *
 * Wer bewusst aus dem Netz zugreifen will, setzt ENERGY_MAIL_HOST - und sollte dann
 * zwingend auch ENERGY_MAIL_ZUGANG setzen (siehe unten).
 */
const host = process.env.ENERGY_MAIL_HOST ?? '127.0.0.1';

/**
 * Im Standalone-Betrieb wird das Zugangsgeheimnis von außen vorgegeben, damit der
 * Client es kennen kann. Ohne Angabe bleibt die Prüfung aus - vertretbar, solange nur
 * auf 127.0.0.1 gelauscht wird, und genau dann warnen wir, wenn das nicht der Fall ist.
 */
if (process.env.ENERGY_MAIL_ZUGANG) {
  setzeZugangsgeheimnis(process.env.ENERGY_MAIL_ZUGANG);
} else if (host !== '127.0.0.1' && host !== 'localhost') {
  console.warn(
    '[energy-mail] ENERGY_MAIL_HOST zeigt nach außen, aber ENERGY_MAIL_ZUGANG ist nicht ' +
      'gesetzt. Der Server wäre damit für jeden im Netz ohne Anmeldung erreichbar.',
  );
  process.exit(1);
}

const app = await buildServer({ port });

app
  .listen({ port, host })
  .then(() => app.log.info(`Server läuft auf ${host}:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
