import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MessageSummary } from '@energy-mail/mail-core';
import { setDataDir, getNutzerDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';
import { setKeyProvider } from './secretCrypto.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-ablage-test-'));
setDataDir(tempDir);

/*
 * Ein Schluessel, damit die Verschluesselung der Inhalte hier ueberhaupt greift.
 *
 * Ohne eingerichteten Schluessel legt die Ablage im Klartext ab - der Rueckfallweg fuer
 * Werkzeuge und den Standalone-Server ohne Master-Passwort. Genau der wuerde die eine
 * Pruefung wertlos machen, auf die es hier ankommt: dass der Wortlaut einer Nachricht
 * nicht in der Datei steht. Fester Wert statt Zufall, damit ein Fehlschlag
 * nachvollziehbar bleibt.
 */
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });
// Die Pruefungen rufen die Speicher unmittelbar auf - ohne Anfrage, die den
// Nutzerkontext mitbraechte. Dieser Prozess arbeitet durchgehend als ein Nutzer.
betreteNutzerFuerProzess('pruefung');

// Die Speicher legen ihre Dateien im Ordner des Nutzers ab, nicht in der Wurzel.
const datenDir = getNutzerDir();
// Anlegen, bevor eine Pruefung hineinsieht - die Speicher taeten es erst beim Schreiben.
fs.mkdirSync(datenDir, { recursive: true });


const {
  ablageGroesse,
  anzahlAbgelegt,
  entferneNachrichten,
  hoechsteUid,
  holeInhalt,
  holeSeite,
  leereAblage,
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

/*
 * Was "geloescht" bedeutet - auf der Platte nachgesehen.
 *
 * Die Pruefungen darueber fragen die Datenbank, und die antwortet artig "nicht mehr da".
 * Das ist die halbe Antwort: SQLite hakt eine geloeschte Zeile ohne Zutun nur als "Platz
 * ist wieder frei" ab und laesst den Wortlaut stehen, bis zufaellig etwas anderes
 * darueberfaellt. Ein Nutzer loescht eine Nachricht, sie verschwindet aus der Liste - und
 * ihr Text steht weiter in der Datei, lesbar mit jedem Texteditor.
 *
 * Deshalb sieht diese Pruefung nicht die Datenbank an, sondern die Bytes. Sie ist der
 * einzige Waechter ueber "pragma secure_delete" in lokaleAblage.ts: faellt die Zeile
 * einmal weg, faellt es sonst niemandem auf.
 *
 * Vorher schliessen: im WAL-Betrieb steht die Aenderung zunaechst in der Begleitdatei,
 * und die urspruengliche Seite bleibt bis zum Zusammenfuehren unberuehrt in ablage.db.
 */
pruefe('den ganzen Bestand wegwerfen', () => {
  /*
   * Der Knopf fuer den Rechner, der weitergegeben wird. Er muss dreierlei leisten: der
   * Bestand ist weg, die Suche findet nichts mehr, und die Anwendung laeuft danach
   * weiter - die Ablage ist ein Abbild und baut sich beim naechsten Abruf wieder auf.
   */
  frisch();
  merkeKopfdaten('a', 'INBOX', [mail(1), mail(2)]);
  merkeKopfdaten('b', 'Gesendet', [mail(1)]);
  merkeInhalt('a', 'INBOX', 1, { text: 'Termin beim Amtsgericht' });

  const weg = leereAblage();
  assert.equal(weg.nachrichten, 3, 'die Meldung nennt eine andere Zahl als geloescht wurde');
  assert.equal(weg.inhalte, 1);

  assert.equal(anzahlAbgelegt('a'), 0);
  assert.equal(anzahlAbgelegt('b'), 0);
  assert.equal(holeInhalt('a', 'INBOX', 1), null);
  assert.deepEqual(sucheLokal('a', 'Amtsgericht'), [], 'der Suchindex haelt es noch fest');

  // Und danach laesst sich weiterarbeiten, ohne Neustart.
  merkeKopfdaten('a', 'INBOX', [mail(5)]);
  assert.equal(anzahlAbgelegt('a', 'INBOX'), 1);
});

pruefe('geloeschte Kopfdaten stehen nicht mehr in der Datei', () => {
  /*
   * Am Betreff gemessen und nicht am Nachrichtentext, seit der verschluesselt liegt: der
   * Betreff steht im Klartext in der Datei (die Liste und der Suchindex haengen daran),
   * und damit ist er der richtige Zeuge fuer "secure_delete". Faellt die Pragma-Zeile
   * weg, schlaegt diese Pruefung an.
   */
  frisch();
  const betreff = 'Kernspintomographie-Befund-42';
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: betreff })]);

  schliesseAblage();
  const datei = path.join(getNutzerDir(), 'ablage.db');
  assert.ok(
    fs.readFileSync(datei).includes(betreff),
    'die Pruefung selbst taugt nichts - der Betreff stand von vornherein nicht in der Datei',
  );

  entferneNachrichten(K, 'INBOX', [1]);
  schliesseAblage();
  assert.ok(
    !fs.readFileSync(datei).includes(betreff),
    'der Betreff der geloeschten Nachricht steht weiter in ablage.db',
  );
});

