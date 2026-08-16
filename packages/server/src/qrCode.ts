/**
 * QR-Bilder - so viel davon, wie ein otpauth-Weg braucht.
 *
 * ## Warum selbst gebaut und nicht als Abhängigkeit
 *
 * Weil ein QR-Bild reine Rechnerei ist: Bits, ein Reed-Solomon-Code über GF(256) und ein
 * Muster aus schwarzen Quadraten. Es kommt nichts von außen herein und geht nichts nach
 * draußen. Dem gegenüber steht, was eine Abhängigkeit hier kostet: Sie landet in einer
 * Anwendung, die sich selbst aktualisiert und dabei ihre eigene Unterschrift prüft - und
 * damit in genau der Kette, deren Angriffsfläche wir gerade klein halten. Zweihundert
 * Zeilen Mathematik, die sich gegen die Norm prüfen lassen, sind der bessere Tausch.
 *
 * ## Was hier absichtlich fehlt
 *
 * Nur die Bytebetriebsart, nur Fehlerkorrekturstufe M, nur die Fassungen 1 bis 10. Das
 * reicht für 213 Byte, und ein otpauth-Weg hat rund neunzig. Ziffern- und
 * Buchstabenbetriebsart machen das Bild bei reinen Zahlen kleiner - nur besteht ein
 * otpauth-Weg nicht aus reinen Zahlen. Was nicht gebraucht wird, ist Code, der nie läuft
 * und trotzdem falsch sein kann.
 *
 * ## Woher die Zahlen stammen
 *
 * Aus ISO/IEC 18004. Die Tabellen unten sind der Teil, den man nicht herleiten kann - sie
 * werden in der Prüfung gegengerechnet, so weit das geht (Summenprobe je Fassung), und der
 * Rest hängt an einer Rückprobe: qrCode.test.mts liest das fertige Bild mit einem zweiten,
 * unabhängig geschriebenen Leser wieder aus. Was dabei herauskommt, muss der Eingabetext
 * sein, und die Reed-Solomon-Syndrome müssen null sein.
 */

/** Ein fertiges Bild: Kantenlänge und die Zeilen als "0"/"1". */
export interface QrBild {
  groesse: number;
  /** Je Zeile ein Zeichen "1" (dunkel) oder "0" (hell) je Modul. */
  zeilen: string[];
}

/**
 * Der Blockaufbau je Fassung, Stufe M.
 *
 * Je Zeile: Gesamtzahl der Codewörter, Fehlerkorrekturwörter JE BLOCK, dann die Blöcke der
 * ersten Gruppe (Anzahl × Datenwörter) und der zweiten. Die zweite Gruppe hat immer genau
 * ein Datenwort mehr als die erste - so verteilt die Norm einen Rest, der nicht aufgeht.
 *
 * Öffentlich, weil die Rückprobe in der Prüfung sie ebenfalls braucht: Ein Leser, der
 * seinen eigenen Blockaufbau erfände, prüfte nichts.
 */
export const EC_AUFBAU: Record<
  number,
  { gesamt: number; ecJeBlock: number; gruppe1: [number, number]; gruppe2: [number, number] }
> = {
  1: { gesamt: 26, ecJeBlock: 10, gruppe1: [1, 16], gruppe2: [0, 0] },
  2: { gesamt: 44, ecJeBlock: 16, gruppe1: [1, 28], gruppe2: [0, 0] },
  3: { gesamt: 70, ecJeBlock: 26, gruppe1: [1, 44], gruppe2: [0, 0] },
  4: { gesamt: 100, ecJeBlock: 18, gruppe1: [2, 32], gruppe2: [0, 0] },
  5: { gesamt: 134, ecJeBlock: 24, gruppe1: [2, 43], gruppe2: [0, 0] },
  6: { gesamt: 172, ecJeBlock: 16, gruppe1: [4, 27], gruppe2: [0, 0] },
  7: { gesamt: 196, ecJeBlock: 18, gruppe1: [4, 31], gruppe2: [0, 0] },
  8: { gesamt: 242, ecJeBlock: 22, gruppe1: [2, 38], gruppe2: [2, 39] },
  9: { gesamt: 292, ecJeBlock: 22, gruppe1: [3, 36], gruppe2: [2, 37] },
  10: { gesamt: 346, ecJeBlock: 26, gruppe1: [4, 43], gruppe2: [1, 44] },
};

