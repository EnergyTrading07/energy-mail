/**
 * Prüft vor dem Veröffentlichen, ob die beiden Dinge da sind, die nur einmal von Hand
 * eingerichtet werden müssen. Ohne diese Prüfung bricht electron-builder mit Meldungen
 * ab, die nicht sagen, was zu tun ist ("404 Not Found" bzw. "GitHub Personal Access
 * Token is not set").
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf-8'));

const fehler = [];

const url = pkg.repository?.url ?? '';
if (url.includes('DEIN-GITHUB-NAME')) {
  fehler.push(
    'In der package.json steht noch der Platzhalter DEIN-GITHUB-NAME.\n' +
      '   Ersetze ihn im Feld "repository" durch deinen GitHub-Kontonamen, z.B.\n' +
      '   "url": "https://github.com/hendrikzeuch/energy-mail.git"',
  );
}

if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
  fehler.push(
    'GH_TOKEN ist nicht gesetzt - ohne Zugriffsschlüssel darf niemand veröffentlichen.\n' +
      '   Schlüssel anlegen: https://github.com/settings/tokens (Bereich "public_repo")\n' +
      '   Danach in PowerShell:  $env:GH_TOKEN = "ghp_..."',
  );
}

if (fehler.length > 0) {
  console.error('\nVeröffentlichen noch nicht möglich:\n');
  fehler.forEach((f, i) => console.error(` ${i + 1}. ${f}\n`));
  console.error(
    'Der Zugriffsschlüssel wird nur zum Hochladen gebraucht. In die ausgelieferte\n' +
      'Anwendung kommt er nicht - das Repository ist öffentlich lesbar.\n',
  );
  process.exit(1);
}

console.log(`Veröffentliche ${pkg.productName} ${pkg.version} nach ${url}`);
