import { useState } from 'react';
import type { Einladung as EinladungDaten, Teilnahme, Termin } from '@energy-mail/mail-core';
import { beschreibeWiederholung } from '@energy-mail/mail-core/ics';
import { meldeErfolg, meldeFehler } from '../meldungen.js';
import * as api from '../api.js';

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
    const tag = termin.beginn.toLocaleDateString('de-DE', {
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
    return tage && tage > 1 ? `${tag}, ${tage} Tage (ganztägig)` : `${tag} (ganztägig)`;
  }

  const tag = termin.beginn.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const von = termin.beginn.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (!termin.ende) return `${tag}, ${von} Uhr`;

  const gleicherTag = termin.beginn.toDateString() === termin.ende.toDateString();
  const bis = termin.ende.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (gleicherTag) return `${tag}, ${von} – ${bis} Uhr`;

  const bisTag = termin.ende.toLocaleDateString('de-DE', { day: '2-digit', month: 'long' });
  return `${tag}, ${von} Uhr bis ${bisTag}, ${bis} Uhr`;
}

const STAND: Record<Teilnahme, string> = {
  zugesagt: 'zugesagt',
  abgesagt: 'abgesagt',
  vorbehalten: 'mit Vorbehalt',
  offen: 'noch offen',
  unbekannt: '',
};

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
      const wort = { zusagen: 'Zugesagt', absagen: 'Abgesagt', vorbehalten: 'Mit Vorbehalt' }[
        antwort
      ];
      meldeErfolg(`${wort}`, `Die Antwort ging an ${ergebnis.an}.`);
    } catch (err) {
      meldeFehler('Antwort nicht verschickt', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`einladung${abgesagt ? ' abgesagt' : ''}`}>
      <div className="einladung-kopf">
        <span className="einladung-art">
          {abgesagt ? 'Absage' : istAntwort ? 'Antwort auf eine Einladung' : 'Einladung'}
        </span>
        <h3>{termin.titel || '(ohne Titel)'}</h3>
      </div>

      <dl className="einladung-daten">
        <dt>Wann</dt>
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
            <dt>Wer</dt>
            <dd className="einladung-teilnehmer">
              {termin.teilnehmer.map((t) => (
                <span key={t.adresse} className={`teilnehmer ${t.teilnahme}`}>
                  {t.name || t.adresse}
                  {STAND[t.teilnahme] && <span className="teilnehmer-stand">{STAND[t.teilnahme]}</span>}
                  {t.optional && <span className="teilnehmer-stand">optional</span>}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>

      {termin.beschreibung && <p className="einladung-text">{termin.beschreibung}</p>}

      {abgesagt ? (
        <p className="hint einladung-hinweis">
          Der Organisator hat diesen Termin abgesagt.
        </p>
      ) : istAntwort ? (
        <p className="hint einladung-hinweis">
          Das ist die Antwort einer eingeladenen Person – hier ist nichts zu tun.
        </p>
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
                  ? 'Sende…'
                  : { zusagen: 'Zusagen', vorbehalten: 'Vielleicht', absagen: 'Absagen' }[wahl]}
              </button>
            ))}
          </div>
          {!beantwortet && ichSelbst && ichSelbst.teilnahme !== 'offen' && (
            <p className="hint einladung-hinweis">
              Sie haben bereits {STAND[ichSelbst.teilnahme]} – eine erneute Antwort ersetzt die
              vorige.
            </p>
          )}
          {!termin.organisator && (
            <p className="hint einladung-hinweis">
              Die Einladung nennt keinen Organisator – es gibt niemanden, an den eine Antwort
              ginge.
            </p>
          )}
        </>
      )}
    </div>
  );
}
