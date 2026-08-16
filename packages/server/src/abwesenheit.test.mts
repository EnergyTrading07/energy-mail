import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountConfig, MessageSummary } from '@energy-mail/mail-core';
import { getNutzerDir, setDataDir } from './paths.js';
import { setKeyProvider } from './secretCrypto.js';
import { alsNutzer } from './nutzer/kontext.js';

/**
 * Die Abwesenheitsnotiz - und vor allem: wann sie den Mund haelt.
 *
 * Das Verschicken ist der leichte Teil. Der schwere ist zu wissen, wann nicht. Eine
 * Notiz, die zu viel antwortet, ist kein Schoenheitsfehler:
 *
 *  - Sie antwortet einem Zustellbericht, der Bericht kommt zurueck, sie antwortet wieder.
 *    Zwei Postfaecher laufen ueber, und zwar ueber Nacht.
 *  - Sie antwortet einem Verteiler, und vierhundert Fremde erfahren, dass jemand, den sie
 *    nicht kennen, bis zum 14. im Urlaub ist.
 *  - Sie antwortet einer anderen Abwesenheitsnotiz, und die beiden schreiben sich das
 *    Wochenende ueber.
 *
 * Jeder dieser Faelle steht hier als eigene Pruefung. Sie sind der Grund, warum
 * pruefeAntwort() einen GRUND zurueckgibt und nicht ein Ja/Nein: Was nicht beantwortet
 * wurde, muss sich benennen lassen - sonst sucht man bei einer ausgebliebenen Antwort im
 * Nebel, und bei einer zu viel gesendeten erst recht.
 */

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`  ok   ${name}`);
      ok++;
    })
    .catch((err: Error) => {
      console.log(`  FEHL ${name}\n       ${err.message}`);
    });
}

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-abwesenheit-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 5) });

/**
 * Alles, was eine Datei anfasst, laeuft ausdruecklich als ein Nutzer.
 *
 * Ohne Kontext wirft jeder Speicherzugriff - siehe nutzer/kontext.ts, und das ist dort
 * Absicht: Eine vergessene Stelle soll laut scheitern, statt stillschweigend in fremden
 * Daten zu landen. Die Abwesenheitsnotiz laeuft an der Postfachueberwachung und damit
 * ausserhalb jeder Anfrage - sie muss den Kontext also selbst betreten, und diese Zeile
 * haelt fest, dass die Pruefung denselben Weg geht wie der Betrieb.
 */
const alsAnna = <T,>(fn: () => T): T => alsNutzer('anna', fn);

const {
  abwesenheitFuer,
  merkeAntwort,
  pruefeAntwort,
  setzeAbwesenheit,
  vergissGeantwortete,
  zuletztGeantwortet,
} = await import('./abwesenheit.js');

const KONTO = {
  id: 'k1',
  email: 'anna@beispiel.de',
  displayName: 'Anna Muster',
  identitaeten: [{ email: 'info@beispiel.de', displayName: 'Beispiel GmbH' }],
  imapHost: 'x',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'x',
  smtpPort: 465,
  smtpSecure: true,
  auth: { type: 'password', password: 'x' },
} as unknown as AccountConfig;

const NOTIZ = {
  aktiv: true,
  text: 'Ich bin bis zum 14. nicht da.',
  wiederholungTage: 4,
};

/** Eine gewoehnliche Nachricht von einem Menschen an mich. */
function post(zusatz: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid: 1,
    subject: 'Kurze Frage',
    from: [{ address: 'kunde@fremd.de', name: 'Ein Kunde' }],
    to: [{ address: 'anna@beispiel.de' }],
    cc: [],
    date: new Date(),
    flags: [],
    seen: false,
    hasAttachments: false,
    messageId: '<abc@fremd.de>',
    rueckweg: 'kunde@fremd.de',
    ...zusatz,
  } as MessageSummary;
}

const umstaende = (nachricht: MessageSummary, mehr: Record<string, unknown> = {}) => ({
  account: KONTO,
  notiz: NOTIZ,
  nachricht,
  ordner: 'INBOX',
  ...mehr,
});

