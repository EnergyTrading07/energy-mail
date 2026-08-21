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
import { aktuellerNutzer } from './nutzer/kontext.js';
import { t } from '@energy-mail/mail-core/sprache';

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
   * Wem der Vorgang gehört.
   *
   * Die Vorgänge liegen in einer prozessweiten Ablage, weil der Zustandswert vom
   * Anbieter zurückkommt und nicht aus einer Sitzung. Ohne diesen Vermerk könnte im
   * Serverbetrieb jeder Angemeldete einen fremden Vorgang abfragen, wenn er dessen
   * Zustandswert kennt - und bekäme damit die Zugangsmarken zu einem fremden Postfach
   * in sein eigenes Konto gelegt. Der Wert ist zwar zufällig und kurzlebig, aber
   * "schwer zu erraten" ist keine Zugangsprüfung.
   */
  nutzerId: string;
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
/**
 * Das Programmsymbol: eine Briefmarke, durch die ein Blitz schlägt.
 *
 * Wortgleich mit Marke() in packages/web/src/components/Symbole.tsx; der Grund für die
 * Form steht dort. Hier steht es ein zweites Mal, weil dieses Paket nichts aus der
 * Oberfläche einbindet - der Server läuft auch ohne sie, und ein Import quer über die
 * Paketgrenze nur für ein Bild wäre der falsche Preis. Ändert sich das Zeichen, gehören
 * beide Stellen nachgezogen; es gibt genau diese zwei (und die Kopie in
 * packages/desktop/src/kleineFenster.ts für die Fenster ohne Oberfläche).
 */
const MARKENZEICHEN = (() => {
  const zacken = [7, 11.5, 16, 20.5, 25]
    .map(
      (p) =>
        `<circle cx="${p}" cy="2.5" r="1.6"/><circle cx="${p}" cy="29.5" r="1.6"/>` +
        `<circle cx="2.5" cy="${p}" r="1.6"/><circle cx="29.5" cy="${p}" r="1.6"/>`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">` +
    `<defs><linearGradient id="v" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="#3f5cf0"/><stop offset="1" stop-color="#1b2f9c"/>` +
    `</linearGradient><mask id="m">` +
    `<rect x="2.5" y="2.5" width="27" height="27" rx="4.5" fill="#fff"/>` +
    `<g fill="#000">${zacken}</g></mask></defs>` +
    `<g mask="url(#m)">` +
    `<rect x="2.5" y="2.5" width="27" height="27" rx="4.5" fill="url(#v)"/>` +
    `<rect x="6.4" y="7.6" width="19.2" height="16.8" rx="2" fill="#fffdf9"/></g>` +
    `<path d="M19.6 4.4 L10.6 17.2 h4.4 L12.4 27.6 L21.4 14.8 h-4.4 Z" fill="#ffb225" ` +
    `stroke="#16205e" stroke-width="1.5" stroke-linejoin="round"/></svg>`
  );
})();

/**
 * Macht aus einem Text etwas, das in HTML stehen darf.
 *
 * Nötig, weil einer der Texte unten nicht von uns stammt: bei einer abgelehnten
 * Anmeldung wird die Fehlerangabe aus dem Abfrageteil der Rückleitung übernommen, und
 * die bestimmt, wer die Adresse aufruft. Sie ging ungefiltert in die Seite. Der Weg
 * dorthin ist eng - man muss den zufälligen Port und den Zustandswert kennen -, aber
 * "schwer erreichbar" ist kein Grund, ungeprüfte Fremdeingabe in eine Seite zu
 * schreiben. Zumal es ausgerechnet die Seite ist, auf der jemand gerade sein Kennwort
 * bei Google eingegeben hat.
 */
