import { useEffect, useState } from 'react';
import type { FolderInfo, Regel } from '@energy-mail/mail-core';
import * as api from '../api.js';
import type { Account } from '../api.js';
import { bestaetige } from '../dialoge.js';
import { meldeErfolg, meldeHinweis } from '../meldungen.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';

/**
 * Verwaltung der Regeln eines Kontos.
 *
 * Vor dem Speichern lässt sich vorführen, wie viele Nachrichten eine Bedingung träfe.
 * Das ist der wichtigste Teil der Bedienung: eine Regel, die versehentlich achttausend
 * Nachrichten verschiebt, merkt man sonst erst hinterher - und dann ist es getan.
 */

interface Props {
  account: Account;
  folders: FolderInfo[];
  onClose: () => void;
  /** Nach dem Anwenden auf einen Ordner: Liste und Zähler auffrischen. */
  onGeaendert: () => void;
  /**
   * Vorbelegung aus dem Aufräumen: dort steht der Absender bereits fest, und die Regel
   * soll sich mit einem Klick anschließen lassen.
   */
  vorgabe?: { von: string; name: string };
}

const LEER: Omit<Regel, 'id'> = {
  name: '',
  aktiv: true,
  bedingungen: {},
  aktionen: {},
};

export function RulesModal({ account, folders, onClose, onGeaendert, vorgabe }: Props) {
  const [regeln, setRegeln] = useState<Regel[]>([]);
  const [entwurf, setEntwurf] = useState<(Omit<Regel, 'id'> & { id?: string }) | null>(
    vorgabe
      ? {
          ...LEER,
          name: `${vorgabe.name} einsortieren`,
          bedingungen: { von: vorgabe.von },
        }
      : null,
  );
  const [vorschau, setVorschau] = useState<api.RegelVorschau | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = () => api.fetchRules(account.id).then(setRegeln).catch(() => setRegeln([]));
  useEffect(() => {
    void laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  const ziele = folders.filter((f) => f.selectable && !f.isAllMail);

  const setzeBedingung = (feld: keyof Regel['bedingungen'], wert: string | boolean) =>
    setEntwurf((e) =>
      e ? { ...e, bedingungen: { ...e.bedingungen, [feld]: wert || undefined } } : e,
    );
  const setzeAktion = (feld: keyof Regel['aktionen'], wert: string | boolean) =>
    setEntwurf((e) => (e ? { ...e, aktionen: { ...e.aktionen, [feld]: wert || undefined } } : e));

  const speichern = async () => {
    if (!entwurf) return;
    setBusy(true);
    setFehler(null);
    try {
      await api.saveRule(account.id, entwurf);
      setEntwurf(null);
      setVorschau(null);
      await laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const vorfuehren = async () => {
    if (!entwurf) return;
    setBusy(true);
    setFehler(null);
    try {
      setVorschau(await api.previewRule(account.id, entwurf.bedingungen));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const anwenden = async () => {
    const ja = await bestaetige({
      titel: t('Regeln jetzt anwenden?'),
      text: t(
        'Alle aktiven Regeln laufen über die neuesten 200 Nachrichten des Posteingangs. Nachrichten werden dabei verschoben, markiert oder als gelesen gesetzt.',
      ),
      stil: 'warnung',
      ok: t('Anwenden'),
    });
    if (!ja) return;

    setBusy(true);
    setFehler(null);
    try {
      const ergebnis = await api.applyRules(account.id, 'INBOX');
      // Als Meldung und nicht als Fenster: hier ist nichts zu entscheiden, es wird nur
      // berichtet - und wer weiterarbeiten will, soll dafür nichts wegklicken müssen.
      if (ergebnis.betroffen === 0) {
        meldeHinweis(
          t('Keine Regel hat gegriffen'),
          t('Keine der {geprueft} geprüften Nachrichten passte auf eine Regel.', {
            geprueft: ergebnis.geprueft,
          }),
        );
      } else {
        meldeErfolg(
          t('{betroffen} von {geprueft} Nachrichten bearbeitet', {
            betroffen: ergebnis.betroffen,
            geprueft: ergebnis.geprueft,
          }),
          ergebnis.schritte.join(' · '),
        );
      }
      onGeaendert();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const beschreibe = (regel: Regel): string => {
    const b = regel.bedingungen;
    const wenn = [
      b.von && t('Absender enthält „{wert}“', { wert: b.von }),
      b.betreff && t('Betreff enthält „{wert}“', { wert: b.betreff }),
      b.an && t('Empfänger enthält „{wert}“', { wert: b.an }),
      b.listId && t('Verteiler enthält „{wert}“', { wert: b.listId }),
      b.nurRundmail && t('es eine Rundmail ist'),
    ].filter(Boolean);

    const a = regel.aktionen;
    const dann = [
      a.verschiebeNach && t('nach „{ordner}“ verschieben', { ordner: a.verschiebeNach }),
      a.alsGelesen && t('als gelesen markieren'),
      a.markieren && t('markieren'),
      a.inDenPapierkorb && t('in den Papierkorb'),
    ].filter(Boolean);

    /*
     * Der Rahmen und die Teilstücke getrennt übersetzt.
     *
     * Ein Satz, der sich aus Bedingungen und Folgen zusammensetzt, lässt sich nicht als
     * Ganzes in den Katalog schreiben - es gibt zu viele Kombinationen. Was geht: jedes
     * Teilstück für sich, und der Rahmen mit Platzhaltern. So kann eine Sprache mit
     * anderer Wortstellung wenigstens den Rahmen umbauen.
     */
    return t('Wenn {wenn}, dann {dann}.', {
      wenn: wenn.join(t(' und ')),
      dann: dann.join(t(' und ')),
    });
  };

  return (
    <Fenster
      titel={t('Regeln für {adresse}', { adresse: account.email })}
      onClose={onClose}
      klasse="modal-wide"
    >
      <p className="hint">
        {t(
          'Regeln greifen, sobald neue Post eintrifft. Für bereits vorhandene Nachrichten lassen sie sich unten von Hand anwenden.',
        )}
      </p>

      {fehler && <div className="error-banner">{fehler}</div>}

      {regeln.length === 0 && !entwurf && (
        <div className="empty-state">{t('Noch keine Regeln angelegt.')}</div>
      )}

      {regeln.map((regel) => (
        <div key={regel.id} className={`regel-zeile${regel.aktiv ? '' : ' inaktiv'}`}>
          <label className="regel-schalter" title={regel.aktiv ? t('Regel ist aktiv') : t('Regel ruht')}>
            <input
              type="checkbox"
              checked={regel.aktiv}
              onChange={async (e) => {
                await api.saveRule(account.id, { ...regel, aktiv: e.target.checked });
                await laden();
              }}
            />
          </label>
          <div className="regel-text">
            <strong>{regel.name}</strong>
            <span>{beschreibe(regel)}</span>
          </div>
          <button className="link-btn" onClick={() => setEntwurf(regel)}>{t('Bearbeiten')}</button>
          <button
            className="link-btn gefaehrlich"
            onClick={async () => {
              const ja = await bestaetige({
                titel: t('Regel „{name}“ löschen?', { name: regel.name }),
                text: t(
                  'Bereits verschobene Nachrichten bleiben, wo sie sind – die Regel greift nur künftig nicht mehr.',
                ),
                stil: 'gefahr',
                ok: t('Regel löschen'),
              });
              if (!ja) return;
              await api.deleteRule(account.id, regel.id);
              await laden();
            }}
          >{t('Löschen')}</button>
        </div>
      ))}

      {entwurf ? (
        <div className="regel-form">
          <div className="form-row">
            <input
              type="text"
              placeholder={t('Name der Regel, z.B. „Pinterest wegsortieren“')}
              value={entwurf.name}
              onChange={(e) => setEntwurf({ ...entwurf, name: e.target.value })}
            />
          </div>

          <div className="regel-block">
            <strong>{t('Wenn …')}</strong>
            <label>
              <span>{t('Absender')}</span>
              <input
                type="text"
                placeholder={t('enthält…')}
                value={entwurf.bedingungen.von ?? ''}
                onChange={(e) => setzeBedingung('von', e.target.value)}
              />
            </label>
            <label>
              <span>{t('Betreff')}</span>
              <input
                type="text"
                placeholder="enthält…"
                value={entwurf.bedingungen.betreff ?? ''}
                onChange={(e) => setzeBedingung('betreff', e.target.value)}
              />
            </label>
            <label>
              <span>{t('Empfänger')}</span>
              <input
                type="text"
                placeholder="enthält…"
                value={entwurf.bedingungen.an ?? ''}
                onChange={(e) => setzeBedingung('an', e.target.value)}
              />
            </label>
            <label className="regel-kasten">
              <input
                type="checkbox"
                checked={Boolean(entwurf.bedingungen.nurRundmail)}
                onChange={(e) => setzeBedingung('nurRundmail', e.target.checked)}
              />
              nur Rundmails (erkennbar an der Abmelde-Kopfzeile)
            </label>
            <p className="hint">{t('Alles Angegebene muss zutreffen.')}</p>
          </div>

          <div className="regel-block">
            <strong>… dann</strong>
            <label>
              <span>{t('Verschieben')}</span>
              <select
                value={entwurf.aktionen.verschiebeNach ?? ''}
                onChange={(e) => setzeAktion('verschiebeNach', e.target.value)}
              >
                <option value="">(nicht verschieben)</option>
                {ziele.map((f) => (
                  <option key={f.path} value={f.path}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="regel-kasten">
              <input
                type="checkbox"
                checked={Boolean(entwurf.aktionen.alsGelesen)}
                onChange={(e) => setzeAktion('alsGelesen', e.target.checked)}
              />
              als gelesen markieren
            </label>
            <label className="regel-kasten">
              <input
                type="checkbox"
                checked={Boolean(entwurf.aktionen.markieren)}
                onChange={(e) => setzeAktion('markieren', e.target.checked)}
              />
              markieren
            </label>
            <label className="regel-kasten">
              <input
                type="checkbox"
                checked={Boolean(entwurf.aktionen.inDenPapierkorb)}
                onChange={(e) => setzeAktion('inDenPapierkorb', e.target.checked)}
              />
              in den Papierkorb
            </label>
          </div>

          {vorschau && (
            <div className="regel-vorschau">
              <strong>
                {vorschau.treffer} von {vorschau.geprueft} geprüften Nachrichten würden
                zutreffen
              </strong>
              {vorschau.beispiele.map((b, i) => (
                <div key={i}>
                  {b.from} — {b.subject}
                </div>
              ))}
            </div>
          )}

          <div className="form-row regel-knoepfe">
            <button className="btn secondary" disabled={busy} onClick={() => void vorfuehren()}>{t('Vorführen')}</button>
            <button className="btn" disabled={busy || !entwurf.name.trim()} onClick={() => void speichern()}>{t('Speichern')}</button>
            <button
              className="link-btn"
              onClick={() => {
                setEntwurf(null);
                setVorschau(null);
              }}
            >{t('Abbrechen')}</button>
          </div>
        </div>
      ) : (
        <div className="form-row regel-knoepfe">
          <button className="btn" onClick={() => setEntwurf({ ...LEER })}>
            + Regel anlegen
          </button>
          {regeln.some((r) => r.aktiv) && (
            <button className="btn secondary" disabled={busy} onClick={() => void anwenden()}>{t('Auf Posteingang anwenden')}</button>
          )}
          <button className="link-btn" onClick={onClose}>{t('Schließen')}</button>
        </div>
      )}
    </Fenster>
  );
}
