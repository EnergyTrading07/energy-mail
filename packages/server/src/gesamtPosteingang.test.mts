import assert from 'node:assert/strict';
import { markeAlsText, markeAusText, naechsteMarke } from './gesamtPosteingang.js';

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

console.log('\nDie Marke fuer die naechste Seite:');

pruefe('haelt je Konto die kleinste ausgegebene Nummer fest', () => {
  const marke = naechsteMarke({}, [
    { accountId: 'a', uid: 100 },
    { accountId: 'b', uid: 50 },
    { accountId: 'a', uid: 95 },
  ]);
  assert.deepEqual(marke, { a: 95, b: 50 });
});

pruefe('NICHT die zuletzt ausgegebene - daran scheiterte es', () => {
  // Sortiert wird nach Datum, geblaettert nach Nummer, und beides stimmt nicht immer
  // ueberein: eine unterwegs haengengebliebene Nachricht traegt eine hoehere Nummer bei
  // aelterem Datum. Nahm man die letzte, kam eine schon gezeigte noch einmal.
  const marke = naechsteMarke({}, [
    { accountId: 'a', uid: 90 },
    { accountId: 'a', uid: 100 }, // aelteres Datum, hoehere Nummer
  ]);
  assert.equal(marke.a, 90, 'mit 100 kaeme die Nachricht 90 auf der naechsten Seite erneut');
});

pruefe('ein Konto ohne Beitrag behaelt seine alte Marke', () => {
  // Sonst finge dessen Liste beim naechsten Mal wieder von vorn an.
  const marke = naechsteMarke({ a: 500, b: 300 }, [{ accountId: 'a', uid: 480 }]);
  assert.deepEqual(marke, { a: 480, b: 300 });
});

pruefe('die Marke geht nur nach unten', () => {
  const marke = naechsteMarke({ a: 200 }, [{ accountId: 'a', uid: 900 }]);
  assert.equal(marke.a, 200, 'eine hoehere Nummer wuerde bereits Gezeigtes wiederholen');
});

pruefe('Eintraege ohne Konto werden uebergangen', () => {
  assert.deepEqual(naechsteMarke({ a: 5 }, [{ uid: 999 }]), { a: 5 });
});

pruefe('eine leere Seite laesst die Marke unveraendert', () => {
  assert.deepEqual(naechsteMarke({ a: 5, b: 7 }, []), { a: 5, b: 7 });
});

console.log('\nDie Marke als Text - sie steht in der Adresszeile:');

pruefe('hin und zurueck ergibt dasselbe', () => {
  const marke = { 'konto-eins': 42, 'konto-zwei': 1337 };
  assert.deepEqual(markeAusText(markeAlsText(marke)), marke);
});

pruefe('Kennungen mit Bindestrichen bleiben heil', () => {
  // Echte Kennungen sehen so aus: 8e2f804f-86a6-4b15-bf4d-f42b3eac0704
  const marke = { '8e2f804f-86a6-4b15-bf4d-f42b3eac0704': 32249 };
  assert.deepEqual(markeAusText(markeAlsText(marke)), marke);
});

pruefe('eine leere oder fehlende Angabe ergibt eine leere Marke', () => {
  assert.deepEqual(markeAusText(undefined), {});
  assert.deepEqual(markeAusText(''), {});
  assert.deepEqual(markeAlsText({}), '');
});

pruefe('Unsinn in der Adresszeile wird verworfen, nicht uebernommen', () => {
  assert.deepEqual(markeAusText('kaputt,ohne-doppelpunkt,a:0,b:-5,c:xyz,d:7'), { d: 7 });
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
