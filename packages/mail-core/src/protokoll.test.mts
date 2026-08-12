import assert from 'node:assert/strict';
import { UNKENNTLICH, baueZeile, enthaeltGeheimnisse, saeubere } from './protokoll.js';

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

/** Kurzform: bleibt das Geheimnis draussen und der Zusammenhang drin? */
function raus(text: string, geheim: string, bleibt?: string): void {
  const rein = saeubere(text);
  assert.ok(!rein.includes(geheim), `"${geheim}" steht noch drin: ${rein}`);
  if (bleibt) assert.ok(rein.includes(bleibt), `"${bleibt}" ging mit verloren: ${rein}`);
}

console.log('\nWas nicht in einen Fehlerbericht darf:');

pruefe('ein Kennwort in JSON', () => {
  raus('{"user":"anna","password":"Hunter2!"}', 'Hunter2!', 'user');
});

pruefe('ein Kennwort in den vielen Schreibweisen', () => {
  for (const feld of ['password', 'passwort', 'pass', 'pw', 'secret', 'kennwort', 'PASSWORD']) {
    raus(`${feld}=GeHeIm123`, 'GeHeIm123');
    raus(`"${feld}": "GeHeIm123"`, 'GeHeIm123');
  }
});

pruefe('eine Anmeldekopfzeile', () => {
  // Dass es eine Bearer-Anmeldung war, bleibt stehen - danach sucht man.
  raus('Authorization: Bearer ya29.abcdefghijklmnop', 'ya29.abcdefghijklmnop', 'Bearer');
  raus('authorization: Basic dXNlcjpwYXNzd29yZA==', 'dXNlcjpwYXNzd29yZA==', 'Basic');
});

pruefe('Zugangsmarken unter jedem ihrer Namen', () => {
  for (const feld of ['access_token', 'refresh_token', 'id_token', 'client_secret', 'api_key']) {
    raus(`{"${feld}":"1//0abcdefgXYZ"}`, '1//0abcdefgXYZ');
  }
});

pruefe('eine Google-Marke auch ohne Feldnamen', () => {
  // In einer Fehlermeldung steht sie oft nackt im Fliesstext.
  raus('Abbruch bei ya29.a0AfH6SMBxxxxxxxxxxxxxxxx – erneut anmelden', 'ya29.a0AfH6SMBxxxxxxxxxxxxxxxx', 'erneut anmelden');
});

pruefe('ein JSON Web Token', () => {
  raus(
    'token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0',
  );
});

pruefe('die IMAP-Anmeldung aus einem Mitschnitt', () => {
  raus('C: A001 LOGIN anna@gmx.de Hunter2', 'Hunter2');
  raus('C: A001 LOGIN anna@gmx.de Hunter2', 'anna');
});

pruefe('das Zugangsgeheimnis aus der WebSocket-Adresse', () => {
  /*
   * Der Weg, den niemand vermutet: bei einem WebSocket laesst sich keine Kopfzeile
   * setzen, also haengt die Oberflaeche das Geheimnis an die Adresse - und Fastify
   * protokolliert von jeder Anfrage die Adresse samt Abfrageteil. Bei jedem
   * Verbindungsaufbau stand der Schluessel zum eigenen Postfachdienst im Klartext in
   * der Datei, die diagnose.ts zum Verschicken anbietet.
   */
  const geheim = '6f3a9c1d8e2b4a7f0c5d3e9b1a8f2c4d';
  raus(`{"req":{"method":"GET","url":"/ws?zugang=${geheim}"}}`, geheim, '/ws?zugang=');
  raus(`{"req":{"url":"/accounts?seite=2&zugang=${geheim}&art=neu"}}`, geheim, 'art=neu');
});

pruefe('das Zugangsgeheimnis aus der Kopfzeile', () => {
  const geheim = '6f3a9c1d8e2b4a7f0c5d3e9b1a8f2c4d';
  // Der Name der Kopfzeile bleibt stehen - daran sieht man beim Suchen noch, worum es ging.
  raus(`x-energy-mail-zugang: ${geheim}`, geheim, 'x-energy-mail-zugang');
  raus(`{"x-energy-mail-zugang":"${geheim}"}`, geheim, 'x-energy-mail-zugang');
});

pruefe('und der Bericht meldet es, statt ihn durchzuwinken', () => {
  /*
   * Der eigentliche Punkt. diagnose.ts fragt enthaeltGeheimnisse(), bevor es den Bericht
   * schreibt - meldete das nichts, ging der Schluessel im guten Glauben mit hinaus.
   */
  const roh = '{"req":{"url":"/ws?zugang=6f3a9c1d8e2b4a7f0c5d3e9b1a8f2c4d"}}';
  assert.deepEqual(enthaeltGeheimnisse(roh), ['Zugangsgeheimnis']);
  assert.deepEqual(enthaeltGeheimnisse(saeubere(roh)), []);
});

