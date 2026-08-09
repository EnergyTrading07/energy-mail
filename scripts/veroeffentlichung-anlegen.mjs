/**
 * Legt die GitHub-Veröffentlichung an, bevor electron-builder die Dateien hochlädt.
 *
 * Läuft in der CI, nicht auf dem Arbeitsplatzrechner.
 *
 * Warum nicht electron-builder überlassen? Es startet mehrere Hochlade-Vorgänge
 * nebeneinander, und jeder legt für sich die Veröffentlichung an. Beim ersten Versuch
 * gewann einer das Rennen und der andere scheiterte mit "Published releases must have a
 * valid tag" - übrig blieb eine Veröffentlichung, in der die Installationsdatei fehlte.
 * Steht sie vorher schon da, finden beide sie und laden nur noch hinein.
 *
 * Der Text der Veröffentlichung kommt aus der CHANGELOG.md. Vorher wurde sie ohne `body`
 * angelegt: `info.releaseNotes` blieb leer, und die Aktualisierungskarte im Programm
 * meldete eine neue Fassung, ohne sagen zu können, was sich geändert hat - der ganze
 * Apparat, der die Hinweise aufbereitet und anzeigt (autoUpdate.ts, Aktualisierung.tsx),
 * lief ins Leere.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf-8'));
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

if (!token) {
  console.error('Kein GH_TOKEN/GITHUB_TOKEN gesetzt - ohne Schlüssel geht hier nichts.');
  process.exit(1);
}

const [, besitzer, repo] = pkg.repository.url.match(/github\.com\/([^/]+)\/([^/.]+)/) ?? [];
if (!besitzer || !repo) {
  console.error('Aus dem repository-Eintrag lassen sich Konto und Repository nicht ablesen.');
  process.exit(1);
}

const marke = `v${pkg.version}`;
const api = `https://api.github.com/repos/${besitzer}/${repo}`;
const kopf = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'energy-mail-release',
};

/**
 * Holt den Abschnitt zur aktuellen Fassung aus der CHANGELOG.md.
 *
 * Zeilenweise statt mit einem regulären Ausdruck: ein Ausdruck über die ganze Datei
 * bräuchte ein Ende-des-Textes-Zeichen, das es in JavaScript nicht gibt ("$" bedeutet
 * mit dem m-Schalter Zeilenende, ohne ihn Textende - hier braucht man beides zugleich).
 * Die Schleife ist länger und dafür offensichtlich richtig.
 */
function neuerungen() {
  const datei = path.join(wurzel, 'CHANGELOG.md');
  if (!fs.existsSync(datei)) return '';

  const zeilen = fs.readFileSync(datei, 'utf-8').split('\n');
  const ueberschrift = `## ${pkg.version}`;
  const abschnitt = [];
  let drin = false;

  for (const zeile of zeilen) {
    if (zeile.startsWith('## ')) {
      if (drin) break;
      drin = zeile.trim() === ueberschrift;
      continue;
    }
    if (drin) abschnitt.push(zeile);
  }
  return abschnitt.join('\n').trim();
}

const text = neuerungen();
if (!text) {
  // Kein Abbruch: marke-setzen.mjs hat das bereits vor dem Push geprüft. Kommt es hier
  // trotzdem vor, ist eine fehlende Inhaltsangabe kein Grund, die Fassung liegenzulassen.
  console.warn(`Hinweis: kein CHANGELOG-Abschnitt "## ${pkg.version}" gefunden.`);
}

const vorhanden = await fetch(`${api}/releases/tags/${marke}`, { headers: kopf });
if (vorhanden.ok) {
  console.log(`Veröffentlichung ${marke} besteht bereits - Dateien werden hineingelegt.`);
  process.exit(0);
}

const angelegt = await fetch(`${api}/releases`, {
  method: 'POST',
  headers: { ...kopf, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tag_name: marke,
    name: `${pkg.productName} ${pkg.version}`,
    body: text,
    draft: false,
    prerelease: false,
  }),
});

if (!angelegt.ok) {
  console.error(`Veröffentlichung ${marke} konnte nicht angelegt werden:`);
  console.error(await angelegt.text());
  process.exit(1);
}
console.log(`Veröffentlichung ${marke} angelegt.`);
