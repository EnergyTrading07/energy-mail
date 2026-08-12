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
import os from 'node:os';
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

/*
 * Hier stand einmal die Forderung nach einem GH_TOKEN.
 *
 * Sie ist entfallen, weil von diesem Rechner nichts mehr hochgeladen wird: der lokale
 * Schritt setzt nur noch die Marke, und dafür genügen die Zugangsdaten, mit denen auch
 * sonst gepusht wird. Gebaut und hochgeladen wird in der CI, und den Schlüssel dafür
 * stellt GitHub selbst bereit (secrets.GITHUB_TOKEN).
 *
 * Das ist nebenbei die vollständige Lösung eines alten Problems: Der Schlüssel ging
 * vorher als Argument an git und stand damit in der Prozessliste, für jeden anderen
 * Prozess desselben Nutzers lesbar. Jetzt gibt es ihn hier gar nicht mehr.
 */

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
if (!stand.ok) {
  /*
   * Ein fehlgeschlagenes "git status" galt vorher als sauberer Arbeitsbaum.
   *
   * Die Bedingung lautete `stand.ok && stand.ausgabe.trim()` - lief der Befehl nicht
   * durch (kein git im PATH, beschädigtes Repository), wurde sie nie wahr und die
   * Prüfung stillschweigend übersprungen. Genau diese Lücke wird ein paar Zeilen
   * weiter unten für den fehlenden Gegenpart ausdrücklich geschlossen; hier stand sie
   * noch offen.
   */
  fehler.push(
    '"git status" ließ sich nicht ausführen - der Arbeitsbaum ist damit nicht prüfbar.\n' +
      `   Ausgabe: ${stand.ausgabe.trim().split('\n')[0] ?? '(keine)'}`,
  );
} else if (stand.ausgabe.trim()) {
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
  /*
   * Auch die Typen, nicht nur die Prüfungen.
   *
   * Der erklärte Zweck dieses Skripts ist, alles VOR dem Bau abzufangen. Der Typcheck
   * fehlte trotzdem: ein Typfehler fiel erst im "npm run build" danach auf - also nach
   * der Marke, nach dem Push und nach der angelegten Veröffentlichung. Übrig blieb eine
   * leere Veröffentlichung auf GitHub, die von Hand wegzuräumen war.
   */
  console.log('Typen prüfen…');
  const typen = laeuft('npm run typecheck');
  if (!typen.ok) {
    const meldungen = typen.ausgabe
      .split('\n')
      .filter((z) => z.includes('error TS'))
      .slice(0, 10);
    fehler.push(
      'Die Typprüfung ist nicht durchgelaufen.\n' +
        (meldungen.length > 0
          ? meldungen.map((z) => `   ${z.trim()}`).join('\n')
          : '   ("npm run typecheck" von Hand ausführen)'),
    );
  }
}

if (fehler.length === 0) {
  console.log('Prüfungen laufen…');
  const pruefungen = laeuft('npm test');
  if (!pruefungen.ok) {
    /*
     * Zwei Wege, den Fehlschlag zu benennen.
     *
     * Die Zeilen mit "FEHL" kommen aus den Prüfdateien selbst - eine Vereinbarung, die
     * nirgends erzwungen wird und deshalb allein nicht tragen darf. Die Zusammenfassung
     * von "node --test" ("# fail 3") kommt dagegen vom Läufer und gilt immer.
     */
    const gescheitert = pruefungen.ausgabe
      .split('\n')
      .filter((z) => z.includes('FEHL'))
      .slice(0, 10);
    const zusammenfassung = pruefungen.ausgabe
      .split('\n')
      .filter((z) => /^(ℹ|#)?\s*(fail|tests)\s+\d+/.test(z.trim()))
      .map((z) => z.trim());

    fehler.push(
      'Die Prüfungen sind nicht durchgelaufen.\n' +
        (gescheitert.length > 0
          ? gescheitert.map((z) => `   ${z.trim()}`).join('\n')
          : zusammenfassung.length > 0
            ? zusammenfassung.map((z) => `   ${z}`).join('\n')
            : '   (kein einzelner Fehlschlag erkennbar - "npm test" von Hand ausführen)'),
    );
  }
}

/*
 * Der Freigabeschlüssel - jetzt und nicht erst am Ende.
 *
 * Ohne ihn läuft alles durch: Marke setzen, CI bauen lassen, warten - und dann steht man
 * vor einem Entwurf, der sich nicht freigeben lässt, weil der Schlüssel fehlt oder der
 * öffentliche Teil nie eingetragen wurde. Das ist der falsche Zeitpunkt, um es zu
 * erfahren. Kein Abbruch: eine Fassung ohne Prüfung ist der Stand von vorher und nicht
 * schlechter - aber sie soll niemandem versehentlich passieren.
 */
const schluesselDatei = path.join(os.homedir(), '.energy-mail', 'freigabe-schluessel.pem');
const signaturQuelle = path.join(wurzel, 'packages', 'desktop', 'src', 'updateSignatur.ts');
const hinweise = [];

if (!fs.existsSync(schluesselDatei)) {
  hinweise.push(
    `Kein Freigabeschlüssel (${schluesselDatei}).\n` +
      '   "npm run schluessel-erzeugen" legt ihn an. Ohne ihn lässt sich der Entwurf,\n' +
      '   den die CI ablegt, hinterher nicht freigeben.',
  );
} else if (
  fs.existsSync(signaturQuelle) &&
  fs.readFileSync(signaturQuelle, 'utf-8').includes('PLATZHALTER')
) {
  hinweise.push(
    'Der Schlüssel ist da, aber sein öffentlicher Teil steht noch nicht in\n' +
      '   packages/desktop/src/updateSignatur.ts - dort steht weiterhin der Platzhalter.\n' +
      '   Diese Fassung würde ausgeliefert, ohne Aktualisierungen prüfen zu können.',
  );
}

if (fehler.length > 0) {
  console.error('\nVeröffentlichen noch nicht möglich:\n');
  fehler.forEach((f, i) => console.error(` ${i + 1}. ${f}\n`));
  process.exit(1);
}

if (hinweise.length > 0) {
  console.warn('\nHinweis zur Freigabe:\n');
  hinweise.forEach((h) => console.warn(` - ${h}\n`));
}

console.log(`\n${pkg.productName} ${pkg.version} ist bereit für die Marke.`);
console.log('Gebaut und hochgeladen wird danach in der CI - nicht auf diesem Rechner.');
console.log('Sie legt einen ENTWURF ab; sichtbar wird er erst durch "npm run freigeben".\n');
