import assert from 'node:assert/strict';
import { verschmelzePosteingaenge, type Vorrat } from './zusammenfuehren.js';

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

/** Eine Nachricht: nur Kennung und Tag im Juni 2026. */
type Post = { id: string; tag: number };
const p = (id: string, tag: number): Post => ({ id, tag });
const wann = (m: Post) => m.tag;

const vorrat = (accountId: string, eintraege: Post[], hasMore = false): Vorrat<Post> => ({
  accountId,
  eintraege,
  hasMore,
});

const ids = (liste: Post[]) => liste.map((m) => m.id).join(',');

console.log('\nDer einfache Fall:');

pruefe('zwei vollstaendige Konten werden nach Datum gemischt', () => {
  const { seite, hasMore } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 10), p('a2', 6)]), vorrat('b', [p('b1', 8), p('b2', 4)])],
    wann,
    10,
  );
  assert.equal(ids(seite), 'a1,b1,a2,b2');
  assert.equal(hasMore, false);
});

pruefe('ein einzelnes Konto kommt unveraendert durch', () => {
  const { seite } = verschmelzePosteingaenge([vorrat('a', [p('a1', 3), p('a2', 2)])], wann, 10);
  assert.equal(ids(seite), 'a1,a2');
});

pruefe('gar keine Konten ergeben eine leere Seite', () => {
  const ergebnis = verschmelzePosteingaenge<Post>([], wann, 10);
  assert.deepEqual(ergebnis.seite, []);
  assert.equal(ergebnis.hasMore, false);
});

pruefe('ein leeres Konto stoert nicht', () => {
  const { seite } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 5)]), vorrat('b', [])],
    wann,
    10,
  );
  assert.equal(ids(seite), 'a1');
});

console.log('\nDie Grenze - hier verliert ein naiver Zusammenbau Nachrichten:');

pruefe('was aelter ist als der aelteste Eintrag eines offenen Kontos, wartet', () => {
  // Konto A hat noch mehr und liegt bis Tag 6 vor. B ist vollstaendig bis Tag 1.
  // Sicher ist damit nur, was nach Tag 6 liegt - B's Tag 5 koennte sich mit einer noch
  // ungeholten Nachricht von A verschraenken.
  const { seite, rest } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 10), p('a2', 6)], true), vorrat('b', [p('b1', 8), p('b2', 5)])],
    wann,
    10,
  );
  assert.equal(ids(seite), 'a1,b1', `war: ${ids(seite)}`);
  assert.equal(ids(rest.a ?? []), 'a2');
  assert.equal(ids(rest.b ?? []), 'b2');
});

pruefe('ohne Grenze faellt genau diese Nachricht durch', () => {
  // Der Gegenbeweis: taeten wir es naiv, stuende b2 (Tag 5) mit auf der Seite - und
  // A's noch ungeholte Nachricht von Tag 7 muesste spaeter DAVOR eingefuegt werden.
  const { seite } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 10), p('a2', 6)], true), vorrat('b', [p('b1', 8), p('b2', 5)])],
    wann,
    10,
  );
  assert.ok(!seite.some((m) => m.id === 'b2'), 'b2 haette nicht ausgegeben werden duerfen');
});

pruefe('ein offenes Konto mit leerem Vorrat haelt alles zurueck', () => {
  // Ueber dessen naechste Nachricht ist nichts bekannt - dann ist gar nichts sicher.
  const ergebnis = verschmelzePosteingaenge(
    [vorrat('a', [], true), vorrat('b', [p('b1', 9), p('b2', 8)])],
    wann,
    10,
  );
  assert.deepEqual(ergebnis.seite, []);
  assert.deepEqual(ergebnis.nachladen, ['a']);
  assert.equal(ids(ergebnis.rest.b ?? []), 'b1,b2');
});

pruefe('sind alle Konten erschoepft, wird alles ausgegeben', () => {
  const { seite, hasMore } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 3)]), vorrat('b', [p('b1', 1)])],
    wann,
    10,
  );
  assert.equal(ids(seite), 'a1,b1');
  assert.equal(hasMore, false);
});

pruefe('gleiche Zeitpunkte gehen nicht ueber die Grenze', () => {
  // Sonst haenge die Reihenfolge davon ab, welches Konto zuerst geantwortet hat.
  const { seite } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 5)], true), vorrat('b', [p('b1', 5)])],
    wann,
    10,
  );
  assert.deepEqual(seite, []);
});

console.log('\nSeitengroesse:');

