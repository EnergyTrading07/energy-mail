import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beschreibeZertifikate, nutzeSystemZertifikate } from '@energy-mail/mail-core';
import { buildServer } from './app.js';
import { getWurzelDir, setDataDir } from './paths.js';
import {
  SCRYPT_ALTBESTAND,
  SCRYPT_HEUTE,
  createPassphraseKeyProvider,
  setKeyProvider,
  type ScryptParameter,
} from './secretCrypto.js';
import { masterSchluesselAusDatei } from './nutzer/einrichten.js';
import { setzeOeffentlicheAdresse, setzeZugangsgeheimnis } from './zugang.js';

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
    const wurzel = getWurzelDir();
    const saltFile = path.join(wurzel, 'salt.bin');
    /**
     * Womit aus dem Passwort der Schlüssel gerechnet wird.
     *
     * Diese Datei ist der Grund, warum sich die Parameter überhaupt anheben lassen. Aus
     * dem Passwort entsteht der Schlüssel, mit dem sämtliche Zugangsdaten verschlüsselt
     * sind; andere Parameter ergeben einen anderen Schlüssel. Sie einfach zu erhöhen
     * hiesse, jede bestehende Aufstellung von ihren Postfächern abzuschneiden - und
     * zwar beim Start nach einer Aktualisierung, ohne erkennbaren Grund.
     *
     * Also steht hier, was für DIESE Aufstellung gilt. Wer sie neu anlegt, bekommt die
     * heutigen Werte; wer schon ein salt.bin ohne diese Datei hat, behält die alten.
     */
    const kdfFile = path.join(wurzel, 'master-kdf.json');
    fs.mkdirSync(wurzel, { recursive: true, mode: 0o700 });

    const bestand = fs.existsSync(saltFile);
    if (!bestand) {
      fs.writeFileSync(saltFile, crypto.randomBytes(16), { mode: 0o600 });
      fs.writeFileSync(kdfFile, JSON.stringify(SCRYPT_HEUTE, null, 2), { mode: 0o600 });
    }

    let parameter = SCRYPT_ALTBESTAND;
    if (fs.existsSync(kdfFile)) {
      try {
        const gelesen = JSON.parse(fs.readFileSync(kdfFile, 'utf-8')) as Partial<ScryptParameter>;
        if (
          Number.isInteger(gelesen.N) &&
          Number.isInteger(gelesen.r) &&
          Number.isInteger(gelesen.p)
        ) {
          parameter = gelesen as ScryptParameter;
        } else {
          console.error(`[energy-mail] ${kdfFile} ist unbrauchbar - Abbruch statt Rateversuch.`);
          process.exit(1);
        }
      } catch (err) {
        /*
         * Nicht auf den Altbestand zurückfallen.
         *
         * Ein unlesbares kdfFile heisst NICHT "dann eben die alten Werte": stammt die
         * Aufstellung aus der neuen Welt, ergäbe das einen falschen Schlüssel und damit
         * die Meldung "Zugangsdaten konnten nicht entschlüsselt werden" - eine
         * Fehlersuche, die in die völlig falsche Richtung führt. Lieber laut abbrechen.
         */
        console.error(`[energy-mail] ${kdfFile} nicht lesbar: ${(err as Error).message}`);
        process.exit(1);
      }
    }

    setKeyProvider(createPassphraseKeyProvider(passphrase, fs.readFileSync(saltFile), parameter));
    console.warn(
      '[energy-mail] Masterschlüssel aus ENERGY_MAIL_MASTER_KEY. Eine Schlüsseldatei ' +
        'wäre sicherer - die Variable ist in der Prozessumgebung ablesbar.',
    );
    if (bestand && parameter === SCRYPT_ALTBESTAND) {
      console.warn(
        `[energy-mail] Der Masterschlüssel wird noch mit den alten scrypt-Werten (N=${SCRYPT_ALTBESTAND.N}) ` +
          'abgeleitet. Auf die heutigen Werte zu wechseln hiesse, alle Geheimnisse neu zu ' +
          'verschlüsseln - der sicherere Weg ist ohnehin die Schlüsseldatei ' +
          '(ENERGY_MAIL_MASTER_KEY einfach weglassen, siehe README).',
      );
    }
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

/**
 * Wo die Daten liegen.
 *
 * Ohne Angabe ein "data"-Ordner neben dem Servercode - für den Betrieb aus dem
 * Quellbaum richtig, für einen Container falsch: dort liegt der Code in einer Schicht,
 * die bei jeder Aktualisierung ersetzt wird. Wer den Ordner nicht ausdrücklich nach
 * außen legt, verliert bei der ersten Aktualisierung sämtliche Konten - und merkt es
 * erst danach.
 */
function richteDatenordnerEin(): void {
  const ordner = process.env.ENERGY_MAIL_DATEN?.trim();
  if (!ordner) return;
  fs.mkdirSync(ordner, { recursive: true, mode: 0o700 });
  setDataDir(ordner);
}

richteAuffangbehaelterEin();
richteDatenordnerEin();
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

const nachAussen = host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';

/**
 * Die Adresse, unter der der Dienst im Browser steht.
 *
 * Pflicht, sobald nach außen gelauscht wird - und zwar nicht aus Ordnungsliebe: der
 * Herkunftsriegel (zugang.ts) kennt sonst nur 127.0.0.1 und weist jede Anfrage der
 * eigenen Oberfläche mit 403 ab, das Anmelden eingeschlossen. Der Dienst liefe, wäre
 * aber unbedienbar - eine Fehlersuche, die einen Abend kostet.
 *
 * Absichtlich nicht aus dem Host-Kopf der Anfrage abgeleitet: den bestimmt der
 * Anfragende, damit wäre die Prüfung wirkungslos.
 */
