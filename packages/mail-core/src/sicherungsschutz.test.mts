import assert from 'node:assert/strict';
import {
  SicherungsFehler,
  istVerschlossen,
  oeffneSicherung,
  verschliesseSicherung,
} from './sicherungsschutz.js';

/*
 * Die verschlossene Einstellungssicherung.
 *
 * Wichtig ist hier zweierlei, und beides laesst sich pruefen: dass in der Datei nichts
 * Lesbares mehr steht, und dass ein falsches Kennwort als solches erkannt wird statt als
 * "kaputte Datei". Das zweite entscheidet, ob jemand zwanzigmal dasselbe Kennwort an der
 * falschen Datei probiert.
 */

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

/** Eine Sicherung, wie der Server sie liefert - gekuerzt auf das Empfindliche. */
const SICHERUNG = {
  fassung: 1,
  programm: 'Energy Mail',
  konten: [{ email: 'anna@beispiel.de', imapHost: 'imap.beispiel.de' }],
  kontakte: [{ name: 'Bernd Beispiel', email: 'bernd@fremd.de', telefon: '030 123456' }],
};

const KENNWORT = 'Sechs Pflaumen im Krug';

console.log('\nVerschliessen und oeffnen:');

await pruefe('was hineingeht, kommt wieder heraus', () => {
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  assert.deepEqual(oeffneSicherung(zu, KENNWORT), SICHERUNG);
});

await pruefe('zweimal verschliessen ergibt zweimal etwas anderes', () => {
  // Sonst liesse sich an zwei gleichen Dateien ablesen, dass sich nichts geaendert hat -
  // und bei gleichem Kennwort waeren Salz und IV wiederverwendet, was GCM bricht.
  const a = verschliesseSicherung(SICHERUNG, KENNWORT);
  const b = verschliesseSicherung(SICHERUNG, KENNWORT);
  assert.notEqual(a.verschluesselt.geheim, b.verschluesselt.geheim);
  assert.notEqual(a.verschluesselt.salz, b.verschluesselt.salz);
  assert.notEqual(a.verschluesselt.iv, b.verschluesselt.iv);
});

console.log('\nWas in der Datei steht:');

await pruefe('keine Mailadresse, kein Name, keine Telefonnummer', () => {
  const roh = JSON.stringify(verschliesseSicherung(SICHERUNG, KENNWORT));
  for (const geheim of ['anna@beispiel.de', 'Bernd Beispiel', '030 123456', 'imap.beispiel.de']) {
    assert.ok(!roh.includes(geheim), `"${geheim}" steht noch in der Datei.`);
  }
});

await pruefe('aber sie ist als Energy-Mail-Sicherung erkennbar', () => {
  // Sonst haelt jemand eine Datei in der Hand, der er nicht ansieht, was sie ist.
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  assert.equal(zu.programm, 'Energy Mail');
  assert.ok(zu.erstelltAm.startsWith('20'));
  assert.ok(istVerschlossen(zu));
});

await pruefe('eine alte, offene Sicherung wird nicht faelschlich fuer verschlossen gehalten', () => {
  // Dateien von vor dieser Aenderung muessen weiter einlesbar sein.
  assert.equal(istVerschlossen(SICHERUNG), false);
});

console.log('\nWenn etwas nicht stimmt:');

await pruefe('falsches Kennwort heisst "Kennwort", nicht "kaputt"', () => {
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  try {
    oeffneSicherung(zu, 'Sechs Pflaumen im Kruh');
    assert.fail('Das falsche Kennwort ging durch.');
  } catch (err) {
    assert.ok(err instanceof SicherungsFehler);
    assert.equal(err.art, 'kennwort');
  }
});

await pruefe('ein veraendertes Geheimnis faellt auf', () => {
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  const roh = Buffer.from(zu.verschluesselt.geheim, 'base64');
  roh[0] = roh[0]! ^ 0xff;
  zu.verschluesselt.geheim = roh.toString('base64');
  assert.throws(() => oeffneSicherung(zu, KENNWORT), SicherungsFehler);
});

await pruefe('auch ein veraenderter Kopf faellt auf', () => {
  /*
   * Der lesbare Teil ist mitgezeichnet (AAD). Ohne das koennte jemand den Zeitpunkt
   * aendern, ohne dass es auffiele - und bei einer Datei, die als Nachweis dient, ist
   * genau das der Punkt.
   */
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  zu.erstelltAm = '2001-01-01T00:00:00.000Z';
  assert.throws(() => oeffneSicherung(zu, KENNWORT), SicherungsFehler);
});

await pruefe('herabgesetzte scrypt-Werte oeffnen nichts', () => {
  // Sonst liesse sich die Datei billiger durchprobieren, indem man N kleinschreibt.
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  zu.verschluesselt.N = 2 ** 8;
  assert.throws(() => oeffneSicherung(zu, KENNWORT), SicherungsFehler);
});

await pruefe('eine fremde Datei wird als fremd gemeldet', () => {
  const fremd = {
    programm: 'Etwas anderes',
    schutzFassung: 1,
    erstelltAm: '2026-01-01T00:00:00.000Z',
    verschluesselt: { verfahren: 'x', N: 1, r: 1, p: 1, salz: 'a', iv: 'b', marke: 'c', geheim: 'd' },
  } as never;
  try {
    oeffneSicherung(fremd, KENNWORT);
    assert.fail('Die fremde Datei ging durch.');
  } catch (err) {
    assert.equal((err as SicherungsFehler).art, 'fremd');
  }
});

await pruefe('eine neuere Fassung wird als solche gemeldet', () => {
  const zu = verschliesseSicherung(SICHERUNG, KENNWORT);
  zu.schutzFassung = 99;
  try {
    oeffneSicherung(zu, KENNWORT);
    assert.fail('Die neuere Fassung ging durch.');
  } catch (err) {
    // Der richtige Rat ist "Programm aktualisieren" und nicht "Kennwort noch einmal".
    assert.equal((err as SicherungsFehler).art, 'fassung');
  }
});

console.log('\nSchreibweisen:');

await pruefe('ein Umlaut oeffnet auch in der anderen Schreibweise', () => {
  /*
   * "ü" gibt es als ein Zeichen (U+00FC) und als u + Trema (U+0075 U+0308). Windows
   * liefert das eine, macOS haeufig das andere. Ohne Vereinheitlichung oeffnete ein auf
   * dem Mac getipptes Kennwort die auf Windows geschriebene Datei nicht - und niemand
   * kaeme je darauf, warum.
   */
  const zu = verschliesseSicherung(SICHERUNG, 'Grüße aus Köln');
  assert.deepEqual(oeffneSicherung(zu, 'Grüße aus Köln'), SICHERUNG);
});

await pruefe('ohne Kennwort wird gar nicht erst verschlossen', () => {
  assert.throws(() => verschliesseSicherung(SICHERUNG, ''));
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