console.log('\nDer gewoehnliche Fall:');

await pruefe('einem Menschen, der mir schreibt, wird geantwortet', () => {
  const befund = pruefeAntwort(umstaende(post()));
  assert.equal(befund.antworten, true, `Abgelehnt: ${JSON.stringify(befund)}`);
  assert.equal(befund.antworten && befund.an, 'kunde@fremd.de');
});

await pruefe('geantwortet wird von der Adresse, an die geschrieben wurde', () => {
  /*
   * Ging die Post an die Zweitadresse, geht die Notiz auch von dieser hinaus. Alles
   * andere waere eine ungefragte Auskunft ueber die eigenen Aliase - wer "info@" schreibt,
   * soll nicht erfahren, dass dahinter "anna@" sitzt.
   */
  const befund = pruefeAntwort(umstaende(post({ to: [{ address: 'info@beispiel.de' }] })));
  assert.equal(befund.antworten && befund.absender, 'info@beispiel.de');
});

await pruefe('geantwortet wird an den Rueckweg, nicht an den Kopf', () => {
  // RFC 3834: Massgeblich ist der Umschlag. Der Kopf sagt, wer unterschrieben hat.
  const befund = pruefeAntwort(
    umstaende(
      post({ from: [{ address: 'chef@fremd.de' }], rueckweg: 'sekretariat@fremd.de' }),
    ),
  );
  assert.equal(befund.antworten && befund.an, 'sekretariat@fremd.de');
});

console.log('\nWorauf nie geantwortet wird:');

const abgelehnt = (nachricht: MessageSummary, grund: string, mehr = {}) => {
  const befund = pruefeAntwort(umstaende(nachricht, mehr));
  assert.equal(befund.antworten, false, 'Es wurde geantwortet.');
  assert.equal(!befund.antworten && befund.grund, grund);
};

await pruefe('einem Zustellbericht - der Fall, der Postfaecher ueberlaufen laesst', () => {
  /*
   * "Return-Path: <>" heisst "hierauf wird nicht geantwortet". Wer es doch tut, bekommt
   * seine Antwort als unzustellbar zurueck, antwortet darauf, und so fort. Davor warnt
   * RFC 3834 an erster Stelle, und es ist der Fehler, der Abwesenheitsnotizen ihren
   * schlechten Ruf eingetragen hat.
   */
  abgelehnt(post({ rueckweg: '' }), 'zustellbericht');
});

await pruefe('einer anderen Abwesenheitsnotiz', () => {
  // Sonst schreiben sich zwei Notizen das Wochenende ueber. Erkannt wird sie an
  // "Auto-Submitted", derselben Zeile, die unsere eigene traegt.
  abgelehnt(post({ maschinell: true }), 'maschinell');
});

await pruefe('einem Verteiler - weder ueber List-Id noch ueber List-Unsubscribe', () => {
  abgelehnt(post({ listId: '<liste.beispiel.de>' }), 'verteiler');
  abgelehnt(post({ listUnsubscribe: '<https://x/y>' }), 'verteiler');
});

await pruefe('einem Automaten, an seiner Adresse erkannt', () => {
  for (const adresse of [
    'mailer-daemon@fremd.de',
    'postmaster@fremd.de',
    'noreply@fremd.de',
    'no-reply@fremd.de',
    'donotreply@fremd.de',
    'bounces@fremd.de',
  ]) {
    const befund = pruefeAntwort(
      umstaende(post({ from: [{ address: adresse }], rueckweg: adresse })),
    );
    assert.equal(befund.antworten, false, `${adresse} bekam eine Antwort.`);
    assert.equal(!befund.antworten && befund.grund, 'automat', adresse);
  }
});

await pruefe('wenn der Absender darum bittet (X-Auto-Response-Suppress)', () => {
  abgelehnt(post({ keineAutoAntwort: true }), 'nicht-erwuenscht');
});

await pruefe('auf die eigene Post - auch von der Zweitadresse', () => {
  abgelehnt(post({ from: [{ address: 'anna@beispiel.de' }], rueckweg: 'anna@beispiel.de' }), 'eigene-adresse');
  abgelehnt(post({ from: [{ address: 'info@beispiel.de' }], rueckweg: 'info@beispiel.de' }), 'eigene-adresse');
});

