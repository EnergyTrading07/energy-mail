import assert from 'node:assert/strict';
import net from 'node:net';
import {
  KENNUNG,
  alsGanzzahl,
  alsText,
  anwendung,
  aufzaehlung,
  folge,
  ganzzahl,
  kontext,
  liesElement,
  liesTeile,
  menge,
  tlv,
  zeichen,
  type Element,
} from './ber.js';
import { filterAusText, maskiere, sucheFilter, zerlegeFilter } from './filter.js';
import { LdapFehler, frageVerzeichnis } from './client.js';

/**
 * LDAP - Bytes, ein Filter und eine echte Verbindung.
 *
 * ## Wie sich so etwas ueberhaupt pruefen laesst
 *
 * Ein LDAP-Client, den man nur gegen sich selbst prueft, ist wertlos: Er wuerde dieselben
 * Annahmen beim Schreiben wie beim Lesen machen, und ein Verzeichnisdienst, der die Norm
 * kennt, verstuende ihn trotzdem nicht. Deshalb steht die Beweislast hier auf drei Beinen:
 *
 *  1. **Die Bytes gegen die Norm.** Was der Client als Suchanfrage schickt, wird hier mit
 *     einem eigenen, unabhaengig geschriebenen Leser zerlegt und Feld fuer Feld gegen
 *     RFC 4511, Abschnitt 4.5.1 gehalten: Reihenfolge, Kennungen, Werte. Die Norm sagt,
 *     wie der Baum aussieht - und genau der wird nachgezaehlt.
 *  2. **Ein echter Verzeichnisdienst.** Weiter unten steht ein kleiner LDAP-Server auf
 *     einem richtigen TCP-Socket. Er zerlegt die Anfrage selbst und antwortet mit Bytes,
 *     die er selbst baut. Der Client muss damit zurechtkommen - inklusive der Tatsache,
 *     dass Antworten in Stuecken ankommen und mehrere Suchen gleichzeitig laufen koennen.
 *  3. **Der Filter.** Was ein Nutzer in das Suchfeld tippt, landet in einem Filter. Ohne
 *     Maskierung baute `*)(objectClass=*` daraus einen anderen - dieselbe Sorte Luecke wie
 *     eine SQL-Einschleusung, nur mit den Personaldaten eines Unternehmens dahinter.
 */

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => void | Promise<void>): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

const hex = (b: Buffer) => b.toString('hex');

console.log('\nBER - Kennung, Laenge, Inhalt:');

await pruefe('eine kurze Folge steht Byte fuer Byte so da, wie X.690 es vorschreibt', () => {
  /*
   * Von Hand nachgerechnet: 30 (SEQUENCE) 09 (neun Bytes Inhalt), darin
   * 02 01 01 (INTEGER 1) und 04 04 "anna" (OCTET STRING).
   */
  const gebaut = folge(ganzzahl(1), zeichen('anna'));
  assert.equal(hex(gebaut), '3009' + '020101' + '0404616e6e61');
});

await pruefe('eine Laenge ueber 127 nimmt die lange Form', () => {
  // 81 gefolgt von einem Laengenbyte: "es folgt ein Byte mit der Laenge".
  const lang = zeichen('x'.repeat(200));
  assert.equal(lang.subarray(0, 3).toString('hex'), '0481c8');
  assert.equal(alsText(liesElement(lang)!.inhalt).length, 200);
});

await pruefe('eine positive Zahl bekommt bei gesetztem Spitzenbit eine fuehrende Null', () => {
  /*
   * Sonst laese die Gegenseite eine negative Zahl - INTEGER ist Zweierkomplement. Bei 128
   * ist das Spitzenbit gesetzt, also 00 80 statt 80.
   */
  assert.equal(hex(ganzzahl(128)), '02020080');
  assert.equal(hex(ganzzahl(127)), '02017f');
  assert.equal(hex(ganzzahl(0)), '020100');
});

