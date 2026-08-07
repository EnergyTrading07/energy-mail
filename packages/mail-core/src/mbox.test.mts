import assert from 'node:assert/strict';
import {
  alsMboxEintrag,
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

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
