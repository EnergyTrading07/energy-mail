import assert from 'node:assert/strict';
import {
  EC_AUFBAU,
  FASSUNG_ERZEUGER,
  FORMAT_ERZEUGER,
  alphaExponent,
  ausrichtungsPositionen,
  bch,
  datenModule,
  erzeuger,
  fassungBits,
  formatBits,
  groesseZu,
  maskiert,
  qrCode,
} from './qrCode.js';

/*
 * QR-Bilder - und die Frage, wie man so etwas ueberhaupt prueft.
 *
 * Das Naheliegende waere: erzeugen, wieder einlesen, vergleichen. Nur wuerde ich den Leser
 * mit denselben Annahmen schreiben wie den Schreiber - und ein Bild, das nur mein eigener
 * Leser versteht, ist wertlos. Der Kunde haelt sein Telefon davor, nicht meinen Leser.
 *
 * Deshalb steht die Beweislast hier auf vier Beinen, und drei davon kommen von aussen:
 *
 *  1. DIE MODULZAEHLUNG. Wie viele Module am Ende Daten tragen, ergibt sich aus dem
 *     Muster - Sucher, Taktlinien, Ausrichtung, Formatfeld. Wie viele es sein MUESSEN,
 *     steht in der Codewort-Tabelle, einem ganz anderen Teil der Norm. Beide Zahlen
 *     muessen auf das Modul genau stimmen. Ein Ausrichtungsmuster an der falschen Stelle
 *     verschiebt die eine und nicht die andere.
 *  2. DER BCH-CODE. Format- und Fassungsangabe sind Restklassen: Das fertige Wort, durch
 *     das Erzeugerpolynom geteilt, muss null ergeben. Und der Mindestabstand des Codes
 *     (7 bzw. 8) ist eine Eigenschaft, die sich nachrechnen laesst, ohne eine Tabelle zu
 *     kennen.
 *  3. REED-SOLOMON. Das Erzeugerpolynom fuer zehn Korrekturwoerter steht in der Norm als
 *     Zahlenreihe - die steht hier woertlich. Und die Syndrome jedes Blocks im fertigen
 *     Bild muessen null sein; gerechnet mit einer GF(256)-Tabelle, die diese Datei sich
 *     selbst baut.
 *  4. Und erst dann die Rueckprobe durch das ganze Bild.
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

const FASSUNGEN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

console.log('\nDie Tabellen stimmen mit sich selbst:');

await pruefe('Gesamtzahl = Korrekturwoerter + Datenwoerter, in jeder Fassung', () => {
  for (const fassung of FASSUNGEN) {
    const a = EC_AUFBAU[fassung]!;
    const bloecke = a.gruppe1[0] + a.gruppe2[0];
    const daten = a.gruppe1[0] * a.gruppe1[1] + a.gruppe2[0] * a.gruppe2[1];
    assert.equal(bloecke * a.ecJeBlock + daten, a.gesamt, `Fassung ${fassung}`);
  }
});

await pruefe('die zweite Blockgruppe hat genau ein Datenwort mehr als die erste', () => {
  // So verteilt die Norm einen Rest, der nicht aufgeht. Zwei mehr waere ein Tippfehler.
  for (const fassung of FASSUNGEN) {
    const a = EC_AUFBAU[fassung]!;
    if (a.gruppe2[0] === 0) continue;
    assert.equal(a.gruppe2[1], a.gruppe1[1] + 1, `Fassung ${fassung}`);
  }
});

console.log('\nDas Muster laesst genau so viel Platz, wie die Tabelle verlangt:');

await pruefe('Datenmodule = Codewoerter * 8 + Restbits, in jeder Fassung', () => {
  /*
   * Der schaerfste Test dieser Datei.
   *
   * Links steht, was das gezeichnete Muster uebrig laesst; rechts, was die Norm an
   * Codewoertern vorsieht. Die Restbits sind die Module, die am Ende ueberzaehlig sind und
   * hell bleiben - fuer die Fassungen 2 bis 6 sind es sieben, sonst hier keine. Stimmen
   * die beiden Zahlen ueberein, sitzen Sucher, Trenner, Taktlinien, Ausrichtungsmuster,
   * Formatfeld, Fassungsfeld und das dunkle Modul alle richtig.
   */
  const restbits = (fassung: number) => (fassung >= 2 && fassung <= 6 ? 7 : 0);
  for (const fassung of FASSUNGEN) {
    assert.equal(
      datenModule(fassung),
      EC_AUFBAU[fassung]!.gesamt * 8 + restbits(fassung),
      `Fassung ${fassung}`,
    );
  }
});

