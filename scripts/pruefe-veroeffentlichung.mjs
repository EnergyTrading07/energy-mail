/**
 * Prüft vor dem Veröffentlichen, ob alles beisammen ist.
 *
 * Zwei Dinge müssen einmal von Hand eingerichtet werden - ohne sie bricht
 * electron-builder mit Meldungen ab, die nicht sagen, was zu tun ist ("404 Not Found"
 * bzw. "GitHub Personal Access Token is not set").
 *
 * Dazu kommen zwei Dinge, die vor jedem Mal stimmen müssen: die Prüfungen laufen durch,
 * und der Stand, der veröffentlicht wird, liegt auch auf GitHub. Beides fällt sonst
 * erst auf, wenn die Fassung schon draußen ist - und dann steht sie in der
 * Selbstaktualisierung und lässt sich nicht mehr zurückholen.
 */
import { spawnSync } from 'node:child_process';
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

/**
 * Führt einen Befehl aus und sagt, ob er durchlief.
 *
 * Als eine Zeichenkette und nicht als Befehl mit Argumentliste: mit "shell: true" wären
 * die Argumente ohnehin nur aneinandergehängt worden, und Node warnt zu Recht davor.
 * Hier steht alles fest im Quelltext, es kommt nichts von außen hinein.
 */
function laeuft(befehlszeile) {
  const lauf = spawnSync(befehlszeile, { cwd: wurzel, encoding: 'utf-8', shell: true });
  return { ok: lauf.status === 0, ausgabe: `${lauf.stdout ?? ''}${lauf.stderr ?? ''}` };
}

/*
 * Der Arbeitsbaum muss sauber sein und der Stand auf GitHub liegen.
 *
 * Sonst zeigt die veröffentlichte Fassung auf einen Commit, den außer auf diesem
 * Rechner niemand hat - und wer später wissen will, was in 0.2.1 steckte, findet es
 * nicht mehr heraus.
 */
const stand = laeuft('git status --porcelain');
if (stand.ok && stand.ausgabe.trim()) {
  fehler.push(
    'Es liegen ungespeicherte Änderungen im Arbeitsbaum.\n' +
      '   Erst einchecken, dann veröffentlichen - sonst zeigt die Fassung auf einen\n' +
      '   Stand, den es so nirgends gibt. Betroffen:\n' +
      stand.ausgabe
        .trim()
        .split('\n')
        .slice(0, 8)
        .map((z) => `     ${z.trim()}`)
        .join('\n'),
  );
}

/*
 * Ohne eingerichteten Gegenpart lässt sich gar nicht feststellen, ob der Stand draußen
 * ist. Das ist selbst schon die Auskunft: der Zweig wurde nie gepusht. Vorher wurde die
 * Prüfung in diesem Fall stillschweigend übersprungen - eine Lücke genau dort, wo sie
 * gebraucht wird.
 */
const unversandt = laeuft('git log --oneline @{u}..HEAD');
if (!unversandt.ok) {
  fehler.push(
    'Für diesen Zweig ist kein Gegenpart auf GitHub eingerichtet.\n' +
      '   Damit lässt sich nicht feststellen, ob der Stand dort liegt.\n' +
      '   Einmalig:  git push -u origin main',
  );
} else if (unversandt.ausgabe.trim()) {
  const offen = unversandt.ausgabe.trim().split('\n');
  fehler.push(
    `${offen.length} Commit(s) sind noch nicht auf GitHub:\n` +
      offen
        .slice(0, 5)
        .map((z) => `     ${z}`)
        .join('\n') +
      '\n   Erst "git push", dann veröffentlichen.',
  );
}

/*
 * Und zuletzt: die Prüfungen.
 *
 * Sechsundzwanzig Sekunden vor einer Veröffentlichung sind gut angelegt. Eine Fassung
 * mit einem bekannten Fehler hinauszugeben ist teurer - sie liegt danach in der
 * Selbstaktualisierung jedes Nutzers.
 */
if (fehler.length === 0) {
  console.log('Prüfungen laufen…');
  const pruefungen = laeuft('npm test');
  if (!pruefungen.ok) {
    const gescheitert = pruefungen.ausgabe
      .split('\n')
      .filter((z) => z.startsWith('  FEHL'))
      .slice(0, 10);
    fehler.push(
      'Die Prüfungen sind nicht durchgelaufen.\n' +
        (gescheitert.length > 0
          ? gescheitert.map((z) => `   ${z.trim()}`).join('\n')
          : '   (kein einzelner Fehlschlag erkennbar - "npm test" von Hand ausführen)'),
    );
  }
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
