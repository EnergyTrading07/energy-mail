import { useEffect, useState } from 'react';
import { useFortschritt } from '../useFortschritt.js';
import { t } from '../sprache.js';

/**
 * Zeigt, wie weit die Sicherung eines Ordners ist.
 *
 * Nötig, weil der Browser den Fortschritt hier nicht selbst anzeigen kann: er lädt eine
 * Datei unbekannter Länge, und sein eigener Balken bleibt deshalb bei "unbekannt"
 * stehen. Bei einem Ordner mit dreißigtausend Nachrichten sind das Minuten, in denen
 * sonst nichts darauf hindeutete, dass überhaupt etwas geschieht.
 *
 * Der Server meldet den Stand über dieselbe Verbindung, die auch neue Post ankündigt.
 */

interface Props {
  accountId: string;
  ordner: string;
  onFertig: () => void;
}

/** Nach dem letzten Zeichen noch kurz stehen bleiben, damit man das Ende sieht. */
const NACHLAUF_MS = 4000;

export function SicherungsMeldung({ accountId, ordner, onFertig }: Props) {
  const stand = useFortschritt(accountId, 'sicherung', true);
  const [fertig, setFertig] = useState(false);

  const durch = stand?.text === 'fertig';

  useEffect(() => {
    if (!durch) return;
    setFertig(true);
    const uhr = window.setTimeout(onFertig, NACHLAUF_MS);
    return () => window.clearTimeout(uhr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durch]);

  /**
   * Falls gar keine Meldung kommt - etwa weil der Abruf sofort scheiterte -, nicht
   * ewig stehen bleiben. Eine Anzeige, die nie verschwindet, ist schlimmer als keine.
   */
  useEffect(() => {
    const uhr = window.setTimeout(onFertig, 20 * 60_000);
    return () => window.clearTimeout(uhr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anteil = stand && stand.von > 0 ? Math.round((stand.getan / stand.von) * 100) : 0;

  return (
    <div className="sicherung-meldung" role="status">
      <div className="sicherung-text">
        <strong>{fertig ? `„${ordner}" gesichert` : `„${ordner}" wird gesichert`}</strong>
        <span>
          {fertig
            ? t('Die Datei liegt in deinem Download-Ordner.')
            : (stand?.text ?? t('Nachrichten werden geholt…'))}
        </span>
      </div>
      {!fertig && (
        <div className="sicherung-balken" aria-hidden="true">
          <div className="sicherung-anteil" style={{ width: `${anteil}%` }} />
        </div>
      )}
      <button className="link-btn" onClick={onFertig}>
        {fertig ? t('Schließen') : t('Ausblenden')}
      </button>
    </div>
  );
}
