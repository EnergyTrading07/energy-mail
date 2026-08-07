import { useState } from 'react';
import type { Account, Identitaet } from '../api.js';
import { pruefeIdentitaet } from '../identitaeten.js';
import { RichTextEditor } from './RichTextEditor.js';

interface Props {
  account: Account;
  onClose: () => void;
  onSave: (settings: { displayName?: string; signature?: string; identitaeten?: Identitaet[] }) => Promise<void>;
}

export function AccountSettingsModal({ account, onClose, onSave }: Props) {
  const [displayName, setDisplayName] = useState(account.displayName ?? '');
  const [signature, setSignature] = useState(account.signature ?? '');
  const [identitaeten, setIdentitaeten] = useState<Identitaet[]>(account.identitaeten ?? []);
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
      await onSave({ displayName, signature, identitaeten });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Einstellungen für {account.email}</h3>
        <form onSubmit={submit}>
          <div className="form-row">
            <label>Angezeigter Name</label>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="z.B. Hendrik Zeuch"
              disabled={busy}
            />
            <p className="hint">
              Empfänger sehen diesen Namen statt der nackten Adresse. Leer lassen, um nur die
              Adresse anzuzeigen.
            </p>
          </div>

          <div className="form-row">
            <label>Signatur</label>
            <RichTextEditor html={signature} onChange={setSignature} disabled={busy} />
            <p className="hint">
              Wird beim Verfassen automatisch eingesetzt – bei Antworten oberhalb des zitierten
              Verlaufs, damit sie nicht darunter verschwindet.
            </p>
          </div>

          <div className="form-row">
            <label>Weitere Absenderadressen</label>
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
                >
                  Entfernen
                </button>
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
                aria-label="Weitere Adresse"
                disabled={busy}
              />
              <input
                value={neuerName}
                onChange={(e) => setNeuerName(e.target.value)}
                placeholder="Name (freilassen für den des Kontos)"
                aria-label="Name für diese Adresse"
                disabled={busy}
              />
              <button type="button" className="btn secondary" disabled={busy} onClick={hinzufuegen}>
                Hinzufügen
              </button>
            </div>
            {adressFehler && <p className="hint hinweis-fehler">{adressFehler}</p>}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="form-row" style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              Abbrechen
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
