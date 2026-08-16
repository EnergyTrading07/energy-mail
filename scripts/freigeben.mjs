/**
 * Gibt eine gebaute Fassung frei: unterschreiben und sichtbar machen.
 *
 * Läuft auf dem Arbeitsplatzrechner, NICHT in der CI - das ist der ganze Punkt. Der
 * Schlüssel, mit dem hier unterschrieben wird, liegt nur hier. Läge er in der CI, wäre
 * er mit dem GitHub-Zugang zusammen zu haben, und die Unterschrift bewiese nichts mehr,
 * was der Zugang nicht ohnehin erlaubte.
 *
 * Der Ablauf einer Veröffentlichung ist damit dreiteilig:
 *
 *   1. npm run veroeffentlichen   (hier)   Stand prüfen, Marke setzen
 *   2. die CI                              bauen, prüfen, als ENTWURF hochladen
 *   3. npm run freigeben          (hier)   unterschreiben, sichtbar machen
 *
 * Zwischen 2 und 3 ist die Fassung für niemanden zu sehen und wird von keiner laufenden
 * Anwendung gezogen. Erst Schritt 3 macht sie zu einer Aktualisierung.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const wurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf-8'));

const GEHEIM_DATEI = path.join(os.homedir(), '.energy-mail', 'freigabe-schluessel.pem');

function abbruch(text) {
  console.error(`\n${text}\n`);
  process.exit(1);
}

// --- Der Schlüssel ---------------------------------------------------------------

if (!fs.existsSync(GEHEIM_DATEI)) {
  abbruch(
    `Kein Freigabeschlüssel gefunden (${GEHEIM_DATEI}).\n\n` +
      'Einmalig anlegen mit:\n' +
      '  node scripts/schluessel-erzeugen.mjs\n\n' +
      'Danach den öffentlichen Teil in packages/desktop/src/updateSignatur.ts eintragen,\n' +
      'einchecken und erst dann veröffentlichen.',
  );
}
const geheimerSchluessel = crypto.createPrivateKey(fs.readFileSync(GEHEIM_DATEI));

// --- Der Zugang zu GitHub --------------------------------------------------------

/**
 * Der Zugriffsschlüssel. Bevorzugt aus der Umgebung, sonst von der GitHub-Befehlszeile.
 *
 * `gh auth token` ist der bequeme Weg für den Alltag - wer gh ohnehin eingerichtet hat,
 * muss sich nichts merken. Die Umgebungsvariable bleibt als Ausweg für alle, die es
 * nicht haben.
 */
function holeToken() {
  const ausUmgebung = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (ausUmgebung) return ausUmgebung;
  try {
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf-8', shell: true }).trim();
  } catch {
    abbruch(
      'Kein GitHub-Zugang gefunden.\n\n' +
        'Entweder GH_TOKEN setzen oder einmal "gh auth login" ausführen.',
    );
  }
}

const token = holeToken();
const [, besitzer, repo] = pkg.repository.url.match(/github\.com\/([^/]+)\/([^/.]+)/) ?? [];
if (!besitzer || !repo) abbruch('Aus dem repository-Eintrag lässt sich das Repository nicht ablesen.');

const marke = `v${pkg.version}`;
const api = `https://api.github.com/repos/${besitzer}/${repo}`;
const kopf = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'energy-mail-freigabe',
};

// --- Die Veröffentlichung finden -------------------------------------------------

/**
 * Entwürfe stehen NICHT unter /releases/tags/<marke> - dieser Weg findet nur
 * veröffentlichte. Ein Entwurf hat zwar eine Marke, ist aber über sie nicht abrufbar;
 * man muss die Liste durchgehen. Das hat mich beim ersten Versuch eine Weile gekostet.
 */
async function findeVeroeffentlichung() {
  const antwort = await fetch(`${api}/releases?per_page=100`, { headers: kopf });
  if (!antwort.ok) abbruch(`Veröffentlichungen nicht abrufbar: HTTP ${antwort.status}`);
  const alle = await antwort.json();
  return alle.find((r) => r.tag_name === marke);
}

