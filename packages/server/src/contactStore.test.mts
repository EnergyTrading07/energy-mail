import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';

// Vor dem ersten Zugriff umlenken, sonst landen Testadressen im echten Benutzerordner.
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-kontakte-test-'));
setDataDir(tempDir);

const {
  contactCount,
  einfuhrVisitenkarten,
  findeKontakt,
  kontakteAlsVcf,
  listeKontakte,
  loescheKontakt,
  merkeAusListe,
  rememberAddresses,
  searchContacts,
  speichereKontakt,
  speichereKontakteSofort,
  verwirfKontaktSpeicher,
} = await import('./contactStore.js');

let bestanden = 0;
let gescheitert = 0;

function pruefe(name: string, fn: () => void): void {
  // Jede Prüfung fängt bei null an - sonst schleppte sie die Adressen der vorigen mit.
  verwirfKontaktSpeicher();
  fs.rmSync(path.join(tempDir, 'contacts.json'), { force: true });
  try {
    fn();
    console.log(`  ok   ${name}`);
    bestanden++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
    gescheitert++;
  }
}

/** Baut eine Nachricht, wie sie aus der Ordnerliste kommt. */
const mail = (uid: number, absender: string, datum = '2026-07-01T10:00:00.000Z') => ({
  uid,
  date: new Date(datum),
  from: [{ address: absender }],
  to: [],
  cc: [],
});

/** Legt eine Ablage in der alten Fassung an - einer blanken Liste. */
function alteAblage(eintraege: { address: string; name?: string; count: number }[]): void {
  fs.writeFileSync(
    path.join(tempDir, 'contacts.json'),
    JSON.stringify(eintraege.map((e) => ({ ...e, lastSeen: '2026-01-01T00:00:00.000Z' }))),
    'utf-8',
  );
}

console.log('\nAdressen merken:');

pruefe('zählt eine Adresse und schlägt sie vor', () => {
  rememberAddresses([{ address: 'Anna@Beispiel.de', name: 'Anna' }]);
  const treffer = searchContacts('anna');
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0]?.name, 'Anna');
});

pruefe('überschreibt einen bereits bekannten Namen nicht', () => {
  // Der erste Name ist meist der bessere - später kommt oft nur die Adresse selbst.
  rememberAddresses([{ address: 'a@b.de', name: 'Anna Müller' }]);
  rememberAddresses([{ address: 'a@b.de', name: 'a@b.de' }]);
  assert.equal(searchContacts('a@b')[0]?.name, 'Anna Müller');
});

pruefe('übergeht, was keine Adresse ist', () => {
  rememberAddresses([{ address: '' }, { address: 'ohne-klammeraffe' }, { address: '  ' }]);
  assert.equal(contactCount(), 0);
});

pruefe('stellt Häufigeres nach vorn', () => {
  rememberAddresses([{ address: 'selten@b.de' }]);
  for (let i = 0; i < 5; i++) rememberAddresses([{ address: 'oft@b.de' }]);
  assert.equal(searchContacts('b.de')[0]?.address, 'oft@b.de');
});

pruefe('stellt Treffer am Anfang der Adresse vor solche in der Mitte', () => {
  // Der hintere ist häufiger - der Anfangstreffer soll trotzdem gewinnen.
  for (let i = 0; i < 9; i++) rememberAddresses([{ address: 'x@mueller.de' }]);
  rememberAddresses([{ address: 'mueller@x.de' }]);
  assert.equal(searchContacts('mueller')[0]?.address, 'mueller@x.de');
});

console.log('\nAus der Ordnerliste einsammeln:');

pruefe('zählt dieselbe Seite nicht zweimal', () => {
  const seite = [mail(100, 'chef@firma.de'), mail(99, 'chef@firma.de')];
  merkeAusListe('konto1', 'INBOX', seite);
  assert.equal(searchContacts('chef')[0]?.count, 2);

  // Die Liste erneuert sich - dieselben Nachrichten kommen noch einmal herein.
  merkeAusListe('konto1', 'INBOX', seite);
  merkeAusListe('konto1', 'INBOX', seite);
  assert.equal(searchContacts('chef')[0]?.count, 2, 'die Auffrischung hat mitgezählt');
});

pruefe('zählt neu eingegangene Post über dem bekannten Bereich', () => {
  merkeAusListe('konto1', 'INBOX', [mail(100, 'chef@firma.de')]);
  merkeAusListe('konto1', 'INBOX', [mail(101, 'chef@firma.de'), mail(100, 'chef@firma.de')]);
  assert.equal(searchContacts('chef')[0]?.count, 2);
});