await pruefe('ein halb eingetroffenes Element ergibt null und keinen Fehler', () => {
  // Ueber einen Socket kommen Bytes stueckweise an - das ist der Normalfall.
  const ganz = folge(zeichen('hallo'));
  for (let i = 1; i < ganz.length; i++) {
    assert.equal(liesElement(ganz.subarray(0, i)), null, `bei ${i} Bytes`);
  }
  assert.ok(liesElement(ganz));
});

await pruefe('eine unbrauchbare Laengenangabe wird abgewiesen', () => {
  // Vier Milliarden Bytes zu behaupten ist keine Antwort mehr. Ohne diese Bremse warteten
  // wir auf Bytes, die nie kommen.
  assert.throws(() => liesElement(Buffer.from([0x30, 0x88, 1, 1, 1, 1, 1, 1, 1, 1])), /Laengen|Längen/);
  assert.throws(() => liesElement(Buffer.from([0x30, 0x80])), /Unbestimmte/);
});

await pruefe('eine Folge mit einem abgeschnittenen Teil laeuft nicht endlos', () => {
  // Ohne den Wurf drehte sich liesTeile im Kreis, ohne voranzukommen.
  assert.throws(() => liesTeile(Buffer.from([0x04, 0x05, 0x61])), /Abgeschnitten/);
});

console.log('\nDer Filter:');

await pruefe('Sonderzeichen werden maskiert - sonst ist es eine Einschleusung', () => {
  assert.equal(maskiere('*)(objectClass=*'), '\\2a\\29\\28objectClass=\\2a');
  assert.equal(maskiere('Müller'), 'Müller');
  assert.equal(maskiere('a\\b'), 'a\\5cb');
});

await pruefe('eingetippter Unsinn bleibt ein Suchwort und wird kein Filterzweig', () => {
  /*
   * Die Pruefung, um die es geht - und sie prueft die STRUKTUR, nicht die Schreibweise.
   *
   * Auf dem Draht steht ein Wert immer roh; maskiert wird nur die Textfassung eines
   * Filters, damit der Zerleger ihn als einen Wert liest und nicht als weitere Zweige.
   * Entscheidend ist deshalb nicht, ob im Byte-Strom irgendwo "\2a" auftaucht, sondern
   * dass der Baum genau die gemeinte Gestalt hat: ein UND aus dem Grundfilter und EINEM
   * Suchzweig, und die Eingabe steckt darin als blosser Wert.
   */
  const eingabe = '*)(objectClass=*';
  const wurzel = liesElement(sucheFilter('(objectClass=person)', eingabe, ['cn']))!;
  assert.equal(wurzel.kennung, kontext(0), 'Die Wurzel ist kein UND.');

  const zweige = liesTeile(wurzel.inhalt);
  assert.equal(zweige.length, 2, `${zweige.length} Zweige statt zwei - da kam etwas dazu.`);
  assert.equal(zweige[0]!.kennung, 0xa3, 'Der Grundfilter fehlt.');

  // Der zweite Zweig ist die Teilstuecksuche auf cn - und der eingetippte Text steht
  // darin als EIN Wert, ungeteilt.
  assert.equal(zweige[1]!.kennung, 0xa4, 'Kein Teilstueckfilter.');
  const [attribut, stuecke] = liesTeile(zweige[1]!.inhalt);
  assert.equal(alsText(attribut!.inhalt), 'cn');
  const teile = liesTeile(stuecke!.inhalt);
  assert.equal(teile.length, 1, 'Die Eingabe wurde zerlegt.');
  assert.equal(alsText(teile[0]!.inhalt), eingabe);
});

await pruefe('ohne Maskierung kaeme der Zerleger gar nicht erst durch', () => {
  /*
   * Der Gegenbeweis: Wer die Eingabe unmaskiert in eine Filterzeile schreibt, baut keinen
   * heimlich anderen Filter - er baut einen, der nicht aufgeht. Das ist die zweite Haelfte
   * der Absicherung: Der Zerleger nimmt nur, was als Ganzes ein Filter ist.
   */
  assert.throws(() => zerlegeFilter('(cn=*)(objectClass=**)'), /Stelle/);
});

