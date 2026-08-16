import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { t } from '../sprache.js';

/**
 * Das Firmenverzeichnis einrichten - nur für Verwalter.
 *
 * ## Warum das Formular so ausführlich ist
 *
 * Weil kein Verzeichnis dem anderen gleicht. Ein Active Directory nennt das Anzeigefeld
 * `displayName`, ein OpenLDAP `cn`; das eine hat `company`, das andere `o`. Ein Formular
 * mit drei Feldern und der Annahme, es sei schon ein AD, ließe die Hälfte der Betreiber im
 * Regen - und die merken es erst, wenn niemand gefunden wird.
 *
 * Deshalb: zwei Vorlagen zum Anklicken, und darunter jedes Feld einzeln änderbar.
 *
 * ## Die Reihenfolge im Formular ist die der Fehlersuche
 *
 * Erst kommt man überhaupt hin (Adresse, Verschlüsselung), dann darf man etwas (Anmeldung),
 * dann findet man etwas (Suchbereich, Filter), dann steht das Richtige da (Felder). Wer
 * eine Störung sucht, arbeitet genau diese Reihenfolge ab - und "Verbindung prüfen" sagt
 * nach jedem Schritt, ob es bis hierher trägt.
 */

/** Zwei Vorlagen - sie decken zusammen fast alles ab, was in Betrieben steht. */
const VORLAGEN: Record<string, Partial<api.Verzeichnis>> = {
  ad: {
    port: 636,
    verschluesselung: 'ldaps',
    filter: '(&(objectCategory=person)(objectClass=user)(mail=*))',
    sucheIn: ['displayName', 'cn', 'mail', 'sn', 'givenName', 'sAMAccountName'],
    felder: {
      email: 'mail',
      name: 'displayName',
      vorname: 'givenName',
      nachname: 'sn',
      telefon: 'telephoneNumber',
      mobil: 'mobile',
      organisation: 'company',
      abteilung: 'department',
    },
  },
  openldap: {
    port: 636,
    verschluesselung: 'ldaps',
    filter: '(&(objectClass=inetOrgPerson)(mail=*))',
    sucheIn: ['cn', 'mail', 'sn', 'givenName', 'uid'],
    felder: {
      email: 'mail',
      name: 'cn',
      vorname: 'givenName',
      nachname: 'sn',
      telefon: 'telephoneNumber',
      mobil: 'mobile',
      organisation: 'o',
      abteilung: 'ou',
    },
  },
};

