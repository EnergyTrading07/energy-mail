import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { bestaetige } from '../dialoge.js';
import { t } from '../sprache.js';

/**
 * Wer dieses Postfach außer mir noch lesen darf.
 *
 * Sitzt in den Einstellungen des Kontos und nicht in einem eigenen Fenster: Freigeben ist
 * eine Eigenschaft dieses einen Postfachs, und wer sie sucht, sucht sie dort, wo auch
 * Name und Signatur stehen.
 *
 * ## Der Satz, der hier stehen muss
 *
 * Eine Freigabe ist nicht rückholbar in dem Sinne, in dem Menschen das erwarten. Wer drei
 * Wochen lang mitgelesen hat, hat drei Wochen lang mitgelesen; das Zurücknehmen beendet
 * den Zugang, nicht das Wissen. Deshalb steht die Rückfrage vor dem Freigeben und nicht
 * nur vor dem Beenden.
 */

interface Props {
  kontoId: string;
  /** Die eigene Adresse - für den Hinweis, an wen man gerade verschenkt. */
  email: string;
}

export function FreigabeTeil({ kontoId, email }: Props) {
  const [liste, setListe] = useState<api.Freigabe[]>([]);
  const [an, setAn] = useState('');
  const [rechte, setRechte] = useState<'lesen' | 'voll'>('lesen');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = () => {
    api
      .holeFreigaben()
      .then((a) => setListe(a.eigene.filter((f) => f.kontoId === kontoId)))
      .catch((err) => setFehler((err as Error).message));
  };

  useEffect(laden, [kontoId]);

  const freigeben = async () => {
    const ziel = an.trim();
    if (!ziel) return;
    const ja = await bestaetige({
      titel: t('{ziel} Zugriff auf {postfach} geben?', { ziel, postfach: email }),
      text:
        rechte === 'voll'
          ? t('Diese Person kann dann Ihre Post lesen, verschieben, löschen und in Ihrem Namen senden. Gesendetes trägt einen Vermerk „im Auftrag von“.')
          : t('Diese Person kann dann Ihre gesamte Post in diesem Postfach lesen – auch das, was vor der Freigabe angekommen ist. Zurücknehmen beendet den Zugang, nicht das Gelesene.'),
      stil: 'warnung',
      ok: t('Freigeben'),
    });
    if (!ja) return;

    setLaeuft(true);
    setFehler(null);
    try {
      await api.freigeben(kontoId, ziel, rechte);
      setAn('');
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  const beenden = async (freigabe: api.Freigabe) => {
    setLaeuft(true);
    setFehler(null);
    try {
      await api.freigabeBeenden(freigabe.id);
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="form-row freigabe-teil">
      <label>{t('Für andere freigeben')}</label>
      <p className="hint">
        {t('Ein Kollege sieht dieses Postfach dann in seiner eigenen Seitenleiste – gekennzeichnet, und nur dieses eine.')}
      </p>

      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      {liste.length > 0 && (
        <ul className="freigabe-liste">
          {liste.map((f) => (
            <li key={f.id}>
              <span className="freigabe-wer">{f.an}</span>
              <span className={`freigabe-recht${f.rechte === 'lesen' ? ' nur-lesen' : ''}`}>
                {f.rechte === 'lesen' ? t('nur lesen') : t('voller Zugriff')}
              </span>
              <button
                type="button"
                className="link-btn"
                disabled={laeuft}
                onClick={() => void beenden(f)}
              >
                {t('Beenden')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="form-row identitaet-neu">
        <input
          value={an}
          onChange={(e) => setAn(e.target.value)}
          placeholder={t('Adresse des Kollegen bei Energy Mail')}
          aria-label={t('An wen freigeben')}
          disabled={laeuft}
        />
        <select
          value={rechte}
          onChange={(e) => setRechte(e.target.value as 'lesen' | 'voll')}
          aria-label={t('Rechte')}
          disabled={laeuft}
        >
          <option value="lesen">{t('nur lesen')}</option>
          <option value="voll">{t('voller Zugriff')}</option>
        </select>
        <button
          type="button"
          className="btn secondary"
          disabled={laeuft || !an.trim()}
          onClick={() => void freigeben()}
        >
          {t('Freigeben')}
        </button>
      </div>
      {/*
        Der Satz gehört hierher und nicht in ein Hilfedokument: Es ist die eine Auskunft,
        nach der später jemand fragt, und dann ist es zu spät.
      */}
      <p className="hint">
        {t('Es geht nur um dieses Postfach – nicht um Ihre anderen Konten, Ihr Adressbuch oder Ihre Einstellungen. Jede Freigabe steht im Protokoll.')}
      </p>
    </div>
  );
}
