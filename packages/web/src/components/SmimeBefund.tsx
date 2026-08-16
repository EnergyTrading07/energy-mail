import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { frage } from '../dialoge.js';
import { meldeFehler } from '../meldungen.js';
import { t } from '../sprache.js';

/**
 * Was mit S/MIME an einer Nachricht dran ist - und was es wert ist.
 *
 * Dieselbe Regel wie beim OpenPGP-Band, und sie ist die wichtigste des ganzen Fensters:
 * **Nur der eine Fall, in dem wirklich alles stimmt, bekommt Grün.** Alles andere ist Gelb
 * oder Rot, auch wenn die Rechnung aufgeht.
 *
 * Bei S/MIME gibt es dafür einen Fall mehr als bei PGP, und er ist der heimtückischste:
 * eine Unterschrift, die aufgeht, deren Zertifikat aber von niemandem stammt, den dieser
 * Rechner kennt. Sich selbst ein Zertifikat auf `vorstand@firma.de` auszustellen dauert
 * dreißig Sekunden. Ein Programm, das daraufhin einen grünen Haken zeigt, hat den
 * gesamten Sinn des Verfahrens verkehrt - denn was S/MIME von einem Aufkleber
 * unterscheidet, ist nicht die Rechnung, sondern die Stelle, die dafür geradesteht.
 */

interface Props {
  accountId: string;
  ordner: string;
  uid: number;
  /** Ob die Nachricht überhaupt nach S/MIME aussieht - sonst wird gar nichts gefragt. */
  verdacht: boolean;
}

interface Wortlaut {
  wort: string;
  stufe: 'gut' | 'warnung' | 'schlecht';
  erklaerung: string;
}

/** Eine Funktion und keine Konstante - siehe PgpBefund.tsx, dieselbe Falle. */
function wortlaute(): Record<api.SmimeVertrauen, Wortlaut> {
  return {
    gueltig: {
      wort: t('Unterschrift gültig'),
      stufe: 'gut',
      erklaerung: t(
        'Das Zertifikat lautet auf die Adresse des Absenders, und es lässt sich bis zu einer Stelle zurückverfolgen, der dieser Rechner traut.',
      ),
    },
    'gueltig-fremde-adresse': {
      wort: t('Unterschrift von fremder Adresse'),
      stufe: 'warnung',
      erklaerung: t(
        'Die Unterschrift geht auf – aber das Zertifikat lautet auf eine andere Adresse als die des Absenders. Das kann ein Versehen sein und ist der Weg, auf dem sich jemand für einen anderen ausgibt.',
      ),
    },
    'gueltig-wurzel-unbekannt': {
      wort: t('Unterschrift ohne bekannte Herkunft'),
      stufe: 'warnung',
      erklaerung: t(
        'Die Rechnung geht auf, aber für dieses Zertifikat steht keine Stelle gerade, die dieser Rechner kennt. Ein solches Zertifikat kann sich jeder in einer halben Minute selbst ausstellen – auf jede beliebige Adresse. Es beweist damit nichts.',
      ),
    },
    'zertifikat-abgelaufen': {
      wort: t('Zertifikat nicht gültig'),
      stufe: 'warnung',
      erklaerung: t(
        'Die Unterschrift geht auf, das Zertifikat war zu diesem Zeitpunkt aber nicht gültig. Bei alter Post ist das der Normalfall; bei frischer ein Grund nachzufragen.',
      ),
    },
    'zweck-passt-nicht': {
      wort: t('Zertifikat nicht für Mail'),
      stufe: 'warnung',
      erklaerung: t(
        'Dieses Zertifikat wurde für einen anderen Zweck ausgestellt – etwa für einen Webserver. Damit zu unterschreiben ist nicht vorgesehen.',
      ),
    },
    ungueltig: {
      wort: t('Unterschrift FALSCH'),
      stufe: 'schlecht',
      erklaerung: t(
        'Die Nachricht wurde nach dem Unterschreiben verändert, oder die Unterschrift stammt nicht von diesem Zertifikat. Behandeln Sie den Inhalt als unbestätigt.',
      ),
    },
    'nicht-pruefbar': {
      wort: t('Unterschrift nicht prüfbar'),
      stufe: 'warnung',
      erklaerung: t(
        'Es ließ sich nichts feststellen – weder im Guten noch im Schlechten. Entweder fehlt das Zertifikat des Unterzeichners, oder es wurde ein Verfahren benutzt, das hier nicht mehr als Nachweis gilt.',
      ),
    },
  };
}

