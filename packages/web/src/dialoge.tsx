import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Achtung,
  Fragezeichen,
  Haken,
  Hinweiszeichen,
  Papierkorb,
  Uhr,
  Warnzeichen,
} from './components/Symbole.js';

/**
 * Rückfragen, Eingaben und Meldungen in der Gestaltung des Programms.
 *
 * Ersetzt confirm(), prompt() und alert(). Die haben ihren Dienst getan, aber sie haben
 * drei Nachteile, die sich nicht beheben lassen: sie sehen aus wie ein Browserfenster
 * (samt Adresse "127.0.0.1" in der Titelzeile), sie kennen nur "OK" und "Abbrechen"
 * statt einer Beschriftung, die sagt was passiert, und sie halten den gesamten
 * Programmablauf an - bei laufendem Mailabruf ist das spürbar.
 *
 * Die Aufrufe hier sehen den ersetzten absichtlich ähnlich: es sind gewöhnliche
 * Funktionen, die ein Versprechen zurückgeben, und sie lassen sich von überall her
 * aufrufen - auch aus Bausteinen tief im Baum, ohne dass etwas durchgereicht werden
 * müsste. Möglich ist das, weil <Dialoge /> sich beim Start einmal hier anmeldet.
 */

type Stil = 'frage' | 'warnung' | 'gefahr' | 'hinweis' | 'gut';

interface Grundangaben {
  titel: string;
  /** Zweite Zeile: was das für Folgen hat. Zeilenumbrüche bleiben erhalten. */
  text?: string;
  stil?: Stil;
}

interface BestaetigungAnfrage extends Grundangaben {
  art: 'bestaetigen';
  /** Beschriftung des ausführenden Knopfes - sagt, was geschieht ("Löschen", nicht "OK"). */
  ok?: string;
  abbrechen?: string;
  /**
   * Ein dritter Weg, der etwas wegwirft.
   *
   * Gibt es eine Rückfrage nur mit "tun" und "zurück", sitzt man fest, wenn man weder
   * das eine noch das andere will. Genau so war es beim Verfassen-Fenster: es blieb nur
   * Speichern oder Weiterschreiben, und ein aus Versehen getipptes Zeichen zwang zu
   * einem Entwurf im echten Postfach.
   */
  verwerfen?: string;
}

interface EingabeAnfrage extends Grundangaben {
  art: 'eingabe';
  vorgabe?: string;
  platzhalter?: string;
  ok?: string;
  /** Prüfung vor dem Bestätigen; ein zurückgegebener Text erscheint als Fehler am Feld. */
  pruefe?: (wert: string) => string | null;
  /**
   * Verdeckte Eingabe - für Kennwörter. Ein Kennwort im Klartext auf dem Bildschirm ist
   * kein Kennwort mehr, sobald jemand danebensteht.
   */
  geheim?: boolean;
}

interface MeldungAnfrage extends Grundangaben {
  art: 'meldung';
  ok?: string;
}

interface ZeitpunktAnfrage extends Grundangaben {
  art: 'zeitpunkt';
  vorschlaege: { titel: string; zeit: Date }[];
}

type Anfrage = BestaetigungAnfrage | EingabeAnfrage | MeldungAnfrage | ZeitpunktAnfrage;

interface Offen {
  anfrage: Anfrage;
  aufloesen: (wert: unknown) => void;
}

/**
 * Verbindung zwischen den Aufrufen und dem eingehängten Baustein.
 *
 * Ein Modulwert statt eines Kontexts: die Aufrufe kommen aus Ereignisbehandlungen und
 * aus Funktionen außerhalb von Bausteinen, wo ein Haken (useContext) nicht zur Verfügung
 * steht. Genau ein <Dialoge /> im Baum, deshalb genügt ein einzelner Platz.
 */
let anmelden: ((offen: Offen) => void) | null = null;

function stelle<T>(anfrage: Anfrage): Promise<T> {
  return new Promise<T>((aufloesen) => {
    if (!anmelden) {
      // Kann nur passieren, wenn <Dialoge /> fehlt - dann lieber nichts tun als hängen.
      console.warn('Dialoge sind nicht eingehängt - Anfrage verworfen:', anfrage.titel);
      aufloesen(null as T);
      return;
    }
    anmelden({ anfrage, aufloesen: aufloesen as (wert: unknown) => void });
  });
}

/**
 * Rückfrage. Liefert true, wenn bestätigt wurde.
 *
 * Mit `verwerfen` kommt ein dritter Knopf dazu; dann kann auch `'verwerfen'`
 * herauskommen. Über die zwei Signaturen bekommen alle anderen Aufrufer weiterhin ein
 * schlichtes `boolean` - sonst müssten sie alle auf einen Fall prüfen, den es bei
 * ihnen gar nicht gibt.
 */
