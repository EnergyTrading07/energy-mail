import assert from 'node:assert/strict';
import type { MessageSummary } from './types.js';
import { findeOffeneVorgaenge } from './nachfassen.js';

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

const JETZT = new Date('2026-07-29T12:00:00.000Z');
const ICH = 'hendrik@example.de';

/** Ein Datum, das die angegebene Zahl Tage zurückliegt. */
const vorTagen = (tage: number) => new Date(JETZT.getTime() - tage * 86_400_000);

function mail(teil: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid: 1,
    subject: 'Angebot',
    from: [{ address: 'kunde@firma.de' }],
    to: [{ address: ICH }],
    cc: [],
    date: vorTagen(10),
    flags: [],
    seen: true,
    hasAttachments: false,
    ...teil,
  };
}

/**
 * Wertet aus. Standardmäßig mit "auchUnbekannte", weil die meisten Prüfungen die
 * Grundregeln betreffen und nicht die engere Voreinstellung - die hat eigene Prüfungen.
 */
const auswerten = (
  posteingang: MessageSummary[],
  gesendet: MessageSummary[],
  optionen: Partial<Parameters<typeof findeOffeneVorgaenge>[1]> = {},
) =>
  findeOffeneVorgaenge(
    { posteingang, gesendet, gesendetOrdner: 'Gesendet' },
    { eigeneAdressen: [ICH], jetzt: JETZT, auchUnbekannte: true, ...optionen },
  );

console.log('\nWas offen ist:');

pruefe('eine unbeantwortete Nachricht wird gefunden', () => {
  const treffer = auswerten([mail({ messageId: '<a@x>' })], []);
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.art, 'nichtBeantwortet');
  assert.equal(treffer[0]?.gegenueber[0]?.address, 'kunde@firma.de');
  assert.equal(treffer[0]?.tageOffen, 10);
});

pruefe('eine eigene Nachricht ohne Antwort wartet', () => {
  const treffer = auswerten(
    [],
    [mail({ messageId: '<a@x>', from: [{ address: ICH }], to: [{ address: 'kunde@firma.de' }] })],
  );
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.art, 'wartetAufAntwort');
  assert.equal(treffer[0]?.ordner, 'Gesendet');
});

pruefe('beantwortete Post taucht nicht auf', () => {
  const eingang = mail({ uid: 1, messageId: '<a@x>', date: vorTagen(10) });
  const antwort = mail({
    uid: 2,
    messageId: '<b@x>',
    inReplyTo: '<a@x>',
    from: [{ address: ICH }],
    to: [{ address: 'kunde@firma.de' }],
    date: vorTagen(9),
  });
  const treffer = auswerten([eingang], [antwort]);
  // Meine Antwort ist die jüngste - also warte ich, statt zu schulden.
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.art, 'wartetAufAntwort');
  assert.equal(treffer[0]?.umfang, 2, 'beide Nachrichten gehören zum selben Gespräch');
});

pruefe('nach der Gegenantwort schulde ich wieder', () => {
  const treffer = auswerten(
    [
      mail({ uid: 1, messageId: '<a@x>', date: vorTagen(12) }),
      mail({ uid: 3, messageId: '<c@x>', inReplyTo: '<b@x>', date: vorTagen(8) }),
    ],
    [
      mail({
        uid: 2,
        messageId: '<b@x>',
        inReplyTo: '<a@x>',
        from: [{ address: ICH }],
        to: [{ address: 'kunde@firma.de' }],
        date: vorTagen(10),
      }),
    ],
  );
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.art, 'nichtBeantwortet');
  assert.equal(treffer[0]?.uid, 3, 'die jüngste Nachricht trägt den Vorgang');
  assert.equal(treffer[0]?.umfang, 3);
});

pruefe('References verbindet auch ohne In-Reply-To', () => {
  // Manche Programme antworten auf eine ältere Nachricht des Fadens.
  const treffer = auswerten(
    [mail({ uid: 1, messageId: '<a@x>', date: vorTagen(10) })],
    [
      mail({
        uid: 2,
        messageId: '<b@x>',
        references: ['<a@x>'],
        from: [{ address: ICH }],
        to: [{ address: 'kunde@firma.de' }],
        date: vorTagen(9),
      }),
    ],
  );
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.umfang, 2);
});

pruefe('die Gesprächskennung des Servers verbindet ebenfalls', () => {
  const treffer = auswerten(
    [mail({ uid: 1, messageId: '<a@x>', threadId: '77', date: vorTagen(10) })],
    [
      mail({
        uid: 2,
        messageId: '<b@x>',
        threadId: '77',
        from: [{ address: ICH }],
        to: [{ address: 'kunde@firma.de' }],
        date: vorTagen(9),
      }),
    ],
  );
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.umfang, 2);
});

