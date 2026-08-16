import { useEffect, useId, useState } from 'react';
import * as api from '../api.js';
import type { OAuthClients, OAuthProvider } from '../api.js';
import { bestaetige } from '../dialoge.js';
import { Fenster } from './Fenster.js';
import { t } from '../sprache.js';

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

/**
 * Die Anleitungen - als Funktion, nicht als Konstante.
 *
 * Auf Modulebene würde die Tabelle beim Einbinden gebaut, also bevor die Sprache
 * überhaupt feststeht; die Schritte stünden dann für immer deutsch da. Der Aufruf im
 * Baustein kostet nichts und ist der einzige Zeitpunkt, zu dem die Sprache sicher gilt.
 *
 * Die Namen der Anbieterportale bleiben unübersetzt: "Google Cloud Console" heißt beim
 * Anbieter selbst in jeder Sprache so, und wer danach sucht, sucht nach diesem Wort.
 */
function anleitungen(): Record<OAuthProvider, Anleitung> {
  return {
    google: {
      titel: 'Google / Gmail',
      konsole: 'Google Cloud Console',
      konsoleUrl: 'https://console.cloud.google.com/apis/credentials',
      schritte: [
        t('Projekt anlegen oder auswählen.'),
        t(
          'Unter "APIs & Dienste" → "OAuth-Zustimmungsbildschirm" den Typ "Extern" wählen und die eigene Adresse als Testnutzer eintragen.',
        ),
        t(
          'Beim Bereich (Scope) "https://mail.google.com/" hinzufügen – ohne diesen erlaubt Google keinen IMAP-Zugriff.',
        ),
        t(
          'Unter "Anmeldedaten" → "OAuth-Client-ID erstellen" den Anwendungstyp "Desktop-App" wählen.',
        ),
        t('Client-ID und Client-Schlüssel hier unten eintragen.'),
      ],
      redirect: t('http://127.0.0.1 (beliebiger Port – bei "Desktop-App" automatisch erlaubt)'),
      secretNoetig: 'ja',
    },
    microsoft: {
      titel: 'Microsoft / Outlook',
      konsole: 'Azure-Portal (App-Registrierungen)',
      konsoleUrl:
        'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
      schritte: [
        t(
          'Neue Registrierung anlegen, als Kontotypen "Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten" wählen.',
        ),
        t(
          'Unter "Authentifizierung" die Plattform "Mobile Anwendungen und Desktopanwendungen" hinzufügen und http://localhost eintragen.',
        ),
        t('"Als öffentlichen Clientfluss zulassen" aktivieren – dann ist kein Client-Schlüssel nötig.'),
        t(
          'Unter "API-Berechtigungen" die Berechtigungen IMAP.AccessAsUser.All und SMTP.Send hinzufügen.',
        ),
        t('Anwendungs-ID (Client) hier unten eintragen.'),
      ],
      redirect: t('http://localhost (beliebiger Port)'),
      secretNoetig: 'optional',
    },
  };
}