pruefe('ein privater Schluessel, ueber viele Zeilen', () => {
  const text = [
    'Beim Entschluesseln gescheitert.',
    '-----BEGIN PGP PRIVATE KEY BLOCK-----',
    'lQdGBGabc123SEHRGEHEIM',
    'weitereZeileGeheim',
    '-----END PGP PRIVATE KEY BLOCK-----',
    'Ende.',
  ].join('\n');
  raus(text, 'SEHRGEHEIM', 'Beim Entschluesseln gescheitert');
  assert.ok(saeubere(text).includes('Ende.'), 'was danach kam, ging mit verloren');
});

pruefe('bei einer Mailadresse bleibt der Anbieter stehen', () => {
  // "es klemmt bei gmx" ist eine Auskunft, "es klemmt bei [entfernt]" ist keine.
  const rein = saeubere('Anmeldung fuer zeuch.hendrik@gmx.de abgelehnt');
  assert.ok(!rein.includes('zeuch.hendrik'), rein);
  assert.ok(rein.includes('@gmx.de'), rein);
  assert.ok(rein.includes('abgelehnt'), rein);
});

pruefe('mehrere Adressen in einer Zeile', () => {
  const rein = saeubere('An: anna@firma.de, bob@firma.de');
  assert.ok(!rein.includes('anna'), rein);
  assert.ok(!rein.includes('bob'), rein);
});

console.log('\nWas stehen bleiben muss:');

pruefe('gewoehnliche Meldungen bleiben unangetastet', () => {
  const text = 'Ordner INBOX geoeffnet, 17 Nachrichten, UIDVALIDITY 1456789';
  assert.equal(saeubere(text), text);
});

pruefe('eine Konto-Kennung ist kein Geheimnis', () => {
  // Sie steht in jeder Adresse des eigenen Servers und hilft beim Zuordnen.
  const text = 'GET /accounts/7dfef4ba-d510-492c-b50b-7010dfa51204/folders';
  assert.equal(saeubere(text), text);
});

pruefe('ein Betreff wird nicht zerstueckelt', () => {
  const text = 'Verschieben nach "Papierkorb" fehlgeschlagen (Serverantwort: NO)';
  assert.equal(saeubere(text), text);
});

console.log('\nDie Nachkontrolle:');

pruefe('findet, was die Regeln kennen', () => {
  assert.deepEqual(enthaeltGeheimnisse('password=Hunter2'), ['Kennwort']);
  assert.ok(enthaeltGeheimnisse('Kontakt: anna@firma.de').includes('Mailadresse'));
});

pruefe('meldet nichts bei einem gesaeuberten Text', () => {
  // Der wichtigste Fall: was durch saeubere() ging, darf hinterher nicht mehr
  // beanstandet werden - sonst ist eine der beiden Seiten falsch.
  const roh = [
    '{"password":"Hunter2!"}',
    'Authorization: Bearer ya29.abcdefghij',
    'An: anna@firma.de',
    'C: A001 LOGIN anna@gmx.de Hunter2',
    '{"refresh_token":"1//0abcXYZ"}',
  ].join('\n');
  assert.deepEqual(enthaeltGeheimnisse(saeubere(roh)), []);
});

pruefe('meldet nichts bei einem harmlosen Text', () => {
  assert.deepEqual(enthaeltGeheimnisse('Ordner INBOX geoeffnet, 17 Nachrichten'), []);
});

console.log('\nAufbau einer Zeile:');

pruefe('Zeitpunkt, Stufe, Herkunft, Text', () => {
  const z = baueZeile(new Date('2026-08-08T14:30:00Z'), 'fehler', 'imap', 'Verbindung weg');
  assert.equal(z, '2026-08-08T14:30:00.000Z FEHL [imap] Verbindung weg');
});

pruefe('auch die Zeile selbst wird gesaeubert', () => {
  // Sonst haette jede Stelle, die protokolliert, selbst daran zu denken.
  const z = baueZeile(new Date('2026-08-08T14:30:00Z'), 'info', 'smtp', 'pass=Hunter2');
  assert.ok(!z.includes('Hunter2'), z);
  assert.ok(z.includes(UNKENNTLICH), z);
});

pruefe('eine mehrzeilige Meldung bleibt eine Einheit', () => {
  // Eingerueckt, damit sie nicht wie mehrere Eintraege aussieht.
  const z = baueZeile(new Date('2026-08-08T14:30:00Z'), 'fehler', 'app', 'Erste Zeile\nZweite Zeile');
  const zeilen = z.split('\n');
  assert.equal(zeilen.length, 2);
  assert.ok(zeilen[1]!.startsWith('        '), `nicht eingerueckt: ${JSON.stringify(zeilen[1])}`);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
