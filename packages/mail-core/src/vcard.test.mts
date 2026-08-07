import assert from 'node:assert/strict';
import { alsVisitenkarte, alsVisitenkartenDatei, leseVisitenkarten } from './vcard.js';

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

/** Baut eine Datei mit CRLF, so wie sie wirklich ankommt. */
const datei = (...zeilen: string[]) => zeilen.join('\r\n') + '\r\n';

console.log('\nWas andere Programme ausgeben:');

pruefe('Google Kontakte (Fassung 3.0)', () => {
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Anna Müller',
    'N:Müller;Anna;;;',
    'EMAIL;TYPE=INTERNET;TYPE=HOME:anna@beispiel.de',
    'TEL;TYPE=CELL:+49 170 1234567',
    'ORG:Beispiel GmbH;Vertrieb',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.equal(karte?.name, 'Anna Müller');
  assert.equal(karte?.nachname, 'Müller');
  assert.equal(karte?.vorname, 'Anna');
  assert.deepEqual(karte?.adressen, ['anna@beispiel.de']);
  assert.deepEqual(karte?.telefone, [{ nummer: '+49 170 1234567', art: 'Mobil' }]);
  assert.equal(karte?.organisation, 'Beispiel GmbH, Vertrieb');
});

pruefe('Apple Kontakte mit eigenen Etiketten', () => {
  // Apple haengt eigene Bezeichnungen ueber Gruppen an: "item1.TEL" und "item1.X-ABLabel".
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Schmidt;Bernd;;;',
    'FN:Bernd Schmidt',
    'item1.TEL:+49 30 998877',
    'item1.X-ABLabel:_$!<Ferienhaus>!$_',
    'EMAIL;type=INTERNET;type=WORK;type=pref:bernd@firma.de',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.deepEqual(karte?.telefone, [{ nummer: '+49 30 998877', art: 'Ferienhaus' }]);
  assert.deepEqual(karte?.adressen, ['bernd@firma.de']);
});

pruefe('Outlook in der alten Fassung 2.1 mit quoted-printable', () => {
  // Hier steht die Art ohne Schluessel da ("TEL;WORK;VOICE"), und Umlaute stecken in
  // "=C3=BC". Ohne beides kaeme hier Buchstabensalat heraus.
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:2.1',
    'N;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Sch=C3=B6nberg;J=C3=BCrgen;;;',
    'FN;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:J=C3=BCrgen Sch=C3=B6nberg',
    'TEL;WORK;VOICE:089 123456',
    'EMAIL;PREF;INTERNET:juergen@alt.de',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.equal(karte?.name, 'Jürgen Schönberg');
  assert.equal(karte?.nachname, 'Schönberg');
  assert.equal(karte?.vorname, 'Jürgen');
  assert.deepEqual(karte?.telefone, [{ nummer: '089 123456', art: 'Arbeit' }]);
});

pruefe('quoted-printable ueber mehrere Zeilen ohne Einrueckung', () => {
  // In der Fassung 2.1 endet eine fortgesetzte Zeile auf "=" und die naechste beginnt
  // ganz links. Wer nur auf eingerueckte Fortsetzungen achtet, verliert hier den Rest.
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:2.1',
    'NOTE;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Erste Zeile=0D=0A=',
    'Zweite Zeile mit Umlaut =C3=A4=',
    ' und Schluss',
    'FN:Test',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.ok(karte?.notiz?.includes('Zweite Zeile mit Umlaut ä'), `war: ${karte?.notiz}`);
  assert.ok(karte?.notiz?.includes('und Schluss'), 'der letzte Teil fehlt');
});

pruefe('Fassung 4.0 mit tel:-Adresse und Anfuehrungszeichen im Parameter', () => {
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:4.0',
    'FN:Clara Weiss',
    'EMAIL;TYPE="work,internet":clara@vier.de',
    'TEL;VALUE=uri;TYPE="voice,home":tel:+493012345',
    'BDAY:19850403',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.deepEqual(karte?.adressen, ['clara@vier.de']);
  assert.deepEqual(karte?.telefone, [{ nummer: '+493012345', art: 'Privat' }]);
  assert.equal(karte?.geburtstag, '1985-04-03');
});

pruefe('mehrere Karten in einer Datei', () => {
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Eins',
    'EMAIL:eins@b.de',
    'END:VCARD',
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Zwei',
    'EMAIL:zwei@b.de',
    'END:VCARD',
  );
  assert.equal(leseVisitenkarten(roh).length, 2);
});

console.log('\nDie Tuecken beim Lesen:');

