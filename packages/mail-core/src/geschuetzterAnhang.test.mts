import assert from 'node:assert/strict';
import { baueSigniertenTeil, leseGrenze } from './pgpErkennung.js';

/**
 * Der unterschriebene Teil mit Anhängen.
 *
 * Geprüft wird die Struktur und nicht das Rechnen: Ob eine Unterschrift gilt, entscheidet
 * OpenPGP beziehungsweise das CMS darunter - hier steht die Frage, ob die Bytes, die
 * unterschrieben werden, überhaupt eine gültige MIME-Einheit ergeben. Genau daran hängt
 * alles Weitere: Was der Empfänger als Anhang sieht, ist genau das, was hier gebaut wurde,
 * und was die Unterschrift abdeckt, ebenfalls.
 */

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

console.log('\nGeschuetzter Teil mit Anhaengen:');

pruefe('ohne Anhang bleibt es der schlichte Textteil', () => {
  const teil = baueSigniertenTeil('Hallo Welt');
  assert.match(teil, /^Content-Type: text\/plain; charset=utf-8\r\n/);
  assert.match(teil, /Content-Transfer-Encoding: quoted-printable/);
  // Kein mehrteiliger Umschlag, wo es nichts zu umschliessen gibt.
  assert.equal(teil.includes('multipart/mixed'), false);
});

pruefe('mit Anhang wird daraus multipart/mixed', () => {
  const teil = baueSigniertenTeil('Die Rechnung liegt bei.', [
    { filename: 'rechnung.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' },
  ]);
  assert.match(teil, /^Content-Type: multipart\/mixed; boundary="/);

  const grenze = leseGrenze(teil.split('\r\n')[0]!.replace('Content-Type: ', ''));
  assert.ok(grenze, 'Die Grenze muss aus der Kopfzeile lesbar sein');

  // Zwei oeffnende Marken und genau eine schliessende.
  const oeffnend = teil.split(`--${grenze}\r\n`).length - 1;
  assert.equal(oeffnend, 2, 'Textteil und Anhang');
  assert.ok(teil.endsWith(`--${grenze}--\r\n`), 'Der Umschlag muss geschlossen sein');
});

pruefe('der Text bleibt als eigener Teil erhalten', () => {
  const teil = baueSigniertenTeil('Guten Tag', [
    { filename: 'a.txt', content: Buffer.from('x'), contentType: 'text/plain' },
  ]);
  assert.match(teil, /Content-Type: text\/plain; charset=utf-8/);
  assert.ok(teil.includes('Guten Tag'), 'Der Text steht quoted-printable im ersten Teil');
});

pruefe('der Anhang steht base64 und als Anlage gekennzeichnet', () => {
  const inhalt = Buffer.from('Hallo Anhang');
  const teil = baueSigniertenTeil('Text', [
    { filename: 'notiz.txt', content: inhalt, contentType: 'text/plain' },
  ]);
  assert.match(teil, /Content-Transfer-Encoding: base64/);
  assert.match(teil, /Content-Disposition: attachment; filename="notiz\.txt"/);
  assert.ok(teil.includes(inhalt.toString('base64')), 'Die Bytes muessen base64 drinstehen');
});

pruefe('ohne Angabe gilt der unverfaengliche Typ', () => {
  const teil = baueSigniertenTeil('Text', [{ filename: 'x.bin', content: Buffer.from([1, 2, 3]) }]);
  assert.match(teil, /Content-Type: application\/octet-stream/);
});

pruefe('Umlaute im Dateinamen gehen zweimal hinaus', () => {
  const teil = baueSigniertenTeil('Text', [
    { filename: 'Rechnung März.pdf', content: Buffer.from('x'), contentType: 'application/pdf' },
  ]);
  /*
   * Einmal in ASCII fuer jedes Programm, einmal nach RFC 2231 mit den Umlauten. Wer nur
   * eines mitschickt, verliert entweder die alten Empfaenger oder die Umlaute.
   */
  assert.match(teil, /filename="Rechnung M_rz\.pdf"/);
  assert.match(teil, /filename\*=UTF-8''Rechnung%20M%C3%A4rz\.pdf/);
});

pruefe('ein Anfuehrungszeichen im Dateinamen bricht die Kopfzeile nicht auf', () => {
  const teil = baueSigniertenTeil('Text', [
    { filename: 'bo"se.txt', content: Buffer.from('x'), contentType: 'text/plain' },
  ]);
  // Sonst endete filename="…" vorzeitig und der Rest stuende als eigene Angabe da.
  assert.equal(teil.includes('filename="bo"se.txt"'), false);
  assert.match(teil, /filename="bose\.txt"/);
});

pruefe('mehrere Anhaenge bekommen je einen Teil', () => {
  const teil = baueSigniertenTeil('Text', [
    { filename: 'a.txt', content: Buffer.from('aaa'), contentType: 'text/plain' },
    { filename: 'b.txt', content: Buffer.from('bbb'), contentType: 'text/plain' },
    { filename: 'c.txt', content: Buffer.from('ccc'), contentType: 'text/plain' },
  ]);
  const grenze = leseGrenze(teil.split('\r\n')[0]!.replace('Content-Type: ', ''));
  assert.equal(teil.split(`--${grenze}\r\n`).length - 1, 4, 'Text plus drei Dateien');
  for (const wort of ['aaa', 'bbb', 'ccc']) {
    assert.ok(teil.includes(Buffer.from(wort).toString('base64')));
  }
});

pruefe('lange Anhaenge werden auf 76 Zeichen umgebrochen', () => {
  const teil = baueSigniertenTeil('Text', [
    { filename: 'gross.bin', content: Buffer.alloc(1000, 7), contentType: 'application/octet-stream' },
  ]);
  /*
   * Nur die Base64-Zeilen, nicht die Kopfzeilen.
   *
   * Fuer den Rumpf gilt RFC 2045 mit 76 Zeichen, und manche Server schneiden laengere ab.
   * Kopfzeilen duerfen nach RFC 5322 bis 998 lang sein - die Content-Type-Zeile mit der
   * Grenze darin ist gut achtzig Zeichen lang und muss es sein.
   */
  const base64Zeilen = teil.split('\r\n').filter((z) => /^[A-Za-z0-9+/]+=*$/.test(z) && z.length > 4);
  assert.ok(base64Zeilen.length > 10, 'Es muss genug Base64 zum Pruefen geben');
  for (const zeile of base64Zeilen) {
    assert.ok(zeile.length <= 76, `Zeile zu lang (${zeile.length})`);
  }
});

pruefe('jeder Aufruf bekommt eine eigene Grenze', () => {
  const anhang = [{ filename: 'a.txt', content: Buffer.from('x'), contentType: 'text/plain' }];
  const eins = leseGrenze(baueSigniertenTeil('T', anhang).split('\r\n')[0]!.replace('Content-Type: ', ''));
  const zwei = leseGrenze(baueSigniertenTeil('T', anhang).split('\r\n')[0]!.replace('Content-Type: ', ''));
  assert.notEqual(eins, zwei);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
