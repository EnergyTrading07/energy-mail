import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/*
 * Das Einstellungsfenster - und vor allem: dass jede seiner elf Tafeln wirklich zeichnet.
 *
 * Der Grund fuer diese Datei ist der Weg, auf dem die Tafeln entstanden sind. Neun von
 * ihnen waren vorher eigene Fenster und sind es geblieben - sie kommen nur ueber
 * `AlsTafel` herein und zeichnen sich dann als Abschnitt statt als Fenster (siehe
 * Fenster.tsx). Das ist genau die Sorte Umbau, die beim Uebersetzen nicht auffaellt: Der
 * Typ stimmt, die Einbindung stimmt, und erst beim Anklicken des sechsten Bereichs
 * fliegt einem etwas um die Ohren, weil dort ein Haken auf einen Zusammenhang wartet,
 * den es in der Tafel nicht gibt.
 *
 * Geprueft wird deshalb stumpf: jeden Bereich anklicken und nachsehen, ob seine
 * Ueberschrift dasteht. Dazu die drei Entscheidungen, die dieses Fenster selbst trifft -
 * welche Bereiche es ueberhaupt zeigt, dass die dreiteilige Ansichtswahl da ist (sie war
 * vorher unerreichbar), und dass eine eingebettete Tafel KEIN zweites Fenster ist.
 *
 * Gefaelscht wird fetch und nicht die api-Funktionen: So laeuft api.ts mit, und die
 * Adressen der Wege sind mitgeprueft.
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

/**
 * Was der Server auf die Abrufe der einzelnen Tafeln antwortet.
 *
 * Alles leer, aber in der richtigen Gestalt: Eine Tafel, die ueber eine leere Liste
 * laeuft, zeichnet ihren leeren Zustand - eine, die statt der Liste `undefined` bekommt,
 * bricht ab, und dann prueft diese Datei den falschen Fehler.
 */
g.fetch = async (url: string | URL) => {
  const weg = String(url);
  const antwort = (wert: unknown) =>
    ({ ok: true, status: 200, json: async () => wert }) as unknown as Response;

  if (weg.endsWith('/schluessel')) return antwort([]);
  if (weg.endsWith('/smime')) return antwort([]);
  if (weg.endsWith('/rules')) return antwort([]);
  if (weg.endsWith('/archiv/stand')) {
    return antwort({
      einstellungen: { konten: [], vorgabe: 'keine' },
      anzahl: 0,
      kettenlaenge: 0,
      siegel: '',
      bytes: 0,
      freigegeben: 0,
    });
  }
  if (weg.includes('/archiv/suche')) return antwort({ treffer: [], gesamt: 0 });
  if (weg.endsWith('/ablage')) return antwort({ bytes: 0, nachrichten: 0, inhalte: 0 });
  if (weg.endsWith('/verwaltung/nutzer')) {
    return antwort({ nutzer: [{ id: 'anna', email: 'anna@beispiel.de', verwalter: true }], ich: 'anna' });
  }
  if (weg.endsWith('/ich')) {
    return antwort({
      angemeldet: true,
      abmeldbar: true,
      nutzer: { id: 'anna', email: 'anna@beispiel.de' },
      zweiFaktor: false,
      codesUebrig: 0,
    });
  }
  // Abwesenheit, Lesebestaetigung, vertraute Absender, Freigaben - alles am Konto.
  if (weg.includes('/abwesenheit')) return antwort({ aktiv: false });
  if (weg.endsWith('/vertraute-absender')) return antwort({ absender: [] });
  if (weg.endsWith('/lesebestaetigung')) return antwort({ umgang: 'fragen' });
  if (weg.endsWith('/freigaben')) return antwort({ eigene: [], fremde: [] });
  return antwort({});
};

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const React = (await import('react')).default;
// Siehe VerwaltungModal.test.mts: tsx uebersetzt JSX klassisch, Vite modern.
(g as { React?: unknown }).React = React;

