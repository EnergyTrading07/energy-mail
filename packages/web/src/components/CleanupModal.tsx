import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';

/**
 * Postfach aufräumen.
 *
 * Zeigt, wer den Ordner vollmacht, und bietet zu jedem Absender die drei Schritte an,
 * die dagegen helfen: abmelden, das Vorhandene wegräumen, künftiges automatisch
 * einsortieren. Die Zahlen sind exakt vom Server gezählt, nicht aus der Stichprobe
 * hochgerechnet - danach wird gelöscht, da darf nichts geschätzt sein.
 */

interface Props {
  account: Account;
  onClose: () => void;
  /** Öffnet die Regelverwaltung mit vorbelegtem Absender. */
  onRegelAnlegen: (absender: string, name: string) => void;
  onGeaendert: () => void;
}

export function CleanupModal({ account, onClose, onRegelAnlegen, onGeaendert }: Props) {
  const [daten, setDaten] = useState<api.AbsenderUebersicht | null>(null);
  const [laeuft, setLaeuft] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);

  const laden = () => {
    setLaeuft(true);
    api
      .fetchSenders(account.id)
      .then(setDaten)
      .catch((err) => setFehler((err as Error).message))
      .finally(() => setLaeuft(false));
  };

  useEffect(() => {
    laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const abmelden = async (eintrag: api.AbsenderEintrag) => {
    if (!eintrag.beispielUid) return;
    if (
      !confirm(
        `Von „${eintrag.name || eintrag.adresse}“ abmelden?\n\n` +
          'Dabei erfährt der Absender, dass diese Adresse gelesen wird. Bei seriösen ' +
          'Verteilern ist das unproblematisch - bei unerwünschter Werbung von unbekannten ' +
          'Absendern ist Löschen der bessere Weg.',
      )
    ) {
      return;
    }
    setBusy(eintrag.adresse);
    setFehler(null);
    try {
      const ergebnis = await api.unsubscribe(account.id, 'INBOX', eintrag.beispielUid);
      if (ergebnis.art === 'im-browser' && ergebnis.ziel) {
        // Eine Seite mit Bestätigung kann nur der Nutzer bedienen.
        window.open(ergebnis.ziel, '_blank');
        setMeldung('Die Abmeldeseite wurde geöffnet - dort noch bestätigen.');
      } else if (ergebnis.art === 'mail') {
        setMeldung(`Abmeldung an ${ergebnis.adresse} geschickt.`);
      } else {
        setMeldung(
          ergebnis.erfolg
            ? `Abgemeldet (Server antwortete mit ${ergebnis.status}).`
            : `Der Verteiler antwortete mit ${ergebnis.status} - die Abmeldung hat vermutlich nicht gegriffen.`,
        );
      }
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const wegraeumen = async (eintrag: api.AbsenderEintrag) => {
    if (
      !confirm(
        `Alle ${eintrag.gesamt} Nachrichten von „${eintrag.name || eintrag.adresse}“ ` +
          'in den Papierkorb verschieben?\n\nVon dort lassen sie sich zurückholen, bis der ' +
          'Papierkorb geleert wird.',
      )
    ) {
      return;
    }
    setBusy(eintrag.adresse);
    setFehler(null);
    try {
      const { verschoben } = await api.moveFromSender(account.id, 'INBOX', eintrag.adresse);
      setMeldung(`${verschoben} Nachrichten in den Papierkorb verschoben.`);
      onGeaendert();
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Postfach aufräumen — {account.email}</h3>

        {daten && (
          <p className="hint">
            Aus den jüngsten {daten.stichprobe.toLocaleString('de-DE')} Nachrichten ermittelt;
            die Anzahlen gelten für den gesamten Posteingang
            ({daten.imOrdner.toLocaleString('de-DE')} Nachrichten).
          </p>
        )}

        {fehler && <div className="error-banner">{fehler}</div>}
        {meldung && <div className="regel-vorschau">{meldung}</div>}
        {laeuft && <div className="empty-state">Absender werden ermittelt…</div>}

        {daten && !laeuft && (
          <table className="absender-tabelle">
            <thead>
              <tr>
                <th>Absender</th>
                <th className="zahl">Nachrichten</th>
                <th className="zahl">ungelesen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {daten.eintraege.map((e) => (
                <tr key={e.adresse}>
                  <td>
                    <div className="absender-name">{e.name || e.adresse}</div>
                    <div className="absender-adresse">{e.adresse}</div>
                  </td>
                  <td className="zahl">{e.gesamt.toLocaleString('de-DE')}</td>
                  <td className="zahl">{e.ungelesen.toLocaleString('de-DE')}</td>
                  <td className="absender-aktionen">
                    <button
                      className="link-btn"
                      disabled={!e.listUnsubscribe || busy !== null}
                      title={
                        e.listUnsubscribe
                          ? e.einKlickAbmeldung
                            ? 'Abmeldung mit einem Klick - der Absender hat das zugesagt'
                            : 'Abmelden über den vom Absender angegebenen Weg'
                          : 'Dieser Absender gibt keinen Abmeldeweg an'
                      }
                      onClick={() => void abmelden(e)}
                    >
                      {busy === e.adresse ? '…' : 'Abmelden'}
                    </button>
                    <button
                      className="link-btn gefaehrlich"
                      disabled={busy !== null}
                      onClick={() => void wegraeumen(e)}
                    >
                      Alle wegräumen
                    </button>
                    <button
                      className="link-btn"
                      disabled={busy !== null}
                      onClick={() => onRegelAnlegen(e.adresse, e.name || e.adresse)}
                    >
                      Regel…
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="form-row regel-knoepfe">
          <button className="btn secondary" disabled={laeuft} onClick={laden}>
            Neu ermitteln
          </button>
          <button className="link-btn" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}
