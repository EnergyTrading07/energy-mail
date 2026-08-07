import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MessageSummary } from '@energy-mail/mail-core';
import { setDataDir } from './paths.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-ablage-test-'));
setDataDir(tempDir);

const {
  ablageGroesse,
  anzahlAbgelegt,
  entferneNachrichten,
  hoechsteUid,
  holeInhalt,
  holeSeite,
  merkeInhalt,
  ablage,
  merkeKopfdaten,
  pruefeUidGueltigkeit,
  schliesseAblage,
  setzeGelesen,
  suchbestand,
  sucheLokal,
  verwerfeKontoAblage,
  verwirfAblage,
} = await import('./lokaleAblage.js');

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

const K = 'konto1';

function mail(uid: number, teil: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid,
    subject: `Betreff ${uid}`,
    from: [{ name: 'Anna Muster', address: 'anna@firma.de' }],
    to: [{ address: 'ich@privat.de' }],
    cc: [],
    date: new Date(2026, 0, 1, 12, 0, uid),
    flags: [],
    seen: false,
    hasAttachments: false,
    ...teil,
  };
}

/** Zwischen den Abschnitten sauber anfangen. */
const frisch = () => {
  verwirfAblage();
};

console.log('\nKopfdaten ablegen und lesen:');

pruefe('abgelegte Nachrichten kommen zurueck', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2), mail(3)]);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 3);
  const seite = holeSeite(K, 'INBOX');
  assert.equal(seite.length, 3);
});

pruefe('neueste zuerst', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(5), mail(3)]);
  assert.deepEqual(
    holeSeite(K, 'INBOX').map((m) => m.uid),
    [5, 3, 1],
  );
});

pruefe('alle Felder ueberstehen den Weg', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [
    mail(7, {
      subject: 'Rechnung Mai',
      from: [{ name: 'Chef', address: 'chef@firma.de' }],
      to: [{ address: 'a@b.de' }, { address: 'c@d.de' }],
      seen: true,
      flags: ['\\Seen', '\\Flagged'],
      hasAttachments: true,
      messageId: '<abc@x>',
      threadId: '99',
      listId: '<news.firma.de>',
      listUnsubscribe: '<https://x/ab>',
    }),
  ]);
  const m = holeSeite(K, 'INBOX')[0]!;
  assert.equal(m.subject, 'Rechnung Mai');
  assert.equal(m.from[0]?.name, 'Chef');
  assert.equal(m.from[0]?.address, 'chef@firma.de');
  assert.deepEqual(m.to.map((t) => t.address), ['a@b.de', 'c@d.de']);
  assert.equal(m.seen, true);
  assert.deepEqual(m.flags, ['\\Flagged']);
  assert.equal(m.hasAttachments, true);
  assert.equal(m.messageId, '<abc@x>');
  assert.equal(m.threadId, '99');
  assert.equal(m.listId, '<news.firma.de>');
  assert.equal(m.listUnsubscribe, '<https://x/ab>');
});

pruefe('dieselbe UID zweimal ersetzt statt zu verdoppeln', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Alt', seen: false })]);
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Neu', seen: true })]);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 1);
  const m = holeSeite(K, 'INBOX')[0]!;
  assert.equal(m.subject, 'Neu');
  assert.equal(m.seen, true);
});

pruefe('Ordner werden auseinandergehalten', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  merkeKopfdaten(K, 'Gesendet', [mail(1), mail(2)]);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 1);
  assert.equal(anzahlAbgelegt(K, 'Gesendet'), 2);
  assert.equal(anzahlAbgelegt(K), 3);
});

pruefe('Konten ebenfalls', () => {
  frisch();
  merkeKopfdaten('a', 'INBOX', [mail(1)]);
  merkeKopfdaten('b', 'INBOX', [mail(1)]);
  assert.equal(anzahlAbgelegt('a'), 1);
  assert.equal(anzahlAbgelegt('b'), 1);
});

pruefe('eine leere Lieferung tut nichts', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', []);
  assert.equal(anzahlAbgelegt(K), 0);
});

console.log('\nBlaettern:');

pruefe('die Seitengroesse wird eingehalten', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', Array.from({ length: 60 }, (_, i) => mail(i + 1)));
  assert.equal(holeSeite(K, 'INBOX', { anzahl: 25 }).length, 25);
});

