import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MessageSummary, Regel } from '@energy-mail/mail-core';
import { setDataDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';

// Vor dem ersten Zugriff umlenken, sonst landen Testregeln im echten Benutzerordner.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-rules-test-'));
setDataDir(tempDir);
// Die Pruefungen rufen die Speicher unmittelbar auf - ohne Anfrage, die den
// Nutzerkontext mitbraechte. Dieser Prozess arbeitet durchgehend als ein Nutzer.
betreteNutzerFuerProzess('pruefung');


const { passt, istBrauchbar, regelSpeichern, regelnFuer, regelLoeschen, regelnVerwerfen } =
  await import('./rules.js');

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

function mail(teil: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid: 1,
    subject: 'Ihr Newsletter',
    from: [{ name: 'Pinterest', address: 'recommendations@discover.pinterest.com' }],
    to: [{ address: 'hendrik@example.de' }],
    cc: [],
    date: new Date(),
    flags: [],
    seen: false,
    hasAttachments: false,
    ...teil,
  };
}

function regel(teil: Partial<Regel> = {}): Regel {
  return {
    id: 'r1',
    name: 'Test',
    aktiv: true,
    bedingungen: {},
    aktionen: { alsGelesen: true },
    ...teil,
  };
}

console.log('\nBrauchbarkeit einer Regel:');

pruefe('ohne Bedingung ist eine Regel unbrauchbar', () => {
  // Sonst tráfe sie auf jede Nachricht zu und würde das Postfach leerräumen.
  assert.equal(istBrauchbar({ bedingungen: {}, aktionen: { alsGelesen: true } }), false);
});

pruefe('ohne Aktion ebenso', () => {
  assert.equal(istBrauchbar({ bedingungen: { von: 'x' }, aktionen: {} }), false);
});

pruefe('mit beidem ist sie brauchbar', () => {
  assert.equal(
    istBrauchbar({ bedingungen: { von: 'x' }, aktionen: { inDenPapierkorb: true } }),
    true,
  );
});

console.log('\nTreffer:');

pruefe('Absender trifft über die Adresse', () => {
  assert.equal(passt(regel({ bedingungen: { von: 'pinterest.com' } }), mail()), true);
});

pruefe('Absender trifft auch über den angezeigten Namen', () => {
  assert.equal(passt(regel({ bedingungen: { von: 'pinterest' } }), mail()), true);
});

pruefe('Groß- und Kleinschreibung spielt keine Rolle', () => {
  assert.equal(passt(regel({ bedingungen: { von: 'PINTEREST' } }), mail()), true);
});

pruefe('anderer Absender trifft nicht', () => {
  assert.equal(passt(regel({ bedingungen: { von: 'linkedin' } }), mail()), false);
});

pruefe('Betreff als Teilzeichenkette', () => {
  assert.equal(passt(regel({ bedingungen: { betreff: 'newsletter' } }), mail()), true);
  assert.equal(passt(regel({ bedingungen: { betreff: 'Rechnung' } }), mail()), false);
});

pruefe('Empfänger trifft auch über Kopie', () => {
  const m = mail({ to: [{ address: 'a@x.de' }], cc: [{ address: 'verteiler@firma.de' }] });
  assert.equal(passt(regel({ bedingungen: { an: 'verteiler@firma.de' } }), m), true);
});

pruefe('Verteilerkennung', () => {
  const m = mail({ listId: '<news.pinterest.com>' });
  assert.equal(passt(regel({ bedingungen: { listId: 'news.pinterest' } }), m), true);
  assert.equal(passt(regel({ bedingungen: { listId: 'linkedin' } }), m), false);
});

pruefe('"nur Rundmail" verlangt die Abmelde-Kopfzeile', () => {
  const rundmail = mail({ listUnsubscribe: '<mailto:x@y.de>' });
  const persoenlich = mail({ listUnsubscribe: undefined });
  assert.equal(passt(regel({ bedingungen: { nurRundmail: true } }), rundmail), true);
  assert.equal(
    passt(regel({ bedingungen: { nurRundmail: true } }), persoenlich),
    false,
    'eine persönliche Nachricht darf so nie erfasst werden',
  );
});

pruefe('mehrere Bedingungen müssen ALLE zutreffen', () => {
  const r = regel({ bedingungen: { von: 'pinterest', betreff: 'Rechnung' } });
  assert.equal(passt(r, mail()), false, 'Absender passt, Betreff nicht - also kein Treffer');

  const r2 = regel({ bedingungen: { von: 'pinterest', betreff: 'newsletter' } });
  assert.equal(passt(r2, mail()), true);
});

console.log('\nAblage:');

pruefe('Speichern, Lesen, Ersetzen und Löschen', () => {
  const gespeichert = regelSpeichern('konto1', {
    name: 'Pinterest wegsortieren',
    aktiv: true,
    bedingungen: { von: 'pinterest' },
    aktionen: { alsGelesen: true },
  });
  assert.ok(gespeichert.id, 'eine Kennung wird vergeben');
  assert.equal(regelnFuer('konto1').length, 1);

  regelSpeichern('konto1', { ...gespeichert, name: 'Neuer Name' });
  assert.equal(regelnFuer('konto1').length, 1, 'gleiche Kennung ersetzt, statt anzuhängen');
  assert.equal(regelnFuer('konto1')[0].name, 'Neuer Name');

  assert.equal(regelLoeschen('konto1', gespeichert.id), true);
  assert.equal(regelnFuer('konto1').length, 0);
  assert.equal(regelLoeschen('konto1', gespeichert.id), false, 'zweimal löschen meldet false');
});

pruefe('Regeln sind je Konto getrennt', () => {
  regelSpeichern('kontoA', {
    name: 'A',
    aktiv: true,
    bedingungen: { von: 'a' },
    aktionen: { alsGelesen: true },
  });
  regelSpeichern('kontoB', {
    name: 'B',
    aktiv: true,
    bedingungen: { von: 'b' },
    aktionen: { alsGelesen: true },
  });
  assert.equal(regelnFuer('kontoA').length, 1);
  assert.equal(regelnFuer('kontoB').length, 1);

  regelnVerwerfen('kontoA');
  assert.equal(regelnFuer('kontoA').length, 0);
  assert.equal(regelnFuer('kontoB').length, 1, 'fremde Konten bleiben unberührt');
});

fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
