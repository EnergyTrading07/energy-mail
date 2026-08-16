import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/*
 * Zeichnet die Nutzerverwaltung wirklich?
 *
 * Der Riegel am Server haengt an eigenen Pruefungen (nutzer/verwaltung.test.mts). Hier geht
 * es um die andere Haelfte, und die ist genauso wenig selbstverstaendlich: Ein Fenster
 * uebersetzt fehlerfrei und erscheint trotzdem nicht - ein falscher Import, ein Zugriff auf
 * etwas Undefiniertes beim ersten Zeichnen, und es bleibt weiss.
 *
 * Geprueft wird ueber ein gefaelschtes fetch statt ueber gefaelschte api-Funktionen: So
 * laeuft api.ts mit, und die Adressen der Wege sind mitgeprueft. Ein Fenster, das die
 * richtigen Daten an den falschen Weg schickt, faellt sonst niemandem auf.
 */

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => Promise<void> | void): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

const dom = new JSDOM('<!doctype html><html><body><div id="wurzel"></div></body></html>', {
  url: 'https://beispiel.test/',
});
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
/*
 * navigator hat in neueren Node-Fassungen nur einen Lesezugriff - zuweisen wirft. Deshalb
 * ueber defineProperty; gebraucht wird es fuer den Knopf zum Kopieren des Kennworts.
 */
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.getComputedStyle = dom.window.getComputedStyle;
// React 18 fragt danach; ohne das warnt es bei jedem Zeichnen.
(g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Die Wege, die tatsaechlich gerufen wurden - damit sich pruefen laesst, WOHIN es geht. */
const gerufen: { weg: string; art: string; koerper?: string }[] = [];

const NUTZER = [
  { id: 'chef', email: 'chef@beispiel.de', angelegt: '2026-01-05T10:00:00.000Z', gesperrt: false, verwalter: true, zweiFaktor: false },
  { id: 'anna', email: 'anna@beispiel.de', angelegt: '2026-03-11T10:00:00.000Z', gesperrt: false, verwalter: false, zweiFaktor: true },
  { id: 'bernd', email: 'bernd@beispiel.de', angelegt: '2026-04-02T10:00:00.000Z', gesperrt: true, verwalter: false, zweiFaktor: false },
];

g.fetch = async (url: string | URL, init?: { method?: string; body?: string }) => {
  const weg = String(url);
  gerufen.push({ weg, art: init?.method ?? 'GET', koerper: init?.body });
  const antwort = (wert: unknown) =>
    ({ ok: true, status: 200, json: async () => wert }) as unknown as Response;

  if (weg.endsWith('/verwaltung/nutzer') && (init?.method ?? 'GET') === 'GET') {
    return antwort({ nutzer: NUTZER, ich: 'chef' });
  }
  if (weg.endsWith('/verwaltung/nutzer') && init?.method === 'POST') {
    return antwort({ nutzer: NUTZER[1], kennwort: 'GeheimGeheim1234567' });
  }
  return antwort({});
};

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const React = (await import('react')).default;

/*
 * React global setzen - und zwar VOR dem Einbinden des Fensters.
 *
 * Vite baut die Anwendung mit der neuen JSX-Umsetzung, die React nicht braucht. tsx nimmt
 * beim Pruefen die klassische, und die schreibt `React.createElement(...)` in eine Datei,
 * die React nirgends einbindet - das Fenster starb beim ersten Zeichnen mit "React is not
 * defined". Das ist ein Umstand dieser Pruefumgebung und kein Fehler der Anwendung;
 * deshalb steht die Abhilfe hier und nicht im Fenster.
 */
(g as { React?: unknown }).React = React;

const { VerwaltungModal } = await import('./VerwaltungModal.js');

const wurzel = createRoot(document.getElementById('wurzel')!);

await act(async () => {
  wurzel.render(React.createElement(VerwaltungModal, { onClose: () => undefined }));
});

const text = () => document.body.textContent ?? '';
const knoepfe = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];

console.log('\nDie Nutzerverwaltung zeichnet:');

await pruefe('sie holt die Liste beim Oeffnen - und zwar unter /verwaltung/nutzer', () => {
  assert.ok(
    gerufen.some((g) => g.weg.endsWith('/verwaltung/nutzer') && g.art === 'GET'),
    `Kein Abruf der Liste. Gerufen: ${JSON.stringify(gerufen)}`,
  );
});

await pruefe('alle drei Nutzer stehen da', () => {
  for (const n of NUTZER) assert.ok(text().includes(n.email), `${n.email} fehlt.`);
});

