import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { Sprachwahl, Zugangsmarke, Zugangsumschalter } from './Zugangsteile.js';
import { t, tp } from '../sprache.js';

/**
 * Sich selbst ein Konto anlegen.
 *
 * Dieselbe Karte wie das Anmeldefenster, und das ist Absicht: Wer zwischen "Anmelden" und
 * "Konto anlegen" hin- und herwechselt, soll nicht das Gefühl haben, den Dienst verlassen
 * zu haben. Der Unterschied zwischen beiden ist ein Satz und ein Feld mehr - nicht ein
 * anderes Gesicht.
 *
 * ## Was hier ehrlich gesagt werden muss
 *
 * Drei Dinge, und sie stehen alle auf dem Formular statt in einer Hilfe, die niemand
 * öffnet:
 *
 *  1. **Welches Kennwort gemeint ist.** Ein Mensch, der ein Mailprogramm vor sich hat,
 *     tippt hier sonst das Kennwort seines Postfachs ein - und wundert sich später, dass
 *     es zwei gibt. Der Satz steht deshalb unter dem Feld und nicht daneben.
 *  2. **Was mit seinen Angaben geschieht.** Der Hinweis kommt vom Server, weil ihn der
 *     Betreiber hinterlegt; hier steht nur, dass er zu lesen ist, bevor der Haken gesetzt
 *     wird.
 *  3. **Wie es weitergeht.** "Ihr Konto wurde angelegt" wäre in zwei von drei
 *     Betriebsarten schlicht falsch. Was danebensteht, richtet sich danach, was der
 *     Server tatsächlich tut.
 */

interface Props {
  lage: api.Registrierungslage;
  /** Zurück zum Anmeldefenster. */
  onZurueck: () => void;
}

export function Registrierung({ lage, onZurueck }: Props) {
  const [email, setEmail] = useState('');
  const [kennwort, setKennwort] = useState('');
  const [wiederholung, setWiederholung] = useState('');
  const [bemerkung, setBemerkung] = useState('');
  const [hinweisGelesen, setHinweisGelesen] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const [fertig, setFertig] = useState<'bestaetigen' | 'wartet' | null>(null);
  const ersteEingabe = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ersteEingabe.current?.focus();
  }, []);

  const zuKurz = kennwort.length > 0 && kennwort.length < lage.kennwortMindestlaenge;
  const ungleich = wiederholung.length > 0 && kennwort !== wiederholung;

  const abschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;

    /*
     * Beides wird auch am Server geprüft - hier steht es, damit niemand erst auf eine
     * Antwort warten muss, um zu erfahren, dass er sich vertippt hat. Der Server bleibt
     * der Riegel; dies ist die Höflichkeit.
     */
    if (kennwort !== wiederholung) {
      setFehler(t('Die beiden Kennwörter stimmen nicht überein.'));
      return;
    }
    if (kennwort.length < lage.kennwortMindestlaenge) {
      setFehler(
        t('Das Kennwort muss mindestens {anzahl} Zeichen haben.', {
          anzahl: lage.kennwortMindestlaenge,
        }),
      );
      return;
    }

    setFehler('');
    setLaeuft(true);
    try {
      const befund = await api.registrieren({
        email,
        kennwort,
        bemerkung: bemerkung.trim() || undefined,
        hinweisGelesen,
      });
      /*
       * Das Kennwort aus dem Speicher nehmen, sobald es nicht mehr gebraucht wird.
       *
       * Dieselbe Überlegung wie im Anmeldefenster: Was ohne Grund im Zustand eines
       * Fensters steht, steht auch in jedem Fehlerbericht dieses Fensters.
       */
      setKennwort('');
      setWiederholung('');
      setFertig(befund.art);
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

          <h2 className="registrierung-fertig">
            {fertig === 'bestaetigen' ? t('Sehen Sie in Ihr Postfach') : t('Ihr Antrag ist da')}
          </h2>

          <p className="anmeldung-hinweis">
            {fertig === 'bestaetigen'
              ? t('Wir haben Ihnen eine Nachricht geschickt. Klicken Sie auf den Link darin – erst dann geht es weiter. Der Link gilt 24 Stunden.')
              : t('Ein Verwalter sieht sich Ihren Antrag an und schaltet den Zugang frei. Sobald das geschehen ist, können Sie sich hier anmelden.')}
          </p>

          {/*
            Warum hier nicht steht, ob die Adresse schon vergeben war: Weil dieses
            Fenster jedem offensteht. Stünde es hier, ließe sich damit durchprobieren,
            wer an diesem Dienst ein Konto hat. Wer die Adresse wirklich besitzt, erfährt
            es per Mail - siehe registrierung.ts am Server.
          */}
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

        <Zugangsumschalter aktiv="registrieren" onWechsel={(w) => w === 'anmelden' && onZurueck()} />

        <p className="anmeldung-hinweis">
          {lage.betriebsart === 'freigabe'
            ? t('Legen Sie hier Ihren Zugang an. Freigeschaltet wird er von einem Verwalter.')
            : t('Legen Sie hier Ihren Zugang an.')}
        </p>

        {lage.domaenen.length > 0 && (
          <p className="anmeldung-hinweis registrierung-domaenen">
            {t('Möglich sind nur Adressen dieser Domänen: {domaenen}', {
              domaenen: lage.domaenen.map((d) => `@${d}`).join(', '),
            })}
          </p>
        )}

        <label htmlFor="registrierung-email">{t('Adresse')}</label>
        <input
          id="registrierung-email"
          ref={ersteEingabe}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={laeuft}
        />

        <label htmlFor="registrierung-kennwort">{t('Kennwort')}</label>
        <input
          id="registrierung-kennwort"
          type="password"
          value={kennwort}
          onChange={(e) => setKennwort(e.target.value)}
          /*
           * new-password und nicht current-password: Damit bietet der Kennwortspeicher
           * des Browsers an, eines zu erzeugen, statt ein vorhandenes einzusetzen. Das
           * ist die wirksamste Kennwortregel, die ein Formular haben kann - und die
           * einzige, die dem Menschen keine Arbeit macht.
           */
          autoComplete="new-password"
          minLength={lage.kennwortMindestlaenge}
          required
          disabled={laeuft}
          aria-describedby="registrierung-kennwort-hinweis"
        />
        <p id="registrierung-kennwort-hinweis" className="registrierung-mass">
          {zuKurz
            ? tp(
                lage.kennwortMindestlaenge - kennwort.length,
                'Noch ein Zeichen.',
                'Noch {anzahl} Zeichen.',
              )
            : t('Mindestens {anzahl} Zeichen. Länge zählt mehr als Sonderzeichen.', {
                anzahl: lage.kennwortMindestlaenge,
              })}
        </p>

        <label htmlFor="registrierung-wiederholung">{t('Kennwort wiederholen')}</label>
        <input
          id="registrierung-wiederholung"
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

        {/*
          Die Bemerkung gibt es nur dort, wo sie jemand liest. Bei offener Registrierung
          entscheidet kein Mensch über den Antrag - ein Freitextfeld wäre dann ein Feld,
          das Daten sammelt, die niemand braucht.
        */}
        {lage.betriebsart === 'freigabe' && (
          <>
            <label htmlFor="registrierung-bemerkung">{t('Bemerkung (freiwillig)')}</label>
            <input
              id="registrierung-bemerkung"
              type="text"
              value={bemerkung}
              onChange={(e) => setBemerkung(e.target.value)}
              maxLength={200}
              disabled={laeuft}
              placeholder={t('z. B. Ihre Abteilung')}
            />
          </>
        )}

        <div className="registrierung-hinweis">
          <p>{lage.hinweis}</p>
        </div>

        <label className="registrierung-haken" htmlFor="registrierung-einwilligung">
          <input
            id="registrierung-einwilligung"
            type="checkbox"
            checked={hinweisGelesen}
            onChange={(e) => setHinweisGelesen(e.target.checked)}
            disabled={laeuft}
            required
          />
          <span>{t('Ich habe die Hinweise zum Datenschutz gelesen.')}</span>
        </label>

        {fehler && (
          <p className="anmeldung-fehler" role="alert">
            {fehler}
          </p>
        )}

        <button
          type="submit"
          className="btn anmeldung-knopf"
          disabled={laeuft || !hinweisGelesen}
        >
          {laeuft ? t('Wird gesendet…') : t('Zugang beantragen')}
        </button>

        <p className="anmeldung-fussnote">
          {t('Das Kennwort gilt für Energy Mail – nicht für Ihr Postfach. Das tragen Sie später ein.')}
        </p>

        <Sprachwahl />
      </form>
    </div>
  );
}

