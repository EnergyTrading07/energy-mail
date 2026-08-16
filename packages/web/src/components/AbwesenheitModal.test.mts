import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/*
 * Das Fenster der Abwesenheitsnotiz.
 *
 * Zwei Dinge sind hier zu pruefen, und beide sind unangenehm, wenn sie falsch sind.
 *
 * Erstens: Kommt das Gespeicherte auch wieder heraus? Ein Fenster, das den Zeitraum
 * anzeigt, aber nur den Text mitschickt, sieht in jedem Bildschirmfoto richtig aus - und
 * antwortet danach bis Weihnachten.
 *
 * Zweitens: Steht das Konto oben richtig? Die Notiz gilt je Konto. Wer geschaeftlich und
 * privat dasselbe Programm benutzt, schaltet sie sonst am falschen ein.
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
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Node = dom.window.Node;
g.getComputedStyle = dom.window.getComputedStyle;
(g as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const gerufen: { weg: string; art: string; koerper?: string }[] = [];

/** Was der Server zu Konto 1 gespeichert hat - vollstaendig, mit Zeitraum und allem. */
const GESPEICHERT = {
  aktiv: true,
  von: '2026-08-01',
  bis: '2026-08-14',
  betreff: 'Ich bin weg',
  text: 'Vielen Dank für Ihre Nachricht.',
  nurBekannte: true,
  wiederholungTage: 7,
};

g.fetch = async (url: string | URL, init?: { method?: string; body?: string }) => {
  const weg = String(url);
  gerufen.push({ weg, art: init?.method ?? 'GET', koerper: init?.body });
  const antwort = (wert: unknown) =>
    ({ ok: true, status: 200, json: async () => wert }) as unknown as Response;

  if (weg.endsWith('/accounts/k1/abwesenheit') && (init?.method ?? 'GET') === 'GET') {
    return antwort(GESPEICHERT);
  }
  if (weg.endsWith('/accounts/k2/abwesenheit') && (init?.method ?? 'GET') === 'GET') {
    return antwort({ aktiv: false, text: '', wiederholungTage: 4 });
  }
  if (init?.method === 'PUT') return antwort(JSON.parse(init.body ?? '{}'));
  return antwort({});
};

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const React = (await import('react')).default;
// Siehe VerwaltungModal.test.mts: tsx uebersetzt JSX klassisch, Vite modern.
(g as { React?: unknown }).React = React;

const { AbwesenheitModal } = await import('./AbwesenheitModal.js');

const KONTEN = [
  { id: 'k1', email: 'anna@beispiel.de' },
  { id: 'k2', email: 'anna@verein.de' },
] as never;

const wurzel = createRoot(document.getElementById('wurzel')!);

await act(async () => {
  wurzel.render(
    React.createElement(AbwesenheitModal, {
      konten: KONTEN,
      startKonto: 'k1',
      onClose: () => undefined,
    }),
  );
});

const feld = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const knoepfe = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];
const setzer = (art: 'HTMLInputElement' | 'HTMLTextAreaElement') =>
  Object.getOwnPropertyDescriptor(dom.window[art].prototype, 'value')!.set!;

console.log('\nWas gespeichert war, steht auch da:');

await pruefe('geholt wird beim Konto, das mitgegeben wurde', () => {
  assert.ok(
    gerufen.some((g) => g.weg.endsWith('/accounts/k1/abwesenheit') && g.art === 'GET'),
    `Gerufen: ${JSON.stringify(gerufen.map((g) => g.weg))}`,
  );
});

await pruefe('jedes Feld zeigt seinen Wert - auch die, die man leicht vergisst', () => {
  /*
   * Der Zeitraum und die Wiederholungsfrist sind die beiden, die ein Fenster gern
   * anzeigt, aber nicht mitschickt. Beides faellt nicht auf, bis jemand nach dem Urlaub
   * noch drei Wochen lang antwortet.
   */
  assert.equal(feld<HTMLInputElement>('abw-von').value, '2026-08-01');
  assert.equal(feld<HTMLInputElement>('abw-bis').value, '2026-08-14');
  assert.equal(feld<HTMLInputElement>('abw-betreff').value, 'Ich bin weg');
  assert.equal(feld<HTMLTextAreaElement>('abw-text').value, 'Vielen Dank für Ihre Nachricht.');
  assert.equal(feld<HTMLInputElement>('abw-tage').value, '7');
  const schalter = [...document.querySelectorAll('.abw-schalter input')] as HTMLInputElement[];
  assert.equal(schalter[0]!.checked, true, 'Der Hauptschalter steht auf aus.');
  assert.equal(schalter[1]!.checked, true, '"Nur an Bekannte" steht auf aus.');
});

await pruefe('bei mehreren Konten steht eine Auswahl oben', () => {
  const wahl = feld<HTMLSelectElement>('abw-konto');
  assert.ok(wahl, 'Die Kontoauswahl fehlt.');
  assert.equal(wahl.value, 'k1');
  assert.equal(wahl.options.length, 2);
});

console.log('\nWas hinausgeht:');

await pruefe('geaendert wird der Text - und mitgeschickt wird alles', async () => {
  const text = feld<HTMLTextAreaElement>('abw-text');
  await act(async () => {
    setzer('HTMLTextAreaElement').call(text, 'Ich bin bis zum 14. nicht da.');
    text.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  const speichern = knoepfe().find((b) => b.textContent === 'Speichern')!;
  await act(async () => {
    speichern.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });

  const gesendet = gerufen.find((g) => g.art === 'PUT');
  assert.ok(gesendet, 'Es ging kein PUT hinaus.');
  assert.ok(gesendet.weg.endsWith('/accounts/k1/abwesenheit'), gesendet.weg);
  assert.deepEqual(JSON.parse(gesendet.koerper!), {
    aktiv: true,
    von: '2026-08-01',
    bis: '2026-08-14',
    betreff: 'Ich bin weg',
    text: 'Ich bin bis zum 14. nicht da.',
    nurBekannte: true,
    wiederholungTage: 7,
  });
});

await pruefe('danach steht dort, dass es gespeichert ist', () => {
  assert.ok(document.querySelector('.abw-gesichert'), 'Keine Rueckmeldung.');
});

console.log('\nDas zweite Konto:');

await pruefe('ein Wechsel holt dessen eigene Notiz', async () => {
  const wahl = feld<HTMLSelectElement>('abw-konto');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value')!.set!.call(
      wahl,
      'k2',
    );
    wahl.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });

  assert.ok(
    gerufen.some((g) => g.weg.endsWith('/accounts/k2/abwesenheit') && g.art === 'GET'),
    'Fuer das zweite Konto wurde nichts geholt.',
  );
  // Und die Felder des ersten stehen nicht mehr da - sonst schaltete man am falschen ein.
  assert.equal(feld<HTMLTextAreaElement>('abw-text').value, '');
  assert.equal(feld<HTMLInputElement>('abw-von').value, '');
  const schalter = [...document.querySelectorAll('.abw-schalter input')] as HTMLInputElement[];
  assert.equal(schalter[0]!.checked, false);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
