import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/*
 * Der Anmeldeweg ueber HTTP - so, wie ihn ein Browser geht.
 *
 * Die Pruefungen daneben nehmen die Bausteine einzeln. Hier laufen sie zusammen: Keks,
 * Zugangsriegel, Nutzerkontext und Routen. Genau an solchen Nahtstellen sitzen die
 * Fehler, die einzeln geprueften Teilen entgehen - etwa eine Route, die ohne Anmeldung
 * antwortet, weil der Haken sie versehentlich durchlaesst.
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-anmeldeweg-test-'));
setDataDir(tempDir);
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const { legeNutzerAn } = await import('./nutzerStore.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { KEKS_NAME } = await import('./anmelden.js');
const { buildServer } = await import('../app.js');

legeNutzerAn(
  { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  verpackeNutzerschluessel,
);

/*
 * Kein nutzerErmitteln uebergeben: der Server soll genau den Weg gehen, den er im
 * Serverbetrieb geht - Sitzung aus dem Keks. Ein Zugangsgeheimnis ist nicht gesetzt,
 * also greift der Huellen-Weg nicht.
 */
const app = await buildServer();

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => Promise<void> | void): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/** Holt den Sitzungskeks aus einer Antwort. */
function keksAus(antwort: { cookies: unknown[] }): string | undefined {
  const kekse = antwort.cookies as { name: string; value: string }[];
  return kekse.find((k) => k.name === KEKS_NAME)?.value;
}

console.log('\nDie Oberflaeche selbst kommt ohne Anmeldung heraus:');

await pruefe('"/" wird ausgeliefert, nicht mit 401 abgewiesen', async () => {
  /*
   * Der Fehler, den erst das Starten der paketierten Anwendung zutage gebracht hat:
   * das Fenster laedt "/" als gewoehnliche Navigation und kann dabei weder eine
   * Kopfzeile setzen noch einen Keks mitgeben, den es noch gar nicht gibt. Der Server
   * antwortete mit 401, und das Fenster zeigte die JSON-Fehlermeldung statt des
   * Mailprogramms.
   *
   * 404 ist hier in Ordnung: in der Pruefung gibt es kein gebautes Frontend, das
   * ausgeliefert werden koennte. Es geht darum, dass NICHT 401 zurueckkommt.
   */
  const antwort = await app.inject({ method: 'GET', url: '/' });
  assert.notEqual(antwort.statusCode, 401, 'die Oberflaeche wurde abgewiesen');
  assert.notEqual(antwort.statusCode, 403);
});

await pruefe('und ihre Bestandteile ebenso', async () => {
  for (const pfad of ['/index.html', '/assets/haupt.js', '/thema-vorab.js', '/favicon.ico']) {
    const antwort = await app.inject({ method: 'GET', url: pfad });
    assert.notEqual(antwort.statusCode, 401, `${pfad} wurde abgewiesen`);
  }
});

console.log('\nOhne Anmeldung kommt niemand an Postfachdaten:');

await pruefe('/accounts wird abgewiesen', async () => {
  const antwort = await app.inject({ method: 'GET', url: '/accounts' });
  assert.equal(antwort.statusCode, 401);
  assert.ok(!antwort.body.includes('imapHost'));
});

await pruefe('auch schreibende Wege - die Wirkung genuegt dem Angreifer', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/accounts/irgendwas/send',
    payload: { to: ['opfer@beispiel.de'] },
  });
  assert.equal(antwort.statusCode, 401);
});

await pruefe('und die Sicherung, die das ganze Adressbuch herausgibt', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/sicherung' })).statusCode, 401);
});

await pruefe('ein erfundener Keks hilft nicht', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    cookies: { [KEKS_NAME]: 'ausgedacht' },
  });
  assert.equal(antwort.statusCode, 401);
});

console.log('\nAnmelden:');

await pruefe('mit falschem Kennwort gibt es keinen Keks', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'falsch-und-lang' },
  });
  assert.equal(antwort.statusCode, 401);
  assert.equal(keksAus(antwort), undefined);
});

await pruefe('die Meldung verraet nicht, ob es die Adresse gibt', async () => {
  const bekannt = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'falsch-und-lang' },
  });
  const unbekannt = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'gibtsnicht@beispiel.de', kennwort: 'falsch-und-lang' },
  });
  assert.equal(bekannt.body, unbekannt.body);
});

let keks = '';

