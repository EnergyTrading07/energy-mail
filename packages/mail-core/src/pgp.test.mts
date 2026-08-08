import assert from 'node:assert/strict';
import {
  PgpFehler,
  entschluessle,
  erzeugeSchluesselpaar,
  leseSchluessel,
  pruefeAbgetrennteSignatur,
  pruefeKennwort,
  signiereAbgetrennt,
  verschluessle,
  type BundSchluessel,
} from './pgp.js';
import {
  alsQuotedPrintable,
  baueSigniertenTeil,
  leseGrenze,
  schneideSigniertenTeil,
} from './pgpErkennung.js';

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

console.log('\nSchluessel erzeugen (dauert einen Augenblick):');

// Drei Beteiligte: Anna schreibt an Bernd, und Mallory versucht sich als Anna auszugeben.
const anna = await erzeugeSchluesselpaar({ name: 'Anna Müller', adresse: 'anna@firma.de' });
const bernd = await erzeugeSchluesselpaar({
  name: 'Bernd Schmidt',
  adresse: 'bernd@firma.de',
  kennwort: 'geheim123',
});
const mallory = await erzeugeSchluesselpaar({ name: 'Anna Müller', adresse: 'mallory@woanders.de' });

const alsBund = (paar: typeof anna): BundSchluessel => ({
  armored: paar.oeffentlich,
  angaben: paar.angaben,
});

await pruefe('ein erzeugtes Paar hat Fingerabdruck, Adresse und Namen', async () => {
  assert.match(anna.angaben.fingerabdruck, /^[0-9A-F]{40}$/, anna.angaben.fingerabdruck);
  assert.deepEqual(anna.angaben.adressen, ['anna@firma.de']);
  assert.deepEqual(anna.angaben.namen, ['Anna Müller']);
  assert.equal(anna.angaben.abgelaufen, false);
  assert.equal(anna.angaben.zurueckgezogen, false);
});

await pruefe('der oeffentliche Teil traegt keinen geheimen', async () => {
  const [gelesen] = await leseSchluessel(anna.oeffentlich);
  assert.equal(gelesen?.angaben.geheim, false);
  const [geheim] = await leseSchluessel(anna.geheim);
  assert.equal(geheim?.angaben.geheim, true);
  assert.equal(geheim?.angaben.fingerabdruck, gelesen?.angaben.fingerabdruck);
});

await pruefe('ein Kennwort wird geprueft, nicht geraten', async () => {
  assert.equal(await pruefeKennwort(bernd.geheim, 'geheim123'), true);
  assert.equal(await pruefeKennwort(bernd.geheim, 'falsch'), false);
  assert.equal(await pruefeKennwort(bernd.geheim, ''), false);
});

await pruefe('was kein Schluessel ist, wird abgewiesen', async () => {
  await assert.rejects(() => leseSchluessel('Guten Tag, anbei der Vertrag.'), PgpFehler);
  await assert.rejects(() => leseSchluessel(''), PgpFehler);
});

console.log('\nUnterschreiben und pruefen:');

const TEXT = 'Bitte überweisen Sie 1.000 € auf das Konto DE12 3456.';

await pruefe('eine echte Unterschrift geht auf', async () => {
  const signatur = await signiereAbgetrennt(TEXT, anna.geheim);
  const befund = await pruefeAbgetrennteSignatur(TEXT, signatur, [alsBund(anna)], 'anna@firma.de');
  assert.equal(befund.vertrauen, 'gueltig', befund.grund ?? '');
  assert.equal(befund.fingerabdruck, anna.angaben.fingerabdruck);
});

await pruefe('ein GEAENDERTER Text faellt durch - das ist der Kern der Sache', async () => {
  const signatur = await signiereAbgetrennt(TEXT, anna.geheim);
  const gefaelscht = TEXT.replace('DE12 3456', 'DE99 9999');
  const befund = await pruefeAbgetrennteSignatur(
    gefaelscht,
    signatur,
    [alsBund(anna)],
    'anna@firma.de',
  );
  assert.equal(befund.vertrauen, 'ungueltig', 'die Faelschung ging durch!');
});

