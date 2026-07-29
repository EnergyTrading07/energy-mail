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

/**
 * Die Seite, die der Systembrowser nach der Anmeldung anzeigt.
 *
 * Die einzige Oberfläche der Anwendung, die außerhalb ihres eigenen Fensters erscheint -
 * und ausgerechnet an einer Stelle, an der es um Vertrauen geht: der Nutzer hat gerade
 * sein Passwort bei Google oder Microsoft eingegeben und wird auf 127.0.0.1
 * zurückgeleitet. Eine namenlose weiße Karte beantwortet dort die naheliegende Frage
 * nicht, nämlich ob er auch wirklich wieder bei dem Programm gelandet ist, das ihn
 * hingeschickt hat.
 *
 * Deshalb steht hier dasselbe Zeichen und dieselbe Farbe wie in der Anwendung, und die
 * Seite folgt der Systemeinstellung für die dunkle Ansicht - so wie das Fenster daneben.
 * Alles inline: es gibt keinen zweiten Abruf, den diese kurzlebige Seite überstehen
 * würde, und keine Datei, die mitgepackt werden müsste.
 */
function antwortSeite(titel: string, text: string, art: 'gut' | 'fehler' = 'gut'): string {
  const zeichen =
    art === 'gut'
      ? '<path d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M5.3 8.2l2 2 3.4-3.9"/>'
      : '<path d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M8 5v3.6 M8 10.9h.01"/>';

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titel} · Energy Mail</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='7.5' fill='%232f5fd8'/><rect x='5.5' y='9.5' width='21' height='13.5' rx='2' fill='%23fff'/><path d='M23.4 6.6L16.4 18H20l-2 9 7.6-11.6H22z' fill='%23f5c518' stroke='%231b3a86' stroke-width='1.7' stroke-linejoin='round'/></svg>">
<style>
  :root{
    --grund:#eaeef5; --karte:#fff; --rand:#dce2ec;
    --text:#131a24; --text2:#4d5867; --marke:#2f5fd8;
    --gut:#146c43; --gut-grund:#e7f5ed;
    --fehler:#bf2517; --fehler-grund:#fdecea;
    color-scheme:light dark;
  }
  @media (prefers-color-scheme:dark){
    :root{
      --grund:#0d1117; --karte:#151b24; --rand:#27313e;
      --text:#e6ecf4; --text2:#a2b0c1; --marke:#7ea6ff;
      --gut:#52cf88; --gut-grund:#0f2419;
      --fehler:#ff8b7e; --fehler-grund:#2a1512;
    }
  }
  *{box-sizing:border-box}
  body{
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    padding:24px;background:var(--grund);color:var(--text);
    font-family:'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .karte{
    width:100%;max-width:420px;padding:34px 36px;text-align:center;
    background:var(--karte);border:1px solid var(--rand);border-radius:14px;
    box-shadow:0 4px 10px rgba(19,26,36,.06),0 20px 48px rgba(19,26,36,.12);
    animation:auf .32s cubic-bezier(.2,.7,.3,1) both;
  }
  @keyframes auf{from{opacity:0;transform:translateY(10px) scale(.985)}}
  .zeichen{
    width:46px;height:46px;margin:0 auto 18px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    background:var(--${art === 'gut' ? 'gut' : 'fehler'}-grund);color:var(--${art});
  }
  h1{margin:0 0 8px;font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;
    font-size:19px;font-weight:600;letter-spacing:-.01em}
  p{margin:0;color:var(--text2);font-size:14px;line-height:1.6}
  .marke{
    display:flex;align-items:center;justify-content:center;gap:7px;
    margin-top:26px;padding-top:18px;border-top:1px solid var(--rand);
    font-size:12px;font-weight:600;color:var(--text2);letter-spacing:.01em;
  }
</style></head>
<body><div class="karte">
  <div class="zeichen">
    <svg viewBox="0 0 16 16" width="24" height="24" fill="none" stroke="currentColor"
      stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${zeichen}</svg>
  </div>
  <h1>${titel}</h1>
  <p>${text}</p>
  <div class="marke">
    <svg viewBox="0 0 32 32" width="17" height="17">
      <rect width="32" height="32" rx="7.5" fill="#2f5fd8"/>
      <rect x="5.5" y="9.5" width="21" height="13.5" rx="2" fill="#fff"/>
      <path d="M6.6 10.8 L16 18.4 L25.4 10.8" fill="none" stroke="#1b3a86" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M23.4 6.6 L16.4 18 L20 18 L18 27 L25.6 15.4 L22 15.4 Z" fill="#f5c518"
        stroke="#1b3a86" stroke-width="1.7" stroke-linejoin="round"/>
    </svg>
    Energy Mail
  </div>
</div></body></html>`;
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
      res.end(
        antwortSeite(
          'Anmeldung abgelehnt',
          'Die Rückmeldung passt nicht zur Anfrage. Bitte in Energy Mail noch einmal von vorn beginnen.',
          'fehler',
        ),
      );
      return;
    }

    if (fehler || !code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        antwortSeite(
          'Anmeldung abgebrochen',
          fehler ?? 'Es kam kein Autorisierungscode zurück.',
          'fehler',
        ),
      );
      beenden(flow, { status: 'error', error: fehler ?? 'Kein Autorisierungscode erhalten.' });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      antwortSeite(
        'Anmeldung erfolgreich',
        'Du kannst dieses Fenster schließen und zu Energy Mail zurückkehren – das Konto wird dort gerade eingerichtet.',
      ),
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
