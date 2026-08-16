import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import type { Account } from '../api.js';
import { bestaetige, frage } from '../dialoge.js';
import { meldeErfolg, meldeFehler } from '../meldungen.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';

/**
 * Die S/MIME-Zertifikate.
 *
 * ## Was hier anders ist als beim Schlüsselbund
 *
 * Bei OpenPGP legt man sich seinen Schlüssel selbst an; hier bekommt man ihn. Eine
 * Ausgabestelle prüft, wer man ist, und stellt ein Zertifikat aus - meist als `.p12`-Datei
 * mit einem Kennwort. Genau diese Datei nimmt das Fenster entgegen, denn genau diese Datei
 * hat der Nutzer in der Hand. Ihn zu bitten, sie erst mit einem Werkzeug zu zerlegen,
 * hieße, ihn nicht zu bitten.
 *
 * ## Warum die Fremden meist von selbst dastehen
 *
 * Weil jede unterschriebene Nachricht ihr Zertifikat mitbringt. Wer einmal unterschrieben
 * geschrieben hat, steht ab da hier - und kann verschlüsselte Post bekommen, ohne dass
 * jemand etwas eingerichtet hätte. Der Knopf für eine Datei ist der Ausnahmeweg für
 * jemanden, der noch nie unterschrieben geschrieben hat.
 */

interface Props {
  accounts: Account[];
  onClose: () => void;
}

/** Der Fingerabdruck in Vierergruppen - so liest man ihn jemandem am Telefon vor. */
const gruppiert = (fingerabdruck: string) => fingerabdruck.replace(/(.{4})/g, '$1 ').trim();

const alsDatum = (iso: string) => new Date(iso).toLocaleDateString();

