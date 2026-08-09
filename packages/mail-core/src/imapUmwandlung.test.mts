import assert from 'node:assert/strict';
import {
  attachmentFilename,
  baueSuchbedingung,
  collectAttachments,
  decodedSize,
  describeImapError,
  findeTextteile,
} from './imapClient.js';

/**
 * Die Umwandlungen in imapClient.ts, die kein Netz brauchen.
 *
 * 1428 Zeilen, und geprüft war davon nichts - alles hing an Handproben gegen die
 * echten Konten. Was hier steht, sind die vier Stellen, an denen aus dem, was der
 * Server sagt, das wird, was der Nutzer sieht: seine Anhänge, seine Suchtreffer, seine
 * Fehlermeldung.
 *
 * Was weiterhin fehlt, ist der Verkehr mit einem echten Postfachserver. Dafür bräuchte
 * es einen Testserver (Greenmail oder Dovecot in einem Container), und ohne Docker ist
 * der auf diesem Rechner nicht zu haben. Das steht so im Bericht und bleibt offen.
 */

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

console.log('\nAnhänge aus der Nachrichtenstruktur:');

pruefe('ein schlichter Anhang wird gefunden', () => {
  const struktur = {
    childNodes: [
      { part: '1', type: 'text/plain', size: 120 },
      {
        part: '2',
        type: 'application/pdf',
        size: 40_000,
        disposition: 'attachment',
        dispositionParameters: { filename: 'Rechnung.pdf' },
      },
    ],
  };
  const gefunden = collectAttachments(struktur);
  assert.equal(gefunden.length, 1);
  assert.equal(gefunden[0]!.filename, 'Rechnung.pdf');
  assert.equal(gefunden[0]!.partId, '2');
  assert.equal(gefunden[0]!.contentType, 'application/pdf');
});

pruefe('der Textteil zählt nicht als Anhang', () => {
  // Sonst hinge an jeder Nachricht eine Büroklammer.
  const nurText = { childNodes: [{ part: '1', type: 'text/plain', size: 120 }] };
  assert.deepEqual(collectAttachments(nurText), []);
});

pruefe('verschachtelte Teile werden mitgenommen', () => {
  /*
   * So sieht eine Nachricht mit Text, HTML und zwei Anhängen wirklich aus:
   * multipart/mixed → [multipart/alternative → [text, html], pdf, jpg].
   * Ohne den Abstieg fände man nur, was oben liegt.
   */
  const struktur = {
    childNodes: [
      {
        childNodes: [
          { part: '1.1', type: 'text/plain', size: 100 },
          { part: '1.2', type: 'text/html', size: 300 },
        ],
      },
      {
        part: '2',
        type: 'application/pdf',
        size: 1000,
        disposition: 'attachment',
        dispositionParameters: { filename: 'a.pdf' },
      },
      {
        part: '3',
        type: 'image/jpeg',
        size: 2000,
        disposition: 'attachment',
        dispositionParameters: { filename: 'b.jpg' },
      },
    ],
  };
  assert.deepEqual(
    collectAttachments(struktur).map((a) => a.filename),
    ['a.pdf', 'b.jpg'],
  );
});

pruefe('ein eingebettetes Bild zählt mit', () => {
  // Für den Empfänger ist es genauso eine Datei, und andere Mailprogramme zeigen es an.
  const struktur = {
    childNodes: [
      { part: '1', type: 'text/html', size: 500 },
      {
        part: '2',
        type: 'image/png',
        size: 8000,
        disposition: 'inline',
        dispositionParameters: { filename: 'logo.png' },
        id: '<bild42@firma.de>',
      },
    ],
  };
  const gefunden = collectAttachments(struktur);
  assert.equal(gefunden.length, 1);
  // Ohne spitze Klammern - im HTML steht sie so.
  assert.equal(gefunden[0]!.contentId, 'bild42@firma.de');
});

pruefe('ein Dateiname aus den Typparametern wird auch genommen', () => {
  // Ältere Programme setzen ihn dorthin statt in die disposition.
  const knoten = { parameters: { name: 'alt.txt' } };
  assert.equal(attachmentFilename(knoten as never), 'alt.txt');
});

pruefe('nichts Ungültiges bringt es zum Absturz', () => {
  // Was vom Server kommt, muss nicht sein, was man erwartet.
  assert.deepEqual(collectAttachments(null), []);
  assert.deepEqual(collectAttachments(undefined), []);
  assert.deepEqual(collectAttachments('kein Knoten'), []);
  assert.deepEqual(collectAttachments({}), []);
});

console.log('\nDie angezeigte Größe:');

