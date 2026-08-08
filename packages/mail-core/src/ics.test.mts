import assert from 'node:assert/strict';
import {
  baueAntwort,
  beschreibeWiederholung,
  leseDauer,
  leseEinladung,
  normalisiereZeitzone,
  ortszeitAlsZeitpunkt,
} from './ics.js';

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

const datei = (...zeilen: string[]) => zeilen.join('\r\n') + '\r\n';

console.log('\nZeitzonen - hier steht die Besprechung sonst eine Stunde daneben:');

pruefe('Sommerzeit in Berlin: 14:00 Ortszeit sind 12:00 UTC', () => {
  const z = ortszeitAlsZeitpunkt(2026, 8, 15, 14, 0, 0, 'Europe/Berlin');
  assert.equal(z.toISOString(), '2026-08-15T12:00:00.000Z');
});

pruefe('Winterzeit in Berlin: 14:00 Ortszeit sind 13:00 UTC', () => {
  const z = ortszeitAlsZeitpunkt(2026, 1, 15, 14, 0, 0, 'Europe/Berlin');
  assert.equal(z.toISOString(), '2026-01-15T13:00:00.000Z');
});

pruefe('am Tag der Umstellung stimmt es auf beiden Seiten', () => {
  // Am 25.10.2026 wird in Europa zurueckgestellt: 03:00 -> 02:00.
  const davor = ortszeitAlsZeitpunkt(2026, 10, 25, 1, 30, 0, 'Europe/Berlin');
  assert.equal(davor.toISOString(), '2026-10-24T23:30:00.000Z');
  const danach = ortszeitAlsZeitpunkt(2026, 10, 25, 5, 0, 0, 'Europe/Berlin');
  assert.equal(danach.toISOString(), '2026-10-25T04:00:00.000Z');
});

pruefe('eine andere Zone rechnet ebenfalls richtig', () => {
  const z = ortszeitAlsZeitpunkt(2026, 8, 15, 9, 0, 0, 'America/New_York');
  assert.equal(z.toISOString(), '2026-08-15T13:00:00.000Z');
});

pruefe('Outlooks eigene Zeitzonennamen werden uebersetzt', () => {
  // Outlook schreibt nicht "Europe/Berlin", sondern das hier - und ohne die Tabelle
  // landete jede Outlook-Einladung im Rueckfall.
  assert.equal(normalisiereZeitzone('W. Europe Standard Time'), 'Europe/Berlin');
  assert.equal(normalisiereZeitzone('Pacific Standard Time'), 'America/Los_Angeles');
});

pruefe('gewoehnliche Namen gehen unveraendert durch', () => {
  assert.equal(normalisiereZeitzone('Europe/Berlin'), 'Europe/Berlin');
  assert.equal(normalisiereZeitzone('"Europe/Vienna"'), 'Europe/Vienna');
});

pruefe('der Vorsatz von Thunderbird wird abgeschnitten', () => {
  assert.equal(
    normalisiereZeitzone('/mozilla.org/20050126_1/Europe/Berlin'),
    'Europe/Berlin',
  );
});

pruefe('eine unbekannte Zone ergibt null statt eines Fehlers', () => {
  assert.equal(normalisiereZeitzone('Zeitzone Wolkenkuckucksheim'), null);
  assert.equal(normalisiereZeitzone(''), null);
});

console.log('\nEine Einladung lesen:');

const EINLADUNG = datei(
  'BEGIN:VCALENDAR',
  'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16011028T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E00800000000',
  'SEQUENCE:2',
  'SUMMARY:Quartalsbesprechung Vertrieb',
  'DTSTART;TZID=W. Europe Standard Time:20260815T140000',
  'DTEND;TZID=W. Europe Standard Time:20260815T153000',
  'LOCATION:Besprechungsraum 3\\, 2. Stock',
  'DESCRIPTION:Bitte die Zahlen mitbringen.\\nDauer: 90 Minuten',
  'ORGANIZER;CN=Bernd Schmidt:mailto:bernd@firma.de',
  'ATTENDEE;CN=Anna Müller;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:anna@firma.de',
  'ATTENDEE;CN=Carl Weiß;PARTSTAT=NEEDS-ACTION;ROLE=OPT-PARTICIPANT:mailto:carl@firma.de',
  'BEGIN:VALARM',
  'TRIGGER:-PT15M',
  'ACTION:DISPLAY',
  'DESCRIPTION:Erinnerung',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
);

pruefe('eine echte Outlook-Einladung wird vollstaendig gelesen', () => {
  const { methode, termine } = leseEinladung(EINLADUNG);
  assert.equal(methode, 'REQUEST');
  assert.equal(termine.length, 1);

  const t = termine[0]!;
  assert.equal(t.titel, 'Quartalsbesprechung Vertrieb');
  assert.equal(t.sequenz, 2);
  assert.equal(t.ort, 'Besprechungsraum 3, 2. Stock');
  assert.equal(t.beschreibung, 'Bitte die Zahlen mitbringen.\nDauer: 90 Minuten');
  assert.equal(t.organisator?.name, 'Bernd Schmidt');
  assert.equal(t.organisator?.adresse, 'bernd@firma.de');
});

