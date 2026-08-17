import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';
import { bestaetige, frage } from '../dialoge.js';
import { meldeErfolg, meldeFehler, meldeWarnung } from '../meldungen.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';

/**
 * Das Archiv nach GoBD.
 *
 * ## Was dieses Fenster leisten muss
 *
 * Es hat zwei sehr verschiedene Besucher. Der eine richtet es einmal ein und sieht es
 * danach jahrelang nicht wieder. Der andere sitzt neben einem Betriebsprüfer und sucht
 * unter Zeitdruck eine bestimmte Nachricht von vor vier Jahren.
 *
 * Deshalb steht der Stand oben und die Suche gleich darunter - das ist der Fall, der
 * unter Druck steht. Das Einrichten steht unten; wer es einmal getan hat, geht daran
 * vorbei.
 *
 * ## Ein Satz, den ich nicht weglasse
 *
 * Kein Programm macht jemanden „GoBD-konform". Die GoBD sagen in Rz. 179 selbst, dass
 * Zertifikate Dritter gegenüber der Finanzverwaltung keine Bindungswirkung entfalten. Wer
 * einem Kunden etwas anderes verspricht, verkauft ihm ein Gefühl - und der merkt es in
 * dem einen Moment, in dem es darauf ankommt. Der Hinweis steht deshalb oben im Fenster
 * und nicht in einer Fußnote.
 */

interface Props {
  accounts: Account[];
  onClose: () => void;
}

const ARTEN: { wert: api.Aufbewahrungsart; wort: string; frist: string }[] = [
  { wert: 'geschaeftsbrief', wort: 'Geschäftsbrief', frist: '6 Jahre' },
  { wert: 'buchungsbeleg', wort: 'Buchungsbeleg', frist: '8 Jahre' },
  { wert: 'ohne-pflicht', wort: 'ohne Pflicht', frist: '—' },
];

const wortFuer = (art: api.Aufbewahrungsart) => ARTEN.find((a) => a.wert === art)?.wort ?? art;

function menge(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

const tag = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '—');

