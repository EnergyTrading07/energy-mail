import assert from 'node:assert/strict';
import {
  anbieterAusEintraegen,
  findeEinstellungen,
  istBrauchbarerHostname,
  leseAutoconfig,
  leseAutodiscover,
} from './autoconfig.js';

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

console.log('\nWohin die Suche greifen darf:');

/*
 * Die Domain kommt aus dem, was jemand ins Adressfeld tippt, und wird in eine Adresse
 * eingesetzt, die der Server dann abruft. Ungeprüft war das ein Weg, den Server im
 * fremden Auftrag im eigenen Netz anklopfen zu lassen - "a@127.0.0.1:9200/x?" genügte.
 */
pruefe('was kein Rechnername ist, wird abgewiesen', () => {
  for (const boese of [
    '127.0.0.1',
    '127.0.0.1:9200',
    '169.254.169.254',
    'localhost',
    '[::1]',
    'beispiel.de:8080',
    'beispiel.de/../..',
    'name@beispiel.de',
    'beispiel .de',
    '-start.de',
    'ende-.de',
    'ohnepunkt',
    '',
  ]) {
    assert.equal(istBrauchbarerHostname(boese), false, `"${boese}" hätte gelten sollen`);
  }
});

pruefe('gewöhnliche Domains gelten weiter', () => {
  for (const gut of ['gmx.de', 'mail.beispiel.de', 'a-b.co.uk', 'xn--mnchen-3ya.de', 'x1.y2.zz']) {
    assert.equal(istBrauchbarerHostname(gut), true, `"${gut}" hätte gelten müssen`);
  }
});