export function VerzeichnisTeil() {
  const [wert, setWert] = useState<api.VerzeichnisAnzeige | null>(null);
  const [kennwort, setKennwort] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [befund, setBefund] = useState<{ ok: boolean; text: string } | null>(null);
  const [gesichert, setGesichert] = useState(false);

  useEffect(() => {
    api
      .holeVerzeichnis()
      .then(setWert)
      .catch((err) => setFehler((err as Error).message));
  }, []);

  if (!wert) {
    return (
      <div className="form-row verzeichnis-teil">
        <label>{t('Firmenverzeichnis (LDAP)')}</label>
        {fehler ? <p className="hint hinweis-fehler">{fehler}</p> : <p className="hint">{t('Wird geladen…')}</p>}
      </div>
    );
  }

  const aendere = (teil: Partial<api.VerzeichnisAnzeige>) => {
    setWert({ ...wert, ...teil });
    setGesichert(false);
    setBefund(null);
  };
  const feld = (name: keyof api.Verzeichnis['felder'], wie: string) =>
    aendere({ felder: { ...wert.felder, [name]: wie } });

  /** Die Angaben aus dem Formular - ohne die Anzeigezusätze. */
  const angaben = () => {
    const { kennwortHinterlegt: _weg, ...rest } = wert;
    return { ...rest, ...(kennwort ? { kennwort } : {}) };
  };

  const pruefen = async () => {
    setLaeuft(true);
    setBefund(null);
    try {
      const antwort = await api.pruefeVerzeichnis(angaben());
      setBefund(
        antwort.ok
          ? {
              ok: true,
              text: t('Die Verbindung steht. {anzahl} Einträge zur Probe gefunden.', {
                anzahl: String(antwort.treffer ?? 0),
              }),
            }
          : { ok: false, text: antwort.fehler ?? '' },
      );
    } catch (err) {
      setBefund({ ok: false, text: (err as Error).message });
    } finally {
      setLaeuft(false);
    }
  };

  const speichern = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      const zurueck = await api.speichereVerzeichnis(angaben());
      setWert(zurueck);
      setKennwort('');
      setGesichert(true);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  const vorlage = (name: string) => {
    const v = VORLAGEN[name]!;
    setWert({ ...wert, ...v, felder: { ...wert.felder, ...(v.felder ?? {}) } });
    setGesichert(false);
    setBefund(null);
  };

  return (
    <div className="form-row verzeichnis-teil">
      <label>{t('Firmenverzeichnis (LDAP)')}</label>
      <p className="hint">
        {t('Alle Nutzer dieses Dienstes finden dann beim Tippen eines Empfängers auch die Kollegen aus dem Verzeichnis. Gelesen wird nur – geändert nie.')}
      </p>
      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      <label className="verzeichnis-schalter">
        <input
          type="checkbox"
          checked={wert.aktiv}
          onChange={(e) => aendere({ aktiv: e.target.checked })}
        />
        <span>{t('Firmenverzeichnis benutzen')}</span>
      </label>

      {wert.aktiv && (
        <>
          <div className="verzeichnis-vorlagen">
            <span className="hint">{t('Vorlage:')}</span>
            <button type="button" className="link-btn" onClick={() => vorlage('ad')}>
              {t('Active Directory')}
            </button>
            <button type="button" className="link-btn" onClick={() => vorlage('openldap')}>
              {t('OpenLDAP')}
            </button>
          </div>

          <div className="verzeichnis-zeile">
            <div>
              <label htmlFor="verz-host">{t('Adresse')}</label>
              <input
                id="verz-host"
                value={wert.host}
                placeholder="dc01.firma.local"
                onChange={(e) => aendere({ host: e.target.value })}
              />
            </div>
            <div className="schmal">
              <label htmlFor="verz-port">{t('Port')}</label>
              <input
                id="verz-port"
                type="number"
                value={wert.port}
                onChange={(e) => aendere({ port: Number(e.target.value) })}
              />
            </div>
            <div>
              <label htmlFor="verz-tls">{t('Verschlüsselung')}</label>
              <select
                id="verz-tls"
                value={wert.verschluesselung}
                onChange={(e) => {
                  const v = e.target.value as api.Verzeichnis['verschluesselung'];
                  // Der Port folgt der Wahl mit - 636 für LDAPS, 389 sonst. Wer ihn
                  // danach von Hand ändert, behält seine Änderung.
                  aendere({ verschluesselung: v, port: v === 'ldaps' ? 636 : 389 });
                }}
              >
                <option value="ldaps">{t('LDAPS (verschlüsselt ab Verbindungsaufbau)')}</option>
                <option value="starttls">{t('StartTLS (schaltet um)')}</option>
                <option value="einfach">{t('Ohne Verschlüsselung')}</option>
              </select>
            </div>
          </div>

          {wert.verschluesselung === 'einfach' && (
            <p className="hint hinweis-fehler">
              {t('Ohne Verschlüsselung geht das Kennwort des Dienstkontos im Klartext über die Leitung. Nur vertretbar, wenn diese Leitung den Rechner nie verlässt.')}
            </p>
          )}

          {wert.verschluesselung !== 'einfach' && (
            <label className="verzeichnis-schalter">
              <input
                type="checkbox"
                checked={wert.zertifikatPruefen}
                onChange={(e) => aendere({ zertifikatPruefen: e.target.checked })}
              />
              <span>{t('Zertifikat prüfen')}</span>
            </label>
          )}

          <div className="verzeichnis-zeile">
            <div>
              <label htmlFor="verz-bind">{t('Anmelde-DN des Dienstkontos')}</label>
              <input
                id="verz-bind"
                value={wert.bindDn}
                placeholder="cn=energymail,ou=Dienste,dc=firma,dc=de"
                onChange={(e) => aendere({ bindDn: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="verz-kennwort">
                {wert.kennwortHinterlegt ? t('Kennwort (hinterlegt)') : t('Kennwort')}
              </label>
              <input
                id="verz-kennwort"
                type="password"
                value={kennwort}
                autoComplete="new-password"
                placeholder={wert.kennwortHinterlegt ? '••••••••' : ''}
                onChange={(e) => setKennwort(e.target.value)}
              />
            </div>
          </div>
          {/*
            Der Satz, bei dem ein bequemer Griff später teuer wird. Er steht hier und nicht
            in einer Anleitung, weil genau hier jemand versucht ist, den Administrator
            einzutragen, weil der ja sowieso überall hinkommt.
          */}
          <p className="hint">
            {t('Ein Konto, das im Verzeichnis nur lesen darf – kein Administratorkonto. Es steht verschlüsselt auf dem Server und geht nie wieder heraus.')}
          </p>

          <label htmlFor="verz-basis">{t('Suchbereich (Basis-DN)')}</label>
          <input
            id="verz-basis"
            value={wert.basis}
            placeholder="dc=firma,dc=de"
            onChange={(e) => aendere({ basis: e.target.value })}
          />

          <label htmlFor="verz-filter">{t('Grundfilter')}</label>
          <input
            id="verz-filter"
            value={wert.filter}
            onChange={(e) => aendere({ filter: e.target.value })}
          />
          <p className="hint">
            {t('Gilt zusätzlich zu jeder Suche – damit keine Rechnerkonten und keine Verteiler in den Vorschlägen auftauchen.')}
          </p>

          <label htmlFor="verz-suchein">{t('Durchsuchte Felder')}</label>
          <input
            id="verz-suchein"
            value={wert.sucheIn.join(', ')}
            onChange={(e) => aendere({ sucheIn: e.target.value.split(',').map((s) => s.trim()) })}
          />

          <div className="verzeichnis-felder">
            {(
              [
                ['email', t('Mailadresse')],
                ['name', t('Anzeigename')],
                ['vorname', t('Vorname')],
                ['nachname', t('Nachname')],
                ['telefon', t('Telefon')],
                ['mobil', t('Mobil')],
                ['organisation', t('Firma')],
                ['abteilung', t('Abteilung')],
              ] as [keyof api.Verzeichnis['felder'], string][]
            ).map(([name, wort]) => (
              <div key={name}>
                <label htmlFor={`verz-f-${name}`}>{wort}</label>
                <input
                  id={`verz-f-${name}`}
                  value={wert.felder[name] ?? ''}
                  onChange={(e) => feld(name, e.target.value)}
                />
              </div>
            ))}
          </div>

          {befund && (
            <p className={`hint${befund.ok ? ' hinweis-gut' : ' hinweis-fehler'}`} role="status">
              {befund.text}
            </p>
          )}
        </>
      )}

      <div className="verzeichnis-knoepfe">
        <button type="button" className="btn" disabled={laeuft} onClick={() => void speichern()}>
          {t('Speichern')}
        </button>
        {wert.aktiv && (
          <button
            type="button"
            className="btn secondary"
            disabled={laeuft}
            onClick={() => void pruefen()}
          >
            {t('Verbindung prüfen')}
          </button>
        )}
        {gesichert && <span className="abw-gesichert">{t('Gespeichert')}</span>}
      </div>
    </div>
  );
}
