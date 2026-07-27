import { resolveAccessToken } from './oauth/tokenAccess.js';
import type { AccountConfig } from './types.js';

/**
 * Interner Helfer - wird bewusst nicht über index.ts nach außen exportiert.
 *
 * Bei OAuth wird das Token bei jedem Verbindungsaufbau frisch angefordert: die im Konto
 * gespeicherte Fassung verfällt nach etwa einer Stunde, und der Postfach-Watcher hält
 * seine Verbindung deutlich länger.
 */
export async function buildImapAuth(config: AccountConfig) {
  if (config.auth.type === 'password') {
    return { user: config.auth.user, pass: config.auth.pass };
  }
  return { user: config.auth.user, accessToken: await resolveAccessToken(config) };
}