/** Mittelpunkte der Ausrichtungsmuster je Fassung - auch die Norm gibt sie als Tabelle. */
const AUSRICHTUNG: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** Auch das braucht die Rückprobe: Sie muss wissen, welche Module belegt sind. */
export function ausrichtungsPositionen(fassung: number): number[] {
  return AUSRICHTUNG[fassung] ?? [];
}

export function groesseZu(fassung: number): number {
  return 4 * fassung + 17;
}

// --- Rechnen in GF(256) ---

/*
 * Der Körper, in dem Reed-Solomon rechnet: 256 Elemente, Multiplikation modulo dem
 * Polynom x^8 + x^4 + x^3 + x^2 + 1 (0x11D). Zwei Tabellen genügen - eine von Exponent zu
 * Wert, eine zurück; danach ist Multiplizieren eine Addition der Exponenten.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

function mal(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

/**
 * Das Erzeugerpolynom für n Fehlerkorrekturwörter: (x-a^0)(x-a^1)...(x-a^(n-1)).
 *
 * Die Koeffizienten stehen ABSTEIGEND, der Leitkoeffizient (immer 1) vorn. Das ist keine
 * Geschmacksfrage: Die Polynomdivision weiter unten kürzt in jedem Schritt das führende
 * Glied weg und rechnet nur dann richtig, wenn dieses Glied eine Eins ist. Aufsteigend
 * geschrieben stünde dort a^(0+1+...+(n-1)), die Division ginge nie auf, und heraus kämen
 * Korrekturwörter, die zu nichts passen - ein Bild, das jeder Leser als beschädigt
 * verwirft, obwohl die Nutzdaten darin unversehrt stehen. Genau das ist beim ersten Lauf
 * passiert und nur aufgefallen, weil die Prüfung die Syndrome nachrechnet.
 */
export function erzeuger(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const naechstes = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      naechstes[j] = (naechstes[j] ?? 0) ^ poly[j]!;
      naechstes[j + 1] = (naechstes[j + 1] ?? 0) ^ mal(poly[j]!, EXP[i]!);
    }
    poly = naechstes;
  }
  return poly;
}

/** Der Zweierlogarithmus im Körper - die Norm schreibt die Erzeugerpolynome so auf. */
export function alphaExponent(wert: number): number {
  return LOG[wert]!;
}

/** Die Fehlerkorrekturwörter zu einem Datenblock: der Rest der Polynomdivision. */
function fehlerkorrektur(daten: number[], anzahl: number): number[] {
  const poly = erzeuger(anzahl);
  const rest = [...daten, ...new Array<number>(anzahl).fill(0)];
  for (let i = 0; i < daten.length; i++) {
    const fuehrend = rest[i]!;
    if (fuehrend === 0) continue;
    for (let j = 0; j < poly.length; j++) {
      rest[i + j] = rest[i + j]! ^ mal(poly[j]!, fuehrend);
    }
  }
  return rest.slice(daten.length);
}

// --- BCH-Absicherung für Format- und Fassungsangabe ---

/**
 * Die Formatangabe steht fünfzehnmal im Bild und muss auch dann noch lesbar sein, wenn
 * ein Teil davon zerkratzt ist - deshalb ein eigener, kleiner Code darüber. Ohne sie
 * weiß ein Leser weder die Fehlerkorrekturstufe noch die Maske und kommt gar nicht erst
 * an die Daten.
 */
export function bch(wert: number, generator: number, stellen: number): number {
  const laenge = (x: number) => (x === 0 ? 0 : x.toString(2).length);
  let rest = wert << stellen;
  while (laenge(rest) >= laenge(generator)) {
    rest ^= generator << (laenge(rest) - laenge(generator));
  }
  return rest;
}

/** Das Erzeugerpolynom der Formatangabe, x^10+x^8+x^5+x^4+x^2+x+1. */
export const FORMAT_ERZEUGER = 0b10100110111;

/** Und das der Fassungsangabe, x^12+x^11+x^10+x^9+x^8+x^5+x^2+1. */
export const FASSUNG_ERZEUGER = 0b1111100100101;

