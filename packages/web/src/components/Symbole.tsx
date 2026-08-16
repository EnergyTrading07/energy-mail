import { useId } from 'react';

/**
 * Programmsymbol und die Zeichen der Oberfläche.
 *
 * Alles als eingebettete Vektorgrafik und in einer Datei: dadurch gibt es keine
 * Bilddateien, die nachgeladen werden müssten (und beim Start kurz fehlten), die Farbe
 * folgt der des Textes, und in der dunklen Ansicht stimmt sie ohne zweiten Satz Dateien.
 *
 * Die Zeichen sind bewusst gestrichen und nicht gefüllt, in derselben Strichstärke wie
 * die Ordnersymbole in FolderIcon.tsx - sonst stünden in einer Zeile zwei Sorten Grafik
 * nebeneinander, und das sieht man sofort.
 */

/** Gemeinsame Grundlage aller Strichzeichen: 16er-Raster, Strich in Textfarbe. */
function Strichzeichen({
  d,
  groesse = 16,
  strich = 1.4,
  className,
}: {
  d: string;
  groesse?: number;
  strich?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={groesse}
      height={groesse}
      fill="none"
      stroke="currentColor"
      strokeWidth={strich}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/**
 * Das Programmsymbol: eine Briefmarke, durch die ein Blitz schlägt.
 *
 * Vorher stand hier ein blaues Kästchen mit einem weißen Umschlag darin - das Zeichen,
 * das jedes zweite Mailprogramm trägt und das man auf der Taskleiste nur an der Farbe
 * wiedererkennt. Eine Briefmarke ist eindeutiger: den gezackten Rand hat sonst nichts
 * auf einem Bildschirm, er ist schon in der kleinsten Größe als Umriss zu erkennen, und
 * er sagt "Post", ohne dafür einen Umschlag zeichnen zu müssen. Der Blitz aus dem
 * Namen schlägt quer hindurch und ragt bewusst über den Rand hinaus - eine Marke, die
 * ihren Rahmen sprengt, hat mehr Leben als eine, die brav darin sitzt.
 *
 * Der Zackenrand entsteht als Maske: die Marke ist ein Rechteck, aus dem Kreise entlang
 * der Kanten herausgeschnitten sind. Das ist eine Angabe statt zwanzig Pfadpunkten und
 * bleibt bei jeder Größe rund.
 *
 * Verlauf und Maske brauchen Kennungen, und die müssen innerhalb der Seite eindeutig
 * sein - das Zeichen steht an mehreren Stellen gleichzeitig (Titelleiste, Anmeldung,
 * Über-Fenster). useId liefert genau dafür einen Wert.
 */

/** Wo die Zacken sitzen: fünf je Kante, gleichmäßig zwischen den Ecken verteilt. */
const ZACKEN = [7, 11.5, 16, 20.5, 25];

/**
 * Der Blitz, als geschlossener Weg auf dem 32er-Raster.
 *
 * Er reicht oben und unten über das Papier hinaus in den Rahmen der Marke - das ist der
 * Punkt der ganzen Form. Ein Blitz, der brav in seinem Feld sitzt, ist ein Piktogramm;
 * einer, der den Rahmen sprengt, ist ein Zeichen.
 */
const BLITZWEG = 'M19.6 4.4 L10.6 17.2 h4.4 L12.4 27.6 L21.4 14.8 h-4.4 Z';

export function Marke({ groesse = 18, className }: { groesse?: number; className?: string }) {
  const id = useId();
  const verlauf = `${id}-v`;
  const maske = `${id}-m`;
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width={groesse}
      height={groesse}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={verlauf} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f5cf0" />
          <stop offset="1" stopColor="#1b2f9c" />
        </linearGradient>
        <mask id={maske}>
          <rect x="2.5" y="2.5" width="27" height="27" rx="4.5" fill="#fff" />
          {ZACKEN.map((p) => (
            <g key={p} fill="#000">
              <circle cx={p} cy="2.5" r="1.6" />
              <circle cx={p} cy="29.5" r="1.6" />
              <circle cx="2.5" cy={p} r="1.6" />
              <circle cx="29.5" cy={p} r="1.6" />
            </g>
          ))}
        </mask>
      </defs>

      <g mask={`url(#${maske})`}>
        <rect x="2.5" y="2.5" width="27" height="27" rx="4.5" fill={`url(#${verlauf})`} />
        {/*
          Das Papier in der Marke - derselbe warme Ton wie der Grund der Anwendung.

          Hier stand zunächst noch die angedeutete Falz eines Umschlags. Sie ist wieder
          heraus: eine Briefmarke sagt bereits "Post", ein Umschlag darin sagt es ein
          zweites Mal, und weil der Blitz genau über der Spitze der Falz lag, blieben
          von ihr ohnehin nur zwei Striche übrig, die wie ein Kreuz aussahen.
        */}
        <rect x="6.4" y="7.6" width="19.2" height="16.8" rx="2" fill="#fffdf9" />
      </g>

      {/* Der Blitz liegt über der Maske und wird deshalb nicht beschnitten: er reicht
          über die Zacken hinaus. */}
      <path d={BLITZWEG} fill="#ffb225" stroke="#16205e" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/* --- Zeichen der Oberfläche ---------------------------------------------- */

/** Ausrufezeichen im Kreis - Fehler. */
export const Achtung = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M8 5v3.6 M8 10.9h.01" />
);

/** Dreieck mit Ausrufezeichen - Warnung, etwas geht schief, wenn man weitermacht. */
export const Warnzeichen = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M8 2.2L14.6 13.4H1.4z M8 6.4v3 M8 11.4h.01" />
);

/** Haken im Kreis - hat geklappt. */
export const Haken = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M5.3 8.2l2 2 3.4-3.9" />
);

