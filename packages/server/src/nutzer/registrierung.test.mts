import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/*
 * Die Selbstregistrierung.
 *
 * Sie ist der einzige Weg in diesen Dienst hinein, der ohne Anmeldung offensteht - und
 * damit die Stelle, an der ein Fehler nicht einen Nutzer betrifft, sondern die Frage, wer
 * ueberhaupt Nutzer wird. Geprueft wird deshalb nicht, ob das Formular funktioniert,
 * sondern ob die Riegel halten:
 *
 *  - Sie ist AUS, solange sie niemand einschaltet. Auch nach einer Aktualisierung.
 *  - "offen" ist ohne Bestaetigungsmail nicht zu haben.
 *  - Ein Kennwort steht nie im Klartext in einer Datei, auch nicht "nur solange der
 *    Antrag laeuft".
 *  - Eine Bestaetigungsmarke gilt einmal, nicht zweimal.
 *  - Ein bestaetigter Antrag laesst sich nicht mehr ueberschreiben.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-registrierung-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 11) });

const speicher = await import('./registrierungSpeicher.js');
const {
  betriebsartWirksam,
  domaeneErlaubt,
  entferneAntrag,
  loeseMarkeEin,
  nimmAntragAn,
  offeneAntraege,
  raeumeAuf,
  registrierungseinstellungen,
  setzeRegistrierung,
  vergissRegistrierung,
  wartendeAntraege,
  RegistrierungsFehler,
} = speicher;
const { setzeSystemmail, systemmailEingerichtet } = await import('../systemmail.js');
const { legeNutzerAn, pruefeAnmeldung, entferneNutzer, findeNutzerNachEmail } = await import(
  './nutzerStore.js'
);
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { zaehleVersuch, vergissBremse } = await import('./anmeldebremse.js');

const DATEI = path.join(tempDir, 'registrierung.json');
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

/** Systemversand an oder aus - er entscheidet ueber fast alles hier. */
function versand(an: boolean): void {
  setzeSystemmail(
    an
      ? { aktiv: true, host: 'smtp.beispiel.de', port: 587, absender: 'noreply@beispiel.de' }
      : { aktiv: false },
  );
}

/** Alle Antraege wegraeumen, damit jede Pruefung von vorn anfaengt. */
function leere(): void {
  for (const a of offeneAntraege()) entferneAntrag(a.id);
}

console.log('\nEinstellungen:');

await pruefe('die Vorgabe ist AUS - ein aktualisierter Server oeffnet sich nicht von selbst', () => {
  assert.equal(registrierungseinstellungen().betriebsart, 'aus');
  assert.equal(betriebsartWirksam(), 'aus');
});

await pruefe('"offen" ohne Systemversand wird abgewiesen statt still umgebogen', () => {
  versand(false);
  assert.throws(() => setzeRegistrierung({ betriebsart: 'offen' }), RegistrierungsFehler);
  // Und die alte Einstellung steht noch - eine abgewiesene Aenderung aendert nichts.
  assert.equal(registrierungseinstellungen().betriebsart, 'aus');
});

await pruefe('mit Systemversand geht "offen"', () => {
  versand(true);
  assert.equal(systemmailEingerichtet(), true);
  assert.equal(setzeRegistrierung({ betriebsart: 'offen' }).betriebsart, 'offen');
  assert.equal(betriebsartWirksam(), 'offen');
});

await pruefe('faellt der Systemversand weg, gilt nur noch "freigabe"', () => {
  // Der Fall, den niemand plant: Erst "offen" einstellen, spaeter den Sendeserver
  // abschalten. Waere die Einstellung allein massgeblich, stuende hier eine offene
  // Registrierung ohne jeden Nachweis.
  versand(false);
  assert.equal(registrierungseinstellungen().betriebsart, 'offen', 'gespeichert bleibt es');
  assert.equal(betriebsartWirksam(), 'freigabe', 'wirksam ist es nicht');
});

await pruefe('Domaenen werden vereinheitlicht, Unsinn faellt heraus', () => {
  const neu = setzeRegistrierung({
    betriebsart: 'freigabe',
    domaenen: ['@Firma.DE ', 'tochter.de', 'firma', ''],
  });
  assert.deepEqual(neu.domaenen, ['firma.de', 'tochter.de']);
});