const { EinstellungenModal } = await import('./EinstellungenModal.js');
type Bereich = Parameters<typeof EinstellungenModal>[0]['bereich'];

const KONTO = {
  id: 'k1',
  email: 'anna@beispiel.de',
  displayName: 'Anna',
  provider: 'imap',
} as unknown as Parameters<typeof EinstellungenModal>[0]['konten'][number];

const wurzel = createRoot(document.getElementById('wurzel')!);

let offen: Bereich = 'darstellung';

async function zeichne(zusatz: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    wurzel.render(
      React.createElement(EinstellungenModal, {
        bereich: offen,
        onBereich: (b: Bereich) => {
          offen = b;
        },
        onClose: () => undefined,
        konten: [KONTO],
        kontoId: 'k1',
        ordnerJeKonto: { k1: [] },
        themawahl: 'hell',
        ansicht: 'hell',
        onThemawahl: () => undefined,
        darfVerwalten: true,
        abmeldbar: true,
        onKontoSpeichern: async () => undefined,
        onGeaendert: () => undefined,
        onAbwesenheitGeaendert: () => undefined,
        abwesenheitAktiv: [],
        ...zusatz,
      } as Parameters<typeof EinstellungenModal>[0]),
    );
  });
}

const text = () => document.body.textContent ?? '';
const knoepfe = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];

