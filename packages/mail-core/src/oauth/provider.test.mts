import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  buildAuthUrl,
  createPendingAuth,
  endpunkte,
  getProviderSpec,
  type OAuthProviderId,
} from './provider.js';

let ok = 0;
let gesamt = 0;
const pruefe = (name: string, fn: () => void) => {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}: ${(err as Error).message}`);
  }
};

const CREDS = { clientId: 'test-client', clientSecret: 'geheim' };

console.log('Autorisierungsadresse:');

for (const provider of ['google', 'microsoft'] as OAuthProviderId[]) {
  pruefe(`${provider}: enthält alle Pflichtparameter`, () => {
    const pending = createPendingAuth(provider, 'http://127.0.0.1:12345/oauth/callback');
    const url = new URL(buildAuthUrl(CREDS, pending));
    const p = url.searchParams;

    assert.equal(p.get('client_id'), 'test-client');
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('redirect_uri'), 'http://127.0.0.1:12345/oauth/callback');
    assert.equal(p.get('state'), pending.state);
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.ok(p.get('code_challenge'), 'code_challenge fehlt');
  });

  pruefe(`${provider}: der Prüfwert selbst wird nicht übertragen`, () => {
    const pending = createPendingAuth(provider, 'http://127.0.0.1:1/cb');
    const url = buildAuthUrl(CREDS, pending);
    // Genau darin liegt der Schutz von PKCE: nur der Hash geht raus.
    assert.ok(!url.includes(pending.codeVerifier), 'code_verifier steht in der Adresse');
  });

  pruefe(`${provider}: Client-Schlüssel wird nicht in der Adresse mitgesendet`, () => {
    const pending = createPendingAuth(provider, 'http://127.0.0.1:1/cb');
    assert.ok(!buildAuthUrl(CREDS, pending).includes('geheim'));
  });
}

pruefe('code_challenge ist der SHA-256-Hash des Prüfwerts (base64url)', () => {
  const pending = createPendingAuth('google', 'http://127.0.0.1:1/cb');
  const erwartet = crypto
    .createHash('sha256')
    .update(pending.codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const gesendet = new URL(buildAuthUrl(CREDS, pending)).searchParams.get('code_challenge');
  assert.equal(gesendet, erwartet);
});

pruefe('Prüfwert und Zustandswert sind je Vorgang unterschiedlich', () => {
  const a = createPendingAuth('google', 'http://127.0.0.1:1/cb');
  const b = createPendingAuth('google', 'http://127.0.0.1:1/cb');
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.codeVerifier, b.codeVerifier);
});

pruefe('Prüfwert ist ausreichend lang (RFC 7636: 43-128 Zeichen)', () => {
  const { codeVerifier } = createPendingAuth('google', 'http://127.0.0.1:1/cb');
  assert.ok(codeVerifier.length >= 43, `nur ${codeVerifier.length} Zeichen`);
  assert.ok(codeVerifier.length <= 128);
});

pruefe('base64url ohne Sonderzeichen, die in URLs stören', () => {
  for (let i = 0; i < 20; i++) {
    const { state, codeVerifier } = createPendingAuth('google', 'http://127.0.0.1:1/cb');
    assert.ok(/^[A-Za-z0-9_-]+$/.test(state), `state enthält Sonderzeichen: ${state}`);
    assert.ok(/^[A-Za-z0-9_-]+$/.test(codeVerifier));
  }
});

console.log('\nAngeforderte Berechtigungen:');

pruefe('Google fordert den IMAP-Bereich und die Adresse an', () => {
  const scopes = getProviderSpec('google').scopes;
  assert.ok(scopes.includes('https://mail.google.com/'), 'IMAP-Bereich fehlt');
  assert.ok(scopes.includes('email'), 'ohne "email" kommt keine Adresse zurück');
});

pruefe('Google fordert ein Refresh-Token an', () => {
  // Ohne access_type=offline verfällt die Anmeldung nach einer Stunde endgültig.
  assert.equal(getProviderSpec('google').extraAuthParams?.access_type, 'offline');
});

pruefe('Microsoft fordert IMAP, SMTP und offline_access an', () => {
  const scopes = getProviderSpec('microsoft').scopes;
  assert.ok(scopes.some((s) => s.includes('IMAP.AccessAsUser.All')));
  assert.ok(scopes.some((s) => s.includes('SMTP.Send')));
  assert.ok(scopes.includes('offline_access'), 'ohne offline_access kein Refresh-Token');
});

console.log('\nDer Mandant bei Microsoft:');

pruefe('ohne Angabe bleibt es bei /common', () => {
  // Der richtige Weg fuer einen Privatnutzer: dort darf sich anmelden, wer will.
  assert.match(endpunkte('microsoft').authUrl, /\/common\/oauth2/);
  assert.match(endpunkte('microsoft', '   ').tokenUrl, /\/common\/oauth2/);
});

pruefe('mit Angabe steht er im Pfad - in beiden Adressen', () => {
  /*
   * Er gehoert in den PFAD und nicht als Parameter daneben. Und in BEIDE Adressen: stuende
   * er nur in der Anmeldeadresse, liefe der Tausch in Token wieder ueber /common, und die
   * Zustimmung des Administrators griffe dort nicht.
   */
  const e = endpunkte('microsoft', 'contoso.onmicrosoft.com');
  assert.match(e.authUrl, /login\.microsoftonline\.com\/contoso\.onmicrosoft\.com\/oauth2/);
  assert.match(e.tokenUrl, /login\.microsoftonline\.com\/contoso\.onmicrosoft\.com\/oauth2/);
  assert.ok(!e.authUrl.includes('/common/'));
});

pruefe('ein Schraegstrich im Mandanten kann nicht umleiten', () => {
  // Der Wert kommt aus einer Richtliniendatei. Ungeprueft zeigte "../../boese" auf eine
  // ganz andere Stelle beim Anbieter.
  const e = endpunkte('microsoft', '../../boese');
  assert.ok(!e.authUrl.includes('../'), e.authUrl);
  assert.match(e.authUrl, /login\.microsoftonline\.com\/\.\.%2F\.\.%2Fboese\//);
});

pruefe('Google hat keinen Mandanten', () => {
  const e = endpunkte('google', 'contoso.onmicrosoft.com');
  assert.equal(e.authUrl, getProviderSpec('google').authUrl);
});

pruefe('die Anmeldeadresse traegt den Mandanten', () => {
  const pending = createPendingAuth('microsoft', 'http://127.0.0.1:1234/oauth/callback');
  const url = buildAuthUrl({ clientId: 'abc', mandant: 'contoso.onmicrosoft.com' }, pending);
  assert.match(url, /\/contoso\.onmicrosoft\.com\/oauth2/);
  assert.match(url, /client_id=abc/);
  // PKCE bleibt, auch ohne Client-Schluessel - das ist der Weg fuer einen public client.
  assert.match(url, /code_challenge_method=S256/);
});

pruefe('unbekannter Anbieter wird abgewiesen', () => {
  assert.throws(() => getProviderSpec('yahoo' as OAuthProviderId), /Unbekannter Anbieter/);
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
process.exit(ok === gesamt ? 0 : 1);
