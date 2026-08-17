import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AccountConfig, MessageSummary } from '@energy-mail/mail-core';
import { baueLesebestaetigung } from '@energy-mail/mail-core';
import { setDataDir } from './paths.js';
import { setKeyProvider } from './secretCrypto.js';
import { alsNutzer } from './nutzer/kontext.js';

/**
 * Lesebestaetigungen - und wann keine hinausgeht.
 *
 * Eine Lesebestaetigung ist eine Auskunft ueber einen Menschen an einen anderen, und sie
 * geht automatisch hinaus. Drei Arten, wie das schiefgeht, und jede steht hier:
 *
 *  - Sie bestaetigt einem Werbeversender, dass die Adresse gelesen wird. Das ist mehr wert
 *    als ein Klick auf ein Zaehlpixel: hier antwortet ein Programm mit einer echten Mail.
 *  - Sie verraet Arbeitszeiten. Wann etwas angezeigt wurde, sagt, wann jemand am Rechner
 *    sass; ueber Wochen ergibt das ein Bild.
 *  - Sie laesst sich als Waffe benutzen. Eine Nachricht an einen Verteiler, deren
 *    Bestaetigungen an ein fremdes Postfach gehen, macht aus vierhundert Lesern
 *    vierhundert Absender. Deshalb wird bei abweichender Adresse NIE automatisch
 *    bestaetigt - auch dann nicht, wenn der Nutzer "immer" eingestellt hat. Das ist die
 *    eine Stelle, an der seine Einstellung ueberstimmt wird, und sie hat hier eine eigene
 *    Zeile.
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

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-lesebest-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 11) });

const {
  adresseAus,
  entscheidungZu,
  merkeEntscheidung,
  nachrichtenSchluessel,
  pruefeBestaetigung,
  setzeUmgang,
  umgangFuer,
  vergissEntscheidungen,
} = await import('./lesebestaetigung.js');

const KONTO = {
  id: 'k1',
  email: 'anna@beispiel.de',
  displayName: 'Anna Muster',
  identitaeten: [{ email: 'info@beispiel.de' }],
  imapHost: 'x',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'x',
  smtpPort: 465,
  smtpSecure: true,
  auth: { type: 'password', password: 'x' },
} as unknown as AccountConfig;

/** Eine Nachricht, die um eine Bestaetigung bittet - vom selben Absender. */
function post(zusatz: Partial<MessageSummary> = {}): MessageSummary {
  return {
    uid: 7,
    subject: 'Angebot',
    from: [{ address: 'kunde@fremd.de', name: 'Ein Kunde' }],
    to: [{ address: 'anna@beispiel.de' }],
    cc: [],
    date: new Date(),
    flags: [],
    seen: false,
    hasAttachments: false,
    messageId: '<abc@fremd.de>',
    rueckweg: 'kunde@fremd.de',
    bestaetigungAn: 'Ein Kunde <kunde@fremd.de>',
    ...zusatz,
  } as MessageSummary;
}

const frage = (nachricht: MessageSummary, umgang: 'nie' | 'fragen' | 'immer' = 'fragen', erledigt: 'gesendet' | 'abgelehnt' | null = null) =>
  pruefeBestaetigung({ account: KONTO, nachricht, umgang, erledigt });

console.log('\nDie Adresse aus der Kopfzeile:');

await pruefe('spitze Klammern, Name davor, Grossschreibung - alles egal', () => {
  assert.equal(adresseAus('Ein Kunde <Kunde@Fremd.DE>'), 'kunde@fremd.de');
  assert.equal(adresseAus('kunde@fremd.de'), 'kunde@fremd.de');
  assert.equal(adresseAus('  kunde@fremd.de  '), 'kunde@fremd.de');
});

await pruefe('bei mehreren wird die erste genommen', () => {
  // Die Norm sieht dafuer keine Bedeutung vor. Mehrere Bestaetigungen an mehrere Adressen
  // zu schicken waere die schlechtere von zwei Auslegungen.
  assert.equal(adresseAus('a@x.de, b@y.de'), 'a@x.de');
});

await pruefe('Unsinn ergibt nichts - keine halbe Adresse', () => {
  for (const roh of ['', 'kein-at-zeichen', '<>', 'a@b', undefined]) {
    assert.equal(adresseAus(roh), '', String(roh));
  }
});

console.log('\nDer gewoehnliche Fall:');

await pruefe('ohne Anforderung geschieht nichts', () => {
  const b = frage(post({ bestaetigungAn: undefined }));
  assert.equal(b.was, 'nein');
  assert.equal(b.was === 'nein' && b.grund, 'keine-anforderung');
});

await pruefe('mit Anforderung wird gefragt - die Vorgabe', () => {
  const b = frage(post());
  assert.equal(b.was, 'fragen');
  assert.equal(b.was === 'fragen' && b.an, 'kunde@fremd.de');
  assert.equal(b.was === 'fragen' && b.abweichend, false);
});

