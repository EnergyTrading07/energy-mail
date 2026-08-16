import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';
import { bestaetige } from '../dialoge.js';
import { fortschrittsText, useFortschritt } from '../useFortschritt.js';
import { Fenster } from './Fenster.js';
import { t, tp, zahl } from '../sprache.js';

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
  const stand = useFortschritt(account.id, 'absender', laeuft);
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
    const ja = await bestaetige({
      titel: t('Von „{absender}“ abmelden?', { absender: eintrag.name || eintrag.adresse }),
      text: t(
        'Dabei erfährt der Absender, dass diese Adresse gelesen wird. Bei seriösen Verteilern ist das unproblematisch – bei unerwünschter Werbung von unbekannten Absendern ist Löschen der bessere Weg.',
      ),
      stil: 'warnung',
      /*
       * "Abbestellen" und nicht "Abmelden" - und das ist keine Geschmacksfrage.
       *
       * Hier stand `t('Abmelden')`, und dasselbe Wort steht in der Seitenleiste über dem
       * Knopf, der den Nutzer aus Energy Mail abmeldet. Im Deutschen sind das zwei
       * Bedeutungen desselben Wortes, aus dem Zusammenhang jeweils klar. Da der deutsche
       * Text der Schlüssel ist, waren es aber auch ZWEI STELLEN MIT EINEM Eintrag - und
       * alle sieben Kataloge hatten ihn als "abmelden vom Programm" übersetzt. In der
       * englischen Oberfläche hiess der Knopf, mit dem man einen Newsletter loswird,
       * "Sign out"; im Spanischen "Cerrar sesión", im Türkischen "Oturumu kapat".
       *
       * Gefunden beim Vorbereiten des polnischen Katalogs, wo "wypisz się" (vom Verteiler)
       * und "wyloguj się" (aus dem Programm) sich nicht einmal ähneln. Aufgefallen wäre es
       * sonst nie: Beide Übersetzungen sind für sich genommen richtig, keine Prüfung kann
       * das sehen, und wer die Oberfläche bedient, hält es für einen Schnitzer im Original.
       *
       * Die Lehre gehört zur Bauart: Wo ein deutsches Wort zwei Dinge bedeutet, braucht es
       * zwei Schlüssel. "Abbestellen" ist für einen Verteiler ohnehin das genauere Wort.
       */
      ok: t('Abbestellen'),
    });
    if (!ja) return;

    setBusy(eintrag.adresse);
    setFehler(null);
    try {
      const ergebnis = await api.unsubscribe(account.id, 'INBOX', eintrag.beispielUid);
      if (ergebnis.art === 'im-browser' && ergebnis.ziel) {
        // Eine Seite mit Bestätigung kann nur der Nutzer bedienen.
        window.open(ergebnis.ziel, '_blank');
        setMeldung(t('Die Abmeldeseite wurde geöffnet - dort noch bestätigen.'));
      } else if (ergebnis.art === 'mail') {
        setMeldung(t('Abmeldung an {adresse} geschickt.', { adresse: ergebnis.adresse ?? '' }));
      } else {
        setMeldung(
          ergebnis.erfolg
            ? t('Abgemeldet (Server antwortete mit {status}).', { status: ergebnis.status ?? '' })
            : t(
                'Der Verteiler antwortete mit {status} - die Abmeldung hat vermutlich nicht gegriffen.',
                { status: ergebnis.status ?? '' },
              ),
        );
      }
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const wegraeumen = async (eintrag: api.AbsenderEintrag) => {
    const ja = await bestaetige({
      titel: tp(
        eintrag.gesamt,
        '{anzahl} Nachricht in den Papierkorb?',
        '{anzahl} Nachrichten in den Papierkorb?',
        { anzahl: eintrag.gesamt },
      ),
      text: t(
        'Alles von „{absender}“ wandert in den Papierkorb. Von dort lässt es sich zurückholen, bis der Papierkorb geleert wird.',
        { absender: eintrag.name || eintrag.adresse },
      ),
      stil: 'warnung',
      ok: t('In den Papierkorb'),
    });
    if (!ja) return;

    setBusy(eintrag.adresse);
    setFehler(null);
    try {
      const { verschoben } = await api.moveFromSender(account.id, 'INBOX', eintrag.adresse);
      setMeldung(
        tp(
          verschoben,
          '{anzahl} Nachricht in den Papierkorb verschoben.',
          '{anzahl} Nachrichten in den Papierkorb verschoben.',
          { anzahl: verschoben },
        ),
      );
      onGeaendert();
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Fenster
      titel={t('Postfach aufräumen — {adresse}', { adresse: account.email })}
      onClose={onClose}
      klasse="modal-wide"
    >

      {daten && (
        <p className="hint">
          {t(
            'Aus den jüngsten {stichprobe} Nachrichten ermittelt; die Anzahlen gelten für den gesamten Posteingang ({gesamt} Nachrichten).',
            { stichprobe: zahl(daten.stichprobe), gesamt: zahl(daten.imOrdner) },
          )}
        </p>
      )}

      {fehler && <div className="error-banner">{fehler}</div>}
      {meldung && <div className="regel-vorschau">{meldung}</div>}
      {laeuft && (
        <div className="empty-state">{fortschrittsText(stand, t('Absender werden ermittelt…'))}</div>
      )}

      {daten && !laeuft && (
        <table className="absender-tabelle">
          <thead>
            <tr>
              <th>{t('Absender')}</th>
              <th className="zahl">{t('Nachrichten')}</th>
              <th className="zahl">{t('ungelesen')}</th>
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
                <td className="zahl">{zahl(e.gesamt)}</td>
                <td className="zahl">{zahl(e.ungelesen)}</td>
                <td className="absender-aktionen">
                  <button
                    className="link-btn"
                    disabled={!e.listUnsubscribe || busy !== null}
                    title={
                      e.listUnsubscribe
                        ? e.einKlickAbmeldung
                          ? t('Abmeldung mit einem Klick - der Absender hat das zugesagt')
                          : t('Abmelden über den vom Absender angegebenen Weg')
                        : t('Dieser Absender gibt keinen Abmeldeweg an')
                    }
                    onClick={() => void abmelden(e)}
                  >
                    {busy === e.adresse ? '…' : t('Abbestellen')}
                  </button>
                  <button
                    className="link-btn gefaehrlich"
                    disabled={busy !== null}
                    onClick={() => void wegraeumen(e)}
                  >{t('Alle wegräumen')}</button>
                  <button
                    className="link-btn"
                    disabled={busy !== null}
                    onClick={() => onRegelAnlegen(e.adresse, e.name || e.adresse)}
                  >{t('Regel…')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="form-row regel-knoepfe">
        <button className="btn secondary" disabled={laeuft} onClick={laden}>{t('Neu ermitteln')}</button>
        <button className="link-btn" onClick={onClose}>{t('Schließen')}</button>
      </div>
    </Fenster>
  );
}