/**
 * 15 Bit: 2 Bit Stufe, 3 Bit Maske, 10 Bit BCH - danach mit 0x5412 verschleiert.
 *
 * Die Verschleierung ist keine Sicherheit, sondern eine Notwendigkeit: Ohne sie wäre die
 * Formatangabe für Stufe M und Maske 0 lauter Nullen, also fünfzehn helle Module am Rand
 * eines Suchers - und daran verzählt sich jede Kamera.
 */
export function formatBits(maske: number, stufe = 0b00): number {
  // Stufe M ist die Bitfolge 00 - siehe Tabelle 12 der Norm.
  const roh = (stufe << 3) | maske;
  return ((roh << 10) | bch(roh, FORMAT_ERZEUGER, 10)) ^ 0b101010000010010;
}

/** 18 Bit: 6 Bit Fassungsnummer, 12 Bit BCH. Erst ab Fassung 7 überhaupt im Bild. */
export function fassungBits(fassung: number): number {
  return (fassung << 12) | bch(fassung, FASSUNG_ERZEUGER, 12);
}

// --- Die Bitfolge der Daten ---

function datenBits(text: string, fassung: number): number[] {
  const bytes = [...Buffer.from(text, 'utf8')];
  const bits: number[] = [];
  const schiebe = (wert: number, anzahl: number) => {
    for (let i = anzahl - 1; i >= 0; i--) bits.push((wert >> i) & 1);
  };

  // 0100 = Bytebetriebsart. Die Längenangabe hat bis Fassung 9 acht Bit, danach sechzehn.
  schiebe(0b0100, 4);
  schiebe(bytes.length, fassung <= 9 ? 8 : 16);
  for (const b of bytes) schiebe(b, 8);

  const aufbau = EC_AUFBAU[fassung]!;
  const datenWoerter =
    aufbau.gruppe1[0] * aufbau.gruppe1[1] + aufbau.gruppe2[0] * aufbau.gruppe2[1];
  const platz = datenWoerter * 8;

  // Abschlusszeichen: bis zu vier Nullen, weniger wenn es knapp wird.
  for (let i = 0; i < 4 && bits.length < platz; i++) bits.push(0);
  // Auf ganze Bytes auffüllen ...
  while (bits.length % 8 !== 0) bits.push(0);
  // ... und den Rest mit den beiden Füllwörtern der Norm, abwechselnd.
  const fuell = [0b11101100, 0b00010001];
  for (let i = 0; bits.length < platz; i++) schiebe(fuell[i % 2]!, 8);

  return bits;
}

/** Bits zu Codewörtern, dann Blöcke bilden, Fehlerkorrektur rechnen, verschränken. */
function codewoerter(text: string, fassung: number): number[] {
  const bits = datenBits(text, fassung);
  const woerter: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]!;
    woerter.push(b);
  }

  const aufbau = EC_AUFBAU[fassung]!;
  const bloecke: number[][] = [];
  let gelesen = 0;
  for (const [anzahl, laenge] of [aufbau.gruppe1, aufbau.gruppe2]) {
    for (let i = 0; i < anzahl; i++) {
      bloecke.push(woerter.slice(gelesen, gelesen + laenge));
      gelesen += laenge;
    }
  }
  const ec = bloecke.map((b) => fehlerkorrektur(b, aufbau.ecJeBlock));

  /*
   * Verschränkt, nicht hintereinander.
   *
   * Erst das erste Wort jedes Blocks, dann das zweite und so fort. Der Grund ist der Zweck
   * der Fehlerkorrektur überhaupt: Ein Fleck auf dem Papier trifft eine zusammenhängende
   * Fläche. Lägen die Blöcke hintereinander, wäre ein Block ganz zerstört und die anderen
   * unversehrt - so trifft es jeden ein wenig, und jeder kann sich selbst reparieren.
   */
  const aus: number[] = [];
  const maxDaten = Math.max(...bloecke.map((b) => b.length));
  for (let i = 0; i < maxDaten; i++) {
    for (const block of bloecke) if (i < block.length) aus.push(block[i]!);
  }
  for (let i = 0; i < aufbau.ecJeBlock; i++) {
    for (const block of ec) aus.push(block[i]!);
  }
  return aus;
}

// --- Das Muster ---

type Feld = { modul: number[][]; belegt: boolean[][] };

function leeresFeld(groesse: number): Feld {
  return {
    modul: Array.from({ length: groesse }, () => new Array<number>(groesse).fill(0)),
    belegt: Array.from({ length: groesse }, () => new Array<boolean>(groesse).fill(false)),
  };
}