pruefe('base64 wird zurückgerechnet', () => {
  /*
   * Der Server nennt die Größe der Kodierung, nicht die der Datei. Wer eine 3-MB-Datei
   * anhängt, sähe sonst 4 MB - und wunderte sich, warum die Grenze seines Anbieters
   * schon überschritten ist.
   */
  assert.equal(decodedSize({ size: 4000, encoding: 'base64' } as never), 3000);
  assert.equal(decodedSize({ size: 4000, encoding: 'BASE64' } as never), 3000);
});

pruefe('alles andere bleibt, wie es ist', () => {
  assert.equal(decodedSize({ size: 4000, encoding: 'quoted-printable' } as never), 4000);
  assert.equal(decodedSize({ size: 4000 } as never), 4000);
  assert.equal(decodedSize({} as never), 0);
});

console.log('\nDie Suchbedingung:');

/** Nur die Felder, die gesetzt wurden - der Rest ist undefined. */
const suche = (teil: Record<string, unknown>) => teil as never;

pruefe('ein Suchwort trifft Betreff, Absender, Empfänger und Text', () => {
  const b = baueSuchbedingung(suche({ text: 'Rechnung' }), false);
  assert.deepEqual(b.or, [
    { subject: 'Rechnung' },
    { from: 'Rechnung' },
    { to: 'Rechnung' },
    { body: 'Rechnung' },
  ]);
});

pruefe('"bis" schließt den genannten Tag ein', () => {
  /*
   * IMAP schneidet vor dem angegebenen Datum ab. Ohne den Tag Zuschlag fehlte in
   * "bis 31.07." der 31. Juli selbst - und wer eine Rechnung von genau diesem Tag
   * sucht, findet sie nicht.
   */
  const b = baueSuchbedingung(suche({ before: '2026-07-31' }), false);
  assert.equal((b.before as Date).toISOString().slice(0, 10), '2026-08-01');
});

pruefe('"seit" bleibt auf dem Tag', () => {
  const b = baueSuchbedingung(suche({ since: '2026-07-01' }), false);
  assert.equal((b.since as Date).toISOString().slice(0, 10), '2026-07-01');
});

pruefe('ohne jede Angabe ist alles gemeint', () => {
  // Eine leere Bedingung fände bei ImapFlow nichts - dann käme kein Treffer zurück,
  // obwohl der Ordner voll ist.
  assert.deepEqual(baueSuchbedingung(suche({}), false), { all: true });
});

pruefe('nur Ungelesene und ein Etikett', () => {
  const b = baueSuchbedingung(suche({ unreadOnly: true, etikett: '$label1' }), false);
  assert.equal(b.seen, false);
  assert.equal(b.keyword, '$label1');
  assert.equal(b.all, undefined, 'die Bedingung wurde faelschlich als "alles" gewertet');
});

pruefe('bei Gmail wandern Anhang und Einordnung in eine gmraw-Abfrage', () => {
  const b = baueSuchbedingung(suche({ withAttachment: true, category: 'promotions' }), true);
  assert.equal(b.gmraw, 'has:attachment category:promotions');
});

pruefe('ohne Gmail gibt es bei der Anhangssuche einen klaren Abbruch', () => {
  /*
   * IMAP kennt kein Kriterium für Anhänge. Die naheliegende Annäherung über
   * "Content-Type: multipart/mixed" liefert bei GMX null Treffer, obwohl die
   * Nachrichten den Typ nachweislich tragen. Ein Filter, der still nichts findet, ist
   * schlechter als keiner.
   */
  assert.throws(
    () => baueSuchbedingung(suche({ withAttachment: true }), false),
    /nicht nach Anhängen suchen/,
  );
});

pruefe('mehrere Angaben stehen nebeneinander', () => {
  const b = baueSuchbedingung(suche({ from: 'anna@', subject: 'Angebot', unreadOnly: true }), false);
  assert.equal(b.from, 'anna@');
  assert.equal(b.subject, 'Angebot');
  assert.equal(b.seen, false);
});

console.log('\nWas bei einem Fehler dasteht:');

pruefe('eine abgelehnte Anmeldung sagt das auch', () => {
  assert.match(
    describeImapError({ authenticationFailed: true }),
    /Anmeldung abgelehnt|Passwort/,
  );
});

pruefe('der Wortlaut des Servers hat Vorrang', () => {
  // Er ist genauer als alles, was sich hier erraten liesse.
  assert.equal(
    describeImapError({ authenticationFailed: true, responseText: 'Zu viele Versuche' }),
    'Zu viele Versuche',
  );
});

pruefe('Systemcodes werden übersetzt', () => {
  // "ENOTFOUND" sagt einem Nutzer nichts.
  assert.match(describeImapError({ code: 'ENOTFOUND' }), /nicht gefunden/);
  assert.match(describeImapError({ code: 'ECONNREFUSED' }), /Port/);
  assert.match(describeImapError({ code: 'ETIMEDOUT' }), /Zeitüberschreitung/);
  assert.match(describeImapError({ code: 'ECONNRESET' }), /Zeitüberschreitung/);
});

