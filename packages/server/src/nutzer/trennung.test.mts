import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getNutzerDir, getNutzerDirFuer, getWurzelDir, setDataDir } from '../paths.js';
import { alsNutzer, aktuellerNutzer, hatNutzerkontext, istGueltigeNutzerId } from './kontext.js';

/*
 * Die Trennung der Nutzer.
 *
 * Das ist die Pruefung, auf die es bei der ganzen Umstellung ankommt. Alles andere sind
 * Umbauten; hier steht, was sie leisten sollen - und was passiert, wenn jemand sie
 * umgeht.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-trennung-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

const { speichereEtikett, alleEtiketten } = await import('../etikettenStore.js');
const { regelSpeichern, regelnFuer } = await import('../rules.js');
const { ziehePerBestandUm } = await import('./umzug.js');

let ok = 0;
let gesamt = 0;

/**
 * Wartet auch auf asynchrone Pruefungen.
 *
 * Die uebrigen Pruefdateien im Baum haben hier `fn: () => void` stehen. Das ist eine
 * Falle: wird versehentlich eine async-Funktion uebergeben, wird das zurueckgegebene
 * Promise nicht abgewartet - die Pruefung gilt SOFORT als bestanden, und ein Fehlschlag
 * landet als unbehandelte Ablehnung im Nichts. Zwei Pruefungen weiter unten sind
 * asynchron; ohne das await hier waeren sie wertlos.
 */
async function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

console.log('\nOhne Nutzer geht gar nichts:');

await pruefe('ein Speicherzugriff ohne Kontext wirft', () => {
  /*
   * Die tragende Eigenschaft der ganzen Umstellung. Waere hier ein Rueckfallwert statt
   * einer Ausnahme, laese eine vergessene Stelle stillschweigend fremde Post - und
   * niemand merkte es. Ein Fehler ist laut; ein falscher Nutzer ist es nie.
   */
  assert.equal(hatNutzerkontext(), false);
  assert.throws(() => alleEtiketten(), /Kein Nutzerkontext/);
  assert.throws(() => getNutzerDir(), /Kein Nutzerkontext/);
});

await pruefe('die Wurzel bleibt auch ohne Kontext erreichbar', () => {
  // Protokoll, Schluesseldatei und Salt gehoeren keinem Nutzer - sie muessen ohne
  // Kontext zu finden sein, sonst koennte der Server gar nicht erst protokollieren.
  assert.equal(getWurzelDir(), tempDir);
});

console.log('\nZwei Nutzer kommen sich nicht ins Gehege:');

await pruefe('Etiketten des einen sieht der andere nicht', () => {
  alsNutzer('anna', () => speichereEtikett({ name: 'Annas Steuer' }));
  alsNutzer('bert', () => speichereEtikett({ name: 'Berts Rechnungen' }));

  const beiAnna = alsNutzer('anna', () => alleEtiketten().map((e) => e.name));
  const beiBert = alsNutzer('bert', () => alleEtiketten().map((e) => e.name));

  assert.ok(beiAnna.includes('Annas Steuer'));
  assert.ok(!beiAnna.includes('Berts Rechnungen'), 'Anna sieht Berts Etikett');
  assert.ok(beiBert.includes('Berts Rechnungen'));
  assert.ok(!beiBert.includes('Annas Steuer'), 'Bert sieht Annas Etikett');
});

await pruefe('Regeln ebenso - und zwar auch bei gleicher Kontokennung', () => {
  /*
   * Der gemeine Fall: beide haben ein Konto, das intern dieselbe Kennung traegt. Waere
   * die Trennung nur ueber die Kontokennung gebaut, fielen sie zusammen.
   */
  const gleicheKontoId = 'konto-1';
  alsNutzer('anna', () =>
    regelSpeichern(gleicheKontoId, {
      aktiv: true,
      name: 'Annas Regel',
      bedingungen: { von: 'bank' },
      aktionen: { alsGelesen: true },
    }),
  );
  alsNutzer('bert', () =>
    regelSpeichern(gleicheKontoId, {
      aktiv: true,
      name: 'Berts Regel',
      bedingungen: { von: 'werbung' },
      aktionen: { inDenPapierkorb: true },
    }),
  );

  const annas = alsNutzer('anna', () => regelnFuer(gleicheKontoId));
  const berts = alsNutzer('bert', () => regelnFuer(gleicheKontoId));

  assert.equal(annas.length, 1);
  assert.equal(berts.length, 1);
  assert.equal(annas[0]?.name, 'Annas Regel');
  assert.equal(berts[0]?.name, 'Berts Regel');
});

await pruefe('die Dateien liegen tatsaechlich in getrennten Ordnern', () => {
  // Nicht nur die Sicht trennen, sondern die Ablage - sonst haengt alles an einer
  // Filterlogik, die man vergessen kann.
  assert.ok(fs.existsSync(path.join(getNutzerDirFuer('anna'), 'etiketten.json')));
  assert.ok(fs.existsSync(path.join(getNutzerDirFuer('bert'), 'etiketten.json')));
  assert.notEqual(getNutzerDirFuer('anna'), getNutzerDirFuer('bert'));
});

await pruefe('nach dem Verlassen ist der Kontext wieder weg', () => {
  alsNutzer('anna', () => assert.equal(aktuellerNutzer(), 'anna'));
  assert.equal(hatNutzerkontext(), false, 'der Kontext ist ausgelaufen');
});

