import assert from 'node:assert/strict';
import { gruppiere, normalisierterBetreff } from './konversationen.js';
import type { Listeneintrag } from './listenTypen.js';

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

let zaehler = 0;
function mail(teil: Partial<Listeneintrag> = {}): Listeneintrag {
  zaehler++;
  return {
    uid: zaehler,
    subject: `Betreff ${zaehler}`,
    from: [{ address: `person${zaehler}@example.de` }],
    to: [],
    cc: [],
    date: new Date(2026, 0, zaehler),
    flags: [],
    seen: true,
    hasAttachments: false,
    ...teil,
  };
}

console.log('\nBetreff normalisieren:');

pruefe('Antwort- und Weiterleitungskürzel fallen weg', () => {
  assert.equal(normalisierterBetreff('AW: Rechnung'), 'rechnung');
  assert.equal(normalisierterBetreff('Re: Rechnung'), 'rechnung');
  assert.equal(normalisierterBetreff('Fwd: Rechnung'), 'rechnung');
  assert.equal(normalisierterBetreff('WG: Rechnung'), 'rechnung');
});

pruefe('mehrfach verschachtelte Kürzel ebenso', () => {
  assert.equal(normalisierterBetreff('AW: Re: Fwd: Angebot'), 'angebot');
});

pruefe('ein Betreff ohne Kürzel bleibt erhalten', () => {
  assert.equal(normalisierterBetreff('Rechnung März'), 'rechnung märz');
});

console.log('\nGruppieren:');

pruefe('ohne Bezug bleibt jede Nachricht für sich', () => {
  const gruppen = gruppiere([mail(), mail(), mail()]);
  assert.equal(gruppen.length, 3);
  assert.ok(gruppen.every((g) => g.nachrichten.length === 1));
});

pruefe('Gesprächskennung des Servers gruppiert (Gmail)', () => {
  const gruppen = gruppiere([
    mail({ threadId: '111' }),
    mail({ threadId: '222' }),
    mail({ threadId: '111' }),
  ]);
  assert.equal(gruppen.length, 2);
  assert.equal(gruppen.find((g) => g.nachrichten.length === 2)?.nachrichten.length, 2);
});

pruefe('ohne Kennung verbindet In-Reply-To', () => {
  const frage = mail({ messageId: '<a@x>', subject: 'Frage' });
  const antwort = mail({ inReplyTo: '<a@x>', subject: 'AW: Frage' });
  const gruppen = gruppiere([antwort, frage]);
  assert.equal(gruppen.length, 1);
  assert.equal(gruppen[0].nachrichten.length, 2);
});

pruefe('eine Kette über drei Nachrichten bleibt zusammen', () => {
  const a = mail({ messageId: '<1@x>', subject: 'Thema' });
  const b = mail({ messageId: '<2@x>', inReplyTo: '<1@x>', subject: 'AW: Thema' });
  const c = mail({ messageId: '<3@x>', inReplyTo: '<2@x>', subject: 'AW: AW: Thema' });
  const gruppen = gruppiere([c, a, b]);
  assert.equal(gruppen.length, 1);
  assert.equal(gruppen[0].nachrichten.length, 3);
});

pruefe('gleicher Betreff allein gruppiert NICHT', () => {
  // Genau der Fall, der schiefginge: zwei Rundmails mit identischem Titel.
  const gruppen = gruppiere([
    mail({ subject: 'Newsletter Juli' }),
    mail({ subject: 'Newsletter Juli' }),
  ]);
  assert.equal(gruppen.length, 2, 'ohne Antwort darf der Betreff nicht verbinden');
});

pruefe('gleicher Betreff verbindet, sobald eine Antwort dabei ist', () => {
  const gruppen = gruppiere([
    mail({ subject: 'Angebot' }),
    mail({ subject: 'AW: Angebot', inReplyTo: '<verschollen@x>' }),
  ]);
  assert.equal(gruppen.length, 1, 'die Antwort weist die beiden als Gespräch aus');
});

pruefe('verschiedene Themen bleiben getrennt', () => {
  const gruppen = gruppiere([
    mail({ messageId: '<a@x>', subject: 'Thema A' }),
    mail({ inReplyTo: '<a@x>', subject: 'AW: Thema A' }),
    mail({ messageId: '<b@x>', subject: 'Thema B' }),
    mail({ inReplyTo: '<b@x>', subject: 'AW: Thema B' }),
  ]);
  assert.equal(gruppen.length, 2);
  assert.ok(gruppen.every((g) => g.nachrichten.length === 2));
});

pruefe('jüngste Nachricht bestimmt die Gruppe', () => {
  const alt = mail({ messageId: '<a@x>', date: new Date(2026, 0, 1), subject: 'Frage' });
  const neu = mail({ inReplyTo: '<a@x>', date: new Date(2026, 0, 5), subject: 'AW: Frage' });
  const [gruppe] = gruppiere([alt, neu]);
  assert.equal(gruppe.neueste.uid, neu.uid);
  assert.equal(gruppe.nachrichten[0].uid, neu.uid, 'jüngste steht vorn');
});

pruefe('Gruppen stehen nach Datum der jüngsten Nachricht', () => {
  const alt = mail({ date: new Date(2026, 0, 1) });
  const neu = mail({ date: new Date(2026, 5, 1) });
  const gruppen = gruppiere([alt, neu]);
  assert.equal(gruppen[0].neueste.uid, neu.uid);
});