pruefe('eine umbrochene Zeile wird wieder zusammengesetzt', () => {
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Eine Person mit einem sehr langen Namen der ueber die Zeilengrenze hinausgeht',
    'NOTE:Ein langer Text der umbrochen wurde und hier',
    '  weitergeht',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.equal(karte?.notiz, 'Ein langer Text der umbrochen wurde und hier weitergeht');
});

pruefe('maskierte Zeichen werden zurueckgewandelt', () => {
  const roh = datei(
    'BEGIN:VCARD',
    'FN:Meier\\, Hans',
    'NOTE:Erste Zeile\\nZweite Zeile\\; mit Semikolon',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.equal(karte?.name, 'Meier, Hans');
  assert.equal(karte?.notiz, 'Erste Zeile\nZweite Zeile; mit Semikolon');
});

pruefe('ein maskiertes Semikolon zerteilt den Namen nicht', () => {
  const roh = datei('BEGIN:VCARD', 'N:von Sachsen\\;Coburg;Ernst;;;', 'END:VCARD');
  const [karte] = leseVisitenkarten(roh);
  assert.equal(karte?.nachname, 'von Sachsen;Coburg');
  assert.equal(karte?.vorname, 'Ernst');
});

pruefe('fehlt der Anzeigename, wird er gebildet', () => {
  const [ausName] = leseVisitenkarten(datei('BEGIN:VCARD', 'N:Klein;Petra;;;', 'END:VCARD'));
  assert.equal(ausName?.name, 'Petra Klein');

  const [ausAdresse] = leseVisitenkarten(datei('BEGIN:VCARD', 'EMAIL:nur@adresse.de', 'END:VCARD'));
  assert.equal(ausAdresse?.name, 'nur@adresse.de');
});

pruefe('unbekannte Felder halten die Einfuhr nicht auf', () => {
  // Eine fremde Datei enthaelt fast immer irgendetwas Unbekanntes - ein Bild, eine
  // Zeitzone, ein anbietereigenes Feld. Daran darf sie nicht scheitern.
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:3.0',
    'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQEAYABgAAD',
    'X-GOOGLE-IRGENDWAS:egal',
    'TZ:+01:00',
    'FN:Trotzdem Da',
    'EMAIL:da@b.de',
    'END:VCARD',
  );
  const [karte] = leseVisitenkarten(roh);
  assert.equal(karte?.name, 'Trotzdem Da');
  assert.deepEqual(karte?.adressen, ['da@b.de']);
});

pruefe('eine bevorzugte Adresse steht vorn', () => {
  const roh = datei(
    'BEGIN:VCARD',
    'EMAIL;TYPE=INTERNET:zweit@b.de',
    'EMAIL;TYPE=INTERNET,PREF:haupt@b.de',
    'FN:Wer',
    'END:VCARD',
  );
  assert.deepEqual(leseVisitenkarten(roh)[0]?.adressen, ['haupt@b.de', 'zweit@b.de']);
});

pruefe('dieselbe Adresse zweimal wird einmal genommen', () => {
  const roh = datei('BEGIN:VCARD', 'EMAIL:A@B.de', 'EMAIL:a@b.de', 'FN:Wer', 'END:VCARD');
  assert.equal(leseVisitenkarten(roh)[0]?.adressen.length, 1);
});

pruefe('eine Datei ohne END:VCARD wird trotzdem gelesen', () => {
  const roh = datei('BEGIN:VCARD', 'VERSION:3.0', 'FN:Abgeschnitten', 'EMAIL:ab@b.de');
  assert.equal(leseVisitenkarten(roh).length, 1);
});

pruefe('eine Zeichenmarkierung am Dateianfang stoert nicht', () => {
  // Windows-Programme setzen gern ein unsichtbares Zeichen vor die Datei.
  const roh = '﻿' + datei('BEGIN:VCARD', 'FN:Mit Vorzeichen', 'EMAIL:v@b.de', 'END:VCARD');
  assert.equal(leseVisitenkarten(roh)[0]?.name, 'Mit Vorzeichen');
});

pruefe('leere und wirre Eingaben ergeben nichts, statt zu scheitern', () => {
  assert.deepEqual(leseVisitenkarten(''), []);
  assert.deepEqual(leseVisitenkarten('das ist gar keine Visitenkarte'), []);
  assert.deepEqual(leseVisitenkarten('BEGIN:VCARD\r\nEND:VCARD\r\n'), []);
});

console.log('\nWas wir ausgeben:');

