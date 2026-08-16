/**
 * Erzeugt die Bilder, die außerhalb der Oberfläche gebraucht werden.
 *
 *   node scripts/installer-grafiken.mjs
 *
 * Das sind vier: das Programmsymbol (build/icon.png), aus dem electron-builder die
 * .ico für Verknüpfung, Taskleiste und Startmenü rechnet, sowie die drei Grafiken des
 * Installationsprogramms. NSIS zeigt eine hohe Fläche links auf der Begrüßungs- und der
 * Schlussseite (164×314) und einen schmalen Streifen oben rechts auf allen Seiten
 * dazwischen (150×57); ohne eigene Bilder nimmt es seine eigenen - eine graue Fläche mit
 * einer Weltkugel, die mit der Anwendung nichts zu tun hat. Das ist das Erste, was
 * jemand von Energy Mail sieht.
 *
 * Warum ein Skript und nicht vier Bilddateien im Verzeichnis?
 *
 * Weil NSIS ausschließlich BMP annimmt - unkomprimiert, und die 24-Bit-Fassung davon ist
 * so einfach aufgebaut, dass sie sich in fünfzig Zeilen schreiben lässt. PNG kostet
 * dreißig Zeilen mehr, weil die Bildzeilen durch zlib müssen - das bringt Node selbst
 * mit. Ein Bildprogramm dafür vorauszusetzen (oder eine Abhängigkeit ins Projekt zu
 * holen, die nur beim Verpacken gebraucht wird) wäre der größere Aufwand.
 *
 * Der eigentliche Gewinn ist aber ein anderer: die Form steht hier im selben Quelltext
 * wie das Zeichen in der Anwendung (packages/web/src/components/Symbole.tsx). Ändert
 * sich die Marke, wird das Skript neu ausgeführt und alle vier Bilder stimmen wieder -
 * statt dass jemand vier Dateien in einem Bildprogramm nachzieht und eine vergisst.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

/** Dreifach zeichnen und danach zusammenfassen - sonst sind alle Rundungen treppig. */
const FEIN = 3;

/* --- Zeichenfläche -------------------------------------------------------- */

/**
 * Eine Fläche mit Deckkraft.
 *
 * Vier Werte je Punkt statt drei, und das ist nicht nur für das PNG nötig: die Zacken
 * der Briefmarke entstehen, indem Löcher in die Fläche gestanzt werden. Ohne Deckkraft
 * müsste dafür die Farbe des Untergrunds bekannt sein - und die ist bei den drei
 * Installationsbildern jedes Mal eine andere.
 */
