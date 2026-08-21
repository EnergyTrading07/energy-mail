import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { t } from '../sprache.js';

/**
 * Das Band über einer Nachricht, deren Absender eine Lesebestätigung möchte.
 *
 * ## Warum die Oberfläche das auslöst und nicht der Server
 *
 * Weil nur sie weiß, ob die Nachricht wirklich vor jemandem steht. Der Server sieht, dass
 * jemand Daten geholt hat - das tut auch eine Vorschau, ein Zwischenspeicher oder eine
 * Suche. Eine Bestätigung von dort behauptete „angezeigt", ohne es zu wissen, und
 * „angezeigt" ist das Einzige, was eine Lesebestätigung überhaupt aussagt.
 *
 * Deshalb hängt die automatische Bestätigung an dieser Stelle: Sie geht hinaus, wenn
 * dieses Band gezeichnet wird - also wenn die Nachricht offen ist.
 *
 * ## Warum „Nicht senden" ein eigener Knopf ist und kein Wegklicken
 *
 * Ein Wegklicken wäre keine Entscheidung, und die Frage käme beim nächsten Öffnen wieder -
 * so lange, bis jemand aus Versehen zustimmt. Wer hier Nein sagt, sagt es einmal.
 */

interface Props {
  accountId: string;
  ordner: string;
  uid: number;
  /** Wohin die Bestätigung ginge. */
  an: string;
  /** Ob gefragt werden muss - sonst geht sie von selbst hinaus. */
  fragen: boolean;
  /**
   * Die Bestätigungsadresse weicht vom Absender ab.
   *
   * Dann wird immer gefragt, auch bei „immer" - und der Hinweis dazu ist kein Beiwerk:
   * Eine Nachricht an einen Verteiler, deren Bestätigungen an ein fremdes Postfach gehen,
   * macht aus vierhundert Lesern vierhundert Absender.
   */
  abweichend: boolean;
}

export function Lesebestaetigung({ accountId, ordner, uid, an, fragen, abweichend }: Props) {
  const [stand, setStand] = useState<'offen' | 'laeuft' | 'gesendet' | 'abgelehnt'>('offen');
  const [fehler, setFehler] = useState<string | null>(null);
  /** Damit die automatische Bestätigung bei einem zweiten Zeichnen nicht noch einmal geht. */
  const losgeschickt = useRef('');

  /*
   * Gemerkt, damit der Effekt darunter sie als Abhaengigkeit nennen kann.
   *
   * Ohne useCallback entstuende bei jedem Zeichnen eine neue Funktion. Der Effekt muesste
   * sie dann entweder verschweigen - und liefe damit womoeglich gegen einen alten Stand
   * von accountId/ordner/uid - oder bei jedem Zeichnen neu laufen. Gemerkt an genau den
   * drei Werten, aus denen sie besteht, ist beides gelöst: Sie bleibt dieselbe, solange
   * es dieselbe Nachricht ist.
   */
  const entscheide = useCallback(
    async (senden: boolean) => {
      setStand('laeuft');
      setFehler(null);
      try {
        await api.sendeLesebestaetigung(accountId, ordner, uid, senden);
        setStand(senden ? 'gesendet' : 'abgelehnt');
      } catch (err) {
        setFehler((err as Error).message);
        setStand('offen');
      }
    },
    [accountId, ordner, uid],
  );

  useEffect(() => {
    const schluessel = `${accountId}:${ordner}:${uid}`;
    if (fragen || losgeschickt.current === schluessel) return;
    losgeschickt.current = schluessel;
    void entscheide(true);
    // Die Kennung der Nachricht ist die Abhängigkeit; `fragen` gehört dazu, weil sich
    // daran entscheidet, ob überhaupt etwas von selbst geschieht. `entscheide` hängt
    // seinerseits an derselben Kennung und ändert sich damit im Gleichschritt.
  }, [accountId, ordner, uid, fragen, entscheide]);

  if (stand === 'gesendet') {
    return (
      <div className="lesebest-band gesendet">
        <span>{t('Lesebestätigung an {wer} gesendet.', { wer: an })}</span>
      </div>
    );
  }
  if (stand === 'abgelehnt') {
    return (
      <div className="lesebest-band">
        <span>{t('Es wurde keine Lesebestätigung gesendet.')}</span>
      </div>
    );
  }
  // Sie geht gerade automatisch hinaus - dann ist hier nichts zu entscheiden.
  if (!fragen) return null;

  return (
    <div className={`lesebest-band${abweichend ? ' warnung' : ''}`} role="status">
      <span className="lesebest-text">
        {t('Der Absender möchte eine Lesebestätigung.')}{' '}
        {abweichend ? (
          <strong>
            {t('Sie ginge an {wer} – nicht an den Absender. Das ist ungewöhnlich.', { wer: an })}
          </strong>
        ) : (
          t('Sie ginge an {wer}.', { wer: an })
        )}
      </span>
      {fehler && <span className="lesebest-fehler">{fehler}</span>}
      <span className="lesebest-knoepfe">
        <button
          className="btn secondary"
          disabled={stand === 'laeuft'}
          onClick={() => void entscheide(true)}
        >
          {t('Senden')}
        </button>
        <button
          className="link-btn"
          disabled={stand === 'laeuft'}
          onClick={() => void entscheide(false)}
        >
          {t('Nicht senden')}
        </button>
      </span>
    </div>
  );
}
