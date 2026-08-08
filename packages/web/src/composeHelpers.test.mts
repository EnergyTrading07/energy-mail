import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildFollowUpSubject,
  buildForward,
  buildReply,
  hasMultipleRecipients,
  withSignature,
} from './composeHelpers.js';

// Zum Aufraeumen des Zitats wird ein Dokument gebraucht - unter Node liefert es JSDOM.
const DOK = new JSDOM('<body></body>').window.document;

const ME = 'ich@gmx.de';
const addr = (address: string, name?: string) => ({ address, name });

function nachricht(over: Record<string, unknown> = {}) {
  return {
    uid: 1,
    subject: 'Projektplan',
    from: [addr('anna@firma.de', 'Anna')],
    to: [addr(ME), addr('bob@firma.de', 'Bob')],
    cc: [addr('chris@firma.de')],
    date: new Date('2026-07-01T10:00:00Z'),
    flags: [],
    seen: true,
    hasAttachments: false,
    attachments: [],
    text: 'Hallo zusammen,\nbitte um Rückmeldung.',
    messageId: '<original@firma.de>',
    references: ['<aelter@firma.de>'],
    ...over,
  } as never;
}

let ok = 0;
let gesamt = 0;
const pruefe = (name: string, fn: () => void) => {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}: ${(err as Error).message}`);
  }
};

console.log('Antworten:');

pruefe('geht an den Absender, nicht an einen selbst', () => {
  const r = buildReply(nachricht(), ME, false, DOK);
  assert.deepEqual(r.to, ['anna@firma.de']);
  assert.equal(r.cc, undefined);
});

pruefe('Allen antworten nimmt weitere Empfänger auf, ohne einen selbst', () => {
  const r = buildReply(nachricht(), ME, true, DOK);
  assert.deepEqual(r.to, ['anna@firma.de', 'bob@firma.de']);
  assert.deepEqual(r.cc, ['chris@firma.de']);
  assert.ok(!JSON.stringify(r).includes(ME), 'eigene Adresse darf nicht vorkommen');
});

pruefe('Reply-To hat Vorrang vor dem Absender', () => {
  const r = buildReply(nachricht({ replyTo: [addr('verteiler@firma.de')] }), ME, false, DOK);
  assert.deepEqual(r.to, ['verteiler@firma.de']);
});

pruefe('Verlaufszuordnung: In-Reply-To und References', () => {
  const r = buildReply(nachricht(), ME, false, DOK);
  assert.equal(r.inReplyTo, '<original@firma.de>');
  assert.deepEqual(r.references, ['<aelter@firma.de>', '<original@firma.de>']);
});

pruefe('ohne Message-ID keine erfundenen Kopfzeilen', () => {
  const r = buildReply(nachricht({ messageId: undefined }), ME, false, DOK);
  assert.equal(r.inReplyTo, undefined);
  assert.equal(r.references, undefined);
});

pruefe('Betreff bekommt genau ein Re:', () => {
  assert.equal(buildReply(nachricht(), ME, false, DOK).subject, 'Re: Projektplan');
  assert.equal(buildReply(nachricht({ subject: 'Re: Projektplan' }), ME, false, DOK).subject, 'Re: Projektplan');
  assert.equal(buildReply(nachricht({ subject: 'AW: Projektplan' }), ME, false, DOK).subject, 'AW: Projektplan');
});

pruefe('Doppelte Adressen werden entfernt', () => {
  const r = buildReply(
    nachricht({ from: [addr('anna@firma.de')], to: [addr('ANNA@firma.de'), addr(ME)], cc: [] }),
    ME,
    true,
    DOK,
  );
  assert.deepEqual(r.to, ['anna@firma.de']);
});

pruefe('Originaltext wird als Zitat eingebettet', () => {
  const r = buildReply(nachricht(), ME, false, DOK);
  assert.ok(r.html?.includes('<blockquote'), 'Zitatblock fehlt');
  assert.ok(r.html?.includes('Anna &lt;anna@firma.de&gt;'), 'Absender fehlt im Zitatkopf');
  assert.ok(r.html?.includes('bitte um Rückmeldung'), 'Originaltext fehlt');
});

pruefe('formatiertes Original bleibt formatiert erhalten', () => {
  const r = buildReply(nachricht({ html: '<p>Hallo <strong>Welt</strong></p>' }), ME, false, DOK);
  assert.ok(r.html?.includes('<strong>Welt</strong>'), 'Formatierung ging verloren');
});

pruefe('Sonderzeichen im Namen werden maskiert', () => {
  const r = buildReply(nachricht({ from: [addr('x@y.de', '<script>böse</script>')] }), ME, false, DOK);
  assert.ok(!r.html?.includes('<script>'), 'ungefiltertes Markup im Zitatkopf');
  assert.ok(r.html?.includes('&lt;script&gt;'), 'Maskierung fehlt');
});

console.log('\nWeiterleiten:');

pruefe('Betreff bekommt Fwd:', () => {
  assert.equal(buildForward(nachricht(), DOK).subject, 'Fwd: Projektplan');
  assert.equal(buildForward(nachricht({ subject: 'Fwd: Projektplan' }), DOK).subject, 'Fwd: Projektplan');
});

pruefe('keine Empfänger vorbelegt', () => {
  const f = buildForward(nachricht(), DOK);
  assert.equal(f.to, undefined);
});

pruefe('beginnt einen neuen Verlauf (keine References)', () => {
  const f = buildForward(nachricht(), DOK);
  assert.equal(f.inReplyTo, undefined);
  assert.equal(f.references, undefined);
});

pruefe('Kopfzeilen der Originalnachricht stehen im Inhalt', () => {
  const h = buildForward(nachricht(), DOK).html ?? '';
  assert.ok(h.includes('Von: Anna &lt;anna@firma.de&gt;'));
  assert.ok(h.includes('Betreff: Projektplan'));
  assert.ok(h.includes('Kopie: chris@firma.de'));
});

console.log('\nSignatur:');

pruefe('steht oberhalb des Zitats, nicht darunter', () => {
  const antwort = buildReply(nachricht(), ME, false, DOK).html ?? '';
  const mitSig = withSignature(antwort, 'Viele Grüße<br>Hendrik');
  assert.ok(mitSig.indexOf('Hendrik') < mitSig.indexOf('<blockquote'), 'Signatur steht unter dem Zitat');
});

pruefe('ohne Signatur bleibt der Inhalt unverändert', () => {
  const antwort = buildReply(nachricht(), ME, false, DOK).html ?? '';
  assert.equal(withSignature(antwort, undefined), antwort);
  assert.equal(withSignature(antwort, '   '), antwort);
});

pruefe('Trennzeichen nach Konvention', () => {
  assert.ok(withSignature('', 'Hendrik').includes('--<br>'), 'Trennzeichen fehlt');
});

console.log('\n"Allen antworten" anbieten:');

pruefe('ja bei mehreren Beteiligten', () => {
  assert.equal(hasMultipleRecipients(nachricht(), ME), true);
});

pruefe('nein bei reiner Eins-zu-eins-Nachricht', () => {
  const m = nachricht({ from: [addr('anna@firma.de')], to: [addr(ME)], cc: [] });
  assert.equal(hasMultipleRecipients(m, ME), false);
});

pruefe('Nachfassen bekommt "Nachfrage:" statt "Re:"', () => {
  // Man antwortet nicht auf sich selbst - es ist eine Erinnerung an die eigene Nachricht.
  assert.equal(buildFollowUpSubject('Angebot'), 'Nachfrage: Angebot');
  assert.equal(buildFollowUpSubject('Re: Angebot'), 'Nachfrage: Angebot');
  assert.equal(buildFollowUpSubject('AW: Angebot'), 'Nachfrage: Angebot');
});

pruefe('ohne Betreff steht dort kein Platzhalter', () => {
  // "(kein Betreff)" ist Anzeige, kein Inhalt - so ginge es sonst wortwoertlich hinaus.
  assert.equal(buildFollowUpSubject('(kein Betreff)'), 'Nachfrage');
  assert.equal(buildFollowUpSubject(''), 'Nachfrage');
  assert.equal(buildFollowUpSubject('Re: '), 'Nachfrage');
});

pruefe('Nachfassen staffelt sich nicht', () => {
  assert.equal(buildFollowUpSubject('Nachfrage: Angebot'), 'Nachfrage: Angebot');
  // Auch mehrfach vorangestellte Kuerzel fallen weg, sonst stuende am Ende
  // "Nachfrage: Re: AW: Angebot" in der Betreffzeile.
  assert.equal(buildFollowUpSubject('AW: Re: AW: Angebot'), 'Nachfrage: Angebot');
});


console.log('\nDer zitierte Verlauf:');

/** Eine Werbenachricht, wie sie wirklich ankommt. */
const WERBUNG = nachricht({
  html:
    '<html><head><meta charset="utf-8"><title>Angebot</title>' +
    '<style>body{background:#f0f}.knopf{display:none}</style></head><body>' +
    '<table width="600"><tr><td style="font-family:Comic Sans">' +
    '<b>Grosses Angebot</b>' +
    '<img src="https://werbung.example/p.gif" width="1" height="1">' +
    '<img src="https://werbung.example/bild.jpg">' +
    '<a href="https://werbung.example/klick">hier klicken</a>' +
    '</td></tr></table></body></html>',
});

pruefe('kein Bild von einem fremden Server geht mit hinaus', () => {
  // Gemessen: beim Lesen hielt der Schutz elf Inhalte zurueck, beim Antworten gingen
  // genau diese elf hinaus - darunter ein Zaehlpixel. Der Absender erfuhr dadurch, dass
  // die Nachricht offen war.
  const r = buildReply(WERBUNG, ME, false, DOK);
  assert.ok(!/<img/i.test(r.html ?? ''), 'ein Bild ist im Zitat geblieben');
  assert.ok(!/werbung\.example\/p\.gif/.test(r.html ?? ''), 'das Zaehlpixel ist noch da');
});

pruefe('dasselbe beim Weiterleiten', () => {
  const r = buildForward(WERBUNG, DOK);
  assert.ok(!/<img/i.test(r.html ?? ''), 'ein Bild ist im weitergeleiteten Text geblieben');
});

pruefe('fremde Gestaltungsangaben wirken nicht im Fenster', () => {
  // Ein <style> aus der Nachricht gilt im ganzen Dokument, nicht nur im Zitat - damit
  // liessen sich Knoepfe verdecken.
  const r = buildReply(WERBUNG, ME, false, DOK);
  assert.ok(!/<style/i.test(r.html ?? ''), 'ein style-Block ist geblieben');
  assert.ok(!/<meta/i.test(r.html ?? ''), 'Kopfangaben sind geblieben');
  assert.ok(!/<title/i.test(r.html ?? ''), 'ein title ist geblieben');
  assert.ok(!/Comic Sans/.test(r.html ?? ''), 'eine fremde Schriftart ist geblieben');
});

pruefe('der Inhalt bleibt trotzdem erhalten', () => {
  // Aufraeumen heisst nicht wegwerfen: der Text im Zitat ist das, worauf geantwortet wird.
  const r = buildReply(WERBUNG, ME, false, DOK);
  assert.ok(/<b>Grosses Angebot<\/b>/.test(r.html ?? ''), 'der Fettdruck ging verloren');
  assert.ok(/hier klicken/.test(r.html ?? ''), 'der Verweistext ging verloren');
  assert.ok(/blockquote/.test(r.html ?? ''), 'das Zitat selbst fehlt');
});

pruefe('das Aufräumen fasst das laufende Dokument nicht an', () => {
  /*
   * Der zweite Anlauf war nötig, weil der erste nicht half: das Zitat war sauber, und
   * die elf Anfragen gingen trotzdem hinaus. Grund war innerHTML an einem Element des
   * laufenden Dokuments - der Browser holt die Bilder dann sofort, auch wenn das
   * Element nirgends hängt. Gemessen an den Netzanfragen, nicht am HTML.
   *
   * Hier steht dafür der beobachtbare Teil: im übergebenen Dokument darf nichts
   * angelegt werden. Wer das ändert, holt den Fehler zurück.
   */
  let angelegt = 0;
  const echt = DOK.createElement.bind(DOK);
  DOK.createElement = ((...a: unknown[]) => {
    angelegt++;
    return echt(...(a as [string]));
  }) as typeof DOK.createElement;
  try {
    buildReply(WERBUNG, ME, false, DOK);
  } finally {
    DOK.createElement = echt;
  }
  assert.equal(angelegt, 0, `${angelegt} Element(e) im laufenden Dokument angelegt`);
});

pruefe('eine reine Textnachricht bleibt unangetastet', () => {
  const r = buildReply(nachricht({ html: undefined, text: 'Hallo\nZweite Zeile' }), ME, false, DOK);
  assert.ok(/Zweite Zeile/.test(r.html ?? ''));
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
process.exit(ok === gesamt ? 0 : 1);
