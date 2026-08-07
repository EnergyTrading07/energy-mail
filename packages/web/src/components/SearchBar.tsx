import { useEffect, useState } from 'react';
import type { Etikett } from '@energy-mail/mail-core';

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
  /** Das IMAP-Schluesselwort eines Etiketts, nicht dessen angezeigter Name. */
  etikett: string;
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
  etikett: '',
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
      e.withAttachment ||
      e.etikett,
  );
}

interface Props {
  searchActive: boolean;
  /** Ob der Anbieter nach Anhängen suchen kann - nur Gmail beherrscht das. */
  anhangSuchbar: boolean;
  mehrereKonten: boolean;
  /** Verzeichnis der Etiketten - fuer die Auswahl unter den Einschraenkungen. */
  etiketten: Etikett[];
  /**
   * Von aussen vorgegebene Eingabe - etwa aus einer gespeicherten Suche. Aendert sie
   * sich, uebernimmt die Leiste sie und klappt auf, damit sichtbar ist, wonach gesucht
   * wird.
   */
  vorgabe?: SucheEingabe | null;
  /** Bietet an, die laufende Suche zu speichern. */
  onSpeichern?: (eingabe: SucheEingabe) => void;
  onSearch: (eingabe: SucheEingabe) => void;
  onClear: () => void;
}

export function SearchBar({
  searchActive,
  anhangSuchbar,
  mehrereKonten,
  etiketten,
  vorgabe,
  onSpeichern,
  onSearch,
  onClear,
}: Props) {
  const [eingabe, setEingabe] = useState<SucheEingabe>(LEERE_SUCHE);
  const [offen, setOffen] = useState(false);

  // Eine gespeicherte Suche traegt ihre Bedingungen in die Leiste ein - sonst stuende
  // dort weiter die vorige und man wuesste nicht, wonach die Liste gefiltert ist.
  useEffect(() => {
    if (!vorgabe) return;
    setEingabe(vorgabe);
    setOffen(true);
  }, [vorgabe]);

  const setze = <K extends keyof SucheEingabe>(feld: K, wert: SucheEingabe[K]) =>
    setEingabe((vorher) => ({ ...vorher, [feld]: wert }));

  // Eingeklappt bleiben die Zusatzfelder nur, wenn keines von ihnen gefüllt ist.
  const zusatzGefuellt = Boolean(
    eingabe.from || eingabe.subject || eingabe.since || eingabe.before ||
      eingabe.unreadOnly || eingabe.withAttachment || eingabe.etikett,
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
          <label className="such-etikett">
            <span>Etikett</span>
            <select value={eingabe.etikett} onChange={(e) => setze('etikett', e.target.value)}>
              <option value="">alle</option>
              {etiketten.map((etikett) => (
                <option key={etikett.schluessel} value={etikett.schluessel}>
                  {etikett.name}
                </option>
              ))}
            </select>
          </label>
          <div className="such-knoepfe">
            <button type="submit" className="btn" disabled={!hatEinschraenkung(eingabe)}>
              Suchen
            </button>
            {onSpeichern && (
              <button
                type="button"
                className="link-btn"
                disabled={!hatEinschraenkung(eingabe)}
                onClick={() => onSpeichern(eingabe)}
                title="Diese Suche in der Seitenleiste ablegen"
              >
                Suche merken
              </button>
            )}
          </div>
        </div>
      )}
    </form>
  );
}
