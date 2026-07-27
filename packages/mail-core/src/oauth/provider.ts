import crypto from 'node:crypto';

/**
 * OAuth2 für Gmail und Outlook.
 *
 * Beide Anbieter sprechen denselben Standard (Authorization Code mit PKCE), daher eine
 * gemeinsame Umsetzung mit anbieterspezifischen Angaben statt zweier Sonderwege. Das
 * spart auch die beiden schweren Anbieter-Bibliotheken.
 */

export type OAuthProviderId = 'google' | 'microsoft';

interface ProviderSpec {
  name: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Zusätzliche Parameter der Autorisierungsanfrage. */
  extraAuthParams?: Record<string, string>;
  /** Wo im id_token die Mailadresse steht - Anbieter benennen das unterschiedlich. */
  emailClaims: string[];
}

const PROVIDERS: Record<OAuthProviderId, ProviderSpec> = {
  google: {
    name: 'Google / Gmail',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // "https://mail.google.com/" ist der Bereich, den Google für IMAP und SMTP verlangt.
    scopes: ['https://mail.google.com/', 'openid', 'email'],
    extraAuthParams: {
      // Ohne "offline" gibt es kein Refresh-Token, und die Anmeldung wäre nach einer
      // Stunde verfallen. "consent" erzwingt die Ausgabe auch bei erneuter Anmeldung.
      access_type: 'offline',
      prompt: 'consent',
    },
    emailClaims: ['email'],
  },
  microsoft: {
    name: 'Microsoft / Outlook',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: [
      'offline_access',
      'openid',
      'email',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
    ],
    emailClaims: ['email', 'preferred_username', 'upn'],
  },
};

export function getProviderSpec(provider: OAuthProviderId): ProviderSpec {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`Unbekannter Anbieter: ${provider}`);
  return spec;
}

export interface OAuthClientCredentials {
  clientId: string;
  /** Bei reinen Desktop-Anwendungen ("public client") vergibt Microsoft keinen. */
  clientSecret?: string;
}

export interface PendingAuth {
  provider: OAuthProviderId;
  state: string;
  codeVerifier: string;
  redirectUri: string;
}

function base64Url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * PKCE schützt davor, dass ein abgefangener Autorisierungscode allein genügt: der
 * Tausch in Token gelingt nur mit dem Prüfwert, der die Anwendung nie verlässt.
 */
export function createPendingAuth(provider: OAuthProviderId, redirectUri: string): PendingAuth {
  return {
    provider,
    state: base64Url(crypto.randomBytes(24)),
    codeVerifier: base64Url(crypto.randomBytes(48)),
    redirectUri,
  };
}