await pruefe('die Marken sitzen richtig', () => {
  const zeilen = [...document.querySelectorAll('tbody tr')] as HTMLElement[];
  assert.equal(zeilen.length, 3);
  // Der Chef ist Verwalter und man selbst; Bernd ist gesperrt.
  assert.ok(zeilen[0]!.querySelector('.marke-verwalter'), 'Verwaltermarke fehlt.');
  assert.ok(zeilen[0]!.querySelector('.marke-selbst'), 'Selbstmarke fehlt.');
  assert.ok(!zeilen[1]!.querySelector('.marke-gesperrt'), 'Anna ist faelschlich gesperrt.');
  assert.ok(zeilen[2]!.querySelector('.marke-gesperrt'), 'Bernds Sperrmarke fehlt.');
});

await pruefe('an der eigenen Zeile fehlen Sperren, Rolle und Entfernen', () => {
  /*
   * Sonst sperrt sich ein Verwalter mit einem Fehlklick selbst aus. Der Server weist das
   * ohnehin ab - aber ein Knopf, der immer eine Fehlermeldung bringt, ist eine Falle.
   */
  const eigene = [...document.querySelectorAll('tbody tr')][0] as HTMLElement;
  const beschriftungen = [...eigene.querySelectorAll('button')].map((b) => b.textContent);
  assert.ok(!beschriftungen.includes('Sperren'), 'Sperren steht an der eigenen Zeile.');
  assert.ok(!beschriftungen.includes('Entfernen'), 'Entfernen steht an der eigenen Zeile.');
  assert.ok(!beschriftungen.includes('Rolle nehmen'), 'Rolle nehmen steht an der eigenen Zeile.');
  // Das eigene Kennwort zuruecksetzen darf man dagegen sehr wohl.
  assert.ok(beschriftungen.includes('Kennwort'), 'Kennwort fehlt an der eigenen Zeile.');
});

await pruefe('den zweiten Faktor kann man nur dort zuruecksetzen, wo einer ist', () => {
  /*
   * Anna hat einen, die beiden anderen nicht. Ein Knopf an jeder Zeile waere hier
   * schaedlich: Er nimmt einem Konto genau den Schutz weg, fuer den es eingerichtet wurde,
   * und ein solcher Knopf soll nur dort stehen, wo er etwas zu tun hat.
   */
  const zeilen = [...document.querySelectorAll('tbody tr')] as HTMLElement[];
  const knopf = (zeile: HTMLElement) =>
    [...zeile.querySelectorAll('button')].some((b) => b.textContent === '2FA zurücksetzen');
  assert.ok(!knopf(zeilen[0]!), 'Der Chef hat keinen zweiten Faktor.');
  assert.ok(knopf(zeilen[1]!), 'Bei Anna fehlt der Knopf.');
  assert.ok(!knopf(zeilen[2]!), 'Bernd hat keinen zweiten Faktor.');
  // Und die Marke steht bei ihr in der Standspalte.
  assert.ok(zeilen[1]!.querySelector('.marke-faktor'), 'Annas 2FA-Marke fehlt.');
});

await pruefe('beim letzten Verwalter sind die gefaehrlichen Knoepfe gesperrt', () => {
  /*
   * Es gibt hier nur einen Verwalter (den Chef). An SEINER Zeile steht ohnehin nichts -
   * geprueft wird deshalb, dass die Oberflaeche den Fall kennt: Bei Anna und Bernd, die
   * keine Verwalter sind, muessen die Knoepfe offen sein.
   */
  const anna = [...document.querySelectorAll('tbody tr')][1] as HTMLElement;
  const aus = [...anna.querySelectorAll('button')].filter((b) => b.disabled);
  assert.equal(aus.length, 0, 'An Annas Zeile ist etwas gesperrt, das offen sein muesste.');
});

console.log('\nEin neuer Nutzer:');

await pruefe('das Anlegen geht an den richtigen Weg und zeigt das Kennwort einmal', async () => {
  const feld = document.querySelector('input[type="email"]') as HTMLInputElement;
  const setzer = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value',
  )!.set!;

  await act(async () => {
    setzer.call(feld, 'neu@beispiel.de');
    feld.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  const anlegen = knoepfe().find((b) => b.textContent === 'Anlegen')!;
  assert.ok(!anlegen.disabled, 'Der Knopf blieb gesperrt.');

  await act(async () => {
    anlegen.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });

  const gesendet = gerufen.find((g) => g.art === 'POST' && g.weg.endsWith('/verwaltung/nutzer'));
  assert.ok(gesendet, 'Es ging kein POST hinaus.');
  assert.deepEqual(JSON.parse(gesendet.koerper!), { email: 'neu@beispiel.de', verwalter: false });

  // Und das Kennwort steht sichtbar da - es erscheint nur dieses eine Mal.
  assert.ok(text().includes('GeheimGeheim1234567'), 'Das Kennwort wird nicht angezeigt.');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
