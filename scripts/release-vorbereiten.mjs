/**
 * Legt Marke und Veröffentlichung an, bevor electron-builder die Dateien hochlädt.
 *
 * Warum nicht electron-builder überlassen? Es startet mehrere Hochlade-Vorgänge
 * nebeneinander, und jeder legt für sich die Veröffentlichung an. Beim ersten Versuch
 * gewann einer das Rennen und der andere scheiterte mit "Published releases must have a
 * valid tag" - übrig blieb eine Veröffentlichung, in der die Installationsdatei fehlte.
 * Steht sie vorher schon da, finden beide sie und laden nur noch hinein.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf-8'));
const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

const [, , besitzer, repo] = pkg.repository.url.match(/github\.com\/([^/]+)\/([^/.]+)/) ?? [];
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

const git = (...args) => execFileSync('git', args, { cwd: wurzel, encoding: 'utf-8' }).trim();

// Marke auf den Stand setzen, der gleich gebaut wird - sonst zeigt sie auf irgendetwas.
git('tag', '-f', marke);

// Zweig und Marke hochladen. Ohne den Zweig hinge die Marke an einem Stand, den es
// dort noch gar nicht gibt.
const auth = Buffer.from(`x-access-token:${token}`).toString('base64');
const mitAuth = (...args) => git('-c', `http.extraheader=AUTHORIZATION: basic ${auth}`, ...args);
mitAuth('push', 'origin', 'HEAD:main');
mitAuth('push', 'origin', marke, '--force');
console.log(`Marke ${marke} und Zweig hochgeladen.`);

const vorhanden = await fetch(`${api}/releases/tags/${marke}`, { headers: kopf });
if (vorhanden.ok) {
  console.log(`Veröffentlichung ${marke} besteht bereits - Dateien werden hineingelegt.`);
} else {
  const angelegt = await fetch(`${api}/releases`, {
    method: 'POST',
    headers: { ...kopf, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tag_name: marke, name: marke, draft: false, prerelease: false }),
  });
  if (!angelegt.ok) {
    console.error(`Veröffentlichung ${marke} konnte nicht angelegt werden:`);
    console.error(await angelegt.text());
    process.exit(1);
  }
  console.log(`Veröffentlichung ${marke} angelegt.`);
}
