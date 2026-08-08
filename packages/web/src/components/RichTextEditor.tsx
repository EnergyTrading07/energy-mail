import { useCallback, useEffect, useRef, useState } from 'react';
import { frage } from '../dialoge.js';
import {
  TEXTFARBEN,
  WERKZEUGE,
  befehlFuerTaste,
  normalisiereAdresse,
  raeumeEingefuegtesAuf,
} from '../formatierung.js';

interface Props {
  html: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  /**
   * Wie das Feld heißt. Ein <label> daneben hilft hier nichts - es gibt kein <input>,
   * auf das es zeigen könnte.
   */
  beschriftung?: string;
}

/**
 * Schlanker Editor auf Basis von contentEditable.
 *
 * Genutzt wird document.execCommand: die Schnittstelle gilt als veraltet, ist aber in
 * Chromium (und damit in Electron) durchgehend verfügbar und spart eine umfangreiche
 * Fremdbibliothek. Sollte sie einmal wegfallen, betrifft das nur diese Datei.
 *
 * Was die Leiste kann und was beim Einfügen übrig bleibt, steht in formatierung.ts -
 * beides für sich geprüft, weil das eine eine Tabelle und das andere eine
 * Sicherheitsfrage ist.
 */
export function RichTextEditor({ html, onChange, disabled, beschriftung = 'Nachrichtentext' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  /** Welche Auszeichnungen an der Schreibmarke gerade gelten - für die Knöpfe. */
  const [aktiv, setAktiv] = useState<Set<string>>(new Set());

  // Nur von außen setzen, wenn sich der Inhalt wirklich unterscheidet - sonst springt
  // bei jedem Tastendruck der Cursor an den Anfang.
  useEffect(() => {
    const node = ref.current;
    if (node && node.innerHTML !== html) {
      node.innerHTML = html;
    }
  }, [html]);

  /**
   * Fragt beim Browser ab, was gerade gilt.
   *
   * Ohne diese Anzeige sieht man einem Knopf nicht an, ob er greift - man tippt weiter
   * und merkt erst am Ergebnis, dass alles fett ist.
   */
  const standAblesen = useCallback(() => {
    const gesetzt = new Set<string>();
    for (const w of WERKZEUGE.flat()) {
      if (!w.zeigtZustand) continue;
      try {
        if (document.queryCommandState(w.befehl)) gesetzt.add(w.befehl);
      } catch {
        // Manche Befehle kennt der Browser nicht - dann gibt es eben nichts anzuzeigen.
      }
    }
    setAktiv(gesetzt);
  }, []);

  // Die Schreibmarke bewegt sich auch ohne Eingabe - deshalb auf die Auswahl horchen,
  // aber nur, solange dieser Editor den Fokus hat.
  useEffect(() => {
    const beiAuswahl = () => {
      if (ref.current?.contains(document.getSelection()?.anchorNode ?? null)) standAblesen();
    };
    document.addEventListener('selectionchange', beiAuswahl);
    return () => document.removeEventListener('selectionchange', beiAuswahl);
  }, [standAblesen]);

  const fuehreAus = (befehl: string, wert?: string) => {
    ref.current?.focus();
    document.execCommand(befehl, false, wert);
    if (ref.current) onChange(ref.current.innerHTML);
    standAblesen();
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
    const markiert = bereich?.toString().trim() ?? '';

    void frage({
      titel: 'Link einfügen',
      text: markiert
        ? `„${markiert.slice(0, 60)}“ wird damit verknüpft.`
        : 'Die Adresse wird als Verweis eingefügt.',
      // Eine markierte Adresse gleich vorschlagen - dann muss man sie nicht abtippen.
      vorgabe: /^(https?:|www\.|[^\s@]+@)/i.test(markiert) ? markiert : '',
      platzhalter: 'firma.de oder https://firma.de',
      ok: 'Einfügen',
      pruefe: (ziel) =>
        normalisiereAdresse(ziel) ? null : 'Bitte eine Adresse angeben.',
    }).then((eingabe) => {
      if (!eingabe) return;
      // "firma.de" meint die Webseite, nicht eine Datei dieses Namens.
      const ziel = normalisiereAdresse(eingabe);

      if (bereich) {
        const auswahl = window.getSelection();
        auswahl?.removeAllRanges();
        auswahl?.addRange(bereich);
      }
      // Ohne markierten Text gäbe createLink einen leeren Verweis - dann erst die
      // Adresse als Text einsetzen und diese verknüpfen.
      if (!markiert) {
        ref.current?.focus();
        document.execCommand('insertText', false, eingabe.trim());
        const knoten = window.getSelection()?.anchorNode;
        const bis = window.getSelection()?.anchorOffset ?? 0;
        if (knoten) {
          const neu = document.createRange();
          neu.setStart(knoten, Math.max(0, bis - eingabe.trim().length));
          neu.setEnd(knoten, bis);
          const auswahl = window.getSelection();
          auswahl?.removeAllRanges();
          auswahl?.addRange(neu);
        }
      }
      fuehreAus('createLink', ziel);
    });
  };

  return (
    <div className="editor">
      <div className="editor-toolbar" role="toolbar" aria-label={`Formatierung: ${beschriftung}`}>
        {WERKZEUGE.map((gruppe, i) => (
          <div className="werkzeug-gruppe" key={i}>
            {gruppe.map((w) => (
              <button
                key={`${w.befehl}:${w.wert ?? ''}`}
                type="button"
                title={w.titel}
                aria-label={w.titel}
                aria-pressed={w.zeigtZustand ? aktiv.has(w.befehl) : undefined}
                className={w.zeigtZustand && aktiv.has(w.befehl) ? 'an' : undefined}
                disabled={disabled}
                // Verhindert, dass der Editor beim Klick den Fokus und damit die
                // Auswahl verliert.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => fuehreAus(w.befehl, w.wert)}
              >
                {w.aufschrift}
              </button>
            ))}
          </div>
        ))}

        <div className="werkzeug-gruppe">
          <button
            type="button"
            title="Link einfügen"
            aria-label="Link einfügen"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={linkEinfuegen}
          >
            🔗
          </button>
          {TEXTFARBEN.map((farbe) => (
            <button
              key={farbe.wert}
              type="button"
              className="farbknopf"
              title={`Textfarbe ${farbe.name}`}
              aria-label={`Textfarbe ${farbe.name}`}
              disabled={disabled}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => fuehreAus('foreColor', farbe.wert)}
            >
              {/*
                Ein gefüllter Kreis mit Ring statt eines eingefärbten Zeichens: die
                Farbe ist die des Empfängers und liegt deshalb fest - Schwarz ging
                im dunklen Erscheinungsbild sonst im Grund unter.
              */}
              <span className="farbtupfen" style={{ background: farbe.wert }} />
            </button>
          ))}
        </div>
      </div>

      <div
        ref={ref}
        className="editor-body"
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label={beschriftung}
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onKeyUp={standAblesen}
        onFocus={standAblesen}
        onKeyDown={(e) => {
          const befehl = befehlFuerTaste(e);
          if (!befehl) return;
          e.preventDefault();
          fuehreAus(befehl.befehl, befehl.wert);
        }}
        /**
         * Beim Einfügen bleibt die Auszeichnung erhalten, die Gestaltung nicht.
         *
         * Vorher wurde alles zu nacktem Text - wer einen Absatz aus einem
         * Schreibprogramm herüberholte, verlor Fettdruck, Listen und Verweise. Alles zu
         * übernehmen wäre aber genauso falsch: fremdes HTML bringt Schriftarten,
         * Farben und ganze Tabellenlayouts mit, und Skripte obendrein.
         */
        onPaste={(e) => {
          e.preventDefault();
          const fremd = e.clipboardData.getData('text/html');
          if (!fremd) {
            document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
            if (ref.current) onChange(ref.current.innerHTML);
            return;
          }

          const behaelter = document.createElement('div');
          behaelter.innerHTML = fremd;
          raeumeEingefuegtesAuf(behaelter, document);
          document.execCommand('insertHTML', false, behaelter.innerHTML);
          if (ref.current) onChange(ref.current.innerHTML);
        }}
      />
    </div>
  );
}
