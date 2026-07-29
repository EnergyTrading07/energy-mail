import { useEffect, useRef } from 'react';
import { frage } from '../dialoge.js';

interface Props {
  html: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}

interface ToolbarButton {
  befehl: string;
  wert?: string;
  titel: string;
  inhalt: React.ReactNode;
}

const BUTTONS: ToolbarButton[] = [
  { befehl: 'bold', titel: 'Fett (Strg+B)', inhalt: <strong>F</strong> },
  { befehl: 'italic', titel: 'Kursiv (Strg+I)', inhalt: <em>K</em> },
  { befehl: 'underline', titel: 'Unterstrichen (Strg+U)', inhalt: <u>U</u> },
  { befehl: 'insertUnorderedList', titel: 'Aufzählung', inhalt: '• Liste' },
  { befehl: 'insertOrderedList', titel: 'Nummerierung', inhalt: '1. Liste' },
  { befehl: 'removeFormat', titel: 'Formatierung entfernen', inhalt: 'Ａ̶' },
];

/**
 * Schlanker Editor auf Basis von contentEditable.
 *
 * Genutzt wird document.execCommand: die Schnittstelle gilt als veraltet, ist aber in
 * Chromium (und damit in Electron) durchgehend verfügbar und spart eine umfangreiche
 * Fremdbibliothek. Sollte sie einmal wegfallen, betrifft das nur diese Datei.
 */
export function RichTextEditor({ html, onChange, disabled }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Nur von außen setzen, wenn sich der Inhalt wirklich unterscheidet - sonst springt
  // bei jedem Tastendruck der Cursor an den Anfang.
  useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== html) {
      node.innerHTML = html;
    }
  }, [html]);

  const fuehreAus = (befehl: string, wert?: string) => {
    ref.current?.focus();
    document.execCommand(befehl, false, wert);
    if (ref.current) onChange(ref.current.innerHTML);
  };

  /**
   * Die Auswahl im Editor geht verloren, sobald das Fenster den Fokus übernimmt - sie
   * wird deshalb vorher festgehalten und danach wiederhergestellt. Bei prompt() erledigte
   * das der Browser; ein gewöhnliches Fenster im Baum tut es nicht.
   */
  const linkEinfuegen = () => {
    const bereich = window.getSelection()?.rangeCount
      ? window.getSelection()!.getRangeAt(0).cloneRange()
      : null;

    void frage({
      titel: 'Link einfügen',
      text: 'Der markierte Text wird damit verknüpft.',
      vorgabe: 'https://',
      ok: 'Einfügen',
      pruefe: (ziel) =>
        /^(https?|mailto):/i.test(ziel)
          ? null
          : 'Die Adresse muss mit http://, https:// oder mailto: beginnen.',
    }).then((ziel) => {
      if (!ziel) return;
      if (bereich) {
        const auswahl = window.getSelection();
        auswahl?.removeAllRanges();
        auswahl?.addRange(bereich);
      }
      fuehreAus('createLink', ziel);
    });
  };

  return (
    <div className="editor">
      <div className="editor-toolbar">
        {BUTTONS.map((b) => (
          <button
            key={b.befehl}
            type="button"
            title={b.titel}
            disabled={disabled}
            // Verhindert, dass der Editor beim Klick den Fokus und damit die Auswahl verliert.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => fuehreAus(b.befehl, b.wert)}
          >
            {b.inhalt}
          </button>
        ))}
        <button
          type="button"
          title="Link einfügen"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={linkEinfuegen}
        >
          🔗
        </button>
      </div>
      <div
        ref={ref}
        className="editor-body"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        // Beim Einfügen aus anderen Programmen nur den Text übernehmen; fremdes HTML
        // brächte Schriftarten, Farben und teils ganze Layouts mit.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData('text/plain');
          document.execCommand('insertText', false, text);
        }}
      />
    </div>
  );
}
