/**
 * Setzt die Marke, die eine Veröffentlichung auslöst - und sonst nichts.
 *
 * Das Bauen und Hochladen macht seit Punkt 2 die CI (.github/workflows/veroeffentlichen.yml).
 * Hier bleibt der eine Schritt, der von Hand kommen muss: die Entscheidung, dass dieser
 * Stand die Fassung X ist.
 *
 * Warum die Trennung? Vorher wurde auf dem Arbeitsplatzrechner gebaut und von dort
 * hochgeladen. Die ausgelieferte Datei war damit das Ergebnis eines Rechners, dessen
 * Zustand niemand nachvollziehen kann: welche node_modules, welche Node-Fassung, welche
 * versehentlich herumliegenden Dateien. Bei einer Anwendung mit Selbstaktualisierung ist
 * der Bauplatz die empfindlichste Stelle der ganzen Kette - was dort hineingerät, landet
 * auf jedem Rechner, der aktualisiert.
 *
 * ---
 *
 * Eine Marke wird hier NIE verschoben.
 *
 * Vorher standen hier `git tag -f` und `git push --force`. Wer zweimal mit derselben
 * Fassungsnummer veröffentlichte - etwa weil der erste Lauf beim Hochladen abbrach und
 * inzwischen ein Commit dazugekommen war -, verschob damit die Marke auf einen anderen
 * Stand. Die Veröffentlichung auf GitHub enthielt aber weiterhin die Installationsdatei
 * aus dem ALTEN Stand: zwei verschiedene Programme unter derselben Fassungsnummer, und
 * die Frage "was steckte in 0.2.1?" ließ sich nicht mehr beantworten.
 *
 * Jetzt bricht der Lauf ab und sagt, dass die Fassungsnummer erhöht gehört. Das ist die
 * einzige richtige Antwort - eine veröffentlichte Fassung lässt sich nicht zurückholen,
 * sie steht in der Selbstaktualisierung jedes Nutzers.
 *
 * Kein Zugriffsschlüssel nötig: gepusht wird über die Zugangsdaten, mit denen auch sonst
 * gepusht wird. Der GitHub-Schlüssel wird nur noch in der CI gebraucht, und dort stellt
 * ihn GitHub selbst bereit.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(wurzel, 'package.json'), 'utf-8'));
const marke = `v${pkg.version}`;

const git = (...args) => execFileSync('git', args, { cwd: wurzel, encoding: 'utf-8' }).trim();

/** Wie git, aber ein Fehlschlag ist kein Abbruch - nur ein `null`. */
function gitOderNull(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function abbruch(...zeilen) {
  console.error('\nVeröffentlichen abgebrochen:\n');
  for (const z of zeilen) console.error(`  ${z}`);
  console.error('');
  process.exit(1);
}

const hier = git('rev-parse', 'HEAD');

// --- Zeigt die Marke hier schon woandershin? ----------------------------------------

const oertlich = gitOderNull('rev-list', '-n', '1', marke);
if (oertlich && oertlich !== hier) {
  abbruch(
    `Die Marke ${marke} gibt es hier bereits, und sie zeigt auf einen anderen Stand.`,
    '',
    `  Marke:  ${oertlich.slice(0, 12)}`,
    `  HEAD:   ${hier.slice(0, 12)}`,
    '',
    'Eine veröffentlichte Fassung lässt sich nicht zurückholen - sie steht in der',
    'Selbstaktualisierung jedes Nutzers. Zwei verschiedene Programme unter derselben',
    'Nummer wären danach nicht mehr auseinanderzuhalten.',
    '',
    `Erhöhen Sie die Fassungsnummer in package.json (derzeit ${pkg.version}) und`,
    'checken Sie sie ein. Wenn die Marke versehentlich entstanden ist:',
    `  git tag -d ${marke}`,
  );
}

// --- Und auf GitHub? Dort kann sie stehen, ohne dass es sie hier gibt. ---------------

const entferntZeile = gitOderNull('ls-remote', '--tags', 'origin', `refs/tags/${marke}`);
if (entferntZeile === null) {
  abbruch(
    'Der Stand auf GitHub ließ sich nicht abfragen ("git ls-remote" schlug fehl).',
    'Ohne diese Auskunft lässt sich nicht ausschließen, dass die Marke dort bereits',
    'auf etwas anderes zeigt - und genau davor soll diese Prüfung schützen.',
  );
}

const entfernt = entferntZeile ? entferntZeile.split(/\s+/)[0] : null;
if (entfernt) {
  /*
   * Bei einer annotierten Marke zeigt ls-remote auf das Marken-Objekt, nicht auf den
   * Commit. Erst auflösen, dann vergleichen - sonst bräche der Lauf bei einer völlig
   * richtigen Marke ab. Ist das Objekt hier unbekannt (noch nicht geholt), wird es
   * geholt statt geraten.
   */
  let aufgeloest = gitOderNull('rev-list', '-n', '1', entfernt);
  if (!aufgeloest) {
    gitOderNull('fetch', 'origin', '--tags', '--quiet');
    aufgeloest = gitOderNull('rev-list', '-n', '1', entfernt);
  }
  if ((aufgeloest ?? entfernt) !== hier) {
    abbruch(
      `Auf GitHub gibt es die Marke ${marke} bereits, und sie zeigt auf einen anderen Stand.`,
      '',
      `  Dort:   ${(aufgeloest ?? entfernt).slice(0, 12)}`,
      `  HEAD:   ${hier.slice(0, 12)}`,
      '',
      `Es gibt also bereits eine Veröffentlichung ${marke} mit einem anderen Programm.`,
      '',
      `Erhöhen Sie die Fassungsnummer in package.json (derzeit ${pkg.version}).`,
    );
  }
}

// --- Steht der Abschnitt in der CHANGELOG? ------------------------------------------

/*
 * Vor der Marke prüfen, nicht danach.
 *
 * Die Änderungshinweise der Veröffentlichung kommen aus diesem Abschnitt, und die
 * Aktualisierungskarte im Programm zeigt sie dem Nutzer. Fehlt er, meldet das Programm
 * eine neue Fassung, ohne sagen zu können, was sich geändert hat. Das jetzt zu merken
 * kostet nichts; nach dem Push ist die Marke draußen.
 */
const changelog = path.join(wurzel, 'CHANGELOG.md');
if (fs.existsSync(changelog)) {
  const hatAbschnitt = fs
    .readFileSync(changelog, 'utf-8')
    .split('\n')
    .some((z) => z.trim() === `## ${pkg.version}`);
  if (!hatAbschnitt) {
    abbruch(
      `In CHANGELOG.md fehlt der Abschnitt "## ${pkg.version}".`,
      '',
      'Ohne ihn bekommt die Veröffentlichung keine Änderungshinweise, und die',
      'Aktualisierungskarte im Programm meldet eine neue Fassung, ohne zu sagen,',
      'was sich geändert hat.',
      '',
      `Üblicher Ablauf: den Abschnitt "## Unveröffentlicht" in "## ${pkg.version}"`,
      'umbenennen und einchecken.',
    );
  }
}

// --- Marke setzen und hochladen ------------------------------------------------------

if (!oertlich) {
  // Ohne -f. Gäbe es sie schon und zeigte woanders hin, wären wir oben nicht mehr hier.
  git('tag', '-a', marke, '-m', `${pkg.productName} ${pkg.version}`);
  console.log(`Marke ${marke} angelegt.`);
} else {
  console.log(`Marke ${marke} steht bereits auf diesem Stand.`);
}

// Erst der Zweig, dann die Marke. Andersherum hinge sie an einem Stand, den es auf
// GitHub noch gar nicht gibt. Beides ohne --force: was draußen ist, bleibt.
git('push', 'origin', 'HEAD:main');
if (!entfernt) {
  git('push', 'origin', `refs/tags/${marke}`);
  console.log(`Marke ${marke} hochgeladen.`);
} else {
  console.log(`Marke ${marke} liegt bereits auf GitHub.`);
}

const [, besitzer, repo] = pkg.repository.url.match(/github\.com\/([^/]+)\/([^/.]+)/) ?? [];
console.log('');
console.log(`Der Bau läuft jetzt in der CI. Zusehen kann man hier:`);
console.log(`  https://github.com/${besitzer}/${repo}/actions`);
console.log('');
console.log(`Ist er durch, liegt die Fassung unter:`);
console.log(`  https://github.com/${besitzer}/${repo}/releases/tag/${marke}`);