pruefe('zählt ältere nachgeladene Seiten unter dem bekannten Bereich', () => {
  merkeAusListe('konto1', 'INBOX', [mail(100, 'chef@firma.de')]);
  merkeAusListe('konto1', 'INBOX', [mail(99, 'chef@firma.de')]);
  assert.equal(searchContacts('chef')[0]?.count, 2);
});

pruefe('hält Ordner und Konten auseinander', () => {
  // Gleiche UID in einem anderen Ordner ist eine andere Nachricht.
  merkeAusListe('konto1', 'INBOX', [mail(7, 'chef@firma.de')]);
  merkeAusListe('konto1', 'Gesendet', [mail(7, 'chef@firma.de')]);
  merkeAusListe('konto2', 'INBOX', [mail(7, 'chef@firma.de')]);
  assert.equal(searchContacts('chef')[0]?.count, 3);
});

pruefe('kommt mit einer leeren Seite zurecht', () => {
  merkeAusListe('konto1', 'INBOX', []);
  assert.equal(contactCount(), 0);
});

console.log('\nGrenzen des Speichers:');

pruefe('wächst nicht über die Obergrenze hinaus', () => {
  for (let i = 0; i < 2500; i++) rememberAddresses([{ address: `nr${i}@massen.de` }]);
  speichereKontakteSofort();
  assert.ok(contactCount() <= 2000, `waren ${contactCount()}`);
});

pruefe('behält beim Aufräumen die häufig genutzten', () => {
  for (let i = 0; i < 20; i++) rememberAddresses([{ address: 'wichtig@b.de' }]);
  for (let i = 0; i < 2500; i++) rememberAddresses([{ address: `nr${i}@massen.de` }]);
  speichereKontakteSofort();
  assert.equal(searchContacts('wichtig').length, 1);
});

console.log('\nAblage auf der Platte:');

pruefe('liest einen gespeicherten Stand wieder ein', () => {
  merkeAusListe('konto1', 'INBOX', [mail(5, 'anna@b.de')]);
  speichereKontakteSofort();
  verwirfKontaktSpeicher();

  assert.equal(searchContacts('anna').length, 1);
  // Der ausgewertete Bereich hat den Neustart ebenfalls überdauert.
  merkeAusListe('konto1', 'INBOX', [mail(5, 'anna@b.de')]);
  assert.equal(searchContacts('anna')[0]?.count, 1, 'nach dem Neustart erneut gezählt');
});

pruefe('liest die alte Fassung, die nur eine Liste enthielt', () => {
  alteAblage([{ address: 'alt@b.de', name: 'Alt', count: 9 }]);
  const treffer = searchContacts('alt')[0];
  assert.equal(treffer?.name, 'Alt');
  // Gestaucht, weil die alten Zähler durch das mehrfache Zählen aufgebläht sind.
  assert.equal(treffer?.count, 3);
});

pruefe('behält beim Stauchen der alten Zähler die Reihenfolge', () => {
  alteAblage([
    { address: 'wenig@b.de', count: 13 },
    { address: 'viel@b.de', count: 4188 },
  ]);
  const treffer = searchContacts('b.de');
  assert.equal(treffer[0]?.address, 'viel@b.de');
  // Der Abstand ist so weit zusammengezogen, dass richtig Gezähltes aufholen kann.
  assert.ok(treffer[0]!.count < 100, `war ${treffer[0]?.count}`);
});

pruefe('lässt sich von einer beschädigten Datei nicht aufhalten', () => {
  fs.writeFileSync(path.join(tempDir, 'contacts.json'), '{kaputt', 'utf-8');
  assert.equal(contactCount(), 0);
  rememberAddresses([{ address: 'neu@b.de' }]);
  assert.equal(contactCount(), 1);
});

console.log('\nDas Adressbuch - was von Hand gepflegt wird:');

pruefe('legt einen Kontakt an und findet ihn wieder', () => {
  speichereKontakt({
    address: 'anna@beispiel.de',
    vorname: 'Anna',
    nachname: 'Müller',
    organisation: 'Beispiel GmbH',
    telefone: [{ nummer: '030 123456', art: 'Arbeit' }],
  });
  const kontakt = findeKontakt('ANNA@Beispiel.de');
  assert.equal(kontakt?.name, 'Anna Müller', 'der Name wird aus Vor- und Nachname gebildet');
  assert.equal(kontakt?.gepflegt, true);
  assert.equal(listeKontakte().gesamt, 1);
});

