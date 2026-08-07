import assert from 'node:assert/strict';
import { leseAutoconfig } from './autoconfig.js';

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

/** Eine Datei, wie sie die Anbieterdatenbank ausliefert. */
const POSTEO = `<?xml version="1.0" encoding="UTF-8"?>
<clientConfig version="1.1">
  <emailProvider id="posteo.de">
    <domain>posteo.de</domain>
    <displayName>Posteo</displayName>
    <incomingServer type="imap">
      <hostname>posteo.de</hostname>
      <port>993</port>
      <socketType>SSL</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>posteo.de</hostname>
      <port>587</port>
      <socketType>STARTTLS</socketType>
      <authentication>password-cleartext</authentication>
      <username>%EMAILADDRESS%</username>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

console.log('\nAuslesen der Anbieterangaben:');

pruefe('Hostnamen und Anschlussnummern', () => {
  const e = leseAutoconfig(POSTEO, 'anbieterdatenbank');
  assert.equal(e?.imapHost, 'posteo.de');
  assert.equal(e?.imapPort, 993);
  assert.equal(e?.smtpHost, 'posteo.de');
  assert.equal(e?.smtpPort, 587);
});

pruefe('SSL heisst verschluesselt, STARTTLS nicht von Anfang an', () => {
  // Fuer die Verbindungsschicht ist nur die von Beginn an verschluesselte "secure".
  const e = leseAutoconfig(POSTEO, 'anbieterdatenbank');
  assert.equal(e?.imapSecure, true);
  assert.equal(e?.smtpSecure, false);
});

pruefe('der Anbietername wird uebernommen', () => {
  assert.equal(leseAutoconfig(POSTEO, 'anbieterdatenbank')?.anbieter, 'Posteo');
});

pruefe('der Fundort wird durchgereicht', () => {
  assert.equal(leseAutoconfig(POSTEO, 'domain')?.fundort, 'domain');
});

pruefe('die ganze Adresse als Benutzername', () => {
  assert.equal(leseAutoconfig(POSTEO, 'anbieterdatenbank')?.benutzername, 'adresse');
});

pruefe('nur der Teil vor dem Klammeraffen, wenn der Anbieter das so will', () => {
  const xml = POSTEO.replace('%EMAILADDRESS%', '%EMAILLOCALPART%');
  assert.equal(leseAutoconfig(xml, 'anbieterdatenbank')?.benutzername, 'ortsteil');
});

console.log('\nWas uebergangen werden muss:');

pruefe('POP3 wird nicht genommen', () => {
  // Das Programm spricht bewusst kein POP3 - ein Anbieter, der nur das anbietet,
  // darf nicht faelschlich als eingerichtet gelten.
  const nurPop = POSTEO.replace(/type="imap"/, 'type="pop3"');
  assert.equal(leseAutoconfig(nurPop, 'anbieterdatenbank'), null);
});

pruefe('IMAP wird auch dann gefunden, wenn POP3 davorsteht', () => {
  const beides = POSTEO.replace(
    '<incomingServer type="imap">',
    `<incomingServer type="pop3">
      <hostname>pop.posteo.de</hostname><port>995</port><socketType>SSL</socketType>
    </incomingServer>
    <incomingServer type="imap">`,
  );
  const e = leseAutoconfig(beides, 'anbieterdatenbank');
  assert.equal(e?.imapHost, 'posteo.de', 'der POP3-Eintrag wurde genommen');
  assert.equal(e?.imapPort, 993);
});

pruefe('ohne Sendeserver ist die Auskunft unbrauchbar', () => {
  const ohne = POSTEO.replace(/<outgoingServer[\s\S]*?<\/outgoingServer>/, '');
  assert.equal(leseAutoconfig(ohne, 'anbieterdatenbank'), null);
});

pruefe('ohne Anschlussnummer ebenso', () => {
  const ohne = POSTEO.replace('<port>993</port>', '');
  assert.equal(leseAutoconfig(ohne, 'anbieterdatenbank'), null);
});

pruefe('etwas, das gar kein XML ist', () => {
  assert.equal(leseAutoconfig('<html><body>Nicht gefunden</body></html>', 'domain'), null);
  assert.equal(leseAutoconfig('', 'domain'), null);
});

pruefe('Grossschreibung in den Elementnamen stoert nicht', () => {
  const gross = POSTEO.replace(/socketType/g, 'socketTYPE');
  const e = leseAutoconfig(gross, 'anbieterdatenbank');
  assert.equal(e?.imapSecure, true);
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
