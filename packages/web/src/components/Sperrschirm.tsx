import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { Marke } from './Symbole.js';
import { t } from '../sprache.js';

/**
 * Der Sperrschirm.
 *
 * ## Warum er ÜBER der Anwendung liegt und nicht an ihrer Stelle
 *
 * Weil sonst der halb geschriebene Brief weg wäre. Die Anwendung bleibt eingehängt, ihr
 * Zustand bleibt stehen - Entwurf, Auswahl, gescrollte Stelle -, und darüber liegt eine
 * undurchsichtige Fläche. Wer sein Kennwort eingibt, ist wieder genau dort, wo er war.
 *
 * Deshalb heißt die Antwort des Servers auch 423 und nicht 401: 401 hieße "melde dich an",
 * und die Weiche in main.tsx würde die ganze Anwendung abräumen.
 *
 * ## Warum undurchsichtig und nicht nur verwischt
 *
 * Ein Weichzeichner sieht besser aus und ist zwecklos: Ein Betreff in großer Schrift bleibt
 * durch jede Unschärfe lesbar, und wer den Bildschirm abfotografiert, hat ihn scharf. Hier
 * geht es darum, dass nichts mehr zu sehen ist.
 *
 * ## Was er NICHT ist
 *
 * Kein Ersatz für die Sperre am Server. Diese Fläche ist eine Fläche im Browser; wer die
 * Entwicklerwerkzeuge öffnet, hat sie weg. Der Schutz liegt darin, dass der Server jede
 * Anfrage mit 423 beantwortet - siehe nutzer/haken.ts. Was hier steht, sorgt nur dafür,
 * dass auf dem Bildschirm nichts stehen bleibt.
 */

interface Props {
  /** Die Adresse dessen, der aufschließen kann - damit klar ist, wessen Kennwort gefragt ist. */
  adresse?: string;
  /** Aufgeschlossen: die Anwendung darf ihre Daten neu holen. */
  onOffen: () => void;
}

export function Sperrschirm({ adresse, onOffen }: Props) {
  const [kennwort, setKennwort] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const feld = useRef<HTMLInputElement>(null);

  // Der Fokus gehört ins Feld: wer hier landet, will tippen und nicht erst klicken.
  useEffect(() => {
    feld.current?.focus();
  }, []);

  const abschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;
    setFehler('');
    setLaeuft(true);
    try {
      await api.sperreOeffnen(kennwort);
      setKennwort('');
      onOffen();
    } catch (err) {
      setFehler((err as Error).message);
      setKennwort('');
      feld.current?.focus();
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="sperrschirm" role="dialog" aria-modal="true" aria-label={t('Gesperrt')}>
      <form className="sperrschirm-kasten" onSubmit={(e) => void abschicken(e)}>
        <Marke groesse={44} />
        <h1>{t('Gesperrt')}</h1>
        <p className="hint">
          {adresse
            ? t('Geben Sie das Kennwort für {adresse} ein, um weiterzuarbeiten.', { adresse })
            : t('Geben Sie Ihr Kennwort ein, um weiterzuarbeiten.')}
        </p>
        <input
          ref={feld}
          type="password"
          value={kennwort}
          onChange={(e) => setKennwort(e.target.value)}
          placeholder={t('Kennwort')}
          aria-label={t('Kennwort')}
          autoComplete="current-password"
        />
        {fehler && (
          <p className="fehler" role="alert">
            {fehler}
          </p>
        )}
        <button className="btn" type="submit" disabled={laeuft || !kennwort}>
          {laeuft ? t('Wird geprüft…') : t('Entsperren')}
        </button>
        <p className="hint fein">
          {t('Ihre offenen Fenster bleiben erhalten – auch ein begonnener Entwurf.')}
        </p>
      </form>
    </div>
  );
}
