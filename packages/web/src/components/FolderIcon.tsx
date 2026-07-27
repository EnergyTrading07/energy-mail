/**
 * Symbole je Ordnerrolle.
 *
 * Anbieterunabhängig, weil der IMAP-Server die Rolle maschinenlesbar mitliefert
 * (\Inbox, \Trash, …) - dieselbe Grundlage, auf der auch Löschen und Entwürfe arbeiten.
 * Als eingebettete Vektorgrafik, damit keine Bilddateien nötig sind und die Farbe der
 * Textfarbe folgt.
 */
const PFADE: Record<string, string> = {
  // Ablagekorb mit Pfeil hinein
  '\\Inbox': 'M2.5 9.5h3l1 2h3l1-2h3M4 3.5h8l2 6v4H2v-4z',
  // Bleistift
  '\\Drafts': 'M10.5 2.5l3 3-8 8-3.5 .5.5-3.5z',
  // Papierflieger
  '\\Sent': 'M14 2.5L2 7l4.5 1.5L8 13.5l2-4.5z M6.5 8.5L14 2.5',
  // Schild mit Ausrufezeichen
  '\\Junk': 'M8 2l5 2v3.5c0 3-2 5.2-5 6.2-3-1-5-3.2-5-6.2V4z M8 6v3 M8 11.2h.01',
  // Papierkorb
  '\\Trash': 'M2.5 4.5h11 M6 4.5V2.5h4v2 M4 4.5l.8 9h6.4l.8-9 M6.5 7v4 M9.5 7v4',
  // Stern
  '\\Flagged': 'M8 2l1.9 3.9 4.1.6-3 3 .7 4.2L8 11.7l-3.7 2 .7-4.2-3-3 4.1-.6z',
  // Stapel (alle Nachrichten)
  '\\All': 'M2.5 5.5h11v7h-11z M4 3.5h8 M5.5 8.5h5',
  // Archivkiste
  '\\Archive': 'M2 3.5h12v3H2z M3.5 6.5v7h9v-7 M6.5 9.5h3',
};

const ORDNER = 'M2 4.5h4l1.5 2H14v7H2z';

/**
 * Symbole für Gmails Einordnung des Posteingangs. Bewusst andere Formen als bei den
 * Ordnerrollen, weil es keine Ordner sind: die Nachrichten liegen weiterhin im
 * Posteingang und werden nur nach Gmails Einschätzung gefiltert.
 */
const KATEGORIE_PFADE: Record<string, string> = {
  // Preisschild
  promotions: 'M8.5 2H13v4.5l-6.5 6.5-4.5-4.5z M10.8 4.2h.01',
  // Zwei Personen
  social: 'M6 7.5a2 2 0 100-4 2 2 0 000 4z M2.5 13c0-2 1.6-3.2 3.5-3.2S9.5 11 9.5 13 M11 4.2a1.8 1.8 0 010 3.6 M11.5 9.9c1.3.3 2 1.4 2 3.1',
  // Glocke
  updates: 'M8 2.2a3.6 3.6 0 00-3.6 3.6c0 2.8-1 3.7-1 3.7h9.2s-1-.9-1-3.7A3.6 3.6 0 008 2.2z M6.6 12a1.5 1.5 0 002.8 0',
  // Sprechblasen
  forums: 'M2.5 3.5h8v5h-4l-2.5 2v-2h-1.5z M6.5 8.5h1v2h4l2 1.6V6.5h-3',
};

export function FolderIcon({ role }: { role?: string }) {
  const pfad = (role && (PFADE[role] ?? KATEGORIE_PFADE[role])) || ORDNER;
  return (
    <svg
      className="folder-icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={pfad} />
    </svg>
  );
}
