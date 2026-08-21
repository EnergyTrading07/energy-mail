import { useEffect, useState } from 'react';
import { Haken, Herunterladen, Kreispfeil, Achtung } from './Symbole.js';
import { t } from '../sprache.js';

/**
 * Der Aktualisierungsablauf, sichtbar gemacht.
 *
 * Bis hierher lief er ganz im Stillen: gesucht und geladen wurde ohne Anzeige, und am
 * Ende erschien ein Systemfenster mit zwei Knöpfen. Wer bei schmaler Leitung nachsah,
 * warum das Programm plötzlich Daten zieht, fand nirgends eine Auskunft - und was sich
 * überhaupt geändert hatte, stand nirgends.
 *
 * Die Karte unten rechts nimmt so wenig Platz wie möglich und lässt sich jederzeit
 * wegklicken; der Ablauf geht dann ohne sie weiter. Nur ein einziger Zustand hält sie
 * fest: eine fertig geladene Fassung, denn dort ist eine Entscheidung fällig.
 */

/** Muss zu packages/desktop/src/autoUpdate.ts passen (siehe bruecke.d.ts). */
export type Stand = Aktualisierungsstand;

interface Props {
  stand: Stand;
  onNeuStarten: () => void;
  onSchliessen: () => void;
}

/** 4,7 MB/s statt 4718592 - die Zahl soll im Vorbeigehen lesbar sein. */
function proSekunde(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB/s`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB/s`;
  return `${Math.round(bytes)} B/s`;
}

export function Aktualisierung({ stand, onNeuStarten, onSchliessen }: Props) {
  /**
   * Beim Wechsel auf "bereit" einmal den Blick heben lassen.
   *
   * Ohne das erschiene die Karte lautlos in einer Ecke, in der gerade nichts geschieht -
   * und genau dort schaut niemand hin, wenn er eine Mail liest.
   */
  const [betont, setBetont] = useState(false);
  useEffect(() => {
    if (stand.phase !== 'bereit') return;
    setBetont(true);
    // Nicht "t" - siehe AdressbuchModal: der Uebersetzer heisst so.
    const uhr = setTimeout(() => setBetont(false), 1400);
    return () => clearTimeout(uhr);
  }, [stand.phase]);

  if (stand.phase === 'ruhe') return null;

  return (
    <div
      className="aktualisierung"
      role="status"
      style={betont ? { boxShadow: '0 0 0 3px var(--marke-rand), var(--schatten-3)' } : undefined}
    >
      <div className="aktualisierung-kopf">
        {stand.phase === 'fehler' ? (
          <Achtung groesse={18} />
        ) : stand.phase === 'bereit' ? (
          <Haken groesse={18} />
        ) : stand.phase === 'laedt' ? (
          <Herunterladen groesse={18} />
        ) : (
          <Kreispfeil groesse={18} />
        )}
        <strong>
          {stand.phase === 'suche' && t('Suche nach Aktualisierungen')}
          {stand.phase === 'aktuell' && t('Alles aktuell')}
          {stand.phase === 'gefunden' && t('Fassung {fassung} gefunden', { fassung: stand.fassung })}
          {stand.phase === 'laedt' && t('Fassung {fassung} wird geladen', { fassung: stand.fassung })}
          {stand.phase === 'bereit' && t('Fassung {fassung} steht bereit', { fassung: stand.fassung })}
          {stand.phase === 'fehler' && t('Aktualisierung nicht möglich')}
        </strong>
        <button className="icon-btn" onClick={onSchliessen} title={t('Ausblenden')} aria-label={t('Ausblenden')}>
          ×
        </button>
      </div>

      {stand.phase === 'aktuell' && (
        <p>{t('Diese Fassung ({fassung}) ist die neueste.', { fassung: stand.fassung })}</p>
      )}

      {stand.phase === 'gefunden' && <p>{t('Wird im Hintergrund geladen – Sie können weiterarbeiten.')}</p>}

      {stand.phase === 'laedt' && (
        <>
          <div className="aktualisierung-balken">
            <div
              className="aktualisierung-fortschritt"
              style={{ width: `${Math.max(2, Math.round(stand.prozent))}%` }}
            />
          </div>
          <div className="aktualisierung-zahlen">
            <span>{Math.round(stand.prozent)} %</span>
            <span>{proSekunde(stand.proSekunde)}</span>
          </div>
          <p>{t('Sie können weiterarbeiten – eingespielt wird erst beim Beenden.')}</p>
        </>
      )}

      {stand.phase === 'bereit' && (
        <>
          {stand.neuerungen && (
            <div className="aktualisierung-neuerungen">
              {/* Als Text und nicht als Markup: die Angaben stammen aus der
                  Veröffentlichung auf GitHub, und fremdes HTML gehört nicht in das
                  Fenster. Die Hülle hat es vorher zu Zeilen aufgelöst. */}
              {stand.neuerungen}
            </div>
          )}
          <p>
            {t(
              'Eingespielt wird beim nächsten Beenden – oder sofort, wenn Sie jetzt neu starten. Es geht nichts verloren.',
            )}
          </p>
          <div className="aktualisierung-fuss">
            <button className="btn" onClick={onNeuStarten}>{t('Jetzt neu starten')}</button>
            <button className="btn secondary" onClick={onSchliessen}>{t('Später')}</button>
          </div>
        </>
      )}

      {stand.phase === 'fehler' && (
        <p>
          {stand.grund}
          {'\n\n'}
          {t('Das hat keine Folgen für den Mailabruf – beim nächsten Start wird es erneut versucht.')}
        </p>
      )}
    </div>
  );
}