try {
  setzeOeffentlicheAdresse(process.env.ENERGY_MAIL_OEFFENTLICHE_ADRESSE);
} catch (err) {
  console.error(`[energy-mail] ENERGY_MAIL_OEFFENTLICHE_ADRESSE: ${(err as Error).message}`);
  process.exit(1);
}

if (nachAussen && !process.env.ENERGY_MAIL_OEFFENTLICHE_ADRESSE) {
  console.error(
    '[energy-mail] ENERGY_MAIL_HOST zeigt nach außen, aber ENERGY_MAIL_OEFFENTLICHE_ADRESSE ' +
      'fehlt. Ohne sie weist der Herkunftsriegel die eigene Oberfläche ab. Beispiel: ' +
      'ENERGY_MAIL_OEFFENTLICHE_ADRESSE=https://mail.beispiel.de',
  );
  process.exit(1);
}

/**
 * Das Zugangsgeheimnis - im Serverbetrieb ausdrücklich NICHT gesetzt.
 *
 * Es stammt aus der Zeit vor der Anmeldung und weist seinen Träger als der eine
 * Einplatznutzer aus. Auf einem Server mit mehreren Menschen wäre das ein Generalschlüssel
 * auf ein einziges, geteiltes Postfach - deshalb die Warnung. Geschützt wird der
 * Serverbetrieb durch die Anmeldung: ohne Sitzung kommt keine Anfrage an einer Route
 * vorbei (siehe nutzer/haken.ts).
 *
 * Früher stand hier statt der Warnung ein `process.exit(1)`, wenn nach außen gelauscht
 * und kein Geheimnis gesetzt war. Das war richtig, solange es keine Anmeldung gab - und
 * hätte jetzt genau den vorgesehenen Serverbetrieb verhindert.
 */
if (process.env.ENERGY_MAIL_ZUGANG) {
  setzeZugangsgeheimnis(process.env.ENERGY_MAIL_ZUGANG);
  if (nachAussen) {
    console.warn(
      '[energy-mail] ENERGY_MAIL_ZUGANG ist gesetzt und es wird nach außen gelauscht. Wer ' +
        'das Geheimnis kennt, gilt damit als der Einplatznutzer - ohne Anmeldung und für ' +
        'alle dasselbe Postfach. Für einen Dienst mit mehreren Nutzern gehört die Variable weg.',
    );
  }
}

/**
 * Hinter dem Reverse Proxy: den weitergereichten Angaben glauben - aber nur ihm.
 *
 * Ohne das ist `request.ip` die Adresse des Proxys. Zwei Folgen, beide unangenehm: die
 * Bremse gegen Kennwort-Durchprobieren zählt dann alle Versuche aller Menschen in
 * denselben Topf - zehn Fehlversuche irgendwo sperren alle anderen mit aus -, und das
 * Protokoll nennt bei jedem Vorfall dieselbe nichtssagende Adresse.
 *
 * `1` heißt: genau dem nächsten Proxy glauben. Wer weiter vorne noch etwas stehen hat
 * (Cloudflare, ein zweiter Vorbau), trägt die entsprechende Zahl oder das Netz ein.
 * Bewusst nicht `true` als Voreinstellung: das glaubt der gesamten Kette, und die kann
 * der Anfragende selbst verlängern.
 */
function proxyVertrauen(): boolean | number | string {
  const wert = (process.env.ENERGY_MAIL_PROXY ?? '').trim();
  if (!wert || wert === '0' || wert === 'false' || wert === 'nein') return false;
  if (wert === 'true' || wert === 'ja') return 1;
  if (/^\d+$/.test(wert)) return Number(wert);
  // Alles andere ist eine Adresse oder ein Netz in CIDR-Schreibweise, ggf. mehrere.
  return wert;
}

/**
 * Der Entwicklungsbetrieb - und nur er - darf den Vite-Server auf 5173 hereinlassen.
 *
 * Zwei Bedingungen, beide nötig: NODE_ENV sagt, dass hier nicht produktiv gearbeitet
 * wird (der Container setzt es auf "production"), und es gibt tatsächlich kein gebautes
 * Frontend. Vorher genügte die zweite allein, womit ein misslungener Bau im Betrieb die
 * CORS-Erlaubnis anschaltete.
 */
const webDist = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'web',
  'dist',
);
const viteErlauben = process.env.NODE_ENV !== 'production' && !fs.existsSync(webDist);
if (viteErlauben) {
  console.warn(
    '[energy-mail] Entwicklungsbetrieb: der Vite-Server auf 5173 darf zugreifen (CORS). ' +
      'Für den Betrieb NODE_ENV=production setzen.',
  );
}

/*
 * Den Zertifikatsspeicher des Betriebssystems dazunehmen - vor der ersten Verbindung.
 *
 * Auch der Serverbetrieb steht oft in einem Netz, dessen Vorbau TLS aufbricht und mit
 * einer eigenen Wurzel neu unterschreibt. Ohne diese Zeile bräche dort jede IMAP- und
 * SMTP-Verbindung ab. Einzelheiten in mail-core/zertifikate.ts.
 */
// Hier gibt es noch kein Protokoll: Der Logger entsteht erst in buildServer() weiter
// unten, und diese Auskunft muss davor stehen - sie betrifft die erste Verbindung.
// eslint-disable-next-line no-console
console.log(`[energy-mail] ${beschreibeZertifikate(nutzeSystemZertifikate())}`);

const app = await buildServer({ port, proxyVertrauen: proxyVertrauen(), viteErlauben });

app
  .listen({ port, host })
  .then(() => app.log.info(`Server läuft auf ${host}:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