pruefe('ohne Mailadresse geht es nicht', () => {
  assert.throws(() => speichereKontakt({ address: 'kein-klammeraffe' }));
  assert.throws(() => speichereKontakt({ address: '  ' }));
});

pruefe('aufgelesene Adressen stehen nicht im Adressbuch', () => {
  // Zweitausend nebenbei aufgelesene waeren keine Liste, durch die jemand blaettern will.
  rememberAddresses([{ address: 'newsletter@irgendwo.de' }]);
  speichereKontakt({ address: 'echt@b.de', name: 'Echt' });

  assert.equal(listeKontakte().gesamt, 1);
  assert.equal(listeKontakte().eintraege[0]?.address, 'echt@b.de');
  // Auf Wunsch schon.
  assert.equal(listeKontakte({ auchAufgelesene: true }).gesamt, 2);
});

pruefe('eine aufgelesene Adresse laesst sich uebernehmen, ohne den Zaehler zu verlieren', () => {
  for (let i = 0; i < 7; i++) rememberAddresses([{ address: 'chef@firma.de' }]);
  speichereKontakt({ address: 'chef@firma.de', vorname: 'Bernd', nachname: 'Chef' });

  const kontakt = findeKontakt('chef@firma.de');
  assert.equal(kontakt?.count, 7, 'der Zaehler wurde zurueckgesetzt');
  assert.equal(kontakt?.gepflegt, true);
});

pruefe('gepflegte Eintraege werden beim Aufraeumen nicht verdraengt', () => {
  speichereKontakt({ address: 'wichtig@b.de', name: 'Wichtig' });
  for (let i = 0; i < 2500; i++) rememberAddresses([{ address: `nr${i}@massen.de` }]);
  speichereKontakteSofort();

  assert.equal(findeKontakt('wichtig@b.de')?.gepflegt, true, 'der gepflegte Eintrag ist weg');
  assert.equal(listeKontakte().gesamt, 1);
});

pruefe('die Obergrenze zaehlt nur die aufgelesenen', () => {
  // Sonst draengten viele eingetragene Kontakte die Vorschlaege aus dem Speicher.
  for (let i = 0; i < 300; i++) speichereKontakt({ address: `hand${i}@b.de`, name: `Nr ${i}` });
  for (let i = 0; i < 2500; i++) rememberAddresses([{ address: `nr${i}@massen.de` }]);
  speichereKontakteSofort();

  assert.equal(listeKontakte().gesamt, 300, 'eingetragene Kontakte wurden verdraengt');
  assert.ok(contactCount() > 1800, `nur noch ${contactCount()} insgesamt`);
});

pruefe('das Auflesen ueberschreibt einen eingetragenen Namen nicht', () => {
  speichereKontakt({ address: 'a@b.de', vorname: 'Anna', nachname: 'Müller' });
  rememberAddresses([{ address: 'a@b.de', name: 'a@b.de' }]);
  assert.equal(findeKontakt('a@b.de')?.name, 'Anna Müller');
});

pruefe('eine geaenderte Hauptadresse hinterlaesst keinen Zweiteintrag', () => {
  speichereKontakt({ address: 'alt@b.de', name: 'Wer' });
  speichereKontakt({ address: 'neu@b.de', name: 'Wer' }, 'alt@b.de');

  assert.equal(findeKontakt('alt@b.de'), undefined, 'der alte Eintrag steht noch da');
  assert.equal(listeKontakte().gesamt, 1);
});

pruefe('loeschen entfernt den Eintrag', () => {
  speichereKontakt({ address: 'weg@b.de', name: 'Weg' });
  assert.equal(loescheKontakt('WEG@b.de'), true);
  assert.equal(listeKontakte().gesamt, 0);
  assert.equal(loescheKontakt('gabesnie@b.de'), false);
});

pruefe('weitere Adressen werden mit vorgeschlagen', () => {
  speichereKontakt({
    address: 'privat@b.de',
    name: 'Anna Müller',
    weitereAdressen: ['dienst@firma.de'],
  });
  const treffer = searchContacts('dienst');
  assert.equal(treffer[0]?.address, 'dienst@firma.de');
  assert.equal(treffer[0]?.name, 'Anna Müller', 'der Name der Person fehlt');
});

