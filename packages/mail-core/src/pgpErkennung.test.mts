import assert from 'node:assert/strict';
import {
  beurteileSignatur,
  erkenneInlineSchutz,
  erkenneMimeSchutz,
  leseGrenze,
  passtZumAbsender,
  schneideSigniertenTeil,
} from './pgpErkennung.js';

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

console.log('\nPGP/MIME in der Nachrichtenstruktur erkennen:');

/** So sieht eine mit Thunderbird/Enigmail unterschriebene Nachricht aus. */
const SIGNIERT = {
  type: 'multipart/signed',
  parameters: { protocol: 'application/pgp-signature', micalg: 'pgp-sha256' },
  childNodes: [
    { part: '1', type: 'text/plain' },
    { part: '2', type: 'application/pgp-signature' },
  ],
};

pruefe('eine unterschriebene Nachricht wird erkannt', () => {
  const e = erkenneMimeSchutz(SIGNIERT);
  assert.equal(e.art, 'mime-signiert');
  if (e.art === 'mime-signiert') {
    assert.equal(e.inhaltTeil, '1');
    assert.equal(e.signaturTeil, '2');
    assert.equal(e.mikalg, 'pgp-sha256');
  }
});

pruefe('eine verschluesselte Nachricht wird erkannt', () => {
  const e = erkenneMimeSchutz({
    type: 'multipart/encrypted',
    parameters: { protocol: 'application/pgp-encrypted' },
    childNodes: [
      { part: '1', type: 'application/pgp-encrypted' },
      { part: '2', type: 'application/octet-stream' },
    ],
  });
  assert.equal(e.art, 'mime-verschluesselt');
  if (e.art === 'mime-verschluesselt') assert.equal(e.geheimTeil, '2');
});

pruefe('eine gewoehnliche Nachricht ist nicht geschuetzt', () => {
  assert.equal(erkenneMimeSchutz({ type: 'text/plain' }).art, 'keine');
  assert.equal(
    erkenneMimeSchutz({
      type: 'multipart/alternative',
      childNodes: [
        { part: '1', type: 'text/plain' },
        { part: '2', type: 'text/html' },
      ],
    }).art,
    'keine',
  );
});

pruefe('multipart/signed ohne Unterschriftsteil zaehlt nicht', () => {
  // Sonst gaebe eine Nachricht mit S/MIME oder einem beliebigen zweiten Teil ein
  // Schloss aus, das sich nie pruefen liesse.
  assert.equal(
    erkenneMimeSchutz({
      type: 'multipart/signed',
      childNodes: [
        { part: '1', type: 'text/plain' },
        { part: '2', type: 'application/pkcs7-signature' },
      ],
    }).art,
    'keine',
  );
});

pruefe('mehr als zwei Teile zaehlen nicht', () => {
  assert.equal(
    erkenneMimeSchutz({
      type: 'multipart/signed',
      childNodes: [
        { part: '1', type: 'text/plain' },
        { part: '2', type: 'application/pgp-signature' },
        { part: '3', type: 'application/pdf' },
      ],
    }).art,
    'keine',
  );
});

pruefe('ein unterschriebener Teil tief in der Nachricht zaehlt nicht', () => {
  // Eine weitergeleitete unterschriebene Nachricht schuetzt nicht die aeussere - sie
  // als unterschrieben auszuweisen waere irrefuehrend.
  assert.equal(
    erkenneMimeSchutz({
      type: 'multipart/mixed',
      childNodes: [{ part: '1', type: 'text/plain' }, SIGNIERT],
    }).art,
    'keine',
  );
});

pruefe('nichts ergibt nichts', () => {
  assert.equal(erkenneMimeSchutz(undefined).art, 'keine');
  assert.equal(erkenneMimeSchutz({}).art, 'keine');
});

console.log('\nInline-PGP im Text erkennen:');