await pruefe('mit richtigem Kennwort kommt ein Keks', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  });
  assert.equal(antwort.statusCode, 200);
  keks = keksAus(antwort) ?? '';
  assert.ok(keks, 'kein Sitzungskeks in der Antwort');
});

await pruefe('der Keks ist fuer Skript unerreichbar und nicht seitenuebergreifend', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  });
  const gesetzt = (antwort.cookies as { name: string; httpOnly?: boolean; sameSite?: string }[]).find(
    (k) => k.name === KEKS_NAME,
  );
  assert.equal(gesetzt?.httpOnly, true, 'ohne httpOnly liest ihn jedes Skript aus');
  assert.equal(
    String(gesetzt?.sameSite).toLowerCase(),
    'strict',
    'ohne Strict schickt der Browser ihn bei fremden Anfragen mit',
  );
});

await pruefe('das Kennwort steht nicht in der Antwort', async () => {
  const antwort = await app.inject({
    method: 'POST',
    url: '/anmelden',
    payload: { email: 'anna@beispiel.de', kennwort: 'ein-langes-kennwort' },
  });
  assert.ok(!antwort.body.includes('ein-langes-kennwort'));
  assert.ok(!antwort.body.includes('scrypt'), 'auch nicht die Pruefsumme');
});

console.log('\nMit Keks:');

await pruefe('/accounts antwortet', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/accounts',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.equal(antwort.statusCode, 200);
  assert.deepEqual(JSON.parse(antwort.body), [], 'Anna hat noch kein Konto');
});

await pruefe('/ich nennt den angemeldeten Nutzer', async () => {
  const antwort = await app.inject({
    method: 'GET',
    url: '/ich',
    cookies: { [KEKS_NAME]: keks },
  });
  /*
   * Feld fuer Feld verglichen und nicht nur stichprobenartig.
   *
   * Das ist der Sinn dieser Zeile: Sie faengt jedes Feld, das jemand spaeter hinzufuegt,
   * und zwingt zu der Frage, ob es hier hinausgehen darf. /ich antwortet ohne Anmeldung
   * und ist damit die freizuegigste Auskunft des Servers.
   */
  assert.deepEqual(JSON.parse(antwort.body), {
    angemeldet: true,
    // Ob die Sitzung gerade zu ist - die Oberflaeche fragt beim Start danach.
    gesperrt: false,
    // Nach wie vielen Minuten Untaetigkeit gesperrt wird; die Oberflaeche sperrt selbst,
    // weil der Server Untaetigkeit erst bei der naechsten Anfrage sieht.
    sperreNachMinuten: 60,
    /*
     * Ob dieser Mensch verwalten darf - hier: ja, und das ist kein Zufall.
     *
     * Anna ist der einzige richtige Nutzer dieser Aufstellung, also hat der Start ihr die
     * Verwalterrolle gegeben (siehe stelleVerwalterSicher). Genau so soll es bei einer
     * bestehenden Aufstellung laufen, in deren nutzer.json noch keine Rolle steht: Sonst
     * haette nach der Aktualisierung niemand Rechte.
     *
     * Die Oberflaeche entscheidet daran nur, ob sie den Weg zur Nutzerverwaltung ANZEIGT.
     * Der Riegel sitzt am Server - verwaltung.test.mts prueft ihn.
     */
    verwalter: true,
    /*
     * Wie viele Anmeldeantraege auf eine Entscheidung warten.
     *
     * Auch diese Zeile ist beim Hinzufuegen des Feldes durchgefallen - und auch hier ist
     * das der Zweck des Vergleichs. Die Auskunft darf hinaus, aber nur an einen
     * Verwalter: Wie viele Menschen an diesem Dienst anklopfen, geht einen gewoehnlichen
     * Nutzer nichts an. Der Server setzt sie fuer alle anderen auf 0, ohne ueberhaupt
     * nachzusehen - siehe anmelden.ts.
     *
     * Hier 0, weil diese Aufstellung keine Selbstanmeldung eingeschaltet hat.
     */
    wartendeAntraege: 0,
    /*
     * Ob ein zweiter Faktor eingerichtet ist - und wie viele Wiederherstellungscodes noch
     * daliegen. Beides ist kein Geheimnis: Es sagt, DASS es einen Faktor gibt, nicht
     * welchen. Das Konto braucht es, um "Ein" oder "Aus" anzuzeigen, und die Zahl, um zu
     * warnen, bevor der letzte Code aufgebraucht ist.
     */
    zweiFaktor: false,
    codesUebrig: 0,
    nutzer: { id: 'anna', email: 'anna@beispiel.de' },
    // Hier haengt die Sitzung an einem Keks - also gibt es etwas abzumelden.
    abmeldbar: true,
    /*
     * Ob OAuth angeboten werden darf.
     *
     * Diese Zeile ist beim Hinzufuegen des Feldes durchgefallen, und genau dafuer ist der
     * Feld-fuer-Feld-Vergleich da: Er zwingt zu der Frage, ob die Auskunft hier
     * hinausgehen darf. Sie darf. Sie sagt aus, ob eine oeffentliche Adresse eingetragen
     * ist - und wer den Dienst ueber eine solche Adresse erreicht, weiss das ohnehin.
     * Ueber Nutzer, Konten oder Zugangsdaten sagt sie nichts.
     *
     * Hier "true", weil diese Pruefung keine oeffentliche Adresse setzt - also der Fall
     * des Einzelplatzes, in dem der Rueckweg auf 127.0.0.1 tatsaechlich ankommt.
     */
    oauthMoeglich: true,
  });
});

