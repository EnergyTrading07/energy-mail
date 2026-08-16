import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir, getNutzerDir } from './paths.js';
import { betreteNutzerFuerProzess } from './nutzer/kontext.js';
import { setKeyProvider } from './secretCrypto.js';

/*
 * Die Umstellung der Ablage von einer Fassung zur naechsten.
 *
 * Vorher gab es keine: eine einzelne Zahl, und wich sie ab, wurde die gesamte Datenbank
 * geloescht und neu angelegt. Fuer ein Einplatzprogramm vertretbar - fuer einen Dienst
 * hiesse jede Aktualisierung, die das Schema anfasst, dass saemtliche Nutzer im selben
 * Augenblick ihren Offline-Bestand neu laden.
 *
 * Die entscheidende Frage dieser Datei ist deshalb nicht "laeuft die Umstellung durch",
 * sondern "ueberlebt der Bestand sie".
 */

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-migration-test-'));
setDataDir(tempDir);
betreteNutzerFuerProzess('pruefung');
process.on('exit', () => fs.rmSync(tempDir, { recursive: true, force: true }));

// Ohne Schluessel legt die Ablage im Klartext ab - dann pruefte die Umstellung auf
// verschluesselte Inhalte weiter unten nichts.
setKeyProvider({ name: 'Pruefung', getKey: () => Buffer.alloc(32, 7) });

const {
  ablage,
  merkeKopfdaten,
  holeInhalt,
  holeSeite,
  schliesseAblage,
  sucheLokal,
  ablageFassung,
} = await import('./lokaleAblage.js');

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

function nachricht(uid: number, betreff: string) {
  return {
    uid,
    subject: betreff,
    from: [{ address: 'wer@beispiel.de' }],
    to: [],
    cc: [],
    date: new Date('2026-01-01'),
    seen: false,
    flags: [] as string[],
    hasAttachments: false,
  };
}

/** Setzt die eingetragene Fassung von Hand - so sieht eine aeltere Ablage aus. */
function setzeFassung(wert: number): void {
  const d = ablage();
  d.prepare("insert or replace into stand (schluessel, wert) values ('fassung', ?)").run(
    String(wert),
  );
  schliesseAblage();
}

function gemerkteFassung(): number {
  const zeile = ablage().prepare("select wert from stand where schluessel = 'fassung'").get() as
    | { wert?: string }
    | undefined;
  return Number(zeile?.wert ?? 0);
}

console.log('\nEine frische Ablage:');

pruefe('traegt die aktuelle Fassung', () => {
  merkeKopfdaten('konto-1', 'INBOX', [nachricht(1, 'Erste')]);
  assert.equal(gemerkteFassung(), ablageFassung());
  assert.ok(ablageFassung() >= 1);
});

console.log('\nEine aeltere Ablage wird umgestellt, nicht geleert:');

pruefe('der Bestand ueberlebt die Umstellung', () => {
  /*
   * Der Kern der Sache. Vorher waere die Datei an dieser Stelle geloescht worden - bei
   * 31.700 Nachrichten Stunden des Nachladens, und das bei jedem Nutzer gleichzeitig.
   */
  merkeKopfdaten('konto-1', 'INBOX', [nachricht(2, 'Soll bleiben')]);
  setzeFassung(0);

  const danach = holeSeite('konto-1', 'INBOX', { anzahl: 50 }).map((m) => m.subject);
  assert.ok(danach.includes('Soll bleiben'), `nach der Umstellung: ${danach.join(', ')}`);
  assert.ok(danach.includes('Erste'), 'auch aeltere Eintraege sind noch da');
});

pruefe('und die Fassung steht danach wieder auf dem aktuellen Stand', () => {
  assert.equal(gemerkteFassung(), ablageFassung());
});

pruefe('ein zweites Oeffnen stellt nichts noch einmal um', () => {
  // Nichts zu tun ist der haeufigste Fall - er darf nichts anfassen.
  const vorher = holeSeite('konto-1', 'INBOX', { anzahl: 50 }).length;
  schliesseAblage();
  assert.equal(holeSeite('konto-1', 'INBOX', { anzahl: 50 }).length, vorher);
  assert.equal(gemerkteFassung(), ablageFassung());
});

console.log('\nDie Umstellung auf verschluesselte Inhalte:');

/*
 * Der Schritt, den jede bestehende Installation genau einmal durchlaeuft - und zwar auf
 * dem echten Postfach ihres Nutzers. Was hier schiefgeht, geht bei ihm schief.
 *
 * Nachgebaut wird der Zustand von vorher: Inhalte im Klartext, der Nachrichtentext im
 * Suchindex. Danach muss dreierlei gelten - der Text ist aus der Datei verschwunden, er
 * ist aus dem Index verschwunden, und er kommt beim Oeffnen der Nachricht unveraendert
 * zurueck. Zwei davon allein waeren jeweils wertlos.
 */