export function SmimeBefund({ accountId, ordner, uid, verdacht }: Props) {
  const [befund, setBefund] = useState<api.SmimeBefund | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [offen, setOffen] = useState(false);

  /** Woran eine Antwort erkennt, ob sie noch gemeint ist - siehe PgpBefund.tsx. */
  const kennung = `${accountId} ${ordner} ${uid}`;
  const aktuelleKennung = useRef(kennung);
  aktuelleKennung.current = kennung;

  const pruefen = async (kennwort?: string) => {
    const meine = kennung;
    setLaeuft(true);
    try {
      const ergebnis = await api.pruefeNachrichtSmime(accountId, ordner, uid, kennwort);
      if (aktuelleKennung.current !== meine) return;
      setBefund(ergebnis);

      if (ergebnis.verschluesselt && !ergebnis.geoeffnet && /Kennwort/.test(ergebnis.grund ?? '')) {
        const eingabe = await frage({
          titel: t('Kennwort des Schlüssels'),
          text: t(
            'Diese Nachricht ist verschlüsselt. Zum Öffnen wird das Kennwort Ihres Schlüssels gebraucht. Es wird nicht gespeichert.',
          ),
          ok: t('Öffnen'),
          geheim: true,
        });
        if (eingabe) {
          const zweiter = await api.pruefeNachrichtSmime(accountId, ordner, uid, eingabe);
          if (aktuelleKennung.current !== meine) return;
          setBefund(zweiter);
        }
      }
    } catch (err) {
      if (aktuelleKennung.current !== meine) return;
      meldeFehler(t('Prüfung nicht möglich'), (err as Error).message);
    } finally {
      if (aktuelleKennung.current === meine) setLaeuft(false);
    }
  };

  useEffect(() => {
    setBefund(null);
    setOffen(false);
    if (verdacht) void pruefen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verdacht, accountId, ordner, uid]);

  if (!verdacht) return null;
  if (laeuft && !befund) {
    return <div className="pgp-band pruefend">{t('S/MIME wird geprüft…')}</div>;
  }
  if (!befund || befund.ohneSmime) return null;

  const sig = befund.signatur ? wortlaute()[befund.signatur.vertrauen] : null;

  /** Das Schlechteste gewinnt - eine verschlüsselte Nachricht mit falscher Unterschrift
   *  ist nicht "halb gut". */
  const stufe: 'gut' | 'warnung' | 'schlecht' = (() => {
    if (befund.verschluesselt && !befund.geoeffnet) return 'warnung';
    if (sig?.stufe === 'schlecht') return 'schlecht';
    if (sig?.stufe === 'warnung') return 'warnung';
    if (sig?.stufe === 'gut') return 'gut';
    return 'warnung';
  })();

  const kopf = [
    befund.verschluesselt &&
      (befund.geoeffnet ? t('Verschlüsselt') : t('Verschlüsselt – nicht geöffnet')),
    sig?.wort,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`pgp-band ${stufe}`}>
      <div className="pgp-kopf">
        <span className="pgp-wort">{kopf || t('Mit S/MIME geschützt')}</span>
        <button className="link-btn" onClick={() => setOffen((v) => !v)} aria-expanded={offen}>
          {offen ? t('Weniger') : t('Näheres')}
        </button>
      </div>

      {befund.verschluesselt && !befund.geoeffnet && (
        <p className="pgp-warnung">
          {befund.grund ?? t('Die Nachricht ließ sich nicht öffnen.')}{' '}
          <button className="link-btn" onClick={() => void pruefen()}>
            {t('Noch einmal versuchen')}
          </button>
        </p>
      )}

      {befund.zertifikatGelernt && (
        <p className="pgp-hinweis">
          {t('Das Zertifikat dieses Absenders wurde übernommen – ab jetzt können Sie ihm verschlüsselt antworten.')}
        </p>
      )}

      {offen && (
        <dl className="pgp-naeheres">
          {sig && (
            <>
              <dt>{t('Bedeutung')}</dt>
              <dd>{sig.erklaerung}</dd>
            </>
          )}
          {befund.signatur?.name && (
            <>
              <dt>{t('Ausgestellt auf')}</dt>
              <dd>
                {befund.signatur.name}
                {befund.signatur.zertifikatAdressen?.length
                  ? ` (${befund.signatur.zertifikatAdressen.join(', ')})`
                  : ''}
              </dd>
            </>
          )}
          {befund.signatur?.kette?.length ? (
            <>
              <dt>{t('Ausgestellt von')}</dt>
              {/* Der ganze Weg und nicht nur der erste Schritt: Wem man am Ende glaubt,
                  ist die Wurzel - und die steht hier hinten. */}
              <dd>{befund.signatur.kette.join(' ← ')}</dd>
            </>
          ) : befund.signatur?.aussteller ? (
            <>
              <dt>{t('Ausgestellt von')}</dt>
              <dd>{befund.signatur.aussteller}</dd>
            </>
          ) : null}
          {befund.signatur?.giltBis && (
            <>
              <dt>{t('Gültig bis')}</dt>
              <dd>{new Date(befund.signatur.giltBis).toLocaleDateString()}</dd>
            </>
          )}
          {befund.signatur?.zeitpunkt && (
            <>
              <dt>{t('Unterschrieben am')}</dt>
              {/* Ausdrücklich als Angabe des Absenders gekennzeichnet: Der Zeitpunkt ist
                  zwar mit unterschrieben, aber niemand hat ihn bestätigt - wer
                  unterschreibt, schreibt hin, was er will. */}
              <dd>
                {new Date(befund.signatur.zeitpunkt).toLocaleString()}{' '}
                <span className="hint">{t('(Angabe des Absenders)')}</span>
              </dd>
            </>
          )}
          {befund.signatur?.fingerabdruck && (
            <>
              <dt>{t('Zertifikat')}</dt>
              <dd className="pgp-fingerabdruck">{befund.signatur.fingerabdruck}</dd>
            </>
          )}
          {befund.signatur?.grund && (
            <>
              <dt>{t('Meldung')}</dt>
              <dd>{befund.signatur.grund}</dd>
            </>
          )}
        </dl>
      )}

      {befund.klartext && (
        <div className="pgp-klartext">
          <div className="pgp-klartext-kopf">{t('Entschlüsselter Inhalt')}</div>
          <pre>{befund.klartext}</pre>
        </div>
      )}
    </div>
  );
}
