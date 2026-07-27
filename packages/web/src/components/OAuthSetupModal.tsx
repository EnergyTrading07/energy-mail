import { useEffect, useState } from 'react';
import * as api from '../api.js';
import type { OAuthClients, OAuthProvider } from '../api.js';

interface Props {
  onClose: () => void;
  onChanged: (clients: OAuthClients) => void;
}

interface Anleitung {
  titel: string;
  konsole: string;
  konsoleUrl: string;
  schritte: string[];
  /** Diese Adresse muss beim Anbieter als Rückleitung eingetragen werden. */
  redirect: string;
  secretNoetig: 'ja' | 'optional';
}

const ANLEITUNG: Record<OAuthProvider, Anleitung> = {
  google: {
    titel: 'Google / Gmail',
    konsole: 'Google Cloud Console',
    konsoleUrl: 'https://console.cloud.google.com/apis/credentials',
    schritte: [
      'Projekt anlegen oder auswählen.',
      'Unter "APIs & Dienste" → "OAuth-Zustimmungsbildschirm" den Typ "Extern" wählen und die eigene Adresse als Testnutzer eintragen.',
      'Beim Bereich (Scope) "https://mail.google.com/" hinzufügen – ohne diesen erlaubt Google keinen IMAP-Zugriff.',
      'Unter "Anmeldedaten" → "OAuth-Client-ID erstellen" den Anwendungstyp "Desktop-App" wählen.',
      'Client-ID und Client-Schlüssel hier unten eintragen.',
    ],
    redirect: 'http://127.0.0.1 (beliebiger Port – bei "Desktop-App" automatisch erlaubt)',
    secretNoetig: 'ja',
  },
  microsoft: {
    titel: 'Microsoft / Outlook',
    konsole: 'Azure-Portal (App-Registrierungen)',
    konsoleUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    schritte: [
      'Neue Registrierung anlegen, als Kontotypen "Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten" wählen.',
      'Unter "Authentifizierung" die Plattform "Mobile Anwendungen und Desktopanwendungen" hinzufügen und http://localhost eintragen.',
      '"Als öffentlichen Clientfluss zulassen" aktivieren – dann ist kein Client-Schlüssel nötig.',
      'Unter "API-Berechtigungen" die Berechtigungen IMAP.AccessAsUser.All und SMTP.Send hinzufügen.',
      'Anwendungs-ID (Client) hier unten eintragen.',
    ],
    redirect: 'http://localhost (beliebiger Port)',
    secretNoetig: 'optional',
  },
};

export function OAuthSetupModal({ onClose, onChanged }: Props) {
  const [clients, setClients] = useState<OAuthClients | null>(null);
  const [provider, setProvider] = useState<OAuthProvider>('google');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hinweis, setHinweis] = useState<string | null>(null);

  useEffect(() => {
    api.fetchOAuthClients().then(setClients).catch((err) => setError((err as Error).message));
  }, []);

  // Die gespeicherte Client-ID des gewählten Anbieters anzeigen.
  useEffect(() => {
    setClientId(clients?.[provider]?.clientId ?? '');
  }, [provider, clients]);

  // Eingaben und Hinweise nur beim echten Anbieterwechsel zurücksetzen - nicht wenn
  // sich clients ändert, denn genau das passiert beim Speichern und würde die
  // Erfolgsmeldung sofort wieder löschen.
  useEffect(() => {
    setClientSecret('');
    setHinweis(null);
    setError(null);
  }, [provider]);

  const anleitung = ANLEITUNG[provider];

  const speichern = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const aktualisiert = await api.saveOAuthClient(provider, { clientId, clientSecret });
      setClients(aktualisiert);
      onChanged(aktualisiert);
      setHinweis(`${anleitung.titel} ist eingerichtet. Du kannst dich jetzt anmelden.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entfernen = async () => {
    if (!confirm(`Zugangsdaten für ${anleitung.titel} entfernen?`)) return;
    setBusy(true);
    try {
      const aktualisiert = await api.deleteOAuthClient(provider);
      setClients(aktualisiert);
      onChanged(aktualisiert);
      setClientId('');
      setHinweis(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>Gmail und Outlook einrichten</h3>

        <p className="hint" style={{ padding: '0 0 12px' }}>
          Google und Microsoft lassen IMAP nur noch mit OAuth zu. Dafür braucht jede Anwendung
          eigene Zugangsdaten, die du selbst beim Anbieter anlegen musst – das kann kein
          Programm für dich tun. Es ist einmalig pro Anbieter nötig.
        </p>

        <div className="provider-tabs">
          {(Object.keys(ANLEITUNG) as OAuthProvider[]).map((p) => (
            <button
              key={p}
              type="button"
              className={p === provider ? 'active' : undefined}
              onClick={() => setProvider(p)}
            >
              {ANLEITUNG[p].titel}
              {clients?.[p]?.configured && <span className="badge-ok">eingerichtet</span>}
            </button>
          ))}
        </div>

        <ol className="setup-steps">
          <li>
            Öffne die{' '}
            <a href={anleitung.konsoleUrl} target="_blank" rel="noreferrer">
              {anleitung.konsole}
            </a>
            .
          </li>
          {anleitung.schritte.map((schritt, i) => (
            <li key={i}>{schritt}</li>
          ))}
        </ol>

        <p className="hint" style={{ padding: '0 0 12px' }}>
          <strong>Rückleitungsadresse:</strong> {anleitung.redirect}
          <br />
          Energy Mail wählt bei jeder Anmeldung einen freien Port und leitet dorthin zurück.
        </p>

        <form onSubmit={speichern}>
          <div className="form-row">
            <label>Client-ID</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              required
              disabled={busy}
              placeholder="z.B. 1234-abcd.apps.googleusercontent.com"
            />
          </div>
          <div className="form-row">
            <label>
              Client-Schlüssel
              {anleitung.secretNoetig === 'optional' && ' (bei öffentlichem Client leer lassen)'}
            </label>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              disabled={busy}
              placeholder={
                clients?.[provider]?.configured ? 'unverändert lassen oder neu eingeben' : ''
              }
            />
          </div>

          {error && <div className="error-banner">{error}</div>}
          {hinweis && <div className="success-banner">{hinweis}</div>}

          <div className="compose-footer">
            <span className="draft-state">
              Die Zugangsdaten werden verschlüsselt gespeichert, wie die Kontopasswörter.
            </span>
            <div className="compose-actions">
              {clients?.[provider]?.configured && (
                <button type="button" className="btn danger" onClick={() => void entfernen()} disabled={busy}>
                  Entfernen
                </button>
              )}
              <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
                Schließen
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? 'Speichere…' : 'Speichern'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