const veroeffentlichung = await findeVeroeffentlichung();
if (!veroeffentlichung) {
  abbruch(
    `Zur Marke ${marke} gibt es keine Veröffentlichung.\n\n` +
      'Läuft die CI noch? Sie legt sie an und lädt das Installationsprogramm hinein.\n' +
      `Nachsehen: https://github.com/${besitzer}/${repo}/actions`,
  );
}

if (!veroeffentlichung.draft) {
  console.log(`Die Veröffentlichung ${marke} ist bereits sichtbar.`);
  const schonDa = veroeffentlichung.assets.find((a) => a.name === 'signatur.json');
  if (schonDa) {
    console.log('Eine Unterschrift liegt bei. Es gibt nichts zu tun.');
    process.exit(0);
  }
  abbruch(
    'Sie ist sichtbar, aber OHNE Unterschrift.\n\n' +
      'Das ist der schlechteste Zustand: laufende Anwendungen ziehen die Fassung und\n' +
      'weisen sie ab. Am besten sofort wieder auf Entwurf setzen, dann noch einmal hier\n' +
      'entlang.',
  );
}

// --- Das Installationsprogramm holen ---------------------------------------------

const installer = veroeffentlichung.assets.find((a) => a.name.endsWith('.exe'));
if (!installer) {
  abbruch(
    `In ${marke} liegt kein Installationsprogramm.\n\n` +
      'Die CI ist wohl noch nicht fertig oder abgebrochen.',
  );
}

console.log(`Fassung ${pkg.version}`);
console.log(`  Datei:  ${installer.name} (${(installer.size / 1024 / 1024).toFixed(1)} MB)`);
console.log('  Wird geladen…');

/**
 * Ein Anhang eines Entwurfs ist nicht öffentlich abrufbar - er geht nur über die
 * Programmschnittstelle, und dabei muss ausdrücklich der Rohinhalt verlangt werden.
 * Ohne "Accept: application/octet-stream" kommt die Beschreibung als JSON zurück.
 */
async function ladeAnhang(anhang) {
  const antwort = await fetch(anhang.url, {
    headers: { ...kopf, Accept: 'application/octet-stream' },
    redirect: 'follow',
  });
  if (!antwort.ok) abbruch(`${anhang.name} nicht ladbar: HTTP ${antwort.status}`);
  return Buffer.from(await antwort.arrayBuffer());
}

const inhalt = await ladeAnhang(installer);
if (inhalt.length !== installer.size) {
  abbruch(`${installer.name} kam unvollständig an (${inhalt.length} statt ${installer.size} Bytes).`);
}

const roh = crypto.createHash('sha512').update(inhalt).digest();
const hex = roh.toString('hex');
const base64 = roh.toString('base64');

// --- Gegen die latest.yml gegenprüfen --------------------------------------------

/*
 * Was hier unterschrieben wird, muss dasselbe sein, was die Selbstaktualisierung
 * später herunterlädt und annimmt. Beides steht getrennt: die Unterschrift bezieht sich
 * auf die .exe, die Selbstaktualisierung prüft gegen die Prüfsumme in der latest.yml.
 * Gingen sie auseinander, wiese die Anwendung jede Aktualisierung ab - und zwar erst
 * beim Nutzer. Die Prüfsumme steht dort in Base64, nicht hexadezimal.
 */
