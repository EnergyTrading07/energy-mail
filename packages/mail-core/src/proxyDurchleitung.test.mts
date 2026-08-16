import assert from 'node:assert/strict';
import net from 'node:net';
import { setzeProxyquellen } from './proxy.js';
import { withThrowawayClient } from './connectionPool.js';
import { verifySmtpConnection } from './smtpClient.js';
import type { AccountConfig } from './types.js';

/*
 * Geht die Verbindung wirklich durch den Proxy?
 *
 * proxy.test.mts prueft die Entscheidung - welcher Proxy gilt und warum. Das ist die
 * halbe Antwort. Die andere Haelfte laesst sich nicht ausrechnen, sondern nur ausprobieren:
 * ob die Angabe auch tatsaechlich bis in die Verbindung durchschlaegt. Genau dort sitzen
 * solche Fehler - eine Einstellung, die richtig ermittelt und dann nirgends verwendet
 * wird, sieht in jeder Pruefung gut aus und laesst den Kunden im Firmennetz trotzdem
 * stehen.
 *
 * Deshalb steht hier ein echter Proxy: ein Server, der CONNECT spricht, mitschreibt,
 * wonach gefragt wurde, und die Verbindung anschliessend wirklich weiterreicht.
 */

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/** Ein Port, den das Betriebssystem aussucht - feste Nummern kollidieren. */
function port(server: net.Server): number {
  return (server.address() as net.AddressInfo).port;
}

function horche(server: net.Server): Promise<void> {
  return new Promise((fertig) => server.listen(0, '127.0.0.1', () => fertig()));
}

function schliesse(server: net.Server): Promise<void> {
  return new Promise((fertig) => server.close(() => fertig()));
}

/**
 * Ein Proxy, wie er in einem Firmennetz steht - nur klein.
 *
 * Er versteht "CONNECT host:port HTTP/1.1", schreibt sich auf, wonach gefragt wurde,
 * baut die Verbindung zum Ziel auf und leitet danach beide Richtungen durch. Genau das
 * tut ein Squid oder ein Zscaler auch, nur mit mehr Regeln davor.
 */
