import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { setKeyProvider } from '../secretCrypto.js';

/**
 * Freigegebene Postfaecher - und die Frage, die daran haengt: Haelt die Trennung?
 *
 * Eine Freigabe ist der einzige Weg, auf dem in diesem Dienst ein Mensch an die Daten
 * eines anderen kommt. Der Nutzerkontext, an dem jeder Speicherzugriff haengt, wird dafuer
 * absichtlich gewechselt - und damit ist genau die Schranke aufgemacht, die sonst alles
 * traegt. Dass sie sich danach wieder schliesst, und zwar auf das Konto genau, ist nichts,
 * was man annehmen darf.
 *
 * Deshalb pruefen die meisten Zeilen hier nicht, was geht, sondern was nicht geht:
 *
 *  - Bernd sieht Annas ZWEITES Konto nicht, obwohl er eines von ihr geoeffnet hat.
 *  - Bernd sieht Annas Etiketten nicht - die haengen am Nutzer, nicht am Konto.
 *  - Bernd kommt mit Leserecht nirgends schreibend durch.
 *  - Bernd kann das Konto nicht entfernen, auch nicht mit vollem Zugriff.
 *  - Bernd kann Annas Postfach nicht weiterverschenken.
 *  - Und ein gewoehnlicher Nutzer kommt ueber ein freigegebenes VERWALTERPOSTFACH nicht
 *    in die Verwaltung. Das ist die unangenehmste Falle des ganzen Entwurfs: Der Riegel
 *    dort fragt, wer da ist - und "wer da ist" hat waehrend einer Freigabe zwei Antworten.
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

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-freigaben-'));
setDataDir(ORDNER);
process.on('exit', () => fs.rmSync(ORDNER, { recursive: true, force: true }));
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 3) });

const { legeNutzerAn, setzeRolle } = await import('./nutzerStore.js');
const { richteUmschlagEin } = await import('./einrichten.js');
const { verpackeNutzerschluessel } = await import('./schluesselHuelle.js');
const { alsNutzer } = await import('./kontext.js');
const { buildPasswordAccount, saveAccount } = await import('../accountStore.js');

richteUmschlagEin();

const ANNA = { email: 'anna@beispiel.de', kennwort: 'Sieben Pflaumen im Krug' };
const BERND = { email: 'bernd@beispiel.de', kennwort: 'Acht Birnen im Korb' };
const CHEF = { email: 'chef@beispiel.de', kennwort: 'Neun Kirschen im Glas' };

const anna = legeNutzerAn(ANNA, verpackeNutzerschluessel);
const bernd = legeNutzerAn(BERND, verpackeNutzerschluessel);
const chef = legeNutzerAn(CHEF, verpackeNutzerschluessel);
setzeRolle(chef.id, true);

/** Ein Postfach anlegen, ohne dass dafuer ein Server erreichbar sein muesste. */
function kontoFuer(nutzerId: string, email: string): string {
  return alsNutzer(nutzerId, () => {
    const konto = buildPasswordAccount({
      email,
      password: 'geheim',
      overrides: {
        imapHost: 'imap.beispiel.invalid',
        imapPort: 993,
        smtpHost: 'smtp.beispiel.invalid',
        smtpPort: 465,
      },
    });
    saveAccount(konto);
    return konto.id;
  });
}

const ANNAS_KONTO = kontoFuer(anna.id, 'info@beispiel.de');
const ANNAS_ZWEITES = kontoFuer(anna.id, 'privat@beispiel.de');
const BERNDS_KONTO = kontoFuer(bernd.id, 'bernd@beispiel.de');
const CHEFS_KONTO = kontoFuer(chef.id, 'chef@beispiel.de');

/** Ein Etikett fuer Anna - etwas, das am NUTZER haengt und nicht am Konto. */
const { speichereEtikett } = await import('../etikettenStore.js');
alsNutzer(anna.id, () => speichereEtikett({ name: 'Annas Geheimprojekt', farbe: '#ff0000' }));

const { buildServer } = await import('../app.js');
const app = await buildServer({});

const KEKS = 'energy_mail_sitzung';
const mitKeks = (keks: string) => ({ cookie: `${KEKS}=${keks}` });