pruefe('ein verschluesselter Block wird erkannt', () => {
  const text = '-----BEGIN PGP MESSAGE-----\n\nhQIMA...\n-----END PGP MESSAGE-----';
  assert.equal(erkenneInlineSchutz(text).art, 'inline-verschluesselt');
});

pruefe('ein unterschriebener Block ueber den ganzen Text', () => {
  const text = [
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    'Guten Tag.',
    '-----BEGIN PGP SIGNATURE-----',
    'iQEz...',
    '-----END PGP SIGNATURE-----',
  ].join('\n');
  const e = erkenneInlineSchutz(text);
  assert.equal(e.art, 'inline-signiert');
  if (e.art === 'inline-signiert') assert.equal(e.vollstaendig, true);
});

pruefe('Text VOR dem Block macht die Unterschrift unvollstaendig', () => {
  // Der klassische Trick gegen Inline-PGP: der Angreifer setzt beliebigen Text davor,
  // ohne die Unterschrift zu beruehren. Sie gilt dann nicht fuer das, was man sieht.
  const text = [
    'Bitte ueberweisen Sie auf das neue Konto DE99...',
    '',
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    'Guten Tag.',
    '-----BEGIN PGP SIGNATURE-----',
    'iQEz...',
    '-----END PGP SIGNATURE-----',
  ].join('\n');
  const e = erkenneInlineSchutz(text);
  assert.equal(e.art, 'inline-signiert');
  if (e.art === 'inline-signiert') {
    assert.equal(e.vollstaendig, false, 'der vorangestellte Text wurde uebersehen');
  }
});

pruefe('Text NACH dem Block ebenso', () => {
  const text = [
    '-----BEGIN PGP SIGNED MESSAGE-----',
    'Hash: SHA256',
    '',
    'Guten Tag.',
    '-----BEGIN PGP SIGNATURE-----',
    'iQEz...',
    '-----END PGP SIGNATURE-----',
    '',
    'PS: Und noch etwas, das niemand unterschrieben hat.',
  ].join('\n');
  const e = erkenneInlineSchutz(text);
  if (e.art === 'inline-signiert') assert.equal(e.vollstaendig, false);
  else assert.fail('nicht als unterschrieben erkannt');
});

pruefe('Leerraum drumherum stoert nicht', () => {
  const text =
    '\n\n  \n-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA256\n\nHallo\n' +
    '-----BEGIN PGP SIGNATURE-----\nx\n-----END PGP SIGNATURE-----\n\n  \n';
  const e = erkenneInlineSchutz(text);
  if (e.art === 'inline-signiert') assert.equal(e.vollstaendig, true);
  else assert.fail('nicht erkannt');
});

pruefe('ein abgeschnittener Block zaehlt nicht', () => {
  assert.equal(erkenneInlineSchutz('-----BEGIN PGP MESSAGE-----\nhQIMA...').art, 'keine');
  assert.equal(
    erkenneInlineSchutz('-----BEGIN PGP SIGNED MESSAGE-----\n\nHallo').art,
    'keine',
  );
});

pruefe('gewoehnlicher Text ist nicht geschuetzt', () => {
  assert.equal(erkenneInlineSchutz('Guten Tag, anbei die Zahlen.').art, 'keine');
  assert.equal(erkenneInlineSchutz(undefined).art, 'keine');
  assert.equal(erkenneInlineSchutz('').art, 'keine');
});

console.log('\nGehoert der Schluessel zum Absender?');

pruefe('dieselbe Adresse passt', () => {
  assert.equal(passtZumAbsender('anna@firma.de', ['anna@firma.de']), true);
});

pruefe('Gross- und Kleinschreibung spielt keine Rolle', () => {
  assert.equal(passtZumAbsender('Anna@Firma.DE', ['anna@firma.de']), true);
});

pruefe('eine andere Adresse passt nicht', () => {
  // Der entscheidende Fall: eine gueltige Unterschrift eines fremden Schluessels.
  assert.equal(passtZumAbsender('anna@firma.de', ['angreifer@woanders.de']), false);
});

