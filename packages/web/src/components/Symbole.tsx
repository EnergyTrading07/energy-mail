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
 * Das Programmsymbol: Umschlag mit Blitz, wie auf der Verknüpfung und im Startmenü.
 *
 * Der Farbverlauf braucht eine Kennung, und die muss innerhalb der Seite eindeutig sein -
 * das Zeichen steht an mehreren Stellen gleichzeitig (Titelleiste, Über-Fenster). useId
 * liefert genau dafür einen Wert, der auch bei serverseitigem Vorzeichnen stimmt.
 */
export function Marke({ groesse = 18, className }: { groesse?: number; className?: string }) {
  const id = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      width={groesse}
      height={groesse}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a7ce6" />
          <stop offset="1" stopColor="#1c42a8" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${id})`} />
      <rect x="5.5" y="9.5" width="21" height="13.5" rx="2" fill="#fff" />
      <path
        d="M6.6 10.8 L16 18.4 L25.4 10.8"
        fill="none"
        stroke="#1b3a86"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23.4 6.6 L16.4 18 L20 18 L18 27 L25.6 15.4 L22 15.4 Z"
        fill="#f5c518"
        stroke="#1b3a86"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
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