await pruefe('der Domaenenfilter greift', () => {
  assert.equal(domaeneErlaubt('anna@firma.de'), true);
  assert.equal(domaeneErlaubt('Anna@FIRMA.de'), true);
  assert.equal(domaeneErlaubt('anna@woanders.de'), false);
});

await pruefe('ohne Liste ist jede Domaene erlaubt', () => {
  setzeRegistrierung({ domaenen: [] });
  assert.equal(domaeneErlaubt('anna@woanders.de'), true);
});

console.log('\nAntraege:');

await pruefe('ein Antrag haelt nur die Pruefsumme - nie das Kennwort', () => {
  versand(false);
  leere();
  const befund = nimmAntragAn({ email: 'anna@firma.de', kennwort: KENNWORT });
  assert.equal(befund.art, 'wartet');

  const roh = fs.readFileSync(DATEI, 'utf-8');
  assert.ok(!roh.includes(KENNWORT), 'das Kennwort steht in der Datei');
  assert.ok(roh.includes('scrypt$'), 'die Pruefsumme fehlt');
});

await pruefe('eine unbrauchbare Adresse kommt nicht durch', () => {
  assert.throws(() => nimmAntragAn({ email: 'kein-at-zeichen', kennwort: KENNWORT }), RegistrierungsFehler);
});

await pruefe('ein zu kurzes Kennwort kommt nicht durch', () => {
  assert.throws(() => nimmAntragAn({ email: 'kurz@firma.de', kennwort: 'kurz' }), RegistrierungsFehler);
});

await pruefe('eine gesperrte Domaene kommt nicht durch - und sagt das auch', () => {
  setzeRegistrierung({ domaenen: ['firma.de'] });
  assert.throws(
    () => nimmAntragAn({ email: 'fremd@woanders.de', kennwort: KENNWORT }),
    RegistrierungsFehler,
  );
  setzeRegistrierung({ domaenen: [] });
});

await pruefe('ohne Systemversand wird ein laufender Antrag NICHT ueberschrieben', () => {
  // Sonst tauschte ein Fremder das Kennwort im Antrag eines anderen aus - und der
  // Verwalter gaebe ihn ahnungslos frei.
  versand(false);
  leere();
  assert.equal(nimmAntragAn({ email: 'anna@firma.de', kennwort: KENNWORT }).art, 'wartet');
  assert.equal(
    nimmAntragAn({ email: 'anna@firma.de', kennwort: 'ein-anderes-kennwort' }).art,
    'laeuftSchon',
  );
});

await pruefe('mit Systemversand darf ein UNbestaetigter Antrag ersetzt werden', () => {
  // Der haeufige Fall: Die Mail kam nicht an oder das Kennwort war vertippt. Solange
  // nichts bestaetigt ist, ist der Antrag ohnehin wertlos.
  versand(true);
  leere();
  const erst = nimmAntragAn({ email: 'anna@firma.de', kennwort: KENNWORT });
  assert.equal(erst.art, 'bestaetigen');
  const zweit = nimmAntragAn({ email: 'anna@firma.de', kennwort: 'ein-anderes-kennwort' });
  assert.equal(zweit.art, 'bestaetigen');
  assert.equal(offeneAntraege().length, 1, 'es sind zwei Antraege entstanden');
  assert.notEqual(
    (erst as { marke: string }).marke,
    (zweit as { marke: string }).marke,
    'dieselbe Marke ein zweites Mal',
  );
});

await pruefe('ein BESTAETIGTER Antrag bleibt stehen', () => {
  versand(true);
  leere();
  const befund = nimmAntragAn({ email: 'bernd@firma.de', kennwort: KENNWORT });
  assert.equal(befund.art, 'bestaetigen');
  assert.ok(loeseMarkeEin((befund as { marke: string }).marke));

  // Ab hier liegt er beim Verwalter - und ist unantastbar.
  assert.equal(
    nimmAntragAn({ email: 'bernd@firma.de', kennwort: 'kennwort-des-angreifers' }).art,
    'laeuftSchon',
  );
});

await pruefe('auf eine Adresse mit Konto gibt es keinen Antrag', () => {
  leere();
  legeNutzerAn({ email: 'schon@firma.de', kennwort: KENNWORT }, verpackeNutzerschluessel);
  assert.equal(nimmAntragAn({ email: 'schon@firma.de', kennwort: KENNWORT }).art, 'schonKonto');
  assert.equal(offeneAntraege().length, 0, 'trotzdem ist ein Antrag entstanden');
});