pruefe('eine aehnliche Adresse passt nicht', () => {
  assert.equal(passtZumAbsender('anna@firma.de', ['anna@firma.de.example.com']), false);
  assert.equal(passtZumAbsender('anna@firma.de', ['anna@firma.com']), false);
});

pruefe('ein Schluessel mit mehreren Adressen passt, wenn eine stimmt', () => {
  assert.equal(passtZumAbsender('privat@anna.de', ['anna@firma.de', 'privat@anna.de']), true);
});

pruefe('ohne Absender passt gar nichts', () => {
  assert.equal(passtZumAbsender(undefined, ['anna@firma.de']), false);
  assert.equal(passtZumAbsender('', ['anna@firma.de']), false);
  assert.equal(passtZumAbsender('anna@firma.de', []), false);
});

console.log('\nWas darf man dem Ergebnis entnehmen?');

pruefe('gueltig und zum Absender passend', () => {
  assert.equal(
    beurteileSignatur({
      stimmt: true,
      schluesselBekannt: true,
      absender: 'anna@firma.de',
      schluesselAdressen: ['anna@firma.de'],
    }),
    'gueltig',
  );
});

pruefe('gueltig, aber ein fremder Schluessel - das ist NICHT dasselbe', () => {
  // Eine mathematisch gueltige Unterschrift sagt nur, dass der Besitzer eines
  // bestimmten Schluessels sie geleistet hat. Wem er gehoert, ist eine andere Frage.
  assert.equal(
    beurteileSignatur({
      stimmt: true,
      schluesselBekannt: true,
      absender: 'anna@firma.de',
      schluesselAdressen: ['angreifer@woanders.de'],
    }),
    'gueltig-fremde-adresse',
  );
});

pruefe('ohne Schluessel laesst sich nichts sagen', () => {
  assert.equal(
    beurteileSignatur({ stimmt: false, schluesselBekannt: false, absender: 'a@b.de' }),
    'schluessel-fehlt',
  );
});

pruefe('eine falsche Unterschrift ist keine Kleinigkeit', () => {
  assert.equal(
    beurteileSignatur({
      stimmt: false,
      schluesselBekannt: true,
      absender: 'anna@firma.de',
      schluesselAdressen: ['anna@firma.de'],
    }),
    'ungueltig',
  );
});

pruefe('ein abgelaufener Schluessel wird als solcher gemeldet', () => {
  assert.equal(
    beurteileSignatur({
      stimmt: true,
      schluesselBekannt: true,
      schluesselAbgelaufen: true,
      absender: 'anna@firma.de',
      schluesselAdressen: ['anna@firma.de'],
    }),
    'schluessel-abgelaufen',
  );
});

pruefe('ein zurueckgezogener Schluessel ebenso', () => {
  assert.equal(
    beurteileSignatur({
      stimmt: true,
      schluesselBekannt: true,
      schluesselZurueckgezogen: true,
      absender: 'anna@firma.de',
      schluesselAdressen: ['anna@firma.de'],
    }),
    'schluessel-abgelaufen',
  );
});

pruefe('eine falsche Unterschrift bleibt falsch, auch bei passender Adresse', () => {
  // Die Reihenfolge der Pruefungen zaehlt: "stimmt nicht" wiegt schwerer als alles andere.
  assert.equal(
    beurteileSignatur({
      stimmt: false,
      schluesselBekannt: true,
      schluesselAbgelaufen: true,
      absender: 'anna@firma.de',
      schluesselAdressen: ['anna@firma.de'],
    }),
    'ungueltig',
  );
});

console.log('\nDen unterschriebenen Teil Byte fuer Byte herausschneiden:');

/** Eine Nachricht, wie Thunderbird sie unterschrieben verschickt. */
const GRENZE = '------------aBcDeF123';
// Bewusst OHNE abschliessendes CRLF: das letzte Zeilenende vor einer Grenze gehoert
// nach RFC 2046 zur Grenze und ist damit nicht mit unterschrieben.
const SIGNIERTER_TEIL =
  'Content-Type: text/plain; charset=utf-8\r\n' +
  'Content-Transfer-Encoding: quoted-printable\r\n' +
  '\r\n' +
  'Guten Tag,\r\n' +
  '\r\n' +
  'anbei die Zahlen.';
