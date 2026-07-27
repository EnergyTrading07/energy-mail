import { useEffect, useState } from 'react';

/**
 * Meldung nach dem Absenden, mit Bedenkzeit.
 *
 * Der Nutzen liegt allein im Zeitfenster: die häufigsten Versehen beim Mailschreiben -
 * falscher Empfänger, vergessener Anhang, zu schnelle Antwort - fallen in den Sekunden
 * unmittelbar nach dem Klick auf. Danach hilft nichts mehr, denn eine versendete Mail
 * lässt sich nicht zurückholen.
 */

interface Props {
  betreff: string;
  /** Zeitpunkt, ab dem gesendet wird. */
  faellig: number;
  onRueckgaengig: () => void;
  onFertig: () => void;
}

export function SendeMeldung({ betreff, faellig, onRueckgaengig, onFertig }: Props) {
  const [restSekunden, setRest] = useState(() =>
    Math.max(0, Math.ceil((faellig - Date.now()) / 1000)),
  );

  useEffect(() => {
    const t = setInterval(() => {
      const rest = Math.max(0, Math.ceil((faellig - Date.now()) / 1000));
      setRest(rest);
      if (rest === 0) {
        clearInterval(t);
        // Kurz stehen lassen, damit die Meldung nicht im selben Moment verschwindet,
        // in dem sie ihren Zweck erfüllt hat.
        setTimeout(onFertig, 1500);
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [faellig]);

  return (
    <div className="sende-meldung" role="status">
      <span>
        {restSekunden > 0 ? (
          <>
            „{betreff || '(kein Betreff)'}" wird in {restSekunden} s gesendet
          </>
        ) : (
          <>„{betreff || '(kein Betreff)'}" wurde gesendet</>
        )}
      </span>
      {restSekunden > 0 && (
        <button className="btn secondary" onClick={onRueckgaengig}>
          Rückgängig
        </button>
      )}
    </div>
  );
}