console.log('\nBestaetigungsmarken:');

await pruefe('die Marke steht nicht im Klartext in der Datei', () => {
  versand(true);
  leere();
  const befund = nimmAntragAn({ email: 'clara@firma.de', kennwort: KENNWORT });
  const marke = (befund as { marke: string }).marke;
  const roh = fs.readFileSync(DATEI, 'utf-8');
  assert.ok(!roh.includes(marke), 'die Marke liegt lesbar auf der Platte');
});

await pruefe('eine Marke gilt genau einmal', () => {
  versand(true);
  leere();
  const befund = nimmAntragAn({ email: 'dora@firma.de', kennwort: KENNWORT });
  const marke = (befund as { marke: string }).marke;
  assert.ok(loeseMarkeEin(marke), 'die erste Einloesung ging schief');
  assert.equal(loeseMarkeEin(marke), null, 'die Marke galt ein zweites Mal');
});

await pruefe('eine abgelaufene Marke gilt nicht', () => {
  versand(true);
  leere();
  const befund = nimmAntragAn({ email: 'egon@firma.de', kennwort: KENNWORT });
  const marke = (befund as { marke: string }).marke;

  // Die Uhr vorstellen, indem die Frist in der Datei zurueckdatiert wird.
  const inhalt = JSON.parse(fs.readFileSync(DATEI, 'utf-8')) as {
    antraege: { markeBis?: number }[];
  };
  for (const a of inhalt.antraege) a.markeBis = Date.now() - 1000;
  fs.writeFileSync(DATEI, JSON.stringify(inhalt));
  vergissRegistrierung();

  assert.equal(loeseMarkeEin(marke), null);
});

await pruefe('eine erfundene Marke findet nichts', () => {
  assert.equal(loeseMarkeEin('x'.repeat(43)), null);
  assert.equal(loeseMarkeEin(''), null);
});

console.log('\nAufraeumen und Zaehlen:');

await pruefe('unbestaetigte Antraege verfallen nach einer Woche', () => {
  versand(true);
  leere();
  nimmAntragAn({ email: 'alt@firma.de', kennwort: KENNWORT });

  const inhalt = JSON.parse(fs.readFileSync(DATEI, 'utf-8')) as {
    antraege: { angelegt: string }[];
  };
  const achtTage = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  for (const a of inhalt.antraege) a.angelegt = achtTage;
  fs.writeFileSync(DATEI, JSON.stringify(inhalt));
  vergissRegistrierung();

  assert.equal(raeumeAuf(), 1);
  assert.equal(offeneAntraege().length, 0);
});

await pruefe('ein bestaetigter Antrag ueberlebt die Woche - aber nicht den Monat', () => {
  versand(true);
  leere();
  const befund = nimmAntragAn({ email: 'geduldig@firma.de', kennwort: KENNWORT });
  loeseMarkeEin((befund as { marke: string }).marke);

  const zuruecksetzen = (tage: number) => {
    const inhalt = JSON.parse(fs.readFileSync(DATEI, 'utf-8')) as {
      antraege: { angelegt: string }[];
    };
    const wann = new Date(Date.now() - tage * 24 * 60 * 60 * 1000).toISOString();
    for (const a of inhalt.antraege) a.angelegt = wann;
    fs.writeFileSync(DATEI, JSON.stringify(inhalt));
    vergissRegistrierung();
  };

  zuruecksetzen(8);
  assert.equal(raeumeAuf(), 0, 'ein bestaetigter Antrag wurde zu frueh weggeraeumt');
  zuruecksetzen(31);
  assert.equal(raeumeAuf(), 1);
});

await pruefe('gezaehlt werden nur Antraege, die auf einen Menschen warten', () => {
  versand(true);
  leere();
  nimmAntragAn({ email: 'unbestaetigt@firma.de', kennwort: KENNWORT });
  assert.equal(wartendeAntraege(), 0, 'ein unbestaetigter Antrag zaehlt als Aufgabe');

  const befund = nimmAntragAn({ email: 'bestaetigt@firma.de', kennwort: KENNWORT });
  loeseMarkeEin((befund as { marke: string }).marke);
  assert.equal(wartendeAntraege(), 1);
});

