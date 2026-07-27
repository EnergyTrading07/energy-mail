import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  buildAuthUrl,
  createPendingAuth,
  exchangeCode,
  getProviderSpec,
  type OAuthProviderId,
  type PendingAuth,
  type TokenSet,
} from '@energy-mail/mail-core';
import { getOAuthClient } from './oauthStore.js';

/**
 * Führt die Anmeldung über einen kurzlebigen lokalen Rückkanal.
 *
 * Warum nicht einfach ein Fenster in der App? Google (und mittlerweile auch Microsoft)
 * weist Anmeldungen aus eingebetteten Browserfenstern zurück, weil der Nutzer dort nicht
 * erkennen kann, wem er sein Passwort gibt. Vorgesehen ist der Systembrowser mit
 * Rückleitung auf 127.0.0.1 - genau das passiert hier.
 */

export type FlowStatus =
  | { status: 'pending' }
  | { status: 'done'; tokens: TokenSet }
  | { status: 'error'; error: string };

interface Flow {
  pending: PendingAuth;
  status: FlowStatus;
  server: http.Server;
  timeout: ReturnType<typeof setTimeout>;
  /**
   * Gesetzt, wenn es sich um die Neuanmeldung eines bestehenden Kontos handelt. Dann
   * werden am Ende dessen Token ersetzt, statt ein zweites Konto anzulegen - Signatur,
   * Anzeigename und Einstellungen bleiben erhalten.
   */
  accountId?: string;
}

const flows = new Map<string, Flow>();

/** Nach dieser Zeit wird abgebrochen, damit kein Rückkanal dauerhaft offen bleibt. */
const FLOW_TIMEOUT_MS = 5 * 60 * 1000;

function antwortSeite(titel: string, text: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${titel}</title><style>
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#f5f5f5}
div{background:#fff;padding:32px 40px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.1);text-align:center}
h1{font-size:18px;margin:0 0 8px}p{color:#555;font-size:14px;margin:0}
</style></head><body><div><h1>${titel}</h1><p>${text}</p></div></body></html>`;
}

function beenden(flow: Flow, status: FlowStatus): void {
  flow.status = status;
  clearTimeout(flow.timeout);
  flow.server.close();
}

export interface StartedFlow {
  state: string;
  authUrl: string;
}

export async function startOAuthFlow(
  provider: OAuthProviderId,
  accountId?: string,
): Promise<StartedFlow> {
  const credentials = getOAuthClient(provider);
  if (!credentials) {
    throw new Error(
      `Für ${getProviderSpec(provider).name} sind keine OAuth-Zugangsdaten hinterlegt. ` +
        'Bitte zuerst in den Einstellungen eintragen.',
    );
  }

  // Port 0 lässt das Betriebssystem einen freien Port wählen.
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as AddressInfo).port;

  // Microsoft verlangt "localhost" in der Registrierung, Google empfiehlt 127.0.0.1.
  const host = provider === 'microsoft' ? 'localhost' : '127.0.0.1';
  const pending = createPendingAuth(provider, `http://${host}:${port}/oauth/callback`);

  const flow: Flow = {
    pending,
    status: { status: 'pending' },
    server,
    accountId,
    timeout: setTimeout(() => {
      beenden(flow, { status: 'error', error: 'Zeitüberschreitung – Anmeldung nicht abgeschlossen.' });
    }, FLOW_TIMEOUT_MS),
  };

  server.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}:${port}`);
    if (url.pathname !== '/oauth/callback') {
      res.writeHead(404).end();
      return;
    }

    const fehler = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // Der Zustandswert bindet die Rückleitung an unsere eigene Anfrage.
    if (state !== pending.state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(antwortSeite('Anmeldung abgelehnt', 'Die Rückmeldung passt nicht zur Anfrage.'));
      return;
    }

    if (fehler || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(antwortSeite('Anmeldung abgebrochen', fehler ?? 'Kein Autorisierungscode erhalten.'));
      beenden(flow, { status: 'error', error: fehler ?? 'Kein Autorisierungscode erhalten.' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      antwortSeite('Anmeldung erfolgreich', 'Du kannst dieses Fenster schließen und zu Energy Mail zurückkehren.'),
    );

    exchangeCode(credentials, pending, code)
      .then((tokens) => beenden(flow, { status: 'done', tokens }))
      .catch((err: Error) => beenden(flow, { status: 'error', error: err.message }));
  });

  flows.set(pending.state, flow);
  return { state: pending.state, authUrl: buildAuthUrl(credentials, pending) };
}

/** Status samt Anbieter - der Aufrufer kennt beim Abfragen nur den Zustandswert. */
export function getFlow(
  state: string,
): { provider: OAuthProviderId; status: FlowStatus; accountId?: string } | null {
  const flow = flows.get(state);
  return flow
    ? { provider: flow.pending.provider, status: flow.status, accountId: flow.accountId }
    : null;
}

/** Nach dem Abholen des Ergebnisses aufräumen - Token sollen nicht im Speicher liegen. */
export function clearFlow(state: string): void {
  const flow = flows.get(state);
  if (flow) {
    clearTimeout(flow.timeout);
    flow.server.close();
    flows.delete(state);
  }
}