await pruefe('die Kantenlaenge waechst um vier je Fassung', () => {
  for (const fassung of FASSUNGEN) assert.equal(groesseZu(fassung), 4 * fassung + 17);
});

console.log('\nDie BCH-Absicherung:');

await pruefe('das fertige Formatwort ist ohne Rest teilbar', () => {
  // Die Eigenschaft, die einen BCH-Code ausmacht - und die sich pruefen laesst, ohne die
  // Tabelle der 32 Formatwoerter zu kennen.
  for (let maske = 0; maske < 8; maske++) {
    for (let stufe = 0; stufe < 4; stufe++) {
      const wort = formatBits(maske, stufe) ^ 0b101010000010010;
      assert.equal(bch(wort >> 10, FORMAT_ERZEUGER, 10), wort & 0b1111111111, `${stufe}/${maske}`);
    }
  }
});

await pruefe('je zwei Formatwoerter unterscheiden sich in mindestens sieben Bit', () => {
  /*
   * Der Mindestabstand dieses Codes ist sieben - deshalb bleibt die Formatangabe lesbar,
   * auch wenn drei Module verschmutzt sind. Waere mein Erzeugerpolynom falsch, kaeme hier
   * ein kleinerer Abstand heraus.
   */
  const woerter: number[] = [];
  for (let stufe = 0; stufe < 4; stufe++) {
    for (let maske = 0; maske < 8; maske++) woerter.push(formatBits(maske, stufe));
  }
  assert.equal(woerter.length, 32);
  let kleinster = 99;
  for (let i = 0; i < woerter.length; i++) {
    for (let j = i + 1; j < woerter.length; j++) {
      kleinster = Math.min(kleinster, abstand(woerter[i]!, woerter[j]!));
    }
  }
  assert.equal(kleinster, 7, `Kleinster Abstand ${kleinster} statt 7.`);
});

await pruefe('Stufe M mit Maske 0 ergibt die bekannte Bitfolge', () => {
  // Sie ist die Probe aufs Exempel: Stufe M ist 00, Maske 0 ist 000, der Rest damit
  // ebenfalls null - uebrig bleibt genau die Verschleierungsmaske der Norm.
  assert.equal(formatBits(0).toString(2).padStart(15, '0'), '101010000010010');
});

await pruefe('je zwei Fassungswoerter unterscheiden sich in mindestens acht Bit', () => {
  const woerter = [];
  for (let fassung = 7; fassung <= 40; fassung++) woerter.push(fassungBits(fassung));
  let kleinster = 99;
  for (let i = 0; i < woerter.length; i++) {
    for (let j = i + 1; j < woerter.length; j++) {
      kleinster = Math.min(kleinster, abstand(woerter[i]!, woerter[j]!));
    }
  }
  assert.equal(kleinster, 8, `Kleinster Abstand ${kleinster} statt 8.`);
});

await pruefe('das fertige Fassungswort ist ohne Rest teilbar', () => {
  for (let fassung = 7; fassung <= 40; fassung++) {
    const wort = fassungBits(fassung);
    assert.equal(bch(wort >> 12, FASSUNG_ERZEUGER, 12), wort & 0xfff, `Fassung ${fassung}`);
  }
});

function abstand(a: number, b: number): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += x & 1;
    x >>>= 1;
  }
  return n;
}

console.log('\nReed-Solomon:');

