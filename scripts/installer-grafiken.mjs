/**
 * Erzeugt die Bilder für das Installationsprogramm.
 *
 * NSIS zeigt an drei Stellen Grafiken: eine hohe Fläche links auf der Begrüßungs- und
 * der Schlussseite (164×314) sowie einen schmalen Streifen oben rechts auf allen Seiten
 * dazwischen (150×57). Ohne eigene Bilder nimmt es seine eigenen - eine graue Fläche mit
 * einer Weltkugel, die mit der Anwendung nichts zu tun hat. Das ist das Erste, was
 * jemand von Energy Mail sieht.
 *
 * Warum ein eigenes Skript und nicht eine Bilddatei im Verzeichnis? Weil NSIS
 * ausschließlich BMP annimmt - unkomprimiert, und die 24-Bit-Fassung davon ist so
 * einfach aufgebaut, dass sie sich in fünfzig Zeilen schreiben lässt. Ein Bildprogramm
 * dafür vorauszusetzen (oder eine Abhängigkeit ins Projekt zu holen, die nur beim
 * Verpacken gebraucht wird) wäre der größere Aufwand. Und so ist die Form aus demselben
 * Quelltext abgeleitet wie das Zeichen in der Anwendung: ändert sich die Marke, wird das
 * Skript neu ausgeführt.
 *
 *   node scripts/installer-grafiken.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BUILD = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');

/** Dreifach zeichnen und danach zusammenfassen - sonst sind alle Rundungen treppig. */
const FEIN = 3;

/* --- Zeichenfläche -------------------------------------------------------- */

function flaeche(breite, hoehe) {
  const b = breite * FEIN;
  const h = hoehe * FEIN;
  return {
    b,
    h,
    breite,
    hoehe,
    // Drei Werte je Punkt, der Reihe nach von oben nach unten.
    daten: new Uint8ClampedArray(b * h * 3),

    punkt(x, y, [r, g, bl], deckung = 1) {
      if (x < 0 || y < 0 || x >= this.b || y >= this.h) return;
      const i = (Math.floor(y) * this.b + Math.floor(x)) * 3;
      const d = this.daten;
      d[i] = d[i] * (1 - deckung) + r * deckung;
      d[i + 1] = d[i + 1] * (1 - deckung) + g * deckung;
      d[i + 2] = d[i + 2] * (1 - deckung) + bl * deckung;
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
    vieleck(punkte, farbe) {
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
            this.punkt(x, y, farbe);
          }
        }
      }
    },

    scheibe(mx, my, r, farbe) {
      for (let y = Math.floor(my - r); y <= my + r; y++) {
        for (let x = Math.floor(mx - r); x <= mx + r; x++) {
          if ((x + 0.5 - mx) ** 2 + (y + 0.5 - my) ** 2 <= r * r) this.punkt(x, y, farbe);
        }
      }
    },

    /** Strich mit runden Enden - aus dicht gesetzten Scheiben, das genügt völlig. */
    strich(punkte, staerke, farbe) {
      const r = staerke / 2;
      for (let i = 0; i + 1 < punkte.length; i++) {
        const [x1, y1] = punkte[i];
        const [x2, y2] = punkte[i + 1];
        const laenge = Math.hypot(x2 - x1, y2 - y1);
        const schritte = Math.ceil(laenge * 2);
        for (let s = 0; s <= schritte; s++) {
          const t = s / schritte;
          this.scheibe(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r, farbe);
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

    /**
     * Fasst die dreifach gezeichneten Punkte zu je einem zusammen und schreibt sie als
     * BMP. Der Aufbau: 14 Byte Dateikopf, 40 Byte Bildkopf, dann die Punkte - von unten
     * nach oben, blau vor grün vor rot, und jede Zeile auf vier Byte aufgefüllt.
     */
    schreibe(pfad) {
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
          let r = 0;
          let g = 0;
          let b = 0;
          for (let dy = 0; dy < FEIN; dy++) {
            for (let dx = 0; dx < FEIN; dx++) {
              const i = ((y * FEIN + dy) * this.b + (x * FEIN + dx)) * 3;
              r += this.daten[i];
              g += this.daten[i + 1];
              b += this.daten[i + 2];
            }
          }
          const n = FEIN * FEIN;
          // Von unten nach oben, deshalb die gespiegelte Zeile.
          const ziel = 54 + (this.hoehe - 1 - y) * zeile + x * 3;
          puffer[ziel] = b / n;
          puffer[ziel + 1] = g / n;
          puffer[ziel + 2] = r / n;
        }
      }

      writeFileSync(pfad, puffer);
      console.log(`${pfad} (${this.breite}×${this.hoehe})`);
    },
  };
}

/* --- Marke ---------------------------------------------------------------- */

const WEISS = [255, 255, 255];
const TIEFBLAU = [27, 58, 134];
const BLITZ = [245, 197, 24];

/**
 * Das Programmzeichen auf einem 32er-Raster - dieselben Maße wie in Symbole.tsx, nur
 * verschoben und skaliert.
 *
 * Der abgerundete Kasten darunter ist wahlweise: auf der blauen Seitenfläche wäre er ein
 * zweiter Kasten auf blauem Grund und sähe wie ein aufgeklebtes Bild aus. Im Kopfstreifen
 * dagegen ist er unentbehrlich - dort ist der Grund weiß, und ohne ihn verschwindet der
 * weiße Umschlag darin. Übrig blieben ein Haken und ein Blitz.
 */