/** i im Kreis - Hinweis ohne Handlungsbedarf. */
export const Hinweiszeichen = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M8 7.4v3.5 M8 5.1h.01" />
);

/** Fragezeichen im Kreis - Rückfrage, die noch nichts entscheidet. */
export const Fragezeichen = (p: { groesse?: number }) => (
  <Strichzeichen
    {...p}
    d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M6.3 6.2a1.75 1.75 0 013.4.6c0 1.2-1.7 1.5-1.7 2.7 M8 11.6h.01"
  />
);

/** Papierkorb - unumkehrbares Löschen. */
export const Papierkorb = (p: { groesse?: number }) => (
  <Strichzeichen
    {...p}
    d="M2.5 4.5h11 M6 4.5V2.5h4v2 M4 4.5l.8 9h6.4l.8-9 M6.5 7v4 M9.5 7v4"
  />
);

/** Uhr - alles, was mit einem späteren Zeitpunkt zu tun hat. */
export const Uhr = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M8 4.6V8l2.4 1.6" />
);

/** Pfeil nach unten in eine Schale - Aktualisierung wird geladen. */
export const Herunterladen = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M8 2v7.2 M5.2 6.6L8 9.4l2.8-2.8 M2.8 11.6v1.6h10.4v-1.6" />
);

/** Kreis aus zwei Pfeilen - nach Aktualisierungen suchen, neu starten. */
export const Kreispfeil = (p: { groesse?: number }) => (
  <Strichzeichen
    {...p}
    d="M13.4 7.2A5.5 5.5 0 003.3 5.4 M2.6 8.8a5.5 5.5 0 0010.1 1.8 M13.6 2.9v3.6h-3.6 M2.4 13.1V9.5h3.6"
  />
);

/** Sonne - helle Ansicht. */
export const Sonne = (p: { groesse?: number }) => (
  <Strichzeichen
    {...p}
    d="M8 5.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z M8 1.4v1.6 M8 13v1.6 M2.9 2.9l1.1 1.1 M12 12l1.1 1.1 M1.4 8h1.6 M13 8h1.6 M2.9 13.1L4 12 M12 4l1.1-1.1"
  />
);

