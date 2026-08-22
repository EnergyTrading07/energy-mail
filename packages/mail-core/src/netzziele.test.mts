import assert from 'node:assert/strict';
import { istInternesZiel, netzzielRegelGilt, pruefeZiel, setzeNetzzielRegel } from './netzziele.js';

/*
 * Der Riegel gegen Verbindungen ins interne Netz.
 *
 * Er entscheidet, ob ein Fremder, der sich selbst angemeldet hat, das Netz des Betreibers
 * abtasten kann - siehe den Kopf von netzziele.ts. Bei einem solchen Filter zaehlt jede
 * Luecke, und Luecken entstehen hier durch Schreibweisen: eine IPv4 in IPv6-Kleidung, ein
 * Name statt einer Adresse, ein zweiter A-Eintrag neben einem harmlosen ersten.
 */

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

console.log('\nWelche Adressen als intern gelten:');

await pruefe('die privaten Bereiche nach RFC 1918', () => {
  for (const a of ['10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.1', '192.168.2.1']) {
    assert.equal(istInternesZiel(a), true, `${a} muesste intern sein`);
  }
});

await pruefe('172.15 und 172.32 sind es NICHT - der Bereich ist eng', () => {
  // Der haeufigste Fehler bei dieser Pruefung: 172.* pauschal zu sperren. 172.16 bis
  // 172.31 sind privat, davor und danach gehoert es jemandem.
  assert.equal(istInternesZiel('172.15.0.1'), false);
  assert.equal(istInternesZiel('172.32.0.1'), false);
});

await pruefe('Loopback, Link-local und der Metadatendienst', () => {
  assert.equal(istInternesZiel('127.0.0.1'), true);
  assert.equal(istInternesZiel('127.1.2.3'), true);
  assert.equal(istInternesZiel('0.0.0.0'), true);
  // 169.254.169.254 ist bei mehreren Anbietern der Weg zu den Zugangsdaten der Maschine.
  assert.equal(istInternesZiel('169.254.169.254'), true);
});

await pruefe('der CGNAT-Bereich - dort liegt auch das Tailnet', () => {
  // 100.64.0.0/10. Auf diesem Server erreicht man darueber die anderen Rechner des
  // Betreibers; genau die soll ein Fremder nicht abtasten koennen.
  assert.equal(istInternesZiel('100.71.217.53'), true);
  assert.equal(istInternesZiel('100.64.0.1'), true);
  assert.equal(istInternesZiel('100.127.255.254'), true);
  // Davor und danach ist gewoehnliches Internet.
  assert.equal(istInternesZiel('100.63.255.255'), false);
  assert.equal(istInternesZiel('100.128.0.1'), false);
});

await pruefe('oeffentliche Adressen kommen durch', () => {
  for (const a of ['1.1.1.1', '8.8.8.8', '138.201.245.174', '172.217.16.14']) {
    assert.equal(istInternesZiel(a), false, `${a} wurde faelschlich gesperrt`);
  }
});

await pruefe('IPv6: Loopback, Link-local, Unique-local', () => {
  assert.equal(istInternesZiel('::1'), true);
  assert.equal(istInternesZiel('fe80::1'), true);
  assert.equal(istInternesZiel('fd00::1'), true);
  assert.equal(istInternesZiel('2a01:4f8:c014:938e::1'), false);
});

await pruefe('eine IPv4 in IPv6-Kleidung zaehlt als das, was sie ist', () => {
  /*
   * Ohne diese Umrechnung waere der ganze Riegel mit einem Praefix zu umgehen:
   * ::ffff:192.168.2.1 ist dieselbe Adresse in anderer Schreibweise.
   */
  assert.equal(istInternesZiel('::ffff:192.168.2.1'), true);
  assert.equal(istInternesZiel('::ffff:127.0.0.1'), true);
  assert.equal(istInternesZiel('::ffff:8.8.8.8'), false);
});

await pruefe('was keine Adresse ist, gilt im Zweifel als intern', () => {
  // Die Richtung des Zweifels ist bei einem Riegel immer dieselbe.
  assert.equal(istInternesZiel('kein-host'), true);
  assert.equal(istInternesZiel(''), true);
});

console.log('\nDer Riegel im Betrieb:');

await pruefe('ausgeschaltet laesst er alles durch - auch localhost', () => {
  /*
   * Der Auslieferungszustand. Ein Betrieb mit eigenem Mailserver im Haus muss weiterhin
   * auf eine interne Adresse zeigen duerfen; dort legt ein Verwalter die Konten an.
   */
  setzeNetzzielRegel(false);
  assert.equal(netzzielRegelGilt(), false);
  return pruefeZiel('127.0.0.1');
});

await pruefe('eingeschaltet weist er eine interne IP ab', async () => {
  setzeNetzzielRegel(true);
  await assert.rejects(() => pruefeZiel('192.168.2.1'), /internen Netz|offenen Netz/);
});

await pruefe('und localhost, ohne es erst aufzuloesen', async () => {
  // Der Name bedeutet je nach Rechner etwas anderes; und die Meldung ist verstaendlicher,
  // wenn sie den Namen nennt statt der Adresse dahinter.
  await assert.rejects(() => pruefeZiel('localhost'), /offenen Netz/);
  await assert.rejects(() => pruefeZiel('mail.firma.local'), /offenen Netz/);
});

await pruefe('ein oeffentlicher Name kommt durch', async () => {
  // Braucht eine Aufloesung - wenn hier kein Netz ist, faellt die Pruefung aus und nicht
  // durch: Sie meldet dann einen Aufloesungsfehler, und das ist kein Befund ueber den
  // Riegel.
  try {
    await pruefeZiel('imap.gmail.com');
  } catch (err) {
    const text = (err as Error).message;
    if (/aufl/i.test(text)) {
      console.log('       (uebersprungen: keine Namensaufloesung verfuegbar)');
      return;
    }
    throw err;
  }
});

await pruefe('eine leere Angabe kommt nicht durch', async () => {
  await assert.rejects(() => pruefeZiel('   '), /Ohne Adresse/);
});

// Aufraeumen: Der Modulzustand wirkt sonst in andere Pruefdateien hinein.
setzeNetzzielRegel(false);

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
