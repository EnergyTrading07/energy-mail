import {
  isReauthRequired,
  isTokenExpired,
  refreshAccessToken,
  setAccessTokenResolver,
  type AccountConfig,
} from '@energy-mail/mail-core';
import { setAuthExpired, updateAccountAuth } from './accountStore.js';
import { getOAuthClient } from './oauthStore.js';

/**
 * Sorgt dafür, dass IMAP- und SMTP-Verbindungen immer ein gültiges Zugriffstoken
 * bekommen. Erneuerte Token werden gespeichert, sonst müsste man sich nach jeder
 * Stunde neu anmelden.
 *
 * Mehrere gleichzeitige Anfragen für dasselbe Konto teilen sich eine Erneuerung -
 * ohne das würden beim Öffnen der App mehrere parallel laufen, und manche Anbieter
 * verwerfen dabei das jeweils vorige Refresh-Token.
 */
const laufend = new Map<string, Promise<string>>();

async function erneuern(config: AccountConfig): Promise<string> {
  if (config.auth.type !== 'oauth2') throw new Error('Kein OAuth-Konto.');

  const credentials = getOAuthClient(config.auth.provider);
  if (!credentials) {
    throw new Error(
      `Für ${config.auth.provider} sind keine OAuth-Zugangsdaten hinterlegt - ` +
        'das Konto kann nicht erneuert werden.',
    );
  }
  if (!config.auth.refreshToken) {
    throw new Error('Kein Refresh-Token vorhanden - das Konto muss neu verbunden werden.');
  }

  const tokens = await refreshAccessToken(
    config.auth.provider,
    credentials,
    config.auth.refreshToken,
  );

  updateAccountAuth(config.id, {
    type: 'oauth2',
    provider: config.auth.provider,
    user: config.auth.user,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  });

  return tokens.accessToken;
}

export function installTokenRefresh(logWarn: (msg: string) => void): void {
  setAccessTokenResolver(async (config) => {
    if (config.auth.type !== 'oauth2') throw new Error('Kein OAuth-Konto.');

    if (!isTokenExpired(config.auth.expiresAt)) {
      return config.auth.accessToken;
    }

    const vorhanden = laufend.get(config.id);
    if (vorhanden) return vorhanden;

    const aufgabe = erneuern(config)
      .catch((err: Error) => {
        logWarn(`Token-Erneuerung für ${config.email} fehlgeschlagen: ${err.message}`);
        // Nur beim endgültigen Aus das Konto kennzeichnen. Eine Netzwerkstörung darf
        // nicht dazu führen, dass die Oberfläche zur Neuanmeldung auffordert, obwohl
        // die hinterlegte Anmeldung noch gültig ist.
        if (isReauthRequired(err)) setAuthExpired(config.id, true);
        throw err;
      })
      .finally(() => laufend.delete(config.id));

    laufend.set(config.id, aufgabe);
    return aufgabe;
  });
}
