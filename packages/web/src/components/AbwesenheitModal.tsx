import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';

/**
 * Die Abwesenheitsnotiz.
 *
 * ## Je Konto, nicht für alle zusammen
 *
 * Wer geschäftlich und privat dasselbe Programm benutzt, will im Urlaub der Firma
 * antworten und dem Fußballverein nicht. Ein Schalter für alle Konten wäre bequemer und
 * am Bedarf vorbei.
 *
 * ## Was hier ausdrücklich NICHT einstellbar ist
 *
 * Ob auf Zustellberichte, Verteiler, Werbung oder andere Abwesenheitsnotizen geantwortet
 * wird. Das ist keine Geschmacksfrage: Eine Notiz, die einem Zustellbericht antwortet,
 * baut eine Endlosschleife; eine, die einem Verteiler antwortet, erzählt vierhundert
 * Fremden von der Urlaubsplanung. Diese Regeln stehen im Server (abwesenheit.ts) und
 * lassen sich nicht abschalten - ein Kästchen dafür wäre eine Einladung, das Falsche
 * anzukreuzen.
 */

interface Props {
  konten: api.Account[];
  /** Welches Konto beim Öffnen angezeigt wird. */
  startKonto?: string;
  onClose: () => void;
  /** Damit die Seitenleiste ihren Hinweis nachzieht. */
  onGeaendert?: () => void;
}

const LEER: api.Abwesenheit = { aktiv: false, text: '', wiederholungTage: 4 };

export function AbwesenheitModal({ konten, startKonto, onClose, onGeaendert }: Props) {
  const [kontoId, setKontoId] = useState(startKonto ?? konten[0]?.id ?? '');
  const [wert, setWert] = useState<api.Abwesenheit>(LEER);
  const [laedt, setLaedt] = useState(true);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [gesichert, setGesichert] = useState(false);

  useEffect(() => {
    if (!kontoId) return;
    setLaedt(true);
    setGesichert(false);
    api
      .holeAbwesenheit(kontoId)
      .then((a) => {
        setWert({ ...LEER, ...a });
        setFehler(null);
      })
      .catch((err) => setFehler((err as Error).message))
      .finally(() => setLaedt(false));
  }, [kontoId]);

  const aendere = (teil: Partial<api.Abwesenheit>) => {
    setWert((v) => ({ ...v, ...teil }));
    setGesichert(false);
  };

  const speichern = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    setSpeichert(true);
    setFehler(null);
    try {
      const zurueck = await api.speichereAbwesenheit(kontoId, wert);
      setWert({ ...LEER, ...zurueck });
      setGesichert(true);
      onGeaendert?.();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setSpeichert(false);
    }
  };

  const heute = new Date().toISOString().slice(0, 10);

  return (
    <Fenster titel={t('Abwesenheitsnotiz')} onClose={onClose}>
      {fehler && (
        <p className="fehler" role="alert">
          {fehler}
        </p>
      )}

      {konten.length > 1 && (
        <div className="abw-kontowahl">
          <label htmlFor="abw-konto">{t('Konto')}</label>
          <select id="abw-konto" value={kontoId} onChange={(e) => setKontoId(e.target.value)}>
            {konten.map((k) => (
              <option key={k.id} value={k.id}>
                {k.email}
              </option>
            ))}
          </select>
        </div>
      )}

      {laedt ? (
        <p className="hint">{t('Wird geladen…')}</p>
      ) : (
        <form className="abw-form" onSubmit={(e) => void speichern(e)}>
          <label className="abw-schalter">
            <input
              type="checkbox"
              checked={wert.aktiv}
              onChange={(e) => aendere({ aktiv: e.target.checked })}
            />
            <span>{t('Automatisch antworten')}</span>
          </label>

          <div className="abw-zeitraum">
            <div>
              <label htmlFor="abw-von">{t('Von')}</label>
              <input
                id="abw-von"
                type="date"
                value={wert.von ?? ''}
                onChange={(e) => aendere({ von: e.target.value || undefined })}
              />
            </div>
            <div>
              <label htmlFor="abw-bis">{t('Bis einschließlich')}</label>
              <input
                id="abw-bis"
                type="date"
                min={wert.von || heute}
                value={wert.bis ?? ''}
                onChange={(e) => aendere({ bis: e.target.value || undefined })}
              />
            </div>
          </div>
          {/*
            Leere Felder sind erlaubt und bedeuten etwas: kein Von heißt "ab sofort", kein
            Bis heißt "bis ich es ausschalte". Ein Pflichtfeld wäre hier eine Schikane für
            den, der ohnehin gleich zurück ist.
          */}
          <p className="hint">
            {t('Ohne Datum gilt sie sofort und so lange, bis Sie sie ausschalten.')}
          </p>

          <label htmlFor="abw-betreff">{t('Betreff')}</label>
          <input
            id="abw-betreff"
            type="text"
            value={wert.betreff ?? ''}
            placeholder={t('Re: (der ursprüngliche Betreff)')}
            onChange={(e) => aendere({ betreff: e.target.value })}
          />

          <label htmlFor="abw-text">{t('Text')}</label>
          <textarea
            id="abw-text"
            rows={7}
            value={wert.text}
            onChange={(e) => aendere({ text: e.target.value })}
            placeholder={t('Vielen Dank für Ihre Nachricht. Ich bin bis zum … nicht erreichbar und melde mich danach.')}
          />

          <label className="abw-schalter">
            <input
              type="checkbox"
              checked={Boolean(wert.nurBekannte)}
              onChange={(e) => aendere({ nurBekannte: e.target.checked })}
            />
            <span>{t('Nur an Menschen aus meinem Adressbuch')}</span>
          </label>

          <div className="abw-wiederholung">
            <label htmlFor="abw-tage">{t('Derselbe Absender bekommt frühestens wieder eine nach')}</label>
            <input
              id="abw-tage"
              type="number"
              min={0}
              max={90}
              value={wert.wiederholungTage ?? 4}
              onChange={(e) => aendere({ wiederholungTage: Number(e.target.value) })}
            />
            <span>{t('Tagen')}</span>
          </div>

          {/*
            Der Satz, der niemanden überraschen soll.

            Diese Notiz hängt an der Postfachüberwachung dieses Dienstes, nicht am Server
            des Anbieters. Ist der Dienst aus, antwortet niemand - und das erfährt man
            besser hier als hinterher.
          */}
          <p className="hint abw-hinweis">
            {t('Antworten gehen hinaus, solange Energy Mail läuft. Auf Zustellberichte, Verteiler und Werbung wird nie geantwortet, und niemand bekommt zweimal dieselbe Notiz.')}
          </p>

          <div className="abw-knoepfe">
            <button className="btn" type="submit" disabled={speichert}>
              {speichert ? t('Wird gespeichert…') : t('Speichern')}
            </button>
            {gesichert && <span className="abw-gesichert">{t('Gespeichert')}</span>}
          </div>
        </form>
      )}
    </Fenster>
  );
}