function baueProxy(): { server: net.Server; gefragt: string[]; anmeldungen: string[] } {
  const gefragt: string[] = [];
  const anmeldungen: string[] = [];

  const server = net.createServer((vonInnen) => {
    vonInnen.once('data', (stueck) => {
      const kopf = stueck.toString('latin1');
      const ziel = kopf.match(/^CONNECT\s+(\S+)\s+HTTP\/1\.[01]/i)?.[1];
      const anmeldung = kopf.match(/proxy-authorization:\s*(.+)\r?\n/i)?.[1];
      if (anmeldung) anmeldungen.push(anmeldung.trim());

      if (!ziel) {
        vonInnen.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      gefragt.push(ziel);

      const [host, hafen] = ziel.split(':');
      const nachDraussen = net.connect(Number(hafen), host, () => {
        vonInnen.write('HTTP/1.1 200 Connection established\r\n\r\n');
        vonInnen.pipe(nachDraussen);
        /*
         * Die Rueckrichtung mit einer kleinen Laufzeit - und das ist keine
         * Schoenheitskorrektur, sondern der Unterschied zwischen dieser Pruefung und der
         * Wirklichkeit.
         *
         * Hier liegt alles auf demselben Rechner: Gruss und CONNECT-Antwort treffen im
         * selben Augenblick beim Klienten ein. Damit kommt die Kette darunter nicht
         * zurecht. Nodemailers CONNECT-Klient (den auch imapflow benutzt) nimmt seinen
         * 'data'-Horcher weg, sobald der Kopf gelesen ist, und gibt den Socket weiter;
         * imapflow haengt seine Leitung aber erst per setImmediate an. In dieser Luecke
         * ist der Socket im fliessenden Zustand OHNE Abnehmer - was dort eintrifft, ist
         * weg. Die Verbindung laeuft dann in "Failed to receive greeting from server",
         * obwohl der Server laengst geantwortet hat.
         *
         * Im Betrieb liegt zwischen Proxy und Postfachserver eine echte Laufzeit von
         * Millisekunden; die Leitung haengt dann laengst. Fuenfzehn Millisekunden bilden
         * genau das nach. Der Fehler steckt in fremdem Code und ist von hier aus nicht zu
         * beheben - er gehoert gemeldet, und bis dahin gehoert er hier benannt, statt
         * hinter einer Pruefung zu verschwinden, die aus unerfindlichen Gruenden wackelt.
         */
        setTimeout(() => nachDraussen.pipe(vonInnen), 15);
      });
      nachDraussen.on('error', () => vonInnen.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'));
      vonInnen.on('error', () => nachDraussen.destroy());
    });
    vonInnen.on('error', () => {});
  });

  return { server, gefragt, anmeldungen };
}

/**
 * Ein IMAP-Server, der gerade so viel kann, dass imapflow sich anmeldet.
 *
 * Die Faehigkeiten stehen schon im Gruss - das spart eine Runde. Danach wird jeder
 * Befehl mit "OK" beantwortet; was der Server wirklich koennte, ist hier gleichgueltig.
 * Geprueft wird nicht IMAP, sondern der Weg dorthin.
 */
function baueImapServer(): { server: net.Server; verbindungen: number } {
  const zaehler = { server: null as unknown as net.Server, verbindungen: 0 };
  zaehler.server = net.createServer((verbindung) => {
    zaehler.verbindungen++;
    verbindung.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] Pruefserver bereit\r\n');
    verbindung.on('data', (stueck) => {
      for (const zeile of stueck.toString('latin1').split(/\r?\n/)) {
        if (!zeile.trim()) continue;
        const marke = zeile.split(' ')[0];
        const befehl = (zeile.split(' ')[1] ?? '').toUpperCase();
        if (befehl === 'CAPABILITY') {
          verbindung.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n');
        } else if (befehl === 'LIST' || befehl === 'LSUB') {
          verbindung.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');
        } else if (befehl === 'NAMESPACE') {
          verbindung.write('* NAMESPACE (("" "/")) NIL NIL\r\n');
        } else if (befehl === 'LOGOUT') {
          verbindung.write('* BYE Tschuess\r\n');
        }
        verbindung.write(`${marke} OK ${befehl} erledigt\r\n`);
      }
    });
    verbindung.on('error', () => {});
  });
  return zaehler;
}

/** Ein SMTP-Server, der bis zum EHLO kommt - mehr braucht transport.verify() nicht. */
function baueSmtpServer(): { server: net.Server; verbindungen: number } {
  const zaehler = { server: null as unknown as net.Server, verbindungen: 0 };
  zaehler.server = net.createServer((verbindung) => {
    zaehler.verbindungen++;
    verbindung.write('220 pruefserver ESMTP\r\n');
    verbindung.on('data', (stueck) => {
      for (const zeile of stueck.toString('latin1').split(/\r?\n/)) {
        const befehl = zeile.trim().toUpperCase();
        if (!befehl) continue;
        if (befehl.startsWith('EHLO') || befehl.startsWith('HELO')) {
          verbindung.write('250-pruefserver\r\n250 AUTH PLAIN LOGIN\r\n');
        } else if (befehl.startsWith('STARTTLS')) {
          /*
           * Ausdruecklich absagen statt in den Sammelfall zu fallen.
           *
           * Der antwortete "250 ok" - und nodemailer fing daraufhin einen
           * TLS-Handschlag an, waehrend dieser Server im Klartext weitersprach. Heraus
           * kam ein "wrong version number" aus OpenSSL, also ausgerechnet eine Meldung,
           * die nach einem Fehler im Proxy aussieht und keiner ist. Eine klare Absage
           * fuehrt zu der Meldung, die hier gemeint ist: dieser Server kann kein TLS.
           */
          verbindung.write('454 TLS nicht verfuegbar\r\n');
        } else if (befehl.startsWith('AUTH')) {
          verbindung.write('235 angemeldet\r\n');
        } else if (befehl.startsWith('QUIT')) {
          verbindung.write('221 tschuess\r\n');
          verbindung.end();
        } else {
          verbindung.write('250 ok\r\n');
        }
      }
    });
    verbindung.on('error', () => {});
  });
  return zaehler;
}

function konto(teil: Partial<AccountConfig>): AccountConfig {
  return {
    id: 'pruefung',
    email: 'wer@beispiel.de',
    imapHost: '127.0.0.1',
    imapPort: 0,
    imapSecure: false,
    smtpHost: '127.0.0.1',
    smtpPort: 0,
    smtpSecure: false,
    auth: { type: 'password', user: 'wer@beispiel.de', pass: 'geheim' },
    ...teil,
  };
}

/**
 * Baut eine IMAP-Verbindung auf und gibt zurueck, woran sie gescheitert ist.
 *
 * Sie MUSS scheitern, und das ist Absicht: die Konten hier stehen auf imapSecure:false,
 * also verlangt Energy Mail STARTTLS (siehe connectionPool.ts) - und der kleine
 * Pruefserver kann kein TLS. Genau dieser Fehler ist der Beweis, um den es geht: bis
 * dorthin zu kommen heisst, dass der Gruss samt Faehigkeitenliste durch den Tunnel
 * gekommen ist und gelesen wurde. Eine vollstaendige IMAP-Sitzung braeuchte ein
 * Zertifikat und wuerde nichts zusaetzlich belegen.
 */
async function versucheImap(config: AccountConfig): Promise<string> {
  try {
    await withThrowawayClient(config, async () => {});
    return 'ohne Fehler durchgelaufen';
  } catch (err) {
    return (err as Error).message;
  }
}

async function versucheSmtp(config: AccountConfig): Promise<string> {
  try {
    await verifySmtpConnection(config);
    return 'ohne Fehler durchgelaufen';
  } catch (err) {
    return (err as Error).message;
  }
}

const proxy = baueProxy();
const imap = baueImapServer();
const smtp = baueSmtpServer();

await horche(proxy.server);
await horche(imap.server);
await horche(smtp.server);

const PROXY = `http://127.0.0.1:${port(proxy.server)}`;

console.log('\nDurch den Proxy:');

await pruefe('IMAP geht durch den Proxy und der Gruss kommt zurueck', async () => {
  /*
   * Der Kern der Sache, und er beweist beide Richtungen: der Proxy schreibt mit, wonach
   * gefragt wurde (hin), und die Meldung ueber das fehlende STARTTLS kann nur entstehen,
   * wenn die Faehigkeitenliste aus dem Gruss angekommen ist (zurueck).
   */
  proxy.gefragt.length = 0;
  const vorher = imap.verbindungen;
  setzeProxyquellen(() => ({ umgebung: PROXY }));

  const fehler = await versucheImap(konto({ imapPort: port(imap.server) }));

  assert.deepEqual(
    proxy.gefragt,
    [`127.0.0.1:${port(imap.server)}`],
    'der Proxy wurde nicht oder falsch gefragt',
  );
  assert.equal(imap.verbindungen, vorher + 1, 'beim IMAP-Server kam nichts an');
  assert.match(fehler, /STARTTLS/, `der Gruss kam nicht durch den Tunnel: ${fehler}`);
});

await pruefe('SMTP ebenso', async () => {
  proxy.gefragt.length = 0;
  const vorher = smtp.verbindungen;
  setzeProxyquellen(() => ({ umgebung: PROXY }));

  const fehler = await versucheSmtp(konto({ smtpPort: port(smtp.server) }));

  assert.deepEqual(proxy.gefragt, [`127.0.0.1:${port(smtp.server)}`]);
  assert.equal(smtp.verbindungen, vorher + 1, 'beim SMTP-Server kam nichts an');
  // Die EHLO-Antwort kam durch den Tunnel zurueck - sonst gaebe es diese Meldung nicht.
  assert.match(fehler, /STARTTLS|upgrade/i, `die Antwort kam nicht zurueck: ${fehler}`);
});

await pruefe('die Angabe am Konto wird verwendet', async () => {
  // Ohne allgemeine Quelle, nur mit dem Feld am Konto - der Weg fuer einzelne Postfaecher.
  proxy.gefragt.length = 0;
  setzeProxyquellen(() => ({}));

  await versucheImap(konto({ imapPort: port(imap.server), proxy: PROXY }));

  assert.equal(proxy.gefragt.length, 1, 'das Feld am Konto blieb wirkungslos');
});

await pruefe('die Richtlinie schlaegt die Angabe am Konto', async () => {
  /*
   * Die Entscheidung aus proxy.ts, hier am laufenden Verbindungsaufbau nachgewiesen: das
   * Konto nennt einen Proxy, den es gar nicht gibt (Port 1). Gewinnt die Richtlinie, geht
   * die Anfrage trotzdem ueber den echten Proxy - und dort steht sie im Mitschrieb.
   */
  proxy.gefragt.length = 0;
  setzeProxyquellen(() => ({ richtlinie: PROXY }));

  await versucheImap(konto({ imapPort: port(imap.server), proxy: 'http://127.0.0.1:1' }));

  assert.equal(proxy.gefragt.length, 1, 'es ging nicht ueber den vorgeschriebenen Proxy');
});

console.log('\nAm Proxy vorbei:');

await pruefe('ohne Angabe geht es direkt', async () => {
  // Die Gegenprobe. Ohne sie wuesste man nicht, ob der Proxy oben wirklich noetig war.
  proxy.gefragt.length = 0;
  const vorher = imap.verbindungen;
  setzeProxyquellen(() => ({}));

  await versucheImap(konto({ imapPort: port(imap.server) }));

  assert.deepEqual(proxy.gefragt, [], 'es lief ueber den Proxy, obwohl keiner gesetzt war');
  assert.equal(imap.verbindungen, vorher + 1);
});

await pruefe('eine Ausnahme fuehrt am Proxy vorbei', async () => {
  // Der Mailserver im eigenen Haus - jede Firmenaufstellung hat solche Ausnahmen.
  proxy.gefragt.length = 0;
  setzeProxyquellen(() => ({ umgebung: PROXY, ausnahmen: '127.0.0.1' }));

  await versucheImap(konto({ imapPort: port(imap.server) }));

  assert.deepEqual(proxy.gefragt, [], 'die Ausnahme wurde uebergangen');
});

console.log('\nAnmeldung am Proxy:');

await pruefe('Basic geht mit', async () => {
  /*
   * NTLM und Kerberos gehen nicht - das ist in proxy.ts benannt. Basic geht, und zwar so:
   * Name und Kennwort stehen in der Adresse und landen als Kopfzeile im CONNECT.
   */
  proxy.anmeldungen.length = 0;
  setzeProxyquellen(() => ({
    umgebung: `http://anna:geheim@127.0.0.1:${port(proxy.server)}`,
  }));

  await versucheImap(konto({ imapPort: port(imap.server) }));

  assert.equal(proxy.anmeldungen.length, 1, 'es kam keine Anmeldung am Proxy an');
  assert.match(proxy.anmeldungen[0]!, /^Basic /);
  const entschluesselt = Buffer.from(proxy.anmeldungen[0]!.slice(6), 'base64').toString('utf8');
  assert.equal(entschluesselt, 'anna:geheim');
});

setzeProxyquellen(null);
await schliesse(proxy.server);
await schliesse(imap.server);
await schliesse(smtp.server);

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
process.exit(ok === gesamt ? 0 : 1);