export function bestaetige(
  o: Omit<BestaetigungAnfrage, 'art'> & { verwerfen: string },
): Promise<boolean | 'verwerfen'>;
export function bestaetige(o: Omit<BestaetigungAnfrage, 'art'>): Promise<boolean>;
export function bestaetige(
  o: Omit<BestaetigungAnfrage, 'art'>,
): Promise<boolean | 'verwerfen'> {
  return stelle<boolean | 'verwerfen'>({ ...o, art: 'bestaetigen' });
}

/** Einzeilige Eingabe. Liefert den Text oder null bei Abbruch. */
export function frage(o: Omit<EingabeAnfrage, 'art'>): Promise<string | null> {
  return stelle<string | null>({ ...o, art: 'eingabe' });
}

/** Mitteilung mit einem einzigen Knopf. */
export function melde(o: Omit<MeldungAnfrage, 'art'>): Promise<void> {
  return stelle<void>({ ...o, art: 'meldung' });
}

/** Zeitpunktwahl mit Vorschlägen. Liefert das gewählte Datum oder null. */
export function waehleZeitpunkt(o: Omit<ZeitpunktAnfrage, 'art'>): Promise<Date | null> {
  return stelle<Date | null>({ ...o, art: 'zeitpunkt' });
}

/* --- Vorschläge ----------------------------------------------------------
 * "Nachher" ist die eigentliche Antwort, nicht ein Zeitstempel. Deshalb stehen die
 * üblichen Fälle als Knöpfe da; die freie Eingabe darunter ist für den seltenen Rest.
 */

function inStunden(n: number): Date {
  return new Date(Date.now() + n * 3_600_000);
}

function heuteAbend(): Date {
  const d = new Date();
  d.setHours(18, 0, 0, 0);
  // Ist es schon nach sechs, war offensichtlich der morgige Abend gemeint.
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function morgenFrueh(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d;
}

function naechsteWoche(): Date {
  const d = new Date();
  // Bis zum nächsten Montag: getDay() liefert 0 für Sonntag.
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7));
  d.setHours(8, 0, 0, 0);
  return d;
}

/** Vorschläge für "später senden" - dort geht es um Stunden, nicht um Tage. */
export function sendeVorschlaege() {
  return [
    { titel: 'In einer Stunde', zeit: inStunden(1) },
    { titel: 'Heute Abend', zeit: heuteAbend() },
    { titel: 'Morgen früh', zeit: morgenFrueh() },
    { titel: 'Montag früh', zeit: naechsteWoche() },
  ];
}

/** Vorschläge für die Wiedervorlage - dort ist "nächste Woche" ein üblicher Fall. */
export function wiedervorlageVorschlaege() {
  return [
    { titel: 'In drei Stunden', zeit: inStunden(3) },
    { titel: 'Heute Abend', zeit: heuteAbend() },
    { titel: 'Morgen früh', zeit: morgenFrueh() },
    { titel: 'Nächste Woche', zeit: naechsteWoche() },
  ];
}