pruefe('alter Klartext wird verschluesselt und faellt aus dem Suchindex', () => {
  const wortlaut = 'Zebrastreifen-Wortlaut-aus-der-Zeit-davor';
  const konto = 'konto-alt';

  /*
   * Genug Nachrichten, damit FTS5 mehr als ein Segment anlegt.
   *
   * Diese Zahl ist der Kern der Pruefung und keine Willkuer. Mit einer einzigen Nachricht
   * lief sie durch, WAEHREND die Umstellung an einer Kopie des echten Bestands den
   * Wortlaut in der Datei stehen liess: FTS5 fuehrt seinen Index in Segmentbloecken, und
   * bei drei Zeilen schreibt es sie ohnehin neu, bei tausend nicht. Der Fehler versteckte
   * sich also genau in dem, was eine kleine Pruefung nicht hat - Masse.
   */
  const wieViele = 300;
  const alle = Array.from({ length: wieViele }, (_, i) => nachricht(i + 1, `Kurze Frage ${i + 1}`));
  merkeKopfdaten(konto, 'INBOX', alle);

  // Den Stand von vorher von Hand herstellen: die heutige merkeInhalt() wuerde bereits
  // verschluesseln, und dann pruefte das hier nichts.
  const d = ablage();
  const inhaltEin = d.prepare(
    `insert or replace into inhalte (konto, ordner, uid, html, text, anhaenge, zuletzt_gelesen)
     values (?, ?, ?, ?, ?, ?, ?)`,
  );
  const indexWeg = d.prepare('delete from suche where rowid = ?');
  const indexEin = d.prepare(
    'insert into suche (rowid, betreff, absender, empfaenger, inhalt) values (?, ?, ?, ?, ?)',
  );
  for (const m of alle) {
    const zeile = d
      .prepare('select rowid from nachrichten where konto = ? and ordner = ? and uid = ?')
      .get(konto, 'INBOX', m.uid) as { rowid: number };
    const text = `${wortlaut} Nummer ${m.uid}`;
    inhaltEin.run(konto, 'INBOX', m.uid, null, text, null, Date.now());
    indexWeg.run(zeile.rowid);
    indexEin.run(zeile.rowid, m.subject, 'wer@beispiel.de', '', text);
  }

  // So sah es vorher aus - sonst prueft der Rest gegen einen Zustand, den es nie gab.
  assert.equal(sucheLokal(konto, 'Zebrastreifen').length, 100, 'der Aufbau stimmt nicht');

  setzeFassung(1);

  // 1. Aus dem Index heraus.
  assert.equal(
    sucheLokal(konto, 'Zebrastreifen').length,
    0,
    'der Klartext steht weiter im Suchindex',
  );
  /*
   * 2. Aus den SEGMENTBLOECKEN des Index heraus.
   *
   * Das ist die Zeile, um die es geht, und sie steht hier, weil die naheliegende Pruefung
   * versagt hat: "steht das Wort noch in der Datei" lief gruen durch, waehrend die
   * Umstellung an einer Kopie des echten Postfachs den Wortschatz der alten
   * Nachrichtentexte stehen liess.
   *
   * Der Grund ist FTS5. Sein Index liegt in der Schattentabelle suche_data als
   * Segmentbloecke; ein "delete from suche" setzt dort nur Grabsteine und schreibt die
   * Bloecke erst bei einer spaeteren Verschmelzung neu. Ob die kommt, haengt an der
   * Menge - bei den paar hundert Zeilen einer Pruefung verschmilzt FTS5 von selbst und
   * raeumt dabei zufaellig mit auf, bei einem gewachsenen Postfach nicht. Die Pruefung war
   * also gruen, WEIL sie klein war.
   *
   * Deshalb wird hier in die Bloecke selbst gesehen. Kleingeschrieben gesucht: der
   * Tokenizer legt die Woerter kleingeschrieben und ohne Umlaute ab.
   */
  const bloecke = (
    ablage().prepare('select block from suche_data').all() as { block: unknown }[]
  )
    .map((z) => Buffer.from((z.block as Uint8Array | null) ?? []).toString('latin1'))
    .join('\n');
  assert.ok(
    !bloecke.toLowerCase().includes('zebrastreifen'),
    'der Wortschatz der alten Nachrichtentexte steht weiter im Suchindex (suche_data)',
  );

  /*
   * 3. Und aus der Datei heraus - dafuer sorgt das Vacuum nach der Umstellung.
   */
  schliesseAblage();
  assert.ok(
    !fs.readFileSync(path.join(getNutzerDir(), 'ablage.db')).includes(wortlaut),
    'der alte Klartext steht weiter in ablage.db',
  );
  // 4. Und trotzdem lesbar.
  assert.equal(holeInhalt(konto, 'INBOX', 1)?.text, `${wortlaut} Nummer 1`);
  assert.equal(holeInhalt(konto, 'INBOX', 300)?.text, `${wortlaut} Nummer 300`);
  // Die Kopfdaten haben es unbeschadet ueberstanden.
  assert.equal(
    sucheLokal(konto, 'Frage').length,
    100,
    'der Betreff ging bei der Umstellung verloren',
  );
});

console.log('\nEine Ablage aus einer NEUEREN Fassung:');

pruefe('wird neu aufgebaut statt rueckwaerts umgestellt', () => {
  /*
   * Passiert, wenn jemand nach einer Aktualisierung wieder die aeltere Fassung startet.
   * Rueckwaerts umstellen geht nicht; die Ablage ist ein Abbild und kein Original, also
   * wird sie neu aufgebaut. Wichtig ist nur, dass das Programm nicht stehenbleibt.
   */
  setzeFassung(9999);
  const danach = holeSeite('konto-1', 'INBOX', { anzahl: 50 });
  assert.deepEqual(danach, [], 'die Ablage haette neu aufgebaut werden muessen');
  assert.equal(gemerkteFassung(), ablageFassung());
});

console.log('\nEine beschaedigte Datei:');

pruefe('haelt das Programm nicht auf', () => {
  schliesseAblage();
  fs.writeFileSync(path.join(getNutzerDir(), 'ablage.db'), 'das ist keine Datenbank', 'utf-8');

  // Darf nicht werfen - die Ablage baut sich neu auf.
  merkeKopfdaten('konto-1', 'INBOX', [nachricht(7, 'Nach dem Schaden')]);
  const danach = holeSeite('konto-1', 'INBOX', { anzahl: 50 }).map((m) => m.subject);
  assert.deepEqual(danach, ['Nach dem Schaden']);
});

schliesseAblage();

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