pruefe('die naechste Seite setzt lueckenlos an', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', Array.from({ length: 60 }, (_, i) => mail(i + 1)));
  const erste = holeSeite(K, 'INBOX', { anzahl: 25 });
  const zweite = holeSeite(K, 'INBOX', { anzahl: 25, vorUid: erste[erste.length - 1]!.uid });
  assert.equal(zweite.length, 25);
  assert.equal(zweite[0]!.uid, erste[erste.length - 1]!.uid - 1);
  // Keine Ueberschneidung.
  const alle = new Set([...erste, ...zweite].map((m) => m.uid));
  assert.equal(alle.size, 50);
});

pruefe('hoechste UID wird gemeldet', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(3), mail(17), mail(9)]);
  assert.equal(hoechsteUid(K, 'INBOX'), 17);
  assert.equal(hoechsteUid(K, 'Leer'), null);
});

console.log('\nUID-Gueltigkeit:');

pruefe('beim ersten Mal wird nur gemerkt', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2)]);
  assert.equal(pruefeUidGueltigkeit(K, 'INBOX', 12345), false);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 2);
});

pruefe('gleiche Gueltigkeit laesst alles stehen', () => {
  frisch();
  pruefeUidGueltigkeit(K, 'INBOX', 12345);
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2)]);
  assert.equal(pruefeUidGueltigkeit(K, 'INBOX', 12345), false);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 2);
});

pruefe('geaenderte Gueltigkeit raeumt den Ordner', () => {
  // Sonst zeigte die Liste fremde Nachrichten unter den falschen Betreffzeilen.
  frisch();
  pruefeUidGueltigkeit(K, 'INBOX', 12345);
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2)]);
  merkeInhalt(K, 'INBOX', 1, { text: 'Hallo' });
  assert.equal(pruefeUidGueltigkeit(K, 'INBOX', 99999), true);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 0);
  assert.equal(holeInhalt(K, 'INBOX', 1), null);
});

pruefe('sie raeumt nur den betroffenen Ordner', () => {
  frisch();
  pruefeUidGueltigkeit(K, 'INBOX', 111);
  pruefeUidGueltigkeit(K, 'Gesendet', 222);
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  merkeKopfdaten(K, 'Gesendet', [mail(1)]);
  pruefeUidGueltigkeit(K, 'INBOX', 333);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 0);
  assert.equal(anzahlAbgelegt(K, 'Gesendet'), 1);
});

pruefe('ohne Angabe des Servers bleibt alles stehen', () => {
  frisch();
  pruefeUidGueltigkeit(K, 'INBOX', 111);
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  assert.equal(pruefeUidGueltigkeit(K, 'INBOX', undefined), false);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 1);
});

console.log('\nZustand aendern:');

pruefe('gelesen setzen', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2), mail(3)]);
  setzeGelesen(K, 'INBOX', [1, 3], true);
  const nach = new Map(holeSeite(K, 'INBOX').map((m) => [m.uid, m.seen]));
  assert.equal(nach.get(1), true);
  assert.equal(nach.get(2), false);
  assert.equal(nach.get(3), true);
});

pruefe('entfernen nimmt Kopf und Inhalt mit', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2)]);
  merkeInhalt(K, 'INBOX', 1, { text: 'Hallo' });
  entferneNachrichten(K, 'INBOX', [1]);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 1);
  assert.equal(holeInhalt(K, 'INBOX', 1), null);
});

pruefe('ein Konto verwerfen raeumt alles seine weg', () => {
  frisch();
  merkeKopfdaten('a', 'INBOX', [mail(1)]);
  merkeKopfdaten('b', 'INBOX', [mail(1)]);
  merkeInhalt('a', 'INBOX', 1, { text: 'x' });
  verwerfeKontoAblage('a');
  assert.equal(anzahlAbgelegt('a'), 0);
  assert.equal(holeInhalt('a', 'INBOX', 1), null);
  assert.equal(anzahlAbgelegt('b'), 1, 'das andere Konto bleibt unberuehrt');
});

console.log('\nInhalte:');

pruefe('ablegen und wiederholen', () => {
  frisch();
  merkeInhalt(K, 'INBOX', 1, {
    html: '<p>Hallo</p>',
    text: 'Hallo',
    anhaenge: [{ filename: 'a.pdf', size: 100 }],
  });
  const i = holeInhalt(K, 'INBOX', 1)!;
  assert.equal(i.html, '<p>Hallo</p>');
  assert.equal(i.text, 'Hallo');
  assert.deepEqual(i.anhaenge, [{ filename: 'a.pdf', size: 100 }]);
});

pruefe('ein nicht abgelegter Inhalt meldet nichts', () => {
  frisch();
  assert.equal(holeInhalt(K, 'INBOX', 999), null);
});