function marke(f, mx, my, groesse, blitzFarbe = BLITZ, mitKasten = false) {
  const s = groesse / 32;
  const p = (x, y) => [mx + (x - 16) * s, my + (y - 16) * s];
  const weg = (paare) => paare.map(([x, y]) => p(x, y));

  if (mitKasten) {
    // Derselbe Verlauf wie im Programmsymbol, zeilenweise aufgetragen.
    const [kx, ky] = p(0, 0);
    for (let y = 0; y < 32; y++) {
      const t = y / 31;
      const farbe = [74 + (28 - 74) * t, 124 + (66 - 124) * t, 230 + (168 - 230) * t];
      // Die Zeile jeweils nur so breit wie der abgerundete Kasten an dieser Stelle.
      const r = 7.5;
      const rand =
        y < r ? r - Math.sqrt(r * r - (r - y) ** 2)
        : y > 32 - r ? r - Math.sqrt(r * r - (y - (32 - r)) ** 2)
        : 0;
      f.vieleck(
        [
          [kx + rand * s, ky + y * s],
          [kx + (32 - rand) * s, ky + y * s],
          [kx + (32 - rand) * s, ky + (y + 1) * s],
          [kx + rand * s, ky + (y + 1) * s],
        ],
        farbe,
      );
    }
  }

  // Umschlag
  f.ecke(...p(5.5, 9.5), 21 * s, 13.5 * s, 2 * s, WEISS);
  // Die Falz
  f.strich(weg([[6.6, 10.8], [16, 18.4], [25.4, 10.8]]), 2.5 * s, TIEFBLAU);

  const blitz = [
    [23.4, 6.6],
    [16.4, 18],
    [20, 18],
    [18, 27],
    [25.6, 15.4],
    [22, 15.4],
  ];
  // Erst etwas größer in Dunkelblau, dann in Gelb darauf - das ergibt den Rand um den
  // Blitz, ohne dass ein Vieleck umrandet werden müsste.
  const mitte = [
    blitz.reduce((n, b) => n + b[0], 0) / blitz.length,
    blitz.reduce((n, b) => n + b[1], 0) / blitz.length,
  ];
  f.vieleck(
    weg(blitz.map(([x, y]) => [x + (x - mitte[0]) * 0.11, y + (y - mitte[1]) * 0.11])),
    TIEFBLAU,
  );
  f.vieleck(weg(blitz), blitzFarbe);
}

/* --- Die drei Bilder ------------------------------------------------------ */

/**
 * Die hohe Fläche der Begrüßungs- und Schlussseite.
 *
 * Dunkler als die Anwendung selbst und mit einem schrägen Lichtstreifen: sie steht
 * neben weißem Text auf weißem Grund und muss sich davon absetzen, ohne mit ihm um
 * Aufmerksamkeit zu ringen.
 */
function seitenbild(pfad, oben, unten, blitzFarbe) {
  const f = flaeche(164, 314);
  f.verlauf(oben, unten);

  // Ein sehr flacher heller Keil von links unten nach rechts oben.
  f.vieleck(
    [
      [0, f.h * 0.72],
      [f.b, f.h * 0.34],
      [f.b, f.h * 0.46],
      [0, f.h * 0.84],
    ],
    [255, 255, 255],
  );
  // Der Keil ist zu kräftig geraten - halb zurücknehmen, indem der Verlauf darüber
  // noch einmal halbdurchsichtig gezeichnet wird.
  for (let y = 0; y < f.h; y++) {
    const t = y / (f.h - 1);
    const farbe = [0, 1, 2].map((k) => oben[k] + (unten[k] - oben[k]) * t);
    for (let x = 0; x < f.b; x++) f.punkt(x, y, farbe, 0.93);
  }

  marke(f, f.b / 2, f.h * 0.36, 78 * FEIN, blitzFarbe);

  // Dünner Strich in der Blitzfarbe am unteren Rand - der einzige Abschluss, den die
  // Fläche braucht.
  for (let y = f.h - 4 * FEIN; y < f.h; y++) {
    for (let x = 0; x < f.b; x++) f.punkt(x, y, blitzFarbe);
  }

  f.schreibe(join(BUILD, pfad));
}

/** Der Streifen oben rechts. Heller Grund, weil NSIS den Kopfbereich weiß zeichnet. */
function kopfbild(pfad) {
  const f = flaeche(150, 57);
  f.verlauf([255, 255, 255], [246, 248, 252]);
  marke(f, f.b - 30 * FEIN, f.h / 2, 40 * FEIN, BLITZ, true);
  f.schreibe(join(BUILD, pfad));
}

seitenbild('installerSidebar.bmp', [42, 92, 214], [14, 34, 92], BLITZ);
// Beim Entfernen dieselbe Form, aber ohne Farbe: es ist derselbe Vorgang rückwärts,
// und ein festliches Bild wäre hier fehl am Platz.
seitenbild('uninstallerSidebar.bmp', [72, 82, 102], [28, 34, 46], [176, 182, 194]);
kopfbild('installerHeader.bmp');
