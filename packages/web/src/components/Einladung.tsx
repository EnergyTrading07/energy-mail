import { useState } from 'react';
import type { Einladung as EinladungDaten, Teilnahme, Termin } from '@energy-mail/mail-core';
import { beschreibeWiederholung } from '@energy-mail/mail-core/ics';
import { meldeErfolg, meldeFehler } from '../meldungen.js';
import * as api from '../api.js';
import { datum, uhrzeit } from '../sprache.js';
import { t } from '../sprache.js';

/**
 * Die Karte für eine Besprechungseinladung.
 *
 * Bisher bekam man eine Datei namens "invite.ics" zu sehen und musste sie in ein anderes
 * Programm tragen. Hier steht, worum es geht, wann es stattfindet und wer eingeladen ist -
 * und die Antwort geht mit einem Klick zurück an den Organisator.
 */

interface Props {
  einladung: EinladungDaten;
  accountId: string;
  ordner: string;
  uid: number;
  /** Die eigenen Adressen - daran erkennt man, ob und wie man selbst geantwortet hat. */
  eigeneAdressen: string[];
}

/**
 * Macht aus dem, was über die Leitung kam, wieder ein Datum.
 *
 * JSON kennt keine Datumswerte: ein Date wird beim Verschicken zu einer Zeichenkette und
 * kommt hier auch als solche an - obwohl der Typ etwas anderes behauptet. Ohne diese
 * Umwandlung scheiterte der Aufruf von toLocaleDateString(), und weil eine Ausnahme beim
 * Zeichnen den ganzen Baum mitreißt, blieb das Fenster leer.
 */
