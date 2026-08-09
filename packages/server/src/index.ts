import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './app.js';
import { getWurzelDir } from './paths.js';
import { createPassphraseKeyProvider, setKeyProvider } from './secretCrypto.js';
import { masterSchluesselAusDatei } from './nutzer/einrichten.js';
import { setzeZugangsgeheimnis } from './zugang.js';

/**
 * Der Masterschlüssel des Standalone-Servers.
 *
 * Kein Electron, also kein safeStorage - der Schlüssel muss von woanders kommen. Zwei
 * Wege, und der erste ist der vorgesehene:
 *
 *  1. Eine Datei mit 32 zufälligen Bytes (master.key im Datenordner, oder wohin
 *     ENERGY_MAIL_MASTER_KEY_FILE zeigt). Sie entsteht beim ersten Start von selbst.
 *
 *  2. ENERGY_MAIL_MASTER_KEY, ein Passwort, aus dem abgeleitet wird - der bisherige Weg,
 *     erhalten für bestehende Aufstellungen.
 *
 * Warum die Datei der bessere Weg ist: eine Umgebungsvariable steht unter Linux in
 * /proc/<pid>/environ, taucht in "docker inspect" auf und landet in Shell-Historien.
 * Und 32 zufällige Bytes sind stärker als jedes Passwort, das sich ein Mensch merkt.
 */
function configureEncryption(): void {
  const passphrase = process.env.ENERGY_MAIL_MASTER_KEY;

  if (passphrase) {
    const saltFile = path.join(getWurzelDir(), 'salt.bin');
    fs.mkdirSync(getWurzelDir(), { recursive: true, mode: 0o700 });
    if (!fs.existsSync(saltFile)) {
      fs.writeFileSync(saltFile, crypto.randomBytes(16), { mode: 0o600 });
    }
    setKeyProvider(createPassphraseKeyProvider(passphrase, fs.readFileSync(saltFile)));
    console.warn(
      '[energy-mail] Masterschlüssel aus ENERGY_MAIL_MASTER_KEY. Eine Schlüsseldatei ' +
        'wäre sicherer - die Variable ist in der Prozessumgebung ablesbar.',
    );
    return;
  }

  masterSchluesselAusDatei();
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
