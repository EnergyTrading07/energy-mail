import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { t } from '../sprache.js';

/**
 * Wie dieses Konto mit angeforderten Lesebestätigungen umgeht.
 *
 * Drei Möglichkeiten, und die Vorgabe ist die mittlere. „Nie" wäre bevormundend - im
 * Geschäftsleben wird die Bestätigung erwartet, und wer sie nie schickt, bekommt
 * Rückfragen. „Immer" wäre eine Auskunft über den Nutzer, die er nie erlaubt hat: wann er
 * am Rechner saß, und zwar an jeden, der danach fragt. Bleibt „fragen" - es kostet einen
 * Klick, und der Klick ist die Entscheidung.
 */

interface Props {
  kontoId: string;
}

export function LesebestaetigungTeil({ kontoId }: Props) {
  const [umgang, setUmgang] = useState<'nie' | 'fragen' | 'immer'>('fragen');
  const [laeuft, setLaeuft] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    setLaeuft(true);
    api
      .holeLesebestaetigung(kontoId)
      .then((a) => setUmgang(a.umgang))
      .catch((err) => setFehler((err as Error).message))
      .finally(() => setLaeuft(false));
  }, [kontoId]);

  const waehle = (wert: 'nie' | 'fragen' | 'immer') => {
    const vorher = umgang;
    setUmgang(wert);
    setFehler(null);
    api.setzeLesebestaetigung(kontoId, wert).catch((err) => {
      setUmgang(vorher);
      setFehler((err as Error).message);
    });
  };

  const wahl: [('nie' | 'fragen' | 'immer'), string, string][] = [
    ['nie', t('Nie senden'), t('Niemand erfährt, wann Sie eine Nachricht geöffnet haben.')],
    ['fragen', t('Jedes Mal fragen'), t('Ein Band über der Nachricht, ein Klick.')],
    [
      'immer',
      t('Immer senden'),
      t('Ohne Rückfrage – außer wenn die Bestätigung an jemand anderen als den Absender ginge.'),
    ],
  ];

  return (
    <div className="form-row lesebest-teil">
      <label>{t('Angeforderte Lesebestätigungen')}</label>
      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}
      <div className="lesebest-wahl">
        {wahl.map(([wert, wort, erklaerung]) => (
          <label key={wert} title={erklaerung}>
            <input
              type="radio"
              name={`lesebest-${kontoId}`}
              checked={umgang === wert}
              disabled={laeuft}
              onChange={() => waehle(wert)}
            />
            <span>{wort}</span>
          </label>
        ))}
      </div>
      {/*
        Der Satz, der den Wert der ganzen Sache einordnet - und er gehört hierher, weil
        genau hier jemand überlegt, ob er "immer" einstellt.
      */}
      <p className="hint">
        {t('Eine Lesebestätigung sagt nur, dass die Nachricht auf einem Bildschirm stand – nicht, dass jemand sie gelesen hat. Auf Werbung, Verteiler und maschinelle Post wird nie geantwortet.')}
      </p>
    </div>
  );
}