pruefe('der Bestand waechst nicht ueber die Grenze', () => {
  frisch();
  for (let i = 1; i <= 2100; i++) merkeInhalt(K, 'INBOX', i, { text: `Nummer ${i}` });
  assert.ok(ablageGroesse().inhalte <= 2000, `waren ${ablageGroesse().inhalte}`);
});

pruefe('das zuletzt Gelesene bleibt, das aelteste geht', () => {
  frisch();
  for (let i = 1; i <= 1999; i++) merkeInhalt(K, 'INBOX', i, { text: `x${i}` });
  // Nummer 1 noch einmal lesen - danach ist sie die juengste.
  holeInhalt(K, 'INBOX', 1);
  for (let i = 2000; i <= 2100; i++) merkeInhalt(K, 'INBOX', i, { text: `x${i}` });
  assert.ok(holeInhalt(K, 'INBOX', 1), 'die frisch gelesene wurde verworfen');
});

console.log('\nSuche:');

pruefe('nach Betreff', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [
    mail(1, { subject: 'Rechnung Mai 2026' }),
    mail(2, { subject: 'Angebot fuer das Projekt' }),
  ]);
  const treffer = sucheLokal(K, 'Rechnung');
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.uid, 1);
});

pruefe('nach Absender, ueber Name und Adresse', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [
    mail(1, { from: [{ name: 'Anna Muster', address: 'anna@firma.de' }] }),
    mail(2, { from: [{ name: 'Bernd Beispiel', address: 'bernd@andere.de' }] }),
  ]);
  assert.equal(sucheLokal(K, 'Anna')[0]?.uid, 1);
  assert.equal(sucheLokal(K, 'andere.de')[0]?.uid, 2);
});

pruefe('nach Empfaenger', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { to: [{ address: 'verteiler@firma.de' }] })]);
  assert.equal(sucheLokal(K, 'verteiler')[0]?.uid, 1);
});

pruefe('Wortanfaenge genuegen', () => {
  // "rechn" soll "Rechnung" finden - sonst muesste man das Wort genau treffen.
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Rechnung Mai' })]);
  assert.equal(sucheLokal(K, 'rechn').length, 1);
});

pruefe('Gross- und Kleinschreibung ist egal', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Rechnung Mai' })]);
  assert.equal(sucheLokal(K, 'RECHNUNG').length, 1);
  assert.equal(sucheLokal(K, 'rechnung').length, 1);
});

pruefe('Umlaute finden sich auch ohne', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Grüße aus München' })]);
  assert.equal(sucheLokal(K, 'Munchen').length, 1, 'ohne Umlaut nicht gefunden');
  assert.equal(sucheLokal(K, 'München').length, 1, 'mit Umlaut nicht gefunden');
});

pruefe('mehrere Woerter muessen ALLE vorkommen', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [
    mail(1, { subject: 'Rechnung Mai' }),
    mail(2, { subject: 'Rechnung Juni' }),
  ]);
  assert.equal(sucheLokal(K, 'Rechnung Mai').length, 1);
  assert.equal(sucheLokal(K, 'Rechnung').length, 2);
});

pruefe('der Text geoeffneter Nachrichten wird mitdurchsucht', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Kurze Frage' })]);
  assert.equal(sucheLokal(K, 'Zebrastreifen').length, 0, 'noch nichts abgelegt');
  merkeInhalt(K, 'INBOX', 1, { text: 'Wir treffen uns am Zebrastreifen.' });
  assert.equal(sucheLokal(K, 'Zebrastreifen').length, 1);
});

pruefe('ein erneuter Abruf der Kopfdaten verliert den Text nicht', () => {
  // Die Liste frischt sich staendig auf - dabei darf der Index nicht leerlaufen.
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Kurze Frage' })]);
  merkeInhalt(K, 'INBOX', 1, { text: 'Wir treffen uns am Zebrastreifen.' });
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Kurze Frage', seen: true })]);
  assert.equal(sucheLokal(K, 'Zebrastreifen').length, 1, 'der Text ging beim Auffrischen verloren');
});

pruefe('auf einen Ordner einschraenken', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Rechnung' })]);
  merkeKopfdaten(K, 'Gesendet', [mail(1, { subject: 'Rechnung' })]);
  assert.equal(sucheLokal(K, 'Rechnung').length, 2);
  assert.equal(sucheLokal(K, 'Rechnung', { ordner: 'Gesendet' }).length, 1);
  assert.equal(sucheLokal(K, 'Rechnung', { ordner: 'Gesendet' })[0]?.ordner, 'Gesendet');
});

