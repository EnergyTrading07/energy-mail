import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { Marke } from './Symbole.js';

/**
 * Das Anmeldefenster.
 *
 * Erscheint nur im Browserbetrieb. In der Desktop-Hülle weist sich das Fenster über das
 * Zugangsgeheimnis des Prozesses aus - ein Rechner, ein Mensch; eine Anmeldung wäre dort
 * eine Hürde ohne Gegenwert, und dieses Fenster bekommt niemand zu sehen.
 *
 * Bewusst schmal gehalten: hier gibt es nichts zu entdecken. Wer hier steht, will nur
 * an seine Post.
 */

interface Props {
  /** Wird gerufen, wenn die Anmeldung geklappt hat - die Anwendung darf dann starten. */
  onAngemeldet: () => void;
}

export function Anmeldung({ onAngemeldet }: Props) {
  const [email, setEmail] = useState('');
  const [kennwort, setKennwort] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const ersteEingabe = useRef<HTMLInputElement>(null);

  // Der Fokus gehört ins erste Feld: wer hier landet, will tippen und nicht erst klicken.
  useEffect(() => {
    ersteEingabe.current?.focus();
  }, []);

  const abschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;
    setFehler('');
    setLaeuft(true);
    try {
      await api.anmelden(email, kennwort);
      onAngemeldet();
    } catch (err) {
      setFehler((err as Error).message);
      /*
       * Nur das Kennwort leeren, nicht die Adresse.
       *
       * Wer sich vertippt hat, tippt das Kennwort neu - die Adresse noch einmal
       * einzugeben wäre eine Schikane. Und das falsche Kennwort stehen zu lassen führt
       * dazu, dass man dasselbe zweimal abschickt.
       */
      setKennwort('');
      setLaeuft(false);
    }
  };

  return (
    <div className="anmeldung">
      <form className="anmeldung-karte" onSubmit={abschicken}>
        <div className="anmeldung-marke">
          <Marke groesse={40} />
          {/* Dasselbe Wortzeichen wie in der Titelleiste - siehe .marke-wort. */}
          <h1>
            Energy <span>Mail</span>
          </h1>
        </div>

        <label htmlFor="anmeldung-email">Adresse</label>
        <input
          id="anmeldung-email"
          ref={ersteEingabe}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={laeuft}
        />

        <label htmlFor="anmeldung-kennwort">Kennwort</label>
        <input
          id="anmeldung-kennwort"
          type="password"
          value={kennwort}
          onChange={(e) => setKennwort(e.target.value)}
          autoComplete="current-password"
          required
          disabled={laeuft}
        />

        {/*
          role="alert" statt einer stillen Zeile: eine Vorlesesoftware nennt den Fehler
          von selbst. Ohne das säße jemand vor einem Formular, das sich nicht abschicken
          lässt, ohne zu erfahren warum.
        */}
        {fehler && (
          <p className="anmeldung-fehler" role="alert">
            {fehler}
          </p>
        )}

        <button type="submit" className="btn anmeldung-knopf" disabled={laeuft}>
          {laeuft ? 'Wird geprüft…' : 'Anmelden'}
        </button>

        <p className="anmeldung-fussnote">
          Das ist das Kennwort für Energy Mail – nicht das Ihres Postfachs.
        </p>
      </form>
    </div>
  );
}