export function buildAuthUrl(
  credentials: OAuthClientCredentials,
  pending: PendingAuth,
): string {
  const spec = getProviderSpec(pending.provider);
  const challenge = base64Url(crypto.createHash('sha256').update(pending.codeVerifier).digest());

  const params = new URLSearchParams({
    client_id: credentials.clientId,
    response_type: 'code',
    redirect_uri: pending.redirectUri,
    scope: spec.scopes.join(' '),
    state: pending.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...spec.extraAuthParams,
  });

  return `${spec.authUrl}?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  /** Zeitpunkt in Millisekunden, ab dem das Zugriffstoken als verfallen gilt. */
  expiresAt?: number;
  email?: string;
  /**
   * Die tatsächlich gewährten Bereiche. Weichen sie von den angeforderten ab, scheitert
   * der IMAP-Login mit einer irreführenden Meldung ("Invalid credentials") - deshalb
   * wird das hier festgehalten, um vorher prüfen zu können.
   */
  grantedScopes?: string[];
}

/** Der Bereich, ohne den Gmail bzw. Outlook keinen IMAP-Zugriff erlauben. */
export function getMailScope(provider: OAuthProviderId): string {
  return provider === 'google'
    ? 'https://mail.google.com/'
    : 'https://outlook.office.com/IMAP.AccessAsUser.All';
}

/**
 * Prüft, ob der Mailzugriff gewährt wurde. Meldet der Anbieter keine Bereiche zurück,
 * wird nicht vorschnell abgelehnt - dann entscheidet der Verbindungsversuch.
 */
export function hasMailScope(provider: OAuthProviderId, granted: string[] | undefined): boolean {
  if (!granted || granted.length === 0) return true;
  const benoetigt = getMailScope(provider).toLowerCase();
  return granted.some((scope) => scope.toLowerCase() === benoetigt);
}

/**
 * Liest die Mailadresse aus dem id_token. Die Signatur wird nicht geprüft: das Token
 * kommt als Antwort auf unsere eigene Anfrage direkt vom Anbieter über TLS - genau der
 * Fall, für den die OpenID-Connect-Spezifikation auf die Prüfung verzichten lässt.
 */
function emailFromIdToken(idToken: string | undefined, claims: string[]): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8')) as Record<
      string,
      unknown
    >;
    for (const claim of claims) {
      const value = decoded[claim];
      if (typeof value === 'string' && value.includes('@')) return value;
    }
  } catch {
    // Unlesbares Token ist kein Grund zum Abbruch - die Adresse kann der Nutzer
    // notfalls selbst angeben.
  }
  return undefined;
}

/**
 * Kennzeichen für "die hinterlegte Anmeldung gilt nicht mehr - es hilft nur eine neue".
 *
 * Das ist kein Fehler, den ein Wiederholen behebt, und auch kein Serverproblem: das
 * Refresh-Token wurde zurückgezogen oder ist verfallen. Genau das passiert bei Google
 * nach sieben Tagen, solange das Cloud-Projekt im Testbetrieb steht. Über den Code kann
 * der Aufrufer den Fall von einer Netzwerkstörung unterscheiden, ohne die Meldung des
 * Anbieters auszuwerten.
 */
export const REAUTH_REQUIRED = 'REAUTH_REQUIRED';

/** Ob ein Fehler bedeutet, dass sich der Nutzer neu anmelden muss. */
export function isReauthRequired(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === REAUTH_REQUIRED;
}

async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const fehlercode = typeof data.error === 'string' ? data.error : undefined;
    const beschreibung =
      (typeof data.error_description === 'string' && data.error_description) ||
      fehlercode ||
      `HTTP ${response.status}`;

    // "invalid_grant" heißt bei allen OAuth-Anbietern dasselbe: der vorgelegte Nachweis
    // wird nicht mehr anerkannt. Die Rohmeldung ("Token has been expired or revoked.")
    // sagt einem Nutzer nichts, deshalb hier eine, die den nächsten Schritt nennt.
    if (fehlercode === 'invalid_grant') {
      const err = new Error(
        'Die gespeicherte Anmeldung gilt nicht mehr – bitte das Konto neu anmelden. ' +
          `(Der Anbieter meldet: ${beschreibung})`,
      ) as Error & { code?: string };
      err.code = REAUTH_REQUIRED;
      throw err;
    }

    throw new Error(`Anbieter hat die Anfrage abgelehnt: ${beschreibung}`);
  }
  return data;
}

function toTokenSet(data: Record<string, unknown>, spec: ProviderSpec): TokenSet {
  const accessToken = data.access_token;
  if (typeof accessToken !== 'string') {
    throw new Error('Antwort des Anbieters enthält kein Zugriffstoken.');
  }
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : undefined;

  return {
    accessToken,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : undefined,
    email: emailFromIdToken(typeof data.id_token === 'string' ? data.id_token : undefined, spec.emailClaims),
    // Anbieter liefern die gewährten Bereiche als eine durch Leerzeichen getrennte Liste.
    grantedScopes: typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : undefined,
  };
}

export async function exchangeCode(
  credentials: OAuthClientCredentials,
  pending: PendingAuth,
  code: string,
): Promise<TokenSet> {
  const spec = getProviderSpec(pending.provider);
  const data = await postForm(spec.tokenUrl, {
    client_id: credentials.clientId,
    ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
    code,
    grant_type: 'authorization_code',
    redirect_uri: pending.redirectUri,
    code_verifier: pending.codeVerifier,
  });
  return toTokenSet(data, spec);
}

export async function refreshAccessToken(
  provider: OAuthProviderId,
  credentials: OAuthClientCredentials,
  refreshToken: string,
): Promise<TokenSet> {
  const spec = getProviderSpec(provider);
  const data = await postForm(spec.tokenUrl, {
    client_id: credentials.clientId,
    ...(credentials.clientSecret ? { client_secret: credentials.clientSecret } : {}),
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: spec.scopes.join(' '),
  });

  const tokens = toTokenSet(data, spec);
  // Manche Anbieter geben beim Erneuern kein neues Refresh-Token zurück - dann gilt
  // das bisherige weiter.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}
