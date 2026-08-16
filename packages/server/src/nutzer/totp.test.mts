import assert from 'node:assert/strict';
import {
  SCHRITT_SEKUNDEN,
  base32Dekodiere,
  base32Kodiere,
  erzeugeGeheimnis,
  hotp,
  lesbar,
  otpauthWeg,
  pruefeCode,
  totp,
} from './totp.js';

/*
 * Einmalkennwoerter - gegen Zahlen, die nicht von mir stammen.
 *
 * Das ist der Punkt dieser Datei. Ein selbstgebautes TOTP laesst sich muehelos so pruefen,
 * dass es gegen sich selbst stimmt: erzeugen, pruefen, gruen. Passt es dann nicht zu dem,
 * was der Google Authenticator anzeigt, faellt es erst beim Kunden auf - und zwar als
 * "ich komme nicht mehr rein".
 *
 * Deshalb stehen hier die Pruefvektoren aus RFC 4226 (HOTP), RFC 6238 (TOTP) und RFC 4648
 * (Base32) woertlich drin. Wer sie besteht, rechnet dasselbe wie jede Authenticator-App
 * der Welt.
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

/** Das Geheimnis aller RFC-Beispiele: die ASCII-Zeichen "12345678901234567890". */
const RFC_GEHEIMNIS = Buffer.from('12345678901234567890', 'utf8');
const RFC_BASE32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

console.log('\nBase32 (RFC 4648, Abschnitt 10):');

await pruefe('die Beispiele aus dem RFC stimmen zeichengenau', () => {
  const beispiele: [string, string][] = [
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ];
  for (const [klar, kodiert] of beispiele) {
    assert.equal(base32Kodiere(Buffer.from(klar, 'utf8')), kodiert, `"${klar}"`);
  }
});

await pruefe('und lassen sich zurueckrechnen', () => {
  for (const klar of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
    const hin = base32Kodiere(Buffer.from(klar, 'utf8'));
    assert.equal(base32Dekodiere(hin).toString('utf8'), klar, `"${klar}"`);
  }
});

await pruefe('das RFC-Geheimnis ergibt die bekannte Zeichenkette', () => {
  assert.equal(base32Kodiere(RFC_GEHEIMNIS), RFC_BASE32);
});

await pruefe('Kleinbuchstaben, Leerzeichen und Bindestriche stoeren nicht', () => {
  /*
   * Wer das Geheimnis abtippt, bekommt es in Vierergruppen zu sehen und schreibt die
   * Leerzeichen mit ab. Ein Dekodierer, der daran scheitert, macht aus einer Bequemlichkeit
   * eine Fehlerquelle.
   */
  const zerlegt = lesbar(RFC_BASE32).toLowerCase();
  assert.equal(base32Dekodiere(zerlegt).toString('utf8'), '12345678901234567890');
});

await pruefe('ein fremdes Zeichen ist ein Fehler und keine stille Null', () => {
  // Sonst ergaebe ein Vertipper ein anderes Geheimnis - und der Nutzer bekaeme ein Konto,
  // dessen Codes nie passen, statt einer Meldung.
  assert.throws(() => base32Dekodiere('GEZD0NBV'), /Base32/);
});

console.log('\nHOTP (RFC 4226, Anhang D):');

await pruefe('alle zehn Pruefvektoren stimmen', () => {
  const erwartet = [
    '755224',
    '287082',
    '359152',
    '969429',
    '338314',
    '254676',
    '287922',
    '162583',
    '399871',
    '520489',
  ];
  erwartet.forEach((code, zaehler) => {
    assert.equal(hotp(RFC_GEHEIMNIS, zaehler), code, `Zaehler ${zaehler}`);
  });
});

console.log('\nTOTP (RFC 6238, Anhang B):');

await pruefe('alle sechs Pruefvektoren stimmen - achtstellig, SHA1', () => {
  /*
   * Achtstellig, weil das RFC seine Tabelle so aufschreibt. Gerechnet wird dasselbe; die
   * Stellenzahl ist nur der Rest am Ende. Der letzte Wert liegt jenseits von 2^32 Sekunden
   * und faellt um, wenn der Zaehler nicht als 64-Bit-Zahl geschrieben wird.
   */
  const vektoren: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [sekunden, code] of vektoren) {
    assert.equal(totp(RFC_BASE32, sekunden * 1000, 8), code, `T=${sekunden}`);
  }
});

