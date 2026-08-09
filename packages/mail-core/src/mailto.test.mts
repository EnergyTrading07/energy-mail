import assert from 'node:assert/strict';
import { leseMailto, mailtoAusArgumenten } from './mailto.js';

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

console.log('\nEine mailto-Adresse lesen:');

pruefe('nur eine Adresse', () => {
  const a = leseMailto('mailto:anna@beispiel.de');
  assert.deepEqual(a?.an, ['anna@beispiel.de']);
  assert.equal(a?.betreff, undefined);
});

pruefe('mehrere Empfaenger', () => {
  const a = leseMailto('mailto:anna@beispiel.de,bert@beispiel.de');
  assert.deepEqual(a?.an, ['anna@beispiel.de', 'bert@beispiel.de']);
});

pruefe('Betreff und Text', () => {
  const a = leseMailto('mailto:a@b.de?subject=Rechnung%20M%C3%A4rz&body=Hallo%0AWelt');
  assert.equal(a?.betreff, 'Rechnung März');
  assert.equal(a?.text, 'Hallo\nWelt');
});

pruefe('Kopie und Blindkopie', () => {
  const a = leseMailto('mailto:a@b.de?cc=c@d.de,e@f.de&bcc=g@h.de');
  assert.deepEqual(a?.kopie, ['c@d.de', 'e@f.de']);
  assert.deepEqual(a?.blindkopie, ['g@h.de']);
});

pruefe('ein zusaetzliches to-Feld kommt zum Pfad DAZU', () => {
  // RFC 6068: beide gelten. Das eine statt des anderen zu nehmen verlöre einen Empfänger.
  const a = leseMailto('mailto:a@b.de?to=c@d.de');
  assert.deepEqual(a?.an, ['a@b.de', 'c@d.de']);
});

pruefe('ein leeres mailto: ist gueltig', () => {
  // Der "Schreiben Sie uns"-Verweis mancher Webseite sieht genau so aus.
  const a = leseMailto('mailto:');
  assert.deepEqual(a?.an, []);
  assert.ok(a, 'und ergibt einen leeren Entwurf, nicht null');
});

pruefe('Grossschreibung des Schemas stoert nicht', () => {
  assert.ok(leseMailto('MAILTO:a@b.de'));
});

pruefe('was keine mailto-Adresse ist, ergibt null', () => {
  assert.equal(leseMailto('https://beispiel.de'), null);
  assert.equal(leseMailto(''), null);
  assert.equal(leseMailto('C:\\Programme\\energy-mail.exe'), null);
});

console.log('\nStellen, an denen man es leicht falsch macht:');

pruefe('"+" bleibt ein Plus und wird KEIN Leerzeichen', () => {
  /*
   * Der klassische Fehler: decodeURIComponent laesst "+" stehen, aber wer die Abfrage
   * wie Formulardaten behandelt, macht ein Leerzeichen daraus. Aus der gueltigen
   * Adresse "anna+werbung@beispiel.de" wuerde dann "anna werbung@beispiel.de" - eine,
   * die es nicht gibt.
   */
  const a = leseMailto('mailto:anna+werbung@beispiel.de');
  assert.deepEqual(a?.an, ['anna+werbung@beispiel.de']);
});

pruefe('fremde Kopfzeilen kommen nicht durch', () => {
  /*
   * RFC 6068 erlaubt weitere Felder, warnt aber selbst davor. Eine Webseite koennte
   * sonst ueber "from" den Absender faelschen oder ueber eine eigene Kopfzeile etwas in
   * die Nachricht schreiben, das der Nutzer nicht sieht.
   */
  const a = leseMailto('mailto:a@b.de?from=chef@firma.de&reply-to=boese@example.org&x-was=weiss');
  assert.deepEqual(a?.an, ['a@b.de']);
  assert.deepEqual(Object.keys(a ?? {}).sort(), ['an', 'blindkopie', 'kopie']);
});

pruefe('eine kaputt kodierte Adresse wirft nicht', () => {
  // %E0%A4%A ist unvollstaendig - decodeURIComponent wuerde werfen.
  const a = leseMailto('mailto:a@b.de?subject=%E0%A4%A');
  assert.ok(a, 'es kommt trotzdem ein Entwurf heraus');
});

pruefe('Leeres zwischen Kommas faellt weg', () => {
  const a = leseMailto('mailto:a@b.de,,  ,c@d.de');
  assert.deepEqual(a?.an, ['a@b.de', 'c@d.de']);
});

pruefe('ein Feld ohne Wert wird uebergangen', () => {
  const a = leseMailto('mailto:a@b.de?subject');
  assert.equal(a?.betreff, undefined);
});

console.log('\nAus der Befehlszeile heraussuchen:');

pruefe('findet die Adresse zwischen anderen Argumenten', () => {
  const a = mailtoAusArgumenten([
    'C:\\Programme\\Energy Mail\\Energy Mail.exe',
    '--irgendwas',
    'mailto:a@b.de?subject=Hallo',
  ]);
  assert.deepEqual(a?.an, ['a@b.de']);
  assert.equal(a?.betreff, 'Hallo');
});

pruefe('ohne Adresse kommt null heraus', () => {
  assert.equal(mailtoAusArgumenten(['energy-mail.exe', '--energy-mail-fassung=0.2.1']), null);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