const ROH = Buffer.from(
  `Content-Type: multipart/signed; boundary="${GRENZE}";\r\n` +
    ' protocol="application/pgp-signature"; micalg=pgp-sha256\r\n' +
    'Subject: Zahlen\r\n' +
    '\r\n' +
    'Dies ist eine mehrteilige Nachricht.\r\n' +
    `--${GRENZE}\r\n` +
    SIGNIERTER_TEIL +
    `\r\n--${GRENZE}\r\n` +
    'Content-Type: application/pgp-signature\r\n' +
    '\r\n' +
    '-----BEGIN PGP SIGNATURE-----\r\n...\r\n-----END PGP SIGNATURE-----\r\n' +
    `--${GRENZE}--\r\n`,
  'utf8',
);

pruefe('der Teil kommt samt seiner Kopfzeilen heraus', () => {
  const teil = schneideSigniertenTeil(ROH, GRENZE);
  assert.ok(teil, 'nichts herausgeschnitten');
  assert.equal(teil!.toString('utf8'), SIGNIERTER_TEIL);
});

pruefe('das CRLF vor der naechsten Grenze gehoert NICHT dazu', () => {
  // Der klassische Fehler: nimmt man es mit, schlaegt jede Pruefung fehl - und die
  // Warnung erschiene bei voellig einwandfreien Nachrichten.
  // Nach RFC 2046 gehoert das Zeilenende vor der Grenze zu dieser, nicht zum Inhalt.
  const teil = schneideSigniertenTeil(ROH, GRENZE)!.toString('utf8');
  assert.ok(teil.endsWith('anbei die Zahlen.'), JSON.stringify(teil.slice(-24)));
  assert.ok(!teil.endsWith('\r\n'), 'ein CRLF zu viel mitgenommen');
});

pruefe('die Zeilenenden bleiben CRLF', () => {
  const teil = schneideSigniertenTeil(ROH, GRENZE)!.toString('utf8');
  assert.equal(teil.split('\n').length, teil.split('\r\n').length, 'ein CRLF wurde zu LF');
});

pruefe('der Vorspann vor der ersten Grenze bleibt draussen', () => {
  const teil = schneideSigniertenTeil(ROH, GRENZE)!.toString('utf8');
  assert.ok(!teil.includes('mehrteilige Nachricht'));
  assert.ok(!teil.includes('Subject:'));
});

pruefe('die Unterschrift selbst bleibt draussen', () => {
  const teil = schneideSigniertenTeil(ROH, GRENZE)!.toString('utf8');
  assert.ok(!teil.includes('BEGIN PGP SIGNATURE'));
});

pruefe('eine unbekannte Grenze ergibt nichts', () => {
  assert.equal(schneideSigniertenTeil(ROH, 'gibtesnicht'), null);
  assert.equal(schneideSigniertenTeil(ROH, ''), null);
});

pruefe('eine abgeschnittene Nachricht ergibt nichts', () => {
  const halb = Buffer.from(`Content-Type: multipart/signed\r\n\r\n--${GRENZE}\r\nHallo`, 'utf8');
  assert.equal(schneideSigniertenTeil(halb, GRENZE), null);
});

pruefe('die Grenze wird aus der Kopfzeile gelesen', () => {
  assert.equal(leseGrenze('multipart/signed; boundary="abc123"; protocol=x'), 'abc123');
  assert.equal(leseGrenze('multipart/signed; boundary=abc123'), 'abc123');
  assert.equal(leseGrenze('multipart/signed; BOUNDARY="abc123"'), 'abc123');
  assert.equal(leseGrenze('text/plain'), undefined);
  assert.equal(leseGrenze(undefined), undefined);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