pruefe('die Uhrzeit stimmt trotz Outlooks Zeitzonennamen', () => {
  const t = leseEinladung(EINLADUNG).termine[0]!;
  assert.equal(t.beginn?.toISOString(), '2026-08-15T12:00:00.000Z');
  assert.equal(t.ende?.toISOString(), '2026-08-15T13:30:00.000Z');
});

pruefe('die Erinnerung im VALARM wird nicht mit dem Termin verwechselt', () => {
  // Sie traegt selbst eine DESCRIPTION - ohne die Klammerung stuende "Erinnerung" da.
  const t = leseEinladung(EINLADUNG).termine[0]!;
  assert.ok(t.beschreibung?.startsWith('Bitte die Zahlen'), `war: ${t.beschreibung}`);
});

pruefe('Teilnehmer mit ihrem Stand und ihrer Rolle', () => {
  const t = leseEinladung(EINLADUNG).termine[0]!;
  assert.equal(t.teilnehmer.length, 2);
  assert.deepEqual(t.teilnehmer[0], {
    adresse: 'anna@firma.de',
    name: 'Anna Müller',
    teilnahme: 'zugesagt',
    optional: false,
  });
  assert.equal(t.teilnehmer[1]?.teilnahme, 'offen');
  assert.equal(t.teilnehmer[1]?.optional, true);
});