pruefe('mehr als die Seitengroesse bleibt liegen', () => {
  const { seite, rest, hasMore } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 9), p('a2', 7)]), vorrat('b', [p('b1', 8), p('b2', 6)])],
    wann,
    3,
  );
  assert.equal(ids(seite), 'a1,b1,a2');
  assert.equal(ids(rest.b ?? []), 'b2');
  assert.equal(hasMore, true, 'es liegt noch etwas da');
});

pruefe('der Rest bleibt je Konto in seiner Reihenfolge', () => {
  const { rest } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 9), p('a2', 7), p('a3', 5)]), vorrat('b', [p('b1', 8)])],
    wann,
    2,
  );
  assert.equal(ids(rest.a ?? []), 'a2,a3');
});

console.log('\nWas in der Wirklichkeit vorkommt:');

pruefe('Nachrichten ohne Datum landen am Ende, nicht an zufaelliger Stelle', () => {
  // Ohne die Festlegung ergaeben die NaN-Vergleiche eine unbestimmte Reihenfolge.
  const ohneDatum = { id: 'x', tag: 0 };
  const { seite } = verschmelzePosteingaenge(
    [vorrat('a', [p('a1', 5), ohneDatum]), vorrat('b', [p('b1', 3)])],
    (m) => (m.id === 'x' ? null : m.tag),
    10,
  );
  assert.equal(ids(seite), 'a1,b1,x');
});

pruefe('drei Konten mit unterschiedlich vielen Nachrichten', () => {
  const { seite } = verschmelzePosteingaenge(
    [
      vorrat('a', [p('a1', 20), p('a2', 14)]),
      vorrat('b', [p('b1', 18), p('b2', 17), p('b3', 12)]),
      vorrat('c', [p('c1', 15)]),
    ],
    wann,
    10,
  );
  assert.equal(ids(seite), 'a1,b1,b2,c1,a2,b3');
});

pruefe('wiederholtes Blaettern verliert nichts und wiederholt nichts', () => {
  // Der eigentliche Beweis: die vollstaendige Runde durchspielen, wie es die Anwendung
  // tut - nachladen, verschmelzen, ausgeben, wieder von vorn.
  const bestand: Record<string, Post[]> = {
    a: Array.from({ length: 9 }, (_, i) => p(`a${i}`, 100 - i * 3)),
    b: Array.from({ length: 7 }, (_, i) => p(`b${i}`, 98 - i * 4)),
    c: Array.from({ length: 4 }, (_, i) => p(`c${i}`, 95 - i * 9)),
  };
  const geholt: Record<string, number> = { a: 0, b: 0, c: 0 };
  const HOLE = 4;

  let rest: Record<string, Post[]> = { a: [], b: [], c: [] };
  const ausgegeben: Post[] = [];

  for (let runde = 0; runde < 40; runde++) {
    const vorraete = Object.keys(bestand).map((id) => ({
      accountId: id,
      eintraege: rest[id] ?? [],
      hasMore: geholt[id]! < bestand[id]!.length,
    }));

    const ergebnis = verschmelzePosteingaenge(vorraete, wann, 5);
    ausgegeben.push(...ergebnis.seite);
    rest = ergebnis.rest;

    if (ergebnis.nachladen.length > 0) {
      // Nachladen wie der Server: die naechsten Eintraege des Kontos anhaengen.
      for (const id of ergebnis.nachladen) {
        const naechste = bestand[id]!.slice(geholt[id]!, geholt[id]! + HOLE);
        rest[id] = [...(rest[id] ?? []), ...naechste];
        geholt[id]! += naechste.length;
      }
      continue;
    }
    if (!ergebnis.hasMore) break;
    // Kein Nachladen noetig und trotzdem etwas uebrig: naechste Seite aus dem Rest.
    if (ergebnis.seite.length === 0) break;
  }

  const alle = Object.values(bestand).flat();
  assert.equal(ausgegeben.length, alle.length, `${ausgegeben.length} von ${alle.length}`);
  assert.equal(new Set(ausgegeben.map((m) => m.id)).size, alle.length, 'etwas kam doppelt');

  // Und zwar streng nach Datum absteigend - das ist der Sinn der ganzen Uebung.
  for (let i = 1; i < ausgegeben.length; i++) {
    assert.ok(
      ausgegeben[i - 1]!.tag >= ausgegeben[i]!.tag,
      `Reihenfolge verletzt bei ${ausgegeben[i - 1]!.id} (${ausgegeben[i - 1]!.tag}) vor ${ausgegeben[i]!.id} (${ausgegeben[i]!.tag})`,
    );
  }
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