export function ZertifikatModal({ accounts, onClose }: Props) {
  const [zertifikate, setZertifikate] = useState<api.ZertifikatEintrag[]>([]);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const schluesseldatei = useRef<HTMLInputElement>(null);
  const zertifikatdatei = useRef<HTMLInputElement>(null);
  /** Für welches Konto die nächste Schlüsseldatei gilt - bei nur einem Konto entfällt es. */
  const [fuerKonto, setFuerKonto] = useState(accounts[0]?.id ?? '');
  /**
   * Ob der Schlüssel bei jeder Benutzung ein Kennwort verlangt.
   *
   * Voreingestellt ist ja, und der Hinweis darunter sagt auch warum. Ohne diese zweite
   * Schranke kann jeder, der am angemeldeten Rechner sitzt, in fremdem Namen
   * unterschreiben - in einem Büro mit unverschlossenen Bildschirmen ist das der
   * schlechtere Tausch.
   */
  const [mitKennwort, setMitKennwort] = useState(true);

  const laden = async () => {
    try {
      setZertifikate(await api.ladeZertifikate());
    } catch (err) {
      setFehler((err as Error).message);
    }
  };
  useEffect(() => {
    void laden();
  }, []);

  /** Eine Datei als Base64 - der Weg, auf dem der Server sie entgegennimmt. */
  const alsBase64 = async (datei: File) => {
    const bytes = new Uint8Array(await datei.arrayBuffer());
    let roh = '';
    for (const byte of bytes) roh += String.fromCharCode(byte);
    return btoa(roh);
  };

  const schluesseldateiAufnehmen = async (datei: File) => {
    const kennwort = await frage({
      titel: t('Kennwort der Schlüsseldatei'),
      text: t(
        'Diese Datei ist mit einem Kennwort verschlossen – dem, das Sie beim Ausstellen oder beim Ausführen vergeben haben.',
      ),
      ok: t('Einlesen'),
      geheim: true,
    });
    if (kennwort === null) return;

    let neuesKennwort: string | undefined;
    if (mitKennwort) {
      const eingabe = await frage({
        titel: t('Kennwort für die Benutzung'),
        text: t(
          'Mit diesem Kennwort wird der Schlüssel hier abgelegt. Sie werden bei jedem Unterschreiben und bei jeder verschlüsselten Nachricht danach gefragt. Es darf dasselbe sein.',
        ),
        ok: t('Übernehmen'),
        geheim: true,
      });
      if (eingabe === null) return;
      neuesKennwort = eingabe || undefined;
    }

    setBusy(true);
    setFehler(null);
    try {
      const aufgenommen = await api.ladeSchluesseldateiHoch(await alsBase64(datei), kennwort, {
        neuesKennwort,
        fuerKonto: fuerKonto || undefined,
      });
      await laden();
      meldeErfolg(
        t('Zertifikat eingelesen'),
        aufgenommen.map((z) => z.angaben.adressen.join(', ')).join(' · '),
      );
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const zertifikatAufnehmen = async (datei: File) => {
    setBusy(true);
    setFehler(null);
    try {
      const eintrag = await api.fuegeZertifikatHinzu(await alsBase64(datei));
      await laden();
      meldeErfolg(t('Zertifikat aufgenommen'), eintrag.angaben.adressen.join(', '));
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entfernen = async (eintrag: api.ZertifikatEintrag) => {
    const ja = await bestaetige({
      titel: eintrag.eigen ? t('Eigenes Zertifikat entfernen?') : t('Zertifikat entfernen?'),
      text: eintrag.eigen
        ? t(
            'Danach lässt sich damit nicht mehr unterschreiben – und Post, die damit verschlüsselt wurde, nicht mehr öffnen. Auch alte. Behalten Sie die Schlüsseldatei.',
          )
        : t('Danach lässt sich an diese Adresse nicht mehr verschlüsselt schreiben.'),
      ok: t('Entfernen'),
    });
    if (!ja) return;
    try {
      await api.entferneZertifikat(eintrag.fingerabdruck);
      await laden();
    } catch (err) {
      meldeFehler(t('Entfernen nicht möglich'), (err as Error).message);
    }
  };

  const eigene = zertifikate.filter((z) => z.eigen);
  const fremde = zertifikate.filter((z) => !z.eigen);
  const jetzt = Date.now();

  const zeile = (eintrag: api.ZertifikatEintrag) => {
    const a = eintrag.angaben;
    const abgelaufen = new Date(a.giltBis).getTime() < jetzt;
    return (
      <div
        key={eintrag.fingerabdruck}
        className={`schluessel-zeile${abgelaufen ? ' hinfaellig' : ''}`}
      >
        <div className="schluessel-text">
          <div className="schluessel-wer">
            {a.name}
            <span className="schluessel-adresse">{a.adressen.join(', ')}</span>
            {abgelaufen && <span className="schluessel-marke gefahr">{t('abgelaufen')}</span>}
            {!a.fuerMail && (
              <span className="schluessel-marke gefahr">{t('nicht für Mail')}</span>
            )}
            {eintrag.mitKennwort && (
              <span className="schluessel-marke">{t('mit Kennwort')}</span>
            )}
            {eintrag.quelle === 'nachricht' && (
              <span className="schluessel-marke" title={t('Kam mit einer unterschriebenen Nachricht und wurde geprüft')}>
                {t('aus einer Nachricht')}
              </span>
            )}
          </div>
          <div className="schluessel-abdruck">
            {t('von {aussteller} · gültig bis {bis}', {
              aussteller: a.aussteller,
              bis: alsDatum(a.giltBis),
            })}
          </div>
          <div
            className="schluessel-abdruck"
            title={t('Fingerabdruck – lesen Sie ihn Ihrer Gegenstelle vor, um sicherzugehen')}
          >
            {gruppiert(eintrag.fingerabdruck)}
          </div>
        </div>
        <button
          className="link-btn"
          onClick={() => {
            window.location.href = api.zertifikatAusfuhrAdresse(eintrag.fingerabdruck);
          }}
        >
          {t('Ausgeben')}
        </button>
        <button className="link-btn gefaehrlich" onClick={() => void entfernen(eintrag)}>
          {t('Entfernen')}
        </button>
      </div>
    );
  };

  return (
    <Fenster titel={t('S/MIME-Zertifikate')} onClose={onClose} klasse="modal-wide schluesselbund">
      <p className="hint">
        {t(
          'Mit S/MIME lässt sich Post unterschreiben und verschlüsseln – so, wie es Outlook und die meisten Unternehmen tun. Ihr Zertifikat kommt von einer Ausgabestelle, meist als .p12-Datei. Der geheime Teil bleibt auf diesem Rechner und liegt verschlüsselt.',
        )}
      </p>

      {fehler && <div className="error-banner">{fehler}</div>}

      <h4>{t('Ihre eigenen')}</h4>
      {eigene.length === 0 ? (
        <div className="empty-state">{t('Noch kein eigenes Zertifikat.')}</div>
      ) : (
        eigene.map(zeile)
      )}

      <div className="form-row">
        {accounts.length > 1 && (
          <>
            <label htmlFor="zert-konto">{t('Gehört zu')}</label>
            <select id="zert-konto" value={fuerKonto} onChange={(e) => setFuerKonto(e.target.value)}>
              {accounts.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.email}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="verzeichnis-schalter">
          <input
            type="checkbox"
            checked={mitKennwort}
            onChange={(e) => setMitKennwort(e.target.checked)}
          />
          <span>{t('Bei jeder Benutzung nach einem Kennwort fragen')}</span>
        </label>
        <p className="hint">
          {t(
            'Empfohlen. Ohne diese Frage kann jeder, der an diesem angemeldeten Rechner sitzt, in Ihrem Namen unterschreiben und Ihre verschlüsselte Post lesen.',
          )}
        </p>
      </div>

      <h4>{t('Zertifikate anderer')}</h4>
      {fremde.length === 0 ? (
        <div className="empty-state">
          {t(
            'Noch keine. Sie erscheinen von selbst, sobald Ihnen jemand unterschrieben schreibt.',
          )}
        </div>
      ) : (
        fremde.map(zeile)
      )}

      <div className="schluessel-knoepfe">
        <input
          ref={schluesseldatei}
          type="file"
          accept=".p12,.pfx,application/x-pkcs12"
          hidden
          onChange={async (e) => {
            const datei = e.target.files?.[0];
            if (datei) await schluesseldateiAufnehmen(datei);
            if (schluesseldatei.current) schluesseldatei.current.value = '';
          }}
        />
        <input
          ref={zertifikatdatei}
          type="file"
          accept=".cer,.crt,.pem,.der,application/x-x509-ca-cert,application/pkix-cert"
          hidden
          onChange={async (e) => {
            const datei = e.target.files?.[0];
            if (datei) await zertifikatAufnehmen(datei);
            if (zertifikatdatei.current) zertifikatdatei.current.value = '';
          }}
        />
        <button className="btn" disabled={busy} onClick={() => schluesseldatei.current?.click()}>
          {t('Eigene Schlüsseldatei einlesen (.p12)')}
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={() => zertifikatdatei.current?.click()}
        >
          {t('Fremdes Zertifikat aufnehmen')}
        </button>
        <span className="adressbuch-fueller" />
        <button className="btn" onClick={onClose}>
          {t('Schließen')}
        </button>
      </div>
    </Fenster>
  );
}