pruefe('eine Zeit mit "Z" steht bereits in UTC', () => {
  const t = leseEinladung(
    datei('BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'DTSTART:20260815T140000Z', 'END:VEVENT', 'END:VCALENDAR'),
  ).termine[0]!;
  assert.equal(t.beginn?.toISOString(), '2026-08-15T14:00:00.000Z');
});

pruefe('DURATION statt DTEND wird gerechnet', () => {
  const t = leseEinladung(
    datei(
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'DTSTART:20260815T140000Z',
      'DURATION:PT1H30M',
      'END:VEVENT',
      'END:VCALENDAR',
    ),
  ).termine[0]!;
  assert.equal(t.ende?.toISOString(), '2026-08-15T15:30:00.000Z');
});

pruefe('DTEND gewinnt gegen DURATION, wenn beides dasteht', () => {
  const t = leseEinladung(
    datei(
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'DTSTART:20260815T140000Z',
      'DTEND:20260815T160000Z',
      'DURATION:PT9H',
      'END:VEVENT',
      'END:VCALENDAR',
    ),
  ).termine[0]!;
  assert.equal(t.ende?.toISOString(), '2026-08-15T16:00:00.000Z');
});

pruefe('ein ganztaegiger Termin wird als solcher erkannt', () => {
  const t = leseEinladung(
    datei(
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'SUMMARY:Betriebsausflug',
      'DTSTART;VALUE=DATE:20260815',
      'DTEND;VALUE=DATE:20260816',
      'END:VEVENT',
      'END:VCALENDAR',
    ),
  ).termine[0]!;
  assert.equal(t.ganztaegig, true);
  assert.equal(t.beginn?.toISOString(), '2026-08-15T00:00:00.000Z');
});

pruefe('eine Absage wird als solche erkannt', () => {
  const { methode } = leseEinladung(
    datei('BEGIN:VCALENDAR', 'METHOD:CANCEL', 'BEGIN:VEVENT', 'UID:x', 'END:VEVENT', 'END:VCALENDAR'),
  );
  assert.equal(methode, 'CANCEL');
});

pruefe('umbrochene Zeilen werden zusammengesetzt', () => {
  const t = leseEinladung(
    datei(
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'SUMMARY:Ein sehr langer Titel der ueber die Zeilengrenze',
      '  hinausgeht und hier weitergeht',
      'END:VEVENT',
      'END:VCALENDAR',
    ),
  ).termine[0]!;
  assert.equal(t.titel, 'Ein sehr langer Titel der ueber die Zeilengrenze hinausgeht und hier weitergeht');
});

pruefe('mehrere Termine in einer Datei', () => {
  const roh = datei(
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:eins',
    'SUMMARY:Eins',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:zwei',
    'SUMMARY:Zwei',
    'END:VEVENT',
    'END:VCALENDAR',
  );
  assert.deepEqual(
    leseEinladung(roh).termine.map((t) => t.titel),
    ['Eins', 'Zwei'],
  );
});

pruefe('Unsinn ergibt nichts, statt zu scheitern', () => {
  assert.deepEqual(leseEinladung('').termine, []);
  assert.deepEqual(leseEinladung('das ist kein Kalender').termine, []);
  assert.deepEqual(leseEinladung('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n').termine, []);
});

console.log('\nDauern:');

pruefe('die ueblichen Formen', () => {
  assert.equal(leseDauer('PT1H'), 3600_000);
  assert.equal(leseDauer('PT30M'), 1800_000);
  assert.equal(leseDauer('PT1H30M'), 5400_000);
  assert.equal(leseDauer('P1D'), 86400_000);
  assert.equal(leseDauer('P2DT3H'), (2 * 24 + 3) * 3600_000);
  assert.equal(leseDauer('P1W'), 7 * 86400_000);
});

pruefe('was keine Dauer ist, ergibt null', () => {
  assert.equal(leseDauer('eine Stunde'), null);
  assert.equal(leseDauer(''), null);
});

console.log('\nAntworten (iMIP):');

const TERMIN = leseEinladung(EINLADUNG).termine[0]!;

pruefe('die Antwort traegt METHOD:REPLY und dieselbe Kennung', () => {
  const antwort = baueAntwort(TERMIN, { adresse: 'carl@firma.de', name: 'Carl Weiß' }, 'zusagen');
  assert.ok(antwort.includes('METHOD:REPLY'));
  assert.ok(antwort.includes(`UID:${TERMIN.uid}`));
  assert.ok(antwort.includes('SEQUENCE:2'), 'die Fassung muss uebereinstimmen');
});

pruefe('genau ein Teilnehmer - der Antwortende', () => {
  // Fuer andere antwortet niemand mit.
  const antwort = baueAntwort(TERMIN, { adresse: 'carl@firma.de', name: 'Carl Weiß' }, 'zusagen');
  const teilnehmer = antwort.split('\r\n').filter((z) => z.startsWith('ATTENDEE'));
  assert.equal(teilnehmer.length, 1);
  assert.ok(teilnehmer[0]!.includes('mailto:carl@firma.de'));
  assert.ok(teilnehmer[0]!.includes('PARTSTAT=ACCEPTED'));
});

pruefe('Absage und Vorbehalt tragen den richtigen Stand', () => {
  const nein = baueAntwort(TERMIN, { adresse: 'c@f.de' }, 'absagen');
  assert.ok(nein.includes('PARTSTAT=DECLINED'));
  const vielleicht = baueAntwort(TERMIN, { adresse: 'c@f.de' }, 'vorbehalten');
  assert.ok(vielleicht.includes('PARTSTAT=TENTATIVE'));
});

pruefe('DTSTART ist dabei - ohne das weist Outlook die Antwort ab', () => {
  const antwort = baueAntwort(TERMIN, { adresse: 'c@f.de' }, 'zusagen');
  assert.ok(antwort.includes('DTSTART:20260815T120000Z'), antwort);
});

pruefe('der Organisator steht drin, damit die Antwort zugeordnet wird', () => {
  const antwort = baueAntwort(TERMIN, { adresse: 'c@f.de' }, 'zusagen');
  assert.ok(antwort.includes('ORGANIZER;CN=Bernd Schmidt:mailto:bernd@firma.de'));
});

pruefe('Zeilenenden sind CRLF, wie das Format es verlangt', () => {
  const antwort = baueAntwort(TERMIN, { adresse: 'c@f.de' }, 'zusagen');
  assert.ok(antwort.endsWith('END:VCALENDAR\r\n'));
  assert.equal(antwort.split('\n').length, antwort.split('\r\n').length);
});

pruefe('die eigene Antwort laesst sich wieder einlesen', () => {
  const antwort = baueAntwort(TERMIN, { adresse: 'carl@firma.de', name: 'Carl Weiß' }, 'zusagen');
  const zurueck = leseEinladung(antwort);
  assert.equal(zurueck.methode, 'REPLY');
  assert.equal(zurueck.termine[0]?.uid, TERMIN.uid);
  assert.equal(zurueck.termine[0]?.teilnehmer[0]?.teilnahme, 'zugesagt');
  assert.equal(zurueck.termine[0]?.beginn?.toISOString(), TERMIN.beginn?.toISOString());
});

console.log('\nWiederholungen in Worte fassen:');

pruefe('die haeufigen Faelle', () => {
  assert.equal(beschreibeWiederholung('FREQ=DAILY'), 'täglich');
  assert.equal(beschreibeWiederholung('FREQ=WEEKLY;BYDAY=MO'), 'jeden Montag');
  assert.equal(beschreibeWiederholung('FREQ=WEEKLY;BYDAY=MO,WE'), 'jeden Montag, Mittwoch');
  assert.equal(beschreibeWiederholung('FREQ=MONTHLY'), 'monatlich');
  assert.equal(beschreibeWiederholung('FREQ=WEEKLY;INTERVAL=2'), 'alle 2 Wochen');
});

pruefe('Ende und Anzahl werden genannt', () => {
  assert.equal(beschreibeWiederholung('FREQ=DAILY;COUNT=5'), 'täglich, 5 mal');
  assert.equal(beschreibeWiederholung('FREQ=WEEKLY;UNTIL=20261231T000000Z'), 'wöchentlich bis 31.12.2026');
});

pruefe('was sich nicht kurz sagen laesst, wird nicht behauptet', () => {
  // Lieber ehrlich unbestimmt als etwas Falsches.
  assert.equal(beschreibeWiederholung('FREQ=SECONDLY;BYSETPOS=3'), 'wiederholt sich regelmäßig');
  assert.equal(beschreibeWiederholung('Unsinn'), 'wiederholt sich regelmäßig');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