const WOCHENTAG = new Intl.DateTimeFormat('de-DE', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Für das Feld <input type="datetime-local">, das eine örtliche Zeit ohne Zone erwartet. */
function alsFeldwert(d: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(
    d.getMinutes(),
  )}`;
}

/* --- Darstellung --------------------------------------------------------- */

function Symbol({ anfrage }: { anfrage: Anfrage }) {
  if (anfrage.art === 'zeitpunkt') return <Uhr groesse={19} />;
  switch (anfrage.stil) {
    case 'gefahr':
      return <Papierkorb groesse={19} />;
    case 'warnung':
      return <Warnzeichen groesse={19} />;
    case 'gut':
      return <Haken groesse={19} />;
    case 'hinweis':
      return <Hinweiszeichen groesse={19} />;
    default:
      return anfrage.art === 'meldung' ? <Achtung groesse={19} /> : <Fragezeichen groesse={19} />;
  }
}

/**
 * Der eingehängte Baustein. Gehört genau einmal in den Baum (siehe main.tsx) und zeigt
 * immer die älteste offene Anfrage - kommt während einer Rückfrage eine zweite herein,
 * wartet sie, statt die erste zu verdrängen.
 */
export function Dialoge() {
  const [warteschlange, setWarteschlange] = useState<Offen[]>([]);
  const offen = warteschlange[0] ?? null;

  useEffect(() => {
    anmelden = (neu) => setWarteschlange((bisher) => [...bisher, neu]);
    return () => {
      anmelden = null;
    };
  }, []);

  const schliessen = useCallback(
    (wert: unknown) => {
      setWarteschlange((bisher) => {
        bisher[0]?.aufloesen(wert);
        return bisher.slice(1);
      });
    },
    [],
  );

  if (!offen) return null;
  return <Fenster key={warteschlange.length} anfrage={offen.anfrage} fertig={schliessen} />;
}

function Fenster({ anfrage, fertig }: { anfrage: Anfrage; fertig: (wert: unknown) => void }) {
  const [wert, setWert] = useState(anfrage.art === 'eingabe' ? anfrage.vorgabe ?? '' : '');
  const [eigenerZeitpunkt, setEigenerZeitpunkt] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const feld = useRef<HTMLInputElement>(null);

  /** Was ein Abbruch bedeutet, hängt von der Art ab - der Aufrufer prüft darauf. */
  const abbruch = () =>
    fertig(anfrage.art === 'bestaetigen' ? false : anfrage.art === 'meldung' ? undefined : null);

  useEffect(() => {
    // Bei einer Eingabe den bestehenden Text markieren: wer ihn ersetzen will, tippt
    // einfach los, wer ihn ergänzen will, drückt einmal nach rechts.
    feld.current?.select();

    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        abbruch();
      }
    };
    // In der Erfassungsphase: sonst behandelt das Verfassen-Fenster darunter die Taste
    // zuerst und würde sich selbst schließen, während die Rückfrage noch offen steht.
    window.addEventListener('keydown', taste, true);
    return () => window.removeEventListener('keydown', taste, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bestaetigen = () => {
    if (anfrage.art === 'eingabe') {
      const getrimmt = wert.trim();
      const beanstandung = anfrage.pruefe?.(getrimmt) ?? null;
      if (beanstandung) {
        setFehler(beanstandung);
        return;
      }
      fertig(getrimmt || null);
      return;
    }
    fertig(anfrage.art === 'bestaetigen' ? true : undefined);
  };

  const stil = anfrage.art === 'zeitpunkt' ? 'frage' : anfrage.stil ?? 'frage';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && abbruch()}>
      <div
        className={`modal dialog ${stil}`}
        role="dialog"
        aria-modal="true"
        aria-label={anfrage.titel}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="dialog-kopf">
          <span className="dialog-symbol">
            <Symbol anfrage={anfrage} />
          </span>
          <div>
            <h3 className="dialog-titel">{anfrage.titel}</h3>
            {anfrage.text && <p className="dialog-text">{anfrage.text}</p>}
          </div>
        </div>

        {anfrage.art === 'eingabe' && (
          <div className="dialog-koerper">
            <input
              ref={feld}
              type={anfrage.geheim ? 'password' : 'text'}
              autoFocus
              value={wert}
              placeholder={anfrage.platzhalter}
              onChange={(e) => {
                setWert(e.target.value);
                setFehler(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && bestaetigen()}
            />
            {fehler && (
              <div className="error-banner" style={{ marginTop: 'var(--a-3)', marginBottom: 0 }}>
                {fehler}
              </div>
            )}
          </div>
        )}

        {anfrage.art === 'zeitpunkt' && (
          <div className="dialog-koerper">
            <div className="zeitwahl">
              {anfrage.vorschlaege.map((v) => (
                <button
                  key={v.titel}
                  type="button"
                  className="zeitwahl-knopf"
                  onClick={() => fertig(v.zeit)}
                >
                  <b>{v.titel}</b>
                  <span>{WOCHENTAG.format(v.zeit)}</span>
                </button>
              ))}
            </div>
            <div className="zeitwahl-eigen">
              <span>Oder ein bestimmter Zeitpunkt</span>
              <div style={{ display: 'flex', gap: 'var(--a-3)' }}>
                <input
                  type="datetime-local"
                  value={eigenerZeitpunkt}
                  min={alsFeldwert(new Date())}
                  onChange={(e) => {
                    setEigenerZeitpunkt(e.target.value);
                    setFehler(null);
                  }}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  className="btn secondary"
                  disabled={!eigenerZeitpunkt}
                  onClick={() => {
                    const gewaehlt = new Date(eigenerZeitpunkt);
                    if (Number.isNaN(gewaehlt.getTime())) {
                      setFehler('Das ist kein Zeitpunkt, den ich lesen kann.');
                      return;
                    }
                    if (gewaehlt.getTime() <= Date.now()) {
                      setFehler('Dieser Zeitpunkt liegt in der Vergangenheit.');
                      return;
                    }
                    fertig(gewaehlt);
                  }}
                >
                  Übernehmen
                </button>
              </div>
              {fehler && (
                <div className="error-banner" style={{ marginTop: 'var(--a-3)', marginBottom: 0 }}>
                  {fehler}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="dialog-fuss">
          {anfrage.art !== 'meldung' && (
            <button type="button" className="btn secondary" onClick={abbruch}>
              {anfrage.art === 'bestaetigen' ? anfrage.abbrechen ?? 'Abbrechen' : 'Abbrechen'}
            </button>
          )}
          {anfrage.art === 'bestaetigen' && anfrage.verwerfen && (
            <button type="button" className="btn gefahr-schlicht" onClick={() => fertig('verwerfen')}>
              {anfrage.verwerfen}
            </button>
          )}
          {anfrage.art !== 'zeitpunkt' && (
            <button type="button" className="btn" autoFocus={anfrage.art !== 'eingabe'} onClick={bestaetigen}>
              {anfrage.art === 'bestaetigen'
                ? anfrage.ok ?? 'Ja'
                : anfrage.art === 'eingabe'
                  ? anfrage.ok ?? 'Übernehmen'
                  : anfrage.ok ?? 'Verstanden'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