await pruefe('auf Post, die gar nicht an mich ging - Blindkopie oder Weiterleitung', () => {
  /*
   * Steht keine meiner Adressen in An oder Kopie, kam die Nachricht ueber einen Umweg.
   * Eine Antwort waere doppelt verkehrt: Der Absender hat mir nicht geschrieben, und
   * meine Notiz verriete ihm, wo seine Post ueberall landet.
   */
  abgelehnt(post({ to: [{ address: 'jemand@ganz-anders.de' }], cc: [] }), 'nicht-an-mich');
});

await pruefe('auf nichts ausserhalb des Posteingangs', () => {
  /*
   * Nicht aus dem Spamordner - eine Antwort dorthin bestaetigt dem Versender, dass die
   * Adresse gelesen wird. Und nicht aus einem Ordner, den der Nutzer gerade offen hat:
   * ueberwacht werden auch angesehene Ordner, und in einem Archiv liegt Post von 2023.
   */
  for (const ordner of ['Junk', 'Spam', 'Archiv', 'INBOX/Unterordner']) {
    const befund = pruefeAntwort(umstaende(post(), { ordner }));
    assert.equal(befund.antworten, false, `Aus "${ordner}" ging eine Notiz hinaus.`);
  }
  // Gross- und Kleinschreibung des Posteingangs ist von Anbieter zu Anbieter verschieden.
  assert.equal(pruefeAntwort(umstaende(post(), { ordner: 'Inbox' })).antworten, true);
});

await pruefe('ohne Absenderadresse', () => {
  abgelehnt(post({ from: [], rueckweg: undefined }), 'kein-absender');
});

console.log('\nDie Wiederholungsbremse:');

await pruefe('derselbe Absender bekommt nicht zweimal dieselbe Notiz', () => {
  // Wer in einem Vorgang fuenfmal schreibt, bekaeme sonst fuenfmal denselben Zettel -
  // genau das Verhalten, wegen dessen Abwesenheitsnotizen einen schlechten Ruf haben.
  const vorgestern = Date.now() - 2 * 24 * 60 * 60 * 1000;
  abgelehnt(post(), 'schon-geantwortet', { zuletzt: vorgestern });
});

await pruefe('nach Ablauf der Frist aber schon', () => {
  const vorFuenfTagen = Date.now() - 5 * 24 * 60 * 60 * 1000;
  const befund = pruefeAntwort(umstaende(post(), { zuletzt: vorFuenfTagen }));
  assert.equal(befund.antworten, true);
});

await pruefe('mit Frist 0 wird jedes Mal geantwortet', () => {
  const befund = pruefeAntwort({
    ...umstaende(post(), { zuletzt: Date.now() - 1000 }),
    notiz: { ...NOTIZ, wiederholungTage: 0 },
  });
  assert.equal(befund.antworten, true);
});

console.log('\nZeitraum und Schalter:');

await pruefe('ausgeschaltet antwortet sie nicht', () => {
  const befund = pruefeAntwort({ ...umstaende(post()), notiz: { ...NOTIZ, aktiv: false } });
  assert.equal(!befund.antworten && befund.grund, 'aus');
});

await pruefe('ohne Text antwortet sie nicht - eine leere Notiz ist keine', () => {
  const befund = pruefeAntwort({ ...umstaende(post()), notiz: { ...NOTIZ, text: '   ' } });
  assert.equal(!befund.antworten && befund.grund, 'ohne-text');
});

await pruefe('vor dem Beginn und nach dem Ende nicht', () => {
  const notiz = { ...NOTIZ, von: '2026-08-01', bis: '2026-08-14' };
  const am = (tag: string) =>
    pruefeAntwort({ ...umstaende(post()), notiz, jetzt: new Date(`${tag}T09:00:00Z`) });
  assert.equal(am('2026-07-31').antworten, false, 'Sie lief zu frueh.');
  assert.equal(am('2026-08-01').antworten, true, 'Der erste Tag zaehlt mit.');
  assert.equal(am('2026-08-14').antworten, true, 'Der letzte Tag zaehlt mit.');
  assert.equal(am('2026-08-15').antworten, false, 'Sie lief zu lang.');
});

