import assert from 'node:assert/strict';
import {
  STANDARD_ETIKETTEN,
  etikettenAusFlags,
  istEtikett,
  nimmtEtikettenAn,
  pruefeEtikettName,
  schluesselFuer,
} from './etiketten.js';

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

console.log('\nNimmt der Server eigene Schluesselwoerter an?');

pruefe('mit "\\*" in PERMANENTFLAGS: ja', () => {
  assert.equal(nimmtEtikettenAn(['\\Seen', '\\Flagged', '\\Deleted', '\\*']), true);
});

pruefe('ohne "\\*": nein - das STORE gelingt, das Etikett ist trotzdem weg', () => {
  assert.equal(nimmtEtikettenAn(['\\Seen', '\\Flagged', '\\Deleted', '\\Draft']), false);
});

pruefe('ein Server, der gar nichts nennt, gilt als "kann es nicht"', () => {
  // Lieber ehrlich absagen als still verlieren.
  assert.equal(nimmtEtikettenAn(undefined), false);
  assert.equal(nimmtEtikettenAn([]), false);
});

pruefe('vorhandene Schluesselwoerter allein genuegen nicht', () => {
  // Manche Server nennen die bereits benutzten, nehmen aber keine neuen an.
  assert.equal(nimmtEtikettenAn(['\\Seen', '$label1', '$label2']), false);
});

console.log('\nWas ist ein Etikett und was nicht?');

pruefe('Systemflags sind keine', () => {
  for (const flag of ['\\Seen', '\\Flagged', '\\Deleted', '\\Draft', '\\Answered', '\\Recent']) {
    assert.equal(istEtikett(flag), false, flag);
  }
});

pruefe('Vorgangsvermerke anderer Programme sind keine', () => {
  // Sie stehen fuer etwas, das geschehen ist, nicht fuer eine Einordnung.
  for (const flag of ['$Forwarded', '$MDNSent', 'Junk', '$NotJunk', '$MailFlagBit0']) {
    assert.equal(istEtikett(flag), false, flag);
  }
});

pruefe('Gross- und Kleinschreibung spielt dabei keine Rolle', () => {
  // IMAP-Schluesselwoerter sind nicht schreibungsempfindlich, und Server geben sie in
  // ganz verschiedenen Schreibweisen zurueck.
  assert.equal(istEtikett('$FORWARDED'), false);
  assert.equal(istEtikett('$forwarded'), false);
});

pruefe('unsere und fremde Etiketten sind welche', () => {
  for (const flag of ['$label1', 'steuer', 'Wichtig_2026', '$MeinTelefon']) {
    assert.equal(istEtikett(flag), true, flag);
  }
});

console.log('\nAus einem Namen ein Schluesselwort machen:');

pruefe('Leerzeichen werden zu Unterstrichen', () => {
  assert.equal(schluesselFuer('Zu erledigen'), 'zu_erledigen');
});

pruefe('Umlaute werden ausgeschrieben', () => {
  // Jenseits von ASCII weisen manche Server die Anfrage rundheraus ab.
  assert.equal(schluesselFuer('Persönlich'), 'persoenlich');
  assert.equal(schluesselFuer('Grüße'), 'gruesse');
  assert.equal(schluesselFuer('Café'), 'cafe');
});

pruefe('was IMAP nicht vertraegt, faellt weg', () => {
  // Klammern, Anfuehrungszeichen und Rueckwaertsschraegstriche zerlegen den Befehl.
  const schluessel = schluesselFuer('Rechnung (2026) "wichtig" \\ 50%');
  assert.match(schluessel, /^[a-z0-9_]+$/, `war: ${schluessel}`);
});

pruefe('beginnt nie mit einer Ziffer', () => {
  // Manche Server deuten das als Nachrichtennummer.
  assert.ok(!/^\d/.test(schluesselFuer('2026 Steuer')));
});

pruefe('ergibt nie eine leere Zeichenkette', () => {
  assert.ok(schluesselFuer('!!!').length > 0);
  assert.ok(schluesselFuer('   ').length > 0);
  assert.ok(schluesselFuer('').length > 0);
});

pruefe('weicht aus, wenn der Schluessel schon vergeben ist', () => {
  assert.equal(schluesselFuer('Steuer', ['steuer']), 'steuer_2');
  assert.equal(schluesselFuer('Steuer', ['steuer', 'steuer_2']), 'steuer_3');
});

pruefe('zwei verschiedene Namen mit gleicher Umschrift kollidieren nicht', () => {
  const erster = schluesselFuer('Grüße');
  const zweiter = schluesselFuer('Gruesse', [erster]);
  assert.notEqual(erster, zweiter);
});

pruefe('sehr lange Namen werden gekuerzt', () => {
  const schluessel = schluesselFuer('a'.repeat(200));
  assert.ok(schluessel.length <= 40, `war ${schluessel.length} Zeichen`);
});

console.log('\nFlags in Etiketten uebersetzen:');

pruefe('bekannte Etiketten bekommen Namen und Farbe', () => {
  const etiketten = etikettenAusFlags(['\\Seen', '$label1'], STANDARD_ETIKETTEN);
  assert.equal(etiketten.length, 1);
  assert.equal(etiketten[0]?.name, 'Wichtig');
  assert.equal(etiketten[0]?.farbe, '#dc2626');
});

pruefe('ein fremdes Schluesselwort wird angezeigt, nicht verschwiegen', () => {
  // Sonst verloere man beim Bearbeiten still, was Thunderbird oder ein Telefon gesetzt hat.
  const etiketten = etikettenAusFlags(['vom_telefon'], STANDARD_ETIKETTEN);
  assert.equal(etiketten.length, 1);
  assert.equal(etiketten[0]?.name, 'vom_telefon');
});

pruefe('das Dollarzeichen faellt aus dem angezeigten Namen', () => {
  assert.equal(etikettenAusFlags(['$Steuer'], [])[0]?.name, 'Steuer');
});

pruefe('Schreibweise des Servers spielt keine Rolle', () => {
  // Dovecot gibt "$Label1" zurueck, andere "$label1".
  assert.equal(etikettenAusFlags(['$Label1'], STANDARD_ETIKETTEN)[0]?.name, 'Wichtig');
});

pruefe('sortiert nach Namen, nicht nach Schluessel', () => {
  const etiketten = etikettenAusFlags(['$label5', '$label2', '$label1'], STANDARD_ETIKETTEN);
  assert.deepEqual(
    etiketten.map((e) => e.name),
    ['Arbeit', 'Später', 'Wichtig'],
  );
});

pruefe('eine Nachricht ohne Etiketten ergibt eine leere Liste', () => {
  assert.deepEqual(etikettenAusFlags(['\\Seen', '\\Flagged'], STANDARD_ETIKETTEN), []);
});

console.log('\nEinen Namen pruefen:');

pruefe('ein leerer Name geht nicht', () => {
  assert.ok(pruefeEtikettName('   ', []));
});

pruefe('derselbe Name zweimal geht nicht', () => {
  const meldung = pruefeEtikettName('wichtig', STANDARD_ETIKETTEN);
  assert.ok(meldung?.includes('gibt es schon'), `war: ${meldung}`);
});

pruefe('beim Umbenennen zaehlt der eigene Name nicht als Doppel', () => {
  assert.equal(pruefeEtikettName('Wichtig', STANDARD_ETIKETTEN, '$label1'), null);
});

pruefe('ein neuer Name geht durch', () => {
  assert.equal(pruefeEtikettName('Steuer 2026', STANDARD_ETIKETTEN), null);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
