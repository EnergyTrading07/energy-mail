import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { t } from '../sprache.js';

/**
 * Absender, deren entfernte Inhalte ohne Rückfrage geladen werden.
 *
 * ## Warum es diese Ansicht gibt
 *
 * Entfernte Inhalte sind grundsätzlich angehalten, weil ein Bild aus dem Netz dem Absender
 * meldet, dass gelesen wurde - wann, wie oft und von welcher Adresse aus. Wer bei einer
 * Nachricht auf "Von diesem Absender immer laden" klickt, hebt das für diesen Absender
 * dauerhaft auf.
 *
 * Bis hierher war das eine Einbahnstraße: Der Server konnte die Liste immer schon
 * herausgeben und Einträge daraus entfernen, beides war in der Schnittstelle vorhanden -
 * nur rief es niemand auf. Wer einmal freigegeben hatte, sah nie wieder, WEN er
 * freigegeben hatte, und konnte es nicht zurücknehmen. Für eine Entscheidung über die
 * eigenen Daten ist das die falsche Richtung; sie muss sich ansehen und widerrufen lassen.
 *
 * Bewusst nur Liste und Entzug, kein Feld zum Eintragen von Hand: Vertrauen entsteht an
 * der Nachricht, vor der man sitzt, und nicht in einem Formular.
 */

interface Props {
  kontoId: string;
}

export function VertrauteAbsenderTeil({ kontoId }: Props) {
  const [absender, setAbsender] = useState<string[]>([]);
  const [laeuft, setLaeuft] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  /** Welche Adresse gerade entfernt wird - der Knopf daneben ruht so lange. */
  const [entfernt, setEntfernt] = useState<string | null>(null);

  useEffect(() => {
    let gilt = true;
    setLaeuft(true);
    setFehler(null);
    api
      .fetchVertrauteAbsender(kontoId)
      .then((a) => {
        // Nach einem Kontowechsel während des Ladens gehört die Antwort nicht mehr hierher.
        if (gilt) setAbsender(a.absender);
      })
      .catch((err) => {
        if (gilt) setFehler((err as Error).message);
      })
      .finally(() => {
        if (gilt) setLaeuft(false);
      });
    return () => {
      gilt = false;
    };
  }, [kontoId]);

  const entziehe = async (adresse: string) => {
    setEntfernt(adresse);
    setFehler(null);
    try {
      const { absender: uebrig } = await api.vertrauenEntziehen(kontoId, adresse);
      setAbsender(uebrig);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setEntfernt(null);
    }
  };

  return (
    <div className="form-row">
      <span className="feld-titel">{t('Absender mit freigegebenen Inhalten')}</span>
      <p className="hint">
        {t(
          'Bei diesen Absendern werden Bilder und andere entfernte Inhalte ohne Rückfrage geladen. Bei allen übrigen bleiben sie angehalten, denn ein nachgeladenes Bild meldet dem Absender, dass die Nachricht geöffnet wurde.',
        )}
      </p>

      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      {laeuft ? (
        <p className="hint">{t('Wird geladen …')}</p>
      ) : absender.length === 0 ? (
        <p className="hint">
          {t('Für dieses Konto ist kein Absender freigegeben – entfernte Inhalte bleiben überall angehalten.')}
        </p>
      ) : (
        absender.map((adresse) => (
          <div key={adresse} className="identitaet-zeile">
            <div className="identitaet-text">
              <strong>{adresse}</strong>
            </div>
            <button
              type="button"
              className="link-btn"
              disabled={entfernt !== null}
              onClick={() => void entziehe(adresse)}
            >
              {entfernt === adresse ? t('Wird entfernt …') : t('Vertrauen entziehen')}
            </button>
          </div>
        ))
      )}
    </div>
  );
}