/** Mond - dunkle Ansicht. */
export const Mond = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M13.4 9.6A5.9 5.9 0 016.4 2.6a5.9 5.9 0 107 7z" />
);

/** Federhalter - eine neue Nachricht verfassen. */
export const Feder = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M2.6 13.4l1-3.2 7-7a1.9 1.9 0 012.7 2.7l-7 7z M9.6 4.2l2.2 2.2 M2.6 13.4l2.6-.8" />
);

/** Lupe - Suchfeld. */
export const Lupe = (p: { groesse?: number }) => (
  <Strichzeichen {...p} d="M7.2 2.4a4.8 4.8 0 100 9.6 4.8 4.8 0 000-9.6z M10.8 10.8l3 3" />
);

/**
 * Büroklammer - eine Nachricht mit Anhang.
 *
 * Vorher stand an dieser Stelle das Schriftzeichen 📎. Das zeichnet jedes System anders,
 * es bringt seine eigene Farbe mit (auf einer dunklen Zeile ein graues Kästchen) und es
 * ist deutlich größer als die Zeichen daneben - in einer Liste, in der jede Zeile 17
 * Pixel hoch ist, fällt genau das auf.
 */
export const Klammer = (p: { groesse?: number }) => (
  <Strichzeichen
    {...p}
    strich={1.3}
    d="M11.6 7.6l-4.7 4.7a2.6 2.6 0 01-3.7-3.7l5.6-5.6a1.7 1.7 0 012.4 2.4l-5.5 5.5a.8.8 0 01-1.2-1.1l5-5"
  />
);

/**
 * Der Blitz aus dem Programmsymbol, als Zeichen für sich.
 *
 * Ausgefüllt statt gestrichen - anders als alle übrigen Zeichen hier. Das ist Absicht:
 * er steht nicht für eine Handlung, sondern für Energie (Ungelesenes, neue Post), und
 * eine gefüllte Form liest sich als Zustand, eine gestrichene als Knopf.
 */
export const Blitz = ({ groesse = 12 }: { groesse?: number }) => (
  <svg
    viewBox="0 0 16 16"
    width={groesse}
    height={groesse}
    fill="currentColor"
    aria-hidden="true"
  >
    <path d="M9.8 1.2 3.6 9.1h3.2l-1.1 5.7 6.2-7.9H8.7z" />
  </svg>
);

/** Winkel nach rechts - klappt einen Bereich auf und zu. Gedreht wird er per CSS. */
export const Winkel = (p: { groesse?: number }) => (
  <Strichzeichen {...p} strich={1.6} d="M6 3.4L10.6 8 6 12.6" />
);

/** Leerer Posteingang - für Bereiche, in denen nichts (mehr) liegt. */
export const LeererKorb = ({ groesse = 44 }: { groesse?: number }) => (
  <svg
    viewBox="0 0 48 48"
    width={groesse}
    height={groesse}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 28h8l2.5 5h15l2.5-5h8" />
    <path d="M10 11h28l6 17v12H4V28z" />
  </svg>
);

/**
 * Die drei Fensterknöpfe stehen hier bewusst nicht.
 *
 * Sie werden nicht selbst gezeichnet, sondern von Chromium in die Leiste eingeblendet
 * (titleBarOverlay in main.ts) - mit unseren Farben, aber mit dem Verhalten, das Windows
 * dafür vorsieht. Der Unterschied ist nicht nur Aufwand: nur so bleiben die Ausrichtungs-
 * hilfen von Windows 11 erhalten, die erscheinen, wenn man auf dem Maximieren-Knopf
 * stehen bleibt. Nachgebaute Knöpfe haben das nicht, und es fehlt sofort auf.
 *
 * Der Platz dafür wird über env(titlebar-area-width) freigehalten, siehe index.css.
 */
