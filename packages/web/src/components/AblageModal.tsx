import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { Fenster } from './Fenster.js';
import { t, zahl } from '../sprache.js';

/**
 * Der zwischengespeicherte Nachrichtenbestand - nachsehen und wegwerfen.
 *
 * ## Warum es dieses Fenster gibt
 *
 * Es beantwortet die Frage "was weiß dieses Programm eigentlich über mich" an der Stelle,
 * an der man sie stellt - in der Anwendung. Betreffzeilen, Absender und der Wortlaut der
 * zuletzt gelesenen Nachrichten liegen unverschlüsselt im Datenordner; verschlüsselt sind
 * die Zugangsdaten, nicht der Bestand.
 *
 * Die beiden Wege dafür gab es auf dem Server von Anfang an. Erreichbar waren sie aber nur
 * über das Menü der Desktop-Hülle: Wer die Anwendung im Browser benutzt, hatte keinen Weg
 * dorthin - und damit keinen Weg, den Bestand auch nur anzusehen.
 *
 * ## Erst die Zahlen, dann die Frage
 *
 * Wer nur nachsehen wollte, geht mit "Schließen" hinaus, ohne etwas angerichtet zu haben.
 * Dieselbe Reihenfolge wie im Menü der Hülle, und aus demselben Grund: Hier verschwindet
 * etwas, das sich nicht zurückholen lässt.
 */

/**
 * Bytes für Menschen. Tausenderschritte, weil Datenträger so beschriftet sind.
 *
 * Gerundet wird vor der Ausgabe und nicht durch sie: `zahl()` nimmt bewusst keine
 * Formatangaben entgegen - es gibt genau eine Art, in dieser Anwendung eine Zahl zu
 * schreiben, und die richtet sich nach der Sprache.
 */
function alsGroesse(bytes: number): string {
  if (bytes < 1000) return `${zahl(bytes)} B`;
  if (bytes < 1_000_000) return `${zahl(Math.round(bytes / 1000))} kB`;
  if (bytes < 1_000_000_000) return `${zahl(Math.round(bytes / 100_000) / 10)} MB`;
  return `${zahl(Math.round(bytes / 10_000_000) / 100)} GB`;
}

interface Props {
  onClose: () => void;
}

type Stand = { bytes: number; nachrichten: number; inhalte: number };

export function AblageModal({ onClose }: Props) {
  const [stand, setStand] = useState<Stand | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(true);
  const [leert, setLeert] = useState(false);
  /** Was zuletzt entfernt wurde - die Bestätigung nach dem Leeren. */
  const [geleert, setGeleert] = useState<{ nachrichten: number; inhalte: number } | null>(null);

  useEffect(() => {
    let gilt = true;
    api
      .holeAblageStand()
      .then((s) => gilt && setStand(s))
      .catch((err) => gilt && setFehler((err as Error).message))
      .finally(() => gilt && setLaeuft(false));
    return () => {
      gilt = false;
    };
  }, []);

  const leeren = async () => {
    setLeert(true);
    setFehler(null);
    try {
      const weg = await api.leereAblage();
      setGeleert({ nachrichten: weg.nachrichten, inhalte: weg.inhalte });
      setStand(await api.holeAblageStand());
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLeert(false);
    }
  };

  return (
    <Fenster titel={t('Gespeicherter Nachrichtenbestand')} onClose={onClose}>
      {fehler && <div className="error-banner">{fehler}</div>}

      {laeuft ? (
        <p className="hint">{t('Wird geladen …')}</p>
      ) : stand ? (
        <>
          <p>
            {t(
              'Auf der Platte liegen zurzeit {kopfdaten} Kopfdaten und {inhalte} Nachrichtentexte ({groesse}).',
              {
                kopfdaten: zahl(stand.nachrichten),
                inhalte: zahl(stand.inhalte),
                groesse: alsGroesse(stand.bytes),
              },
            )}
          </p>

          <p className="hint">
            {t(
              'Kopfdaten sind Absender, Betreff und Datum – von allen abgerufenen Nachrichten. Sie liegen unverschlüsselt im Benutzerordner, damit die Liste auch ohne Verbindung vollständig ist.',
            )}
          </p>

          <p className="hint">
            {t(
              'Wird der Bestand geleert, ist nichts verloren: die Post liegt bei Ihrem Anbieter und wird beim nächsten Abruf neu geholt. Bis dahin ist die Liste ohne Verbindung leer, und die Volltextsuche findet nur, was seitdem wieder abgerufen wurde.',
            )}
          </p>

          <p className="hint">
            {t('Konten, Kennwörter, Adressbuch, Regeln und Etiketten bleiben unangetastet.')}
          </p>

          {geleert && (
            <p className="hint">
              {t(
                '{kopfdaten} Kopfdaten und {inhalte} Nachrichtentexte wurden entfernt und die Ablagedatei neu geschrieben – auch die freigewordenen Stellen darin.',
                { kopfdaten: zahl(geleert.nachrichten), inhalte: zahl(geleert.inhalte) },
              )}
            </p>
          )}
        </>
      ) : null}

      <div className="form-row" style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
        <button type="button" className="btn secondary" onClick={onClose} disabled={leert}>
          {t('Schließen')}
        </button>
        <button
          type="button"
          className="btn danger"
          onClick={() => void leeren()}
          disabled={leert || laeuft || !stand || stand.nachrichten + stand.inhalte === 0}
        >
          {leert ? t('Wird geleert …') : t('Bestand leeren')}
        </button>
      </div>
    </Fenster>
  );
}