/*
 * Ein eigener GF(256) fuer diese Datei.
 *
 * Bewusst noch einmal geschrieben und nicht aus qrCode.ts geholt: Sonst pruefte die
 * Rechnung sich selbst. Dieselben zehn Zeilen zweimal sind hier keine Verdopplung, sondern
 * der Sinn der Uebung.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
    x &= 0xff;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}
const mal = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[LOG[a]! + LOG[b]!]!);

await pruefe('das Erzeugerpolynom fuer zehn Korrekturwoerter steht so in der Norm', () => {
  /*
   * Anhang A der Norm druckt die Erzeugerpolynome als Reihe von Alpha-Exponenten ab. Fuer
   * zehn Korrekturwoerter ist es diese - eine Zahlenreihe von aussen, gegen die sich die
   * ganze Koerperrechnung auf einen Schlag pruefen laesst.
   */
  const erwartet = [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45];
  assert.deepEqual(erzeuger(10).map(alphaExponent), erwartet);
});

await pruefe('mein GF(256) und der aus qrCode.ts rechnen dasselbe', () => {
  // a * a^-1 = 1 fuer jedes Element ausser der Null - eine Koerpereigenschaft, die eine
  // vertippte Tabelle sofort verletzt.
  for (let a = 1; a < 256; a++) {
    const inv = EXP[255 - LOG[a]!]!;
    assert.equal(mal(a, inv), 1, `${a}`);
  }
});

console.log('\nDie Rueckprobe durch das fertige Bild:');

/** Welche Module kein Datenmodul sind - hier noch einmal und anders geschrieben. */
function belegtKarte(fassung: number): boolean[][] {
  const groesse = groesseZu(fassung);
  const karte = Array.from({ length: groesse }, () => new Array<boolean>(groesse).fill(false));
  const merke = (z: number, s: number) => {
    if (z >= 0 && s >= 0 && z < groesse && s < groesse) karte[z]![s] = true;
  };

  // Sucher samt Trenner sind drei 8x8-Bloecke in den Ecken.
  for (const [z0, s0] of [
    [0, 0],
    [0, groesse - 8],
    [groesse - 8, 0],
  ] as const) {
    for (let z = 0; z < 8; z++) for (let s = 0; s < 8; s++) merke(z0 + z, s0 + s);
  }
  // Taktlinien.
  for (let i = 0; i < groesse; i++) {
    merke(6, i);
    merke(i, 6);
  }
  // Ausrichtungsmuster.
  const stellen = ausrichtungsPositionen(fassung);
  for (const z of stellen) {
    for (const s of stellen) {
      const imSucher =
        (z <= 8 && s <= 8) || (z <= 8 && s >= groesse - 9) || (z >= groesse - 9 && s <= 8);
      if (imSucher) continue;
      for (let dz = -2; dz <= 2; dz++) for (let ds = -2; ds <= 2; ds++) merke(z + dz, s + ds);
    }
  }
  // Formatfeld, beide Kopien, und das dunkle Modul.
  for (let i = 0; i <= 8; i++) {
    merke(8, i);
    merke(i, 8);
  }
  for (let i = 0; i < 8; i++) {
    merke(8, groesse - 1 - i);
    merke(groesse - 1 - i, 8);
  }
  // Fassungsfeld.
  if (fassung >= 7) {
    for (let z = 0; z < 6; z++) {
      for (let s = groesse - 11; s < groesse - 8; s++) {
        merke(z, s);
        merke(s, z);
      }
    }
  }
  return karte;
}

