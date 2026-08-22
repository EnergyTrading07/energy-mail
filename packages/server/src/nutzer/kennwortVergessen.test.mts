import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/*
 * Das vergessene Kennwort.
 *
 * Dieser Weg ist von allen offenen der maechtigste: Er oeffnet ein Konto, das es GIBT -
 * mit Post darin und mit hinterlegten Zugangsdaten. Geprueft wird deshalb nicht, ob er
 * funktioniert, sondern ob er an den Stellen zu ist, an denen er zu sein muss:
 *
 *  - Ohne Systemversand gibt es ihn gar nicht.
 *  - Der Einplatznutzer der Huelle ist unerreichbar.
 *  - Eine Marke gilt einmal, eine Stunde, und nur bis zum naechsten Kennwortwechsel.
 *  - Der zweite Faktor bleibt stehen.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-kennwort-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 13) });

const {
  entwerteKennwortmarken,
  fordereZuruecksetzung,
  loeseKennwortmarke,
  vergissKennwortmarken,
  zuruecksetzenMoeglich,
} = await import('./kennwortVergessen.js');
const { setzeSystemmail } = await import('../systemmail.js');
const {
  entferneZweiFaktor,
  hatZweiFaktor,
  legeNutzerAn,
  pruefeAnmeldung,
  setzeKennwort,
  setzeSperre,
  setzeZweiFaktor,
} = await import('./nutzerStore.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { EINPLATZ_NUTZER } = await import('./kontext.js');

const DATEI = path.join(tempDir, 'kennwortmarken.json');
const KENNWORT = 'ein-langes-kennwort';

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

function versand(an: boolean): void {
  setzeSystemmail(
    an
      ? { aktiv: true, host: 'smtp.beispiel.de', port: 587, absender: 'noreply@beispiel.de' }
      : { aktiv: false },
  );
}

/** Die Marke aus einem Befund holen - sonst steht in jeder Pruefung dieselbe Zeile. */
function markeAus(befund: ReturnType<typeof fordereZuruecksetzung>): string {
  assert.equal(befund.art, 'marke', 'Es kam keine Marke heraus.');
  return (befund as { marke: string }).marke;
}

// Zwei Konten, die alle Pruefungen benutzen.
legeNutzerAn({ email: 'anna@firma.de', kennwort: KENNWORT }, verpackeNutzerschluessel);
legeNutzerAn({ email: 'bernd@firma.de', kennwort: KENNWORT }, verpackeNutzerschluessel);

console.log('\nWann es diesen Weg gibt:');

await pruefe('ohne Systemversand gar nicht', () => {
  versand(false);
  assert.equal(zuruecksetzenMoeglich(), false);
});

await pruefe('mit Systemversand schon', () => {
  versand(true);
  assert.equal(zuruecksetzenMoeglich(), true);
});

console.log('\nWer eine Marke bekommt:');

await pruefe('ein bestehendes Konto', () => {
  const befund = fordereZuruecksetzung('anna@firma.de');
  assert.equal(befund.art, 'marke');
});

await pruefe('die Adresse wird dabei gross- und kleingeschrieben verstanden', () => {
  const befund = fordereZuruecksetzung('  ANNA@Firma.DE ');
  assert.equal(befund.art, 'marke');
});

await pruefe('eine unbekannte Adresse bekommt keine - aber eine Antwort', () => {
  /*
   * "unbekannt" ist kein Fehler, sondern ein eigener Ausgang: Der Aufrufer schickt
   * trotzdem eine Nachricht. Ohne die waere die Antwortzeit die Auskunft, die das
   * Formular gerade verbergen soll - und der Mensch mit dem Tippfehler wartete
   * vergeblich.
   */
  const befund = fordereZuruecksetzung('gibtsnicht@firma.de');
  assert.equal(befund.art, 'unbekannt');
});

await pruefe('ein gesperrtes Konto bekommt keine', () => {
  // Ein neues Kennwort wuerde daran nichts aendern - die Anmeldung bleibt zu. Hier hilft
  // nur der Betreiber, und genau das steht in der Mail.
  setzeSperre('bernd', true);
  assert.equal(fordereZuruecksetzung('bernd@firma.de').art, 'gesperrt');
  setzeSperre('bernd', false);
});

await pruefe('der Einplatznutzer der Huelle ist unerreichbar', () => {
  /*
   * Seine Adresse steht im Quelltext (lokal@energy-mail.local), und angemeldet wird sich
   * dort ueber das Zugangsgeheimnis des Prozesses. Ein Weg, der sein Kennwort setzen
   * kann, waere eine Tuer in ein Konto, das gar keine haben soll.
   */
  legeNutzerAn(
    { id: EINPLATZ_NUTZER, email: `${EINPLATZ_NUTZER}@energy-mail.local`, kennwort: KENNWORT },
    verpackeNutzerschluessel,
  );
  const befund = fordereZuruecksetzung(`${EINPLATZ_NUTZER}@energy-mail.local`);
  assert.equal(befund.art, 'unbekannt');
});

