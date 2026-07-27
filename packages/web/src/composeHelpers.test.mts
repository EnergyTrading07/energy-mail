import assert from 'node:assert/strict';
import { buildForward, buildReply, hasMultipleRecipients, withSignature } from './composeHelpers.js';

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
  const r = buildReply(nachricht(), ME, false);
  assert.deepEqual(r.to, ['anna@firma.de']);
  assert.equal(r.cc, undefined);
});

pruefe('Allen antworten nimmt weitere Empfänger auf, ohne einen selbst', () => {
  const r = buildReply(nachricht(), ME, true);
  assert.deepEqual(r.to, ['anna@firma.de', 'bob@firma.de']);
  assert.deepEqual(r.cc, ['chris@firma.de']);
  assert.ok(!JSON.stringify(r).includes(ME), 'eigene Adresse darf nicht vorkommen');
});

pruefe('Reply-To hat Vorrang vor dem Absender', () => {
  const r = buildReply(nachricht({ replyTo: [addr('verteiler@firma.de')] }), ME, false);
  assert.deepEqual(r.to, ['verteiler@firma.de']);
});

pruefe('Verlaufszuordnung: In-Reply-To und References', () => {
  const r = buildReply(nachricht(), ME, false);
  assert.equal(r.inReplyTo, '<original@firma.de>');
  assert.deepEqual(r.references, ['<aelter@firma.de>', '<original@firma.de>']);
});

pruefe('ohne Message-ID keine erfundenen Kopfzeilen', () => {
  const r = buildReply(nachricht({ messageId: undefined }), ME, false);
  assert.equal(r.inReplyTo, undefined);
  assert.equal(r.references, undefined);
});

pruefe('Betreff bekommt genau ein Re:', () => {
  assert.equal(buildReply(nachricht(), ME, false).subject, 'Re: Projektplan');
  assert.equal(buildReply(nachricht({ subject: 'Re: Projektplan' }), ME, false).subject, 'Re: Projektplan');
  assert.equal(buildReply(nachricht({ subject: 'AW: Projektplan' }), ME, false).subject, 'AW: Projektplan');
});

pruefe('Doppelte Adressen werden entfernt', () => {
  const r = buildReply(
    nachricht({ from: [addr('anna@firma.de')], to: [addr('ANNA@firma.de'), addr(ME)], cc: [] }),
    ME,
    true,
  );
  assert.deepEqual(r.to, ['anna@firma.de']);
});

pruefe('Originaltext wird als Zitat eingebettet', () => {
  const r = buildReply(nachricht(), ME, false);
  assert.ok(r.html?.includes('<blockquote'), 'Zitatblock fehlt');
  assert.ok(r.html?.includes('Anna &lt;anna@firma.de&gt;'), 'Absender fehlt im Zitatkopf');
  assert.ok(r.html?.includes('bitte um Rückmeldung'), 'Originaltext fehlt');
});

pruefe('formatiertes Original bleibt formatiert erhalten', () => {
  const r = buildReply(nachricht({ html: '<p>Hallo <strong>Welt</strong></p>' }), ME, false);
  assert.ok(r.html?.includes('<strong>Welt</strong>'), 'Formatierung ging verloren');
});

pruefe('Sonderzeichen im Namen werden maskiert', () => {
  const r = buildReply(nachricht({ from: [addr('x@y.de', '<script>böse</script>')] }), ME, false);
  assert.ok(!r.html?.includes('<script>'), 'ungefiltertes Markup im Zitatkopf');
  assert.ok(r.html?.includes('&lt;script&gt;'), 'Maskierung fehlt');
});

console.log('\nWeiterleiten:');

pruefe('Betreff bekommt Fwd:', () => {
  assert.equal(buildForward(nachricht()).subject, 'Fwd: Projektplan');
  assert.equal(buildForward(nachricht({ subject: 'Fwd: Projektplan' })).subject, 'Fwd: Projektplan');
});

pruefe('keine Empfänger vorbelegt', () => {
  const f = buildForward(nachricht());
  assert.equal(f.to, undefined);
});

pruefe('beginnt einen neuen Verlauf (keine References)', () => {
  const f = buildForward(nachricht());
  assert.equal(f.inReplyTo, undefined);
  assert.equal(f.references, undefined);
});

pruefe('Kopfzeilen der Originalnachricht stehen im Inhalt', () => {
  const h = buildForward(nachricht()).html ?? '';
  assert.ok(h.includes('Von: Anna &lt;anna@firma.de&gt;'));
  assert.ok(h.includes('Betreff: Projektplan'));
  assert.ok(h.includes('Kopie: chris@firma.de'));
});

console.log('\nSignatur:');

pruefe('steht oberhalb des Zitats, nicht darunter', () => {
  const antwort = buildReply(nachricht(), ME, false).html ?? '';
  const mitSig = withSignature(antwort, 'Viele Grüße<br>Hendrik');
  assert.ok(mitSig.indexOf('Hendrik') < mitSig.indexOf('<blockquote'), 'Signatur steht unter dem Zitat');
});

pruefe('ohne Signatur bleibt der Inhalt unverändert', () => {
  const antwort = buildReply(nachricht(), ME, false).html ?? '';
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

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
process.exit(ok === gesamt ? 0 : 1);