await pruefe('mit "immer" geht sie ohne Rueckfrage hinaus', () => {
  const b = frage(post(), 'immer');
  assert.equal(b.was, 'senden');
  assert.equal(b.was === 'senden' && b.an, 'kunde@fremd.de');
});

await pruefe('mit "nie" gar nicht', () => {
  const b = frage(post(), 'nie');
  assert.equal(b.was === 'nein' && b.grund, 'aus');
});

console.log('\nDie Waffe: eine abweichende Bestaetigungsadresse');

await pruefe('bei abweichender Adresse wird immer gefragt - auch bei "immer"', () => {
  /*
   * Die wichtigste Pruefung dieser Datei, und die eine Stelle, an der die Einstellung des
   * Nutzers ueberstimmt wird. Eine Nachricht an einen Verteiler, deren Bestaetigungen an
   * ein fremdes Postfach gehen, macht aus vierhundert Lesern vierhundert Absender - und
   * keiner von ihnen hat etwas davon geahnt. RFC 8098 verlangt hier ausdruecklich, dass
   * ein Mensch zustimmt.
   */
  const fremd = post({ bestaetigungAn: 'opfer@ganz-woanders.de' });
  const b = frage(fremd, 'immer');
  assert.equal(b.was, 'fragen', 'Sie ging ohne Rueckfrage hinaus.');
  assert.equal(b.was === 'fragen' && b.abweichend, true);
  assert.equal(b.was === 'fragen' && b.an, 'opfer@ganz-woanders.de');
});

await pruefe('verglichen wird mit dem Rueckweg, nicht nur mit dem Kopf', () => {
  // Der Kopf laesst sich frei beschriften; der Umschlag nicht. Wer nur "From" vergliche,
  // liesse sich mit einem gefaelschten Absender genau um diese Pruefung herumfuehren.
  const b = frage(
    post({ from: [{ address: 'opfer@ganz-woanders.de' }], rueckweg: 'taeter@fremd.de', bestaetigungAn: 'opfer@ganz-woanders.de' }),
    'immer',
  );
  assert.equal(b.was, 'fragen');
  assert.equal(b.was === 'fragen' && b.abweichend, true);
});

console.log('\nWorauf nie bestaetigt wird:');

const nein = (nachricht: MessageSummary, grund: string) => {
  const b = frage(nachricht, 'immer');
  assert.equal(b.was, 'nein', `Es wurde bestaetigt (${JSON.stringify(b)}).`);
  assert.equal(b.was === 'nein' && b.grund, grund);
};

await pruefe('auf Werbung und maschinelle Post', () => {
  // Eine Bestaetigung waere hier mehr wert als ein Zaehlpixel: Ein Programm antwortet mit
  // einer echten Mail von einer echten Adresse.
  nein(post({ maschinell: true }), 'maschinell');
});

await pruefe('auf Verteilerpost', () => {
  nein(post({ listId: '<liste.beispiel.de>' }), 'verteiler');
  nein(post({ listUnsubscribe: '<https://x/y>' }), 'verteiler');
});

await pruefe('auf Zustellberichte', () => {
  nein(post({ rueckweg: '' }), 'zustellbericht');
});

await pruefe('auf die eigene Post - auch an die Zweitadresse', () => {
  nein(post({ bestaetigungAn: 'anna@beispiel.de' }), 'eigene-adresse');
  nein(post({ bestaetigungAn: 'info@beispiel.de' }), 'eigene-adresse');
});

await pruefe('auf eine unbrauchbare Adresse', () => {
  nein(post({ bestaetigungAn: 'das ist keine adresse' }), 'unbrauchbare-adresse');
});

console.log('\nEinmal entschieden ist entschieden:');

await pruefe('nach dem Senden wird nicht noch einmal gefragt', () => {
  const b = frage(post(), 'fragen', 'gesendet');
  assert.equal(b.was === 'nein' && b.grund, 'schon-gesendet');
});

await pruefe('und ein Nein haelt genauso wie ein Ja', () => {
  /*
   * Sonst ist die Frage eine, die bei jedem Oeffnen wiederkehrt - so lange, bis jemand aus
   * Versehen zustimmt. Ein "Nein", das nicht haelt, ist kein Nein.
   */
  const b = frage(post(), 'fragen', 'abgelehnt');
  assert.equal(b.was === 'nein' && b.grund, 'schon-abgelehnt');
});

await pruefe('gemerkt wird an der Message-ID, nicht an der UID', () => {
  // Die UID aendert sich, wenn die Nachricht in einen anderen Ordner wandert - die
  // Message-ID nicht. Sonst kaeme die Frage nach dem Verschieben wieder.
  assert.equal(nachrichtenSchluessel(post(), 'INBOX'), '<abc@fremd.de>');
  assert.equal(nachrichtenSchluessel({ uid: 9 } as MessageSummary, 'Archiv'), 'Archiv:9');
});

console.log('\nWas gespeichert wird:');

const alsAnna = <T,>(fn: () => T): T => alsNutzer('anna', fn);