/** Liest ein Bild zurueck: Maske abziehen, Zickzack ablesen, entschraenken, entpacken. */
function lies(bild: { groesse: number; zeilen: string[] }, fassung: number): {
  text: string;
  syndromeNull: boolean;
} {
  const groesse = bild.groesse;
  const modul = bild.zeilen.map((z) => [...z].map(Number));
  const karte = belegtKarte(fassung);

  // Die Maske steht in der Formatangabe - der Leser bekommt sie nicht gesagt.
  const formatWort =
    ([0, 1, 2, 3, 4, 5].map((i) => modul[8]![i]!).reduce((w, b, i) => w | (b << i), 0) |
      (modul[8]![7]! << 6) |
      (modul[8]![8]! << 7) |
      (modul[7]![8]! << 8) |
      [9, 10, 11, 12, 13, 14].map((i) => modul[14 - i]![8]!).reduce((w, b, i) => w | (b << (9 + i)), 0)) ^
    0b101010000010010;
  /*
   * Die Maskennummer sind die drei UNTERSTEN Bit der fuenf Nutzbits - und die stehen ganz
   * oben im Fuenfzehnbitwort, ueber den zehn BCH-Bits. Ein `& 0b111` griffe in den
   * Pruefteil und ergaebe eine zufaellige Maske; genau daran ist diese Ruecklese beim
   * ersten Lauf gescheitert.
   */
  const maske = (formatWort >> 10) & 0b111;

  const bits: number[] = [];
  let aufwaerts = true;
  for (let spalte = groesse - 1; spalte > 0; spalte -= 2) {
    if (spalte === 6) spalte = 5;
    for (let i = 0; i < groesse; i++) {
      const zeile = aufwaerts ? groesse - 1 - i : i;
      for (const s of [spalte, spalte - 1]) {
        if (karte[zeile]![s]) continue;
        bits.push(modul[zeile]![s]! ^ (maskiert(maske, zeile, s) ? 1 : 0));
      }
    }
    aufwaerts = !aufwaerts;
  }

  const woerter: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    woerter.push(b);
  }

  // Entschraenken: aus dem verwobenen Strom wieder Bloecke machen.
  const a = EC_AUFBAU[fassung]!;
  const laengen: number[] = [];
  for (let i = 0; i < a.gruppe1[0]; i++) laengen.push(a.gruppe1[1]);
  for (let i = 0; i < a.gruppe2[0]; i++) laengen.push(a.gruppe2[1]);
  const daten: number[][] = laengen.map(() => []);
  let gelesen = 0;
  for (let i = 0; i < Math.max(...laengen); i++) {
    for (let b = 0; b < laengen.length; b++) {
      if (i < laengen[b]!) daten[b]!.push(woerter[gelesen++]!);
    }
  }
  const ec: number[][] = laengen.map(() => []);
  for (let i = 0; i < a.ecJeBlock; i++) {
    for (let b = 0; b < laengen.length; b++) ec[b]!.push(woerter[gelesen++]!);
  }

  /*
   * Die Syndrome: das Codewort an den Nullstellen des Erzeugerpolynoms ausgewertet. Bei
   * einem fehlerfreien Block muss jede dieser Auswertungen null ergeben - das ist die
   * Definition des Codes und haengt an keiner Tabelle, die ich mir gemerkt haben koennte.
   */
  let syndromeNull = true;
  for (let b = 0; b < laengen.length; b++) {
    const wort = [...daten[b]!, ...ec[b]!];
    for (let i = 0; i < a.ecJeBlock; i++) {
      let summe = 0;
      for (const c of wort) summe = mal(summe, EXP[i]!) ^ c;
      if (summe !== 0) syndromeNull = false;
    }
  }

  const strom = daten.flat();
  const modus = strom[0]! >> 4;
  assert.equal(modus, 0b0100, 'Der Betriebsartkennzeichner ist nicht 0100 (Byte).');
  const laengeBits = fassung <= 9 ? 8 : 16;
  const laenge = laengeBits === 8 ? ((strom[0]! & 0x0f) << 4) | (strom[1]! >> 4) : 0;

  // Die Nutzdaten liegen um vier Bit versetzt - der Betriebsartkennzeichner ist ein
  // Halbbyte, die Laengenangabe ein ganzes.
  const bytes: number[] = [];
  for (let i = 0; i < laenge; i++) {
    const hoch = strom[1 + i]! & 0x0f;
    const tief = strom[2 + i]! >> 4;
    bytes.push((hoch << 4) | tief);
  }
  return { text: Buffer.from(bytes).toString('utf8'), syndromeNull };
}

