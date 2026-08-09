import assert from 'node:assert/strict';
import {
  alsMboxEintrag,
  alsMboxEintragBytes,
  dateiname,
  entschaerfeFromZeilen,
  leseMbox,
  mboxTrennzeile,
  stelleFromZeilenHer,
} from './mbox.js';

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void): void {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

console.log('\nDie Tuecke des Formats - Zeilen, die mit "From " beginnen:');

pruefe('eine solche Zeile wird entschaerft', () => {
  // Ohne das zerfiele die Nachricht beim Einlesen genau hier in zwei.
  assert.equal(entschaerfeFromZeilen('Hallo\nFrom here on we agree\nGruss'), 'Hallo\n>From here on we agree\nGruss');
});

pruefe('eine bereits entschaerfte bekommt ein weiteres Zeichen', () => {
  // Sonst waere beim Zuruecklesen nicht zu unterscheiden, ob das ">" zum Text gehoerte.
  assert.equal(entschaerfeFromZeilen('>From here'), '>>From here');
  assert.equal(entschaerfeFromZeilen('>>From here'), '>>>From here');
});

pruefe('nur am Zeilenanfang', () => {
  assert.equal(entschaerfeFromZeilen('Ein Gruss From mir'), 'Ein Gruss From mir');
});

pruefe('"Fromage" ist kein Zeilenanfang im Sinne des Formats', () => {
  // Es braucht das Leerzeichen dahinter.
  assert.equal(entschaerfeFromZeilen('Fromage ist Kaese'), 'Fromage ist Kaese');
});

pruefe('das Entschaerfen laesst sich rueckgaengig machen', () => {
  for (const text of ['From a', '>From a', '>>From a', 'Hallo\nFrom b\n>From c']) {
    assert.equal(stelleFromZeilenHer(entschaerfeFromZeilen(text)), text, `bei "${text}"`);
  }
});

console.log('\nDie Trennzeile:');

pruefe('Aufbau und Datumsformat', () => {
  const z = mboxTrennzeile('anna@firma.de', new Date(Date.UTC(2026, 0, 1, 9, 5, 3)));
  assert.equal(z, 'From anna@firma.de Thu Jan  1 09:05:03 2026');
});

pruefe('einstellige Tage bekommen zwei Leerzeichen', () => {
  // So schreibt es asctime vor - ein Programm, das die Spalten zaehlt, verliesse sich darauf.
  assert.match(mboxTrennzeile('a@b.de', new Date(Date.UTC(2026, 4, 7))), /May {2}7 /);
  assert.match(mboxTrennzeile('a@b.de', new Date(Date.UTC(2026, 4, 17))), /May 17 /);
});

pruefe('ein Absender mit Leerzeichen zerlegt die Zeile nicht', () => {
  // An dieser Stelle erwartet das Format genau ein Wort - ein Leerzeichen darin
  // verschoebe alles Folgende um eine Spalte.
  const z = mboxTrennzeile('Anna Muster', new Date(Date.UTC(2026, 0, 1)));
  assert.equal(z, 'From Anna_Muster Thu Jan  1 00:00:00 2026');
  const wer = z.slice('From '.length).split(' ')[0];
  assert.equal(wer, 'Anna_Muster');
});

pruefe('ohne Absender und ohne Datum bleibt sie gueltig', () => {
  const z = mboxTrennzeile(undefined, null);
  assert.match(z, /^From unbekannt \w{3} \w{3} /);
});

console.log('\nEin Eintrag:');

pruefe('Trennzeile, Inhalt, Leerzeile', () => {
  const e = alsMboxEintrag('Subject: Test\n\nHallo', 'a@b.de', new Date(Date.UTC(2026, 0, 1)));
  assert.match(e, /^From a@b\.de /);
  assert.match(e, /Subject: Test/);
  assert.ok(e.endsWith('\n\n'), 'die trennende Leerzeile fehlt');
});

pruefe('Zeilenenden werden vereinheitlicht', () => {
  // Ueber die Leitung kommt CRLF; in der Datei stoert das lesende Programme.
  const e = alsMboxEintrag('Subject: A\r\n\r\nHallo\r\n', 'a@b.de', null);
  assert.ok(!e.includes('\r'), 'es sind noch Wagenruecklaeufe drin');
});

console.log('\nWieder einlesen:');

pruefe('eine Datei mit drei Nachrichten', () => {
  const datei =
    alsMboxEintrag('Subject: Eins\n\nText eins', 'a@b.de', new Date(Date.UTC(2026, 0, 1))) +
    alsMboxEintrag('Subject: Zwei\n\nText zwei', 'c@d.de', new Date(Date.UTC(2026, 0, 2))) +
    alsMboxEintrag('Subject: Drei\n\nText drei', 'e@f.de', new Date(Date.UTC(2026, 0, 3)));

  const wieder = leseMbox(datei);
  assert.equal(wieder.length, 3);
  assert.match(wieder[0]!, /Subject: Eins/);
  assert.match(wieder[2]!, /Text drei/);
});

pruefe('eine Nachricht mit "From " im Text bleibt eine', () => {
  // Das ist der Fall, der ohne Entschaerfung zwei Nachrichten ergaebe.
  const datei = alsMboxEintrag(
    'Subject: Vertrag\n\nFrom here on we agree\nUnd noch eine Zeile',
    'a@b.de',
    new Date(Date.UTC(2026, 0, 1)),
  );
  const wieder = leseMbox(datei);
  assert.equal(wieder.length, 1, 'die Nachricht ist zerfallen');
  assert.match(wieder[0]!, /^Subject: Vertrag/m);
  assert.match(wieder[0]!, /^From here on we agree$/m, 'der Text kam nicht unveraendert zurueck');
});

pruefe('der Inhalt kommt Zeichen fuer Zeichen zurueck', () => {
  const original = 'Subject: Test\nFrom: a@b.de\n\nHallo\n>From dir\nFrom mir\n\nGruss';
  const wieder = leseMbox(alsMboxEintrag(original, 'a@b.de', new Date()));
  assert.equal(wieder[0], original);
});

pruefe('eine leere Datei ergibt nichts', () => {
  assert.deepEqual(leseMbox(''), []);
  assert.deepEqual(leseMbox('\n\n\n'), []);
});

console.log('\nDateinamen:');

pruefe('Zeichen, die Windows nicht mag, fallen weg', () => {
  const n = dateiname('[Gmail]/Alle Nachrichten', 'mbox');
  assert.ok(!/[<>:"/\\|?*]/.test(n), n);
  assert.match(n, /\.mbox$/);
});

pruefe('das Datum steht mit drin', () => {
  assert.match(dateiname('INBOX', 'mbox'), /^INBOX-\d{4}-\d{2}-\d{2}\.mbox$/);
});

pruefe('ein leerer Ordnername ergibt trotzdem einen Namen', () => {
  assert.match(dateiname('', 'eml'), /^Ordner-\d{4}-\d{2}-\d{2}\.eml$/);
});

/*
 * Die Sicherung darf keine Bytes verlieren.
 *
 * Vorher lief die Nachricht durch Buffer.concat(...).toString('utf-8'). Jedes Byte, das
 * kein gueltiges UTF-8 ergibt, wurde dabei durch U+FFFD ersetzt - unumkehrbar. Betroffen
 * war alles mit "Content-Transfer-Encoding: 8bit" und ISO-8859-1-Text sowie jeder
 * binaere Anhang. Ausgerechnet in der Funktion, die der einzige Ausweg aus dem Programm
 * ist.
 */
console.log('\nDie Sicherung fasst die Bytes nicht an:');

pruefe('ein ISO-8859-1-Umlaut ueberlebt unveraendert', () => {
  // 0xFC ist "ü" in ISO-8859-1 und allein kein gueltiges UTF-8.
  const roh = Buffer.concat([
    Buffer.from('From: a@b.de\r\nSubject: Gr', 'ascii'),
    Buffer.from([0xfc]),
    Buffer.from('sse\r\n\r\nText\r\n', 'ascii'),
  ]);
  const eintrag = alsMboxEintragBytes(roh, 'a@b.de', null);
  assert.ok(eintrag.includes(0xfc), 'das Byte steht noch da');
  assert.ok(!eintrag.includes(Buffer.from([0xef, 0xbf, 0xbd])), 'und wurde nicht ersetzt');
});

pruefe('der alte Weg zeigt, was verloren ging', () => {
  // Zum Vergleich - so sah es vorher aus, und genau das ist der Schaden.
  const roh = Buffer.from([0xfc]);
  assert.equal(roh.toString('utf-8'), '�');
});

pruefe('binaere Bytes bleiben binaer', () => {
  const roh = Buffer.concat([
    Buffer.from('From: a@b.de\r\n\r\n', 'ascii'),
    Buffer.from([0x00, 0x01, 0x80, 0xff, 0xfe]),
  ]);
  const eintrag = alsMboxEintragBytes(roh, 'a@b.de', null);
  for (const b of [0x00, 0x01, 0x80, 0xff, 0xfe]) {
    assert.ok(eintrag.includes(b), `Byte 0x${b.toString(16)} fehlt`);
  }
});

pruefe('"From "-Zeilen werden auch byteweise entschaerft', () => {
  const roh = Buffer.from('From: a@b.de\r\n\r\nFrom hier geht es weiter\r\n', 'ascii');
  const text = alsMboxEintragBytes(roh, 'a@b.de', null).toString('latin1');
  assert.ok(text.includes('\n>From hier geht es weiter\n'));
});

pruefe('und die Entschaerfung ist umkehrbar', () => {
  const original = 'From: a@b.de\r\n\r\nFrom hier\r\n>From schon entschaerft\r\n';
  const datei = alsMboxEintragBytes(Buffer.from(original, 'ascii'), 'a@b.de', null);
  const [wieder] = leseMbox(datei.toString('latin1'));
  assert.ok(wieder?.includes('From hier'));
  assert.ok(wieder?.includes('>From schon entschaerft'));
});

pruefe('der Zeichenketten-Weg bleibt fuer das Einlesen erhalten', () => {
  // alsMboxEintrag wird weiterhin gebraucht - nur nicht mehr fuer die Sicherung.
  assert.ok(alsMboxEintrag('From: a@b.de\n\nText', 'a@b.de', null).includes('Text'));
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
