import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';

/**
 * Was noch aussteht: geplante Nachrichten und zurückgestellte Post.
 *
 * Ohne diese Ansicht sind beide Funktionen halb blind - eine für nächste Woche geplante
 * Mail ließe sich weder ansehen noch abbestellen, und eine zurückgestellte wäre bis zu
 * ihrer Rückkehr schlicht verschwunden. Beides gehört an einen Ort, weil es dieselbe
 * Frage beantwortet: was passiert demnächst, ohne dass ich etwas tue?
 */

interface Props {
  account: Account;
  onClose: () => void;
  onGeaendert: () => void;
  /** Holt eine zurückgeholte Nachricht ins Verfassen-Fenster. */
  onWeiterbearbeiten: (entwurf: api.Draft) => void;
}

/** Kurz und im Alltagston: "morgen um 08:00" liest sich besser als ein Zeitstempel. */
function wann(zeitpunkt: number): string {
  const ziel = new Date(zeitpunkt);
  const jetzt = new Date();
  const uhrzeit = ziel.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  const tageDazwischen = Math.round(
    (new Date(ziel).setHours(0, 0, 0, 0) - new Date(jetzt).setHours(0, 0, 0, 0)) / 86_400_000,
  );
  if (tageDazwischen === 0) return `heute um ${uhrzeit}`;
  if (tageDazwischen === 1) return `morgen um ${uhrzeit}`;
  if (tageDazwischen > 1 && tageDazwischen < 7) {
    return `${ziel.toLocaleDateString('de-DE', { weekday: 'long' })} um ${uhrzeit}`;
  }
  return `${ziel.toLocaleDateString('de-DE')} um ${uhrzeit}`;
}

export function WartendModal({ account, onClose, onGeaendert, onWeiterbearbeiten }: Props) {
  const [sendungen, setSendungen] = useState<api.GeplanteSendung[]>([]);
  const [wiedervorlagen, setWiedervorlagen] = useState<api.Wiedervorlage[]>([]);
  const [laeuft, setLaeuft] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = () => {
    setLaeuft(true);
    Promise.all([api.fetchPendingSends(account.id), api.fetchSnoozed(account.id)])
      .then(([s, w]) => {
        setSendungen(s);
        setWiedervorlagen(w);
      })
      .catch((err) => setFehler((err as Error).message))
      .finally(() => setLaeuft(false));
  };

  useEffect(() => {
    laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const zurueckholen = async (id: string) => {
    setFehler(null);
    try {
      const { koerper } = await api.cancelSend(account.id, id);
      onWeiterbearbeiten(koerper);
      onClose();
    } catch (err) {
      setFehler((err as Error).message);
    }
  };

  const sofortVorlegen = async (id: string) => {
    setFehler(null);
    try {
      await api.returnSnoozed(account.id, id);
      onGeaendert();
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    }
  };

  const leer = sendungen.length === 0 && wiedervorlagen.length === 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Wartet — {account.email}</h3>

        {fehler && <div className="error-banner">{fehler}</div>}
        {laeuft && <div className="empty-state">Wird geladen…</div>}
        {!laeuft && leer && (
          <div className="empty-state">
            Nichts geplant und nichts zurückgestellt.
          </div>
        )}

        {sendungen.length > 0 && (
          <>
            <h4 className="wartend-titel">Geplante Nachrichten</h4>
            {sendungen.map((s) => (
              <div key={s.id} className="wartend-zeile">
                <div className="wartend-text">
                  <strong>{s.betreff || '(kein Betreff)'}</strong>
                  <span>
                    an {s.empfaenger.join(', ') || '(niemand)'} · geht {wann(s.faellig)} raus
                  </span>
                </div>
                <button className="link-btn" onClick={() => void zurueckholen(s.id)}>
                  Zurückholen
                </button>
              </div>
            ))}
          </>
        )}

        {wiedervorlagen.length > 0 && (
          <>
            <h4 className="wartend-titel">Zurückgestellt</h4>
            {wiedervorlagen.map((w) => (
              <div key={w.id} className="wartend-zeile">
                <div className="wartend-text">
                  <strong>{w.betreff || '(kein Betreff)'}</strong>
                  <span>
                    kommt {wann(w.faellig)} zurück nach „{w.ursprung}"
                    {w.uidImOrdner === undefined && ' · Achtung: der Server hat keine Kennung gemeldet'}
                  </span>
                </div>
                <button className="link-btn" onClick={() => void sofortVorlegen(w.id)}>
                  Jetzt zurück
                </button>
              </div>
            ))}
          </>
        )}

        <div className="form-row regel-knoepfe">
          <button className="btn secondary" disabled={laeuft} onClick={laden}>
            Neu laden
          </button>
          <button className="link-btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