await pruefe('die Bremse laesst genau so viele durch, wie sie soll', () => {
  vergissBremse();
  for (let i = 0; i < 5; i++) {
    assert.equal(zaehleVersuch('pruefung', '203.0.113.5', 5, 60_000), true, `Versuch ${i + 1}`);
  }
  assert.equal(zaehleVersuch('pruefung', '203.0.113.5', 5, 60_000), false, 'der sechste kam durch');
});

await pruefe('ein anderer Bereich hat einen eigenen Zaehler', () => {
  // Wer sich registriert hat, soll deswegen nicht bei der Anmeldung anstehen.
  assert.equal(zaehleVersuch('anderer-bereich', '203.0.113.5', 5, 60_000), true);
});

await pruefe('die Bremse ueberdauert einen Neustart des Servers', () => {
  vergissBremse();
  assert.equal(zaehleVersuch('pruefung', '203.0.113.5', 5, 60_000), false);
});

await pruefe('eine bekannte Adresse braucht genauso lange wie eine unbekannte', () => {
  /*
   * Der Zeitkanal - und der Grund, warum die Pruefsumme immer gerechnet wird.
   *
   * Die Antwort nach aussen ist fuer jeden Ausgang dieselbe. Waere die Rechenzeit es
   * nicht, koennte man den Unterschied trotzdem messen: scrypt braucht ein paar zehntel
   * Sekunden, ein Blick in eine Liste nichts. Aus "kam sofort zurueck" liesse sich
   * ablesen, dass es diese Adresse hier gibt.
   *
   * Gemessen wird grob und mit viel Luft - ein Faktor drei, nicht ein Prozentwert. Die
   * Pruefung soll den Kanal finden, wenn ihn jemand aus Versehen wieder aufmacht, und
   * nicht auf einem ausgelasteten Bauserver rot werden.
   */
  versand(false);
  leere();
  legeNutzerAn({ email: 'bekannt@firma.de', kennwort: KENNWORT }, verpackeNutzerschluessel);

  const messe = (email: string) => {
    const start = process.hrtime.bigint();
    nimmAntragAn({ email, kennwort: KENNWORT });
    return Number(process.hrtime.bigint() - start) / 1e6;
  };

  const unbekannt = messe('ganzneu@firma.de');
  const bekannt = messe('bekannt@firma.de');

  assert.ok(unbekannt > 5, `Der gewoehnliche Weg war unerwartet schnell (${unbekannt} ms).`);
  assert.ok(
    bekannt > unbekannt / 3,
    `Eine bekannte Adresse antwortet messbar schneller (${bekannt} ms gegen ${unbekannt} ms) - ` +
      'damit laesst sich durchprobieren, wer hier ein Konto hat.',
  );
  entferneNutzer('bekannt');
});

await pruefe('der Datenschutzhinweis wird begrenzt', () => {
  /*
   * Er geht ueber GET /registrierung an jeden hinaus, der die Adresse kennt - ohne
   * Anmeldung. Ein Verwalter, der aus Versehen ein ganzes Dokument hineinkopiert, machte
   * daraus einen Weg, ueber den sich beliebig viel abrufen laesst.
   */
  const neu = setzeRegistrierung({ hinweis: 'x'.repeat(10_000) });
  assert.equal(neu.hinweis.length, 4000);
});

console.log('\nAus einem Antrag wird ein Konto:');

await pruefe('das selbst gewaehlte Kennwort gilt nach der Freigabe', () => {
  // Der eigentliche Zweck der ganzen Uebung: Zwischen Formular und Konto liegen Stunden
  // oder Tage, und das Kennwort ueberlebt sie ausschliesslich als Pruefsumme.
  versand(false);
  leere();
  const befund = nimmAntragAn({ email: 'frisch@firma.de', kennwort: KENNWORT });
  assert.equal(befund.art, 'wartet');
  const antrag = (befund as { antrag: { id: string; kennwortPruefsumme: string } }).antrag;

  legeNutzerAn(
    { email: 'frisch@firma.de', kennwortPruefsumme: antrag.kennwortPruefsumme },
    verpackeNutzerschluessel,
  );
  entferneAntrag(antrag.id);

  assert.ok(pruefeAnmeldung('frisch@firma.de', KENNWORT), 'das gewaehlte Kennwort gilt nicht');
  assert.equal(pruefeAnmeldung('frisch@firma.de', 'etwas-anderes-langes'), null);
  assert.ok(findeNutzerNachEmail('frisch@firma.de'));
  entferneNutzer('frisch');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