pruefe('für alles Unbekannte bleibt die eigene Meldung', () => {
  assert.equal(describeImapError({ message: 'Etwas Seltsames' }), 'Etwas Seltsames');
  assert.equal(describeImapError({}), 'Unbekannter Verbindungsfehler');
});

/*
 * Welche Teile den Nachrichtentext ausmachen.
 *
 * Daran haengt, dass beim Oeffnen einer Nachricht nur noch der Text geholt wird und
 * nicht die vollstaendige Nachricht samt Anhaengen. Faende diese Auswahl das Falsche,
 * saehe der Nutzer eine leere Nachricht - oder den Inhalt einer weitergeleiteten Mail
 * als vermeintlichen Text.
 */
console.log('\nWelche Teile den Text tragen:');

/** Baut einen Strukturknoten, wie ihn imapflow liefert. */
const teil = (part: string, type: string, extra: Record<string, unknown> = {}) => ({
  part,
  type,
  ...extra,
});

pruefe('eine Nachricht aus Text und HTML', () => {
  const struktur = {
    type: 'multipart/alternative',
    childNodes: [teil('1', 'text/plain'), teil('2', 'text/html')],
  };
  assert.deepEqual(findeTextteile(struktur), { text: '1', html: '2' });
});

pruefe('eine Textdatei im Anhang ist KEIN Nachrichtentext', () => {
  /*
   * Der Fall, den man leicht falsch macht: ein Anhang kann text/plain sein. Wuerde er
   * als Koerper genommen, staende der Inhalt einer beigelegten Datei da, wo die
   * Nachricht stehen sollte.
   */
  const struktur = {
    type: 'multipart/mixed',
    childNodes: [
      teil('1', 'text/plain'),
      teil('2', 'text/plain', { dispositionParameters: { filename: 'notizen.txt' } }),
      teil('3', 'text/plain', { disposition: 'attachment' }),
    ],
  };
  assert.deepEqual(findeTextteile(struktur), { text: '1' });
});

pruefe('eine weitergeleitete Nachricht steuert ihren Text nicht bei', () => {
  // message/rfc822 ist ein Anhang. Sein Text gehoert nicht in den Koerper dieser Mail.
  const struktur = {
    type: 'multipart/mixed',
    childNodes: [
      teil('1', 'text/plain'),
      {
        part: '2',
        type: 'message/rfc822',
        childNodes: [teil('2.1', 'text/plain'), teil('2.2', 'text/html')],
      },
    ],
  };
  assert.deepEqual(findeTextteile(struktur), { text: '1' });
});

pruefe('eine Einladung wird gefunden', () => {
  const struktur = {
    type: 'multipart/mixed',
    childNodes: [teil('1', 'text/plain'), teil('2', 'text/calendar')],
  };
  assert.deepEqual(findeTextteile(struktur), { text: '1', einladung: '2' });
});

pruefe('bei mehreren gleichartigen gewinnt der erste', () => {
  // Die Reihenfolge, in der der Absender sie angeboten hat.
  const struktur = {
    type: 'multipart/mixed',
    childNodes: [teil('1', 'text/html'), teil('2', 'text/html')],
  };
  assert.deepEqual(findeTextteile(struktur), { html: '1' });
});

pruefe('tief verschachtelt wird trotzdem gefunden', () => {
  const struktur = {
    type: 'multipart/mixed',
    childNodes: [
      {
        type: 'multipart/related',
        childNodes: [
          { type: 'multipart/alternative', childNodes: [teil('1.1.1', 'text/plain'), teil('1.1.2', 'text/html')] },
          teil('1.2', 'image/png', { dispositionParameters: { filename: 'logo.png' } }),
        ],
      },
      teil('2', 'application/pdf', { dispositionParameters: { filename: 'rechnung.pdf' } }),
    ],
  };
  assert.deepEqual(findeTextteile(struktur), { text: '1.1.1', html: '1.1.2' });
});

pruefe('ohne Struktur oder ohne Textteil kommt nichts heraus', () => {
  // Dann greift der Rueckfall in getMessage - die Nachricht wird ganz geladen.
  assert.deepEqual(findeTextteile(undefined), {});
  assert.deepEqual(findeTextteile(null), {});
  assert.deepEqual(findeTextteile({ type: 'text/plain' }), {}, 'ohne part-Kennung nicht abrufbar');
  assert.deepEqual(
    findeTextteile({
      type: 'multipart/mixed',
      childNodes: [teil('1', 'application/pdf', { dispositionParameters: { filename: 'x.pdf' } })],
    }),
    {},
  );
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
