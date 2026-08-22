import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { datum, t } from '../sprache.js';

/**
 * Die Desktop-Fassung bereitstellen - für den Verwalter.
 *
 * Diese Ansicht kann nichts hochladen, und das ist Absicht. Sie zeigt, WOHIN die Datei
 * gehört, und was dort liegt; hineingelegt wird sie über den Weg, den der Betreiber
 * ohnehin hat.
 *
 * Der Grund steht ausführlich in server/download.ts: Eine Route, über die sich
 * ausführbare Dateien auf den Server schreiben lassen, wäre das Gefährlichste, was
 * dieser Dienst anbieten könnte - ein übernommenes Verwalterkonto wäre damit die
 * Erlaubnis, an alle Arbeitsplätze des Betriebs ein eigenes Programm zu verteilen.
 */

export function DownloadVerwaltungTeil() {
  const [stand, setStand] = useState<api.Downloadverwaltung | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [kopiert, setKopiert] = useState(false);

  /**
   * Bringt die Antwort auf eine Form, mit der sich zeichnen lässt.
   *
   * Dieselbe Vorkehrung wie im Registrierungsteil daneben, und aus demselben Grund: Der
   * Teil hängt IN der Nutzerverwaltung. Wirft er beim ersten Zeichnen, ist nicht nur er
   * weg, sondern das ganze Fenster - samt Nutzerliste. Eine Antwort ohne `endungen` kommt
   * tatsächlich vor: im Browser, wenn die Oberfläche aus dem Zwischenspeicher stammt und
   * der Server inzwischen ein anderer ist.
   */
  const zurechtlegen = (a: Partial<api.Downloadverwaltung>): api.Downloadverwaltung => ({
    ordner: typeof a.ordner === 'string' ? a.ordner : '',
    vorhanden: a.vorhanden === true,
    endungen: Array.isArray(a.endungen) ? a.endungen : [],
    dateien: Array.isArray(a.dateien) ? a.dateien : [],
  });

  const laden = () => {
    api
      .verwaltungDownload()
      .then((antwort) => setStand(zurechtlegen(antwort ?? {})))
      .catch((err) => setFehler((err as Error).message));
  };

  useEffect(laden, []);

  return (
    <div className="form-row anmeldeverwaltung-teil">
      <label>{t('Desktop-Fassung bereitstellen')}</label>
      <p className="hint">
        {t('Legen Sie die Installationsdatei in diesen Ordner. Ihre Nutzer finden sie danach unter Einstellungen → Für den Rechner und laden sie von hier statt aus dem Netz.')}
      </p>
      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      {stand && !stand.ordner && (
        <p className="hint">{t('Dieser Server nennt keinen Ordner – vermutlich ist er älter als diese Oberfläche.')}</p>
      )}

      {stand && stand.ordner && (
        <>
          <div className="download-ordner">
            <code>{stand.ordner}</code>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                void navigator.clipboard
                  .writeText(stand.ordner)
                  .then(() => setKopiert(true))
                  .catch(() => undefined);
              }}
            >
              {kopiert ? t('Kopiert') : t('Pfad kopieren')}
            </button>
          </div>

          {!stand.vorhanden && (
            <p className="hint">
              {t('Diesen Ordner gibt es noch nicht – legen Sie ihn an und kopieren Sie die Datei hinein.')}
            </p>
          )}

          <p className="hint fein">
            {t('Ausgeliefert wird nur, was auf eine dieser Endungen lautet: {endungen}', {
              endungen: stand.endungen.join(' '),
            })}
          </p>

          {stand.dateien.length > 0 ? (
            <table className="verwaltung-tabelle anmeldeverwaltung-tabelle">
              <thead>
                <tr>
                  <th>{t('Datei')}</th>
                  <th>{t('System')}</th>
                  <th>{t('Größe')}</th>
                  <th>{t('Stand')}</th>
                </tr>
              </thead>
              <tbody>
                {stand.dateien.map((d) => (
                  <tr key={d.name}>
                    <td>{d.name}</td>
                    <td>{d.system}</td>
                    <td>{Math.max(1, Math.round(d.groesse / (1024 * 1024)))} MB</td>
                    <td>{datum(new Date(d.stand))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            stand.vorhanden && (
              <p className="hint">{t('Der Ordner ist leer – es wird nichts angeboten.')}</p>
            )
          )}

          <div className="anmeldeverwaltung-knoepfe">
            <button type="button" className="btn still" onClick={laden}>
              {t('Neu einlesen')}
            </button>
          </div>

          <p className="hint fein">
            {t('Hochladen geht hier bewusst nicht: Ein Weg, über den sich ausführbare Dateien auf den Server schreiben lassen, wäre aus einem übernommenen Verwalterkonto heraus die Erlaubnis, an alle Arbeitsplätze ein fremdes Programm zu verteilen.')}
          </p>
        </>
      )}
    </div>
  );
}