await pruefe('/ich gibt nichts Geheimes heraus', async () => {
  // Die Auskunft geht an eine Oberflaeche, die auch im Browser laufen kann.
  const antwort = await app.inject({
    method: 'GET',
    url: '/ich',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.ok(!antwort.body.includes('scrypt'), 'die Kennwortpruefsumme ging mit hinaus');
  assert.ok(!antwort.body.includes('schluessel'), 'der Nutzerschluessel ging mit hinaus');
  assert.ok(!antwort.body.includes(keks), 'die Sitzungskennung ging mit hinaus');
});

await pruefe('/ich ohne Keks sagt "nicht angemeldet" statt 401', async () => {
  // Die Oberflaeche fragt beim Start danach und zeigt dann das Anmeldefenster - eine
  // Fehlermeldung waere hier das falsche Mittel.
  const antwort = await app.inject({ method: 'GET', url: '/ich' });
  assert.equal(antwort.statusCode, 200);
  assert.deepEqual(JSON.parse(antwort.body), { angemeldet: false });
});

console.log('\n/ich in der Desktop-Huelle - ohne Keks, mit Zugangsgeheimnis:');

await pruefe('meldet "angemeldet", nicht "bitte anmelden"', async () => {
  /*
   * Die Falle, die diese Pruefung festhaelt: /ich las urspruenglich NUR den Keks. In der
   * Huelle gibt es keinen - dort weist sich das Fenster ueber das Zugangsgeheimnis des
   * Prozesses aus. Die Antwort waere also "nicht angemeldet" gewesen, und die Huelle
   * haette ein Anmeldefenster gezeigt fuer eine Anmeldung, die es dort gar nicht gibt.
   *
   * Deshalb geht /ich jetzt ueber DENSELBEN Ermittler wie der Nutzerkontext.
   */
  const { setzeZugangsgeheimnis, ZUGANG_KOPFZEILE, erzeugeZugangsgeheimnis } = await import(
    '../zugang.js'
  );
  const geheimnis = erzeugeZugangsgeheimnis();
  setzeZugangsgeheimnis(geheimnis);
  try {
    const huelle = await app.inject({
      method: 'GET',
      url: '/ich',
      headers: { [ZUGANG_KOPFZEILE]: geheimnis },
    });
    const auskunft = JSON.parse(huelle.body) as { angemeldet: boolean; abmeldbar?: boolean };
    assert.equal(auskunft.angemeldet, true, 'die Huelle galt als nicht angemeldet');
    assert.equal(auskunft.abmeldbar, false, 'in der Huelle gibt es nichts abzumelden');
  } finally {
    setzeZugangsgeheimnis(null);
  }
});

console.log('\nAbmelden:');

await pruefe('danach gilt der Keks nicht mehr', async () => {
  const abgemeldet = await app.inject({
    method: 'POST',
    url: '/abmelden',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.equal(abgemeldet.statusCode, 200);

  const danach = await app.inject({
    method: 'GET',
    url: '/accounts',
    cookies: { [KEKS_NAME]: keks },
  });
  assert.equal(danach.statusCode, 401, 'der Keks galt nach dem Abmelden weiter');
});

await app.close();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