await pruefe('schon ein einziges Zeichen genuegt', async () => {
  const signatur = await signiereAbgetrennt(TEXT, anna.geheim);
  const befund = await pruefeAbgetrennteSignatur(
    TEXT + ' ',
    signatur,
    [alsBund(anna)],
    'anna@firma.de',
  );
  assert.equal(befund.vertrauen, 'ungueltig');
});

await pruefe('ohne den Schluessel laesst sich nichts sagen', async () => {
  const signatur = await signiereAbgetrennt(TEXT, anna.geheim);
  const befund = await pruefeAbgetrennteSignatur(TEXT, signatur, [], 'anna@firma.de');
  assert.equal(befund.vertrauen, 'schluessel-fehlt');
});

await pruefe('Mallory unterschreibt als "Anna Mueller" - und faellt auf', async () => {
  // Der gefaehrlichste Fall: die Unterschrift geht mathematisch auf, der Schluessel
  // traegt sogar denselben Namen - aber er gehoert zu einer anderen Adresse.
  const signatur = await signiereAbgetrennt(TEXT, mallory.geheim);
  const befund = await pruefeAbgetrennteSignatur(
    TEXT,
    signatur,
    [alsBund(mallory)],
    'anna@firma.de',
  );
  assert.equal(
    befund.vertrauen,
    'gueltig-fremde-adresse',
    'eine fremde Unterschrift wurde als die des Absenders ausgegeben!',
  );
  assert.deepEqual(befund.schluesselAdressen, ['mallory@woanders.de']);
});

await pruefe('Mallorys Unterschrift geht nicht mit Annas Schluessel auf', async () => {
  const signatur = await signiereAbgetrennt(TEXT, mallory.geheim);
  const befund = await pruefeAbgetrennteSignatur(TEXT, signatur, [alsBund(anna)], 'anna@firma.de');
  // Annas Schluessel passt gar nicht zur Kennung in der Unterschrift.
  assert.equal(befund.vertrauen, 'schluessel-fehlt');
});

await pruefe('mit Kennwort unterschreiben', async () => {
  const signatur = await signiereAbgetrennt(TEXT, bernd.geheim, 'geheim123');
  const befund = await pruefeAbgetrennteSignatur(
    TEXT,
    signatur,
    [alsBund(bernd)],
    'bernd@firma.de',
  );
  assert.equal(befund.vertrauen, 'gueltig', befund.grund ?? '');
});

await pruefe('ohne Kennwort geht es nicht, und das wird gesagt', async () => {
  await assert.rejects(
    () => signiereAbgetrennt(TEXT, bernd.geheim),
    (err: Error) => err instanceof PgpFehler && /Kennwort/.test(err.message),
  );
  await assert.rejects(
    () => signiereAbgetrennt(TEXT, bernd.geheim, 'falsch'),
    (err: Error) => err instanceof PgpFehler && /stimmt nicht/.test(err.message),
  );
});

console.log('\nVerschluesseln und entschluesseln:');

await pruefe('Anna schreibt an Bernd - nur Bernd kann es lesen', async () => {
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich], { armored: anna.geheim });
  assert.ok(geheim.includes('BEGIN PGP MESSAGE'));
  assert.ok(!geheim.includes('1.000'), 'der Klartext steht noch drin!');

  const auf = await entschluessle(
    geheim,
    [{ armored: bernd.geheim, kennwort: 'geheim123' }],
    [alsBund(anna)],
    'anna@firma.de',
  );
  assert.equal(auf.text, TEXT);
  assert.equal(auf.signatur?.vertrauen, 'gueltig', auf.signatur?.grund ?? '');
});

await pruefe('Mallory kann es nicht lesen', async () => {
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich], { armored: anna.geheim });
  await assert.rejects(
    () => entschluessle(geheim, [{ armored: mallory.geheim }]),
    PgpFehler,
  );
});