function flaeche(breite, hoehe) {
  const b = breite * FEIN;
  const h = hoehe * FEIN;
  return {
    b,
    h,
    breite,
    hoehe,
    daten: new Float64Array(b * h * 4),

    /** Malt einen Punkt darüber - das übliche "source-over". */
    punkt(x, y, [r, g, bl], deckung = 1) {
      if (x < 0 || y < 0 || x >= this.b || y >= this.h || deckung <= 0) return;
      const i = (Math.floor(y) * this.b + Math.floor(x)) * 4;
      const d = this.daten;
      const za = deckung + d[i + 3] * (1 - deckung);
      if (za <= 0) return;
      d[i] = (r * deckung + d[i] * d[i + 3] * (1 - deckung)) / za;
      d[i + 1] = (g * deckung + d[i + 1] * d[i + 3] * (1 - deckung)) / za;
      d[i + 2] = (bl * deckung + d[i + 2] * d[i + 3] * (1 - deckung)) / za;
      d[i + 3] = za;
    },

    /** Stanzt einen Punkt heraus, statt ihn zu übermalen. */
    stanze(x, y) {
      if (x < 0 || y < 0 || x >= this.b || y >= this.h) return;
      this.daten[(Math.floor(y) * this.b + Math.floor(x)) * 4 + 3] = 0;
    },

    /** Senkrechter Farbverlauf über die ganze Fläche. */
    verlauf(oben, unten) {
      for (let y = 0; y < this.h; y++) {
        const t = y / (this.h - 1);
        const farbe = [0, 1, 2].map((k) => oben[k] + (unten[k] - oben[k]) * t);
        for (let x = 0; x < this.b; x++) this.punkt(x, y, farbe);
      }
    },

    /** Vielecke werden zeilenweise gefüllt - der übliche Weg, und hier genügt er. */
    vieleck(punkte, farbe, deckung = 1) {
      const ys = punkte.map((p) => p[1]);
      const von = Math.max(0, Math.floor(Math.min(...ys)));
      const bis = Math.min(this.h - 1, Math.ceil(Math.max(...ys)));
      for (let y = von; y <= bis; y++) {
        const mitte = y + 0.5;
        const schnitte = [];
        for (let i = 0, j = punkte.length - 1; i < punkte.length; j = i++) {
          const [x1, y1] = punkte[j];
          const [x2, y2] = punkte[i];
          if (y1 <= mitte === y2 <= mitte) continue;
          schnitte.push(x1 + ((mitte - y1) / (y2 - y1)) * (x2 - x1));
        }
        schnitte.sort((a, b) => a - b);
        for (let i = 0; i + 1 < schnitte.length; i += 2) {
          for (let x = Math.ceil(schnitte[i]); x < schnitte[i + 1]; x++) {
            this.punkt(x, y, farbe, deckung);
          }
        }
      }
    },

    scheibe(mx, my, r, farbe, deckung = 1) {
      for (let y = Math.floor(my - r); y <= my + r; y++) {
        for (let x = Math.floor(mx - r); x <= mx + r; x++) {
          if ((x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2 <= r * r) {
            this.punkt(x, y, farbe, deckung);
          }
        }
      }
    },

    stanzScheibe(mx, my, r) {
      for (let y = Math.floor(my - r); y <= my + r; y++) {
        for (let x = Math.floor(mx - r); x <= mx + r; x++) {
          if ((x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2 <= r * r) this.stanze(x, y);
        }
      }
    },

    /** Strich mit runden Enden - aus dicht gesetzten Scheiben, das genügt völlig. */
    strich(punkte, staerke, farbe, deckung = 1) {
      const r = staerke / 2;
      for (let i = 0; i + 1 < punkte.length; i++) {
        const [x1, y1] = punkte[i];
        const [x2, y2] = punkte[i + 1];
        const laenge = Math.hypot(x2 - x1, y2 - y1);
        const schritte = Math.ceil(laenge * 2);
        for (let s = 0; s <= schritte; s++) {
          const t = s / schritte;
          this.scheibe(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r, farbe, deckung);
        }
      }
    },

    ecke(x, y, br, ho, r, farbe) {
      this.vieleck(
        [
          [x + r, y],
          [x + br - r, y],
          [x + br, y + r],
          [x + br, y + ho - r],
          [x + br - r, y + ho],
          [x + r, y + ho],
          [x, y + ho - r],
          [x, y + r],
        ],
        farbe,
      );
      for (const [ex, ey] of [
        [x + r, y + r],
        [x + br - r, y + r],
        [x + r, y + ho - r],
        [x + br - r, y + ho - r],
      ]) {
        this.scheibe(ex, ey, r, farbe);
      }
    },

    /** Legt eine andere Fläche darauf - beide im selben feinen Raster. */
    lege(quelle, x, y) {
      for (let qy = 0; qy < quelle.h; qy++) {
        for (let qx = 0; qx < quelle.b; qx++) {
          const i = (qy * quelle.b + qx) * 4;
          const a = quelle.daten[i + 3];
          if (a <= 0) continue;
          this.punkt(
            x + qx,
            y + qy,
            [quelle.daten[i], quelle.daten[i + 1], quelle.daten[i + 2]],
            a,
          );
        }
      }
    },

    /**
     * Fasst die dreifach gezeichneten Punkte zu je einem zusammen.
     *
     * Gemittelt wird mit vorher aufmultiplizierter Deckkraft: sonst zöge die Farbe
     * durchsichtiger Punkte (die beliebig sein kann) an den Kanten mit und ergäbe dort
     * dunkle Säume.
     */
    zusammenfassen() {
      const aus = new Uint8ClampedArray(this.breite * this.hoehe * 4);
      const n = FEIN * FEIN;
      for (let y = 0; y < this.hoehe; y++) {
        for (let x = 0; x < this.breite; x++) {
          let r = 0;
          let g = 0;
          let b = 0;
          let a = 0;
          for (let dy = 0; dy < FEIN; dy++) {
            for (let dx = 0; dx < FEIN; dx++) {
              const i = ((y * FEIN + dy) * this.b + (x * FEIN + dx)) * 4;
              const pa = this.daten[i + 3];
              r += this.daten[i] * pa;
              g += this.daten[i + 1] * pa;
              b += this.daten[i + 2] * pa;
              a += pa;
            }
          }
          const ziel = (y * this.breite + x) * 4;
          aus[ziel] = a > 0 ? r / a : 0;
          aus[ziel + 1] = a > 0 ? g / a : 0;
          aus[ziel + 2] = a > 0 ? b / a : 0;
          aus[ziel + 3] = (a / n) * 255;
        }
      }
      return aus;
    },

    /**
     * Schreibt als 24-Bit-BMP. Der Aufbau: 14 Byte Dateikopf, 40 Byte Bildkopf, dann die
     * Punkte - von unten nach oben, blau vor grün vor rot, und jede Zeile auf vier Byte
     * aufgefüllt. Deckkraft kennt dieses Format nicht; was durchsichtig ist, wird auf den
     * angegebenen Grund gerechnet.
     */
    schreibeBmp(pfad, grund = [255, 255, 255]) {
      const bild = this.zusammenfassen();
      const zeile = Math.ceil((this.breite * 3) / 4) * 4;
      const bilddaten = zeile * this.hoehe;
      const puffer = Buffer.alloc(54 + bilddaten);

      puffer.write('BM', 0);
      puffer.writeUInt32LE(54 + bilddaten, 2);
      puffer.writeUInt32LE(54, 10);
      puffer.writeUInt32LE(40, 14);
      puffer.writeInt32LE(this.breite, 18);
      puffer.writeInt32LE(this.hoehe, 22);
      puffer.writeUInt16LE(1, 26);
      puffer.writeUInt16LE(24, 28);
      puffer.writeUInt32LE(bilddaten, 34);

      for (let y = 0; y < this.hoehe; y++) {
        for (let x = 0; x < this.breite; x++) {
          const i = (y * this.breite + x) * 4;
          const a = bild[i + 3] / 255;
          // Von unten nach oben, deshalb die gespiegelte Zeile.
          const ziel = 54 + (this.hoehe - 1 - y) * zeile + x * 3;
          puffer[ziel] = bild[i + 2] * a + grund[2] * (1 - a);
          puffer[ziel + 1] = bild[i + 1] * a + grund[1] * (1 - a);
          puffer[ziel + 2] = bild[i] * a + grund[0] * (1 - a);
        }
      }

      writeFileSync(pfad, puffer);
      console.log(`${pfad} (${this.breite}×${this.hoehe})`);
    },

    /** Schreibt als PNG mit Deckkraft - das Format, das electron-builder erwartet. */
    schreibePng(pfad) {
      schreibePng(pfad, this.breite, this.hoehe, this.zusammenfassen());
      console.log(`${pfad} (${this.breite}×${this.hoehe})`);
    },
  };
}

/* --- PNG ------------------------------------------------------------------ */

const CRC_TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(daten) {
  let c = 0xffffffff;
  for (const b of daten) c = CRC_TABELLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function abschnitt(name, inhalt) {
  const kopf = Buffer.alloc(8);
  kopf.writeUInt32BE(inhalt.length, 0);
  kopf.write(name, 4, 'ascii');
  const pruef = Buffer.alloc(4);
  pruef.writeUInt32BE(crc32(Buffer.concat([kopf.subarray(4), inhalt])), 0);
  return Buffer.concat([kopf, inhalt, pruef]);
}

/**
 * Ein PNG besteht aus einer festen Kennung und einer Folge benannter Abschnitte, jeder
 * mit Länge und Prüfsumme. Gebraucht werden genau drei: IHDR (Maße und Bildart), IDAT
 * (die Punkte, durch zlib gedreht) und IEND. Jede Bildzeile beginnt mit einem Byte, das
 * angibt, wie sie zur vorigen gerechnet wurde; 0 heißt "gar nicht" - das kostet etwas
 * Dateigröße und spart die ganze Vorhersagerechnerei.
 */
function schreibePng(pfad, breite, hoehe, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(breite, 0);
  ihdr.writeUInt32BE(hoehe, 4);
  ihdr[8] = 8; // Bit je Kanal
  ihdr[9] = 6; // Rot, Gruen, Blau, Deckkraft
  ihdr[10] = 0; // Verdichtung: zlib
  ihdr[11] = 0; // Vorhersage: die uebliche
  ihdr[12] = 0; // nicht verschraenkt

  const roh = Buffer.alloc(hoehe * (1 + breite * 4));
  for (let y = 0; y < hoehe; y++) {
    const ziel = y * (1 + breite * 4);
    roh[ziel] = 0;
    for (let x = 0; x < breite * 4; x++) roh[ziel + 1 + x] = rgba[y * breite * 4 + x];
  }

  writeFileSync(
    pfad,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      abschnitt('IHDR', ihdr),
      abschnitt('IDAT', deflateSync(roh, { level: 9 })),
      abschnitt('IEND', Buffer.alloc(0)),
    ]),
  );
}

/* --- Die Marke ------------------------------------------------------------ */

const PAPIER = [255, 253, 249];
const TIEFBLAU = [27, 47, 156];
const RANDBLAU = [22, 32, 94];
const HELLBLAU = [63, 92, 240];
const BLITZ = [255, 178, 37];

/** Wo die Zacken sitzen - dieselben fünf Stellen je Kante wie in Symbole.tsx. */
const ZACKEN = [7, 11.5, 16, 20.5, 25];

const BLITZWEG = [
  [19.6, 4.4],
  [10.6, 17.2],
  [15, 17.2],
  [12.4, 27.6],
  [21.4, 14.8],
  [17, 14.8],
];

/**
 * Die Briefmarke mit dem Blitz, auf einem 32er-Raster - dieselben Maße wie in
 * Symbole.tsx. Warum ausgerechnet eine Briefmarke, steht dort.
 *
 * Sie entsteht auf einer eigenen Fläche und wird danach aufgelegt. Der Grund sind die
 * Zacken: sie werden aus der Marke herausgestanzt, und was dort durchscheint, ist der
 * Untergrund des jeweiligen Bildes - bei der Seitenfläche ein blauer Verlauf, beim
 * Programmsymbol gar nichts.
 */
function markenFlaeche(groesse) {
  const f = flaeche(groesse, groesse);
  const s = (f.b / 32) * 1;
  const p = (x, y) => [x * s, y * s];
  const weg = (paare) => paare.map(([x, y]) => p(x, y));

  // Der Körper der Marke: abgerundetes Quadrat mit schrägem Verlauf. Zeilenweise
  // aufgetragen und danach beschnitten - für einen schrägen Verlauf in einer
  // abgerundeten Form ist das der kürzeste Weg.
  const rand = 2.5;
  const seite = 27;
  const r = 4.5;
  for (let y = 0; y < seite * s; y++) {
    for (let x = 0; x < seite * s; x++) {
      const t = (x / (seite * s) + y / (seite * s)) / 2;
      const farbe = [0, 1, 2].map((k) => HELLBLAU[k] + (TIEFBLAU[k] - HELLBLAU[k]) * t);
      f.punkt(rand * s + x, rand * s + y, farbe);
    }
  }
  // Die vier Ecken wieder abrunden: was außerhalb des Radius liegt, wird gestanzt.
  for (const [ex, ey, rx, ry] of [
    [rand + r, rand + r, -1, -1],
    [rand + seite - r, rand + r, 1, -1],
    [rand + r, rand + seite - r, -1, 1],
    [rand + seite - r, rand + seite - r, 1, 1],
  ]) {
    for (let y = 0; y <= r * s; y++) {
      for (let x = 0; x <= r * s; x++) {
        const px = ex * s + rx * x;
        const py = ey * s + ry * y;
        if (x * x + y * y > (r * s) ** 2) f.stanze(px, py);
      }
    }
  }

  // Das Papier in der Marke.
  f.ecke(...p(6.4, 7.6), 19.2 * s, 16.8 * s, 2 * s, PAPIER);

  // Die Zacken. Zuletzt am Körper, aber vor dem Blitz: der liegt darüber und wird nicht
  // beschnitten - eine Marke, die ihren Rahmen sprengt.
  for (const z of ZACKEN) {
    f.stanzScheibe(z * s, 2.5 * s, 1.6 * s);
    f.stanzScheibe(z * s, 29.5 * s, 1.6 * s);
    f.stanzScheibe(2.5 * s, z * s, 1.6 * s);
    f.stanzScheibe(29.5 * s, z * s, 1.6 * s);
  }

  // Der Blitz: erst der geschlossene Weg als dunkler Strich, dann das Gelb hinein. Der
  // Strich liegt mittig auf der Kante, die Hälfte davon bleibt also außen stehen - genau
  // das, was ein "stroke" in der Vektorgrafik tut, und damit dieselbe Form wie dort.
  f.strich([...weg(BLITZWEG), ...weg([BLITZWEG[0]])], 1.5 * s, RANDBLAU);
  f.vieleck(weg(BLITZWEG), BLITZ);

  return f;
}

/** Legt die Marke mittig auf eine Stelle. */
function marke(ziel, mx, my, groesse) {
  const m = markenFlaeche(groesse);
  ziel.lege(m, mx - m.b / 2, my - m.h / 2);
}

/* --- Die vier Bilder ------------------------------------------------------ */

/**
 * Das Programmsymbol.
 *
 * 512×512, weil electron-builder daraus alle kleineren Größen der .ico rechnet. Die
 * Marke füllt fast die ganze Fläche: Windows setzt seinen eigenen Abstand um das
 * Symbol, und wer noch einen mitliefert, hat auf der Taskleiste ein Symbol, das kleiner
 * ist als alle daneben.
 */
function programmsymbol() {
  const f = flaeche(512, 512);
  /*
   * Die Marke misst auf ihrem 32er-Raster 27 Einheiten, sitzt aber in einer Fläche von
   * 32 - der Rest ist Luft. Wird die Fläche größer gewählt als das Bild, ragt genau
   * diese Luft darüber hinaus und wird beschnitten; übrig bleiben rund 16 Punkte Rand.
   * 27/32 · 569 ≈ 480, also 94 % der Kante.
   */
  marke(f, f.b / 2, f.h / 2, 569);
  f.schreibePng(join(BUILD, 'icon.png'));
}

/**
 * Die hohe Fläche der Begrüßungs- und Schlussseite.
 *
 * Dunkler als die Anwendung selbst und mit einem schrägen Lichtstreifen: sie steht
 * neben schwarzem Text auf hellem Grund und muss sich davon absetzen, ohne mit ihm um
 * Aufmerksamkeit zu ringen.
 */
function seitenbild(pfad, oben, unten, streifen) {
  const f = flaeche(164, 314);
  f.verlauf(oben, unten);

  // Ein sehr flacher heller Keil von links unten nach rechts oben, zurückhaltend
  // aufgetragen - voll gezeichnet war er zu kräftig.
  f.vieleck(
    [
      [0, f.h * 0.72],
      [f.b, f.h * 0.34],
      [f.b, f.h * 0.46],
      [0, f.h * 0.84],
    ],
    [255, 255, 255],
    0.07,
  );

  marke(f, f.b / 2, f.h * 0.36, 92 * FEIN);

  // Dünner Strich in der Blitzfarbe am unteren Rand - der einzige Abschluss, den die
  // Fläche braucht.
  for (let y = f.h - 4 * FEIN; y < f.h; y++) {
    for (let x = 0; x < f.b; x++) f.punkt(x, y, streifen);
  }

  f.schreibeBmp(join(BUILD, pfad), oben);
}

/** Der Streifen oben rechts. Heller Grund, weil NSIS den Kopfbereich weiß zeichnet. */
function kopfbild(pfad) {
  const f = flaeche(150, 57);
  f.verlauf([255, 255, 255], [247, 244, 238]);
  marke(f, f.b - 30 * FEIN, f.h / 2, 42 * FEIN);
  f.schreibeBmp(join(BUILD, pfad), [255, 255, 255]);
}

programmsymbol();
seitenbild('installerSidebar.bmp', [34, 52, 148], [10, 16, 60], BLITZ);
// Beim Entfernen dieselbe Form, aber ohne Farbe: es ist derselbe Vorgang rückwärts,
// und ein festliches Bild wäre hier fehl am Platz.
seitenbild('uninstallerSidebar.bmp', [64, 68, 82], [24, 26, 36], [176, 174, 168]);
kopfbild('installerHeader.bmp');