async function anmelden(wer: { email: string; kennwort: string }): Promise<string> {
  const antwort = await app.inject({ method: 'POST', url: '/anmelden', payload: wer });
  assert.equal(antwort.statusCode, 200, `Anmeldung ergab ${antwort.statusCode}`);
  return antwort.cookies.find((c) => c.name === KEKS)!.value;
}

const keksAnna = await anmelden(ANNA);
const keksBernd = await anmelden(BERND);
const keksChef = await anmelden(CHEF);

const ruf = (
  keks: string,
  methode: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
) =>
  app.inject({
    method: methode,
    url,
    headers: mitKeks(keks),
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

console.log('\nOhne Freigabe:');

await pruefe('Bernd sieht nur sein eigenes Konto', async () => {
  const a = await ruf(keksBernd, 'GET', '/accounts');
  const liste = a.json() as { id: string }[];
  assert.deepEqual(
    liste.map((k) => k.id),
    [BERNDS_KONTO],
  );
});

await pruefe('und kommt an Annas Postfach nicht heran - mit 404, nicht mit 403', async () => {
  /*
   * 404 und nicht 403, und das ist Absicht: Ein eigenes "verboten" verriete, dass es das
   * Konto gibt und es nur jemand anderem gehoert. Dieselbe Antwort wie fuer eine
   * erfundene Kennung.
   */
  const a = await ruf(keksBernd, 'GET', `/accounts/${ANNAS_KONTO}/rules`);
  assert.equal(a.statusCode, 404);
});

console.log('\nAnna gibt frei - mit Leserecht:');

let freigabeId = '';

await pruefe('das Freigeben geht und nennt den Empfaenger bei seiner Kennung', async () => {
  const a = await ruf(keksAnna, 'POST', '/freigaben', {
    kontoId: ANNAS_KONTO,
    an: 'bernd@beispiel.de',
    rechte: 'lesen',
  });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().an, bernd.id);
  assert.equal(a.json().rechte, 'lesen');
  freigabeId = a.json().id;
});

await pruefe('Bernd sieht das Postfach jetzt - gekennzeichnet', async () => {
  const a = await ruf(keksBernd, 'GET', '/accounts');
  const liste = a.json() as { id: string; email: string; freigabe?: { von: string; rechte: string } }[];
  assert.equal(liste.length, 2);
  const geteilt = liste.find((k) => k.id === ANNAS_KONTO);
  assert.ok(geteilt, 'Das freigegebene Konto fehlt.');
  assert.equal(geteilt.email, 'info@beispiel.de');
  assert.equal(geteilt.freigabe?.von, anna.id);
  assert.equal(geteilt.freigabe?.rechte, 'lesen');
  // Das eigene traegt keinen Vermerk.
  assert.equal(liste.find((k) => k.id === BERNDS_KONTO)!.freigabe, undefined);
});

await pruefe('und kann darin lesen', async () => {
  const a = await ruf(keksBernd, 'GET', `/accounts/${ANNAS_KONTO}/rules`);
  assert.equal(a.statusCode, 200, a.body);
});

console.log('\nWas Bernd trotzdem nicht kann:');

await pruefe('Annas zweites Postfach sieht er nicht', async () => {
  /*
   * Die Pruefung, an der der ganze Entwurf haengt. Bernd arbeitet bei jedem Zugriff auf
   * das freigegebene Konto in ANNAS Datenkontext - dort liegt auch ihr zweites Postfach.
   * Wechselte der Kontext eine Spur zu weit, staende es hier in der Liste.
   */
  const a = await ruf(keksBernd, 'GET', '/accounts');
  const ids = (a.json() as { id: string }[]).map((k) => k.id);
  assert.ok(!ids.includes(ANNAS_ZWEITES), `Annas zweites Konto steht in Bernds Liste: ${ids}`);

  const b = await ruf(keksBernd, 'GET', `/accounts/${ANNAS_ZWEITES}/rules`);
  assert.equal(b.statusCode, 404, 'Bernd kam an ein Konto ohne Freigabe.');
});

await pruefe('Annas Etiketten sieht er nicht - die haengen am Nutzer', async () => {
  // Etiketten, Adressbuch, Einstellungen: alles, was nicht die Kennung des freigegebenen
  // Kontos im Pfad traegt, laeuft weiter in Bernds eigenem Kontext.
  const a = await ruf(keksBernd, 'GET', '/etiketten');
  assert.equal(JSON.stringify(a.json()).includes('Geheimprojekt'), false, a.body);
  // Und bei Anna steht es sehr wohl - sonst pruefte die Zeile darueber nichts.
  const b = await ruf(keksAnna, 'GET', '/etiketten');
  assert.ok(JSON.stringify(b.json()).includes('Geheimprojekt'), b.body);
});

await pruefe('mit Leserecht kommt er nirgends schreibend durch', async () => {
  const schreibend: [('POST' | 'PUT' | 'PATCH' | 'DELETE'), string, unknown?][] = [
    ['PUT', `/accounts/${ANNAS_KONTO}/rules`, { name: 'X', bedingungen: { von: 'a' }, aktionen: { alsGelesen: true } }],
    ['POST', `/accounts/${ANNAS_KONTO}/folders`, { name: 'Neuer Ordner' }],
    ['POST', `/accounts/${ANNAS_KONTO}/folders/INBOX/messages/delete`, { uids: [1] }],
    ['POST', `/accounts/${ANNAS_KONTO}/folders/INBOX/messages/move`, { uids: [1], targetFolder: 'X' }],
    ['PATCH', `/accounts/${ANNAS_KONTO}/folders/INBOX/messages`, { uids: [1], seen: true }],
    ['POST', `/accounts/${ANNAS_KONTO}/send`, { to: ['x@y.de'], subject: 'A', text: 'B' }],
    ['PUT', `/accounts/${ANNAS_KONTO}/abwesenheit`, { aktiv: true, text: 'weg' }],
    ['POST', `/accounts/${ANNAS_KONTO}/vertraute-absender`, { adresse: 'x@y.de' }],
  ];
  for (const [methode, weg, koerper] of schreibend) {
    const a = await ruf(keksBernd, methode, weg, koerper);
    assert.equal(a.statusCode, 403, `${methode} ${weg} ergab ${a.statusCode}`);
  }
});

await pruefe('er kann Annas Postfach nicht weiterverschenken', async () => {
  const a = await ruf(keksBernd, 'POST', '/freigaben', {
    kontoId: ANNAS_KONTO,
    an: 'chef@beispiel.de',
    rechte: 'voll',
  });
  assert.equal(a.statusCode, 404, 'Bernd hat ein fremdes Postfach weitergegeben.');
});

await pruefe('und sieht Annas eigene Freigabenliste nicht', async () => {
  const a = await ruf(keksBernd, 'GET', '/freigaben');
  assert.deepEqual(a.json().eigene, [], 'Bernd sieht fremde Freigaben als eigene.');
  assert.equal(a.json().erhalten.length, 1);
});

console.log('\nVoller Zugriff:');

await pruefe('Anna hebt das Recht an - es entsteht keine zweite Freigabe', async () => {
  const a = await ruf(keksAnna, 'POST', '/freigaben', {
    kontoId: ANNAS_KONTO,
    an: bernd.id,
    rechte: 'voll',
  });
  assert.equal(a.statusCode, 200, a.body);
  assert.equal(a.json().id, freigabeId, 'Es wurde eine zweite Freigabe angelegt.');

  const b = await ruf(keksAnna, 'GET', '/freigaben');
  assert.equal(b.json().eigene.length, 1);
});

await pruefe('jetzt darf Bernd schreiben', async () => {
  const a = await ruf(keksBernd, 'PUT', `/accounts/${ANNAS_KONTO}/rules`, {
    name: 'Von Bernd',
    bedingungen: { von: 'kunde@' },
    aktionen: { alsGelesen: true },
  });
  assert.equal(a.statusCode, 200, a.body);
  // Und die Regel liegt in ANNAS Ablage - sie gehoert zum Postfach, nicht zum Vertreter.
  const beiAnna = await ruf(keksAnna, 'GET', `/accounts/${ANNAS_KONTO}/rules`);
  assert.equal((beiAnna.json() as unknown[]).length, 1);
  const beiBernd = await ruf(keksBernd, 'GET', `/accounts/${BERNDS_KONTO}/rules`);
  assert.equal((beiBernd.json() as unknown[]).length, 0, 'Die Regel landete in Bernds Ablage.');
});

await pruefe('das Konto selbst bleibt Annas - auch bei vollem Zugriff', async () => {
  /*
   * Wer ein Postfach zum Bearbeiten bekommt, bekommt nicht das Recht, es abzuschaffen.
   * Ein Vertreter, der aus Versehen "Konto entfernen" trifft, vernichtete sonst die
   * Zugangsdaten eines anderen Menschen.
   */
  for (const [methode, weg, koerper] of [
    ['DELETE', `/accounts/${ANNAS_KONTO}`, undefined],
    ['PATCH', `/accounts/${ANNAS_KONTO}`, { displayName: 'Bernd war hier' }],
    ['POST', `/accounts/${ANNAS_KONTO}/reauth`, {}],
  ] as [('DELETE' | 'PATCH' | 'POST'), string, unknown][]) {
    const a = await ruf(keksBernd, methode, weg, koerper);
    assert.equal(a.statusCode, 403, `${methode} ${weg} ergab ${a.statusCode}`);
  }
  // Und es steht danach immer noch da.
  const liste = await ruf(keksAnna, 'GET', '/accounts');
  assert.ok((liste.json() as { id: string }[]).some((k) => k.id === ANNAS_KONTO));
});

console.log('\nDie Falle mit der Verwalterrolle:');

await pruefe('ein freigegebenes Verwalterpostfach macht niemanden zum Verwalter', async () => {
  /*
   * Die unangenehmste Stelle des ganzen Entwurfs. Der Riegel der Verwaltung fragt, wer da
   * ist - und waehrend einer Freigabe hat das zwei Antworten. Fragte er den Eigentuemer
   * der gerade geoeffneten Daten, kaeme Bernd ueber das freigegebene Postfach des Chefs
   * in die Nutzerverwaltung.
   */
  const frei = await ruf(keksChef, 'POST', '/freigaben', {
    kontoId: CHEFS_KONTO,
    an: bernd.id,
    rechte: 'voll',
  });
  assert.equal(frei.statusCode, 200, frei.body);

  const a = await ruf(keksBernd, 'GET', '/verwaltung/nutzer');
  assert.equal(a.statusCode, 403, 'Bernd kam in die Verwaltung.');
});

console.log('\nZuruecknehmen:');

await pruefe('ein Fremder kann eine Freigabe nicht beenden', async () => {
  const a = await ruf(keksAnna, 'DELETE', `/freigaben/${(await ruf(keksChef, 'GET', '/freigaben')).json().eigene[0].id}`);
  assert.equal(a.statusCode, 403, 'Anna hat eine fremde Freigabe beendet.');
});

await pruefe('der Beschenkte darf sie selbst weglegen', async () => {
  const meine = (await ruf(keksBernd, 'GET', '/freigaben')).json();
  const vomChef = meine.erhalten.find((f: { besitzer: string }) => f.besitzer === chef.id);
  const a = await ruf(keksBernd, 'DELETE', `/freigaben/${vomChef.id}`);
  assert.equal(a.statusCode, 200, a.body);
});

await pruefe('nach dem Zuruecknehmen ist das Postfach wieder unerreichbar', async () => {
  const a = await ruf(keksAnna, 'DELETE', `/freigaben/${freigabeId}`);
  assert.equal(a.statusCode, 200, a.body);

  const liste = await ruf(keksBernd, 'GET', '/accounts');
  assert.deepEqual(
    (liste.json() as { id: string }[]).map((k) => k.id),
    [BERNDS_KONTO],
  );
  const b = await ruf(keksBernd, 'GET', `/accounts/${ANNAS_KONTO}/rules`);
  assert.equal(b.statusCode, 404);
});

await pruefe('an sich selbst freigeben geht nicht', async () => {
  const a = await ruf(keksAnna, 'POST', '/freigaben', {
    kontoId: ANNAS_KONTO,
    an: anna.id,
    rechte: 'voll',
  });
  assert.equal(a.statusCode, 400);
});

await pruefe('an jemanden, den es nicht gibt, auch nicht', async () => {
  const a = await ruf(keksAnna, 'POST', '/freigaben', {
    kontoId: ANNAS_KONTO,
    an: 'niemand@nirgendwo.de',
    rechte: 'lesen',
  });
  assert.equal(a.statusCode, 400);
});

await app.close();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
process.exit(ok === gesamt ? 0 : 1);