pruefe('spitze Klammern stören den Abgleich nicht', () => {
  const treffer = auswerten(
    [mail({ uid: 1, messageId: 'a@x', date: vorTagen(10) })],
    [
      mail({
        uid: 2,
        messageId: '<b@x>',
        inReplyTo: '<A@X>',
        from: [{ address: ICH }],
        to: [{ address: 'kunde@firma.de' }],
        date: vorTagen(9),
      }),
    ],
  );
  assert.equal(treffer[0]?.umfang, 2, 'Kennungen mit und ohne Klammern gehören zusammen');
});

console.log('\nWas nicht gemeldet werden darf:');

pruefe('frische Post ist noch kein Vorwurf', () => {
  assert.equal(auswerten([mail({ date: vorTagen(1) })], []).length, 0);
});

pruefe('sehr Altes verjährt', () => {
  assert.equal(auswerten([mail({ date: vorTagen(200) })], []).length, 0);
});

pruefe('die Schwellen lassen sich verschieben', () => {
  assert.equal(auswerten([mail({ date: vorTagen(1) })], [], { mindestTage: 0 }).length, 1);
  assert.equal(auswerten([mail({ date: vorTagen(200) })], [], { hoechstTage: 365 }).length, 1);
});

pruefe('Rundmails bleiben draußen', () => {
  assert.equal(auswerten([mail({ listId: '<news.firma.de>' })], []).length, 0);
  assert.equal(auswerten([mail({ listUnsubscribe: '<https://x/ab>' })], []).length, 0);
});

pruefe('von no-reply erwartet niemand eine Antwort', () => {
  assert.equal(auswerten([mail({ from: [{ address: 'no-reply@firma.de' }] })], []).length, 0);
  assert.equal(auswerten([mail({ from: [{ address: 'donotreply@firma.de' }] })], []).length, 0);
  assert.equal(auswerten([mail({ from: [{ address: 'mailer-daemon@firma.de' }] })], []).length, 0);
});

pruefe('no-reply auch mitten in der Adresse', () => {
  // So kamen sie im echten Postfach vor - eine Pruefung auf den Wortanfang liess sie durch.
  const durchgelassen = [
    'notifications-noreply@linkedin.com',
    'messages-noreply@linkedin.com',
    'service.no-reply@firma.de',
  ].filter((a) => auswerten([mail({ from: [{ address: a }] })], []).length > 0);
  assert.deepEqual(durchgelassen, []);
});

pruefe('ein Name, der zufaellig "reply" enthaelt, bleibt drin', () => {
  assert.equal(auswerten([mail({ from: [{ address: 'replykom@firma.de' }] })], []).length, 1);
});

console.log('\nRundfunk gegen Gegenueber:');

/** Baut die genannte Zahl unbeantworteter Nachrichten desselben Absenders. */
const vieleVon = (adresse: string, anzahl: number) =>
  Array.from({ length: anzahl }, (_, i) =>
    mail({
      uid: i + 1,
      messageId: `<m${i}@x>`,
      from: [{ address: adresse }],
      date: vorTagen(10 + i),
    }),
  );

pruefe('wer oft schreibt und nie Antwort bekommt, gilt als Rundfunk', () => {
  // So verhielt sich im Postfach ein Absender mit 121 Nachrichten - ohne Abmeldezeile
  // und ohne Verteilerkennung, also von den Kopfzeilen allein nicht zu erkennen.
  assert.equal(auswerten(vieleVon('werbung@firma.de', 2), []).length, 2, 'zweimal ist noch wenig');
  assert.equal(auswerten(vieleVon('werbung@firma.de', 3), []).length, 0);
  assert.equal(auswerten(vieleVon('werbung@firma.de', 40), []).length, 0);
});

pruefe('wem ich selbst geschrieben habe, der bleibt Gegenueber', () => {
  const meineMail = mail({
    uid: 99,
    messageId: '<eigen@x>',
    from: [{ address: ICH }],
    to: [{ address: 'kollege@firma.de' }],
    date: vorTagen(50),
  });
  const treffer = auswerten(vieleVon('kollege@firma.de', 5), [meineMail]);
  assert.equal(treffer.filter((v) => v.art === 'nichtBeantwortet').length, 5);
});

console.log('\nVoreinstellung: nur Bekannte und echte Gespraeche:');

pruefe('eine einzelne Nachricht von einem Unbekannten bleibt draussen', () => {
  // Gemessen: so verschwanden im echten Postfach 39 Versandbestaetigungen, Rechnungen
  // und Hinweise auf geaenderte Geschaeftsbedingungen aus der Liste.
  const eng = auswerten([mail({ from: [{ address: 'fremd@shop.de' }] })], [], {
    auchUnbekannte: false,
  });
  assert.equal(eng.length, 0);
});