export function ArchivModal({ accounts, onClose }: Props) {
  const [stand, setStand] = useState<api.ArchivStand | null>(null);
  const [treffer, setTreffer] = useState<api.ArchivFund[]>([]);
  const [gesamt, setGesamt] = useState(0);
  const [suchtext, setSuchtext] = useState('');
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [einstellungen, setEinstellungen] = useState<api.ArchivEinstellungen | null>(null);
  const [befund, setBefund] = useState<api.Bestandsbefund | null>(null);

  const laden = async () => {
    try {
      const s = await api.ladeArchivStand();
      setStand(s);
      setEinstellungen(s.einstellungen);
    } catch (err) {
      setFehler((err as Error).message);
    }
  };
  useEffect(() => {
    void laden();
  }, []);

  const suchen = async () => {
    setBusy(true);
    setFehler(null);
    try {
      const ergebnis = await api.sucheImArchiv({
        text: suchtext || undefined,
        von: von || undefined,
        bis: bis ? `${bis}T23:59:59Z` : undefined,
      });
      setTreffer(ergebnis.treffer);
      setGesamt(ergebnis.gesamt);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void suchen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sichern = async (neu: api.ArchivEinstellungen) => {
    setBusy(true);
    try {
      setEinstellungen(await api.speichereArchivEinstellungen(neu));
      await laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const umtragen = async (fund: api.ArchivFund, art: api.Aufbewahrungsart) => {
    try {
      await api.trageArchivUm(fund.nr, art);
      await suchen();
      await laden();
    } catch (err) {
      meldeFehler(t('Umtragen nicht möglich'), (err as Error).message);
    }
  };

  const vermerken = async (fund: api.ArchivFund) => {
    const text = await frage({
      titel: t('Vermerk zu Nr. {nr}', { nr: String(fund.nr) }),
      text: t(
        'Der Vermerk kommt als eigener Eintrag ans Ende der Kette. Der ursprüngliche Eintrag bleibt unverändert – und der Vermerk lässt sich danach nicht mehr zurücknehmen.',
      ),
      ok: t('Vermerken'),
    });
    if (!text?.trim()) return;
    try {
      await api.vermerkeImArchiv(fund.nr, text);
      await suchen();
    } catch (err) {
      meldeFehler(t('Vermerk nicht möglich'), (err as Error).message);
    }
  };

  const pruefen = async () => {
    setBusy(true);
    setBefund(null);
    try {
      const ergebnis = await api.pruefeArchivBestand();
      setBefund(ergebnis);
      const heil =
        ergebnis.kette.heil && ergebnis.fehlend.length === 0 && ergebnis.verfaelscht.length === 0;
      if (heil) {
        meldeErfolg(
          t('Bestand geprüft'),
          t('{anzahl} Nachrichten nachgerechnet, alles unversehrt.', {
            anzahl: String(ergebnis.geprueft),
          }),
        );
      } else {
        meldeWarnung(t('Bestand beanstandet'), t('Näheres steht unter der Prüfung.'));
      }
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ausfuehren = async () => {
    setBusy(true);
    try {
      const ergebnis = await api.erzeugeArchivAusfuhr({
        von: von || undefined,
        bis: bis ? `${bis}T23:59:59Z` : undefined,
      });
      meldeErfolg(
        t('Ausfuhr erzeugt'),
        t('{anzahl} Nachrichten liegen in {ordner}', {
          anzahl: String(ergebnis.anzahl),
          ordner: ergebnis.ordner,
        }),
      );
      if (!ergebnis.bestandHeil) {
        meldeWarnung(t('Bestand beanstandet'), ergebnis.hinweis ?? '');
      }
    } catch (err) {
      meldeFehler(t('Ausfuhr nicht möglich'), (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const aufraeumen = async () => {
    const vorschau = await api.raeumeArchivAuf(false);
    if (vorschau.anzahl === 0) {
      meldeErfolg(t('Nichts abgelaufen'), t('Keine Nachricht hat ihre Frist hinter sich.'));
      return;
    }
    const ja = await bestaetige({
      titel: t('{anzahl} Nachrichten endgültig entfernen?', { anzahl: String(vorschau.anzahl) }),
      text: t(
        'Es werden ausschließlich Nachrichten entfernt, deren Aufbewahrungsfrist abgelaufen ist ({menge}). Ihre Einträge bleiben in der Kette stehen, damit keine Lücke entsteht. Zurückholen lässt sich nichts.',
        { menge: menge(vorschau.bytes) },
      ),
      ok: t('Entfernen'),
    });
    if (!ja) return;
    try {
      const ergebnis = await api.raeumeArchivAuf(true);
      meldeErfolg(
        t('Aufgeräumt'),
        t('{anzahl} Nachrichten entfernt.', { anzahl: String(ergebnis.anzahl) }),
      );
      await suchen();
      await laden();
    } catch (err) {
      meldeFehler(t('Aufräumen nicht möglich'), (err as Error).message);
    }
  };

  const an = einstellungen?.konten ?? [];

  return (
    <Fenster titel={t('Archiv (GoBD)')} onClose={onClose} klasse="modal-wide archiv">
      {/*
        Der wichtigste Satz zuerst. Er nimmt dem Fenster nichts von seinem Nutzen - er
        verhindert nur, dass jemand daraus etwas anderes liest, als dasteht.
      */}
      <p className="hint">
        {t(
          'Jede ein- und ausgehende Nachricht der ausgewählten Konten wird im Original aufbewahrt, unveränderbar verkettet und mit ihrer Aufbewahrungsfrist versehen. Das ist der technische Teil einer ordnungsmäßigen Aufbewahrung – „GoBD-konform“ macht Software niemanden, das ist eine Eigenschaft des Verfahrens im Betrieb.',
        )}
      </p>

      {fehler && <div className="error-banner">{fehler}</div>}

      {stand && (
        <div className="archiv-stand">
          <div>
            <span className="archiv-zahl">{stand.anzahl}</span>
            <span className="hint">{t('Nachrichten')}</span>
          </div>
          <div>
            <span className="archiv-zahl">{menge(stand.bytes)}</span>
            <span className="hint">{t('Umfang')}</span>
          </div>
          <div>
            <span className="archiv-zahl">
              {tag(stand.aeltesteAm)} – {tag(stand.juengsteAm)}
            </span>
            <span className="hint">{t('Zeitraum')}</span>
          </div>
          <div>
            <span className="archiv-zahl">{stand.freigegeben}</span>
            <span className="hint">{t('Frist abgelaufen')}</span>
          </div>
        </div>
      )}

      {stand && (
        <p className="hint archiv-siegel" title={t('Notieren Sie diesen Wert außerhalb dieses Rechners – nur dann sagt er etwas aus.')}>
          {t('Siegel')}: <code>{stand.siegel}</code>
        </p>
      )}

      <h4>{t('Suchen')}</h4>
      <div className="archiv-suche">
        <input
          value={suchtext}
          placeholder={t('Betreff, Absender, Empfänger')}
          onChange={(e) => setSuchtext(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void suchen()}
        />
        <input type="date" value={von} onChange={(e) => setVon(e.target.value)} aria-label={t('von')} />
        <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} aria-label={t('bis')} />
        <button className="btn" disabled={busy} onClick={() => void suchen()}>
          {t('Suchen')}
        </button>
      </div>

      {treffer.length === 0 ? (
        <div className="empty-state">{t('Nichts gefunden.')}</div>
      ) : (
        <>
          {gesamt > treffer.length && (
            <p className="hint">
              {t('{gezeigt} von {gesamt} – bitte weiter eingrenzen.', {
                gezeigt: String(treffer.length),
                gesamt: String(gesamt),
              })}
            </p>
          )}
          <div className="archiv-liste">
            {treffer.map((fund) => (
              <div key={fund.nr} className="archiv-zeile">
                <div className="archiv-text">
                  <div className="archiv-betreff">
                    <span className={`archiv-richtung ${fund.richtung}`}>
                      {fund.richtung === 'gesendet' ? t('gesendet') : t('empfangen')}
                    </span>
                    {fund.betreff || t('(ohne Betreff)')}
                  </div>
                  <div className="archiv-wer">
                    {fund.absender} → {fund.empfaenger.join(', ')}
                  </div>
                  <div className="hint">
                    {t('Nr. {nr} · {datum} · {art} · aufzubewahren bis {bis}', {
                      nr: String(fund.nr),
                      datum: tag(fund.entstandenAm),
                      art: wortFuer(fund.art),
                      bis: tag(fund.aufbewahrenBis),
                    })}
                    {fund.freigegeben && ` · ${t('Frist abgelaufen')}`}
                  </div>
                  {fund.vermerke.map((v, i) => (
                    <div key={i} className="archiv-vermerk">
                      {tag(v.erfasstAm)} {v.wer}: {v.text}
                    </div>
                  ))}
                </div>
                <select
                  value={fund.art}
                  aria-label={t('Aufbewahrungsart')}
                  onChange={(e) => void umtragen(fund, e.target.value as api.Aufbewahrungsart)}
                >
                  {ARTEN.map((a) => (
                    <option key={a.wert} value={a.wert}>
                      {a.wort} ({a.frist})
                    </option>
                  ))}
                </select>
                <button className="link-btn" onClick={() => void vermerken(fund)}>
                  {t('Vermerk')}
                </button>
                <button
                  className="link-btn"
                  onClick={() => {
                    window.location.href = api.archivOriginalAdresse(fund.nr);
                  }}
                >
                  {t('Original')}
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <h4>{t('Für eine Betriebsprüfung')}</h4>
      <p className="hint">
        {t(
          'Die Ausfuhr legt einen Ordner an: die Nachrichten im Original als .eml-Dateien, eine Übersichtstabelle, die Beschreibungsdatei nach dem Beschreibungsstandard für die Datenträgerüberlassung, das Siegel und die Verfahrensdokumentation. Diesen Ordner kopiert man auf den Datenträger, den die Prüfung bekommt. Ist ein Zeitraum eingegrenzt, gilt er auch hier.',
        )}
      </p>
      <div className="schluessel-knoepfe">
        <button className="btn" disabled={busy} onClick={() => void ausfuehren()}>
          {t('Ausfuhr erzeugen')}
        </button>
        <button className="btn secondary" disabled={busy} onClick={() => void pruefen()}>
          {t('Bestand nachrechnen')}
        </button>
        <button
          className="btn secondary"
          onClick={() => {
            window.location.href = api.verfahrensdokumentationAdresse();
          }}
        >
          {t('Verfahrensdokumentation')}
        </button>
      </div>

      {befund && (
        <div className={`hint${befund.kette.heil && befund.fehlend.length === 0 && befund.verfaelscht.length === 0 ? ' hinweis-gut' : ' hinweis-fehler'}`}>
          {t('{anzahl} Nachrichten nachgerechnet.', { anzahl: String(befund.geprueft) })}{' '}
          {befund.kette.heil
            ? t('Die Kette ist heil.')
            : t('Die Kette ist gebrochen bei Nr. {nr}: {grund}', {
                nr: String(befund.kette.beiNr),
                grund: befund.kette.grund,
              })}
          {befund.fehlend.length > 0 &&
            ` ${t('Fehlende Dateien: {liste}', { liste: befund.fehlend.join(', ') })}`}
          {befund.verfaelscht.length > 0 &&
            ` ${t('Nicht mehr passend: {liste}', { liste: befund.verfaelscht.join(', ') })}`}
        </div>
      )}

      <h4>{t('Einrichten')}</h4>
      {einstellungen && (
        <>
          <div className="form-row">
            <label>{t('Diese Konten werden aufgezeichnet')}</label>
            {accounts.map((konto) => (
              <label key={konto.id} className="verzeichnis-schalter">
                <input
                  type="checkbox"
                  checked={an.includes(konto.id)}
                  onChange={(e) =>
                    void sichern({
                      ...einstellungen,
                      konten: e.target.checked
                        ? [...an, konto.id]
                        : an.filter((k) => k !== konto.id),
                    })
                  }
                />
                <span>{konto.email}</span>
              </label>
            ))}
            {/*
              Der Satz, der ein Missverständnis verhindert, das sonst erst in der Prüfung
              auffällt: Es gibt kein Nachtragen. Was vor dem Einschalten lief, ist nicht da.
            */}
            <p className="hint">
              {t(
                'Aufgezeichnet wird ab dem Einschalten – ältere Post wird nicht nachgetragen. Private Postfächer gehören nicht dazu: Die Aufbewahrungspflicht trifft geschäftliche Post, und alles andere mitzuschreiben wäre gegenüber jedem falsch, der Ihnen schreibt.',
              )}
            </p>
          </div>

          <div className="verzeichnis-zeile">
            <div>
              <label htmlFor="archiv-betrieb">{t('Betrieb')}</label>
              <input
                id="archiv-betrieb"
                value={einstellungen.betrieb ?? ''}
                onChange={(e) => setEinstellungen({ ...einstellungen, betrieb: e.target.value })}
                onBlur={() => void sichern(einstellungen)}
              />
            </div>
            <div>
              <label htmlFor="archiv-wer">{t('Verantwortlich')}</label>
              <input
                id="archiv-wer"
                value={einstellungen.verantwortlich ?? ''}
                onChange={(e) =>
                  setEinstellungen({ ...einstellungen, verantwortlich: e.target.value })
                }
                onBlur={() => void sichern(einstellungen)}
              />
            </div>
            <div>
              <label htmlFor="archiv-vorgabe">{t('Voreinstellung')}</label>
              <select
                id="archiv-vorgabe"
                value={einstellungen.vorgabe}
                onChange={(e) =>
                  void sichern({
                    ...einstellungen,
                    vorgabe: e.target.value as api.Aufbewahrungsart,
                  })
                }
              >
                {ARTEN.map((a) => (
                  <option key={a.wert} value={a.wert}>
                    {a.wort} ({a.frist})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      <div className="schluessel-knoepfe">
        <button className="btn danger" disabled={busy} onClick={() => void aufraeumen()}>
          {t('Abgelaufenes entfernen')}
        </button>
        <span className="adressbuch-fueller" />
        <button className="btn" onClick={onClose}>
          {t('Schließen')}
        </button>
      </div>
    </Fenster>
  );
}