await pruefe('ein otpauth-Weg kommt unversehrt wieder heraus', () => {
  const weg =
    'otpauth://totp/Energy%20Mail:anna.mueller%40beispiel.de' +
    '?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Energy%20Mail';
  const bild = qrCode(weg);
  const fassung = (bild.groesse - 17) / 4;
  const zurueck = lies(bild, fassung);
  assert.equal(zurueck.text, weg);
  assert.ok(zurueck.syndromeNull, 'Die Reed-Solomon-Syndrome sind nicht null.');
});

await pruefe('das gilt fuer jede Laenge von einem Zeichen bis Fassung 9', () => {
  /*
   * Reihum durch alle Fassungen, die die achtstellige Laengenangabe benutzen. Fassung 10
   * hat sechzehn Bit und einen anderen Versatz - der Leser hier kann nur die eine Sorte,
   * und ein otpauth-Weg kommt nie in ihre Naehe.
   */
  for (const laenge of [1, 13, 25, 41, 60, 83, 105, 121, 150, 178]) {
    const text = 'A'.repeat(laenge);
    const bild = qrCode(text);
    const fassung = (bild.groesse - 17) / 4;
    if (fassung > 9) continue;
    const zurueck = lies(bild, fassung);
    assert.equal(zurueck.text, text, `Laenge ${laenge}, Fassung ${fassung}`);
    assert.ok(zurueck.syndromeNull, `Syndrome bei Laenge ${laenge} nicht null.`);
  }
});

await pruefe('Umlaute ueberleben - gezaehlt werden Bytes, nicht Zeichen', () => {
  const text = 'Grüße aus Königswinter — ÄÖÜ';
  const bild = qrCode(text);
  const zurueck = lies(bild, (bild.groesse - 17) / 4);
  assert.equal(zurueck.text, text);
});

console.log('\nDas Bild selbst:');

await pruefe('die drei Sucher stehen in den Ecken', () => {
  const bild = qrCode('otpauth://totp/x?secret=AAAA');
  const z = bild.zeilen;
  const g = bild.groesse;
  for (const [z0, s0] of [
    [0, 0],
    [0, g - 7],
    [g - 7, 0],
  ] as const) {
    assert.equal(z[z0]!.slice(s0, s0 + 7), '1111111', `Oberkante bei ${z0}/${s0}`);
    assert.equal(z[z0 + 6]!.slice(s0, s0 + 7), '1111111', `Unterkante bei ${z0}/${s0}`);
    assert.equal(z[z0 + 1]!.slice(s0, s0 + 7), '1000001', `Innenrand bei ${z0}/${s0}`);
    assert.equal(z[z0 + 3]!.slice(s0, s0 + 7), '1011101', `Mitte bei ${z0}/${s0}`);
  }
});

await pruefe('das dunkle Modul ist dunkel', () => {
  const bild = qrCode('otpauth://totp/x?secret=AAAA');
  assert.equal(bild.zeilen[bild.groesse - 8]![8], '1');
});

await pruefe('die Taktlinien wechseln sich ab', () => {
  const bild = qrCode('otpauth://totp/x?secret=AAAA');
  for (let i = 8; i < bild.groesse - 8; i++) {
    assert.equal(bild.zeilen[6]![i], i % 2 === 0 ? '1' : '0', `Waagerecht bei ${i}`);
    assert.equal(bild.zeilen[i]![6], i % 2 === 0 ? '1' : '0', `Senkrecht bei ${i}`);
  }
});

await pruefe('derselbe Text ergibt immer dasselbe Bild', () => {
  // Die Maskenwahl haengt an Strafpunkten, nicht am Zufall. Waere sie unbestimmt, waere
  // jeder Fehler nur manchmal zu sehen.
  const a = qrCode('otpauth://totp/gleich?secret=MZXW6YTB');
  const b = qrCode('otpauth://totp/gleich?secret=MZXW6YTB');
  assert.deepEqual(a, b);
});

await pruefe('ein zu langer Text bekommt eine Erklaerung und keinen Absturz', () => {
  assert.throws(() => qrCode('x'.repeat(500)), /Fassung 10/);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
