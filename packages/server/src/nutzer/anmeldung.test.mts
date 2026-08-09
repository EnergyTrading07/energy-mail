import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/*
 * Anmeldung, Sitzungen und die Umschlagverschluesselung.
 *
 * Das sind die Stellen, an denen aus einem Einplatzprogramm ein Dienst wird - und damit
 * die, an denen ein Fehler nicht mehr einen Rechner betrifft, sondern alle Nutzer.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-anmeldung-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

// Ein fester Masterschluessel - auf jedem Rechner derselbe Lauf.
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const { verschluesselKennwort, kennwortStimmt, brauchtErneuerung } = await import('./kennwort.js');
const { legeNutzerAn, findeNutzer, pruefeAnmeldung, entferneNutzer, NutzerFehler } = await import(
  './nutzerStore.js'
);
const {
  verpackeNutzerschluessel,
  verschluessleFuerNutzer,
  entschluessleFuerNutzer,
  vergissNutzerschluessel,
} = await import('./schluesselHuelle.js');
const { alsNutzer } = await import('./kontext.js');
const {
  eroeffneSitzung,
  nutzerZurSitzung,
  beendeSitzung,
  beendeAlleSitzungen,
  vergissSitzungen,
} = await import('./sitzung.js');
const { encryptSecret, decryptSecret, verschluesselMitMaster } = await import('../secretCrypto.js');
const { richteUmschlagEin } = await import('./einrichten.js');

let ok = 0;
let gesamt = 0;

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

console.log('\nKennwoerter:');

await pruefe('dasselbe Kennwort ergibt zweimal eine andere Pruefsumme', () => {
  // Wegen des Salzes. Ohne das liesse sich an gleichen Pruefsummen ablesen, wer dasselbe
  // Kennwort benutzt.
  const a = verschluesselKennwort('ein gutes Kennwort');
  const b = verschluesselKennwort('ein gutes Kennwort');
  assert.notEqual(a, b);
  assert.ok(kennwortStimmt('ein gutes Kennwort', a));
  assert.ok(kennwortStimmt('ein gutes Kennwort', b));
});

await pruefe('ein falsches Kennwort stimmt nicht', () => {
  const summe = verschluesselKennwort('richtig-und-lang');
  assert.equal(kennwortStimmt('falsch-und-lang', summe), false);
  assert.equal(kennwortStimmt('', summe), false);
  assert.equal(kennwortStimmt('richtig-und-lan', summe), false);
});

await pruefe('das Kennwort steht nicht in der Pruefsumme', () => {
  const summe = verschluesselKennwort('Geheimnis-12345');
  assert.ok(!summe.includes('Geheimnis'));
});

await pruefe('ein unbrauchbarer Datensatz ergibt "stimmt nicht", keine Ausnahme', () => {
  // Eine Ausnahme liesse sich von aussen unterscheiden und verriete, dass es den Nutzer gibt.
  for (const unfug of ['', 'kaputt', 'scrypt$$$$', 'bcrypt$1$2$3$x$y', 'scrypt$abc$8$1$aa$bb']) {
    assert.equal(kennwortStimmt('irgendwas', unfug), false, `bei "${unfug}"`);
  }
});

await pruefe('absurde Parameter werden abgewiesen statt gerechnet', () => {
  // Sonst liesse sich der Server ueber eine manipulierte Datei zum Stillstand rechnen.
  const boese = `scrypt$${2 ** 30}$8$1$${Buffer.from('salz').toString('base64')}$${Buffer.alloc(32).toString('base64')}`;
  assert.equal(kennwortStimmt('x', boese), false);
});

await pruefe('eine schwaechere Pruefsumme wird als erneuerungsbeduerftig erkannt', () => {
  assert.equal(brauchtErneuerung(verschluesselKennwort('aktuell-und-lang')), false);
  const alt = `scrypt$16384$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(32).toString('base64')}`;
  assert.equal(brauchtErneuerung(alt), true);
  assert.equal(brauchtErneuerung('bcrypt$...'), true);
});

console.log('\nNutzer anlegen:');

await pruefe('ein Nutzer bekommt eine Kennung aus seiner Adresse', () => {
  const n = legeNutzerAn(
    { email: 'Anna.Mueller@beispiel.de', kennwort: 'langes-kennwort' },
    verpackeNutzerschluessel,
  );
  assert.equal(n.id, 'anna-mueller');
  assert.equal(n.email, 'anna.mueller@beispiel.de', 'kleingeschrieben abgelegt');
  assert.ok(n.schluessel['1'], 'und er hat gleich einen Schluessel');
});

await pruefe('Umlaute werden umschrieben, nicht weggeworfen', () => {
  const n = legeNutzerAn({ email: 'jörg@beispiel.de', kennwort: 'langes-kennwort' }, verpackeNutzerschluessel);
  assert.equal(n.id, 'joerg');
});

await pruefe('dieselbe Adresse zweimal geht nicht', () => {
  assert.throws(
    () =>
      legeNutzerAn(
        { email: 'anna.mueller@beispiel.de', kennwort: 'langes-kennwort' },
        verpackeNutzerschluessel,
      ),
    NutzerFehler,
  );
});

await pruefe('eine gleiche Kennung wird durchnummeriert', () => {
  // "anna.mueller@a.de" und "anna.mueller@b.de" ergaeben beide "anna-mueller".
  const n = legeNutzerAn(
    { email: 'anna.mueller@andere.de', kennwort: 'langes-kennwort' },
    verpackeNutzerschluessel,
  );
  assert.equal(n.id, 'anna-mueller-2');
});

await pruefe('ein zu kurzes Kennwort wird abgewiesen', () => {
  assert.throws(
    () => legeNutzerAn({ email: 'kurz@beispiel.de', kennwort: 'kurz' }, verpackeNutzerschluessel),
    NutzerFehler,
  );
});

await pruefe('eine Adresse ohne @ wird abgewiesen', () => {
  assert.throws(
    () => legeNutzerAn({ email: 'keineadresse', kennwort: 'langes-kennwort' }, verpackeNutzerschluessel),
    NutzerFehler,
  );
});

console.log('\nAnmelden:');

await pruefe('mit richtigem Kennwort', () => {
  const n = pruefeAnmeldung('anna.mueller@beispiel.de', 'langes-kennwort');
  assert.ok(n);
  assert.equal(n?.id, 'anna-mueller');
});

await pruefe('Gross- und Kleinschreibung der Adresse stoert nicht', () => {
  assert.ok(pruefeAnmeldung('ANNA.MUELLER@Beispiel.DE', 'langes-kennwort'));
});

await pruefe('mit falschem Kennwort nicht', () => {
  assert.equal(pruefeAnmeldung('anna.mueller@beispiel.de', 'falsch-und-lang'), null);
});

await pruefe('eine unbekannte Adresse ergibt dasselbe Nichts', () => {
  assert.equal(pruefeAnmeldung('gibtsnicht@beispiel.de', 'langes-kennwort'), null);
});

console.log('\nDer Umschlag - ein Schluessel je Nutzer:');

richteUmschlagEin();

await pruefe('ein Geheimnis von Anna kann Bert nicht oeffnen', () => {
  legeNutzerAn({ email: 'bert@beispiel.de', kennwort: 'langes-kennwort' }, verpackeNutzerschluessel);

  const geheim = alsNutzer('anna-mueller', () => verschluessleFuerNutzer('Annas Postfachkennwort'));
  assert.ok(geheim.startsWith('v2.'), `Format: ${geheim.slice(0, 12)}`);

  assert.equal(
    alsNutzer('anna-mueller', () => entschluessleFuerNutzer(geheim)),
    'Annas Postfachkennwort',
  );
  assert.throws(
    () => alsNutzer('bert', () => entschluessleFuerNutzer(geheim)),
    /.*/,
    'Bert konnte Annas Geheimnis oeffnen',
  );
});

