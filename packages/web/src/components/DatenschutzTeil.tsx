import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { meldeErfolg, meldeFehler } from '../meldungen.js';
import { t } from '../sprache.js';

/**
 * Datenschutz - was hier läuft und welche Papiere daraus folgen.
 *
 * ## Warum der Befund vor dem Formular steht
 *
 * Weil er die Antwort ist, die niemand sonst gibt. Wer nach Datenschutzunterlagen sucht,
 * findet überall Vorlagen und nirgends die Auskunft, welche davon er wirklich braucht -
 * und welche er sich sparen kann. Genau die steht hier oben, für diesen Betrieb, aus
 * seinen eigenen Zahlen.
 *
 * Die vier Fragen darunter sind die einzigen, die ein Programm nicht selbst beantworten
 * kann: Wer betreibt den Server, kommt jemand von außen heran, gibt es einen Betriebsrat,
 * sind die Nutzer Beschäftigte. Alles andere - wie viele Nutzer, welche Anbieter, ob das
 * Archiv läuft - wird abgelesen.
 */

export function DatenschutzTeil() {
  const [lage, setLage] = useState<api.Datenschutzlage | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offen, setOffen] = useState(false);

  const laden = async () => {
    try {
      setLage(await api.ladeDatenschutz());
    } catch (err) {
      setFehler((err as Error).message);
    }
  };
  useEffect(() => {
    void laden();
  }, []);

  const aendere = async (teil: Partial<api.DatenschutzAngaben>) => {
    setBusy(true);
    try {
      setLage(await api.speichereDatenschutz(teil));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const erzeugen = async () => {
    setBusy(true);
    try {
      const ergebnis = await api.erzeugeDatenschutzUnterlagen();
      meldeErfolg(
        t('Unterlagen erzeugt'),
        t('{anzahl} Dateien liegen in {ordner}', {
          anzahl: String(ergebnis.dateien.length),
          ordner: ergebnis.ordner,
        }),
      );
    } catch (err) {
      meldeFehler(t('Nicht erzeugt'), (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /*
   * Erst zeichnen, wenn wirklich alle drei Teile da sind.
   *
   * Vorher stand hier nur `if (!lage)`, und das genügte nicht: Eine Antwort, der ein Feld
   * fehlt - ein Server aus einer älteren Fassung, ein Vorbau, der etwas dazwischenschiebt -
   * ist ein Objekt und damit wahr. Das Fenster lief dann in `befund.verantwortlicher` und
   * riss die ganze Verwaltung mit; die Nutzerliste daneben war ebenfalls weg. Aufgefallen
   * ist es der Prüfung des Verwaltungsfensters, die diesen Weg gar nicht meinte.
   */
  if (!lage?.befund || !lage.erhoben || !lage.angaben) {
    return (
      <div className="form-row">
        <label>{t('Datenschutz')}</label>
        {fehler ? <p className="hint hinweis-fehler">{fehler}</p> : <p className="hint">{t('Wird geladen…')}</p>}
      </div>
    );
  }

  const { angaben: a, erhoben: e, befund } = lage;

  return (
    <div className="form-row datenschutz-teil">
      <label>{t('Datenschutz')}</label>
      <p className="hint">
        {t(
          'Welche Unterlagen dieser Betrieb wirklich braucht – und welche nicht. Abgeleitet aus dem, was hier tatsächlich läuft.',
        )}
      </p>
      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      <div className="datenschutz-befund">
        <h5>{t('Verantwortlich')}</h5>
        <p>{befund.verantwortlicher}</p>

        <h5>{t('Verarbeitet im Auftrag')}</h5>
        {befund.auftragsverarbeiter.length === 0 ? (
          <p className="hint">{t('Niemand.')}</p>
        ) : (
          <ul>
            {befund.auftragsverarbeiter.map((v) => (
              <li key={v.wer}>
                <strong>{v.wer}</strong> — {v.weil}
              </li>
            ))}
          </ul>
        )}

        {/*
          Die nützlichste Liste des ganzen Fensters. Sie verhindert Papiere, die nichts
          regeln - und lenkt die Mühe dorthin, wo sie gebraucht wird.
        */}
        {befund.keineAuftragsverarbeitung.length > 0 && (
          <>
            <h5>{t('Ausdrücklich KEIN Auftragsverarbeiter')}</h5>
            <ul>
              {befund.keineAuftragsverarbeitung.map((v) => (
                <li key={v.wer}>
                  <strong>{v.wer}</strong> — {v.weil}
                </li>
              ))}
            </ul>
          </>
        )}

        <h5>{t('Was zu bedenken ist')}</h5>
        <ul>
          {befund.hinweise.map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      </div>

      <p className="hint">
        {t(
          'Abgelesen: {nutzer} Nutzer, davon {zweiFaktor} mit zweitem Faktor · {konten} Postfächer bei {anbieter} · {freigaben} Freigaben',
          {
            nutzer: String(e.nutzer),
            zweiFaktor: String(e.mitZweiFaktor),
            konten: String(e.konten),
            anbieter: e.postfachanbieter.join(', ') || '—',
            freigaben: String(e.freigaben),
          },
        )}
      </p>

      <button className="link-btn" onClick={() => setOffen((v) => !v)} aria-expanded={offen}>
        {offen ? t('Angaben verbergen') : t('Angaben zum Betrieb')}
      </button>

      {offen && (
        <>
          <div className="verzeichnis-zeile">
            <div>
              <label htmlFor="ds-betrieb">{t('Betrieb')}</label>
              <input
                id="ds-betrieb"
                defaultValue={a.betrieb ?? ''}
                onBlur={(ev) => void aendere({ betrieb: ev.target.value })}
              />
            </div>
            <div>
              <label htmlFor="ds-anschrift">{t('Anschrift')}</label>
              <input
                id="ds-anschrift"
                defaultValue={a.anschrift ?? ''}
                onBlur={(ev) => void aendere({ anschrift: ev.target.value })}
              />
            </div>
            <div>
              <label htmlFor="ds-dsb">{t('Datenschutzbeauftragter')}</label>
              <input
                id="ds-dsb"
                defaultValue={a.datenschutzbeauftragter ?? ''}
                onBlur={(ev) => void aendere({ datenschutzbeauftragter: ev.target.value })}
              />
            </div>
          </div>

          <label className="verzeichnis-schalter">
            <input
              type="checkbox"
              checked={a.beschaeftigte}
              onChange={(ev) => void aendere({ beschaeftigte: ev.target.checked })}
            />
            <span>{t('Die Nutzer sind Beschäftigte dieses Betriebs')}</span>
          </label>

          <label className="verzeichnis-schalter">
            <input
              type="checkbox"
              checked={a.betriebsrat}
              onChange={(ev) => void aendere({ betriebsrat: ev.target.checked })}
            />
            <span>{t('Es besteht ein Betriebsrat')}</span>
          </label>

          <label className="verzeichnis-schalter">
            <input
              type="checkbox"
              checked={a.betreiber === 'dienstleister'}
              onChange={(ev) =>
                void aendere({ betreiber: ev.target.checked ? 'dienstleister' : 'selbst' })
              }
            />
            <span>{t('Ein Dienstleister betreibt den Server')}</span>
          </label>
          {a.betreiber === 'dienstleister' && (
            <input
              placeholder={t('Name des Dienstleisters')}
              defaultValue={a.dienstleister ?? ''}
              onBlur={(ev) => void aendere({ dienstleister: ev.target.value })}
            />
          )}

          <label className="verzeichnis-schalter">
            <input
              type="checkbox"
              checked={a.fernwartung}
              onChange={(ev) => void aendere({ fernwartung: ev.target.checked })}
            />
            <span>{t('Jemand von außen kann zu Wartungszwecken an die Daten')}</span>
          </label>
          {a.fernwartung && (
            <input
              placeholder={t('Wer wartet aus der Ferne?')}
              defaultValue={a.fernwarter ?? ''}
              onBlur={(ev) => void aendere({ fernwarter: ev.target.value })}
            />
          )}
          {/*
            Der Satz, an dem sich der ganze Befund dreht - und der in Prospekten fehlt:
            Es kommt nicht darauf an, ob jemand hineinsieht, sondern ob er könnte.
          */}
          <p className="hint">
            {t(
              'Entscheidend ist die Möglichkeit, nicht die Absicht: Wer im Störungsfall an die Daten herankommt, ist Auftragsverarbeiter – auch wenn er nie hineinsieht.',
            )}
          </p>
        </>
      )}

      <div className="verzeichnis-knoepfe">
        <button type="button" className="btn" disabled={busy} onClick={() => void erzeugen()}>
          {t('Unterlagen erzeugen')}
        </button>
      </div>
      <p className="hint fein">
        {t(
          'Kein Rechtsrat. Die Regelfälle sind abgedeckt; bei Beschäftigtendaten, einem Betriebsrat und Übermittlungen in Drittländer gehört ein Mensch darüber, bevor etwas unterschrieben wird.',
        )}
      </p>
    </div>
  );
}
