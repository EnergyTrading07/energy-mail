import { useState } from 'react';
import type { Account } from '../api.js';
import { RichTextEditor } from './RichTextEditor.js';

interface Props {
  account: Account;
  onClose: () => void;
  onSave: (settings: { displayName?: string; signature?: string }) => Promise<void>;
}

export function AccountSettingsModal({ account, onClose, onSave }: Props) {
  const [displayName, setDisplayName] = useState(account.displayName ?? '');
  const [signature, setSignature] = useState(account.signature ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSave({ displayName, signature });
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