function setze(feld: Feld, zeile: number, spalte: number, wert: number): void {
  feld.modul[zeile]![spalte] = wert;
  feld.belegt[zeile]![spalte] = true;
}

/** Sucher, Trenner, Taktmuster, Ausrichtung, das dunkle Modul und die freigehaltenen Felder. */
function festeMuster(feld: Feld, fassung: number): void {
  const groesse = feld.modul.length;

  // Die drei Sucher in den Ecken - daran erkennt ein Leser überhaupt, dass da ein QR ist.
  for (const [zStart, sStart] of [
    [0, 0],
    [0, groesse - 7],
    [groesse - 7, 0],
  ] as const) {
    for (let z = -1; z <= 7; z++) {
      for (let s = -1; s <= 7; s++) {
        const zeile = zStart + z;
        const spalte = sStart + s;
        if (zeile < 0 || spalte < 0 || zeile >= groesse || spalte >= groesse) continue;
        // Der äußere Ring ist der Trenner: eine helle Linie rings um den Sucher.
        const imSucher = z >= 0 && z <= 6 && s >= 0 && s <= 6;
        const dunkel =
          imSucher &&
          (z === 0 || z === 6 || s === 0 || s === 6 || (z >= 2 && z <= 4 && s >= 2 && s <= 4));
        setze(feld, zeile, spalte, dunkel ? 1 : 0);
      }
    }
  }

  // Die beiden Taktlinien: abwechselnd dunkel und hell, damit sich das Raster abzählen lässt.
  for (let i = 8; i < groesse - 8; i++) {
    const dunkel = i % 2 === 0 ? 1 : 0;
    setze(feld, 6, i, dunkel);
    setze(feld, i, 6, dunkel);
  }

  // Ausrichtungsmuster - überall dort, wo kein Sucher im Weg ist.
  const stellen = ausrichtungsPositionen(fassung);
  for (const zMitte of stellen) {
    for (const sMitte of stellen) {
      const imSucher =
        (zMitte <= 8 && sMitte <= 8) ||
        (zMitte <= 8 && sMitte >= groesse - 9) ||
        (zMitte >= groesse - 9 && sMitte <= 8);
      if (imSucher) continue;
      for (let z = -2; z <= 2; z++) {
        for (let s = -2; s <= 2; s++) {
          const rand = Math.max(Math.abs(z), Math.abs(s));
          setze(feld, zMitte + z, sMitte + s, rand === 1 ? 0 : 1);
        }
      }
    }
  }

  // Das dunkle Modul. Es steht immer an derselben Stelle und ist immer dunkel - eine
  // Festlegung der Norm ohne tieferen Sinn, aber ohne es ist das Bild ungültig.
  setze(feld, groesse - 8, 8, 1);

  // Platz für die Formatangabe freihalten; sie wird erst geschrieben, wenn die Maske
  // feststeht.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      setze(feld, 8, i, 0);
      setze(feld, i, 8, 0);
    }
  }
  for (let i = 0; i < 8; i++) {
    setze(feld, 8, groesse - 1 - i, 0);
    if (groesse - 1 - i !== groesse - 8) setze(feld, groesse - 1 - i, 8, 0);
  }

  // Ab Fassung 7 steht die Fassungsnummer zweimal im Bild.
  if (fassung >= 7) {
    for (let i = 0; i < 18; i++) {
      const zeile = Math.floor(i / 3);
      const spalte = groesse - 11 + (i % 3);
      setze(feld, zeile, spalte, 0);
      setze(feld, spalte, zeile, 0);
    }
  }
}

/**
 * Wie viele Module am Ende Daten tragen.
 *
 * Steht hier für die Prüfung, und dort trägt es die Last: Diese Zahl muss auf das Modul
 * genau mit dem übereinstimmen, was die Codewort-Tabelle vorgibt (Gesamtzahl mal acht,
 * plus die Restbits der Norm). Beide Angaben stammen aus verschiedenen Teilen der Norm -
 * ein Ausrichtungsmuster an der falschen Stelle oder ein falsch freigehaltenes Feld
 * verschiebt die eine und nicht die andere, und die Prüfung schlägt fehl.
 */
export function datenModule(fassung: number): number {
  const feld = leeresFeld(groesseZu(fassung));
  festeMuster(feld, fassung);
  return feld.belegt.reduce((summe, zeile) => summe + zeile.filter((b) => !b).length, 0);
}

