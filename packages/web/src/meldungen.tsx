import { useEffect, useRef, useState } from 'react';
import { Achtung, Haken, Hinweiszeichen, Warnzeichen } from './components/Symbole.js';

/**
 * Kurze Rückmeldungen am oberen Rand.
 *
 * Vorher gab es genau eine Art davon: einen roten Kasten, der bis zum Wegklicken stehen
 * blieb. Das hatte zur Folge, dass alles, was gemeldet werden sollte, wie ein Fehler
 * aussah - auch "Nachricht wurde versendet, konnte aber nicht abgelegt werden", wo die
 * Hauptsache ja geklappt hat. Und es hatte zur Folge, dass Gelungenes gar nicht gemeldet
 * wurde, weil es dafür keine passende Form gab.
 *
 * Vier Stufen, und die Verweildauer richtet sich danach: Erfreuliches geht von selbst
 * wieder, Fehler bleiben stehen. Der ablaufende Streifen am unteren Rand kündigt das
 * Verschwinden an - ohne ihn wirkt es, als hätte man etwas verpasst.
 */

export type Stufe = 'fehler' | 'warnung' | 'gut' | 'hinweis';

interface Meldung {
  id: number;
  stufe: Stufe;
  titel: string;
  text?: string;
  /** Millisekunden bis zum selbsttätigen Verschwinden; 0 heißt: bleibt stehen. */
  dauer: number;
  /**
   * Ein Weg zurück, solange die Meldung steht.
   *
   * Löschen geschah bisher stumm: ein Tastendruck, die Nachricht war im Papierkorb, und
   * nichts wies darauf hin. Beim Senden gibt es acht Sekunden Bedenkzeit - beim Löschen
   * gab es nichts.
   */
  zurueck?: { text: string; tu: () => void };
}

/** Wie lange eine Meldung steht. Fehler gar nicht - sie wollen gelesen werden. */
const DAUER: Record<Stufe, number> = {
  gut: 4000,
  hinweis: 5500,
  warnung: 9000,
  fehler: 0,
};

/** Mehr als das passt nicht übereinander, ohne die Liste darunter zu verdecken. */
const HOECHSTENS = 4;

let anmelden: ((m: Meldung) => void) | null = null;
let naechsteId = 1;

function zeige(
  stufe: Stufe,
  titel: string,
  text?: string,
  dauer = DAUER[stufe],
  zurueck?: Meldung['zurueck'],
): void {
  if (!anmelden) {
    console.warn(`Meldungen nicht eingehängt: ${titel}`);
    return;
  }
  anmelden({ id: naechsteId++, stufe, titel, text, dauer, zurueck });
}

export const meldeFehler = (titel: string, text?: string) => zeige('fehler', titel, text);
export const meldeWarnung = (titel: string, text?: string) => zeige('warnung', titel, text);
export const meldeErfolg = (titel: string, text?: string) => zeige('gut', titel, text);
export const meldeHinweis = (titel: string, text?: string) => zeige('hinweis', titel, text);

/**
 * Eine Meldung mit einem Weg zurück.
 *
 * Für alles, was der Nutzer aus Versehen ausgelöst haben könnte und was sich rückgängig
 * machen lässt. Sie steht länger als eine gewöhnliche Erfolgsmeldung - man muss den
 * Knopf ja noch treffen.
 */
export const meldeMitRueckweg = (titel: string, text: string | undefined, zurueck: { text: string; tu: () => void }) =>
  zeige('gut', titel, text, 9000, zurueck);

const ZEICHEN: Record<Stufe, () => JSX.Element> = {
  fehler: () => <Achtung groesse={18} />,
  warnung: () => <Warnzeichen groesse={18} />,
  gut: () => <Haken groesse={18} />,
  hinweis: () => <Hinweiszeichen groesse={18} />,
};

/** Gehört genau einmal in den Baum (siehe main.tsx). */
export function Meldungen() {
  const [liste, setListe] = useState<Meldung[]>([]);

  useEffect(() => {
    anmelden = (neu) =>
      setListe((bisher) => {
        // Wortgleiches nicht doppelt: bei einem wiederholt scheiternden Abruf kämen sonst
        // im Sekundentakt dieselben Kästen übereinander.
        const ohneDoppel = bisher.filter((m) => !(m.titel === neu.titel && m.text === neu.text));
        return [...ohneDoppel, neu].slice(-HOECHSTENS);
      });
    return () => {
      anmelden = null;
    };
  }, []);

  const entfernen = (id: number) => setListe((bisher) => bisher.filter((m) => m.id !== id));

  /*
   * Der Behälter bleibt stehen, auch wenn nichts darin steht.
   *
   * Eine Vorlesesoftware liest einen Bereich nur dann vor, wenn er schon da war und
   * sich sein Inhalt ändert. Wurde er zusammen mit der Meldung eingehängt, blieb die
   * Meldung stumm - sichtbar war sie, hörbar nicht.
   */
  return (
    <div className="meldungen" role="status" aria-live="polite">
      {liste.map((m) => (
        <Kasten key={m.id} meldung={m} weg={() => entfernen(m.id)} />
      ))}
    </div>
  );
}

function Kasten({ meldung, weg }: { meldung: Meldung; weg: () => void }) {
  const [geht, setGeht] = useState(false);
  const zeitgeber = useRef<ReturnType<typeof setTimeout>>();

  /**
   * Erst ausblenden, dann entfernen - sonst verschwindet der Kasten schlagartig und
   * die darunterliegenden springen nach oben.
   */
  const schliessen = () => {
    setGeht(true);
    setTimeout(weg, 140);
  };

  useEffect(() => {
    if (meldung.dauer === 0) return;
    zeitgeber.current = setTimeout(schliessen, meldung.dauer);
    return () => clearTimeout(zeitgeber.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meldung.dauer]);

  /** Solange der Zeiger darauf liegt, läuft die Zeit nicht weiter - man liest ja gerade. */
  const anhalten = () => clearTimeout(zeitgeber.current);
  const weiter = () => {
    if (meldung.dauer > 0) zeitgeber.current = setTimeout(schliessen, 2000);
  };

  const Zeichen = ZEICHEN[meldung.stufe];
  return (
    <div
      className={`meldung ${meldung.stufe}${geht ? ' geht' : ''}`}
      role={meldung.stufe === 'fehler' ? 'alert' : 'status'}
      onMouseEnter={anhalten}
      onMouseLeave={weiter}
    >
      <span className="meldung-symbol">
        <Zeichen />
      </span>
      <div className="meldung-text">
        <div className="meldung-titel">{meldung.titel}</div>
        {meldung.text && <p>{meldung.text}</p>}
      </div>
      {meldung.zurueck && (
        <button
          className="meldung-zurueck"
          onClick={() => {
            meldung.zurueck!.tu();
            schliessen();
          }}
        >
          {meldung.zurueck.text}
        </button>
      )}
      <button className="icon-btn" onClick={schliessen} title="Schließen" aria-label="Schließen">
        ×
      </button>
      {meldung.dauer > 0 && (
        <span
          className="meldung-zeit"
          style={{ animationDuration: `${meldung.dauer}ms` }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