await pruefe('der letzte Tag zaehlt bis Mitternacht', () => {
  /*
   * Wer "bis 14.08." eintraegt, meint den 14. mit. Ein Vergleich gegen Mitternacht des
   * 14. schaltete die Notiz an genau dem Tag ab, an dem der Mensch noch weg ist.
   */
  const notiz = { ...NOTIZ, bis: '2026-08-14' };
  const spaet = pruefeAntwort({
    ...umstaende(post()),
    notiz,
    jetzt: new Date('2026-08-14T23:59:00Z'),
  });
  assert.equal(spaet.antworten, true);
});

console.log('\nNur an Bekannte:');

await pruefe('ein Unbekannter bekommt dann keine', () => {
  abgelehnt(post(), 'unbekannt', {
    notiz: { ...NOTIZ, nurBekannte: true },
    istBekannt: () => false,
  });
});

await pruefe('ein Bekannter schon', () => {
  const befund = pruefeAntwort(
    umstaende(post(), {
      notiz: { ...NOTIZ, nurBekannte: true },
      istBekannt: (a: string) => a === 'kunde@fremd.de',
    }),
  );
  assert.equal(befund.antworten, true);
});

console.log('\nWas gespeichert wird:');

await pruefe('die Einstellung ueberlebt einen Neustart', () =>
  alsAnna(() => {
    setzeAbwesenheit('k1', { aktiv: true, text: 'Bis zum 14. weg.', bis: '2026-08-14' });
    const zurueck = abwesenheitFuer('k1');
    assert.equal(zurueck.aktiv, true);
    assert.equal(zurueck.text, 'Bis zum 14. weg.');
    assert.equal(zurueck.bis, '2026-08-14');
    // Und die Vorgabe fuer die Wiederholung steht auch dann da, wenn sie niemand gesetzt hat.
    assert.equal(zurueck.wiederholungTage, 4);
  }),
);

await pruefe('wem geantwortet wurde, steht auf Platte und nicht im Speicher', () =>
  alsAnna(() => {
    /*
     * Der Unterschied zwischen einer Bremse, die greift, und einer, die es bis zum
     * naechsten Neustart tut. Ein Neustart kommt bei jedem Einspielen einer Fassung - und
     * ein Kollege, der jeden Tag schreibt, bekaeme sonst jeden Tag dieselbe Notiz.
     */
    vergissGeantwortete('k1');
    merkeAntwort('k1', 'Kunde@Fremd.DE', 1_770_000_000_000);
    assert.ok(
      fs.existsSync(path.join(getNutzerDir(), 'abwesenheitGesendet.json')),
      'Es wurde nichts geschrieben.',
    );
    // Und die Schreibweise der Adresse darf keine Rolle spielen.
    assert.equal(zuletztGeantwortet('k1', 'kunde@fremd.de'), 1_770_000_000_000);
    assert.equal(zuletztGeantwortet('k1', 'KUNDE@FREMD.DE'), 1_770_000_000_000);
  }),
);

await pruefe('ein anderes Konto teilt sich die Merkliste nicht', () =>
  alsAnna(() => {
    assert.equal(zuletztGeantwortet('k2', 'kunde@fremd.de'), undefined);
  }),
);

await pruefe('und ein anderer Nutzer erst recht nicht', () =>
  alsNutzer('bernd', () => {
    /*
     * Die Merkliste liegt im Nutzerordner. Waere sie prozessweit, verriete sie einem
     * zweiten Nutzer, mit wem der erste korrespondiert - und genau diese Sorte
     * Vermischung ist der Grund, warum jeder Speicherzugriff hier den Kontext fragt.
     */
    assert.equal(zuletztGeantwortet('k1', 'kunde@fremd.de'), undefined);
    assert.equal(abwesenheitFuer('k1').aktiv, false);
  }),
);

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
