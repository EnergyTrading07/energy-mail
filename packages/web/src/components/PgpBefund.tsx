import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { frage } from '../dialoge.js';
import { meldeFehler } from '../meldungen.js';

/**
 * Was mit OpenPGP an einer Nachricht dran ist - und was es wert ist.
 *
 * Die Gestaltung folgt einer Regel: nur der eine Fall, in dem wirklich alles stimmt,
 * bekommt Grün. Alles andere ist Gelb oder Rot, auch wenn die Rechnung aufgeht. Der
 * gefährlichste Zustand ist nicht die falsche Unterschrift - die fällt auf -, sondern
 * die gültige Unterschrift eines fremden Schlüssels: sie sieht aus wie Sicherheit und
 * ist keine.
 */

interface Props {
  accountId: string;
  ordner: string;
  uid: number;
  /** Ob die Nachricht überhaupt nach OpenPGP aussieht - sonst wird gar nichts gezeigt. */
  verdacht: boolean;
}

const WORTE: Record<api.Vertrauen, { wort: string; stufe: 'gut' | 'warnung' | 'schlecht'; erklaerung: string }> = {
  gueltig: {
    wort: 'Unterschrift gültig',
    stufe: 'gut',
    erklaerung: 'Der Schlüssel gehört zu der Adresse, die als Absender angegeben ist.',
  },
  'gueltig-fremde-adresse': {
    wort: 'Unterschrift von fremder Adresse',
    stufe: 'warnung',
    erklaerung:
      'Die Unterschrift geht auf – aber der Schlüssel gehört zu einer anderen Adresse als der des Absenders. Das kann ein Versehen sein und ist der Weg, auf dem sich jemand für einen anderen ausgibt.',
  },
  'schluessel-fehlt': {
    wort: 'Unterschrift nicht prüfbar',
    stufe: 'warnung',
    erklaerung:
      'Der öffentliche Schlüssel des Unterzeichners liegt nicht vor. Ohne ihn lässt sich nichts feststellen – weder im Guten noch im Schlechten.',
  },
  ungueltig: {
    wort: 'Unterschrift FALSCH',
    stufe: 'schlecht',
    erklaerung:
      'Die Nachricht wurde nach dem Unterschreiben verändert, oder die Unterschrift stammt nicht von diesem Schlüssel. Behandeln Sie den Inhalt als unbestätigt.',
  },
  'schluessel-abgelaufen': {
    wort: 'Schlüssel abgelaufen oder zurückgezogen',
    stufe: 'warnung',
    erklaerung:
      'Die Unterschrift geht auf, der Schlüssel gilt aber nicht mehr. Er könnte in fremde Hände geraten sein – deshalb wird er zurückgezogen.',
  },
};