/** Klickt einen Bereich in der linken Leiste an und zeichnet mit dem Ergebnis neu. */
async function waehle(name: string): Promise<void> {
  const knopf = knoepfe().find(
    (b) => b.classList.contains('einstellungen-eintrag') && b.textContent?.startsWith(name),
  );
  assert.ok(
    knopf,
    `Kein Bereich "${name}". Da sind: ${knoepfe()
      .filter((b) => b.classList.contains('einstellungen-eintrag'))
      .map((b) => b.textContent)
      .join(', ')}`,
  );
  await act(async () => {
    knopf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
  await zeichne();
}

console.log('\nDas Einstellungsfenster:');

await zeichne();

await pruefe('die Bereiche stehen in benannten Gruppen', () => {
  const gruppen = [...document.querySelectorAll('.einstellungen-gruppentitel')].map(
    (e) => e.textContent,
  );
  assert.deepEqual(gruppen, ['Darstellung', 'Postfach', 'Sicherheit', 'Aufbewahrung', 'Programm']);
});

await pruefe('die Ansicht laesst sich wieder auf „automatisch" stellen', () => {
  /*
   * Der Punkt der ganzen Tafel.
   *
   * Die Wahl kannte immer drei Werte, der Umschalter in der Titelleiste aber nur zwei -
   * wer einmal geklickt hatte, kam nie wieder zu "folgt dem System" zurueck. Die
   * Einstellung gab es also, aber nur, solange man sie nicht anfasste.
   */
  const wahlen = [...document.querySelectorAll('.wahlreihe-knopf')].map((e) => e.textContent);
  assert.deepEqual(wahlen, ['Automatisch', 'Hell', 'Dunkel']);
  const gewaehlt = document.querySelector('.wahlreihe-knopf.gewaehlt');
  assert.equal(gewaehlt?.textContent, 'Hell', 'Die geltende Wahl muss angezeigt sein');
});

await pruefe('im Browserbetrieb fehlt „Anwendung" - dort gibt es keine Huelle', () => {
  assert.ok(!text().includes('Anwendung'), 'Ohne Bruecke darf es die Tafel nicht geben');
});

/*
 * Jeder Bereich einmal. Die Ueberschrift der Tafel ist der Nachweis, dass sie gezeichnet
 * hat - eine, die beim Zeichnen abbricht, hinterlaesst eine leere rechte Seite.
 */
const bereiche: [string, string][] = [
  ['Ansicht und Sprache', 'Ansicht und Sprache'],
  ['Konten', 'Einstellungen für anna@beispiel.de'],
  ['Regeln', 'Regeln für anna@beispiel.de'],
  ['Abwesenheit', 'Abwesenheitsnotiz'],
  ['OpenPGP-Schlüssel', 'OpenPGP-Schlüssel'],
  ['S/MIME-Zertifikate', 'S/MIME-Zertifikate'],
  ['Archiv', 'Archiv (GoBD)'],
  ['Bestand', 'Gespeicherter Nachrichtenbestand'],
  ['Nutzer', 'Nutzer verwalten'],
  ['Anmeldung', 'Mein Konto'],
];

for (const [eintrag, ueberschrift] of bereiche) {
  await pruefe(`„${eintrag}" zeichnet seine Tafel`, async () => {
    await waehle(eintrag);
    const tafel = document.querySelector('.einstellungen-tafel');
    assert.ok(tafel, 'Die rechte Seite fehlt');
    assert.ok(
      tafel.textContent?.includes(ueberschrift),
      `„${ueberschrift}" steht nicht in der Tafel. Da steht: ${tafel.textContent?.slice(0, 120)}`,
    );
  });
}

await pruefe('eine eingebettete Tafel ist kein zweites Fenster', () => {
  /*
   * Zwei ineinanderliegende Fokusfallen streiten um die Tabulatortaste, und Escape
   * schloesse die Tafel statt des Fensters, in dem sie steht. Deshalb traegt genau ein
   * Element role="dialog" - das Fenster selbst.
   */
  const fenster = document.querySelectorAll('[role="dialog"]');
  assert.equal(fenster.length, 1, 'Genau ein Fenster, und die Tafel darin ist keines');
  const tafel = document.querySelector('.einstellungen-tafel .modal.eingebettet');
  assert.ok(tafel, 'Die Tafel muss als eingebettet ausgezeichnet sein');
  assert.equal(tafel.tagName, 'SECTION');
  assert.ok(tafel.getAttribute('aria-labelledby'), 'Auch als Abschnitt braucht sie ihren Namen');
});

await pruefe('ohne Verwalterrecht und ohne Anmeldung fallen zwei Bereiche weg', async () => {
  offen = 'darstellung';
  await zeichne({ darfVerwalten: false, abmeldbar: false });
  const eintraege = knoepfe()
    .filter((b) => b.classList.contains('einstellungen-eintrag'))
    .map((b) => b.textContent);
  assert.ok(!eintraege.includes('Nutzer'), 'Ohne Verwalterrecht kein „Nutzer"');
  assert.ok(!eintraege.includes('Anmeldung'), 'Ohne Sitzung keine „Anmeldung"');
  // Die Gruppe verschwindet mit ihrem letzten Eintrag - eine leere Ueberschrift waere
  // ein Fach, in dem nichts liegt.
  const gruppen = [...document.querySelectorAll('.einstellungen-gruppentitel')].map(
    (e) => e.textContent,
  );
  assert.ok(!gruppen.includes('Programm'), 'Eine Gruppe ohne Eintraege darf nicht dastehen');
});

await pruefe('ein Bereich, den es nicht mehr gibt, faellt auf den ersten zurueck', async () => {
  /*
   * Moeglich ist das mehr als nur theoretisch: „Nutzer" verschwindet, sobald einem das
   * Verwalterrecht entzogen wird. Ohne diesen Rueckfall bliebe die rechte Seite leer,
   * und das sieht wie ein Fehler aus.
   */
  offen = 'nutzer';
  await zeichne({ darfVerwalten: false, abmeldbar: false });
  const tafel = document.querySelector('.einstellungen-tafel');
  assert.ok(tafel?.textContent?.includes('Ansicht und Sprache'));
});

await pruefe('eine laufende Abwesenheitsnotiz traegt ihren Vermerk in der Leiste', async () => {
  offen = 'darstellung';
  await zeichne({ abwesenheitAktiv: ['k1'] });
  const vermerk = document.querySelector('.einstellungen-vermerk');
  assert.equal(vermerk?.textContent, 'an');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