await pruefe('die eigene Kopie bleibt lesbar', async () => {
  // Ohne den eigenen Schluessel unter den Empfaengern waere die Kopie im
  // Gesendet-Ordner fuer immer verloren.
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich], { armored: anna.geheim });
  const auf = await entschluessle(geheim, [{ armored: anna.geheim }]);
  assert.equal(auf.text, TEXT);
});

await pruefe('ohne Empfaengerschluessel wird nichts verschluesselt', async () => {
  await assert.rejects(() => verschluessle(TEXT, []), PgpFehler);
});

await pruefe('eine Unterschrift IM Geheimtext wird mitgeprueft', async () => {
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich], { armored: anna.geheim });
  const auf = await entschluessle(
    geheim,
    [{ armored: bernd.geheim, kennwort: 'geheim123' }],
    [alsBund(mallory)],
    'anna@firma.de',
  );
  // Mallorys Schluessel passt nicht zu Annas Unterschrift.
  assert.equal(auf.signatur?.vertrauen, 'schluessel-fehlt');
});

await pruefe('ohne Unterschrift wird keine behauptet', async () => {
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich]);
  const auf = await entschluessle(geheim, [{ armored: bernd.geheim, kennwort: 'geheim123' }]);
  assert.equal(auf.text, TEXT);
  assert.equal(auf.signatur, undefined, 'es wurde eine Unterschrift gemeldet, die es nicht gibt');
});

await pruefe('ein falsches Kennwort beim Lesen wird als solches gemeldet', async () => {
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich]);
  await assert.rejects(
    () => entschluessle(geheim, [{ armored: bernd.geheim, kennwort: 'falsch' }]),
    (err: Error) => err instanceof PgpFehler && /Kennwort/.test(err.message),
  );
});

await pruefe('was kein Geheimtext ist, wird abgewiesen', async () => {
  await assert.rejects(
    () => entschluessle('Guten Tag.', [{ armored: bernd.geheim, kennwort: 'geheim123' }]),
    PgpFehler,
  );
});

await pruefe('Umlaute ueberstehen den Weg', async () => {
  const mitUmlauten = 'Grüße aus Köln – Übermäßig viel Spaß! 😀';
  const geheim = await verschluessle(mitUmlauten, [bernd.oeffentlich], { armored: anna.geheim });
  const auf = await entschluessle(geheim, [{ armored: bernd.geheim, kennwort: 'geheim123' }]);
  assert.equal(auf.text, mitUmlauten);
});

await pruefe('an mehrere Empfaenger zugleich', async () => {
  const geheim = await verschluessle(TEXT, [bernd.oeffentlich, mallory.oeffentlich], {
    armored: anna.geheim,
  });
  assert.equal((await entschluessle(geheim, [{ armored: bernd.geheim, kennwort: 'geheim123' }])).text, TEXT);
  assert.equal((await entschluessle(geheim, [{ armored: mallory.geheim }])).text, TEXT);
});

console.log('\nPGP/MIME als Ganzes - vom Bauen bis zum Pruefen:');

await pruefe('eine selbst gebaute Nachricht wird beim Pruefen anerkannt', async () => {
  // Der eigentliche Beweis fuer das byteweise Herausschneiden: hier wird eine
  // vollstaendige multipart/signed-Nachricht gebaut, der Teil wieder herausgeschnitten
  // und geprueft. Waere auch nur ein Zeilenende daneben, ginge das nicht auf.
  const teil =
    'Content-Type: text/plain; charset=utf-8\r\n' +
    '\r\n' +
    'Guten Tag,\r\n' +
    '\r\n' +
    'anbei die Zahlen. Grüße aus Köln.';

  const signatur = await signiereAbgetrennt(teil, anna.geheim);
  const grenze = '=_Energy_Mail_1234567890';
  const roh = Buffer.from(
    `Content-Type: multipart/signed; boundary="${grenze}"; ` +
      'protocol="application/pgp-signature"; micalg=pgp-sha256\r\n' +
      'From: Anna <anna@firma.de>\r\n' +
      '\r\n' +
      'Diese Nachricht ist unterschrieben.\r\n' +
      `--${grenze}\r\n` +
      teil +
      `\r\n--${grenze}\r\n` +
      'Content-Type: application/pgp-signature; name="signature.asc"\r\n' +
      '\r\n' +
      signatur +
      `\r\n--${grenze}--\r\n`,
    'utf8',
  );

  const herausgeschnitten = schneideSigniertenTeil(roh, grenze);
  assert.ok(herausgeschnitten, 'nichts herausgeschnitten');

  const befund = await pruefeAbgetrennteSignatur(
    herausgeschnitten!,
    signatur,
    [alsBund(anna)],
    'anna@firma.de',
  );
  assert.equal(befund.vertrauen, 'gueltig', befund.grund ?? '(kein Grund genannt)');
});