pruefe('die Hauptadresse doppelt anzugeben legt sie nicht zweimal an', () => {
  speichereKontakt({ address: 'a@b.de', name: 'Wer', weitereAdressen: ['A@B.de', 'c@d.de'] });
  assert.deepEqual(findeKontakt('a@b.de')?.weitereAdressen, ['c@d.de']);
});

pruefe('wer im Adressbuch steht, wird zuerst vorgeschlagen', () => {
  // Der aufgelesene ist haeufiger - der eingetragene soll trotzdem gewinnen.
  for (let i = 0; i < 40; i++) rememberAddresses([{ address: 'werbung@laden.de' }]);
  speichereKontakt({ address: 'kollege@laden.de', name: 'Kollege' });
  assert.equal(searchContacts('laden.de')[0]?.address, 'kollege@laden.de');
});

pruefe('das Adressbuch laesst sich nach Namen und Firma durchsuchen', () => {
  speichereKontakt({ address: 'a@b.de', vorname: 'Anna', organisation: 'Beispiel GmbH' });
  speichereKontakt({ address: 'c@d.de', vorname: 'Carl', organisation: 'Andere AG' });

  assert.equal(listeKontakte({ suche: 'beispiel' }).gesamt, 1);
  assert.equal(listeKontakte({ suche: 'carl' }).eintraege[0]?.address, 'c@d.de');
  assert.equal(listeKontakte({ suche: 'gibtesnicht' }).gesamt, 0);
});

pruefe('die Liste steht nach Namen sortiert da', () => {
  speichereKontakt({ address: 'z@b.de', name: 'Zacharias' });
  speichereKontakt({ address: 'a@b.de', name: 'Änne' });
  speichereKontakt({ address: 'm@b.de', name: 'Martin' });

  assert.deepEqual(
    listeKontakte().eintraege.map((k) => k.name),
    ['Änne', 'Martin', 'Zacharias'],
  );
});

pruefe('ein eingetragener Kontakt steht sofort auf der Platte', () => {
  // Aufgelesenes darf gebuendelt werden - eingetragenes nicht: es kommt nicht wieder.
  speichereKontakt({ address: 'sofort@b.de', name: 'Sofort' });
  verwirfKontaktSpeicher();
  assert.equal(findeKontakt('sofort@b.de')?.name, 'Sofort');
});

console.log('\nVisitenkarten ein- und ausfuehren:');

pruefe('eine eingelesene Karte landet im Adressbuch', () => {
  const ergebnis = einfuhrVisitenkarten(
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'FN:Bernd Schmidt',
      'N:Schmidt;Bernd;;;',
      'EMAIL:bernd@firma.de',
      'TEL;TYPE=CELL:0170 111222',
      'END:VCARD',
    ].join('\r\n'),
  );
  assert.deepEqual(ergebnis, { angelegt: 1, aktualisiert: 0, uebergangen: 0 });

  const kontakt = findeKontakt('bernd@firma.de');
  assert.equal(kontakt?.name, 'Bernd Schmidt');
  assert.equal(kontakt?.gepflegt, true);
  assert.deepEqual(kontakt?.telefone, [{ nummer: '0170 111222', art: 'Mobil' }]);
});

pruefe('eine Karte ohne Mailadresse wird uebergangen', () => {
  const ergebnis = einfuhrVisitenkarten(
    ['BEGIN:VCARD', 'VERSION:3.0', 'FN:Nur ein Name', 'END:VCARD'].join('\r\n'),
  );
  assert.equal(ergebnis.uebergangen, 1);
  assert.equal(listeKontakte().gesamt, 0);
});

pruefe('wer schon dasteht, wird ergaenzt statt verdoppelt', () => {
  speichereKontakt({ address: 'bernd@firma.de', vorname: 'Bernd', nachname: 'Schmidt' });
  const ergebnis = einfuhrVisitenkarten(
    [
      'BEGIN:VCARD',
      'FN:Bernd Schmidt',
      'EMAIL:bernd@firma.de',
      'ORG:Firma GmbH',
      'END:VCARD',
    ].join('\r\n'),
  );

  assert.deepEqual(ergebnis, { angelegt: 0, aktualisiert: 1, uebergangen: 0 });
  assert.equal(listeKontakte().gesamt, 1);
  // Was fehlte, kam dazu.
  assert.equal(findeKontakt('bernd@firma.de')?.organisation, 'Firma GmbH');
});