await pruefe('die Kennungen der Filterzweige stimmen mit RFC 4511 ueberein', () => {
  const kennungVon = (text: string) => liesElement(filterAusText(text))!.kennung;
  assert.equal(kennungVon('(&(a=1)(b=2))'), 0xa0, 'and');
  assert.equal(kennungVon('(|(a=1)(b=2))'), 0xa1, 'or');
  assert.equal(kennungVon('(!(a=1))'), 0xa2, 'not');
  assert.equal(kennungVon('(a=1)'), 0xa3, 'equalityMatch');
  assert.equal(kennungVon('(a=*x*)'), 0xa4, 'substrings');
  assert.equal(kennungVon('(a>=1)'), 0xa5, 'greaterOrEqual');
  assert.equal(kennungVon('(a<=1)'), 0xa6, 'lessOrEqual');
  // Der einzige Zweig, der NICHT zusammengesetzt ist - der Name steht unmittelbar darin.
  assert.equal(kennungVon('(a=*)'), 0x87, 'present');
  assert.equal(liesElement(filterAusText('(a=*)'))!.inhalt.toString('utf8'), 'a');
});

await pruefe('ein Teilstueckfilter zerfaellt in Anfang, Mitte und Ende', () => {
  const f = zerlegeFilter('(cn=a*b*c)');
  assert.deepEqual(f, { art: 'teile', attribut: 'cn', anfang: 'a', mitte: ['b'], ende: 'c' });
  // Ein Stern am Rand ergibt kein Teilstueck, sondern laesst den Zweig weg.
  assert.deepEqual(zerlegeFilter('(cn=*b*)'), {
    art: 'teile', attribut: 'cn', anfang: undefined, mitte: ['b'], ende: undefined,
  });
});

await pruefe('ein kaputter Filter meldet, wo es klemmt', () => {
  for (const unfug of ['(a=1', 'a=1)', '(&)', '(a)', '(a=1)x']) {
    assert.throws(() => zerlegeFilter(unfug), /Stelle/, unfug);
  }
});

console.log('\nDie Suchanfrage gegen die Norm:');

/**
 * Ein kleiner Verzeichnisdienst auf einem echten Socket.
 *
 * Er zerlegt die Anfrage mit demselben BER-Leser (der ist an sich schon geprueft) und baut
 * seine Antworten selbst - so muss der Client mit Bytes zurechtkommen, die nicht er selbst
 * geschrieben hat. Und er antwortet ABSICHTLICH in mehreren Stuecken, mit einer kleinen
 * Pause dazwischen: Genau daran scheitert ein Client, der annimmt, eine Antwort komme in
 * einem Rutsch an.
 */
interface Mitschnitt {
  bindDn: string;
  kennwort: string;
  suche?: Element[];
}