await pruefe('eine unterwegs veraenderte Nachricht faellt durch', async () => {
  // Derselbe Weg, aber ein Angreifer aendert die Kontonummer im Text.
  const teil = 'Content-Type: text/plain\r\n\r\nBitte auf DE12 3456 überweisen.';
  const signatur = await signiereAbgetrennt(teil, anna.geheim);
  const grenze = 'grenze42';
  const veraendert = teil.replace('DE12 3456', 'DE99 9999');
  const roh = Buffer.from(
    `Content-Type: multipart/signed; boundary="${grenze}"\r\n\r\n` +
      `--${grenze}\r\n` +
      veraendert +
      `\r\n--${grenze}\r\n\r\n` +
      signatur +
      `\r\n--${grenze}--\r\n`,
    'utf8',
  );

  const befund = await pruefeAbgetrennteSignatur(
    schneideSigniertenTeil(roh, grenze)!,
    signatur,
    [alsBund(anna)],
    'anna@firma.de',
  );
  assert.equal(befund.vertrauen, 'ungueltig', 'die Faelschung ging durch!');
});

await pruefe('die Grenze wird aus der eigenen Kopfzeile wiedergefunden', async () => {
  const kopf =
    'multipart/signed; boundary="=_Energy_Mail_1234567890"; protocol="application/pgp-signature"';
  assert.equal(leseGrenze(kopf), '=_Energy_Mail_1234567890');
});

console.log('\nWas wir versenden, muss sich pruefen lassen:');

const { buildRawMessage } = await import('./smtpClient.js');

/** Ein Konto, wie es die Anwendung kennt - nur die Felder, die hier zaehlen. */
const KONTO = {
  id: 'probe',
  email: 'anna@firma.de',
  displayName: 'Anna Müller',
  imapHost: 'x',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'x',
  smtpPort: 465,
  smtpSecure: true,
  auth: { type: 'password' as const, user: 'x', pass: 'x' },
};

await pruefe('eine von uns unterschriebene Nachricht geht beim Pruefen auf', async () => {
  // Der eigentliche Beweis fuer das von Hand gebaute PGP/MIME: waere auch nur ein
  // Zeilenende anders, koennte niemand die Unterschrift bestaetigen - und die
  // Empfaenger saehen eine Warnung bei jeder Nachricht, die wir verschicken.
  const text = 'Guten Tag,\n\nanbei die Zahlen. Grüße aus Köln.\n\nAnna';
  // Unterschrieben wird genau der Teil, der auch hinausgeht - eine Funktion für beides.
  const teil = baueSigniertenTeil(text);
  const signatur = await signiereAbgetrennt(teil, anna.geheim);

  const roh = await buildRawMessage(KONTO, {
    to: ['bernd@firma.de'],
    subject: 'Die Zahlen für Köln',
    text,
    pgpSignierterTeil: teil,
    pgpSignatur: signatur,
  });

  const alsText = roh.toString('utf8');
  assert.ok(alsText.includes('multipart/signed'), 'nicht als unterschrieben gebaut');
  assert.ok(alsText.includes('protocol="application/pgp-signature"'));
  assert.ok(alsText.includes('micalg=pgp-sha256'));
  // Ein Betreff mit Umlauten muss kodiert sein, sonst weisen Server ihn ab.
  assert.ok(alsText.includes('=?UTF-8?B?'), 'der Betreff ging roh hinaus');

  const grenze = leseGrenze(/Content-Type: (multipart\/signed[^\r\n]*)/.exec(alsText)?.[1]);
  assert.ok(grenze, 'keine Grenze in der Kopfzeile');

  const zurueck = schneideSigniertenTeil(roh, grenze!);
  assert.ok(zurueck, 'der unterschriebene Teil liess sich nicht herausloesen');

  const befund = await pruefeAbgetrennteSignatur(
    zurueck!,
    signatur,
    [alsBund(anna)],
    'anna@firma.de',
  );
  assert.equal(befund.vertrauen, 'gueltig', befund.grund ?? '(kein Grund genannt)');
});

