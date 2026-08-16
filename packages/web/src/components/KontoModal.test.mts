import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/*
 * Zeichnet das Kontofenster - und zeichnet es das QR-Bild richtig?
 *
 * Der zweite Teil ist der Grund fuer diese Datei. Dass der Server ein gueltiges QR-Bild
 * rechnet, steht in packages/server/src/qrCode.test.mts und ist dort gegen die Norm
 * geprueft. Hier geht es um die letzten dreissig Zeilen des Weges: aus einem Raster aus
 * Nullen und Einsen werden Rechtecke. Ein Fehler darin - ein vergessener Rand, eine um
 * eins verschobene Spalte, eine Farbe, die im dunklen Erscheinungsbild kippt - macht das
 * geprueft richtige Bild unlesbar, und gemerkt wuerde es erst, wenn ein Kunde sein Telefon
 * davorhaelt.
 *
 * Gefaelscht wird wieder fetch und nicht die api-Funktionen: So laeuft api.ts mit, und die
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

const gerufen: { weg: string; art: string; koerper?: string }[] = [];

/**
 * Ein winziges Raster mit bekannten Laeufen.
 *
 * Fuenf Zeilen, und in ihnen stecken die Faelle, an denen sich eine Lauflaengen-Zerlegung
 * verrechnet: ein Lauf am linken Rand, einer am rechten, zwei getrennte in einer Zeile,
 * eine ganz dunkle und eine ganz helle Zeile. Zusammen elf Laeufe - nachgezaehlt.
 */
const RASTER = [
  '11011', // zwei Laeufe: 0-1 und 3-4
  '10001', // zwei
  '11111', // einer, bis an den rechten Rand
  '00000', // keiner
  '01010', // zwei
];
const LAEUFE = 7;

let zweiFaktorAn = false;

g.fetch = async (url: string | URL, init?: { method?: string; body?: string }) => {
  const weg = String(url);
  gerufen.push({ weg, art: init?.method ?? 'GET', koerper: init?.body });
  const antwort = (wert: unknown) =>
    ({ ok: true, status: 200, json: async () => wert }) as unknown as Response;

  if (weg.endsWith('/ich')) {
    return antwort({
      angemeldet: true,
      abmeldbar: true,
      nutzer: { id: 'anna', email: 'anna@beispiel.de' },
      zweiFaktor: zweiFaktorAn,
      codesUebrig: zweiFaktorAn ? 10 : 0,
    });
  }
  if (weg.endsWith('/ich/zweifaktor/beginnen')) {
    return antwort({
      geheimnis: 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ',
      weg: 'otpauth://totp/Energy%20Mail:anna%40beispiel.de?secret=X&issuer=Energy%20Mail',
      qr: { groesse: 5, zeilen: RASTER },
    });
  }
  if (weg.endsWith('/ich/zweifaktor/bestaetigen')) {
    zweiFaktorAn = true;
    return antwort({ codes: ['ABCDE-FGHJK', 'LMNPQ-RSTUV'] });
  }
  return antwort({});
};

const { createRoot } = await import('react-dom/client');
const { act } = await import('react');
const React = (await import('react')).default;
// Siehe VerwaltungModal.test.mts: tsx uebersetzt JSX klassisch, Vite modern.
(g as { React?: unknown }).React = React;

const { KontoModal } = await import('./KontoModal.js');

const wurzel = createRoot(document.getElementById('wurzel')!);

await act(async () => {
  wurzel.render(
    React.createElement(KontoModal, { onClose: () => undefined, onAbgemeldet: () => undefined }),
  );
});

const text = () => document.body.textContent ?? '';
const knoepfe = () => [...document.querySelectorAll('button')] as HTMLButtonElement[];
const setzer = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;