pruefe('ungelesen und Anhang schlagen auf die Gruppe durch', () => {
  const a = mail({ messageId: '<a@x>', seen: true, hasAttachments: false });
  const b = mail({ inReplyTo: '<a@x>', seen: false, hasAttachments: true });
  const [gruppe] = gruppiere([a, b]);
  assert.equal(gruppe.ungelesen, true);
  assert.equal(gruppe.mitAnhang, true);
});

pruefe('Beteiligte stehen in der Reihenfolge des Gesprächs', () => {
  const a = mail({
    messageId: '<a@x>',
    date: new Date(2026, 0, 1),
    from: [{ name: 'Anna', address: 'anna@x.de' }],
  });
  const b = mail({
    inReplyTo: '<a@x>',
    date: new Date(2026, 0, 2),
    from: [{ name: 'Bert', address: 'bert@x.de' }],
  });
  const c = mail({
    inReplyTo: '<a@x>',
    date: new Date(2026, 0, 3),
    from: [{ name: 'Anna', address: 'anna@x.de' }],
  });
  const [gruppe] = gruppiere([c, b, a]);
  assert.deepEqual(gruppe.beteiligte, ['Anna', 'Bert'], 'keine Doppelnennung, älteste zuerst');
});

pruefe('Treffer aus verschiedenen Ordnern kollidieren nicht', () => {
  // Gleiche UID in zwei Ordnern - ohne Ordner im Schlüssel würden sie verschmelzen.
  const gruppen = gruppiere([
    { ...mail({ subject: 'A' }), uid: 7, folder: 'INBOX' },
    { ...mail({ subject: 'B' }), uid: 7, folder: 'Gesendet' },
  ]);
  assert.equal(gruppen.length, 2);
});

console.log('\nDie Sortierung gilt auch fuer Gespraeche:');

/** Drei einzelne Nachrichten, deren Datumsfolge der Namensfolge widerspricht. */
const dreiVerschiedene = () => [
  mail({ from: [{ address: 'z@x.de', name: 'Zacharias' }], date: new Date(2026, 5, 3), subject: 'Zuletzt' }),
  mail({ from: [{ address: 'a@x.de', name: 'Anna' }], date: new Date(2026, 5, 1), subject: 'Anfang' }),
  mail({ from: [{ address: 'm@x.de', name: 'Martin' }], date: new Date(2026, 5, 2), subject: 'Mitte' }),
];

pruefe('nach Absender A-Z ordnen sich auch Gespraeche alphabetisch', () => {
  /*
   * Gemessen am echten Postfach: mit eingeschalteten Gespraechen stand unter
   * "Absender A-Z" genau dieselbe Reihenfolge wie unter "Neueste zuerst". Das
   * Gruppieren ordnete hinterher wieder nach Datum. Gespraeche sind von Haus aus an,
   * also war die Sortierung fuer jeden Nutzer wirkungslos.
   */
  const g = gruppiere(dreiVerschiedene(), { schluessel: 'absender', richtung: 'auf' });
  assert.deepEqual(
    g.map((x) => x.beteiligte[0]),
    ['Anna', 'Martin', 'Zacharias'],
  );
});

pruefe('und andersherum bei Z-A', () => {
  const g = gruppiere(dreiVerschiedene(), { schluessel: 'absender', richtung: 'ab' });
  assert.deepEqual(
    g.map((x) => x.beteiligte[0]),
    ['Zacharias', 'Martin', 'Anna'],
  );
});

pruefe('nach Betreff ebenso', () => {
  const g = gruppiere(dreiVerschiedene(), { schluessel: 'betreff', richtung: 'auf' });
  assert.deepEqual(
    g.map((x) => x.neueste.subject),
    ['Anfang', 'Mitte', 'Zuletzt'],
  );
});

pruefe('nach Datum bleibt es beim Datum', () => {
  const neueste = gruppiere(dreiVerschiedene(), { schluessel: 'datum', richtung: 'ab' });
  assert.deepEqual(
    neueste.map((x) => x.neueste.subject),
    ['Zuletzt', 'Mitte', 'Anfang'],
  );
  const aelteste = gruppiere(dreiVerschiedene(), { schluessel: 'datum', richtung: 'auf' });
  assert.deepEqual(
    aelteste.map((x) => x.neueste.subject),
    ['Anfang', 'Mitte', 'Zuletzt'],
  );
});

pruefe('sortiert wird nach dem, was in der Zeile steht', () => {
  // Bei einem Gespraech zeigt die Zeile vorn den, der es begonnen hat - nicht den
  // letzten Absender. Danach muss sich die Reihenfolge richten, sonst sieht sie
  // willkuerlich aus.
  const anfang = mail({
    from: [{ address: 'a@x.de', name: 'Anna' }],
    subject: 'Projektplan',
    messageId: '<eins@x.de>',
    date: new Date(2026, 5, 1),
  });
  const antwort = mail({
    from: [{ address: 'z@x.de', name: 'Zacharias' }],
    subject: 'Re: Projektplan',
    inReplyTo: '<eins@x.de>',
    date: new Date(2026, 5, 9),
  });
  const allein = mail({
    from: [{ address: 'm@x.de', name: 'Martin' }],
    subject: 'Mitte',
    date: new Date(2026, 5, 5),
  });

  const g = gruppiere([anfang, antwort, allein], { schluessel: 'absender', richtung: 'auf' });
  assert.deepEqual(
    g.map((x) => x.beteiligte[0]),
    ['Anna', 'Martin'],
  );
  assert.equal(g[0].nachrichten.length, 2, 'das Gespraech wurde nicht zusammengefasst');
});

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