console.log('\nVerschluesselte Inhalte:');

/*
 * Die Pruefung, um die es bei der ganzen Umstellung geht.
 *
 * Bis dahin galt: verschluesselt sind die Zugangsdaten, nicht die Post. Wer den
 * Benutzerordner kopierte oder die Platte ausbaute, las in ablage.db den vollen Text
 * jeder geoeffneten Nachricht - ohne ein Kennwort zu kennen. Gemessen wird deshalb nicht
 * an der Datenbank, sondern an den Bytes der Datei.
 */
pruefe('der Wortlaut einer Nachricht steht nicht in der Datei', () => {
  frisch();
  const wortlaut = 'HOCHVERTRAULICH-Befund-Kernspintomographie-42';
  const html = '<p>HOCHVERTRAULICH-als-HTML-4711</p>';
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  merkeInhalt(K, 'INBOX', 1, {
    text: wortlaut,
    html,
    anhaenge: [{ filename: 'Befund-Mueller.pdf', size: 100 }],
  });
  schliesseAblage();

  const bytes = fs.readFileSync(path.join(getNutzerDir(), 'ablage.db'));
  assert.ok(!bytes.includes(wortlaut), 'der Nachrichtentext steht im Klartext in ablage.db');
  assert.ok(!bytes.includes(html), 'das HTML der Nachricht steht im Klartext in ablage.db');
  assert.ok(
    !bytes.includes('Befund-Mueller.pdf'),
    'der Dateiname des Anhangs steht im Klartext in ablage.db',
  );
});

pruefe('und kommt trotzdem unveraendert zurueck', () => {
  // Verschluesseln, das beim Lesen etwas anderes ergibt, waere schlimmer als keines.
  frisch();
  const inhalt = {
    text: 'Zeile eins\nZeile zwei mit Umlauten: Grüße, Straße, Öl',
    html: '<p>Grüße &amp; Tschüss</p>',
    anhaenge: [{ filename: 'a.pdf', size: 100 }],
  };
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  merkeInhalt(K, 'INBOX', 1, inhalt);

  // Ueber das Schliessen hinweg: sonst kaeme die Antwort womoeglich aus dem Speicher.
  schliesseAblage();
  const zurueck = holeInhalt(K, 'INBOX', 1)!;
  assert.equal(zurueck.text, inhalt.text);
  assert.equal(zurueck.html, inhalt.html);
  assert.deepEqual(zurueck.anhaenge, inhalt.anhaenge);
});

pruefe('ein Text, der zufaellig wie ein Geheimnis anfaengt', () => {
  /*
   * "v1." ist der Anfang des Formats, in dem Geheimnisse abgelegt werden - und der Anfang
   * einer voellig gewoehnlichen Zeile in einer Mail. Wuerde der Text beim Lesen fuer ein
   * Geheimnis gehalten und das Entschluesseln scheiterte, waere die Nachricht weg.
   */
  frisch();
  const text = 'v1.2.3 ist draussen. Bitte einmal aktualisieren.';
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  merkeInhalt(K, 'INBOX', 1, { text });
  schliesseAblage();
  assert.equal(holeInhalt(K, 'INBOX', 1)!.text, text);
});

