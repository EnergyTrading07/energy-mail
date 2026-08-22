import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/*
 * Das Anmeldefenster - und vor allem: was daran NICHT immer dasteht.
 *
 * Drei Dinge sind seit der Selbstanmeldung dazugekommen: der Umschalter zum Anlegen, der
 * Weg bei einem vergessenen Kennwort und die Sprachwahl. Die ersten beiden duerfen nur
 * dort erscheinen, wo sie auch irgendwohin fuehren - entschieden wird das am SERVER, und
 * genau diese Weitergabe wird hier geprueft. Ein Knopf, der in eine Fehlermeldung fuehrt,
 * ist schlimmer als keiner: Der Mensch davor kann nichts dafuer und versucht es dreimal.
 *
 * Geprueft wird ueber das gezeichnete Fenster und nicht ueber die Props: Ein Baustein, der
 * die richtige Bedingung hat und sie an der falschen Stelle auswertet, faellt sonst
 * niemandem auf.
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
// Das Anmeldefenster ruft von sich aus nichts ab; die Lage kommt als Prop herein.
g.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) }) as unknown as Response;

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const React = (await import('react')).default;
(g as { React?: unknown }).React = React;

const { Anmeldung } = await import('./Anmeldung.js');

/** Die Lage, wie sie GET /registrierung liefert - hier alles offen. */
const LAGE = {
  moeglich: true,
  betriebsart: 'freigabe' as const,
  domaenen: [],
  hinweis: 'Kurzer Hinweis.',
  kennwortMindestlaenge: 10,
  mitBestaetigung: true,
  kennwortZuruecksetzbar: true,
};

const wurzel = createRoot(document.getElementById('wurzel')!);

async function zeichne(props: Record<string, unknown>): Promise<void> {
  await act(async () => {
    wurzel.render(
      React.createElement(Anmeldung, {
        onAngemeldet: () => undefined,
        onWechsel: () => undefined,
        ...props,
      } as never),
    );
  });
}

const text = () => document.body.textContent ?? '';
const knoepfe = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];
const reiter = () => [...document.querySelectorAll('[role="tab"]')] as HTMLElement[];

console.log('\nOhne Selbstanmeldung (lage = null):');

await pruefe('das Fenster steht - und zwar mit beiden Feldern', async () => {
  await zeichne({ lage: null });
  assert.ok(document.querySelector('#anmeldung-email'), 'Das Adressfeld fehlt.');
  assert.ok(document.querySelector('#anmeldung-kennwort'), 'Das Kennwortfeld fehlt.');
});

await pruefe('es gibt keinen Umschalter', async () => {
  // Eine Leiste mit einem einzigen Reiter waere eine Frage ohne Antwortmoeglichkeit.
  assert.equal(reiter().length, 0, 'Der Umschalter steht da, obwohl es nichts anzulegen gibt.');
  assert.ok(!text().includes('Konto anlegen'), '"Konto anlegen" steht da.');
});

await pruefe('und keinen Weg zum vergessenen Kennwort', async () => {
  assert.ok(
    !knoepfe().some((b) => b.textContent === 'Kennwort vergessen?'),
    'Der Weg wird angeboten, obwohl es ihn am Server nicht gibt.',
  );
});

await pruefe('die Sprachwahl steht trotzdem da', async () => {
  /*
   * Sie haengt an keiner Servereinstellung und muss auch dort stehen, wo sonst nichts
   * steht: Wer die Sprache nicht liest, kommt an die Einstellungen dahinter gar nicht
   * heran - das ist der ganze Grund, warum sie hier ist und nicht nur dort.
   */
  const wahl = document.querySelector('#zugang-sprache') as HTMLSelectElement | null;
  assert.ok(wahl, 'Die Sprachwahl fehlt.');
  assert.ok(wahl.options.length >= 10, `Nur ${wahl.options.length} Sprachen zur Wahl.`);
  assert.equal(wahl.options[0]!.value, 'automatisch', 'Die erste Wahl ist nicht "automatisch".');
  // Und sie traegt eine Beschriftung fuer die Vorlesesoftware, auch ohne sichtbare.
  assert.ok(document.querySelector('label[for="zugang-sprache"]'), 'Die Beschriftung fehlt.');
});

console.log('\nMit Selbstanmeldung:');

await pruefe('der Umschalter steht da, und "Anmelden" ist gewaehlt', async () => {
  await zeichne({ lage: LAGE });
  const tabs = reiter();
  assert.equal(tabs.length, 2, 'Es sind nicht zwei Reiter.');
  assert.equal(tabs[0]!.getAttribute('aria-selected'), 'true', 'Anmelden ist nicht gewaehlt.');
  assert.equal(tabs[1]!.getAttribute('aria-selected'), 'false', 'Anlegen ist faelschlich gewaehlt.');
});

await pruefe('der Umschalter meldet den Wechsel - genau einmal und nach draussen', async () => {
  const gerufen: string[] = [];
  await zeichne({ lage: LAGE, onWechsel: (w: string) => gerufen.push(w) });
  await act(async () => {
    reiter()[1]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(gerufen, ['registrieren']);

  // Ein Klick auf den Reiter, auf dem man ohnehin steht, loest nichts aus.
  await act(async () => {
    reiter()[0]!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(gerufen, ['registrieren'], 'Der eigene Reiter hat etwas ausgeloest.');
});

await pruefe('der Weg zum vergessenen Kennwort steht da und meldet sich', async () => {
  const gerufen: string[] = [];
  await zeichne({ lage: LAGE, onWechsel: (w: string) => gerufen.push(w) });
  const knopf = knoepfe().find((b) => b.textContent === 'Kennwort vergessen?');
  assert.ok(knopf, 'Der Weg fehlt.');
  await act(async () => {
    knopf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(gerufen, ['kennwort']);
});

await pruefe('ohne Systemversand fehlt er wieder', async () => {
  // Ohne Mail gibt es keinen Nachweis - dann bleibt es beim Verwalter, der zuruecksetzt.
  await zeichne({ lage: { ...LAGE, kennwortZuruecksetzbar: false } });
  assert.ok(
    !knoepfe().some((b) => b.textContent === 'Kennwort vergessen?'),
    'Der Weg wird angeboten, obwohl kein Systemversand eingerichtet ist.',
  );
  // Der Umschalter bleibt davon unberuehrt - die beiden haengen an verschiedenen Dingen.
  assert.equal(reiter().length, 2, 'Der Umschalter ist mit verschwunden.');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
