import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';
import { setKeyProvider } from './secretCrypto.js';
import { setzeOAuthVorgabe } from './oauthStore.js';

/**
 * Die Schnittstelle des Servers.
 *
 * 65 Routen, und geprüft war davon bislang keine - nur die Bausteine darunter. Was ein
 * Client falsch machen kann, fiel damit erst im laufenden Programm auf: eine fehlende
 * Angabe, ein Konto, das es nicht gibt, ein Ordnername mit einem Schrägstrich darin.
 *
 * Geprüft wird über inject() statt über einen echten Port. Damit braucht es keinen
 * freien Port, keine Wartezeit und keine Aufräumarbeit - und die Prüfungen laufen in
 * derselben Sekunde wie die übrigen.
 *
 * Was hier bewusst NICHT geprüft wird: die Wege, die wirklich zu einem IMAP-Server
 * gehen. Dafür bräuchte es einen Testserver (Greenmail o.ä.), und ohne Docker ist der
 * auf diesem Rechner nicht zu haben. Geprüft wird deshalb alles davor: die
 * Eingangskontrolle, die Fehlerzuordnung und die Routen, die auf den lokalen Ablagen
 * arbeiten. Das ist genau der Teil, den ein Client zu Gesicht bekommt, wenn er etwas
 * falsch macht.
 */

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => Promise<void> | void): Promise<void> {
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

// Eigener Datenordner - die Prüfung fasst weder Konten noch Ablage des Nutzers an.
const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-routen-'));
setDataDir(ORDNER);
// Die Pruefungen rufen die Speicher unmittelbar auf - ohne Anfrage, die den
// Nutzerkontext mitbraechte. Dieser Prozess arbeitet durchgehend als ein Nutzer.
betreteNutzerFuerProzess('pruefung');


/*
 * Ein Schlüssel, der nicht von der Maschine abhängt.
 *
 * Im Betrieb versiegelt Windows die Zugangsdaten über safeStorage. Hier ginge das nicht
 * - die Prüfung läuft ohne Electron -, und es soll auch nicht: sie soll auf jedem
 * Rechner dasselbe tun, auch auf dem Bauknecht bei GitHub.
 */
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

/*
 * Den Nutzer anlegen, unter dem diese Pruefung arbeitet.
 *
 * buildServer() richtet von sich aus nur den Einplatznutzer "lokal" ein. Ohne einen
 * Eintrag fuer "pruefung" gaebe es keinen Schluessel, mit dem sich dessen Geheimnisse
 * verschluesseln liessen - und das Anlegen eines Kontos schluege fehl.
 */
const { stelleEinplatznutzerSicher } = await import('./nutzer/einrichten.js');
stelleEinplatznutzerSicher('pruefung', 'pruefung@beispiel.de');

const { buildServer } = await import('./app.js');
/*
 * Der Server arbeitet unter demselben Nutzer wie die Vorbereitung.
 *
 * Ohne diese Angabe liefe jede Anfrage als "lokal" (der Einplatznutzer), waehrend
 * legeKontoAn() weiter unten die Konten unmittelbar als "pruefung" anlegt - und dann
 * faende die Route sie nicht. Das ist kein Fehler, sondern die Trennung der Nutzer bei
 * der Arbeit: Daten des einen sind fuer den anderen nicht da.
 */
const app = await buildServer({ nutzerErmitteln: () => 'pruefung' });

/** Kurzform für eine Anfrage. */
const ruf = (methode: string, pfad: string, koerper?: unknown) =>
  app.inject({
    method: methode as 'GET',
    url: pfad,
    ...(koerper === undefined ? {} : { payload: koerper as object }),
  });

console.log('\nWas es ohne Konto gibt:');

await pruefe('die Kontenliste ist leer, nicht kaputt', async () => {
  const a = await ruf('GET', '/accounts');
  assert.equal(a.statusCode, 200);
  assert.deepEqual(a.json(), []);
});

await pruefe('eine unbekannte Route ergibt 404, keinen Absturz', async () => {
  const a = await ruf('GET', '/gibt-es-nicht');
  assert.equal(a.statusCode, 404);
});

console.log('\nEin Konto, das es nicht gibt:');

const ERFUNDEN = '00000000-0000-0000-0000-000000000000';

await pruefe('liefert überall 404 mit deutscher Meldung', async () => {
  /*
   * Reihum durch die Routen, die ein Konto brauchen. Vorher konnte jede einzelne
   * anders reagieren - eine mit 404, die nächste mit einem 500er aus dem Innenleben,
   * weil sie das fehlende Konto erst beim Zugriff bemerkte.
   */
  const wege: [string, string, unknown?][] = [
    ['GET', `/accounts/${ERFUNDEN}/folders`],
    ['GET', `/accounts/${ERFUNDEN}/capabilities`],
    ['GET', `/accounts/${ERFUNDEN}/rules`],
    ['GET', `/accounts/${ERFUNDEN}/snoozed`],
    ['GET', `/accounts/${ERFUNDEN}/offen`],
    ['GET', `/accounts/${ERFUNDEN}/folders/INBOX/messages`],
    ['POST', `/accounts/${ERFUNDEN}/folders/INBOX/messages/delete`, { uids: [1] }],
    ['POST', `/accounts/${ERFUNDEN}/send`, { to: ['a@b.de'], subject: 'x' }],
  ];
  for (const [methode, pfad, koerper] of wege) {
    const a = await ruf(methode, pfad, koerper);
    assert.equal(a.statusCode, 404, `${methode} ${pfad} ergab ${a.statusCode}`);
    assert.match(a.json().error, /Konto nicht gefunden/, `${methode} ${pfad}`);
  }
});

console.log('\nEingangskontrolle - was ein Client falsch machen kann:');

/** Ein Konto anlegen, ohne dass dafür ein Server erreichbar sein müsste. */
async function legeKontoAn(): Promise<string> {
  const { buildPasswordAccount, saveAccount } = await import('./accountStore.js');
  const konto = buildPasswordAccount({
    email: 'probe@beispiel.de',
    password: 'geheim',
    // Die Adressen ausdrücklich, weil "beispiel.de" kein Anbieter ist, den die
    // Serversuche kennt - und die soll hier auch gar nicht loslaufen.
    overrides: {
      imapHost: 'imap.beispiel.invalid',
      imapPort: 993,
      smtpHost: 'smtp.beispiel.invalid',
      smtpPort: 465,
    },
  });
  saveAccount(konto);
  return konto.id;
}

const KONTO = await legeKontoAn();

await pruefe('das angelegte Konto steht in der Liste - ohne sein Kennwort', async () => {
  const a = await ruf('GET', '/accounts');
  assert.equal(a.statusCode, 200);
  const liste = a.json() as { id: string; email: string }[];
  assert.equal(liste.length, 1);
  assert.equal(liste[0]!.email, 'probe@beispiel.de');
  // Das Wichtigste an dieser Route: was sie NICHT herausgibt.
  assert.ok(!JSON.stringify(liste).includes('geheim'), 'das Kennwort ging mit hinaus');
  assert.ok(!JSON.stringify(liste).toLowerCase().includes('password'), JSON.stringify(liste));
});

await pruefe('Verschieben ohne Zielordner wird abgelehnt', async () => {
  const a = await ruf('POST', `/accounts/${KONTO}/folders/INBOX/messages/move`, { uids: [1] });
  assert.equal(a.statusCode, 400);
  assert.match(a.json().error, /targetFolder/);
});

await pruefe('Wiedervorlage ohne Zeitpunkt wird abgelehnt', async () => {
  const a = await ruf('POST', `/accounts/${KONTO}/folders/INBOX/snooze`, { uid: 5 });
  assert.equal(a.statusCode, 400);
});

await pruefe('Wiedervorlage in der Vergangenheit wird abgelehnt', async () => {
  // Sonst käme die Nachricht sofort wieder - was aussieht, als sei nichts geschehen.
  const a = await ruf('POST', `/accounts/${KONTO}/folders/INBOX/snooze`, {
    uid: 5,
    faellig: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(a.statusCode, 400);
  assert.match(a.json().error, /Vergangenheit/);
});

await pruefe('eine unbrauchbare UID wird abgelehnt', async () => {
  for (const uid of [0, -3, 1.5, 'abc']) {
    const a = await ruf('POST', `/accounts/${KONTO}/folders/INBOX/snooze`, {
      uid,
      faellig: new Date(Date.now() + 600_000).toISOString(),
    });
    assert.equal(a.statusCode, 400, `uid ${JSON.stringify(uid)} kam durch`);
  }
});

console.log('\nDie Ablagen, die ohne Postfach auskommen:');

await pruefe('Etiketten: die Vorgaben von Thunderbird sind da', async () => {
  // Ein frischer Ordner ist nicht leer: die fuenf Vorgaben werden angelegt, damit
  // Etiketten aus Thunderbird von Anfang an dieselben Namen tragen.
  const liste = await ruf('GET', '/etiketten');
  assert.equal(liste.statusCode, 200);
  const alle = liste.json() as { schluessel: string; name: string }[];
  assert.ok(alle.length >= 5, JSON.stringify(alle));
  assert.ok(
    alle.some((e) => e.schluessel === '$label1' && e.name === 'Wichtig'),
    JSON.stringify(alle),
  );
});

await pruefe('Etiketten: anlegen, lesen, entfernen', async () => {
  const vorher = ((await ruf('GET', '/etiketten')).json() as unknown[]).length;

  const angelegt = await ruf('PUT', '/etiketten', { name: 'Steuerbelege', farbe: '#c1121f' });
  assert.equal(angelegt.statusCode, 200, JSON.stringify(angelegt.json()));

  const alle = (await ruf('GET', '/etiketten')).json() as { schluessel: string; name: string }[];
  const neues = alle.find((e) => e.name === 'Steuerbelege');
  assert.ok(neues, JSON.stringify(alle));
  assert.equal(alle.length, vorher + 1);

  const weg = await ruf('DELETE', `/etiketten/${neues.schluessel}`);
  assert.equal(weg.statusCode, 200);
  assert.equal(((await ruf('GET', '/etiketten')).json() as unknown[]).length, vorher);
});

await pruefe('derselbe Etikettenname ein zweites Mal wird abgelehnt', async () => {
  // Zwei Etiketten "Wichtig" waeren in der Liste nicht auseinanderzuhalten.
  const a = await ruf('PUT', '/etiketten', { name: 'Wichtig', farbe: '#000000' });
  assert.equal(a.statusCode, 400);
  assert.match(a.json().error, /gibt es schon/);
});

await pruefe('Adressbuch: eintragen und wiederfinden', async () => {
  const eingetragen = await ruf('PUT', '/adressbuch', {
    address: 'anna@firma.de',
    name: 'Anna Bauer',
  });
  assert.equal(eingetragen.statusCode, 200, JSON.stringify(eingetragen.json()));

  const liste = await ruf('GET', '/adressbuch');
  assert.equal(liste.statusCode, 200);
  // Die Route liefert eine Kontaktliste, kein nacktes Feld.
  const { eintraege } = liste.json() as { eintraege: { address: string; name?: string }[] };
  assert.ok(
    eintraege.some((k) => k.address === 'anna@firma.de' && k.name === 'Anna Bauer'),
    JSON.stringify(eintraege),
  );
});

await pruefe('Regeln: anlegen und wieder loswerden', async () => {
  const angelegt = await ruf('PUT', `/accounts/${KONTO}/rules`, {
    name: 'Werbung weg',
    bedingungen: { von: 'werbung@' },
    aktionen: { verschiebeNach: 'Spam' },
  });
  assert.equal(angelegt.statusCode, 200, JSON.stringify(angelegt.json()));

  const liste = await ruf('GET', `/accounts/${KONTO}/rules`);
  const regeln = liste.json() as { id: string; name: string }[];
  assert.ok(
    regeln.some((r) => r.name === 'Werbung weg'),
    JSON.stringify(regeln),
  );

  const weg = await ruf('DELETE', `/accounts/${KONTO}/rules/${regeln[0]!.id}`);
  assert.equal(weg.statusCode, 200);
});

console.log('\nOrdnernamen, die Ärger machen:');

await pruefe('ein Schrägstrich im Ordnernamen kommt unversehrt an', async () => {
  /*
   * "Projekte/2026" ist bei IMAP ein gewöhnlicher Ordner, in einer Adresse aber ein
   * Trennzeichen. Kommt er unmaskiert durch, sucht der Server in "Projekte" statt in
   * "Projekte/2026" - und findet nichts, ohne dass jemand merkt, warum.
   *
   * Geprüft wird an der Meldung: das Konto ist erfunden, der Server kommt also nie an
   * einen Postfachserver. Entscheidend ist, dass die Route den Namen überhaupt annimmt
   * und nicht schon an der Adresse scheitert.
   */
  const a = await ruf('GET', `/accounts/${KONTO}/folders/${encodeURIComponent('Projekte/2026')}/messages`);
  // 404 wäre "Konto nicht gefunden" - das Konto gibt es. Erwartet wird ein Fehler beim
  // Verbinden, nicht bei der Wegfindung.
  assert.notEqual(a.statusCode, 404, `die Route hat den Namen nicht angenommen: ${a.body}`);
});

await pruefe('Umlaute im Ordnernamen ebenso', async () => {
  const a = await ruf('GET', `/accounts/${KONTO}/folders/${encodeURIComponent('Entwürfe')}/messages`);
  assert.notEqual(a.statusCode, 404, a.body);
});

console.log('\nWenn das Postfach nicht erreichbar ist:');

await pruefe('kein Serverfehler, sondern eine Auskunft', async () => {
  /*
   * Der Host "imap.beispiel.invalid" gibt es nicht - die Namensauflösung scheitert.
   * Genau das erlebt jeder Nutzer im Zug. Die Antwort darf kein nackter 500er sein,
   * denn der sagt "hier ist etwas kaputt", und kaputt ist nichts.
   */
  const a = await ruf('GET', `/accounts/${KONTO}/folders`);
  // 503 heisst "gerade nicht erreichbar". 500 hiesse "hier ist etwas kaputt", und
  // kaputt ist nichts - es fehlt nur die Verbindung.
  assert.equal(a.statusCode, 503, `stattdessen ${a.statusCode}: ${a.body.slice(0, 160)}`);

  const meldung = String(a.json().error ?? '');
  assert.match(meldung, /nicht erreichbar/);
  // Nicht der nackte Systemfehler: "getaddrinfo ENOTFOUND" sagt einem Nutzer nichts.
  assert.ok(
    !/getaddrinfo|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(meldung),
    `unübersetzte Systemmeldung: ${meldung}`,
  );
  // Und der Hostname gehoert nicht in die Oberflaeche - er steht im Protokoll.
  assert.ok(!meldung.includes('beispiel.invalid'), meldung);
});

await pruefe('dasselbe beim Abruf einer Nachrichtenliste', async () => {
  // Nicht nur die eine Route: der Fehlerbehandler gilt fuer alle, und genau das soll
  // hier festgehalten werden.
  const a = await ruf('GET', `/accounts/${KONTO}/folders/INBOX/messages`);
  assert.equal(a.statusCode, 503, `stattdessen ${a.statusCode}: ${a.body.slice(0, 160)}`);
});

await pruefe('eine abgelehnte Anmeldung bleibt davon unberührt', async () => {
  /*
   * Wichtige Abgrenzung: ein falsches Kennwort ist kein Netzproblem. Wuerde es als
   * solches durchgehen, saehe der Nutzer "nicht erreichbar" und suchte am Router,
   * statt sein Kennwort zu berichtigen.
   */
  const { istVerbindungsfehler } = await import('./verbindungsfehler.js');
  const abgelehnt = Object.assign(new Error('Invalid credentials'), {
    authenticationFailed: true,
    code: 'ENOTFOUND',
  });
  assert.equal(istVerbindungsfehler(abgelehnt), false);
});

console.log('\nDie von der Organisation vorgegebene Anmeldung:');

await pruefe('ohne Vorgabe traegt der Nutzer selbst ein', async () => {
  const a = await ruf('PUT', '/oauth/clients/google', {
    clientId: 'eigene-id.apps.googleusercontent.com',
    clientSecret: 'geheim',
  });
  assert.equal(a.statusCode, 200);
  const stand = a.json() as Record<string, { configured: boolean; vorgegeben?: boolean }>;
  assert.equal(stand.google!.configured, true);
  assert.ok(!stand.google!.vorgegeben);
});

await pruefe('eine Vorgabe schlaegt den eigenen Eintrag', async () => {
  /*
   * Die Entscheidung, um die es geht. Duerfte der oertliche Eintrag gewinnen, liefe die
   * Anmeldung an der Anwendung der Organisation vorbei - mit einer zweiten
   * Zustimmungsseite und Anmeldungen, die kein Administrator im Blick hat.
   */
  setzeOAuthVorgabe((anbieter) =>
    anbieter === 'google' ? { clientId: 'firmen-id', clientSecret: 'firmengeheim' } : null,
  );
  try {
    const stand = (await ruf('GET', '/oauth/clients')).json() as Record<
      string,
      { clientId?: string; vorgegeben?: boolean }
    >;
    assert.equal(stand.google!.clientId, 'firmen-id');
    assert.equal(stand.google!.vorgegeben, true);
    // Der andere Anbieter bleibt unberuehrt - eine Vorgabe je Anbieter.
    assert.ok(!stand.microsoft!.vorgegeben);
  } finally {
    setzeOAuthVorgabe(null);
  }
});

await pruefe('gegen eine Vorgabe laesst sich nichts speichern', async () => {
  // Abgewiesen statt still ignoriert: gespeichert und wirkungslos waere die schlechteste
  // Antwort - der Nutzer saehe eine Bestaetigung, und es aenderte sich nichts.
  setzeOAuthVorgabe(() => ({ clientId: 'firmen-id' }));
  try {
    const a = await ruf('PUT', '/oauth/clients/google', { clientId: 'meine-eigene' });
    assert.equal(a.statusCode, 409);
    assert.match(a.json().error ?? '', /Organisation/);

    const b = await ruf('DELETE', '/oauth/clients/google');
    assert.equal(b.statusCode, 409, 'entfernen ging trotz Vorgabe');
  } finally {
    setzeOAuthVorgabe(null);
  }
});

await pruefe('der eigene Eintrag ueberlebt die Vorgabe', async () => {
  // Faellt die Richtlinie weg (Rechnerwechsel, Heimarbeit), soll wieder gelten, was der
  // Nutzer vorher hatte - und nicht nichts.
  const stand = (await ruf('GET', '/oauth/clients')).json() as Record<string, { clientId?: string }>;
  assert.equal(stand.google!.clientId, 'eigene-id.apps.googleusercontent.com');
});

console.log('\nSicherheitskopfzeilen:');

await pruefe('ueber http kommt KEIN HSTS mit', async () => {
  /*
   * Der Grund, warum die Kopfzeile nicht einfach immer gesetzt wird: der Server spricht
   * http, die Verschluesselung endet am Vorbau. Wer HSTS von hier aus verspraeche, ohne
   * dass TLS im Spiel ist, verspraeche etwas, das er nicht haelt - und im Einplatzbetrieb
   * (127.0.0.1) sperrte er sich womoeglich selbst aus.
   */
  const a = await ruf('GET', '/accounts');
  assert.equal(a.headers['strict-transport-security'], undefined);
  // Die uebrigen gelten dagegen immer.
  assert.equal(a.headers['x-frame-options'], 'DENY');
  assert.equal(a.headers['x-content-type-options'], 'nosniff');
  assert.equal(a.headers['referrer-policy'], 'no-referrer');
});

await pruefe('hinter einem TLS-Vorbau schon', async () => {
  // So meldet ein Reverse Proxy die abgeschlossene TLS-Strecke.
  const a = await app.inject({
    method: 'GET',
    url: '/accounts',
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.match(String(a.headers['strict-transport-security']), /max-age=\d+/);
});

console.log('\nDer zwischengespeicherte Bestand:');

await pruefe('nachsehen, was auf der Platte liegt', async () => {
  const a = await ruf('GET', '/ablage');
  assert.equal(a.statusCode, 200);
  const stand = a.json() as { bytes: number; nachrichten: number; inhalte: number };
  // Die Zahlen selbst haengen davon ab, was die Pruefungen davor abgelegt haben - dass
  // es drei Zahlen sind, ist der Punkt.
  for (const feld of ['bytes', 'nachrichten', 'inhalte'] as const) {
    assert.equal(typeof stand[feld], 'number', `${feld} fehlt: ${a.body}`);
  }
});

await pruefe('und ihn wegwerfen', async () => {
  /*
   * Der Knopf fuer den Rechner, der weitergegeben wird. Was hier liegt, ist die
   * eigentliche Post - Betreffzeilen, Absender, der Wortlaut der zuletzt gelesenen
   * Nachrichten -, und anders als die Zugangsdaten liegt es unverschluesselt da.
   */
  const a = await ruf('DELETE', '/ablage');
  assert.equal(a.statusCode, 200);
  const weg = a.json() as { nachrichten: number; inhalte: number };
  assert.equal(typeof weg.nachrichten, 'number', a.body);

  const danach = (await ruf('GET', '/ablage')).json() as { nachrichten: number; inhalte: number };
  assert.equal(danach.nachrichten, 0, 'es liegt noch etwas da');
  assert.equal(danach.inhalte, 0);
});

await pruefe('die Konten ueberleben das Leeren', async () => {
  // Die Ablage ist ein Abbild, kein Original. Wer sie leert, soll nicht sein Postfach
  // neu einrichten muessen.
  const a = await ruf('GET', '/accounts');
  assert.equal(a.statusCode, 200);
  assert.ok(a.body.includes('probe@beispiel.de'), a.body.slice(0, 200));
});

console.log('\nSicherung und Umzug - der ganze Weg:');

await pruefe('die Sicherung enthaelt kein Geheimnis', async () => {
  /*
   * Die eine Zusicherung, auf der alles beruht. Geprueft am tatsaechlichen Inhalt der
   * Antwort, nicht an der Absicht: das Konto oben wurde mit dem Kennwort "geheim"
   * angelegt, und genau danach wird hier gesucht.
   */
  const a = await ruf('GET', '/sicherung');
  assert.equal(a.statusCode, 200);
  const text = a.body;
  assert.ok(!text.includes('geheim'), 'das Kennwort steht in der Sicherung');
  assert.ok(!/"pass"|"accessToken"|"refreshToken"/.test(text), text.slice(0, 200));
  // Was gebraucht wird, ist aber drin.
  assert.ok(text.includes('probe@beispiel.de'));
  assert.ok(text.includes('imap.beispiel.invalid'));
});

await pruefe('sie nennt in der Datei selbst, was fehlt', async () => {
  // Sonst liest jemand sie ein und wundert sich, warum nichts abgerufen wird.
  const d = (await ruf('GET', '/sicherung')).json() as { hinweis: string };
  assert.match(d.hinweis, /Kennw/);
  assert.match(d.hinweis, /neu angemeldet/);
});

await pruefe('der Rundlauf: einlesen bringt an, was fehlt', async () => {
  const fremd = {
    fassung: 1,
    erstelltAm: new Date().toISOString(),
    programm: 'Energy Mail',
    konten: [
      {
        email: 'umzug@beispiel.de',
        imapHost: 'imap.umzug.invalid',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.umzug.invalid',
        smtpPort: 465,
        smtpSecure: true,
        displayName: 'Umgezogen',
        anmeldung: 'password',
      },
    ],
    etiketten: [{ name: 'Umzugskiste', farbe: '#123456' }],
    regeln: { 'umzug@beispiel.de': [{ name: 'Werbung', bedingungen: { von: 'x@' }, aktionen: {} }] },
    kontakte: [{ address: 'nachbar@beispiel.de', name: 'Neuer Nachbar' }],
    suchen: [],
    hinweis: 'x',
  };

  const a = await ruf('POST', '/sicherung', fremd);
  assert.equal(a.statusCode, 200, a.body);
  const b = a.json() as Record<string, { uebernommen: number; schonDa: number }>;
  assert.equal(b.konten!.uebernommen, 1, JSON.stringify(b));
  assert.equal(b.etiketten!.uebernommen, 1, JSON.stringify(b));
  assert.equal(b.kontakte!.uebernommen, 1, JSON.stringify(b));

  // Und jetzt der Nachweis, dass es wirklich angekommen ist.
  const konten = (await ruf('GET', '/accounts')).json() as { email: string; needsReauth?: boolean }[];
  const neu = konten.find((k) => k.email === 'umzug@beispiel.de');
  assert.ok(neu, JSON.stringify(konten));
  // Ohne Kennwort kommt es nirgendwohin - der Nutzer muss es sehen und anmelden.
  assert.equal(neu.needsReauth, true, 'das Konto ist nicht als anzumelden gekennzeichnet');

  const etiketten = (await ruf('GET', '/etiketten')).json() as { name: string }[];
  assert.ok(etiketten.some((e) => e.name === 'Umzugskiste'), JSON.stringify(etiketten));
});

await pruefe('zweimal einlesen legt nichts doppelt an', async () => {
  /*
   * Wer unsicher ist, klickt zweimal. Wuerde dabei alles verdoppelt, waere das
   * Einlesen selbst der Schaden - zwei Konten derselben Adresse, jedes Etikett zweimal.
   */
  const vorherKonten = ((await ruf('GET', '/accounts')).json() as unknown[]).length;
  const vorherEtiketten = ((await ruf('GET', '/etiketten')).json() as unknown[]).length;

  const nochmal = await ruf('POST', '/sicherung', {
    fassung: 1,
    konten: [
      {
        email: 'umzug@beispiel.de',
        imapHost: 'imap.umzug.invalid',
        imapPort: 993,
        imapSecure: true,
        smtpHost: 'smtp.umzug.invalid',
        smtpPort: 465,
        smtpSecure: true,
        anmeldung: 'password',
      },
    ],
    etiketten: [{ name: 'Umzugskiste', farbe: '#123456' }],
  });
  assert.equal(nochmal.statusCode, 200);
  const b = nochmal.json() as Record<string, { uebernommen: number; schonDa: number }>;
  assert.equal(b.konten!.uebernommen, 0);
  assert.equal(b.konten!.schonDa, 1);
  assert.equal(b.etiketten!.uebernommen, 0);

  assert.equal(((await ruf('GET', '/accounts')).json() as unknown[]).length, vorherKonten);
  assert.equal(((await ruf('GET', '/etiketten')).json() as unknown[]).length, vorherEtiketten);
});

await pruefe('eine Datei, die keine Sicherung ist, wird abgelehnt', async () => {
  for (const unfug of [{ irgendwas: true }, { fassung: 'zwei' }, { fassung: 99 }]) {
    const a = await ruf('POST', '/sicherung', unfug);
    assert.equal(a.statusCode, 400, `${JSON.stringify(unfug)} kam durch`);
    assert.ok(String(a.json().error).length > 10, 'keine brauchbare Begruendung');
  }
});

console.log('\nDie Abwesenheitsnotiz am Draht:');

await pruefe('sie ist erst einmal aus, und die Vorgaben stehen da', async () => {
  const a = await ruf('GET', `/accounts/${KONTO}/abwesenheit`);
  assert.equal(a.statusCode, 200);
  assert.equal(a.json().aktiv, false);
  assert.equal(a.json().wiederholungTage, 4);
});

await pruefe('eingeschaltet ohne Text wird abgewiesen', async () => {
  /*
   * Sie ginge sonst als leere Mail hinaus - und das ist schlimmer als keine Antwort:
   * Der Absender denkt, er sei abgewimmelt worden.
   */
  const a = await ruf('PUT', `/accounts/${KONTO}/abwesenheit`, { aktiv: true, text: '  ' });
  assert.equal(a.statusCode, 400);
  assert.match(a.json().error, /Text/);
});

await pruefe('ein Ende vor dem Anfang wird abgewiesen', async () => {
  const a = await ruf('PUT', `/accounts/${KONTO}/abwesenheit`, {
    aktiv: true,
    text: 'Bin weg.',
    von: '2026-08-20',
    bis: '2026-08-10',
  });
  assert.equal(a.statusCode, 400);
});

await pruefe('gespeichert wird sie, und /abwesenheit nennt das Konto', async () => {
  const a = await ruf('PUT', `/accounts/${KONTO}/abwesenheit`, {
    aktiv: true,
    text: 'Bin bis zum 14. weg.',
  });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().aktiv, true);

  const b = await ruf('GET', '/abwesenheit');
  assert.deepEqual(b.json().aktiv, [KONTO]);
});

await pruefe('ein abgelaufener Zeitraum zaehlt nicht mehr als aktiv', async () => {
  /*
   * Der Hinweis in der Seitenleiste soll sagen, ob gerade wirklich geantwortet wird -
   * nicht, ob irgendwann einmal ein Schalter umgelegt wurde. Sonst mahnt er ein halbes
   * Jahr lang wegen eines Urlaubs, der vorbei ist.
   */
  await ruf('PUT', `/accounts/${KONTO}/abwesenheit`, {
    aktiv: true,
    text: 'War weg.',
    von: '2020-01-01',
    bis: '2020-01-14',
  });
  const b = await ruf('GET', '/abwesenheit');
  assert.deepEqual(b.json().aktiv, []);
});

await pruefe('ein Konto, das es nicht gibt, ergibt 404', async () => {
  const a = await ruf('GET', `/accounts/${ERFUNDEN}/abwesenheit`);
  assert.equal(a.statusCode, 404);
});

/*
 * Ob OAuth angeboten werden darf - und warum das der Server entscheidet.
 *
 * Der OAuth-Ablauf oeffnet einen kurzlebigen Horcher auf 127.0.0.1 und gibt dem Anbieter
 * genau diese Adresse als Rueckleitung mit (oauthFlow.ts). Das geht auf, solange Browser
 * und Dienst auf demselben Rechner laufen. Im Serverbetrieb tun sie das nicht: 127.0.0.1
 * ist dann der Rechner des BENUTZERS, dort horcht niemand, und die Anmeldung endet in
 * einer Fehlerseite.
 *
 * Die Oberflaeche blendet die beiden Knoepfe deshalb aus - aber nur, wenn der Server es
 * ihr sagt. Diese Pruefung haelt fest, dass er es richtig sagt: Sobald eine oeffentliche
 * Adresse gesetzt ist, ist der Dienst fuer andere Rechner gedacht, und damit ist der
 * Rueckweg tot.
 */
console.log('\nOAuth im Serverbetrieb:');

const { setzeOeffentlicheAdresse } = await import('./zugang.js');

await pruefe('ohne oeffentliche Adresse wird OAuth angeboten', async () => {
  setzeOeffentlicheAdresse(null);
  const antwort = await app.inject({ method: 'GET', url: '/ich' });
  assert.equal(antwort.statusCode, 200);
  assert.equal(antwort.json().oauthMoeglich, true);
});

await pruefe('mit oeffentlicher Adresse nicht mehr', async () => {
  setzeOeffentlicheAdresse('https://mail.beispiel.de');
  const antwort = await app.inject({ method: 'GET', url: '/ich' });
  assert.equal(antwort.statusCode, 200);
  assert.equal(
    antwort.json().oauthMoeglich,
    false,
    'Der Server bietet OAuth an, obwohl der Rueckweg auf 127.0.0.1 ins Leere fuehrt',
  );
  // Nicht auf die naechste Pruefung abfaerben lassen - der Wert steht im Modul.
  setzeOeffentlicheAdresse(null);
});

await app.close();
try {
  fs.rmSync(ORDNER, { recursive: true, force: true });
} catch {
  // Unter Windows hält SQLite die Ablagedatei noch einen Moment. Ein liegengebliebener
  // Ordner im Temp-Verzeichnis ist kein Grund, die Prüfung scheitern zu lassen.
}

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);

/*
 * Ausdrücklich beenden, auch bei Erfolg.
 *
 * buildServer() richtet Zeitgeber ein - die Wiedervorlagen, die Warteschlange fürs
 * Senden, die Auffrischung der Zugangsmarken. Die halten den Prozess am Leben, auch
 * wenn Fastify längst geschlossen ist. Ohne diese Zeile lief die Prüfung durch und der
 * Befehl kehrte nie zurück; in der Bauwerkstatt wäre das ein Lauf ins Zeitlimit
 * gewesen, ohne erkennbaren Grund.
 */
process.exit(ok === gesamt ? 0 : 1);