await pruefe('dasselbe Geheimnis ergibt zweimal etwas anderes', () => {
  // Frischer Zufallswert je Verschluesselung - sonst liesse sich an gleichen Bytes
  // ablesen, dass zwei Konten dasselbe Kennwort haben.
  const a = alsNutzer('anna-mueller', () => verschluessleFuerNutzer('gleich'));
  const b = alsNutzer('anna-mueller', () => verschluessleFuerNutzer('gleich'));
  assert.notEqual(a, b);
});

await pruefe('manipulierte Daten werden erkannt, nicht stillschweigend gelesen', () => {
  const geheim = alsNutzer('anna-mueller', () => verschluessleFuerNutzer('unveraendert'));
  const teile = geheim.split('.');
  const gedreht = Buffer.from(teile[4]!, 'base64');
  gedreht[0] = gedreht[0]! ^ 0xff;
  teile[4] = gedreht.toString('base64');
  assert.throws(() => alsNutzer('anna-mueller', () => entschluessleFuerNutzer(teile.join('.'))));
});

await pruefe('Altbestand aus der Zeit vor dem Umschlag bleibt lesbar', () => {
  /*
   * Der entscheidende Punkt fuer bestehende Installationen: was vor der Umstellung
   * angelegt wurde, traegt "v1" und wurde unmittelbar mit dem Masterschluessel
   * verschluesselt. Wuerde es jetzt nicht mehr gelesen, waeren alle Konten weg.
   */
  const alt = verschluesselMitMaster('altes Postfachkennwort');
  assert.ok(alt.startsWith('v1.'));
  assert.equal(
    alsNutzer('anna-mueller', () => decryptSecret(alt)),
    'altes Postfachkennwort',
  );
});