function alsText(wert: string): string {
  return wert
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function antwortSeite(rohTitel: string, rohText: string, art: 'gut' | 'fehler' = 'gut'): string {
  const titel = alsText(rohTitel);
  const text = alsText(rohText);

  const zeichen =
    art === 'gut'
      ? '<path d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M5.3 8.2l2 2 3.4-3.9"/>'
      : '<path d="M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8z M8 5v3.6 M8 10.9h.01"/>';

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titel} · Energy Mail</title>
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(MARKENZEICHEN)}">
<style>
  /* Muessen zu packages/web/src/design/tokens.css passen - diese Seite kann es nicht
     einbinden, sie wird aus dem Speicher ausgeliefert und lebt zehn Sekunden. */
  :root{
    --grund:#f0ede6; --karte:#fffdf9; --rand:#ded9ce;
    --text:#1b1917; --text2:#55504a; --marke:#2b48d4;
    --gut:#16663f; --gut-grund:#e6f2ea;
    --fehler:#b32a1c; --fehler-grund:#fceceb;
    --glanz:inset 0 1px 0 rgba(255,255,255,.7);
    color-scheme:light dark;
  }
  @media (prefers-color-scheme:dark){
    :root{
      --grund:#090b11; --karte:#161a23; --rand:#242935;
      --text:#ebe8e2; --text2:#a8a49c; --marke:#8da6ff;
      --gut:#5cd191; --gut-grund:#0c2118;
      --fehler:#ff8f81; --fehler-grund:#291513;
      --glanz:inset 0 1px 0 rgba(255,255,255,.045);
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
    width:100%;max-width:420px;padding:36px 38px;text-align:center;
    background:var(--karte);border:1px solid var(--rand);border-radius:22px;
    box-shadow:var(--glanz),0 6px 14px rgba(58,48,34,.09),0 26px 56px rgba(30,24,16,.18);
    animation:auf .42s cubic-bezier(.16,1,.3,1) both;
  }
  @keyframes auf{from{opacity:0;transform:translateY(10px) scale(.98)}}
  .zeichen{
    width:46px;height:46px;margin:0 auto 18px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    background:var(--${art === 'gut' ? 'gut' : 'fehler'}-grund);color:var(--${art});
  }
  h1{margin:0 0 8px;font-family:'Segoe UI Variable Display','Segoe UI',system-ui,sans-serif;
    font-size:19px;font-weight:600;letter-spacing:-.015em}
  p{margin:0;color:var(--text2);font-size:14px;line-height:1.6}
  /* Gesperrte Versalien in der schmalen Schrift der Marke - dasselbe Wortzeichen wie
     in der Titelleiste der Anwendung. */
  .marke{
    display:flex;align-items:center;justify-content:center;gap:9px;
    margin-top:28px;padding-top:20px;border-top:1px solid var(--rand);
    font-family:'Bahnschrift','DIN Alternate','Segoe UI Variable Display','Segoe UI',
      system-ui,sans-serif;
    font-size:12px;font-weight:600;color:var(--text);
    letter-spacing:.16em;text-transform:uppercase;
  }
  .marke span{color:var(--text2)}
  @media (prefers-reduced-motion:reduce){.karte{animation:none}}
</style></head>
<body><div class="karte">
  <div class="zeichen">
    <svg viewBox="0 0 16 16" width="24" height="24" fill="none" stroke="currentColor"
      stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${zeichen}</svg>
  </div>
  <h1>${titel}</h1>
  <p>${text}</p>
  <div class="marke">${MARKENZEICHEN.replace('<svg', '<svg width="19" height="19"')} Energy <span>Mail</span></div>
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
    nutzerId: aktuellerNutzer(),
    timeout: setTimeout(() => {
      beenden(flow, {
        status: 'error',
        error: t('Zeitüberschreitung – Anmeldung nicht abgeschlossen.'),
      });
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
          t(
            'Die Rückmeldung passt nicht zur Anfrage. Bitte in Energy Mail noch einmal von vorn beginnen.',
          ),
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
          // Gekürzt und entschärft: die Angabe kommt aus der Adresse, nicht von uns.
          // Anbieter melden hier Kürzel wie "access_denied", keine Aufsätze.
          fehler ? fehler.slice(0, 200) : t('Es kam kein Autorisierungscode zurück.'),
          'fehler',
        ),
      );
      beenden(flow, { status: 'error', error: fehler ?? t('Kein Autorisierungscode erhalten.') });
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      antwortSeite(
        t('Anmeldung erfolgreich'),
        t(
          'Sie können dieses Fenster schließen und zu Energy Mail zurückkehren – das Konto wird dort gerade eingerichtet.',
        ),
      ),
    );

    exchangeCode(credentials, pending, code)
      .then((tokens) => beenden(flow, { status: 'done', tokens }))
      .catch((err: Error) => beenden(flow, { status: 'error', error: err.message }));
  });

  flows.set(pending.state, flow);
  return { state: pending.state, authUrl: buildAuthUrl(credentials, pending) };
}

/**
 * Der Vorgang zu einem Zustandswert - aber nur, wenn er dem Fragenden gehört.
 *
 * Ein fremder Vorgang wird behandelt, als gäbe es ihn nicht. Das ist Absicht: eine
 * eigene Meldung ("gehört jemand anderem") verriete, dass der geratene Zustandswert
 * getroffen hat.
 */
function eigenerFlow(state: string): Flow | null {
  const flow = flows.get(state);
  if (!flow) return null;
  return flow.nutzerId === aktuellerNutzer() ? flow : null;
}

/** Status samt Anbieter - der Aufrufer kennt beim Abfragen nur den Zustandswert. */
export function getFlow(
  state: string,
): { provider: OAuthProviderId; status: FlowStatus; accountId?: string } | null {
  const flow = eigenerFlow(state);
  return flow
    ? { provider: flow.pending.provider, status: flow.status, accountId: flow.accountId }
    : null;
}

/** Nach dem Abholen des Ergebnisses aufräumen - Token sollen nicht im Speicher liegen. */
export function clearFlow(state: string): void {
  const flow = eigenerFlow(state);
  if (flow) {
    clearTimeout(flow.timeout);
    flow.server.close();
    flows.delete(state);
  }
}