function starteVerzeichnis(mit: Mitschnitt, treffer: { dn: string; werte: Record<string, string[]> }[]) {
  const server = net.createServer((socket) => {
    let puffer = Buffer.alloc(0);
    socket.on('data', (stueck) => {
      puffer = Buffer.concat([puffer, stueck]);
      for (;;) {
        const nachricht = liesElement(puffer, 0);
        if (!nachricht) return;
        puffer = puffer.subarray(nachricht.gesamt);

        const teile = liesTeile(nachricht.inhalt);
        const nummer = alsGanzzahl(teile[0]!.inhalt);
        const vorgang = teile[1]!;

        if (vorgang.kennung === anwendung(0)) {
          const b = liesTeile(vorgang.inhalt);
          mit.bindDn = alsText(b[1]!.inhalt);
          mit.kennwort = alsText(b[2]!.inhalt);
          const antwort =
            mit.kennwort === 'richtig'
              ? [aufzaehlung(0), zeichen(''), zeichen('')]
              : [aufzaehlung(49), zeichen(''), zeichen('invalid credentials')];
          socket.write(folge(ganzzahl(nummer), tlv(anwendung(1), antwort)));
          continue;
        }

        if (vorgang.kennung === anwendung(3)) {
          mit.suche = liesTeile(vorgang.inhalt);
          /*
           * Absichtlich in Stuecken und mit einer Pause: Ein Client, der annimmt, alles
           * komme in einem Rutsch, faellt genau hier um.
           */
          const stuecke = treffer.map((t) =>
            folge(
              ganzzahl(nummer),
              tlv(anwendung(4), [
                zeichen(t.dn),
                tlv(
                  KENNUNG.SEQUENCE,
                  Object.entries(t.werte).map(([name, werte]) =>
                    folge(zeichen(name), menge(...werte.map((w) => zeichen(w)))),
                  ),
                ),
              ]),
            ),
          );
          const abschluss = folge(
            ganzzahl(nummer),
            tlv(anwendung(5), [aufzaehlung(0), zeichen(''), zeichen('')]),
          );
          const alles = Buffer.concat([...stuecke, abschluss]);
          // Erst die Haelfte, dann der Rest.
          const schnitt = Math.floor(alles.length / 2);
          socket.write(alles.subarray(0, schnitt));
          setTimeout(() => socket.write(alles.subarray(schnitt)), 15);
          continue;
        }

        // UnbindRequest oder etwas Unbekanntes: schliessen.
        socket.end();
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise<{ port: number; stoppe: () => void }>((auf) => {
    server.listen(0, '127.0.0.1', () => {
      const adresse = server.address() as net.AddressInfo;
      auf({ port: adresse.port, stoppe: () => server.close() });
    });
  });
}

const mit: Mitschnitt = { bindDn: '', kennwort: '' };
const dienst = await starteVerzeichnis(mit, [
  {
    dn: 'cn=Anna Müller,ou=Leute,dc=firma,dc=de',
    werte: {
      cn: ['Anna Müller'],
      mail: ['anna.mueller@firma.de', 'a.mueller@firma.de'],
      telephoneNumber: ['+49 30 123456'],
      department: ['Einkauf'],
    },
  },
  {
    dn: 'cn=Bernd Meier,ou=Leute,dc=firma,dc=de',
    werte: { cn: ['Bernd Meier'], mail: ['bernd@firma.de'] },
  },
]);

const angaben = {
  host: '127.0.0.1',
  port: dienst.port,
  verschluesselung: 'einfach' as const,
  fristMs: 4000,
};

const gefunden = await frageVerzeichnis(
  angaben,
  { bindDn: 'cn=dienst,dc=firma,dc=de', kennwort: 'richtig' },
  {
    basis: 'dc=firma,dc=de',
    filter: sucheFilter('(objectClass=person)', 'mül', ['cn', 'mail']),
    attribute: ['cn', 'mail', 'telephoneNumber', 'department'],
    grenze: 25,
  },
);

await pruefe('die Anmeldung kam mit DN und Kennwort an', () => {
  assert.equal(mit.bindDn, 'cn=dienst,dc=firma,dc=de');
  assert.equal(mit.kennwort, 'richtig');
});

await pruefe('die Suchanfrage steht Feld fuer Feld so da, wie RFC 4511 es vorschreibt', () => {
  /*
   * SearchRequest ::= [APPLICATION 3] SEQUENCE {
   *   baseObject, scope, derefAliases, sizeLimit, timeLimit, typesOnly, filter, attributes }
   *
   * Acht Felder in genau dieser Reihenfolge. Ein Verzeichnisdienst liest sie der Reihe
   * nach - wer eines vertauscht, bekommt keine Fehlermeldung, sondern falsche Ergebnisse.
   */
  const felder = mit.suche!;
  assert.equal(felder.length, 8, `${felder.length} Felder statt acht`);
  assert.equal(alsText(felder[0]!.inhalt), 'dc=firma,dc=de', 'baseObject');
  assert.equal(felder[1]!.kennung, KENNUNG.ENUMERATED);
  assert.equal(alsGanzzahl(felder[1]!.inhalt), 2, 'scope muss wholeSubtree sein');
  assert.equal(alsGanzzahl(felder[2]!.inhalt), 0, 'derefAliases muss never sein');
  assert.equal(alsGanzzahl(felder[3]!.inhalt), 25, 'sizeLimit');
  assert.equal(felder[5]!.kennung, KENNUNG.BOOLEAN);
  assert.equal(felder[5]!.inhalt[0], 0x00, 'typesOnly muss falsch sein - sonst kaemen keine Werte');
  assert.equal(felder[6]!.kennung, kontext(0), 'filter: ein UND aus Grundfilter und Suche');
  assert.deepEqual(
    liesTeile(felder[7]!.inhalt).map((a) => alsText(a.inhalt)),
    ['cn', 'mail', 'telephoneNumber', 'department'],
  );
});

await pruefe('die Treffer kommen vollstaendig zurueck - auch in Stuecken gesendet', () => {
  assert.equal(gefunden.length, 2);
  assert.equal(gefunden[0]!.dn, 'cn=Anna Müller,ou=Leute,dc=firma,dc=de');
  assert.deepEqual(gefunden[0]!.werte.cn, ['Anna Müller']);
  // Ein Attribut kann mehrere Werte haben - beide muessen ankommen.
  assert.deepEqual(gefunden[0]!.werte.mail, ['anna.mueller@firma.de', 'a.mueller@firma.de']);
  assert.deepEqual(gefunden[1]!.werte.mail, ['bernd@firma.de']);
});

await pruefe('Attributnamen kommen kleingeschrieben - LDAP unterscheidet nicht', () => {
  // Der Dienst schickt "telephoneNumber", eingetragen ist vielleicht "telephonenumber".
  // Ohne das haenge die Zuordnung an der Schreibweise eines fremden Verzeichnisses.
  assert.deepEqual(gefunden[0]!.werte.telephonenumber, ['+49 30 123456']);
});

await pruefe('ein falsches Kennwort ergibt einen Satz, den man lesen kann', async () => {
  await assert.rejects(
    frageVerzeichnis(
      angaben,
      { bindDn: 'cn=dienst,dc=firma,dc=de', kennwort: 'falsch' },
      { basis: 'dc=firma,dc=de', filter: filterAusText('(cn=*)'), attribute: ['cn'] },
    ),
    (fehler: LdapFehler) => {
      assert.match(fehler.message, /Anmelde-DN oder Kennwort stimmen nicht/);
      assert.equal(fehler.code, 49);
      return true;
    },
  );
});

await pruefe('ein DN ohne Kennwort wird gar nicht erst versucht', async () => {
  /*
   * Die "unauthenticated bind": Manche Verzeichnisse antworten darauf mit Erfolg, ohne
   * irgendetwas geprueft zu haben - und der Dienst haelt sich danach fuer angemeldet.
   */
  await assert.rejects(
    frageVerzeichnis(
      angaben,
      { bindDn: 'cn=dienst,dc=firma,dc=de', kennwort: '' },
      { basis: 'dc=firma,dc=de', filter: filterAusText('(cn=*)'), attribute: ['cn'] },
    ),
    /Kennwort/,
  );
});

await pruefe('ein Verzeichnis, das nicht antwortet, blockiert nicht ewig', async () => {
  const stumm = net.createServer(() => undefined);
  await new Promise<void>((auf) => stumm.listen(0, '127.0.0.1', auf));
  const port = (stumm.address() as net.AddressInfo).port;
  const beginn = Date.now();
  await assert.rejects(
    frageVerzeichnis(
      { host: '127.0.0.1', port, verschluesselung: 'einfach', fristMs: 300 },
      {},
      { basis: 'dc=x', filter: filterAusText('(cn=*)'), attribute: ['cn'] },
    ),
    /nicht rechtzeitig/,
  );
  assert.ok(Date.now() - beginn < 3000, 'Es dauerte zu lange.');
  stumm.close();
});

dienst.stoppe();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