pruefe('die Einfuhr ueberschreibt nicht, was schon eingetragen war', () => {
  speichereKontakt({ address: 'b@firma.de', name: 'Mein eigener Name', notiz: 'Meine Notiz' });
  einfuhrVisitenkarten(
    ['BEGIN:VCARD', 'FN:Fremder Name', 'EMAIL:b@firma.de', 'NOTE:Fremde Notiz', 'END:VCARD'].join(
      '\r\n',
    ),
  );

  const kontakt = findeKontakt('b@firma.de');
  assert.equal(kontakt?.name, 'Mein eigener Name');
  assert.equal(kontakt?.notiz, 'Meine Notiz');
});

pruefe('eine aufgelesene Adresse wird durch die Einfuhr zum gepflegten Kontakt', () => {
  for (let i = 0; i < 4; i++) rememberAddresses([{ address: 'gelesen@b.de' }]);
  const ergebnis = einfuhrVisitenkarten(
    ['BEGIN:VCARD', 'FN:Jetzt Bekannt', 'EMAIL:gelesen@b.de', 'END:VCARD'].join('\r\n'),
  );

  assert.equal(ergebnis.angelegt, 1, 'aufgelesen zaehlt nicht als bereits vorhanden');
  assert.equal(findeKontakt('gelesen@b.de')?.name, 'Jetzt Bekannt');
  assert.equal(findeKontakt('gelesen@b.de')?.count, 4, 'der Zaehler ging verloren');
});

pruefe('was ausgefuehrt wird, kommt unveraendert wieder herein', () => {
  speichereKontakt({
    address: 'anna@beispiel.de',
    vorname: 'Anna',
    nachname: 'Müller',
    organisation: 'Beispiel GmbH',
    telefone: [{ nummer: '+49 170 1234567', art: 'Mobil' }],
    notiz: 'Ruft lieber an; erreichbar ab 9 Uhr.',
    weitereAdressen: ['a.mueller@firma.de'],
  });

  const vcf = kontakteAlsVcf();
  loescheKontakt('anna@beispiel.de');
  assert.equal(listeKontakte().gesamt, 0);

  einfuhrVisitenkarten(vcf);
  const zurueck = findeKontakt('anna@beispiel.de');
  assert.equal(zurueck?.name, 'Anna Müller');
  assert.equal(zurueck?.organisation, 'Beispiel GmbH');
  assert.deepEqual(zurueck?.telefone, [{ nummer: '+49 170 1234567', art: 'Mobil' }]);
  assert.equal(zurueck?.notiz, 'Ruft lieber an; erreichbar ab 9 Uhr.');
  assert.deepEqual(zurueck?.weitereAdressen, ['a.mueller@firma.de']);
});

pruefe('die Ausfuhr enthaelt nur die gepflegten Kontakte', () => {
  rememberAddresses([{ address: 'nichtdabei@b.de' }]);
  speichereKontakt({ address: 'dabei@b.de', name: 'Dabei' });

  const vcf = kontakteAlsVcf();
  assert.ok(vcf.includes('dabei@b.de'));
  assert.ok(!vcf.includes('nichtdabei@b.de'), 'eine aufgelesene Adresse ist mitgegangen');
});

pruefe('eine unbrauchbare Datei richtet keinen Schaden an', () => {
  speichereKontakt({ address: 'bleibt@b.de', name: 'Bleibt' });
  const ergebnis = einfuhrVisitenkarten('das ist kein Adressbuch, sondern ein Einkaufszettel');

  assert.deepEqual(ergebnis, { angelegt: 0, aktualisiert: 0, uebergangen: 0 });
  assert.equal(listeKontakte().gesamt, 1, 'der vorhandene Kontakt ist verschwunden');
});

pruefe('eine Datei mit vielen Karten wird in einem Zug eingelesen', () => {
  const karten = Array.from({ length: 250 }, (_, i) =>
    ['BEGIN:VCARD', 'VERSION:3.0', `FN:Person ${i}`, `EMAIL:p${i}@massen.de`, 'END:VCARD'].join(
      '\r\n',
    ),
  ).join('\r\n');

  const ergebnis = einfuhrVisitenkarten(karten);
  assert.equal(ergebnis.angelegt, 250);
  assert.equal(listeKontakte({ limit: 1000 }).gesamt, 250);
});

verwirfKontaktSpeicher();
fs.rmSync(tempDir, { recursive: true, force: true });

console.log(`\n${bestanden} von ${bestanden + gescheitert} Prüfungen bestanden`);
if (gescheitert > 0) process.exit(1);
