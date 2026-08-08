import assert from 'node:assert/strict';
import type { Listeneintrag } from './listenTypen.js';
import {
  STANDARD_SORTIERUNG,
  alsDichte,
  alsSortierung,
  alsText,
  beschreibeSortierung,
  betreffZumSortieren,
  sortiere,
  umfasstAlles,
} from './sortierung.js';

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void): void {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/** Eine Zeile, wie sie in der Liste steht. */
const m = (
  uid: number,
  betreff: string,
  absender: string,
  tag: string | null,
): Listeneintrag =>
  ({
    uid,
    subject: betreff,
    from: absender.includes('<')
      ? [{ name: absender.split('<')[0]!.trim(), address: absender.split('<')[1]!.replace('>', '') }]
      : [{ address: absender }],
    to: [],
    cc: [],
    date: tag ? new Date(tag) : null,
    flags: [],
    seen: true,
    hasAttachments: false,
  }) as Listeneintrag;

const betreffe = (liste: Listeneintrag[]) => liste.map((e) => e.subject).join(' | ');

console.log('\nNach Datum:');

const NACHRICHTEN = [
  m(1, 'Zweite', 'bernd@b.de', '2026-06-02T10:00:00Z'),
  m(2, 'Erste', 'anna@a.de', '2026-06-01T10:00:00Z'),
  m(3, 'Dritte', 'carl@c.de', '2026-06-03T10:00:00Z'),
];

pruefe('neueste zuerst', () => {
  assert.equal(
    betreffe(sortiere(NACHRICHTEN, { schluessel: 'datum', richtung: 'ab' })),
    'Dritte | Zweite | Erste',
  );
});

pruefe('aelteste zuerst', () => {
  assert.equal(
    betreffe(sortiere(NACHRICHTEN, { schluessel: 'datum', richtung: 'auf' })),
    'Erste | Zweite | Dritte',
  );
});

pruefe('eine Nachricht ohne Datum landet am Ende, nicht an zufaelliger Stelle', () => {
  const mitLuecke = [...NACHRICHTEN, m(4, 'Ohne Datum', 'x@x.de', null)];
  assert.ok(
    betreffe(sortiere(mitLuecke, { schluessel: 'datum', richtung: 'ab' })).endsWith('Ohne Datum'),
  );
});

pruefe('die urspruengliche Liste bleibt unberuehrt', () => {
  const vorher = betreffe(NACHRICHTEN);
  sortiere(NACHRICHTEN, { schluessel: 'betreff', richtung: 'auf' });
  assert.equal(betreffe(NACHRICHTEN), vorher);
});

console.log('\nNach Absender:');

const LEUTE = [
  m(1, 'A', 'Zacharias Zettel <z@z.de>', '2026-06-01T10:00:00Z'),
  m(2, 'B', 'Änne Ärgerlich <ae@a.de>', '2026-06-02T10:00:00Z'),
  m(3, 'C', 'Martin Mueller <m@m.de>', '2026-06-03T10:00:00Z'),
];

pruefe('A bis Z, und Umlaute stehen bei ihrem Buchstaben', () => {
  // "Änne" gehoert zu "A", nicht hinter "Z" - sonst faende man es nirgends.
  const sortiert = sortiere(LEUTE, { schluessel: 'absender', richtung: 'auf' });
  assert.equal(betreffe(sortiert), 'B | C | A');
});

pruefe('Z bis A', () => {
  assert.equal(betreffe(sortiere(LEUTE, { schluessel: 'absender', richtung: 'ab' })), 'A | C | B');
});

pruefe('ohne Namen zaehlt die Adresse', () => {
  const ohne = [m(1, 'X', 'zzz@b.de', '2026-06-01T10:00:00Z'), m(2, 'Y', 'aaa@b.de', '2026-06-02T10:00:00Z')];
  assert.equal(betreffe(sortiere(ohne, { schluessel: 'absender', richtung: 'auf' })), 'Y | X');
});

pruefe('bei gleichem Absender entscheidet das Datum, neueste zuerst', () => {
  // Ohne diesen zweiten Massstab spraenge die Reihenfolge bei jedem Nachladen um.
  const gleich = [
    m(1, 'alt', 'anna@a.de', '2026-06-01T10:00:00Z'),
    m(2, 'neu', 'anna@a.de', '2026-06-05T10:00:00Z'),
    m(3, 'mittel', 'anna@a.de', '2026-06-03T10:00:00Z'),
  ];
  assert.equal(
    betreffe(sortiere(gleich, { schluessel: 'absender', richtung: 'auf' })),
    'neu | mittel | alt',
  );
  // Und in der Gegenrichtung bleibt der zweite Massstab derselbe.
  assert.equal(
    betreffe(sortiere(gleich, { schluessel: 'absender', richtung: 'ab' })),
    'neu | mittel | alt',
  );
});

console.log('\nNach Betreff:');

pruefe('die Vorsaetze von Antworten zaehlen nicht mit', () => {
  // Sonst stuenden alle Antworten unter "A" und "R" statt bei ihrem Thema.
  assert.equal(betreffZumSortieren('Re: Vertrag'), 'Vertrag');
  assert.equal(betreffZumSortieren('AW: Vertrag'), 'Vertrag');
  assert.equal(betreffZumSortieren('Fwd: Vertrag'), 'Vertrag');
  assert.equal(betreffZumSortieren('WG: Vertrag'), 'Vertrag');
  assert.equal(betreffZumSortieren('Re: AW: Re: Vertrag'), 'Vertrag');
  assert.equal(betreffZumSortieren('Re[2]: Vertrag'), 'Vertrag');
});

pruefe('ein Betreff, der zufaellig so anfaengt, bleibt heil', () => {
  assert.equal(betreffZumSortieren('Rechnung 2026'), 'Rechnung 2026');
  assert.equal(betreffZumSortieren('Award-Verleihung'), 'Award-Verleihung');
});

pruefe('Antworten stehen bei ihrem Thema', () => {
  const faden = [
    m(1, 'Zahlen', 'a@a.de', '2026-06-01T10:00:00Z'),
    m(2, 'Angebot', 'b@b.de', '2026-06-02T10:00:00Z'),
    m(3, 'AW: Angebot', 'c@c.de', '2026-06-03T10:00:00Z'),
  ];
  assert.equal(
    betreffe(sortiere(faden, { schluessel: 'betreff', richtung: 'auf' })),
    'AW: Angebot | Angebot | Zahlen',
    'die Antwort steht nicht bei ihrem Thema',
  );
});

pruefe('Zahlen im Betreff werden als Zahlen verglichen', () => {
  const nummern = [
    m(1, 'Rechnung 10', 'a@a.de', '2026-06-01T10:00:00Z'),
    m(2, 'Rechnung 2', 'a@a.de', '2026-06-02T10:00:00Z'),
  ];
  assert.equal(
    betreffe(sortiere(nummern, { schluessel: 'betreff', richtung: 'auf' })),
    'Rechnung 2 | Rechnung 10',
    '"Rechnung 10" stand vor "Rechnung 2"',
  );
});

console.log('\nWie weit reicht die Sortierung?');

pruefe('nach Datum umfasst sie den ganzen Ordner', () => {
  assert.equal(umfasstAlles({ schluessel: 'datum', richtung: 'ab' }), true);
  assert.equal(umfasstAlles({ schluessel: 'datum', richtung: 'auf' }), true);
});

pruefe('nach Absender und Betreff nur das Geladene', () => {
  // Das muss die Liste sagen. Eine Sortierung, die nur so tut, als umfasse sie alles,
  // laesst einen oben nach etwas suchen, das weiter unten steht.
  assert.equal(umfasstAlles({ schluessel: 'absender', richtung: 'auf' }), false);
  assert.equal(umfasstAlles({ schluessel: 'betreff', richtung: 'auf' }), false);
});

console.log('\nMerken und wieder einlesen:');

pruefe('hin und zurueck ergibt dasselbe', () => {
  for (const s of [
    { schluessel: 'datum', richtung: 'ab' },
    { schluessel: 'absender', richtung: 'auf' },
    { schluessel: 'betreff', richtung: 'ab' },
  ] as const) {
    assert.deepEqual(alsSortierung(alsText(s)), s);
  }
});

pruefe('Unsinn faellt auf die Voreinstellung zurueck', () => {
  assert.deepEqual(alsSortierung('kaputt'), STANDARD_SORTIERUNG);
  assert.deepEqual(alsSortierung(''), STANDARD_SORTIERUNG);
  assert.deepEqual(alsSortierung(null), STANDARD_SORTIERUNG);
  assert.deepEqual(alsSortierung('groesse:ab'), STANDARD_SORTIERUNG);
});

pruefe('eine unbekannte Richtung wird zu "ab"', () => {
  assert.deepEqual(alsSortierung('betreff:quer'), { schluessel: 'betreff', richtung: 'ab' });
});

pruefe('die Dichte ebenso', () => {
  assert.equal(alsDichte('eng'), 'eng');
  assert.equal(alsDichte('weit'), 'weit');
  assert.equal(alsDichte('riesig'), 'normal');
  assert.equal(alsDichte(null), 'normal');
});

pruefe('jede Sortierung hat einen lesbaren Namen', () => {
  assert.equal(beschreibeSortierung({ schluessel: 'datum', richtung: 'ab' }), 'Neueste zuerst');
  assert.equal(beschreibeSortierung({ schluessel: 'datum', richtung: 'auf' }), 'Älteste zuerst');
  assert.equal(beschreibeSortierung({ schluessel: 'absender', richtung: 'auf' }), 'Absender A–Z');
  assert.equal(beschreibeSortierung({ schluessel: 'betreff', richtung: 'ab' }), 'Betreff Z–A');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