export function OAuthSetupModal({ onClose, onChanged }: Props) {
  // Eine Kennung je Feld, damit die Beschriftung daneben darauf zeigen kann.
  const felder = useId();
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

  const alleAnleitungen = anleitungen();
  const anleitung = alleAnleitungen[provider];
  /*
   * Von der Organisation vorgegeben: dann ist hier nichts einzurichten.
   *
   * Der Dialog zeigt in diesem Fall keine Anleitung und kein Formular, sondern sagt, was
   * gilt. Ihn ganz wegzulassen waere der naechstliegende Weg und der schlechtere - wer
   * ihn oeffnet, will wissen, woran er ist, und "es ist eingerichtet, aber nicht von dir"
   * ist genau diese Auskunft.
   */
  const vorgegeben = Boolean(clients?.[provider]?.vorgegeben);

  const speichern = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const aktualisiert = await api.saveOAuthClient(provider, { clientId, clientSecret });
      setClients(aktualisiert);
      onChanged(aktualisiert);
      setHinweis(
        t('{anbieter} ist eingerichtet. Du kannst dich jetzt anmelden.', {
          anbieter: anleitung.titel,
        }),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entfernen = async () => {
    const ja = await bestaetige({
      titel: t('Zugangsdaten für {anbieter} entfernen?', { anbieter: anleitung.titel }),
      text: t(
        'Bereits angemeldete Konten bleiben bestehen. Neue Anmeldungen sind danach erst nach erneuter Einrichtung wieder möglich.',
      ),
      stil: 'warnung',
      ok: t('Entfernen'),
    });
    if (!ja) return;
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
    <Fenster titel={t('Gmail und Outlook einrichten')} onClose={onClose} klasse="modal-wide">

      <p className="hint" style={{ padding: '0 0 12px' }}>
        {t(
          'Google und Microsoft lassen IMAP nur noch mit OAuth zu. Dafür braucht jede Anwendung eigene Zugangsdaten, die du selbst beim Anbieter anlegen musst – das kann kein Programm für dich tun. Es ist einmalig pro Anbieter nötig.',
        )}
      </p>

      <div className="provider-tabs">
        {(Object.keys(alleAnleitungen) as OAuthProvider[]).map((p) => (
          <button
            key={p}
            type="button"
            className={p === provider ? 'active' : undefined}
            onClick={() => setProvider(p)}
          >
            {alleAnleitungen[p].titel}
            {clients?.[p]?.configured && <span className="badge-ok">{t('eingerichtet')}</span>}
          </button>
        ))}
      </div>

      {vorgegeben ? (
        <>
          <div className="success-banner">
            {t(
              '{anbieter} ist von Ihrer Organisation eingerichtet. Sie können sich unmittelbar anmelden – hier ist nichts einzutragen.',
              { anbieter: anleitung.titel },
            )}
          </div>
          <p className="hint" style={{ padding: '12px 0 0' }}>
            {t('Hinterlegt ist die Anwendungs-ID')} <code>{clients?.[provider]?.clientId}</code>
            {clients?.[provider]?.mandant ? (
              <>
                {' '}
                {t('für den Mandanten')} <code>{clients[provider]!.mandant}</code>
              </>
            ) : null}
            {t('. Geändert wird das über die Richtliniendatei Ihrer Organisation, nicht hier.')}
          </p>
          <div className="compose-footer">
            <div className="compose-actions">
              <button type="button" className="btn" onClick={onClose}>{t('Schließen')}</button>
            </div>
          </div>
        </>
      ) : (
      <>
      <ol className="setup-steps">
        <li>
          {t('Öffne die')}{' '}
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
        <strong>{t('Rückleitungsadresse:')}</strong> {anleitung.redirect}
        <br />{t('Energy Mail wählt bei jeder Anmeldung einen freien Port und leitet dorthin zurück.')}</p>

      <form onSubmit={speichern}>
        <div className="form-row">
          <label htmlFor={`${felder}-id`}>{t('Client-ID')}</label>
          <input
            id={`${felder}-id`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            required
            disabled={busy}
            placeholder={t('z.B. 1234-abcd.apps.googleusercontent.com')}
          />
        </div>
        <div className="form-row">
          <label>
            {t('Client-Schlüssel')}
            {anleitung.secretNoetig === 'optional' && t(' (bei öffentlichem Client leer lassen)')}
          </label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            disabled={busy}
            placeholder={
              clients?.[provider]?.configured ? t('unverändert lassen oder neu eingeben') : ''
            }
          />
        </div>

        {error && <div className="error-banner">{error}</div>}
        {hinweis && <div className="success-banner">{hinweis}</div>}

        <div className="compose-footer">
          <span className="draft-state">{t('Die Zugangsdaten werden verschlüsselt gespeichert, wie die Kontopasswörter.')}</span>
          <div className="compose-actions">
            {clients?.[provider]?.configured && (
              <button type="button" className="btn danger" onClick={() => void entfernen()} disabled={busy}>{t('Entfernen')}</button>
            )}
            <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
              {t('Schließen')}
            </button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? t('Speichere…') : t('Speichern')}
            </button>
          </div>
        </div>
      </form>
      </>
      )}
    </Fenster>
  );
}
