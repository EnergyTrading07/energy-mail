import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { Sprachwahl, Zugangsmarke } from './Zugangsteile.js';
import { t, tp } from '../sprache.js';

/**
 * Ein vergessenes Kennwort - beide Hälften des Weges.
 *
 * `KennwortVergessen` fordert an, `KennwortNeu` löst den Link aus der Mail ein. Sie
 * stehen in einer Datei, weil sie zusammen einen Vorgang ergeben und niemand die eine
 * ohne die andere lesen sollte: Die zweite ist der Grund, warum die erste so wortkarg
 * antwortet.
 */

/**
 * Schritt eins: die Adresse.
 *
 * Die Antwort ist immer dieselbe - „wenn es dieses Konto gibt, ist eine Nachricht
 * unterwegs". Nicht aus Unfreundlichkeit: Ein Formular, das „diese Adresse kennen wir
 * nicht" sagt, ist ein Werkzeug, mit dem sich durchprobieren lässt, wer an diesem Dienst
 * ein Konto hat. Wer die Adresse besitzt, erfährt den Unterschied per Mail - dort steht
 * auch „hier gibt es kein Konto", wenn es so ist.
 */
export function KennwortVergessen({ onZurueck }: { onZurueck: () => void }) {
  const [email, setEmail] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const [gesendet, setGesendet] = useState(false);
  const ersteEingabe = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ersteEingabe.current?.focus();
  }, []);

  const abschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;
    setFehler('');
    setLaeuft(true);
    try {
      await api.kennwortVergessen(email);
      setGesendet(true);
    } catch (err) {
      setFehler((err as Error).message);
      setLaeuft(false);
    }
  };

  if (gesendet) {
    return (
      <div className="anmeldung">
        <div className="anmeldung-karte">
          <Zugangsmarke />
          <h2 className="registrierung-fertig">{t('Sehen Sie in Ihr Postfach')}</h2>
          <p className="anmeldung-hinweis">
            {t('Besteht zu dieser Adresse ein Zugang, ist eine Nachricht unterwegs. Der Link darin gilt eine Stunde.')}
          </p>
          <p className="anmeldung-fussnote">
            {t('Kommt nichts an, sehen Sie im Spam-Ordner nach oder wenden Sie sich an den Betreiber.')}
          </p>
          <button type="button" className="btn anmeldung-knopf" onClick={onZurueck}>
            {t('Zur Anmeldung')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="anmeldung">
      <form className="anmeldung-karte" onSubmit={abschicken}>
        <Zugangsmarke />

        <h2 className="registrierung-fertig">{t('Kennwort vergessen')}</h2>
        <p className="anmeldung-hinweis">
          {t('Geben Sie Ihre Adresse ein. Sie bekommen einen Link, mit dem Sie ein neues Kennwort vergeben.')}
        </p>

        <label htmlFor="kennwort-email">{t('Adresse')}</label>
        <input
          id="kennwort-email"
          ref={ersteEingabe}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={laeuft}
        />

        {fehler && (
          <p className="anmeldung-fehler" role="alert">
            {fehler}
          </p>
        )}

        <button type="submit" className="btn anmeldung-knopf" disabled={laeuft}>
          {laeuft ? t('Wird gesendet…') : t('Link anfordern')}
        </button>

        <p className="anmeldung-fussnote">
          {t('Ein zweiter Faktor bleibt davon unberührt. Ist Ihr Telefon abhandengekommen, hilft nur der Betreiber.')}
        </p>

        <button type="button" className="link-btn anmeldung-zurueck" onClick={onZurueck}>
          {t('Zurück zur Anmeldung')}
        </button>

        <Sprachwahl />
      </form>
    </div>
  );
}

/**
 * Schritt zwei: das neue Kennwort - mit der Marke aus der Mail.
 *
 * Angemeldet wird hier ausdrücklich nicht. Der Link liegt in einem Postfach, und wer
 * darauf Zugriff hat, ist nicht zwangsläufig der Kontoinhaber; am Ende steht deshalb das
 * Anmeldefenster. Dieselbe Überlegung wie bei der Bestätigung einer Registrierung.
 */
export function KennwortNeu({ marke, onFertig }: { marke: string; onFertig: () => void }) {
  const [kennwort, setKennwort] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const [fertig, setFertig] = useState<{ zweiFaktor: boolean } | null>(null);
  const [mindestens, setMindestens] = useState(10);
  const ersteEingabe = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ersteEingabe.current?.focus();
  }, []);

  /*
   * Die geforderte Länge kommt vom Server und steht nicht hier.
   *
   * Sonst verlangt das Formular zehn Zeichen, der Server aber zwölf - und der Mensch sitzt
   * vor einer Fehlermeldung, die er nicht abstellen kann. Schlägt der Abruf fehl, bleibt es
   * bei der Vorgabe: eine Zahl im Hinweistext ist kein Grund, das Formular nicht zu zeigen.
   */
  useEffect(() => {
    let abgebrochen = false;
    api
      .registrierungslage()
      .then((lage) => {
        if (!abgebrochen && lage.kennwortMindestlaenge) setMindestens(lage.kennwortMindestlaenge);
      })
      .catch(() => undefined);
    return () => {
      abgebrochen = true;
    };
  }, []);

  const zuKurz = kennwort.length > 0 && kennwort.length < mindestens;
  const ungleich = wiederholung.length > 0 && kennwort !== wiederholung;

  const abschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;
    if (kennwort !== wiederholung) {
      setFehler(t('Die beiden Kennwörter stimmen nicht überein.'));
      return;
    }
    setFehler('');
    setLaeuft(true);
    try {
      const befund = await api.kennwortNeu(marke, kennwort);
      // Das Kennwort wird nicht mehr gebraucht - und was ohne Grund im Zustand eines
      // Fensters steht, steht auch in jedem Fehlerbericht dieses Fensters.
      setKennwort('');
      setWiederholung('');
      setFertig({ zweiFaktor: befund.zweiFaktor });
    } catch (err) {
      setFehler((err as Error).message);
      setLaeuft(false);
    }
  };

  if (fertig) {
    return (
      <div className="anmeldung">
        <div className="anmeldung-karte">
          <Zugangsmarke />
          <h2 className="registrierung-fertig">{t('Das Kennwort steht')}</h2>
          <p className="anmeldung-hinweis">
            {t('Melden Sie sich jetzt mit Ihrer Adresse und dem neuen Kennwort an. Alle offenen Sitzungen wurden dabei beendet.')}
          </p>
          {/*
            Der Hinweis auf den zweiten Faktor erscheint nur, wo einer eingerichtet ist -
            und dort ist er wichtig: Wer sein Kennwort gerade zurückgesetzt hat und dann
            unerwartet nach einem Code gefragt wird, hält das für einen Fehler und
            versucht es nicht noch einmal.
          */}
          {fertig.zweiFaktor && (
            <p className="anmeldung-fussnote">
              {t('Ihr zweiter Faktor gilt unverändert weiter – halten Sie Ihre App bereit.')}
            </p>
          )}
          <button type="button" className="btn anmeldung-knopf" onClick={onFertig}>
            {t('Zur Anmeldung')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="anmeldung">
      <form className="anmeldung-karte" onSubmit={abschicken}>
        <Zugangsmarke />

        <h2 className="registrierung-fertig">{t('Neues Kennwort')}</h2>

        <label htmlFor="kennwort-neu">{t('Neues Kennwort')}</label>
        <input
          id="kennwort-neu"
          ref={ersteEingabe}
          type="password"
          value={kennwort}
          onChange={(e) => setKennwort(e.target.value)}
          autoComplete="new-password"
          minLength={mindestens}
          required
          disabled={laeuft}
          aria-describedby="kennwort-mass"
        />
        <p id="kennwort-mass" className="registrierung-mass">
          {zuKurz
            ? tp(mindestens - kennwort.length, 'Noch ein Zeichen.', 'Noch {anzahl} Zeichen.')
            : t('Mindestens {anzahl} Zeichen. Länge zählt mehr als Sonderzeichen.', {
                anzahl: mindestens,
              })}
        </p>

        <label htmlFor="kennwort-neu-wdh">{t('Kennwort wiederholen')}</label>
        <input
          id="kennwort-neu-wdh"
          type="password"
          value={wiederholung}
          onChange={(e) => setWiederholung(e.target.value)}
          autoComplete="new-password"
          required
          disabled={laeuft}
        />
        {ungleich && (
          <p className="registrierung-mass registrierung-mass-warn">
            {t('Die beiden Kennwörter stimmen noch nicht überein.')}
          </p>
        )}

        {fehler && (
          <p className="anmeldung-fehler" role="alert">
            {fehler}
          </p>
        )}

        <button type="submit" className="btn anmeldung-knopf" disabled={laeuft}>
          {laeuft ? t('Wird gesetzt…') : t('Kennwort setzen')}
        </button>

        <p className="anmeldung-fussnote">
          {t('Das ist das Kennwort für Energy Mail – nicht das Ihres Postfachs.')}
        </p>
      </form>
    </div>
  );
}