export function PgpBefund({ accountId, ordner, uid, verdacht }: Props) {
  const [befund, setBefund] = useState<api.PgpBefund | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [offen, setOffen] = useState(false);

  // Bei jeder anderen Nachricht von vorn - ein Befund gilt nur für seine eigene.
  useEffect(() => {
    setBefund(null);
    setOffen(false);
  }, [accountId, ordner, uid]);

  const pruefen = async (kennwort?: string) => {
    setLaeuft(true);
    try {
      const ergebnis = await api.pruefeNachrichtPgp(accountId, ordner, uid, kennwort);
      setBefund(ergebnis);

      // Verschlossener Schlüssel: einmal nach dem Kennwort fragen und noch einmal
      // versuchen. Gespeichert wird es nicht.
      if (ergebnis.verschluesselt && !ergebnis.geoeffnet && /Kennwort/.test(ergebnis.grund ?? '')) {
        const eingabe = await frage({
          titel: 'Kennwort des Schlüssels',
          text: 'Diese Nachricht ist verschlüsselt. Zum Öffnen wird das Kennwort Ihres geheimen Schlüssels gebraucht. Es wird nicht gespeichert.',
          ok: 'Öffnen',
          geheim: true,
        });
        if (eingabe) {
          setBefund(await api.pruefeNachrichtPgp(accountId, ordner, uid, eingabe));
        }
      }
    } catch (err) {
      meldeFehler('Prüfung nicht möglich', (err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  // Automatisch prüfen, sobald eine Nachricht danach aussieht: wer erst klicken muss,
  // klickt nicht - und eine Unterschrift, die niemand prüft, ist keine.
  useEffect(() => {
    if (verdacht && !befund && !laeuft) void pruefen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdacht, accountId, ordner, uid]);

  if (!verdacht) return null;
  if (laeuft && !befund) {
    return <div className="pgp-band pruefend">OpenPGP wird geprüft…</div>;
  }
  if (!befund || befund.ohnePgp) return null;

  const sig = befund.signatur ? WORTE[befund.signatur.vertrauen] : null;

  /**
   * Die Gesamtbewertung. Das Schlechteste gewinnt: eine verschlüsselte Nachricht mit
   * falscher Unterschrift ist nicht "halb gut".
   */
  const stufe: 'gut' | 'warnung' | 'schlecht' = (() => {
    if (befund.verschluesselt && !befund.geoeffnet) return 'warnung';
    if (sig?.stufe === 'schlecht') return 'schlecht';
    // Eine Inline-Unterschrift, die nicht den ganzen Text abdeckt, ist wertlos.
    if (befund.deckungGanzerText === false) return 'schlecht';
    if (sig?.stufe === 'warnung') return 'warnung';
    if (sig?.stufe === 'gut') return 'gut';
    return 'warnung';
  })();

  const kopf = [
    befund.verschluesselt && (befund.geoeffnet ? 'Verschlüsselt' : 'Verschlüsselt – nicht geöffnet'),
    sig?.wort,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`pgp-band ${stufe}`}>
      <div className="pgp-kopf">
        <span className="pgp-wort">{kopf || 'Mit OpenPGP geschützt'}</span>
        <button className="link-btn" onClick={() => setOffen((v) => !v)} aria-expanded={offen}>
          {offen ? 'Weniger' : 'Näheres'}
        </button>
      </div>

      {befund.deckungGanzerText === false && (
        <p className="pgp-warnung">
          Die Unterschrift deckt nur einen Teil des angezeigten Textes ab. Was außerhalb steht,
          kann jeder hinzugefügt haben – dieser Unterschrift ist nicht zu trauen.
        </p>
      )}

      {befund.verschluesselt && !befund.geoeffnet && (
        <p className="pgp-warnung">
          {befund.grund ?? 'Die Nachricht ließ sich nicht öffnen.'}{' '}
          <button className="link-btn" onClick={() => void pruefen()}>
            Noch einmal versuchen
          </button>
        </p>
      )}

      {offen && (
        <dl className="pgp-naeheres">
          {sig && (
            <>
              <dt>Bedeutung</dt>
              <dd>{sig.erklaerung}</dd>
            </>
          )}
          {befund.signatur?.fingerabdruck && (
            <>
              <dt>Schlüssel</dt>
              <dd className="pgp-fingerabdruck">{befund.signatur.fingerabdruck}</dd>
            </>
          )}
          {befund.signatur?.schluesselAdressen?.length ? (
            <>
              <dt>Gehört zu</dt>
              <dd>{befund.signatur.schluesselAdressen.join(', ')}</dd>
            </>
          ) : null}
          {befund.signatur?.grund && (
            <>
              <dt>Meldung</dt>
              <dd>{befund.signatur.grund}</dd>
            </>
          )}
        </dl>
      )}

      {befund.klartext && (
        <div className="pgp-klartext">
          <div className="pgp-klartext-kopf">Entschlüsselter Inhalt</div>
          <pre>{befund.klartext}</pre>
        </div>
      )}
    </div>
  );
}
