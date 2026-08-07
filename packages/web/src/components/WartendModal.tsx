import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';
import { fortschrittsText, useFortschritt } from '../useFortschritt.js';

/**
 * Was noch aussteht: geplante Nachrichten, zurückgestellte Post und Liegengebliebenes.
 *
 * Ohne diese Ansicht sind die ersten beiden Funktionen halb blind - eine für nächste
 * Woche geplante Mail ließe sich weder ansehen noch abbestellen, und eine
 * zurückgestellte wäre bis zu ihrer Rückkehr schlicht verschwunden.
 *
 * Das Liegengebliebene steht bewusst daneben, obwohl es das Gegenteil ist: die oberen
 * beiden passieren von selbst, das untere passiert nur, wenn man etwas tut. Zusammen
 * beantworten sie die eine Frage, die keine Ordnerliste beantwortet - was ist noch offen?
 */

interface Props {
  account: Account;
  onClose: () => void;
  onGeaendert: () => void;
  /** Holt eine zurückgeholte Nachricht ins Verfassen-Fenster. */
  onWeiterbearbeiten: (entwurf: api.Draft) => void;
  /** Springt zu einer Nachricht - auch wenn sie in einem anderen Ordner liegt. */
  onOeffnen: (ordner: string, uid: number) => void;
  /** Öffnet das Verfassen-Fenster für ein Nachfassen. */
  onNachfassen: (an: { name?: string; address: string }[], betreff: string) => void;
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

/** "seit 12 Tagen" - eine Zahl sagt hier mehr als ein Datum. */
function seit(tage: number): string {
  if (tage === 0) return 'seit heute';
  if (tage === 1) return 'seit gestern';
  if (tage < 14) return `seit ${tage} Tagen`;
  if (tage < 60) return `seit ${Math.round(tage / 7)} Wochen`;
  return `seit ${Math.round(tage / 30)} Monaten`;
}

/** Lieber den Namen als die Adresse - und bei mehreren nur den ersten plus Anzahl. */
function wer(adressen: { name?: string; address: string }[]): string {
  const erste = adressen[0];
  if (!erste) return '(unbekannt)';
  const name = erste.name?.trim() || erste.address;
  return adressen.length > 1 ? `${name} +${adressen.length - 1}` : name;
}

export function WartendModal({
  account,
  onClose,
  onGeaendert,
  onWeiterbearbeiten,
  onOeffnen,
  onNachfassen,
}: Props) {
  const [sendungen, setSendungen] = useState<api.GeplanteSendung[]>([]);
  const [wiedervorlagen, setWiedervorlagen] = useState<api.Wiedervorlage[]>([]);
  const [offene, setOffene] = useState<api.OffenerVorgang[] | null>(null);
  const [offeneLaeuft, setOffeneLaeuft] = useState(true);
  const [offeneFehler, setOffeneFehler] = useState<string | null>(null);
  const [auchUnbekannte, setAuchUnbekannte] = useState(false);
  const [laeuft, setLaeuft] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const stand = useFortschritt(account.id, 'offen', offeneLaeuft);

  const laden = () => {
    setLaeuft(true);
    Promise.all([api.fetchPendingSends(account.id), api.fetchSnoozed(account.id)])
      .then(([s, w]) => {
        setSendungen(s);
        setWiedervorlagen(w);
      })
      .catch((err) => setFehler((err as Error).message))
      .finally(() => setLaeuft(false));

    // Getrennt geladen, weil es deutlich länger dauert: dafür werden zwei Ordner über
    // Monate durchgesehen. Das Geplante steht dadurch sofort da, statt darauf zu warten.
    ladeOffene(auchUnbekannte);
  };

  /**
   * Nur die zuletzt gestellte Anfrage darf das Ergebnis setzen. Der Abruf dauert
   * Sekunden; wer den Schalter zweimal umlegt, bekäme sonst je nach Laufzeit die Antwort
   * zur alten Einstellung angezeigt.
   */
  const laufendeAnfrage = useRef(0);

  const ladeOffene = (alle: boolean) => {
    const meine = ++laufendeAnfrage.current;
    setOffeneLaeuft(true);
    setOffeneFehler(null);
    api
      .fetchOffeneVorgaenge(account.id, { auchUnbekannte: alle })
      .then((v) => {
        if (meine === laufendeAnfrage.current) setOffene(v);
      })
      .catch((err) => {
        if (meine === laufendeAnfrage.current) setOffeneFehler((err as Error).message);
      })
      .finally(() => {
        if (meine === laufendeAnfrage.current) setOffeneLaeuft(false);
      });
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
  const wartetAufAntwort = offene?.filter((v) => v.art === 'wartetAufAntwort') ?? [];
  const nichtBeantwortet = offene?.filter((v) => v.art === 'nichtBeantwortet') ?? [];

  /** Eine Zeile im unteren Teil - für beide Arten dieselbe Darstellung. */
  const vorgangsZeile = (vorgang: api.OffenerVorgang, knopf: string, tun: () => void) => (
    <div key={`${vorgang.ordner}:${vorgang.uid}`} className="wartend-zeile">
      <div className="wartend-text">
        <button
          className="link-btn wartend-betreff"
          onClick={() => {
            onOeffnen(vorgang.ordner, vorgang.uid);
            onClose();
          }}
        >
          {vorgang.betreff || '(kein Betreff)'}
        </button>
        <span>
          {wer(vorgang.gegenueber)} · {seit(vorgang.tageOffen)}
          {vorgang.umfang > 1 && ` · ${vorgang.umfang} Nachrichten`}
        </span>
      </div>
      <button className="link-btn" onClick={tun}>
        {knopf}
      </button>
    </div>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Offen — {account.email}</h3>

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

        <h4 className="wartend-titel">Liegengeblieben</h4>
        {/* Standardmäßig nur Gespräche mit Bekannten und solche mit Hin und Her - sonst
            steht hier vor allem Versandbestätigung und Rechnung. Wer alles sehen will,
            schaltet es an. */}
        <label className="wartend-schalter">
          <input
            type="checkbox"
            checked={auchUnbekannte}
            onChange={(e) => {
              setAuchUnbekannte(e.target.checked);
              ladeOffene(e.target.checked);
            }}
          />
          Auch einzelne Nachrichten von Unbekannten
        </label>
        {offeneFehler && <div className="error-banner">{offeneFehler}</div>}
        {offeneLaeuft && (
          <div className="empty-state">
            {fortschrittsText(stand, 'Wird durchgesehen…')}
            <span className="fortschritt-hinweis">
              Bei großen Postfächern dauert das einen Moment.
            </span>
          </div>
        )}
        {!offeneLaeuft && !offeneFehler && offene?.length === 0 && (
          <div className="empty-state">Nichts liegengeblieben — alles beantwortet.</div>
        )}

        {wartetAufAntwort.length > 0 && (
          <>
            <div className="wartend-untertitel">Du wartest auf Antwort</div>
            {wartetAufAntwort.map((v) =>
              vorgangsZeile(v, 'Nachfassen', () => {
                onNachfassen(v.gegenueber, v.betreff);
                onClose();
              }),
            )}
          </>
        )}

        {nichtBeantwortet.length > 0 && (
          <>
            <div className="wartend-untertitel">Du hast noch nicht geantwortet</div>
            {nichtBeantwortet.map((v) =>
              vorgangsZeile(v, 'Öffnen', () => {
                onOeffnen(v.ordner, v.uid);
                onClose();
              }),
            )}
          </>
        )}

        <div className="form-row regel-knoepfe">
          <button className="btn secondary" disabled={laeuft || offeneLaeuft} onClick={laden}>
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