pruefe('was hinausgeht, kommt unveraendert wieder herein', () => {
  const karte = {
    name: 'Anna Müller',
    vorname: 'Anna',
    nachname: 'Müller',
    adressen: ['anna@beispiel.de', 'a.mueller@firma.de'],
    organisation: 'Beispiel GmbH',
    telefone: [
      { nummer: '+49 170 1234567', art: 'Mobil' },
      { nummer: '030 998877', art: 'Arbeit' },
    ],
    anschrift: 'Hauptstraße 1\n10115 Berlin',
    geburtstag: '1985-04-03',
    notiz: 'Kennt sich mit Verträgen aus; ruft gern an, statt zu schreiben.',
  };
  const [zurueck] = leseVisitenkarten(alsVisitenkarte(karte));

  assert.equal(zurueck?.name, karte.name);
  assert.equal(zurueck?.vorname, karte.vorname);
  assert.equal(zurueck?.nachname, karte.nachname);
  assert.deepEqual(zurueck?.adressen, karte.adressen);
  assert.equal(zurueck?.organisation, karte.organisation);
  assert.deepEqual(zurueck?.telefone, karte.telefone);
  assert.equal(zurueck?.geburtstag, karte.geburtstag);
  assert.equal(zurueck?.notiz, karte.notiz);
  // Mit Zeilenumbruch: er darf unterwegs nicht zu einem Komma werden.
  assert.equal(zurueck?.anschrift, karte.anschrift);
});

pruefe('eine Anschrift aus einer fremden Datei wird lesbar zusammengesetzt', () => {
  // Andere Programme fuellen die sieben Felder von ADR wirklich aus - dann soll daraus
  // etwas werden, das man auf einen Umschlag schreiben koennte.
  const roh = datei(
    'BEGIN:VCARD',
    'VERSION:3.0',
    'FN:Wer',
    'ADR;TYPE=WORK:;Etage 3;Hauptstraße 1;Berlin;;10115;Deutschland',
    'END:VCARD',
  );
  assert.equal(leseVisitenkarten(roh)[0]?.anschrift, 'Hauptstraße 1 Etage 3\n10115 Berlin\nDeutschland');
});

pruefe('lange Zeilen werden umbrochen, aber nicht mitten im Umlaut', () => {
  const lang = 'Über die Maßen lange Notiz mit Umlauten '.repeat(6).trim();
  const ausgabe = alsVisitenkarte({ name: 'Lang', adressen: [], telefone: [], notiz: lang });

  for (const zeile of ausgabe.split('\r\n')) {
    assert.ok(Buffer.byteLength(zeile, 'utf8') <= 75, `zu lang: ${zeile.length} Zeichen`);
  }
  // Kein Ersatzzeichen: dann waere mitten in einem Umlaut getrennt worden.
  assert.ok(!ausgabe.includes('�'), 'ein Umlaut wurde zerschnitten');
  assert.equal(leseVisitenkarten(ausgabe)[0]?.notiz, lang);
});

pruefe('Zeilenenden sind CRLF, wie das Format es verlangt', () => {
  const ausgabe = alsVisitenkarte({ name: 'Wer', adressen: ['w@b.de'], telefone: [] });
  assert.ok(ausgabe.endsWith('END:VCARD\r\n'));
  assert.equal(ausgabe.split('\n').length - 1, ausgabe.split('\r\n').length - 1);
});

pruefe('Sonderzeichen werden maskiert, damit sie nicht trennen', () => {
  const ausgabe = alsVisitenkarte({
    name: 'Firma, GmbH & Co. KG',
    adressen: [],
    telefone: [],
    notiz: 'Zeile eins\nZeile zwei; danach',
  });
  assert.ok(ausgabe.includes('FN:Firma\\, GmbH & Co. KG'));
  assert.ok(ausgabe.includes('Zeile eins\\nZeile zwei\\; danach'));
});

pruefe('eine Karte ohne alles ergibt trotzdem eine gueltige Ausgabe', () => {
  const ausgabe = alsVisitenkarte({ adressen: [], telefone: [] });
  assert.ok(ausgabe.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n'));
  assert.ok(ausgabe.includes('FN:Unbenannt'));
});

pruefe('viele Karten ergeben eine Datei, die wieder alle enthaelt', () => {
  const karten = [
    { name: 'Eins', adressen: ['eins@b.de'], telefone: [] },
    { name: 'Zwei', adressen: ['zwei@b.de'], telefone: [] },
    { name: 'Drei', adressen: ['drei@b.de'], telefone: [] },
  ];
  const zurueck = leseVisitenkarten(alsVisitenkartenDatei(karten));
  assert.deepEqual(
    zurueck.map((k) => k.name),
    ['Eins', 'Zwei', 'Drei'],
  );
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
