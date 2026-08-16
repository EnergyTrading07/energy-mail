import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { setDataDir } from '../paths.js';
import { alsNutzer } from '../nutzer/kontext.js';
import { aufbewahrenBis, fristAbgelaufen, laengere } from './fristen.js';
import { ANFANG, pruefeKette, siegelVon, verkette, type Eintrag } from './kette.js';
import {
  alleEintraege,
  archiviere,
  original,
  pruefeBestand,
  raeumeAuf,
  setzeArchivEinstellungen,
  siegel,
  suche,
  trageUm,
  vergissStand,
  vermerke,
  wirdArchiviert,
  archivPostOrdner,
} from './archiv.js';
import { erzeugeAusfuhr } from './ausfuhr.js';
import { verfahrensdokumentation } from './verfahrensdokumentation.js';

/**
 * Das GoBD-Archiv.
 *
 * ## Was hier ueberhaupt zu pruefen ist
 *
 * Drei Dinge, und sie sind sehr unterschiedlicher Natur.
 *
 *  1. **Eine Rechnung, bei der sich fast jeder vertut.** Die Aufbewahrungsfrist laeuft ab
 *     dem Schluss des Kalenderjahres, nicht ab dem Datum (§ 147 Abs. 4 AO). Das sind zehn
 *     Zeilen Code, und sie entscheiden darueber, ob eine Betriebspruefung etwas vorfindet.
 *     Geprueft wird gegen von Hand gerechnete Daten - der einzige ehrliche Anker, den es
 *     dafuer gibt.
 *  2. **Eine Kette, die brechen SOLL, wenn jemand etwas aendert.** Der groesste Teil
 *     dieser Datei besteht darin, das Archiv absichtlich zu verfaelschen und
 *     nachzusehen, ob es auffaellt. Eine Pruefung, die nie anschlaegt, sagt nichts.
 *  3. **Eine Ausfuhr, die ein fremdes Programm lesen muss.** Die index.xml wird deshalb
 *     mit einem richtigen XML-Leser zerlegt und Spalte fuer Spalte gegen die CSV
 *     gehalten - nicht mit einem regulaeren Ausdruck. Und die CSV wird mit einem eigenen,
 *     unabhaengig geschriebenen Leser zerlegt, damit ein Fehler im Schreiben nicht durch
 *     denselben Fehler im Lesen verdeckt wird.
 */

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ok   ${name}`);
      ok++;
    })
    .catch((err: Error) => {
      console.log(`  FEHL ${name}\n       ${err.message}`);
    });
}

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-archiv-'));
setDataDir(ORDNER);

/** Alles laeuft als derselbe Nutzer - das Archiv haengt am Nutzerordner. */
const alsAnna = <T,>(fn: () => T): T => alsNutzer('anna', fn);

console.log('\nDie Fristen');

/*
 * Die Zahlen stehen in § 147 Abs. 3 und 4 AO. Sie sind hier von Hand gerechnet und
 * ausgeschrieben - eine Pruefung, die die Frist noch einmal mit derselben Formel
 * ausrechnet, prueft gar nichts.
 */
await pruefe('die Frist laeuft ab dem Schluss des Kalenderjahres, nicht ab dem Datum', () => {
  const anfangDesJahres = new Date('2025-02-03T09:00:00Z');
  const endeDesJahres = new Date('2025-12-28T23:00:00Z');
  // Beide Rechnungen laufen am selben Tag ab - das ist der ganze Punkt.
  assert.equal(aufbewahrenBis(anfangDesJahres, 'buchungsbeleg').slice(0, 10), '2033-12-31');
  assert.equal(aufbewahrenBis(endeDesJahres, 'buchungsbeleg').slice(0, 10), '2033-12-31');
});

await pruefe('sechs Jahre fuer Geschaeftsbriefe, acht fuer Buchungsbelege', () => {
  const wann = new Date('2025-06-15T12:00:00Z');
  assert.equal(aufbewahrenBis(wann, 'geschaeftsbrief').slice(0, 10), '2031-12-31');
  assert.equal(aufbewahrenBis(wann, 'buchungsbeleg').slice(0, 10), '2033-12-31');
});

await pruefe('an Silvester springt die Frist um ein Jahr', () => {
  const silvester = new Date('2025-12-31T23:59:59Z');
  const neujahr = new Date('2026-01-01T00:00:00Z');
  assert.equal(aufbewahrenBis(silvester, 'geschaeftsbrief').slice(0, 4), '2031');
  assert.equal(aufbewahrenBis(neujahr, 'geschaeftsbrief').slice(0, 4), '2032');
});

await pruefe('die Frist endet am letzten Tag, nicht am ersten des Folgejahres', () => {
  const bis = aufbewahrenBis(new Date('2025-06-15T12:00:00Z'), 'geschaeftsbrief');
  assert.equal(fristAbgelaufen(bis, new Date('2031-12-31T23:00:00Z')), false);
  assert.equal(fristAbgelaufen(bis, new Date('2032-01-01T00:00:01Z')), true);
});

await pruefe('eine Frist laesst sich verlaengern, aber nicht verkuerzen', () => {
  const kurz = aufbewahrenBis(new Date('2025-06-15T12:00:00Z'), 'geschaeftsbrief');
  const lang = aufbewahrenBis(new Date('2025-06-15T12:00:00Z'), 'buchungsbeleg');
  assert.equal(laengere(kurz, lang), lang);
  assert.equal(laengere(lang, kurz), lang);
});

console.log('\nDie Kette');

/** Ein Eintrag mit brauchbaren Feldern - fuer die reinen Kettenpruefungen. */
const bau = (nr: number, betreff: string): Omit<Eintrag, 'nr' | 'vorher' | 'siegel'> => ({
  erfasstAm: `2026-01-0${nr}T10:00:00.000Z`,
  datei: `2026/${betreff}.eml`,
  abdruck: 'a'.repeat(64),
  groesse: 100 + nr,
  richtung: 'empfangen',
  kontoId: 'k1',
  absender: 'wer@beispiel.de',
  empfaenger: ['ich@beispiel.de'],
  betreff,
  entstandenAm: '2026-01-01T09:00:00.000Z',
  art: 'geschaeftsbrief',
  aufbewahrenBis: '2032-12-31T23:59:59.999Z',
});

function baueKette(anzahl: number): Eintrag[] {
  const kette: Eintrag[] = [];
  for (let i = 1; i <= anzahl; i++) {
    kette.push(verkette(bau(i, `Nachricht ${i}`), kette.at(-1) ?? null));
  }
  return kette;
}

await pruefe('eine unversehrte Kette geht auf', () => {
  const kette = baueKette(5);
  const befund = pruefeKette(kette);
  assert.equal(befund.heil, true);
  assert.equal(befund.heil && befund.anzahl, 5);
  assert.equal(kette[0]!.vorher, ANFANG);
});

await pruefe('ein geaenderter Eintrag faellt auf', () => {
  const kette = baueKette(5);
  kette[2] = { ...kette[2]!, betreff: 'etwas anderes' };
  const befund = pruefeKette(kette);
  assert.equal(befund.heil, false);
  assert.equal(!befund.heil && befund.beiNr, 3);
  assert.match(!befund.heil ? befund.grund : '', /nachträglich geändert/);
});

/*
 * Der geschicktere Angriff: Der Eintrag wird geaendert UND neu gesiegelt. Er selbst geht
 * dann auf - aber der naechste verweist noch auf das alte Siegel. Genau dafuer ist die
 * Verkettung da.
 */
await pruefe('ein geaenderter und neu gesiegelter Eintrag bricht die Verkettung', () => {
  const kette = baueKette(5);
  const { siegel: _weg, ...ohne } = kette[2]!;
  const gefaelscht = { ...ohne, betreff: 'etwas anderes' };
  kette[2] = { ...gefaelscht, siegel: siegelVon(gefaelscht) };

  const befund = pruefeKette(kette);
  assert.equal(befund.heil, false);
  // Nicht bei 3 - der geht ja auf -, sondern beim naechsten.
  assert.equal(!befund.heil && befund.beiNr, 4);
  assert.match(!befund.heil ? befund.grund : '', /Vorgänger/);
});

await pruefe('ein herausgenommener Eintrag faellt an der Nummer auf', () => {
  const kette = baueKette(5);
  kette.splice(2, 1);
  const befund = pruefeKette(kette);
  assert.equal(befund.heil, false);
  assert.match(!befund.heil ? befund.grund : '', /fehlt einer/);
});

/*
 * Die Feldtrennung. Ohne ein Trennzeichen, das in keinem Feld vorkommen kann, liessen
 * sich zwei verschiedene Eintraege auf denselben Abdruck bringen, indem man Text von
 * einem Feld ins naechste schiebt. Hier wird genau das versucht.
 */
await pruefe('Text von einem Feld ins naechste zu schieben aendert den Abdruck', () => {
  const grund = bau(1, '');
  const a = { ...grund, nr: 1, vorher: ANFANG, betreff: 'Rechnung', messageId: '<x@y>' };
  const b = { ...grund, nr: 1, vorher: ANFANG, betreff: 'Rechnung<x@y>', messageId: '' };
  assert.notEqual(siegelVon(a), siegelVon(b));
});

await pruefe('das Siegel uebersteht den Weg durch JSON', () => {
  const kette = baueKette(3);
  const zurueck = JSON.parse(JSON.stringify(kette)) as Eintrag[];
  assert.equal(pruefeKette(zurueck).heil, true);
  assert.equal(zurueck.at(-1)!.siegel, kette.at(-1)!.siegel);
});

console.log('\nDas Archiv');

const NACHRICHT = (betreff: string, text = 'Guten Tag.') =>
  Buffer.from(
    [
      'From: Firma Meier <meier@beispiel.de>',
      'To: buchhaltung@wir.example',
      `Subject: ${betreff}`,
      'Message-ID: <' + betreff.replace(/\W/g, '') + '@beispiel.de>',
      'Date: Mon, 15 Jun 2026 10:00:00 +0000',
      '',
      text,
      '',
    ].join('\r\n'),
    'utf8',
  );

const lege = (betreff: string, wann = '2026-06-15T10:00:00Z', art?: 'buchungsbeleg') =>
  alsAnna(() =>
    archiviere(NACHRICHT(betreff), {
      richtung: 'empfangen',
      kontoId: 'k1',
      ordner: 'INBOX',
      absender: 'meier@beispiel.de',
      empfaenger: ['buchhaltung@wir.example'],
      betreff,
      messageId: `<${betreff.replace(/\W/g, '')}@beispiel.de>`,
      entstandenAm: new Date(wann),
      art,
    }),
  );

await pruefe('ohne Einstellung wird kein Konto aufgezeichnet', () => {
  alsAnna(() => {
    assert.equal(wirdArchiviert('k1'), false);
    setzeArchivEinstellungen({ konten: ['k1'], vorgabe: 'geschaeftsbrief', betrieb: 'Wir GmbH' });
    assert.equal(wirdArchiviert('k1'), true);
    assert.equal(wirdArchiviert('k2'), false);
  });
});

await pruefe('eine Nachricht wird im Original abgelegt', () => {
  const eintrag = lege('Angebot 4711')!;
  assert.ok(eintrag);
  const { bytes } = alsAnna(() => original(eintrag.nr));
  // Byte fuer Byte dasselbe - kein Umkodieren, kein Abschneiden.
  assert.ok(bytes.equals(NACHRICHT('Angebot 4711')));
  assert.equal(eintrag.groesse, bytes.length);
});

await pruefe('dieselbe Nachricht kommt nicht zweimal hinein', () => {
  const vorher = alsAnna(() => alleEintraege().length);
  assert.equal(lege('Angebot 4711'), null);
  assert.equal(alsAnna(() => alleEintraege().length), vorher);
});

await pruefe('die Kette waechst mit und bleibt heil', () => {
  lege('Rechnung 2026-08', '2026-08-01T08:00:00Z');
  lege('Terminabsprache', '2026-08-02T08:00:00Z');
  const befund = alsAnna(() => pruefeKette(alleEintraege()));
  assert.equal(befund.heil, true);
  assert.equal(alsAnna(() => siegel()), befund.heil ? befund.siegel : '');
});

await pruefe('ein Vermerk aendert den Eintrag nicht, sondern kommt dazu', () => {
  const nr = alsAnna(() => suche({ text: 'Terminabsprache' }).treffer[0]!.nr);
  const vorher = alsAnna(() => alleEintraege().find((e) => e.nr === nr)!);
  alsAnna(() => vermerke(nr, 'Mit Herrn Meier telefonisch bestätigt.'));

  const nachher = alsAnna(() => alleEintraege().find((e) => e.nr === nr)!);
  assert.deepEqual(nachher, vorher, 'Der urspruengliche Eintrag wurde angefasst.');
  const fund = alsAnna(() => suche({ text: 'Terminabsprache' }).treffer[0]!);
  assert.equal(fund.vermerke.length, 1);
  assert.match(fund.vermerke[0]!.text, /telefonisch/);
  assert.equal(alsAnna(() => pruefeKette(alleEintraege())).heil, true);
});

await pruefe('umtragen verlaengert die Frist - und verkuerzt sie nie', () => {
  const nr = alsAnna(() => suche({ text: 'Rechnung 2026-08' }).treffer[0]!.nr);
  const vorher = alsAnna(() => suche({ text: 'Rechnung 2026-08' }).treffer[0]!);
  assert.equal(vorher.art, 'geschaeftsbrief');
  assert.equal(vorher.aufbewahrenBis.slice(0, 4), '2032');

  alsAnna(() => trageUm(nr, 'buchungsbeleg'));
  const lang = alsAnna(() => suche({ text: 'Rechnung 2026-08' }).treffer[0]!);
  assert.equal(lang.art, 'buchungsbeleg');
  assert.equal(lang.aufbewahrenBis.slice(0, 4), '2034');

  // Und zurueck: die Art aendert sich, die Frist bleibt die laengere.
  alsAnna(() => trageUm(nr, 'ohne-pflicht'));
  const zurueck = alsAnna(() => suche({ text: 'Rechnung 2026-08' }).treffer[0]!);
  assert.equal(zurueck.art, 'ohne-pflicht');
  assert.equal(
    zurueck.aufbewahrenBis,
    lang.aufbewahrenBis,
    'Die Frist wurde durch Umtragen verkuerzt - damit liesse sich alles loswerden.',
  );
});

await pruefe('gesucht wird nach Betreff, Beteiligten und Zeitraum', () => {
  alsAnna(() => {
    assert.equal(suche({ text: 'angebot' }).treffer.length, 1, 'Gross- und Kleinschreibung');
    assert.equal(suche({ text: 'meier@beispiel.de' }).treffer.length, 3, 'Absender');
    assert.equal(suche({ von: '2026-07-01' }).treffer.length, 2, 'ab Juli');
    assert.equal(suche({ richtung: 'gesendet' }).treffer.length, 0);
    // Vermerke und Umtragungen sind keine eigenen Nachrichten.
    assert.equal(suche({}).gesamt, 3);
  });
});

await pruefe('ein veraendertes Original wird nicht ausgegeben', () => {
  const nr = alsAnna(() => suche({ text: 'Angebot' }).treffer[0]!.nr);
  const eintrag = alsAnna(() => alleEintraege().find((e) => e.nr === nr)!);
  const datei = path.join(alsAnna(() => archivPostOrdner()), eintrag.datei);

  fs.chmodSync(datei, 0o600);
  fs.writeFileSync(datei, NACHRICHT('Angebot 4711', 'Guten Tag. Nachträglich geändert.'));
  try {
    assert.throws(
      () => alsAnna(() => original(nr)),
      /verändert/,
      'Ein veraendertes Original wurde als echt ausgegeben.',
    );
    const befund = alsAnna(() => pruefeBestand());
    assert.deepEqual(befund.verfaelscht, [nr]);
    // Die Kette selbst ist davon unberuehrt - geaendert wurde die Datei, nicht der Eintrag.
    assert.equal(befund.kette.heil, true);
  } finally {
    fs.writeFileSync(datei, NACHRICHT('Angebot 4711'));
    fs.chmodSync(datei, 0o400);
  }
});

await pruefe('eine fehlende Datei wird gemeldet', () => {
  const nr = alsAnna(() => suche({ text: 'Terminabsprache' }).treffer[0]!.nr);
  const eintrag = alsAnna(() => alleEintraege().find((e) => e.nr === nr)!);
  const datei = path.join(alsAnna(() => archivPostOrdner()), eintrag.datei);
  const sicherung = fs.readFileSync(datei);
  fs.chmodSync(datei, 0o600);
  fs.rmSync(datei);
  try {
    assert.deepEqual(alsAnna(() => pruefeBestand()).fehlend, [nr]);
  } finally {
    fs.writeFileSync(datei, sicherung);
    fs.chmodSync(datei, 0o400);
  }
});

console.log('\nAufraeumen');

await pruefe('nichts verschwindet, solange die Frist laeuft', () => {
  const probe = alsAnna(() => raeumeAuf(new Date('2030-01-01T00:00:00Z'), true));
  assert.equal(probe.anzahl, 0);
  assert.equal(alsAnna(() => suche({}).gesamt), 3);
});

await pruefe('ohne ausdrueckliche Ansage wird nur gezaehlt', () => {
  const spaeter = new Date('2040-01-01T00:00:00Z');
  const gezaehlt = alsAnna(() => raeumeAuf(spaeter, false));
  assert.equal(gezaehlt.anzahl, 3);
  // Und wirklich nichts angefasst.
  assert.equal(alsAnna(() => pruefeBestand()).fehlend.length, 0);
});

await pruefe('nach dem Aufraeumen bleibt die Kette vollstaendig', () => {
  const vorher = alsAnna(() => alleEintraege().length);
  const weg = alsAnna(() => raeumeAuf(new Date('2040-01-01T00:00:00Z'), true));
  assert.equal(weg.anzahl, 3);

  const nachher = alsAnna(() => alleEintraege());
  // Die Nachrichten sind fort, die Eintraege nicht - sonst entstuende eine Luecke, und
  // niemand koennte sagen, ob dort etwas ablief oder etwas verschwand.
  assert.ok(nachher.length > vorher, 'Es fehlen die Vermerke ueber das Entfernen.');
  assert.equal(pruefeKette(nachher).heil, true);
  const fund = alsAnna(() => suche({ text: 'Angebot' }).treffer[0]!);
  assert.ok(fund, 'Der Eintrag ist mitverschwunden.');
  assert.ok(fund.vermerke.some((v) => /Frist/.test(v.text)));
});

console.log('\nDie Ausfuhr');

/** Ein eigener CSV-Leser nach RFC 4180 - unabhaengig vom Schreiber. */
function liesCsv(text: string): string[][] {
  const zeilen: string[][] = [];
  let feld = '';
  let zeile: string[] = [];
  let inAnfuehrung = false;
  for (let i = 0; i < text.length; i++) {
    const z = text[i]!;
    if (inAnfuehrung) {
      if (z === '"' && text[i + 1] === '"') {
        feld += '"';
        i++;
      } else if (z === '"') inAnfuehrung = false;
      else feld += z;
      continue;
    }
    if (z === '"') inAnfuehrung = true;
    else if (z === ';') {
      zeile.push(feld);
      feld = '';
    } else if (z === '\r' && text[i + 1] === '\n') {
      zeile.push(feld);
      zeilen.push(zeile);
      zeile = [];
      feld = '';
      i++;
    } else feld += z;
  }
  if (feld || zeile.length > 0) {
    zeile.push(feld);
    zeilen.push(zeile);
  }
  return zeilen;
}

/*
 * Ein Betreff, der die Tabelle sprengen wuerde, wenn nicht richtig maskiert wird:
 * Anfuehrungszeichen, das Trennzeichen und ein Zeilenumbruch.
 */
const GEMEIN = 'Re: "Rechnung"; 3 Stück\nzweite Zeile';
let ausfuhr: ReturnType<typeof erzeugeAusfuhr>;

await pruefe('die Ausfuhr entsteht mit allem, was dazugehoert', () => {
  alsAnna(() => {
    archiviere(NACHRICHT('Nachzuegler'), {
      richtung: 'gesendet',
      kontoId: 'k1',
      absender: 'wir@wir.example',
      empfaenger: ['meier@beispiel.de'],
      betreff: GEMEIN,
      entstandenAm: new Date('2026-09-01T10:00:00Z'),
    });
    ausfuhr = erzeugeAusfuhr(path.join(ORDNER, 'ausfuhr-probe'));
  });
  for (const datei of [
    'nachrichten.csv',
    'index.xml',
    'siegel.txt',
    'Verfahrensdokumentation.md',
    'LIESMICH.txt',
  ]) {
    assert.ok(fs.existsSync(path.join(ausfuhr.ordner, datei)), `${datei} fehlt`);
  }
  assert.equal(ausfuhr.anzahl, 4);
});

await pruefe('die Tabelle uebersteht Anfuehrungszeichen, Semikolon und Umbruch', () => {
  const zeilen = liesCsv(fs.readFileSync(path.join(ausfuhr.ordner, 'nachrichten.csv'), 'utf8'));
  assert.equal(zeilen.length, 5, 'Kopfzeile und vier Datensaetze');
  const betreffSpalte = zeilen[0]!.indexOf('Betreff');
  assert.ok(betreffSpalte > 0);
  const gefunden = zeilen.slice(1).map((z) => z[betreffSpalte]);
  assert.ok(gefunden.includes(GEMEIN), `Betreff verstuemmelt: ${JSON.stringify(gefunden)}`);
  // Jede Zeile hat gleich viele Spalten - daran zerbricht eine kaputte Maskierung zuerst.
  for (const z of zeilen) assert.equal(z.length, zeilen[0]!.length);
});

/*
 * Die Beschreibungsdatei mit einem richtigen XML-Leser, nicht mit einem Ausdruck. Wenn
 * sie sich nicht zerlegen laesst, wird sie auch kein Pruefprogramm annehmen - und das ist
 * genau der Fall, den man nicht erst beim Pruefer bemerken will.
 */
await pruefe('die Beschreibungsdatei ist gueltiges XML', () => {
  const roh = fs.readFileSync(path.join(ausfuhr.ordner, 'index.xml'), 'utf8');
  const dom = new JSDOM(roh, { contentType: 'text/xml' });
  const doc = dom.window.document;
  assert.equal(doc.getElementsByTagName('parsererror').length, 0, 'XML kaputt');
  assert.equal(doc.documentElement.nodeName, 'DataSet');
  assert.equal(doc.querySelector('Table > URL')?.textContent, 'nachrichten.csv');
  assert.equal(doc.querySelector('ColumnDelimiter')?.textContent, ';');
  assert.equal(doc.querySelector('TextEncapsulator')?.textContent, '"');
  assert.equal(doc.querySelector('RecordDelimiter')?.textContent, '\r\n');
});

await pruefe('die Beschreibung nennt genau die Spalten der Tabelle, in ihrer Reihenfolge', () => {
  const doc = new JSDOM(fs.readFileSync(path.join(ausfuhr.ordner, 'index.xml'), 'utf8'), {
    contentType: 'text/xml',
  }).window.document;
  const beschrieben = [
    doc.querySelector('VariablePrimaryKey > Name')?.textContent ?? '',
    ...[...doc.querySelectorAll('VariableColumn > Name')].map((n) => n.textContent ?? ''),
  ];
  const kopfzeile = liesCsv(
    fs.readFileSync(path.join(ausfuhr.ordner, 'nachrichten.csv'), 'utf8'),
  )[0]!;
  // Genau diese Zuordnung liest die Pruefsoftware. Steht dort eine Spalte zu viel oder
  // in der falschen Reihenfolge, liest sie die Daten stillschweigend verschoben.
  assert.deepEqual(beschrieben, kopfzeile);
});

await pruefe('die Originale liegen unveraendert bei', () => {
  const zeilen = liesCsv(fs.readFileSync(path.join(ausfuhr.ordner, 'nachrichten.csv'), 'utf8'));
  const dateiSpalte = zeilen[0]!.indexOf('Datei');
  const betreffSpalte = zeilen[0]!.indexOf('Betreff');
  const zeile = zeilen.slice(1).find((z) => z[betreffSpalte] === GEMEIN)!;
  const bytes = fs.readFileSync(path.join(ausfuhr.ordner, zeile[dateiSpalte]!));
  assert.ok(bytes.equals(NACHRICHT('Nachzuegler')));
});

await pruefe('das Siegelblatt nennt den Stand und beschoenigt nichts', () => {
  const text = fs.readFileSync(path.join(ausfuhr.ordner, 'siegel.txt'), 'utf8');
  assert.ok(text.includes(alsAnna(() => siegel())), 'Das Siegel fehlt.');
  assert.match(text, /nicht unmöglich/, 'Die Einschraenkung fehlt.');
});

await pruefe('die Verfahrensdokumentation nennt den wirklichen Stand', () => {
  const text = alsAnna(() => verfahrensdokumentation(new Date('2026-10-01T12:00:00Z')));
  assert.match(text, /Wir GmbH/);
  assert.ok(text.includes(alsAnna(() => siegel())));
  // Und die Stelle, an der andere Anbieter etwas versprechen, was es nicht gibt.
  assert.match(text, /Rz\. 179/);
  assert.match(text, /Organisatorischer Teil/);
});

console.log('\nWiederlesen');

await pruefe('ein neu gelesenes Archiv ergibt denselben Stand', () => {
  const vorher = alsAnna(() => alleEintraege());
  const sVorher = alsAnna(() => siegel());
  vergissStand();
  const nachher = alsAnna(() => alleEintraege());
  /*
   * Verglichen wird durch JSON hindurch, und nicht aus Nachlaessigkeit: Ein Feld, das im
   * Speicher `undefined` ist, hat in der Datei gar keinen Schluessel. Fuer alles, was
   * zaehlt - Siegel, Kette, Inhalt - ist das dasselbe; fuer deepEqual nicht. Genau diese
   * Umformung macht die Datei, also wird sie hier auch gemacht.
   */
  assert.deepEqual(nachher, JSON.parse(JSON.stringify(vorher)));
  assert.equal(pruefeKette(nachher).heil, true);
  assert.equal(alsAnna(() => siegel()), sVorher);
});

/*
 * Eine halb geschriebene letzte Zeile - der Fall nach einem Stromausfall. Sie darf den
 * Rest nicht mitreissen: Was vollstaendig dasteht, muss lesbar bleiben.
 */
await pruefe('eine abgeschnittene letzte Zeile reisst den Bestand nicht mit', () => {
  const datei = path.join(ORDNER, 'nutzer', 'anna', 'archiv', 'kette.jsonl');
  const heil = fs.readFileSync(datei, 'utf8');
  const anzahl = alsAnna(() => alleEintraege().length);
  fs.writeFileSync(datei, heil + '{"nr":999,"erfasstAm":"2026');
  try {
    vergissStand();
    const gelesen = alsAnna(() => alleEintraege());
    assert.equal(gelesen.length, anzahl, 'Die halbe Zeile wurde mitgezaehlt.');
    assert.equal(pruefeKette(gelesen).heil, true);
  } finally {
    fs.writeFileSync(datei, heil);
    vergissStand();
  }
});

fs.rmSync(ORDNER, { recursive: true, force: true });

console.log(`\n${ok}/${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