await pruefe('eine von uns verschluesselte Nachricht ist wirklich verschluesselt', async () => {
  const geheim = await verschluessle('Das Passwort lautet Kolibri.', [bernd.oeffentlich], {
    armored: anna.geheim,
  });
  const roh = await buildRawMessage(KONTO, {
    to: ['bernd@firma.de'],
    subject: 'Vertraulich',
    pgpGeheimtext: geheim,
  });

  const alsText = roh.toString('utf8');
  assert.ok(alsText.includes('multipart/encrypted'), 'nicht als verschluesselt gebaut');
  assert.ok(alsText.includes('application/pgp-encrypted'));
  assert.ok(alsText.includes('Version: 1'), 'die Kennung fehlt');
  assert.ok(!alsText.includes('Kolibri'), 'der Klartext steht in der Nachricht!');

  // Und der Empfaenger bekommt ihn wieder heraus.
  const anfang = alsText.indexOf('-----BEGIN PGP MESSAGE-----');
  const ende = alsText.indexOf('-----END PGP MESSAGE-----');
  const auf = await entschluessle(
    alsText.slice(anfang, ende + '-----END PGP MESSAGE-----'.length),
    [{ armored: bernd.geheim, kennwort: 'geheim123' }],
  );
  assert.equal(auf.text, 'Das Passwort lautet Kolibri.');
});

await pruefe('eine gewoehnliche Nachricht bleibt gewoehnlich', async () => {
  const roh = await buildRawMessage(KONTO, {
    to: ['bernd@firma.de'],
    subject: 'Ohne Schutz',
    text: 'Guten Tag.',
  });
  const alsText = roh.toString('utf8');
  assert.ok(!alsText.includes('multipart/signed'));
  assert.ok(!alsText.includes('multipart/encrypted'));
  assert.ok(alsText.includes('Guten Tag.'));
});

await pruefe('der unterschriebene Teil traegt quoted-printable, nicht 8bit', async () => {
  // Der Fehler, an dem die erste Probe ueber echte Server scheiterte: mit 8bit darf ein
  // Mailserver den Teil unterwegs umkodieren, und danach stimmt die Unterschrift nicht
  // mehr. "Signed digest did not match" - bei einer voellig einwandfreien Nachricht.
  const gebaut = baueSigniertenTeil('Grüße aus Köln – äöüß');
  assert.ok(gebaut.includes('Content-Transfer-Encoding: quoted-printable'), gebaut.slice(0, 120));
  assert.ok(!gebaut.includes('8bit'));
  // Es bleibt nichts jenseits von ASCII uebrig - damit gibt es nichts mehr umzukodieren.
  // eslint-disable-next-line no-control-regex
  assert.ok(!/[^\x00-\x7F]/.test(gebaut), 'es stehen noch Zeichen jenseits von ASCII darin');
});

await pruefe('quoted-printable bricht lange Zeilen weich um', async () => {
  const lang = 'Wort '.repeat(40);
  for (const zeile of alsQuotedPrintable(lang).split('\r\n')) {
    assert.ok(zeile.length <= 76, `zu lang: ${zeile.length}`);
  }
});

await pruefe('ein Leerzeichen am Zeilenende wird kodiert', async () => {
  // Sonst faellt es unterwegs weg - und mit ihm die Gueltigkeit der Unterschrift.
  assert.ok(alsQuotedPrintable('Hallo \nWelt').includes('=20'));
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
