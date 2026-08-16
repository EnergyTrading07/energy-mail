import { useId, useState } from 'react';
import type { Account, Identitaet } from '../api.js';
import { pruefeIdentitaet } from '../identitaeten.js';
import { RichTextEditor } from './RichTextEditor.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';
import { FreigabeTeil } from './FreigabeTeil.js';
import { LesebestaetigungTeil } from './LesebestaetigungTeil.js';

interface Props {
  account: Account;
  onClose: () => void;
  onSave: (settings: {
    displayName?: string;
    signature?: string;
    identitaeten?: Identitaet[];
    proxy?: string;
  }) => Promise<void>;
}

export function AccountSettingsModal({ account, onClose, onSave }: Props) {
  // Eine Kennung je Feld, damit die Beschriftung daneben darauf zeigen kann.
  const felder = useId();
  const [displayName, setDisplayName] = useState(account.displayName ?? '');
  const [signature, setSignature] = useState(account.signature ?? '');
  const [identitaeten, setIdentitaeten] = useState<Identitaet[]>(account.identitaeten ?? []);
  /*
   * Leer beginnen, auch wenn einer eingetragen ist.
   *
   * Der Server gibt den Proxy ohne Anmeldung heraus (siehe publicAccount) - stuende der
   * gekuerzte Wert im Feld, wuerde er beim naechsten Speichern so uebernommen, und die
   * Anmeldung waere weg. Was eingetragen ist, steht deshalb im Hinweis darunter; wer
   * aendern will, traegt vollstaendig neu ein.
   */
  const [proxy, setProxy] = useState('');
  const [neueAdresse, setNeueAdresse] = useState('');
  const [neuerName, setNeuerName] = useState('');
  const [adressFehler, setAdressFehler] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hinzufuegen = () => {
    const beanstandung = pruefeIdentitaet({ email: account.email, identitaeten }, neueAdresse);
    if (beanstandung) {
      setAdressFehler(beanstandung);
      return;
    }
    setIdentitaeten((v) => [
      ...v,
      {
        // Über die Zeit eindeutig, ohne dafür eine Bibliothek zu brauchen.
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        email: neueAdresse.trim(),
        displayName: neuerName.trim() || undefined,
      },
    ]);
    setNeueAdresse('');
    setNeuerName('');
    setAdressFehler(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      /*
       * Den Proxy nur mitschicken, wenn das Feld angefasst wurde.
       *
       * Sonst loeschte jedes Speichern des Anzeigenamens den Proxy - das Feld ist ja
       * absichtlich leer. Der Server behandelt "nicht mitgeschickt" und "leer" deshalb
       * verschieden (siehe updateAccountSettings).
       */
      await onSave({
        displayName,
        signature,
        identitaeten,
        ...(proxy.trim() ? { proxy } : {}),
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Fenster titel={`Einstellungen für ${account.email}`} onClose={onClose} klasse="modal-wide">
      <form onSubmit={submit}>
        <div className="form-row">
          <label htmlFor={`${felder}-name`}>{t('Angezeigter Name')}</label>
          <input
            id={`${felder}-name`}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('z.B. Hendrik Zeuch')}
            disabled={busy}
          />
          <p className="hint">
            Empfänger sehen diesen Namen statt der nackten Adresse. Leer lassen, um nur die
            Adresse anzuzeigen.
          </p>
        </div>

        <div className="form-row">
          <span className="feld-titel">{t('Signatur')}</span>
          <RichTextEditor
            html={signature}
            onChange={setSignature}
            disabled={busy}
            beschriftung="Signatur"
          />
          <p className="hint">
            Wird beim Verfassen automatisch eingesetzt – bei Antworten oberhalb des zitierten
            Verlaufs, damit sie nicht darunter verschwindet.
          </p>
        </div>

        {/*
          Der Weg nach draußen, wenn es keinen direkten gibt.

          Steht unter den Absenderadressen und nicht darüber: die allermeisten brauchen
          das Feld nie. Wer es braucht, weiß es - und findet es dann an der Stelle, an der
          man Technisches erwartet.
        */}
        <div className="form-row">
          <label htmlFor={`${felder}-proxy`}>{t('Proxy')}</label>
          <input
            id={`${felder}-proxy`}
            value={proxy}
            onChange={(e) => setProxy(e.target.value)}
            placeholder="proxy.firma.de:3128"
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="hint">
            Nur nötig, wenn dieses Postfach nicht unmittelbar erreichbar ist – in
            Firmennetzen der Regelfall. Leer heißt nicht „direkt“, sondern „wie überall
            sonst“: dann gilt die Einstellung von Windows. Möglich sind{' '}
            <code>proxy.firma.de:3128</code> und <code>socks5://…</code>, bei Bedarf mit
            Anmeldung (<code>name:kennwort@…</code>).
            {account.proxy ? (
              <>
                {' '}
                Eingetragen ist derzeit <strong>{account.proxy}</strong>; eine etwaige
                Anmeldung wird hier nicht angezeigt.
              </>
            ) : null}
          </p>
        </div>

        <div className="form-row">
          <span className="feld-titel">{t('Weitere Absenderadressen')}</span>
          <p className="hint">
            Aliase und Adressen, die auf dasselbe Postfach zeigen. Verschickt wird immer über
            denselben Server – nur der Absender ist ein anderer. Auf Post an eine dieser
            Adressen antwortet Energy Mail von selbst unter ihr.
          </p>

          {identitaeten.map((i) => (
            <div key={i.id} className="identitaet-zeile">
              <div className="identitaet-text">
                <strong>{i.email}</strong>
                <span>{i.displayName || `Name wie beim Konto${account.displayName ? ` (${account.displayName})` : ''}`}</span>
              </div>
              <button
                type="button"
                className="link-btn"
                disabled={busy}
                onClick={() => setIdentitaeten((v) => v.filter((x) => x.id !== i.id))}
              >{t('Entfernen')}</button>
            </div>
          ))}

          <div className="form-row identitaet-neu">
            <input
              value={neueAdresse}
              onChange={(e) => {
                setNeueAdresse(e.target.value);
                setAdressFehler(null);
              }}
              placeholder="info@meine-firma.de"
              aria-label={t('Weitere Adresse')}
              disabled={busy}
            />
            <input
              value={neuerName}
              onChange={(e) => setNeuerName(e.target.value)}
              placeholder={t('Name (freilassen für den des Kontos)')}
              aria-label={t('Name für diese Adresse')}
              disabled={busy}
            />
            <button type="button" className="btn secondary" disabled={busy} onClick={hinzufuegen}>{t('Hinzufügen')}</button>
          </div>
          {adressFehler && <p className="hint hinweis-fehler">{adressFehler}</p>}
        </div>

        <LesebestaetigungTeil kontoId={account.id} />

        <FreigabeTeil kontoId={account.id} email={account.email} />

        {error && <div className="error-banner">{error}</div>}

        <div className="form-row" style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>{t('Abbrechen')}</button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? 'Speichere…' : 'Speichern'}
          </button>
        </div>
      </form>
    </Fenster>
  );
}