pruefe('mit einem anderen Schluessel bleibt der Inhalt verschlossen', () => {
  /*
   * Der Fall, um dessentwillen das Ganze da ist: der Ordner liegt auf einem anderen
   * Rechner oder unter einem anderen Windows-Konto. Dann ist der Inhalt nicht lesbar -
   * und zwar ohne Absturz. Die Ablage ist ein Abbild; was sich nicht oeffnen laesst, wird
   * beim naechsten Abruf neu geholt.
   */
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  merkeInhalt(K, 'INBOX', 1, { text: 'Nur fuer mich.' });
  schliesseAblage();

  setKeyProvider({ name: 'Fremder', getKey: () => Buffer.alloc(32, 9) });
  try {
    const zurueck = holeInhalt(K, 'INBOX', 1);
    assert.equal(zurueck?.text, undefined, 'der Text kam trotz fremdem Schluessel heraus');
  } finally {
    setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });
  }
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

/*
 * Der Nachrichtentext wird NICHT mitdurchsucht - und das ist der Sinn der Sache.
 *
 * Hier stand die umgekehrte Pruefung, und sie hielt fest, was damals richtig war. Seit
 * die Inhalte verschluesselt liegen, waere ein Volltextindex ueber sie eine
 * unverschluesselte zweite Fassung jeder gelesenen Nachricht, gleich daneben in derselben
 * Datei: eine FTS5-Tabelle legt den Originaltext ab, nicht nur die Wortliste. Man kann
 * das eine oder das andere haben.
 *
 * Diese Pruefung ist der Waechter darueber. Kommt der Text eines Tages wieder in den
 * Index - weil jemand die Suche "repariert" -, schlaegt sie an und sagt, was dabei
 * aufgegeben wird.
 */
pruefe('der Nachrichtentext geht nicht in den Suchindex', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Kurze Frage' })]);
  merkeInhalt(K, 'INBOX', 1, { text: 'Wir treffen uns am Zebrastreifen.' });
  assert.equal(
    sucheLokal(K, 'Zebrastreifen').length,
    0,
    'der Nachrichtentext steht im Klartext im Suchindex',
  );
  // Der Betreff dagegen schon - sonst waere die Suche gar nichts mehr wert.
  assert.equal(sucheLokal(K, 'Frage').length, 1);
});

pruefe('ein erneuter Abruf der Kopfdaten laesst den Betreff im Index', () => {
  // Die Liste frischt sich staendig auf - dabei darf der Index nicht leerlaufen.
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Kurze Frage' })]);
  merkeInhalt(K, 'INBOX', 1, { text: 'Wir treffen uns am Zebrastreifen.' });
  merkeKopfdaten(K, 'INBOX', [mail(1, { subject: 'Kurze Frage', seen: true })]);
  assert.equal(sucheLokal(K, 'Frage').length, 1, 'der Betreff ging beim Auffrischen verloren');
  // Und der Text ist auch nach dem Auffrischen nicht hineingerutscht.
  assert.equal(sucheLokal(K, 'Zebrastreifen').length, 0);
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

  fs.writeFileSync(path.join(datenDir, 'ablage.db'), 'das ist keine Datenbank');
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

/*
 * Diese Pruefung hiess einmal "eine veraltete Aufbaufassung wird verworfen statt
 * umgestellt" und forderte genau das ein: bei jeder Abweichung wurde die gesamte
 * Datenbank geloescht.
 *
 * Fuer ein Einplatzprogramm war das vertretbar - die Ablage ist ein Abbild des
 * Postfachs, und bei 31.700 Nachrichten kostete es ein paar Stunden Nachladen. Fuer
 * einen Dienst mit vielen Nutzern ist es das nicht: jede Aktualisierung, die das Schema
 * anfasst, liesse SAEMTLICHE Nutzer im selben Augenblick ihren Bestand neu laden, und
 * der Anbieter bekaeme von allen Seiten gleichzeitig Vollabrufe.
 *
 * Jetzt wird umgestellt statt geleert. Die Einzelheiten stehen in
 * ablageMigration.test.mts; hier bleibt der Fall, weil er zum uebrigen Verhalten der
 * Ablage gehoert.
 */
pruefe('eine veraltete Aufbaufassung wird umgestellt, nicht verworfen', () => {
  frisch();
  merkeKopfdaten(K, 'INBOX', [mail(1)]);
  ablage().prepare("insert or replace into stand (schluessel, wert) values ('fassung', '0')").run();
  schliesseAblage();

  // Beim naechsten Oeffnen laufen die fehlenden Schritte - der Bestand bleibt.
  assert.equal(anzahlAbgelegt(K, 'INBOX'), 1, 'der Bestand wurde geleert');
});

verwirfAblage();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