await pruefe('geschachtelt gewinnt der innere, danach gilt wieder der aeussere', () => {
  alsNutzer('anna', () => {
    assert.equal(aktuellerNutzer(), 'anna');
    alsNutzer('bert', () => assert.equal(aktuellerNutzer(), 'bert'));
    assert.equal(aktuellerNutzer(), 'anna');
  });
});

console.log('\nDer Kontext ueberlebt asynchrone Grenzen:');

await pruefe('ueber await hinweg', async () => {
  await alsNutzer('anna', async () => {
    await new Promise((auf) => setTimeout(auf, 1));
    assert.equal(aktuellerNutzer(), 'anna');
  });
});

await pruefe('und in einem Zeitgeber, der viel spaeter feuert', async () => {
  /*
   * Daran haengt die Sendewarteschlange: ihre Zeitgeber werden beim Start angelegt und
   * loesen unter Umstaenden erst Wochen spaeter aus. Verloere der Kontext dabei, ginge
   * eine geplante Nachricht im Namen des falschen Nutzers hinaus - oder gar nicht.
   */
  let gesehen: string | null = null;
  alsNutzer('bert', () => {
    setTimeout(() => {
      gesehen = aktuellerNutzer();
    }, 0);
  });

  /*
   * Warten und DANACH pruefen - nicht im Rueckruf des Zeitgebers pruefen.
   *
   * Eine Zusicherung, die in einem Zeitgeber wirft, landet nicht im try/catch der
   * Pruefung: sie reisst den ganzen Prozess mit, statt als Fehlschlag gemeldet zu
   * werden. Die Pruefung gaebe dann keine Auskunft, sondern nur einen Absturz.
   */
  await new Promise((auf) => setTimeout(auf, 5));
  assert.equal(gesehen, 'bert');
});

console.log('\nKennungen, die es nicht geben darf:');

await pruefe('Pfadwechsel ueber die Kennung wird abgewiesen', () => {
  /*
   * Die Kennung wird zu einem Ordnernamen. Ohne strenge Pruefung waere sie ein Weg aus
   * dem eigenen Ordner heraus - und damit genau die Vermischung, die das Modul
   * verhindern soll.
   */
  for (const boese of ['../andere', '..', 'a/b', 'a\\b', '.', '', 'A-GROSS', 'ä', '-start']) {
    assert.equal(istGueltigeNutzerId(boese), false, `"${boese}" haette gelten sollen`);
    assert.throws(() => alsNutzer(boese, () => undefined), /Unbrauchbare Nutzerkennung/);
  }
});

await pruefe('gewoehnliche Kennungen gelten', () => {
  for (const gut of ['lokal', 'anna', 'anna-2', 'a_b', 'n1', 'pruefung']) {
    assert.equal(istGueltigeNutzerId(gut), true, `"${gut}" haette gelten muessen`);
  }
});

await pruefe('eine zu lange Kennung wird abgewiesen', () => {
  assert.equal(istGueltigeNutzerId('a'.repeat(64)), true);
  assert.equal(istGueltigeNutzerId('a'.repeat(65)), false);
});

console.log('\nDer Umzug einer bestehenden Einplatz-Installation:');

await pruefe('nimmt die Nutzerdateien mit und laesst die gemeinsamen stehen', () => {
  const umzugsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-umzug-test-'));
  setDataDir(umzugsDir);
  try {
    // So sah ein Benutzerordner vor der Umstellung aus.
    fs.writeFileSync(path.join(umzugsDir, 'accounts.json'), '[]', 'utf-8');
    fs.writeFileSync(path.join(umzugsDir, 'regeln.json'), '{}', 'utf-8');
    // Und das gehoert allen Nutzern gemeinsam - es bleibt, wo es ist.
    fs.writeFileSync(path.join(umzugsDir, 'key.enc'), 'geheim', 'utf-8');
    fs.mkdirSync(path.join(umzugsDir, 'protokoll'), { recursive: true });

    const bericht = ziehePerBestandUm('lokal');

    assert.ok(bericht.gelaufen);
    assert.ok(bericht.verschoben.includes('accounts.json'));
    assert.ok(bericht.verschoben.includes('regeln.json'));

    const ziel = path.join(umzugsDir, 'nutzer', 'lokal');
    assert.ok(fs.existsSync(path.join(ziel, 'accounts.json')), 'accounts.json ist mitgekommen');
    assert.ok(!fs.existsSync(path.join(umzugsDir, 'accounts.json')), 'und nicht doppelt da');

    assert.ok(fs.existsSync(path.join(umzugsDir, 'key.enc')), 'die Schluesseldatei bleibt');
    assert.ok(fs.existsSync(path.join(umzugsDir, 'protokoll')), 'das Protokoll bleibt');
  } finally {
    setDataDir(tempDir);
    fs.rmSync(umzugsDir, { recursive: true, force: true });
  }
});

await pruefe('laeuft kein zweites Mal', () => {
  const umzugsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-umzug2-test-'));
  setDataDir(umzugsDir);
  try {
    fs.writeFileSync(path.join(umzugsDir, 'accounts.json'), '[]', 'utf-8');
    assert.equal(ziehePerBestandUm('lokal').gelaufen, true);

    // Jemand legt danach eine gleichnamige Datei in der Wurzel ab - sie darf den
    // gewachsenen Stand im Nutzerordner nicht mehr ueberschreiben.
    fs.writeFileSync(path.join(umzugsDir, 'accounts.json'), '[{"kaputt":true}]', 'utf-8');
    assert.equal(ziehePerBestandUm('lokal').gelaufen, false, 'der Umzug lief erneut');
  } finally {
    setDataDir(tempDir);
    fs.rmSync(umzugsDir, { recursive: true, force: true });
  }
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