const latest = veroeffentlichung.assets.find((a) => a.name === 'latest.yml');
if (!latest) {
  abbruch(`In ${marke} liegt keine latest.yml - ohne sie findet die Anwendung nichts.`);
}
const latestText = (await ladeAnhang(latest)).toString('utf-8');
const genannt = latestText.match(/^\s*sha512:\s*(\S+)\s*$/m)?.[1];
if (!genannt) {
  abbruch('In der latest.yml steht keine sha512-Zeile.');
}
if (genannt !== base64) {
  abbruch(
    'Die Prüfsumme in der latest.yml passt nicht zum Installationsprogramm.\n\n' +
      `  latest.yml: ${genannt}\n` +
      `  gerechnet:  ${base64}\n\n` +
      'Das darf nicht vorkommen. Nichts unterschreiben, bis der Grund geklärt ist.',
  );
}
console.log('  Prüfsumme stimmt mit der latest.yml überein.');

// --- Unterschreiben ---------------------------------------------------------------

/**
 * Muss buchstabengleich zu baueUnterlage() in desktop/src/updateSignatur.ts sein.
 *
 * Bewusst hier noch einmal ausgeschrieben statt importiert: dieses Skript läuft als
 * gewöhnliches ES-Modul aus scripts/, der Prüfteil ist übersetztes TypeScript aus dem
 * desktop-Paket. Ein Import quer darüber hinweg brächte einen Bauschritt in einen
 * Vorgang, der ohne auskommen soll. Die Prüfung freigabe.test.mts hält beide Fassungen
 * gegeneinander - läuft eine davon weg, fällt es dort auf und nicht beim Nutzer.
 */
function baueUnterlage(version, sha512) {
  return Buffer.from(`energy-mail-aktualisierung-v1\n${version}\n${sha512.toLowerCase()}\n`, 'utf-8');
}

const signatur = crypto
  .sign(null, baueUnterlage(pkg.version, hex), geheimerSchluessel)
  .toString('base64');

const freigabe = {
  fassung: 1,
  version: pkg.version,
  datei: installer.name,
  sha512: hex,
  signatur,
};

// --- Beilegen und sichtbar machen -------------------------------------------------

const alteSignatur = veroeffentlichung.assets.find((a) => a.name === 'signatur.json');
if (alteSignatur) {
  await fetch(`${api}/releases/assets/${alteSignatur.id}`, { method: 'DELETE', headers: kopf });
  console.log('  Frühere signatur.json entfernt.');
}

const hochgeladen = await fetch(
  `${veroeffentlichung.upload_url.split('{')[0]}?name=signatur.json`,
  {
    method: 'POST',
    headers: { ...kopf, 'Content-Type': 'application/json' },
    body: JSON.stringify(freigabe, null, 2),
  },
);
if (!hochgeladen.ok) {
  abbruch(`signatur.json nicht hochladbar: HTTP ${hochgeladen.status}\n${await hochgeladen.text()}`);
}
console.log('  Unterschrift beigelegt.');

/*
 * Sichtbarmachen ZULETZT.
 *
 * Die Reihenfolge ist der Punkt: erst muss die Unterschrift daliegen, dann darf die
 * Fassung gefunden werden. Andersherum gäbe es ein Fenster, in dem laufende Anwendungen
 * eine Fassung ohne Unterschrift ziehen und dem Nutzer melden, sie stamme nicht vom
 * Herausgeber.
 */
const sichtbar = await fetch(`${api}/releases/${veroeffentlichung.id}`, {
  method: 'PATCH',
  headers: { ...kopf, 'Content-Type': 'application/json' },
  body: JSON.stringify({ draft: false }),
});
if (!sichtbar.ok) {
  abbruch(
    `Die Veröffentlichung ließ sich nicht sichtbar machen: HTTP ${sichtbar.status}\n` +
      `${await sichtbar.text()}\n\n` +
      'Die Unterschrift liegt bereits bei - es genügt, diesen Aufruf zu wiederholen.',
  );
}

console.log(`
Fassung ${pkg.version} ist freigegeben und sichtbar.

  https://github.com/${besitzer}/${repo}/releases/tag/${marke}

Laufende Anwendungen finden sie beim nächsten Durchlauf (spätestens nach sechs Stunden)
und prüfen die Unterschrift, bevor sie etwas einspielen.
`);