await pruefe('die Einstellung ueberlebt einen Neustart', () =>
  alsAnna(() => {
    assert.equal(umgangFuer('k1'), 'fragen', 'Die Vorgabe ist nicht "fragen".');
    setzeUmgang('k1', 'immer');
    assert.equal(umgangFuer('k1'), 'immer');
    setzeUmgang('k1', 'nie');
    assert.equal(umgangFuer('k1'), 'nie');
  }),
);

await pruefe('die Entscheidungen auch - und je Nutzer getrennt', () =>
  alsAnna(() => {
    /*
     * Erst raeumen, dann pruefen.
     *
     * Die Entscheidungen stehen in einer Datei je Nutzer und ueberdauern damit jeden
     * vorherigen Fall in dieser Datei. Ohne das Raeumen pruefte dieser Fall womoeglich
     * einen Eintrag, den ein anderer angelegt hat - und bliebe gruen, auch wenn
     * merkeEntscheidung() gar nichts mehr taete.
     */
    vergissEntscheidungen('k1');
    assert.equal(entscheidungZu('k1', '<abc@fremd.de>'), null);

    merkeEntscheidung('k1', '<abc@fremd.de>', 'abgelehnt');
    assert.equal(entscheidungZu('k1', '<abc@fremd.de>'), 'abgelehnt');
    alsNutzer('bernd', () => {
      assert.equal(entscheidungZu('k1', '<abc@fremd.de>'), null);
      assert.equal(umgangFuer('k1'), 'fragen');
    });
  }),
);

console.log('\nDie gebaute Bestaetigung:');

const gebaut = baueLesebestaetigung(KONTO, {
  an: 'kunde@fremd.de',
  originalId: '<abc@fremd.de>',
  betreff: 'Gelesen: Angebot für Müller & Söhne',
  vonHand: true,
  text: 'Ihre Nachricht wurde angezeigt.',
}).toString('utf8');

await pruefe('sie ist ein multipart/report - sonst erkennt sie niemand als Bestaetigung', () => {
  /*
   * Der Punkt der ganzen Uebung. Kaeme eine gewoehnliche Mail, staende sie beim Absender
   * als unerklaerter Zweizeiler im Posteingang, und der Haken in seinem Programm bliebe
   * aus - also genau das, was er wissen wollte, faende nicht statt.
   */
  assert.match(gebaut, /Content-Type: multipart\/report; report-type=disposition-notification/);
  assert.match(gebaut, /Content-Type: message\/disposition-notification/);
});

await pruefe('der maschinenlesbare Teil traegt die Pflichtfelder', () => {
  assert.match(gebaut, /Final-Recipient: rfc822;anna@beispiel\.de/);
  assert.match(gebaut, /Original-Message-ID: <abc@fremd\.de>/);
  // "displayed" und nicht "read": Angezeigt heisst, sie stand auf einem Bildschirm.
  assert.match(gebaut, /Disposition: manual-action\/MDN-sent-manually; displayed/);
});

await pruefe('von Hand und automatisch stehen verschieden darin', () => {
  // Keine Formsache: Es sagt der Gegenseite, ob ein Mensch zugestimmt hat oder ein
  // Programm entschieden hat.
  const auto = baueLesebestaetigung(KONTO, {
    an: 'kunde@fremd.de',
    betreff: 'Gelesen',
    vonHand: false,
    text: 'x',
  }).toString('utf8');
  assert.match(auto, /Disposition: automatic-action\/MDN-sent-automatically; displayed/);
});

await pruefe('sie fordert selbst keine Bestaetigung an', () => {
  // Sonst waere das eine Endlosschleife mit zwei hoeflichen Teilnehmern.
  assert.ok(!/Disposition-Notification-To/i.test(gebaut), 'Sie fordert selbst eine an.');
});

await pruefe('sie ist als maschinell gekennzeichnet', () => {
  // Ohne diese Zeile antwortete die Abwesenheitsnotiz der Gegenseite darauf, unsere auf
  // deren Antwort, und so fort.
  assert.match(gebaut, /Auto-Submitted: auto-replied/);
});

await pruefe('der Betreff mit Umlauten kommt kodiert heraus', () => {
  // Sonst steht beim Empfaenger Buchstabensalat, und zwar in der Zeile, die er zuerst
  // sieht.
  assert.ok(!/Subject: Gelesen: Angebot für/.test(gebaut), 'Der Betreff steht roh darin.');
  assert.match(gebaut, /Subject: =\?UTF-8\?B\?/);
});

await pruefe('Zeilenumbrueche in einer Adresse schmuggeln keine Kopfzeilen ein', () => {
  const boese = baueLesebestaetigung(KONTO, {
    an: 'kunde@fremd.de\r\nBcc: mitleser@fremd.de',
    betreff: 'Gelesen',
    vonHand: true,
    text: 'x',
  }).toString('utf8');
  const kopf = boese.split('\r\n\r\n')[0]!;
  assert.ok(!/^Bcc:/m.test(kopf), 'Eine Kopfzeile liess sich einschmuggeln.');
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