pruefe('fremde Konten bleiben aussen vor', () => {
  frisch();
  merkeKopfdaten('a', 'INBOX', [mail(1, { subject: 'Geheim' })]);
  merkeKopfdaten('b', 'INBOX', [mail(1, { subject: 'Geheim' })]);
  assert.equal(sucheLokal('a', 'Geheim').length, 1);
});

pruefe('Geloeschtes wird nicht mehr gefunden', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Rechnung' }), mail(2, { subject: 'Rechnung' })]);
  entferneNachrichten(K, 'INBOX', [1]);
  const treffer = sucheLokal(K, 'Rechnung');
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.uid, 2);
});

pruefe('nach dem Raeumen eines Ordners ebenfalls nicht', () => {
  frisch();
  pruefeUidGueltigkeit(K, 'INBOX', 111);
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Rechnung' })]);
  pruefeUidGueltigkeit(K, 'INBOX', 222);
  assert.equal(sucheLokal(K, 'Rechnung').length, 0);
});

pruefe('nach dem Verwerfen eines Kontos ebenfalls nicht', () => {
  frisch();
  merkeKopfdaten('a', 'INBOX', [mail(1, { subject: 'Rechnung' })]);
  merkeKopfdaten('b', 'INBOX', [mail(1, { subject: 'Rechnung' })]);
  verwerfeKontoAblage('a');
  assert.equal(sucheLokal('a', 'Rechnung').length, 0);
  assert.equal(sucheLokal('b', 'Rechnung').length, 1);
});

pruefe('Sonderzeichen bringen die Anfrage nicht durcheinander', () => {
  // Ein eingetipptes AND, Klammern oder Anfuehrungszeichen sind Teil der
  // Abfragesprache - unbehandelt haette das einen Fehler geworfen.
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Ganz normal' })]);
  for (const eingabe of ['AND', 'OR', '(', '"', 'a*b', 'NEAR(x y)', '-', '^']) {
    assert.doesNotThrow(() => sucheLokal(K, eingabe), `warf bei "${eingabe}"`);
  }
});

pruefe('eine leere Eingabe findet nichts', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  assert.deepEqual(sucheLokal(K, ''), []);
  assert.deepEqual(sucheLokal(K, '   '), []);
});

pruefe('neueste zuerst und die Grenze wird eingehalten', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', Array.from({ length: 40 }, (_, i) => mail(i + 1, { subject: 'Rechnung' })));
  const treffer = sucheLokal(K, 'Rechnung', { grenze: 10 });
  assert.equal(treffer.length, 10);
  assert.equal(treffer[0]?.uid, 40);
});

pruefe('der Bestand wird gemeldet', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2), mail(3)]);
  merkeInhalt(K, 'INBOX', 1, { text: 'x' });
  const b = suchbestand(K);
  assert.equal(b.kopfdaten, 3);
  assert.equal(b.mitText, 1);
});

console.log('\nWiderstandsfaehigkeit:');

pruefe('eine beschaedigte Ablage wird neu angelegt', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  const groesse = ablageGroesse();
  assert.ok(groesse.bytes > 0);
  verwirfAblage();

  fs.writeFileSync(path.join(tempDir, 'ablage.db'), 'das ist keine Datenbank');
  // Darf nicht werfen, sondern neu anfangen.
  assert.equal(anzahlAbgelegt(K), 0);
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  assert.equal(anzahlAbgelegt(K), 1);
});

pruefe('der Stand ueberdauert das Schliessen und Wiederoeffnen', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1), mail(2)]);
  merkeInhalt(K, 'INBOX', 1, { text: 'bleibt' });
  pruefeUidGueltigkeit(K, 'INBOX', 4711);

  // Nur schliessen, nicht loeschen - das ist der Neustart der Anwendung.
  schliesseAblage();

  assert.equal(anzahlAbgelegt(K, 'INBOX'), 2, 'die Kopfdaten sind weg');
  assert.equal(holeInhalt(K, 'INBOX', 1)?.text, 'bleibt', 'der Inhalt ist weg');
  // Und die gemerkte Gueltigkeit auch - sonst wuerde nach jedem Start geleert.
  assert.equal(pruefeUidGueltigkeit(K, 'INBOX', 4711), false, 'die Gueltigkeit ging verloren');
});

pruefe('eine veraltete Aufbaufassung wird verworfen statt umgestellt', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  ablage().prepare("insert or replace into stand (schluessel, wert) values ('fassung', '0')").run();
  schliesseAblage();

  // Beim naechsten Oeffnen faellt die alte Fassung auf und alles faengt neu an.
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 0);
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 1);
});

verwirfAblage();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
