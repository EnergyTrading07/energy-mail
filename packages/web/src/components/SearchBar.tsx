import { useState } from 'react';

/**
 * Sucheingabe mit ausklappbaren Einschränkungen.
 *
 * Eingeklappt bleibt es die gewohnte einzelne Zeile - das ist der überwiegende Fall. Wer
 * mehr braucht, klappt auf; die Felder verschwinden nicht wieder, solange sie gefüllt
 * sind, sonst sucht man nach einer Einschränkung, die man nicht mehr sieht.
 */

export type Suchbereich = 'ordner' | 'konto' | 'alle';

export interface SucheEingabe {
  text: string;
  from: string;
  subject: string;
  since: string;
  before: string;
  unreadOnly: boolean;
  withAttachment: boolean;
  bereich: Suchbereich;
}

export const LEERE_SUCHE: SucheEingabe = {
  text: '',
  from: '',
  subject: '',
  since: '',
  before: '',
  unreadOnly: false,
  withAttachment: false,
  bereich: 'ordner',
};

/** Ob überhaupt etwas gesucht wird - eine leere Suche würde alles zurückgeben. */
export function hatEinschraenkung(e: SucheEingabe): boolean {
  return Boolean(
    e.text.trim() ||
      e.from.trim() ||
      e.subject.trim() ||
      e.since ||
      e.before ||
      e.unreadOnly ||
      e.withAttachment,
  );
}

interface Props {
  searchActive: boolean;
  /** Ob der Anbieter nach Anhängen suchen kann - nur Gmail beherrscht das. */
  anhangSuchbar: boolean;
  mehrereKonten: boolean;
  onSearch: (eingabe: SucheEingabe) => void;
  onClear: () => void;
}

export function SearchBar({ searchActive, anhangSuchbar, mehrereKonten, onSearch, onClear }: Props) {
  const [eingabe, setEingabe] = useState<SucheEingabe>(LEERE_SUCHE);
  const [offen, setOffen] = useState(false);

  const setze = <K extends keyof SucheEingabe>(feld: K, wert: SucheEingabe[K]) =>
    setEingabe((vorher) => ({ ...vorher, [feld]: wert }));

  // Eingeklappt bleiben die Zusatzfelder nur, wenn keines von ihnen gefüllt ist.
  const zusatzGefuellt = Boolean(
    eingabe.from || eingabe.subject || eingabe.since || eingabe.before ||
      eingabe.unreadOnly || eingabe.withAttachment,
  );
  const zeigeFelder = offen || zusatzGefuellt;

  const absenden = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (hatEinschraenkung(eingabe)) onSearch(eingabe);
  };

  return (
    <form className="search-bar" onSubmit={absenden}>
      <input
        type="search"
        placeholder="Suchen…"
        value={eingabe.text}
        onChange={(e) => setze('text', e.target.value)}
      />

      <div className="search-options">
        <select
          className="such-bereich"
          value={eingabe.bereich}
          onChange={(e) => {
            const bereich = e.target.value as Suchbereich;
            setEingabe((v) => ({ ...v, bereich }));
            if (hatEinschraenkung(eingabe)) onSearch({ ...eingabe, bereich });
          }}
          title="Wo gesucht wird"
        >
          <option value="ordner">Dieser Ordner</option>
          <option value="konto">Alle Ordner</option>
          {mehrereKonten && <option value="alle">Alle Konten</option>}
        </select>

        <button type="button" className="link-btn" onClick={() => setOffen((v) => !v)}>
          {zeigeFelder ? 'Weniger' : 'Mehr…'}
        </button>

        {searchActive && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setEingabe(LEERE_SUCHE);
              setOffen(false);
              onClear();
            }}
          >
            Suche aufheben
          </button>
        )}
      </div>

      {zeigeFelder && (
        <div className="such-felder">
          <label>
            <span>Von</span>
            <input
              type="text"
              placeholder="Absender"
              value={eingabe.from}
              onChange={(e) => setze('from', e.target.value)}
            />
          </label>
          <label>
            <span>Betreff</span>
            <input
              type="text"
              placeholder="enthält…"
              value={eingabe.subject}
              onChange={(e) => setze('subject', e.target.value)}
            />
          </label>
          <div className="such-zeitraum">
            <label>
              <span>Von</span>
              <input
                type="date"
                value={eingabe.since}
                onChange={(e) => setze('since', e.target.value)}
              />
            </label>
            <label>
              <span>bis</span>
              <input
                type="date"
                value={eingabe.before}
                onChange={(e) => setze('before', e.target.value)}
              />
            </label>
          </div>
          <div className="such-schalter">
            <label>
              <input
                type="checkbox"
                checked={eingabe.unreadOnly}
                onChange={(e) => setze('unreadOnly', e.target.checked)}
              />
              nur ungelesen
            </label>
            <label
              title={
                anhangSuchbar
                  ? undefined
                  : 'Dieser Anbieter kann nicht nach Anhängen suchen - IMAP kennt dafür kein Kriterium.'
              }
            >
              <input
                type="checkbox"
                disabled={!anhangSuchbar}
                checked={eingabe.withAttachment}
                onChange={(e) => setze('withAttachment', e.target.checked)}
              />
              nur mit Anhang
            </label>
          </div>
          <button type="submit" className="btn" disabled={!hatEinschraenkung(eingabe)}>
            Suchen
          </button>
        </div>
      )}
    </form>
  );
}