/** Die Datenbits im Zickzack: von rechts unten, spaltenweise zu zweit, abwechselnd hoch und runter. */
function setzeDaten(feld: Feld, woerter: number[]): void {
  const groesse = feld.modul.length;
  const bits: number[] = [];
  for (const wort of woerter) for (let i = 7; i >= 0; i--) bits.push((wort >> i) & 1);

  let gelesen = 0;
  let aufwaerts = true;
  for (let spalte = groesse - 1; spalte > 0; spalte -= 2) {
    // Die senkrechte Taktlinie zählt nicht als Spalte - dahinter rutscht alles um eins.
    if (spalte === 6) spalte = 5;
    for (let i = 0; i < groesse; i++) {
      const zeile = aufwaerts ? groesse - 1 - i : i;
      for (const s of [spalte, spalte - 1]) {
        if (feld.belegt[zeile]![s]) continue;
        feld.modul[zeile]![s] = bits[gelesen] ?? 0;
        feld.belegt[zeile]![s] = true;
        gelesen++;
      }
    }
    aufwaerts = !aufwaerts;
  }
}

/** Die acht Masken der Norm. Ohne sie entstehen Flächen, an denen sich ein Leser verzählt. */
export function maskiert(maske: number, zeile: number, spalte: number): boolean {
  switch (maske) {
    case 0:
      return (zeile + spalte) % 2 === 0;
    case 1:
      return zeile % 2 === 0;
    case 2:
      return spalte % 3 === 0;
    case 3:
      return (zeile + spalte) % 3 === 0;
    case 4:
      return (Math.floor(zeile / 2) + Math.floor(spalte / 3)) % 2 === 0;
    case 5:
      return ((zeile * spalte) % 2) + ((zeile * spalte) % 3) === 0;
    case 6:
      return (((zeile * spalte) % 2) + ((zeile * spalte) % 3)) % 2 === 0;
    default:
      return (((zeile + spalte) % 2) + ((zeile * spalte) % 3)) % 2 === 0;
  }
}

/**
 * Die Strafpunkte der Norm - je weniger, desto besser liest sich das Bild.
 *
 * Vier Regeln: lange Reihen gleicher Farbe, gleichfarbige Zweierquadrate, Muster, die
 * einem Sucher ähneln, und ein Übergewicht einer Farbe. Alle acht Masken werden gerechnet
 * und die günstigste genommen. Das ist der Grund, warum zwei QR-Bilder desselben Textes
 * bei verschiedenen Programmen gleich aussehen: Es ist keine Geschmacksfrage.
 */
function strafe(modul: number[][]): number {
  const groesse = modul.length;
  let punkte = 0;

  // Regel 1: fünf oder mehr gleiche in Folge.
  for (const durchZeilen of [true, false]) {
    for (let a = 0; a < groesse; a++) {
      let letzte = -1;
      let laenge = 0;
      for (let b = 0; b < groesse; b++) {
        const wert = durchZeilen ? modul[a]![b]! : modul[b]![a]!;
        if (wert === letzte) {
          laenge++;
          if (laenge === 5) punkte += 3;
          else if (laenge > 5) punkte += 1;
        } else {
          letzte = wert;
          laenge = 1;
        }
      }
    }
  }

  // Regel 2: jedes gleichfarbige 2x2-Quadrat.
  for (let z = 0; z < groesse - 1; z++) {
    for (let s = 0; s < groesse - 1; s++) {
      const w = modul[z]![s]!;
      if (w === modul[z]![s + 1] && w === modul[z + 1]![s] && w === modul[z + 1]![s + 1]) {
        punkte += 3;
      }
    }
  }

  // Regel 3: das Sucher-ähnliche Muster, in beide Richtungen.
  const muster = [
    [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1],
  ];
  for (const durchZeilen of [true, false]) {
    for (let a = 0; a < groesse; a++) {
      for (let b = 0; b + 11 <= groesse; b++) {
        for (const m of muster) {
          let passt = true;
          for (let k = 0; k < 11; k++) {
            const wert = durchZeilen ? modul[a]![b + k]! : modul[b + k]![a]!;
            if (wert !== m[k]) {
              passt = false;
              break;
            }
          }
          if (passt) punkte += 40;
        }
      }
    }
  }

  // Regel 4: Übergewicht einer Farbe.
  const dunkel = modul.reduce((summe, zeile) => summe + zeile.reduce((a, b) => a + b, 0), 0);
  const anteil = (dunkel * 100) / (groesse * groesse);
  punkte += Math.floor(Math.abs(anteil - 50) / 5) * 10;

  return punkte;
}

