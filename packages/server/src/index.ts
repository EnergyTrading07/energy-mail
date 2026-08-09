import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildServer } from './app.js';
import { getWurzelDir, setDataDir } from './paths.js';
import { createPassphraseKeyProvider, setKeyProvider } from './secretCrypto.js';
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

const app = await buildServer({ port, proxyVertrauen: proxyVertrauen() });

app
  .listen({ port, host })
  .then(() => app.log.info(`Server läuft auf ${host}:${port}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
