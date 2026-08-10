import { useEffect, useState } from 'react';
import { Kreispfeil, Marke, Mond, Sonne } from './Symbole.js';
import type { Ansicht, Themawahl } from '../design/thema.js';

/**
 * Die eigene Titelleiste.
 *
 * Das Fenster ist rahmenlos; was sonst Windows zeichnet, steht hier. Der Gewinn ist nicht
 * die Zeile an sich - es ist der Platz darin. Bei jedem anderen Programm liegt dort eine
 * Beschriftung und sonst nichts; hier steht in der Mitte, in welchem Konto und in welchem
 * Ordner man sich befindet. Das war vorher an drei Stellen verstreut abzulesen (farbiger
 * Balken links, Überschrift der Liste, Kennzeichen in der Seitenleiste) und ist die
 * häufigste Frage überhaupt, wenn mehrere Postfächer offen sind.
 *
 * Die drei Fensterknöpfe rechts zeichnet Chromium selbst in die Leiste hinein - mit den
 * Farben, die main.ts ihm nennt, aber mit dem Verhalten von Windows (unter anderem den
 * Ausrichtungshilfen von Windows 11). Freigehalten wird der Platz über die CSS-Größe
 * env(titlebar-area-width); im Browser betrieben ist sie nicht gesetzt und die Leiste
 * geht durch bis zum Rand.
 */

interface Props {
  kontoName: string | null;
  kontoFarbe: string;
  ordnerName: string | null;
  wahl: Themawahl;
  ansicht: Ansicht;
  onThemaUmschalten: () => void;
  /** Text auf dem Aktualisierungsknopf; null blendet ihn auf sein stilles Zeichen zurück. */
  aktualisierung: { text: string; meldet: boolean } | null;
  onAktualisierung: () => void;
}

export function Titelleiste({
  kontoName,
  kontoFarbe,
  ordnerName,
  wahl,
  ansicht,
  onThemaUmschalten,
  aktualisierung,
  onAktualisierung,
}: Props) {
  const bruecke = window.energyMail;
  const [zustand, setZustand] = useState({ maximiert: false, imVordergrund: true });

  useEffect(() => {
    if (!bruecke) return;
    void bruecke.fensterzustand().then(setZustand);
    return bruecke.aufFensterzustand(setZustand);
  }, [bruecke]);

  const themaTitel =
    wahl === 'system'
      ? `Ansicht folgt Windows (gerade ${ansicht}) – klicken, um sie festzulegen`
      : `Ansicht: ${wahl} – klicken zum Umschalten`;

  return (
    <header
      className={`titelleiste${zustand.imVordergrund ? '' : ' abwesend'}`}
      style={{ ['--konto-farbe' as string]: kontoFarbe }}
    >
      <div className="titelleiste-marke">
        <Marke groesse={19} className="marke-symbol" />
        {/*
          Die einzige Ueberschrift erster Ordnung - eine Vorlesesoftware nennt sie, wenn
          man fragt, wo man ueberhaupt ist.

          "Mail" steht in einem eigenen Element, weil es blasser gesetzt wird als
          "Energy": der Name traegt das Wortzeichen, die Gattung sagt nur, was es ist.
          Vorgelesen bleibt es ein Satz - ein span aendert daran nichts.
        */}
        <h1 className="marke-wort">
          Energy <span>Mail</span>
        </h1>
      </div>

      <div className="titelleiste-mitte">
        {kontoName && (
          <>
            <span className="konto-punkt" />
            <b>{kontoName}</b>
          </>
        )}
        {kontoName && ordnerName && <span>·</span>}
        {ordnerName && <span>{ordnerName}</span>}
      </div>

      <div className="titelleiste-werkzeuge">
        <button
          className={`leisten-btn${aktualisierung?.meldet ? ' meldet' : ''}`}
          onClick={onAktualisierung}
          title={aktualisierung?.text ?? 'Nach Aktualisierungen suchen'}
        >
          <Kreispfeil groesse={14} />
          {aktualisierung && <span>{aktualisierung.text}</span>}
        </button>
        <button className="leisten-btn" onClick={onThemaUmschalten} title={themaTitel}>
          {ansicht === 'dunkel' ? <Mond groesse={14} /> : <Sonne groesse={14} />}
        </button>
      </div>
    </header>
  );
}