function schreibeFormat(modul: number[][], maske: number): void {
  const groesse = modul.length;
  const bits = formatBits(maske);
  const bit = (i: number) => (bits >> i) & 1;

  for (let i = 0; i <= 5; i++) modul[8]![i] = bit(i);
  modul[8]![7] = bit(6);
  modul[8]![8] = bit(7);
  modul[7]![8] = bit(8);
  for (let i = 9; i <= 14; i++) modul[14 - i]![8] = bit(i);

  for (let i = 0; i <= 6; i++) modul[groesse - 1 - i]![8] = bit(i);
  for (let i = 7; i <= 14; i++) modul[8]![groesse - 15 + i] = bit(i);
}

function schreibeFassung(modul: number[][], fassung: number): void {
  if (fassung < 7) return;
  const groesse = modul.length;
  const bits = fassungBits(fassung);
  for (let i = 0; i < 18; i++) {
    const wert = (bits >> i) & 1;
    const zeile = Math.floor(i / 3);
    const spalte = groesse - 11 + (i % 3);
    modul[zeile]![spalte] = wert;
    modul[spalte]![zeile] = wert;
  }
}

/** Die kleinste Fassung, in die der Text noch passt. */
function passendeFassung(text: string): number {
  const laenge = Buffer.byteLength(text, 'utf8');
  for (let fassung = 1; fassung <= 10; fassung++) {
    const aufbau = EC_AUFBAU[fassung]!;
    const datenWoerter =
      aufbau.gruppe1[0] * aufbau.gruppe1[1] + aufbau.gruppe2[0] * aufbau.gruppe2[1];
    const gebraucht = 4 + (fassung <= 9 ? 8 : 16) + laenge * 8;
    if (gebraucht <= datenWoerter * 8) return fassung;
  }
  throw new Error(
    `${laenge} Byte passen in kein QR-Bild bis Fassung 10 (höchstens 213). ` +
      'Das ist für einen otpauth-Weg unerreichbar - hier stimmt etwas anderes nicht.',
  );
}

/**
 * Baut das Bild.
 *
 * Alle acht Masken werden gebaut und bewertet; genommen wird die mit den wenigsten
 * Strafpunkten. Das kostet achtmal so viel Rechnerei wie eine feste Maske und ist bei
 * einem Bild von zwei Millisekunden nicht der Rede wert - dafür liest es jede Kamera.
 */
export function qrCode(text: string): QrBild {
  const fassung = passendeFassung(text);
  const groesse = groesseZu(fassung);
  const woerter = codewoerter(text, fassung);

  /*
   * Was fest ist, wird einmal gebaut - und zwar zweimal getrennt.
   *
   * `feld` bekommt danach die Daten und ist am Ende überall belegt. `nurMuster` behält
   * seine Belegung, und nur an ihr lässt sich ablesen, welches Modul ein festes Muster ist
   * und welches Daten trägt. Maskiert werden darf ausschließlich das Zweite - sonst wären
   * die Sucher keine Sucher mehr, und das Bild wäre für jede Kamera unsichtbar.
   */
  const feld = leeresFeld(groesse);
  festeMuster(feld, fassung);
  const nurMuster = leeresFeld(groesse);
  festeMuster(nurMuster, fassung);
  setzeDaten(feld, woerter);

  let bestes: number[][] | null = null;
  let bestePunkte = Number.POSITIVE_INFINITY;

  for (let maske = 0; maske < 8; maske++) {
    const modul = feld.modul.map((zeile, z) =>
      zeile.map((wert, s) => (!nurMuster.belegt[z]![s] && maskiert(maske, z, s) ? wert ^ 1 : wert)),
    );
    schreibeFormat(modul, maske);
    schreibeFassung(modul, fassung);

    const punkte = strafe(modul);
    if (punkte < bestePunkte) {
      bestePunkte = punkte;
      bestes = modul;
    }
  }

  return {
    groesse,
    zeilen: bestes!.map((zeile) => zeile.join('')),
  };
}
