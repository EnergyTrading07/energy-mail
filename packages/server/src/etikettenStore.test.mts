import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';

// Vor dem ersten Zugriff umlenken, sonst landet die Probe im echten Benutzerordner.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-etiketten-test-'));
setDataDir(tempDir);

const { alleEtiketten, loescheEtikett, speichereEtikett, EtikettFehler } = await import(
  './etikettenStore.js'
);
const { alleSuchen, loescheSuche, speichereSuche, SucheFehler } = await import(
  './gespeicherteSuchen.js'
);
const { beschreibeSuche } = await import('@energy-mail/mail-core');

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void): void {
  // Jede Pruefung faengt bei null an - einschliesslich der Begleitdateien, die das
  // atomare Schreiben anlegt (.bak, .neu) und der beiseite gelegten Fassungen.
  for (const datei of fs.readdirSync(tempDir)) {
    if (datei.startsWith('etiketten.json') || datei.startsWith('suchen.json')) {
      fs.rmSync(path.join(tempDir, datei), { force: true });
    }
  }
  try {
    fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

console.log('\nDas Verzeichnis der Etiketten:');

pruefe('beim ersten Start stehen die fuenf von Thunderbird da', () => {
  const etiketten = alleEtiketten();
  assert.equal(etiketten.length, 5);
  assert.deepEqual(
    etiketten.map((e) => e.schluessel),
    ['$label1', '$label2', '$label3', '$label4', '$label5'],
  );
});

pruefe('ein neues Etikett bekommt ein taugliches Schluesselwort', () => {
  const neu = speichereEtikett({ name: 'Steuer 2026' });
  assert.equal(neu.name, 'Steuer 2026');
  assert.match(neu.schluessel, /^[a-z0-9_]+$/, `war: ${neu.schluessel}`);
  assert.ok(neu.farbe.startsWith('#'));
  assert.equal(alleEtiketten().length, 6);
});

pruefe('derselbe Name zweimal geht nicht', () => {
  speichereEtikett({ name: 'Steuer' });
  assert.throws(() => speichereEtikett({ name: 'steuer' }), EtikettFehler);
});

pruefe('ein leerer Name geht nicht', () => {
  assert.throws(() => speichereEtikett({ name: '  ' }), EtikettFehler);
});

pruefe('beim Umbenennen bleibt das Schluesselwort stehen', () => {
  // Es steht auf dem Mailserver an jeder Nachricht - es mitzuaendern hiesse, saemtliche
  // Nachrichten anzufassen, und ohne Verbindung ginge es gar nicht.
  const neu = speichereEtikett({ name: 'Steuer' });
  const umbenannt = speichereEtikett({ schluessel: neu.schluessel, name: 'Finanzamt' });

  assert.equal(umbenannt.schluessel, neu.schluessel);
  assert.equal(umbenannt.name, 'Finanzamt');
  assert.equal(alleEtiketten().length, 6, 'es wurde ein zweites angelegt');
});

pruefe('die Farbe laesst sich aendern', () => {
  const geaendert = speichereEtikett({ schluessel: '$label1', name: 'Wichtig', farbe: '#123456' });
  assert.equal(geaendert.farbe, '#123456');
  assert.equal(alleEtiketten().find((e) => e.schluessel === '$label1')?.farbe, '#123456');
});

pruefe('ein Etikett, das es nicht gibt, laesst sich nicht umbenennen', () => {
  assert.throws(() => speichereEtikett({ schluessel: 'gibtesnicht', name: 'Neu' }), EtikettFehler);
});

pruefe('loeschen nimmt es aus dem Verzeichnis', () => {
  assert.equal(loescheEtikett('$label5'), true);
  assert.equal(alleEtiketten().length, 4);
  assert.equal(loescheEtikett('$label5'), false);
});

pruefe('der Stand ueberdauert einen Neustart', () => {
  speichereEtikett({ name: 'Bleibt' });
  const wieder = JSON.parse(fs.readFileSync(path.join(tempDir, 'etiketten.json'), 'utf-8'));
  assert.ok(wieder.etiketten.some((e: { name: string }) => e.name === 'Bleibt'));
});

/*
 * Diese beiden Pruefungen standen vorher als eine da, und sie forderte das Falsche ein:
 * "eine beschaedigte Datei faellt auf die Voreinstellung zurueck". Genau das war der
 * Schaden - der naechste Schreibvorgang schrieb die Voreinstellung ueber die kaputte
 * Datei, und alle selbst angelegten Etiketten waren endgueltig weg. Richtig ist: erst
 * die Sicherungskopie versuchen, und nur wenn auch die nichts hergibt, neu anfangen.
 */
pruefe('eine beschaedigte Datei wird aus der Sicherungskopie geheilt', () => {
  // Zweimal schreiben: der zweite Schreibvorgang legt den ersten Stand als .bak ab.
  speichereEtikett({ name: 'Bleibt' });
  speichereEtikett({ name: 'Auch' });
  const vorher = alleEtiketten().length;
  assert.ok(vorher > 5, 'Voraussetzung: es gibt mehr als die Vorgaben');

  fs.writeFileSync(path.join(tempDir, 'etiketten.json'), '{kaputt', 'utf-8');

  const geheilt = alleEtiketten();
  assert.ok(
    geheilt.some((e) => e.name === 'Bleibt'),
    'das selbst angelegte Etikett ist noch da',
  );
  assert.ok(
    alleEtiketten().some((e) => e.name === 'Bleibt'),
    'und auch beim zweiten Lesen - die Datei wurde wirklich geheilt, nicht nur umgangen',
  );
});

pruefe('die kaputte Datei wird beiseite gelegt, nicht ueberschrieben', () => {
  speichereEtikett({ name: 'Bleibt' });
  speichereEtikett({ name: 'Auch' });
  fs.writeFileSync(path.join(tempDir, 'etiketten.json'), '{kaputt', 'utf-8');
  alleEtiketten();

  const beiseite = fs.readdirSync(tempDir).filter((n) => n.includes('etiketten.json.kaputt-'));
  assert.equal(beiseite.length, 1, 'genau eine beiseite gelegte Fassung');
  assert.equal(
    fs.readFileSync(path.join(tempDir, beiseite[0]!), 'utf-8'),
    '{kaputt',
    'und zwar unveraendert - daraus laesst sich von Hand noch etwas retten',
  );
});

pruefe('ohne Sicherungskopie bleibt nur die Voreinstellung', () => {
  fs.writeFileSync(path.join(tempDir, 'etiketten.json'), '{kaputt', 'utf-8');
  assert.equal(alleEtiketten().length, 5);
});

console.log('\nGespeicherte Suchen:');

pruefe('anlegen und wiederfinden', () => {
  const suche = speichereSuche({ name: 'Von der Bank', kriterien: { from: 'sparkasse' } });
  assert.ok(suche.id);
  assert.equal(alleSuchen().length, 1);
  assert.equal(alleSuchen()[0]?.kriterien.from, 'sparkasse');
});

pruefe('ohne Namen geht es nicht', () => {
  assert.throws(() => speichereSuche({ name: ' ', kriterien: { from: 'x' } }), SucheFehler);
});

pruefe('ohne Bedingung geht es nicht', () => {
  // Sie faende alles - das ist der Ordner selbst.
  assert.throws(() => speichereSuche({ name: 'Alles', kriterien: {} }), SucheFehler);
});

pruefe('leere Felder werden verworfen, nicht gespeichert', () => {
  // Ein leeres Feld verhielte sich beim Ausfuehren anders als ein fehlendes: IMAP suchte
  // dann nach dem leeren Wort.
  const suche = speichereSuche({
    name: 'Nur Absender',
    kriterien: { from: 'bank', text: '   ', subject: '' },
  });
  assert.deepEqual(Object.keys(suche.kriterien), ['from']);
});

pruefe('derselbe Name zweimal geht nicht', () => {
  speichereSuche({ name: 'Rechnungen', kriterien: { subject: 'Rechnung' } });
  assert.throws(
    () => speichereSuche({ name: 'rechnungen', kriterien: { subject: 'Beleg' } }),
    SucheFehler,
  );
});

pruefe('aendern legt keine zweite an', () => {
  const suche = speichereSuche({ name: 'Rechnungen', kriterien: { subject: 'Rechnung' } });
  speichereSuche({ id: suche.id, name: 'Belege', kriterien: { subject: 'Beleg' } });

  assert.equal(alleSuchen().length, 1);
  assert.equal(alleSuchen()[0]?.name, 'Belege');
});

pruefe('loeschen entfernt sie', () => {
  const suche = speichereSuche({ name: 'Weg damit', kriterien: { from: 'x' } });
  assert.equal(loescheSuche(suche.id), true);
  assert.equal(alleSuchen().length, 0);
  assert.equal(loescheSuche(suche.id), false);
});

pruefe('Konto und Ordner werden mitgespeichert', () => {
  const suche = speichereSuche({
    name: 'Nur im Archiv',
    accountId: 'konto1',
    folder: 'Archiv',
    kriterien: { text: 'Vertrag' },
  });
  assert.equal(suche.accountId, 'konto1');
  assert.equal(suche.folder, 'Archiv');
});

console.log('\nEine Suche in einem Satz beschreiben:');

pruefe('nennt alle gesetzten Bedingungen', () => {
  const text = beschreibeSuche({ from: 'bank', unreadOnly: true, since: '2026-01-01' });
  assert.ok(text.includes('von bank'), text);
  assert.ok(text.includes('nur ungelesen'), text);
  assert.ok(text.includes('ab 2026-01-01'), text);
});

pruefe('nennt das Etikett bei seinem Namen, nicht beim Schluesselwort', () => {
  assert.ok(
    beschreibeSuche({ etikett: '$label1' }, [
      { schluessel: '$label1', name: 'Wichtig', farbe: '#000' },
    ]).includes('Wichtig'),
  );
});

pruefe('ohne Bedingung heisst es "alles"', () => {
  assert.equal(beschreibeSuche({}), 'alles');
});

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Pruefungen bestanden`);
if (gescheitert > 0) process.exit(1);
