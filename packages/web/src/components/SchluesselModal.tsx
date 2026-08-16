import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';
import { bestaetige, frage } from '../dialoge.js';
import { meldeErfolg, meldeFehler, meldeWarnung } from '../meldungen.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';

/**
 * Der Schlüsselbund.
 *
 * Zwei Sorten liegen hier nebeneinander, und der Unterschied ist der wichtigste des
 * ganzen Verfahrens: der eigene geheime Schlüssel ist das, womit man unterschreibt und
 * fremde Post öffnet - er darf niemals hinaus. Die öffentlichen der anderen sind zur
 * Weitergabe gemacht und völlig unbedenklich.
 *
 * Das Fenster hält beides sichtbar auseinander.
 */

interface Props {
  accounts: Account[];
  onClose: () => void;
}

/** Der Fingerabdruck in Vierergruppen - so liest man ihn jemandem am Telefon vor. */
const gruppiert = (fingerabdruck: string) =>
  fingerabdruck.replace(/(.{4})/g, '$1 ').trim();

export function SchluesselModal({ accounts, onClose }: Props) {
  const [schluessel, setSchluessel] = useState<api.SchluesselEintrag[]>([]);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [einfuegen, setEinfuegen] = useState('');
  const dateiwahl = useRef<HTMLInputElement>(null);

  const laden = async () => {
    try {
      setSchluessel(await api.ladeSchluessel());
    } catch (err) {
      setFehler((err as Error).message);
    }
  };
  useEffect(() => {
    void laden();
  }, []);

  const aufnehmen = async (armored: string, fuerKonto?: string) => {
    setBusy(true);
    setFehler(null);
    try {
      const ergebnis = await api.fuegeSchluesselHinzu(armored, fuerKonto);
      await laden();
      setEinfuegen('');
      const neu = ergebnis.aufgenommen.length - ergebnis.ersetzt;
      meldeErfolg(
        `${ergebnis.aufgenommen.length} Schlüssel aufgenommen`,
        [neu > 0 && `${neu} neu`, ergebnis.ersetzt > 0 && `${ergebnis.ersetzt} erneuert`]
          .filter(Boolean)
          .join(' · '),
      );
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entfernen = async (eintrag: api.SchluesselEintrag) => {
    const geheim = eintrag.angaben.geheim;
    const ja = await bestaetige({
      titel: geheim ? t('Geheimen Schlüssel wirklich entfernen?') : t('Schlüssel entfernen?'),
      text: geheim
        ? t(
            'Ohne diesen Schlüssel lassen sich alle bisher an Sie verschlüsselten Nachrichten NIE WIEDER öffnen – auch die, die schon in Ihrem Postfach liegen. Es gibt keinen Weg zurück. Legen Sie vorher eine Sicherung an.',
          )
        : t(
            'Unterschriften dieses Absenders lassen sich danach nicht mehr prüfen, und an ihn verschlüsseln geht auch nicht mehr. Der Schlüssel lässt sich jederzeit wieder aufnehmen.',
          ),
      stil: geheim ? 'gefahr' : 'warnung',
      ok: t('Entfernen'),
    });
    if (!ja) return;

    try {
      await api.entferneSchluessel(eintrag.fingerabdruck, geheim);
      await laden();
    } catch (err) {
      setFehler((err as Error).message);
    }
  };

  const neuesPaar = async (konto: Account) => {
    const kennwort = await frage({
      titel: t('Schlüsselpaar für {adresse}', { adresse: konto.email }),
      text: t(
        'Vergeben Sie ein Kennwort für den geheimen Schlüssel. Es schützt ihn, falls jemand an Ihren Rechner kommt, und wird nirgends gespeichert – Sie brauchen es bei jeder Unterschrift. Leer lassen geht auch, dann ist der Schlüssel ungeschützt.',
      ),
      ok: t('Erzeugen'),
      geheim: true,
    });
    if (kennwort === null) return;

    setBusy(true);
    setFehler(null);
    try {
      const erzeugt = await api.erzeugeSchluesselpaar(konto.id, kennwort || undefined);
      await laden();
      meldeErfolg(
        t('Schlüsselpaar angelegt'),
        t('{kennung} – geben Sie den öffentlichen Teil an Ihre Gegenstellen weiter.', {
          kennung: gruppiert(erzeugt.angaben.kennung),
        }),
      );
      if (!kennwort) {
        meldeWarnung(
          t('Der Schlüssel ist ohne Kennwort'),
          t(
            'Wer an Ihren angemeldeten Rechner kommt, kann damit unterschreiben und Ihre Post lesen.',
          ),
        );
      }
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const eigene = schluessel.filter((s) => s.angaben.geheim);
  const fremde = schluessel.filter((s) => !s.angaben.geheim);
  const ohneSchluessel = accounts.filter(
    (k) => !eigene.some((s) => s.angaben.adressen.includes(k.email.toLowerCase())),
  );

  const zeile = (eintrag: api.SchluesselEintrag) => {
    const a = eintrag.angaben;
    const unbrauchbar = a.abgelaufen || a.zurueckgezogen;
    return (
      <div key={`${eintrag.fingerabdruck}-${a.geheim}`} className={`schluessel-zeile${unbrauchbar ? ' hinfaellig' : ''}`}>
        <div className="schluessel-text">
          <div className="schluessel-wer">
            {a.namen[0] ?? a.adressen[0] ?? t('(ohne Namen)')}
            {a.namen[0] && a.adressen[0] && (
              <span className="schluessel-adresse">{a.adressen.join(', ')}</span>
            )}
            {a.zurueckgezogen && (
              <span className="schluessel-marke gefahr">{t('zurückgezogen')}</span>
            )}
            {a.abgelaufen && !a.zurueckgezogen && (
              <span className="schluessel-marke gefahr">{t('abgelaufen')}</span>
            )}
          </div>
          <div className="schluessel-abdruck" title={t('Fingerabdruck – lesen Sie ihn Ihrer Gegenstelle vor, um sicherzugehen')}>
            {gruppiert(eintrag.fingerabdruck)}
          </div>
        </div>
        {!a.geheim && (
          <button
            className="link-btn"
            onClick={() => {
              window.location.href = api.schluesselAusfuhrAdresse(eintrag.fingerabdruck);
            }}
          >{t('Ausgeben')}</button>
        )}
        <button className="link-btn gefaehrlich" onClick={() => void entfernen(eintrag)}>{t('Entfernen')}</button>
      </div>
    );
  };

  return (
    <Fenster titel="OpenPGP-Schlüssel" onClose={onClose} klasse="modal-wide schluesselbund">
      <p className="hint">
        Mit OpenPGP lässt sich Post unterschreiben und verschlüsseln. Ihr geheimer Schlüssel
        bleibt auf diesem Rechner und liegt verschlüsselt – die öffentlichen der anderen sind
        zur Weitergabe gemacht.
      </p>

      {fehler && <div className="error-banner">{fehler}</div>}

      <h4>{t('Ihre eigenen')}</h4>
      {eigene.length === 0 ? (
        <div className="empty-state">{t('Noch kein eigener Schlüssel.')}</div>
      ) : (
        eigene.map(zeile)
      )}

      {ohneSchluessel.length > 0 && (
        <div className="schluessel-anlegen">
          {ohneSchluessel.map((konto) => (
            <button
              key={konto.id}
              className="btn secondary"
              disabled={busy}
              onClick={() => void neuesPaar(konto)}
            >
              Paar für {konto.email} erzeugen
            </button>
          ))}
        </div>
      )}

      <h4>{t('Schlüssel anderer')}</h4>
      {fremde.length === 0 ? (
        <div className="empty-state">{t('Noch keine fremden Schlüssel.')}</div>
      ) : (
        fremde.map(zeile)
      )}

      <h4>{t('Aufnehmen')}</h4>
      <div className="form-row">
        <textarea
          rows={4}
          className="schluessel-eingabe"
          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;…"
          value={einfuegen}
          onChange={(e) => setEinfuegen(e.target.value)}
          disabled={busy}
        />
        <p className="hint">
          Einen Schlüssel hier einfügen oder eine Datei wählen. Geheime Schlüssel werden
          verschlüsselt abgelegt; ihr Kennwort wird nicht gespeichert.
        </p>
      </div>

      <div className="schluessel-knoepfe">
        <input
          ref={dateiwahl}
          type="file"
          accept=".asc,.gpg,.pgp,.key,application/pgp-keys,text/plain"
          hidden
          onChange={async (e) => {
            const datei = e.target.files?.[0];
            if (datei) await aufnehmen(await datei.text());
            if (dateiwahl.current) dateiwahl.current.value = '';
          }}
        />
        <button
          className="btn"
          disabled={busy || !einfuegen.trim()}
          onClick={() => void aufnehmen(einfuegen)}
        >{t('Aus dem Feld aufnehmen')}</button>
        <button className="btn secondary" disabled={busy} onClick={() => dateiwahl.current?.click()}>{t('Aus einer Datei')}</button>
        <span className="adressbuch-fueller" />
        <button className="btn" onClick={onClose}>{t('Schließen')}</button>
      </div>
    </Fenster>
  );
}
