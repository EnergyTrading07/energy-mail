import { useEffect, useState } from 'react';
import * as api from '../api.js';

/**
 * Die Nachricht im Original.
 *
 * Man braucht sie aus drei Gründen: um zu prüfen, ob eine Mail wirklich von dem kommt,
 * der draufsteht (die Prüfergebnisse für SPF, DKIM und DMARC stehen in den Kopfzeilen),
 * um zu verstehen, warum etwas nicht dargestellt wird, und um sie unverändert zu sichern.
 *
 * Der Kopf ist abgesetzt und aufgeklappt, der Rumpf eingeklappt: gesucht wird fast immer
 * im Kopf, und ein Rumpf mit eingebetteten Bildern hat schnell hunderttausend Zeichen,
 * durch die niemand scrollen will.
 */

interface Props {
  accountId: string;
  ordner: string;
  uid: number;
  betreff: string;
  onClose: () => void;
}

/** Kopf und Rumpf trennt die erste Leerzeile - so schreibt es RFC 5322 vor. */
function teile(roh: string): { kopf: string; rumpf: string } {
  const trenner = roh.search(/\r?\n\r?\n/);
  if (trenner < 0) return { kopf: roh, rumpf: '' };
  return { kopf: roh.slice(0, trenner), rumpf: roh.slice(trenner).replace(/^\r?\n\r?\n/, '') };
}

/**
 * Die Kopfzeilen, an denen man die Echtheit abliest. Sie werden hervorgehoben, weil sie
 * der eigentliche Grund sind, warum jemand hier hineinsieht.
 */
const PRUEFZEILEN = /^(authentication-results|received-spf|dkim-signature|arc-authentication-results):/i;

export function QuelltextModal({ accountId, ordner, uid, betreff, onClose }: Props) {
  const [roh, setRoh] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [rumpfOffen, setRumpfOffen] = useState(false);
  const [kopiert, setKopiert] = useState(false);

  useEffect(() => {
    let abgebrochen = false;
    api
      .fetchQuelltext(accountId, ordner, uid)
      .then((t) => {
        if (!abgebrochen) setRoh(t);
      })
      .catch((err) => {
        if (!abgebrochen) setFehler((err as Error).message);
      });
    return () => {
      abgebrochen = true;
    };
  }, [accountId, ordner, uid]);

  const { kopf, rumpf } = roh ? teile(roh) : { kopf: '', rumpf: '' };

  const kopieren = async () => {
    if (!roh) return;
    await navigator.clipboard.writeText(roh);
    setKopiert(true);
    window.setTimeout(() => setKopiert(false), 2000);
  };

  const sichern = () => {
    if (!roh) return;
    const datei = new Blob([roh], { type: 'message/rfc822' });
    const adresse = URL.createObjectURL(datei);
    const verweis = document.createElement('a');
    verweis.href = adresse;
    // Dateinamen aus dem Betreff, aber ohne Zeichen, die Windows nicht mag.
    verweis.download = `${(betreff || 'Nachricht').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80)}.eml`;
    verweis.click();
    URL.revokeObjectURL(adresse);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-breit" onClick={(e) => e.stopPropagation()}>
        <h3>Quelltext — {betreff || '(kein Betreff)'}</h3>

        {fehler && <div className="error-banner">{fehler}</div>}
        {!roh && !fehler && <div className="empty-state">Wird geholt…</div>}

        {roh && (
          <>
            <h4 className="wartend-titel">Kopfzeilen</h4>
            <pre className="quelltext">
              {kopf.split(/\r?\n/).map((zeile, i) => (
                <div key={i} className={PRUEFZEILEN.test(zeile) ? 'quell-pruefzeile' : undefined}>
                  {zeile || ' '}
                </div>
              ))}
            </pre>

            <h4 className="wartend-titel">
              Rumpf{' '}
              <button className="link-btn" onClick={() => setRumpfOffen((v) => !v)}>
                {rumpfOffen ? 'einklappen' : `anzeigen (${Math.round(rumpf.length / 1024)} KB)`}
              </button>
            </h4>
            {rumpfOffen && <pre className="quelltext quelltext-rumpf">{rumpf}</pre>}
          </>
        )}

        <div className="form-row regel-knoepfe">
          <button className="btn secondary" disabled={!roh} onClick={() => void kopieren()}>
            {kopiert ? 'Kopiert' : 'Alles kopieren'}
          </button>
          <button className="btn secondary" disabled={!roh} onClick={sichern}>
            Als Datei sichern
          </button>
          <button className="link-btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