console.log('\nDie Pruefung eines Codes:');

const SCHRITT_MS = SCHRITT_SEKUNDEN * 1000;
const JETZT = 1_770_000_000_000;

await pruefe('der aktuelle Code passt', () => {
  assert.notEqual(pruefeCode(RFC_BASE32, totp(RFC_BASE32, JETZT), JETZT), null);
});

await pruefe('der vorige und der naechste auch - eine Uhr geht selten genau', () => {
  assert.notEqual(pruefeCode(RFC_BASE32, totp(RFC_BASE32, JETZT - SCHRITT_MS), JETZT), null);
  assert.notEqual(pruefeCode(RFC_BASE32, totp(RFC_BASE32, JETZT + SCHRITT_MS), JETZT), null);
});

await pruefe('der uebernaechste nicht mehr', () => {
  assert.equal(pruefeCode(RFC_BASE32, totp(RFC_BASE32, JETZT + 2 * SCHRITT_MS), JETZT), null);
  assert.equal(pruefeCode(RFC_BASE32, totp(RFC_BASE32, JETZT - 2 * SCHRITT_MS), JETZT), null);
});

await pruefe('zurueck kommt der Schritt, nicht nur ein Ja', () => {
  /*
   * Daran haengt der Schutz gegen ein zweites Einloesen desselben Codes. Wer nur ein `true`
   * bekaeme, koennte sich die Nummer nicht merken - und TOTP waere ein Kennwort mit dreissig
   * Sekunden Haltbarkeit, das jeder Mitleser noch einmal benutzen kann.
   */
  const schritt = pruefeCode(RFC_BASE32, totp(RFC_BASE32, JETZT), JETZT);
  assert.equal(schritt, Math.floor(JETZT / 1000 / SCHRITT_SEKUNDEN));
});

await pruefe('Leerzeichen im eingetippten Code stoeren nicht', () => {
  const code = totp(RFC_BASE32, JETZT);
  assert.notEqual(pruefeCode(RFC_BASE32, `${code.slice(0, 3)} ${code.slice(3)}`, JETZT), null);
});

await pruefe('Unsinn ergibt null statt einer Ausnahme', () => {
  for (const eingabe of ['', 'abcdef', '12345', '1234567', '  ', '12345a']) {
    assert.equal(pruefeCode(RFC_BASE32, eingabe, JETZT), null, `"${eingabe}"`);
  }
});

await pruefe('ein kaputtes Geheimnis ergibt null statt einer Ausnahme', () => {
  // Sonst brechen die Anmeldung und die Fehlermeldung an einer Stelle ab, an der ein
  // schlichtes "stimmt nicht" die richtige Antwort ist.
  assert.equal(pruefeCode('nicht base32!', '123456', JETZT), null);
});

console.log('\nDas Geheimnis und sein Weg:');

await pruefe('ein frisches Geheimnis hat 160 Bit und keine Fuellzeichen', () => {
  const g = erzeugeGeheimnis();
  assert.equal(g.length, 32, g);
  assert.ok(!g.includes('='), 'Fuellzeichen gehoeren nicht in einen otpauth-Weg.');
  assert.equal(base32Dekodiere(g).length, 20);
});

await pruefe('zwei Geheimnisse sind nie dasselbe', () => {
  const gesehen = new Set(Array.from({ length: 50 }, () => erzeugeGeheimnis()));
  assert.equal(gesehen.size, 50);
});

await pruefe('der otpauth-Weg traegt Aussteller, Kennung und Geheimnis', () => {
  const weg = otpauthWeg('anna@beispiel.de', RFC_BASE32);
  assert.equal(
    weg,
    'otpauth://totp/Energy%20Mail:anna%40beispiel.de' +
      `?secret=${RFC_BASE32}&issuer=Energy%20Mail`,
  );
});

await pruefe('das Geheimnis steht in Vierergruppen zum Abtippen', () => {
  assert.equal(lesbar('ABCDEFGH'), 'ABCD EFGH');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