await (async () => {
  gesamt++;
  const name = 'eine unbrauchbare Domain löst gar keinen Abruf aus';
  try {
    /*
     * Ohne Netz und ohne Zeitüberschreitung: die Prüfung greift, bevor irgendetwas
     * abgerufen wird. Käme hier ein Abruf zustande, liefe diese Prüfung in die
     * Dreisekundenfrist - der Fehlschlag wäre also auch an der Dauer zu sehen.
     */
    const begonnen = Date.now();
    assert.equal(await findeEinstellungen('wer@127.0.0.1:9200'), null);
    assert.equal(await findeEinstellungen('wer@169.254.169.254'), null);
    assert.ok(Date.now() - begonnen < 500, 'es wurde doch etwas abgerufen');
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
})();

console.log('\nWo die Post einer Firmendomain liegt:');

/*
 * Die Luecke, an der die Einrichtung in jedem Unternehmen scheiterte: die vier bisherigen
 * Quellen decken Privatanbieter ab, und eine autoconfig-Datei legt kaum eine Firma auf
 * ihre Domain. Die Werte hier sind nicht ausgedacht, sondern an den echten DNS-Eintraegen
 * dieser Domains abgelesen - und genau daran hing der Fund der zweiten Microsoft-Endung.
 */
pruefe('Microsoft 365 an den MX-Eintraegen', () => {
  for (const mx of [
    'microsoft-com.mail.protection.outlook.com', // microsoft.com
    'sap-com.mail.protection.outlook.com', // sap.com
    'siemens-com.h-v1.mx.microsoft', // siemens.com - die NEUERE Schreibweise
  ]) {
    const g = anbieterAusEintraegen([mx]);
    assert.equal(g?.anbieter, 'Microsoft 365', `nicht erkannt: ${mx}`);
    assert.equal(g?.imapHost, 'outlook.office365.com');
    // Ohne diese Angabe tippt der Nutzer ein Kennwort, das Microsoft laengst nicht mehr
    // annimmt - und sucht den Fehler bei sich.
    assert.equal(g?.oauthProvider, 'microsoft');
  }
});

pruefe('die zweite Microsoft-Endung ist keine Formsache', () => {
  // Siemens waere ohne sie als "unbekannt" durchgegangen. Diese Zeile ist der Waechter.
  assert.ok(anbieterAusEintraegen(['siemens-com.h-v1.mx.microsoft']));
});

pruefe('Google Workspace ebenso', () => {
  const g = anbieterAusEintraegen(['aspmx.l.google.com', 'alt1.aspmx.l.google.com']);
  assert.equal(g?.anbieter, 'Google Workspace');
  assert.equal(g?.imapHost, 'imap.gmail.com');
  assert.equal(g?.oauthProvider, 'google');
});

pruefe('ein vorgeschalteter Filter verdeckt Microsoft nicht', () => {
  /*
   * Manche Unternehmen fuehren eingehende Post ueber Proofpoint oder Mimecast - dann steht
   * im MX-Eintrag der Filter. Der Verweis autodiscover.<domain> bleibt trotzdem stehen; er
   * betrifft nicht den Postweg, sondern die Anmeldung.
   */
  const g = anbieterAusEintraegen(['mx1-eu1.ppe-hosted.com'], ['autodiscover.outlook.com']);
  assert.equal(g?.anbieter, 'Microsoft 365');
});

pruefe('wer seine Post selbst hat, wird nicht erraten', () => {
  /*
   * Der wichtigere Teil. Lieber das Formular als eine falsche Adresse, die erst beim
   * Anmelden auffaellt - und "endet auf google.com" darf nicht auf etwas passen, das nur
   * zufaellig so aussieht.
   */
  assert.equal(anbieterAusEintraegen(['mx00.emig.gmx.net', 'mx01.emig.gmx.net']), null);
  assert.equal(anbieterAusEintraegen(['mx01.posteo.de']), null);
  assert.equal(anbieterAusEintraegen([]), null);
  assert.equal(anbieterAusEintraegen(['mail.eigene-firma.de']), null);
  assert.equal(anbieterAusEintraegen(['mx.boesegoogle.com']), null);
  assert.equal(anbieterAusEintraegen(['mx.nichtoutlook.com']), null);
});

pruefe('Schreibweise und der Punkt am Ende stoeren nicht', () => {
  // Aus DNS kommen Namen auch mit abschliessendem Punkt und in beliebiger Schreibweise.
  assert.ok(anbieterAusEintraegen(['SAP-COM.MAIL.PROTECTION.OUTLOOK.COM.']));
});

console.log('\nDie Antwort eines Exchange-Servers:');

/** So antwortet ein Exchange im Haus - gekuerzt auf das, was hier ausgewertet wird. */
const EXCHANGE = `<?xml version="1.0" encoding="utf-8"?>
<Autodiscover xmlns="http://schemas.microsoft.com/exchange/autodiscover/responseschema/2006">
  <Response>
    <User><DisplayName>Anna Muster</DisplayName></User>
    <Account>
      <AccountType>email</AccountType>
      <Protocol>
        <Type>EXCH</Type>
        <Server>EX01.firma.local</Server>
      </Protocol>
      <Protocol>
        <Type>IMAP</Type>
        <Server>mail.firma.de</Server>
        <Port>993</Port>
        <SSL>on</SSL>
        <LoginName>anna@firma.de</LoginName>
      </Protocol>
      <Protocol>
        <Type>SMTP</Type>
        <Server>mail.firma.de</Server>
        <Port>587</Port>
        <SSL>off</SSL>
      </Protocol>
    </Account>
  </Response>
</Autodiscover>`;

pruefe('IMAP und SMTP aus den Protokollbloecken', () => {
  const g = leseAutodiscover(EXCHANGE)!;
  assert.equal(g.fundort, 'autodiscover');
  assert.equal(g.imapHost, 'mail.firma.de');
  assert.equal(g.imapPort, 993);
  assert.equal(g.imapSecure, true);
  assert.equal(g.smtpHost, 'mail.firma.de');
  assert.equal(g.smtpPort, 587);
  // "SSL off" heisst nicht unverschluesselt, sondern STARTTLS - das erzwingt smtpClient.
  assert.equal(g.smtpSecure, false);
});

pruefe('der EXCH-Block stoert nicht', () => {
  // Er steht immer zuerst und nennt einen Server, der kein IMAP spricht. Wer den ersten
  // Block nimmt statt den passenden, richtet ein Konto auf EX01.firma.local ein.
  assert.equal(leseAutodiscover(EXCHANGE)!.imapHost, 'mail.firma.de');
});

pruefe('ohne IMAP-Block gibt es nichts', () => {
  // Sehr verbreitet: Exchange im Haus mit abgeschaltetem IMAP. Dann ist "nichts gefunden"
  // die richtige Antwort und nicht ein halb ausgefuelltes Formular.
  const nurExchange = EXCHANGE.replace(/<Protocol>\s*<Type>\s*IMAP[\s\S]*?<\/Protocol>/i, '');
  assert.equal(leseAutodiscover(nurExchange), null);
  assert.equal(leseAutodiscover('<html>Anmeldung erforderlich</html>'), null);
  assert.equal(leseAutodiscover(''), null);
});

pruefe('fehlt die SSL-Angabe, entscheidet der Anschluss', () => {
  const ohne = EXCHANGE.replace(/<SSL>on<\/SSL>/i, '').replace(/<SSL>off<\/SSL>/i, '');
  const g = leseAutodiscover(ohne)!;
  assert.equal(g.imapSecure, true, '993 ist von Anfang an verschluesselt');
  assert.equal(g.smtpSecure, false, '587 stuft hoch');
});

console.log(`\n${ok} von ${gesamt} Prüfungen bestanden`);
if (ok !== gesamt) process.exit(1);