pruefe('ein Hin und Her zaehlt auch bei Unbekannten', () => {
  const treffer = auswerten(
    [
      mail({ uid: 1, messageId: '<a@x>', from: [{ address: 'fremd@shop.de' }], date: vorTagen(12) }),
      mail({
        uid: 3,
        messageId: '<c@x>',
        inReplyTo: '<b@x>',
        from: [{ address: 'fremd@shop.de' }],
        date: vorTagen(8),
      }),
    ],
    [
      mail({
        uid: 2,
        messageId: '<b@x>',
        inReplyTo: '<a@x>',
        from: [{ address: ICH }],
        to: [{ address: 'fremd@shop.de' }],
        date: vorTagen(10),
      }),
    ],
    { auchUnbekannte: false },
  );
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.art, 'nichtBeantwortet');
});

pruefe('wer im selben Haus sitzt wie ein Bekannter, zaehlt auch', () => {
  // Wer sich beworben hat, bekommt danach Post von mehreren Leuten derselben Firma.
  const meineBewerbung = mail({
    uid: 50,
    messageId: '<bew@x>',
    from: [{ address: ICH }],
    to: [{ address: 'personal@firma.de' }],
    date: vorTagen(60),
  });
  const treffer = auswerten(
    [mail({ uid: 1, messageId: '<a@x>', from: [{ address: 'chefin@firma.de' }] })],
    [meineBewerbung],
    { auchUnbekannte: false },
  );
  assert.equal(treffer.filter((v) => v.art === 'nichtBeantwortet').length, 1);
});

pruefe('das Warten auf Antwort bleibt von der Voreinstellung unberuehrt', () => {
  const treffer = auswerten(
    [],
    [mail({ from: [{ address: ICH }], to: [{ address: 'voellig@fremd.de' }] })],
    { auchUnbekannte: false },
  );
  assert.equal(treffer.length, 1, 'was ich selbst geschrieben habe, zaehlt immer');
});

pruefe('als maschinell gekennzeichnete Post bleibt draussen', () => {
  assert.equal(auswerten([mail({ maschinell: true })], []).length, 0);
});

pruefe('der Rundfunk-Filter beruehrt das Warten auf Antwort nicht', () => {
  const eigene = Array.from({ length: 6 }, (_, i) =>
    mail({
      uid: i + 1,
      messageId: `<e${i}@x>`,
      from: [{ address: ICH }],
      to: [{ address: 'amt@behoerde.de' }],
      date: vorTagen(10 + i),
    }),
  );
  assert.equal(auswerten([], eigene).length, 6);
});

pruefe('an no-reply geschriebene Post wartet auf nichts', () => {
  const treffer = auswerten(
    [],
    [mail({ from: [{ address: ICH }], to: [{ address: 'noreply@firma.de' }] })],
  );
  assert.equal(treffer.length, 0);
});

pruefe('stille Verteiler ohne meine Adresse zählen nicht', () => {
  const treffer = auswerten([mail({ to: [{ address: 'verteiler@firma.de' }], cc: [] })], []);
  assert.equal(treffer.length, 0);
});

pruefe('in Kopie gesetzt zählt aber schon', () => {
  const treffer = auswerten(
    [mail({ to: [{ address: 'wer-anders@firma.de' }], cc: [{ address: ICH }] })],
    [],
  );
  assert.equal(treffer.length, 1);
});

pruefe('an mich selbst geschriebene Notizen warten auf nichts', () => {
  const treffer = auswerten(
    [],
    [mail({ from: [{ address: ICH }], to: [{ address: ICH }], cc: [] })],
  );
  assert.equal(treffer.length, 0);
});

pruefe('Nachrichten ohne Datum werden übergangen', () => {
  assert.equal(auswerten([mail({ date: null })], []).length, 0);
});

pruefe('Groß- und Kleinschreibung der eigenen Adresse ist egal', () => {
  const treffer = auswerten([mail({ to: [{ address: 'Hendrik@Example.DE' }] })], []);
  assert.equal(treffer.length, 1);
});

console.log('\nReihenfolge:');

pruefe('das am längsten Liegengebliebene steht oben', () => {
  // Verschiedene Absender, sonst griffe der Rundfunk-Filter statt der Sortierung.
  const treffer = auswerten(
    [
      mail({ uid: 1, messageId: '<a@x>', from: [{ address: 'eins@firma.de' }], date: vorTagen(5) }),
      mail({ uid: 2, messageId: '<b@x>', from: [{ address: 'zwei@firma.de' }], date: vorTagen(30) }),
      mail({ uid: 3, messageId: '<c@x>', from: [{ address: 'drei@firma.de' }], date: vorTagen(12) }),
    ],
    [],
  );
  assert.deepEqual(
    treffer.map((v) => v.uid),
    [2, 3, 1],
  );
});

pruefe('ein leeres Postfach ergibt eine leere Liste', () => {
  assert.deepEqual(auswerten([], []), []);
});

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