await pruefe('Neues wird als v2 geschrieben', () => {
  const neu = alsNutzer('anna-mueller', () => encryptSecret('neues Kennwort'));
  assert.ok(neu.startsWith('v2.'));
  assert.equal(
    alsNutzer('anna-mueller', () => decryptSecret(neu)),
    'neues Kennwort',
  );
});

await pruefe('einen Nutzer zu entfernen macht seine Geheimnisse unlesbar', () => {
  /*
   * Das ist der Grund fuer die ganze Umschlagbauweise: Loeschen, das auch in Sicherungen
   * wirkt. Der Schluessel stand nur im Nutzereintrag - ist der weg, sind die Bytes Bytes.
   */
  const geheim = alsNutzer('bert', () => verschluessleFuerNutzer('Berts Kennwort'));
  assert.equal(entferneNutzer('bert'), true);
  vergissNutzerschluessel('bert');

  assert.equal(findeNutzer('bert'), null);
  assert.throws(
    () => alsNutzer('bert', () => entschluessleFuerNutzer(geheim)),
    /keinen Eintrag in nutzer.json/,
  );
});

console.log('\nSitzungen:');

await pruefe('eine eroeffnete Sitzung gehoert ihrem Nutzer', () => {
  const kennung = eroeffneSitzung('anna-mueller');
  assert.equal(nutzerZurSitzung(kennung), 'anna-mueller');
});

await pruefe('eine erfundene Kennung gehoert niemandem', () => {
  assert.equal(nutzerZurSitzung('ausgedacht'), null);
  assert.equal(nutzerZurSitzung(undefined), null);
  assert.equal(nutzerZurSitzung(''), null);
});

await pruefe('die Kennung selbst steht nicht in der Datei', () => {
  /*
   * Nur ihre Pruefsumme. Damit ist sitzungen.json kein Generalschluessel - wer sie aus
   * einer Sicherung zieht, kann daraus keine gueltige Sitzung bauen.
   */
  const kennung = eroeffneSitzung('anna-mueller');
  const roh = fs.readFileSync(path.join(tempDir, 'sitzungen.json'), 'utf-8');
  assert.ok(!roh.includes(kennung), 'die Kennung stand im Klartext in der Datei');
  assert.ok(roh.includes('anna-mueller'));
});

await pruefe('abmelden nimmt genau die eine Sitzung', () => {
  const eine = eroeffneSitzung('anna-mueller');
  const andere = eroeffneSitzung('anna-mueller');
  beendeSitzung(eine);
  assert.equal(nutzerZurSitzung(eine), null);
  assert.equal(nutzerZurSitzung(andere), 'anna-mueller', 'die andere wurde mitgenommen');
});

await pruefe('ueberall abmelden nimmt alle - und nur die des Nutzers', () => {
  const annas = eroeffneSitzung('anna-mueller');
  const zweite = eroeffneSitzung('anna-mueller');
  const fremde = eroeffneSitzung('joerg');

  const weg = beendeAlleSitzungen('anna-mueller');
  assert.ok(weg >= 2);
  assert.equal(nutzerZurSitzung(annas), null);
  assert.equal(nutzerZurSitzung(zweite), null);
  assert.equal(nutzerZurSitzung(fremde), 'joerg', 'eine fremde Sitzung wurde mitgenommen');
});

await pruefe('Sitzungen ueberdauern einen Neustart des Servers', () => {
  // Ein Mailprogramm, das den ganzen Tag offen ist, soll nicht bei jedem Aufspielen
  // einer neuen Fassung alle abmelden.
  const kennung = eroeffneSitzung('joerg');
  vergissSitzungen();
  assert.equal(nutzerZurSitzung(kennung), 'joerg');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