const alsDatum = (wert: Date | string | null | undefined): Date | null => {
  if (!wert) return null;
  const d = wert instanceof Date ? wert : new Date(wert);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Der Termin mit echten Datumswerten - alles Weitere rechnet damit. */
function mitDaten(termin: Termin): Termin {
  return { ...termin, beginn: alsDatum(termin.beginn), ende: alsDatum(termin.ende) };
}

/** Ein Zeitraum, so wie man ihn aufschreiben würde. */
function zeitraum(termin: Termin): string {
  if (!termin.beginn) return 'Zeitpunkt unbekannt';

  if (termin.ganztaegig) {
    const tag = datum(termin.beginn, {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    // DTEND ist bei ganztägigen Terminen der Tag DANACH - ein eintägiger Termin hätte
    // sonst überall ein Ende, das einen Tag zu spät steht.
    const tage =
      termin.ende &&
      Math.round((termin.ende.getTime() - termin.beginn.getTime()) / 86400000);
    return tage && tage > 1
      ? t('{tag}, {tage} Tage (ganztägig)', { tag, tage })
      : t('{tag} (ganztägig)', { tag });
  }

  const tag = datum(termin.beginn, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const von = uhrzeit(termin.beginn, { hour: '2-digit', minute: '2-digit' });
  if (!termin.ende) return t('{tag}, {von} Uhr', { tag, von });

  const gleicherTag = termin.beginn.toDateString() === termin.ende.toDateString();
  const bis = uhrzeit(termin.ende, { hour: '2-digit', minute: '2-digit' });
  if (gleicherTag) return t('{tag}, {von} – {bis} Uhr', { tag, von, bis });

  const bisTag = datum(termin.ende, { day: '2-digit', month: 'long' });
  return t('{tag}, {von} Uhr bis {bisTag}, {bis} Uhr', { tag, von, bisTag, bis });
}

/** Erst beim Zeichnen gebaut - auf Modulebene stünde die Sprache noch nicht fest. */
function stand(): Record<Teilnahme, string> {
  return {
    zugesagt: t('zugesagt'),
    abgesagt: t('abgesagt'),
    vorbehalten: t('mit Vorbehalt'),
    offen: t('noch offen'),
    unbekannt: '',
  };
}

export function Einladung({ einladung, accountId, ordner, uid, eigeneAdressen }: Props) {
  const [busy, setBusy] = useState<api.EinladungsAntwort | null>(null);
  const [beantwortet, setBeantwortet] = useState<api.EinladungsAntwort | null>(null);

  const roh = einladung.termine[0];
  if (!roh) return null;
  const termin = mitDaten(roh);

  const abgesagt = einladung.methode === 'CANCEL';
  const istAntwort = einladung.methode === 'REPLY';

  /** Der eigene Eintrag unter den Teilnehmern - daran hängt, was schon geantwortet wurde. */
  const ichSelbst = termin.teilnehmer.find((t) =>
    eigeneAdressen.some((e) => e.toLowerCase() === t.adresse.toLowerCase()),
  );

  const antworten = async (antwort: api.EinladungsAntwort) => {
    setBusy(antwort);
    try {
      const ergebnis = await api.beantworteEinladung(accountId, ordner, uid, antwort);
      setBeantwortet(antwort);
      const wort = {
        zusagen: t('Zugesagt'),
        absagen: t('Abgesagt'),
        vorbehalten: t('Mit Vorbehalt'),
      }[antwort];
      meldeErfolg(wort, t('Die Antwort ging an {adresse}.', { adresse: ergebnis.an }));
    } catch (err) {
      meldeFehler(t('Antwort nicht verschickt'), (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`einladung${abgesagt ? ' abgesagt' : ''}`}>
      <div className="einladung-kopf">
        <span className="einladung-art">
          {abgesagt ? t('Absage') : istAntwort ? t('Antwort auf eine Einladung') : t('Einladung')}
        </span>
        <h3>{termin.titel || t('(ohne Titel)')}</h3>
      </div>

      <dl className="einladung-daten">
        <dt>{t('Wann')}</dt>
        <dd>
          {zeitraum(termin)}
          {termin.wiederholung && (
            <span className="einladung-wiederholung">
              {' · '}
              {beschreibeWiederholung(termin.wiederholung)}
            </span>
          )}
        </dd>

        {termin.ort && (
          <>
            <dt>Wo</dt>
            <dd>{termin.ort}</dd>
          </>
        )}

        {termin.organisator && (
          <>
            <dt>Von</dt>
            <dd>{termin.organisator.name || termin.organisator.adresse}</dd>
          </>
        )}

        {termin.teilnehmer.length > 0 && (
          <>
            <dt>{t('Wer')}</dt>
            <dd className="einladung-teilnehmer">
              {/* Der Laufparameter heißt `wer` und nicht `t` - sonst verdeckt er die
                  Übersetzungsfunktion, und die Zeile darunter riefe den Teilnehmer auf. */}
              {termin.teilnehmer.map((wer) => (
                <span key={wer.adresse} className={`teilnehmer ${wer.teilnahme}`}>
                  {wer.name || wer.adresse}
                  {stand()[wer.teilnahme] && (
                    <span className="teilnehmer-stand">{stand()[wer.teilnahme]}</span>
                  )}
                  {wer.optional && <span className="teilnehmer-stand">{t('optional')}</span>}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {termin.beschreibung && <p className="einladung-text">{termin.beschreibung}</p>}

      {abgesagt ? (
        <p className="hint einladung-hinweis">{t('Der Organisator hat diesen Termin abgesagt.')}</p>
      ) : istAntwort ? (
        <p className="hint einladung-hinweis">{t('Das ist die Antwort einer eingeladenen Person – hier ist nichts zu tun.')}</p>
      ) : (
        <>
          <div className="einladung-knoepfe">
            {(['zusagen', 'vorbehalten', 'absagen'] as const).map((wahl) => (
              <button
                key={wahl}
                className={`btn${wahl === 'zusagen' ? '' : ' secondary'}${
                  beantwortet === wahl ? ' gewaehlt' : ''
                }`}
                disabled={busy !== null}
                onClick={() => void antworten(wahl)}
              >
                {busy === wahl
                  ? t('Sende…')
                  : {
                      zusagen: t('Zusagen'),
                      vorbehalten: t('Vielleicht'),
                      absagen: t('Absagen'),
                    }[wahl]}
              </button>
            ))}
          </div>
          {!beantwortet && ichSelbst && ichSelbst.teilnahme !== 'offen' && (
            <p className="hint einladung-hinweis">
              {t('Sie haben bereits {stand} – eine erneute Antwort ersetzt die vorige.', {
                stand: stand()[ichSelbst.teilnahme],
              })}
            </p>
          )}
          {!termin.organisator && (
            <p className="hint einladung-hinweis">
              {t(
                'Die Einladung nennt keinen Organisator – es gibt niemanden, an den eine Antwort ginge.',
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}