/**
 * Der Bestätigungslink aus der Mail.
 *
 * Angemeldet wird hier ausdrücklich nicht - auch dann nicht, wenn das Konto in diesem
 * Augenblick entsteht. Der Link liegt in einem Postfach, und wer darauf Zugriff hat, ist
 * nicht zwangsläufig der, dem das Konto gehört. Das Kennwort ist der zweite Nachweis;
 * dieser Weg soll ihn nicht ersetzen. Die Begründung steht auch am Server.
 */
export function Bestaetigung({ marke, onFertig }: { marke: string; onFertig: () => void }) {
  const [stand, setStand] = useState<'laeuft' | 'fertig' | 'wartet' | 'fehler'>('laeuft');
  const [meldung, setMeldung] = useState('');

  useEffect(() => {
    let abgebrochen = false;
    api
      .registrierungBestaetigen(marke)
      .then((befund) => {
        if (abgebrochen) return;
        setStand(befund.art === 'fertig' ? 'fertig' : 'wartet');
      })
      .catch((err: Error) => {
        if (abgebrochen) return;
        setMeldung(err.message);
        setStand('fehler');
      });
    return () => {
      abgebrochen = true;
    };
  }, [marke]);

  return (
    <div className="anmeldung">
      <div className="anmeldung-karte">
        <Zugangsmarke />

        {stand === 'laeuft' && <p className="anmeldung-hinweis">{t('Wird geprüft…')}</p>}

        {stand === 'fertig' && (
          <>
            <h2 className="registrierung-fertig">{t('Ihr Zugang steht')}</h2>
            <p className="anmeldung-hinweis">
              {t('Melden Sie sich jetzt mit Ihrer Adresse und dem Kennwort an, das Sie gewählt haben.')}
            </p>
          </>
        )}

        {stand === 'wartet' && (
          <>
            <h2 className="registrierung-fertig">{t('Danke – Adresse bestätigt')}</h2>
            <p className="anmeldung-hinweis">
              {t('Ein Verwalter schaltet Ihren Zugang frei. Sobald das geschehen ist, können Sie sich anmelden.')}
            </p>
          </>
        )}

        {stand === 'fehler' && (
          <p className="anmeldung-fehler" role="alert">
            {meldung}
          </p>
        )}

        <button type="button" className="btn anmeldung-knopf" onClick={onFertig}>
          {t('Zur Anmeldung')}
        </button>
      </div>
    </div>
  );
}