async function tippe(auswahl: string, wert: string): Promise<void> {
  const feld = document.querySelector(auswahl) as HTMLInputElement;
  assert.ok(feld, `Kein Feld ${auswahl}`);
  await act(async () => {
    setzer.call(feld, wert);
    feld.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function klicke(beschriftung: string): Promise<void> {
  const knopf = knoepfe().find((b) => b.textContent === beschriftung);
  assert.ok(knopf, `Kein Knopf "${beschriftung}". Da sind: ${knoepfe().map((b) => b.textContent).join(', ')}`);
  await act(async () => {
    knopf.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });
}

console.log('\nDas Kontofenster zeichnet:');

await pruefe('es fragt beim Oeffnen, wer da ist - unter /ich', () => {
  assert.ok(gerufen.some((g) => g.weg.endsWith('/ich') && g.art === 'GET'));
  assert.ok(text().includes('anna@beispiel.de'), 'Die eigene Adresse fehlt.');
});

await pruefe('der Kennwortwechsel steht da - er hatte bisher gar keine Oberflaeche', () => {
  /*
   * /ich/kennwort gibt es im Server seit Langem, nur konnte niemand ihn erreichen, ohne
   * einen Abruf von Hand zu bauen. Ein Kennwort, das sich nicht wechseln laesst, ist beim
   * ersten Verdacht ein Problem.
   */
  assert.ok(document.getElementById('konto-alt'), 'Feld fuer das bisherige Kennwort fehlt.');
  assert.ok(document.getElementById('konto-neu'), 'Feld fuer das neue Kennwort fehlt.');
  assert.ok(document.getElementById('konto-neu2'), 'Das Wiederholungsfeld fehlt.');
});

await pruefe('ohne zweiten Faktor steht dort ein Knopf zum Einrichten', () => {
  assert.ok(knoepfe().some((b) => b.textContent === 'Einrichten'));
  assert.ok(!text().includes('Eingeschaltet'), 'Es meldet sich als eingeschaltet.');
});

console.log('\nDas Einrichten:');

await pruefe('das Beginnen geht an /ich/zweifaktor/beginnen', async () => {
  await klicke('Einrichten');
  assert.ok(
    gerufen.some((g) => g.weg.endsWith('/ich/zweifaktor/beginnen') && g.art === 'POST'),
    'Kein Aufruf. Gerufen: ' + JSON.stringify(gerufen.map((g) => g.weg)),
  );
});

await pruefe('das Geheimnis steht zum Abtippen da', () => {
  // Wer die Kamera nicht zum Laufen bringt, muss es eingeben koennen - sonst scheitert die
  // Einrichtung an einem Treiber.
  const feld = document.querySelector('.konto-geheimnis');
  assert.ok(feld, 'Der Schluessel zum Abtippen fehlt.');
  assert.equal(feld.textContent, 'GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ');
});

await pruefe('das QR-Bild ist gezeichnet - mit Rand und in Laeufen', () => {
  const svg = document.querySelector('svg.qr-bild');
  assert.ok(svg, 'Kein QR-Bild.');

  /*
   * Vier Module Rand rundherum. Die Norm verlangt sie; ohne sie findet ein Leser die
   * Ecken nicht, und das Bild ist fuer eine Kamera nicht da.
   */
  assert.equal(svg.getAttribute('viewBox'), '-4 -4 13 13', 'Der Rand stimmt nicht.');

  const rechtecke = [...svg.querySelectorAll('rect')];
  assert.equal(rechtecke.length, LAEUFE + 1, `${rechtecke.length} Rechtecke statt ${LAEUFE + 1}.`);

  // Das erste ist der helle Grund - und der ist fest weiss, nicht themenabhaengig: Ein
  // umgekehrtes QR-Bild lesen manche Kameras und viele nicht.
  assert.equal(rechtecke[0]!.getAttribute('fill'), '#ffffff');
  for (const r of rechtecke.slice(1)) assert.equal(r.getAttribute('fill'), '#000000');

  // Und die Laeufe sitzen an den richtigen Stellen: die dritte Zeile ist durchgehend dunkel.
  const dritte = rechtecke.slice(1).find((r) => r.getAttribute('y') === '2');
  assert.equal(dritte?.getAttribute('x'), '0');
  assert.equal(dritte?.getAttribute('width'), '5');
});

await pruefe('das Bestaetigen schickt Code UND Kennwort', async () => {
  /*
   * Das Kennwort gehoert dazu, obwohl die Sitzung angemeldet ist. Ohne die Abfrage koennte
   * ein Voruebergehender an einem unbeaufsichtigten Bildschirm den zweiten Faktor auf sein
   * eigenes Telefon einrichten - und den rechtmaessigen Nutzer aussperren.
   */
  await tippe('#konto-code', '123456');
  await tippe('#konto-faktorkennwort', 'Sieben Pflaumen im Krug');
  await klicke('Einschalten');

  const gesendet = gerufen.find((g) => g.weg.endsWith('/ich/zweifaktor/bestaetigen'));
  assert.ok(gesendet, 'Es ging nichts hinaus.');
  assert.deepEqual(JSON.parse(gesendet.koerper!), {
    kennwort: 'Sieben Pflaumen im Krug',
    code: '123456',
  });
});

await pruefe('die Wiederherstellungscodes erscheinen - genau einmal', () => {
  assert.ok(text().includes('ABCDE-FGHJK'), 'Der erste Code fehlt.');
  assert.ok(text().includes('LMNPQ-RSTUV'), 'Der zweite Code fehlt.');
  assert.ok(document.querySelector('.konto-codes'), 'Der Kasten fehlt.');
});

await pruefe('danach meldet sich das Fenster als eingeschaltet', () => {
  assert.ok(document.querySelector('.marke-an'), 'Die Marke fehlt.');
  assert.ok(!knoepfe().some((b) => b.textContent === 'Einrichten'), 'Es bietet noch Einrichten an.');
  assert.ok(knoepfe().some((b) => b.textContent === 'Abschalten'), 'Abschalten fehlt.');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