console.log('\nDie Marke:');

await pruefe('sie steht nicht im Klartext in der Datei', () => {
  const marke = markeAus(fordereZuruecksetzung('anna@firma.de'));
  const roh = fs.readFileSync(DATEI, 'utf-8');
  assert.ok(!roh.includes(marke), 'die Marke liegt lesbar auf der Platte');
});

await pruefe('sie gilt genau einmal', () => {
  const marke = markeAus(fordereZuruecksetzung('anna@firma.de'));
  assert.equal(loeseKennwortmarke(marke), 'anna');
  assert.equal(loeseKennwortmarke(marke), null, 'die Marke galt ein zweites Mal');
});

await pruefe('eine neue Marke entwertet die alte', () => {
  /*
   * Sonst haette, wer zehnmal klickt, zehn gueltige Schluessel in zehn Mails liegen -
   * jeder eine Stunde lang brauchbar und jeder ein eigener Weg, auf dem einer davon
   * abhandenkommen kann.
   */
  const erste = markeAus(fordereZuruecksetzung('anna@firma.de'));
  const zweite = markeAus(fordereZuruecksetzung('anna@firma.de'));
  assert.notEqual(erste, zweite);
  assert.equal(loeseKennwortmarke(erste), null, 'die alte Marke gilt noch');
  assert.equal(loeseKennwortmarke(zweite), 'anna');
});

await pruefe('die Marke eines anderen Nutzers bleibt davon unberuehrt', () => {
  const annas = markeAus(fordereZuruecksetzung('anna@firma.de'));
  const bernds = markeAus(fordereZuruecksetzung('bernd@firma.de'));
  assert.equal(loeseKennwortmarke(annas), 'anna');
  assert.equal(loeseKennwortmarke(bernds), 'bernd');
});

await pruefe('sie ueberdauert einen Neustart des Servers', () => {
  // Ein Neustart kommt bei jedem Einspielen einer Fassung. Ginge die Marke dabei verloren,
  // liefe der Mensch in einen Link, der nicht mehr gilt - ohne erkennbaren Grund.
  const marke = markeAus(fordereZuruecksetzung('anna@firma.de'));
  vergissKennwortmarken();
  assert.equal(loeseKennwortmarke(marke), 'anna');
});

await pruefe('eine abgelaufene Marke gilt nicht', () => {
  const marke = markeAus(fordereZuruecksetzung('anna@firma.de'));
  const inhalt = JSON.parse(fs.readFileSync(DATEI, 'utf-8')) as { marken: { bis: number }[] };
  for (const m of inhalt.marken) m.bis = Date.now() - 1000;
  fs.writeFileSync(DATEI, JSON.stringify(inhalt));
  vergissKennwortmarken();
  assert.equal(loeseKennwortmarke(marke), null);
});

await pruefe('eine erfundene Marke findet nichts', () => {
  assert.equal(loeseKennwortmarke('x'.repeat(43)), null);
  assert.equal(loeseKennwortmarke(''), null);
});

console.log('\nWas eine Marke ungueltig macht:');

await pruefe('ein Kennwortwechsel entwertet, was offensteht', () => {
  /*
   * Der Angriff, gegen den das steht: Ein Fremder fordert eine Zuruecksetzung an, der
   * Kontoinhaber merkt etwas und aendert sein Kennwort - und die alte Marke wuerde das
   * frische Kennwort spaeter wieder ausser Kraft setzen.
   */
  const marke = markeAus(fordereZuruecksetzung('anna@firma.de'));
  setzeKennwort('anna', 'ein-frisches-kennwort');
  entwerteKennwortmarken('anna');
  assert.equal(loeseKennwortmarke(marke), null, 'die Marke gilt nach dem Wechsel weiter');
  // Und das frische Kennwort steht.
  assert.ok(pruefeAnmeldung('anna@firma.de', 'ein-frisches-kennwort'));
});

console.log('\nDer zweite Faktor:');

await pruefe('er ueberlebt ein zurueckgesetztes Kennwort', () => {
  /*
   * Der wichtigste Satz des ganzen Vorgangs. Ein zweiter Faktor deckt gerade den Fall ab,
   * dass jemand an das Kennwort gekommen ist; ein Weg, der beides zugleich zuruecksetzt,
   * traefe ausgerechnet die Vorsichtigen - es genuegte, einmal an ihr Postfach zu kommen.
   */
  setzeZweiFaktor('bernd', 'verschluesseltes-geheimnis', ['pruefsumme-eines-codes']);
  assert.equal(hatZweiFaktor('bernd'), true);

  const marke = markeAus(fordereZuruecksetzung('bernd@firma.de'));
  assert.equal(loeseKennwortmarke(marke), 'bernd');
  setzeKennwort('bernd', 'noch-ein-kennwort');

  assert.equal(hatZweiFaktor('bernd'), true, 'der zweite Faktor ist verschwunden');
  entferneZweiFaktor('bernd');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
