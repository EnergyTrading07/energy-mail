import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MessageSummary } from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { jeNutzer } from './nutzer/jeNutzer.js';
import { protokolliere } from './protokollDatei.js';

/**
 * Die Nachrichten auf der Platte.
 *
 * Bisher lebte alles im Arbeitsspeicher mit einer JSON-Datei als Gedächtnis über den
 * Neustart hinweg. Das reicht, um schnell zu sein, aber nicht, um ohne Netz zu lesen,
 * um schnell zu suchen oder um überhaupt eine Sicherung zu haben. An dieser Ablage
 * hängen vier Dinge zugleich: Offline, Volltextsuche, Sicherung und Ausfuhr.
 *
 * Zwei Ebenen, weil sie sich stark im Umfang unterscheiden:
 *
 * - **Kopfdaten** (Absender, Betreff, Datum, Zustand) für *alle* Nachrichten. Bei
 *   31.700 Nachrichten sind das wenige Megabyte, und sie machen die Liste vollständig
 *   auch ohne Verbindung.
 * - **Inhalte** nur für die zuletzt gelesenen. Sie sind hundertmal so groß; alle
 *   vorzuhalten hieße, das Postfach zu spiegeln.
 *
 * SQLite kommt seit Electron 38 mit Node mit - keine fremde Abhängigkeit, kein
 * Übersetzer, nichts zusätzlich auszuliefern.
 */

/**
 * Wie viele Inhalte aufgehoben werden. Bei durchschnittlich 40 KB je Nachricht sind
 * das rund 80 MB - genug für Wochen des Lesens, und immer noch ein Bruchteil dessen,
 * was ein gespiegeltes Postfach belegte.
 */
const MAX_INHALTE = 2000;

/**
 * Ein Schritt, der die Ablage von einer Fassung zur nächsten bringt.
 *
 * Vorher gab es das nicht: eine einzelne Zahl, und wich sie ab, wurde die gesamte
 * Datenbank gelöscht und neu angelegt. Für ein Einplatzprogramm war das vertretbar - die
 * Ablage ist ein Abbild des Postfachs, und bei 31.700 Nachrichten kostete es ein paar
 * Stunden Nachladen. Für einen Dienst mit vielen Nutzern ist es das nicht: jede
 * Aktualisierung, die das Schema anfasst, ließe SÄMTLICHE Nutzer gleichzeitig ihren
 * Offline-Bestand neu laden - und der Anbieter bekäme im selben Augenblick von allen
 * Seiten Vollabrufe.
 *
 * Jeder Schritt läuft in einer eigenen Transaktion: bricht er ab, bleibt die Fassung
 * stehen, auf der er angesetzt hat, und beim nächsten Start wird es erneut versucht.
 */
interface Migration {
  /** Auf diese Fassung hebt der Schritt. Lückenlos aufsteigend. */
  fassung: number;
  /** Wofür - erscheint im Protokoll, wenn der Schritt läuft. */
  beschreibung: string;
  auf: (d: DatabaseSync) => void;
}

/**
 * Die Fassung, auf die eine Ablage gebracht wird - die höchste vorhandene Migration.
 *
 * Abgeleitet und nicht von Hand gepflegt: eine Zahl, die man beim Ergänzen eines
 * Schrittes vergessen kann, ist eine Zahl, die man vergisst.
 */
const AUFBAU_FASSUNG = () => MIGRATIONEN.reduce((h, m) => Math.max(h, m.fassung), 0);

/** Auf welcher Fassung eine Ablage nach dem Öffnen steht - für Prüfungen und Diagnose. */
export function ablageFassung(): number {
  return AUFBAU_FASSUNG();
}


const getPfad = () => path.join(getNutzerDir(), 'ablage.db');

/**
 * Die Schritte, die eine Ablage auf den aktuellen Stand bringen.
 *
 * Neue Schritte kommen HINTEN dazu und bekommen die nächste Nummer. Ein bestehender
 * Schritt wird nie geändert: bei allen, die ihn schon durchlaufen haben, liefe er nicht
 * noch einmal, und der Bestand wäre danach je nach Alter der Installation verschieden.
 *
 * Beispiel für einen künftigen Schritt:
 *
 *   {
 *     fassung: 2,
 *     beschreibung: 'Spalte fuer die Wichtigkeit',
 *     auf: (d) => d.exec('alter table nachrichten add column wichtigkeit integer'),
 *   }
 */
const MIGRATIONEN: Migration[] = [
  {
    fassung: 1,
    beschreibung: 'Grundaufbau: Ordner, Nachrichten, Inhalte und Suchindex',
    auf: (d) => baueGrundauf(d),
  },
];

/**
 * Legt Tabellen und Indizes an.
 *
 * Der Schlüssel jeder Nachricht ist Konto + Ordner + UID. Das ist die einzige Kennung,
 * die IMAP zusichert - und auch die nur, solange die "UID-Gültigkeit" des Ordners
 * gleich bleibt. Ändert der Server sie, sind alle gemerkten UIDs wertlos; darum steht
 * sie mit in der Ordnertabelle und wird bei jedem Abgleich verglichen.
 *
 * "if not exists" durchgehend, damit der Schritt auf einer Ablage, die es schon gibt,
 * nichts kaputtmacht - bestehende Installationen tragen diese Tabellen bereits.
 */
function baueGrundauf(datenbank: DatabaseSync): void {
  datenbank.exec(`
    create table if not exists ordner (
      konto text not null,
      pfad text not null,
      uid_gueltigkeit integer,
      letzter_abgleich integer,
      primary key (konto, pfad)
    );

    create table if not exists nachrichten (
      konto text not null,
      ordner text not null,
      uid integer not null,
      message_id text,
      thread_id text,
      betreff text,
      absender_name text,
      absender_adresse text,
      empfaenger text,
      datum integer,
      gelesen integer not null default 0,
      markiert integer not null default 0,
      hat_anhaenge integer not null default 0,
      list_id text,
      abmeldeweg text,
      primary key (konto, ordner, uid)
    );

    create index if not exists nachrichten_datum
      on nachrichten (konto, ordner, datum desc, uid desc);

    create index if not exists nachrichten_absender
      on nachrichten (konto, absender_adresse);

    create table if not exists inhalte (
      konto text not null,
      ordner text not null,
      uid integer not null,
      html text,
      text text,
      anhaenge text,
      zuletzt_gelesen integer not null,
      primary key (konto, ordner, uid)
    );

    create index if not exists inhalte_alter on inhalte (zuletzt_gelesen);

    create table if not exists stand (schluessel text primary key, wert text);
  `);

  /**
   * Der Suchindex.
   *
   * Getrennt vom exec oben, weil eine ältere SQLite-Fassung ohne FTS5 hier werfen
   * würde - dann soll wenigstens der Rest stehen und die Suche eben über den Server
   * laufen. In Electron 38 ist FTS5 vorhanden; die Vorsicht kostet nichts.
   *
   * Die Zeilennummer ist dieselbe wie in "nachrichten" - darüber wird gelöscht und
   * ergänzt, ohne dass die Schlüssel doppelt im Index stehen müssten.
   */
  try {
    datenbank.exec(`
      create virtual table if not exists suche using fts5(
        betreff, absender, empfaenger, inhalt,
        tokenize = "unicode61 remove_diacritics 2"
      );
    `);
  } catch (err) {
    console.warn(`Volltextsuche steht nicht bereit: ${(err as Error).message}`);
  }
}

/**
 * Bringt eine Ablage auf den aktuellen Stand - Schritt für Schritt, ohne sie zu leeren.
 *
 * Drei Fälle:
 *
 *  - Die Ablage ist älter: die fehlenden Schritte laufen der Reihe nach. Der Bestand
 *    bleibt. Das ist der ganze Zweck dieser Umstellung.
 *  - Sie ist auf dem Stand: nichts geschieht.
 *  - Sie ist NEUER als der Code sie kennt (jemand hat eine ältere Fassung des Programms
 *    gestartet): rückwärts migrieren geht nicht. Hier wird geworfen, und der Aufrufer
 *    baut sie neu auf - vertretbar, weil sie ein Abbild ist und kein Original, aber es
 *    gehört ins Protokoll.
 */
function wendeMigrationenAn(d: DatabaseSync): void {
  // Muss vor allem anderen stehen: ohne diese Tabelle lässt sich die Fassung nicht lesen.
  d.exec('create table if not exists stand (schluessel text primary key, wert text)');

  const zeile = d.prepare("select wert from stand where schluessel = 'fassung'").get() as
    | { wert?: string }
    | undefined;
  /*
   * Keine Angabe heißt Fassung 0 - eine Ablage aus der Zeit, bevor es die Zählung gab,
   * oder eine ganz frische. In beiden Fällen laufen alle Schritte, und weil sie
   * durchgehend "if not exists" verwenden, ist das auf einer bestehenden Ablage
   * unschädlich.
   */
  const jetzt = Number(zeile?.wert ?? 0) || 0;
  const ziel = AUFBAU_FASSUNG();

  if (jetzt > ziel) {
    throw new Error(
      `Die Ablage ist auf Fassung ${jetzt}, dieses Programm kennt nur ${ziel}. ` +
        'Vermutlich lief hier schon einmal eine neuere Fassung.',
    );
  }
  if (jetzt === ziel) return;

  for (const migration of MIGRATIONEN.filter((m) => m.fassung > jetzt).sort(
    (a, b) => a.fassung - b.fassung,
  )) {
    /*
     * Jeder Schritt in einer eigenen Transaktion.
     *
     * Bricht er ab - kein Platz mehr, Datei gesperrt -, bleibt die Fassung auf dem Stand
     * davor, und beim nächsten Start wird genau dieser Schritt erneut versucht. Ohne die
     * Transaktion bliebe eine halb umgestellte Ablage zurück: Tabellen, die zur
     * eingetragenen Fassung nicht passen, und das fällt erst irgendwann später auf.
     */
    d.exec('begin');
    try {
      migration.auf(d);
      d.prepare("insert or replace into stand (schluessel, wert) values ('fassung', ?)").run(
        String(migration.fassung),
      );
      d.exec('commit');
    } catch (err) {
      try {
        d.exec('rollback');
      } catch {
        // Keine Transaktion mehr offen - dann ist ohnehin nichts zurückzunehmen.
      }
      throw new Error(
        `Umstellung auf Fassung ${migration.fassung} (${migration.beschreibung}) ` +
          `fehlgeschlagen: ${(err as Error).message}`,
      );
    }

    protokolliere(
      'info',
      'ablage',
      `Ablage auf Fassung ${migration.fassung} gebracht: ${migration.beschreibung}`,
    );
  }
}

/** Ob der Suchindex angelegt werden konnte. */
export function sucheVerfuegbar(): boolean {
  try {
    ablage().prepare('select count(*) from suche where suche match ?').get('probe');
    return true;
  } catch {
    return false;
  }
}

/**
 * Öffnet die Ablage. Beim ersten Zugriff angelegt; bei einer neueren Aufbaufassung
 * wird sie verworfen und neu erstellt - sie ist ein Abbild des Postfachs und lässt
 * sich jederzeit wiederherstellen, eine Umstellung wäre unnötiger Aufwand.
 */
export function ablage(): DatabaseSync {
  return datenbanken.hole();
}

/**
 * Ein Datenbankgriff JE NUTZER - nicht einer für alle.
 *
 * Hier stand `let db: DatabaseSync | null`, also genau ein Griff auf genau eine Datei.
 * Der Nutzerkontext schaltete zwar getPfad() um, aber wer die Ablage als Zweiter öffnete,
 * bekam die des Ersten zurück: Bert sah Annas Nachrichten. Keine Frage des
 * Speicherverbrauchs, sondern eine Vermischung von Daten.
 *
 * Gedeckelt, weil jede offene Datenbank ein Dateihandle und Arbeitsspeicher kostet. Fällt
 * eine heraus, wird sie beim nächsten Zugriff neu geöffnet - das kostet Millisekunden,
 * sonst nichts.
 */
const MAX_OFFENE_ABLAGEN = 50;

const datenbanken = jeNutzer<DatabaseSync>((nutzerId) => oeffneAblageFuer(nutzerId), {
  hoechstens: MAX_OFFENE_ABLAGEN,
  beimVerwerfen: (d) => {
    try {
      d.close();
    } catch {
      // Schon zu - unerheblich.
    }
  },
});

function oeffneAblageFuer(_nutzerId: string): DatabaseSync {
  fs.mkdirSync(getNutzerDir(), { recursive: true, mode: 0o700 });
  const pfad = getPfad();

  const oeffnen = () => {
    const d = new DatabaseSync(pfad);
    try {
      // Schreibvorgänge landen erst in einem Journal - dadurch blockiert ein Schreiber
      // die Leser nicht, und ein Absturz zerreißt die Datei nicht.
      d.exec('pragma journal_mode = wal');
      d.exec('pragma synchronous = normal');
      /*
       * Warten statt sofort aufgeben.
       *
       * Ohne busy_timeout wirft SQLite augenblicklich SQLITE_BUSY, sobald ein zweiter
       * Schreiber die Datei hält - ein Sicherungsprogramm, ein Virenwächter, eine
       * zweite Instanz, ein hängengebliebener Prozess. Getroffen hätte es ausgerechnet
       * den Offline-Weg: der antwortete dann mit einem Serverfehler statt mit dem
       * abgelegten Stand, also genau dann nicht, wenn er gebraucht wird.
       *
       * Fünf Sekunden sind großzügig für einen Vorgang, der Millisekunden dauert, und
       * kurz genug, dass eine Anfrage nicht ewig hängt.
       */
      d.exec('pragma busy_timeout = 5000');
      return d;
    } catch (err) {
      // Bei einer beschädigten Datei wirft erst dieser Befehl, nicht das Öffnen. Ohne
      // das Schließen bliebe ein Griff darauf offen, und unter Windows ließe sich die
      // Datei danach nicht mehr löschen - die Wiederherstellung liefe ins Leere.
      try {
        d.close();
      } catch {
        // Schon zu.
      }
      throw err;
    }
  };

  /** Löscht die Datei samt Journal - beides muss weg, sonst bleibt der alte Stand. */
  const loesche = () => {
    for (const p of [pfad, `${pfad}-wal`, `${pfad}-shm`]) fs.rmSync(p, { force: true });
  };

  /**
   * Öffnen und einrichten in einem. Muss vollständig hier drin liegen: eine beschädigte
   * Datei wirft nicht beim Öffnen, sondern erst beim ersten Befehl - beim "pragma", also
   * schon in oeffnen(). Stand das außerhalb der Absicherung, kam die Anwendung mit einer
   * kaputten Ablage gar nicht mehr hoch.
   */
  const einrichten = (): DatabaseSync => {
    const d = oeffnen();
    try {
      wendeMigrationenAn(d);
      return d;
    } catch (err) {
      // Der halb geöffnete Griff muss zu, sonst lässt sich die Datei nicht löschen.
      try {
        d.close();
      } catch {
        // Nie richtig offen gewesen.
      }
      throw err;
    }
  };

  try {
    return einrichten();
  } catch (err) {
    /*
     * Eine beschädigte oder veraltete Ablage darf die Anwendung nicht aufhalten - sie
     * ist ein Abbild, kein Original, und baut sich beim nächsten Abruf wieder auf.
     *
     * Über protokolliere statt console.warn: in der ausgelieferten Anwendung gibt es
     * kein stdout, und dass jemandem gerade sein gesamter Offline-Bestand neu aufgebaut
     * wird, ist genau die Zeile, die man im Fehlerbericht sehen will.
     */
    protokolliere(
      'warnung',
      'ablage',
      `Lokale Ablage wird neu angelegt: ${(err as Error).message}`,
    );
    loesche();
    return einrichten();
  }
}

/** Schließt die Ablage des aktuellen Nutzers. */
export function schliesseAblage(): void {
  datenbanken.verwirf();
}

/** Schließt alle offenen Ablagen - beim Herunterfahren des Servers. */
export function schliesseAlleAblagen(): void {
  datenbanken.verwirfAlle();
}

/** Nur für Tests: Ablage schließen und Datei löschen. */
export function verwirfAblage(): void {
  schliesseAblage();
  const pfad = getPfad();
  for (const p of [pfad, `${pfad}-wal`, `${pfad}-shm`]) fs.rmSync(p, { force: true });
}

/**
 * Gleicht die UID-Gültigkeit eines Ordners ab.
 *
 * Meldet der Server eine andere als die gemerkte, hat er die Nummerierung neu begonnen -
 * dann zeigen alle gemerkten UIDs auf nichts mehr, und das Gemerkte muss weg. Das ist
 * kein Ausnahmefall, den man ignorieren könnte: danach zeigte die Liste fremde
 * Nachrichten unter den falschen Betreffzeilen an.
 *
 * Gibt zurück, ob geleert wurde.
 */
export function pruefeUidGueltigkeit(
  konto: string,
  ordner: string,
  uidGueltigkeit: number | undefined,
): boolean {
  const d = ablage();
  const vorhanden = d
    .prepare('select uid_gueltigkeit from ordner where konto = ? and pfad = ?')
    .get(konto, ordner) as { uid_gueltigkeit?: number } | undefined;

  const alt = vorhanden?.uid_gueltigkeit ?? null;
  const neu = uidGueltigkeit ?? null;

  // Ohne Angabe des Servers lässt sich nichts feststellen - dann bleibt alles stehen.
  if (neu === null) return false;

  const geleert = alt !== null && alt !== neu;
  if (geleert) {
    loescheAusIndex(d, 'select rowid from nachrichten where konto = ? and ordner = ?', [konto, ordner]);
    d.prepare('delete from nachrichten where konto = ? and ordner = ?').run(konto, ordner);
    d.prepare('delete from inhalte where konto = ? and ordner = ?').run(konto, ordner);
  }

  d.prepare(
    `insert into ordner (konto, pfad, uid_gueltigkeit, letzter_abgleich)
     values (?, ?, ?, ?)
     on conflict (konto, pfad) do update set uid_gueltigkeit = ?, letzter_abgleich = ?`,
  ).run(konto, ordner, neu, Date.now(), neu, Date.now());

  return geleert;
}

/**
 * Nimmt die betroffenen Zeilen aus dem Suchindex.
 *
 * Muss vor dem Loeschen in "nachrichten" laufen - danach liessen sich die
 * Zeilennummern nicht mehr ermitteln, und der Index behielte Eintraege zu
 * Nachrichten, die es nicht mehr gibt.
 */
function loescheAusIndex(d: DatabaseSync, abfrage: string, werte: (string | number)[]): void {
  if (!sucheVerfuegbar()) return;
  const weg = d.prepare('delete from suche where rowid = ?');
  for (const z of d.prepare(abfrage).all(...werte) as { rowid: number }[]) weg.run(z.rowid);
}

/** Kopfdaten ablegen. Bereits Bekanntes wird ersetzt - der neue Stand gilt. */
export function merkeKopfdaten(
  konto: string,
  ordner: string,
  nachrichten: MessageSummary[],
): void {
  if (nachrichten.length === 0) return;
  const d = ablage();

  /**
   * Bewusst "on conflict do update" statt "insert or replace": das Ersetzen löscht die
   * Zeile und legt eine neue an, wodurch sie eine andere Zeilennummer bekäme. Über
   * genau diese Nummer hängt aber der Suchindex an der Nachricht - er zeigte danach
   * ins Leere, und die Suche fände Betreffzeilen, die es nicht mehr gibt.
   */
  const ein = d.prepare(
    `insert into nachrichten
     (konto, ordner, uid, message_id, thread_id, betreff, absender_name, absender_adresse,
      empfaenger, datum, gelesen, markiert, hat_anhaenge, list_id, abmeldeweg)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (konto, ordner, uid) do update set
       message_id = excluded.message_id, thread_id = excluded.thread_id,
       betreff = excluded.betreff, absender_name = excluded.absender_name,
       absender_adresse = excluded.absender_adresse, empfaenger = excluded.empfaenger,
       datum = excluded.datum, gelesen = excluded.gelesen, markiert = excluded.markiert,
       hat_anhaenge = excluded.hat_anhaenge, list_id = excluded.list_id,
       abmeldeweg = excluded.abmeldeweg`,
  );
  const nummer = d.prepare(
    'select rowid from nachrichten where konto = ? and ordner = ? and uid = ?',
  );

  const kannSuchen = sucheVerfuegbar();
  const indexWeg = kannSuchen ? d.prepare('delete from suche where rowid = ?') : null;
  const indexEin = kannSuchen
    ? d.prepare(
        'insert into suche (rowid, betreff, absender, empfaenger, inhalt) values (?, ?, ?, ?, ?)',
      )
    : null;
  const alterInhalt = kannSuchen
    ? d.prepare('select inhalt from suche where rowid = ?')
    : null;

  // In einem Zug: einzeln wären es bei tausend Nachrichten tausend Schreibvorgänge.
  d.exec('begin');
  try {
    for (const m of nachrichten) {
      const von = m.from[0];
      const empfaenger = m.to.map((a) => a.address).join(', ') || null;
      ein.run(
        konto,
        ordner,
        m.uid,
        m.messageId ?? null,
        m.threadId ?? null,
        m.subject ?? null,
        von?.name ?? null,
        von?.address ?? null,
        // Als Text, weil danach nicht sortiert wird - nur angezeigt und durchsucht.
        empfaenger,
        m.date ? m.date.getTime() : null,
        m.seen ? 1 : 0,
        m.flags.includes('\\Flagged') ? 1 : 0,
        m.hasAttachments ? 1 : 0,
        m.listId ?? null,
        m.listUnsubscribe ?? null,
      );

      if (!kannSuchen) continue;
      const zeile = nummer.get(konto, ordner, m.uid) as { rowid: number } | undefined;
      if (!zeile) continue;

      // Einen bereits indizierten Nachrichtentext nicht verlieren, nur weil die
      // Kopfdaten noch einmal hereinkommen.
      const bisher = alterInhalt!.get(zeile.rowid) as { inhalt?: string } | undefined;
      indexWeg!.run(zeile.rowid);
      indexEin!.run(
        zeile.rowid,
        m.subject ?? '',
        [von?.name, von?.address].filter(Boolean).join(' '),
        empfaenger ?? '',
        bisher?.inhalt ?? '',
      );
    }
    d.exec('commit');
  } catch (err) {
    d.exec('rollback');
    throw err;
  }
}

export interface AbgelegteNachricht {
  uid: number;
  subject: string;
  from: { name?: string; address: string }[];
  to: { address: string }[];
  date: Date | null;
  seen: boolean;
  flags: string[];
  hasAttachments: boolean;
  messageId?: string;
  threadId?: string;
  listId?: string;
  listUnsubscribe?: string;
}

interface Zeile {
  uid: number;
  message_id: string | null;
  thread_id: string | null;
  betreff: string | null;
  absender_name: string | null;
  absender_adresse: string | null;
  empfaenger: string | null;
  datum: number | null;
  gelesen: number;
  markiert: number;
  hat_anhaenge: number;
  list_id: string | null;
  abmeldeweg: string | null;
}

function zuNachricht(z: Zeile): AbgelegteNachricht {
  return {
    uid: z.uid,
    subject: z.betreff ?? '(kein Betreff)',
    from: z.absender_adresse
      ? [{ name: z.absender_name ?? undefined, address: z.absender_adresse }]
      : [],
    to: (z.empfaenger ?? '')
      .split(', ')
      .filter(Boolean)
      .map((address) => ({ address })),
    date: z.datum ? new Date(z.datum) : null,
    seen: z.gelesen === 1,
    flags: z.markiert === 1 ? ['\\Flagged'] : [],
    hasAttachments: z.hat_anhaenge === 1,
    messageId: z.message_id ?? undefined,
    threadId: z.thread_id ?? undefined,
    listId: z.list_id ?? undefined,
    listUnsubscribe: z.abmeldeweg ?? undefined,
  };
}

/**
 * Eine Seite aus der Ablage, neueste zuerst. "vorUid" blättert weiter zurück - dieselbe
 * Marke wie beim Abruf vom Server, damit beide Wege dieselbe Reihenfolge liefern.
 */
export function holeSeite(
  konto: string,
  ordner: string,
  optionen: { vorUid?: number; anzahl?: number } = {},
): AbgelegteNachricht[] {
  const anzahl = optionen.anzahl ?? 25;
  const d = ablage();

  const zeilen = optionen.vorUid
    ? d
        .prepare(
          `select * from nachrichten where konto = ? and ordner = ? and uid < ?
           order by datum desc, uid desc limit ?`,
        )
        .all(konto, ordner, optionen.vorUid, anzahl)
    : d
        .prepare(
          `select * from nachrichten where konto = ? and ordner = ?
           order by datum desc, uid desc limit ?`,
        )
        .all(konto, ordner, anzahl);

  return (zeilen as unknown as Zeile[]).map(zuNachricht);
}

export function anzahlAbgelegt(konto: string, ordner?: string): number {
  const d = ablage();
  const zeile = ordner
    ? d
        .prepare('select count(*) as n from nachrichten where konto = ? and ordner = ?')
        .get(konto, ordner)
    : d.prepare('select count(*) as n from nachrichten where konto = ?').get(konto);
  return Number((zeile as { n: number }).n);
}

/** Höchste bekannte UID eines Ordners - Ansatzpunkt für "was ist seitdem dazugekommen". */
export function hoechsteUid(konto: string, ordner: string): number | null {
  const zeile = ablage()
    .prepare('select max(uid) as m from nachrichten where konto = ? and ordner = ?')
    .get(konto, ordner) as { m: number | null };
  return zeile.m;
}

export function setzeGelesen(konto: string, ordner: string, uids: number[], gelesen: boolean): void {
  if (uids.length === 0) return;
  const d = ablage();
  const setze = d.prepare(
    'update nachrichten set gelesen = ? where konto = ? and ordner = ? and uid = ?',
  );
  d.exec('begin');
  try {
    for (const uid of uids) setze.run(gelesen ? 1 : 0, konto, ordner, uid);
    d.exec('commit');
  } catch (err) {
    d.exec('rollback');
    throw err;
  }
}

export function entferneNachrichten(konto: string, ordner: string, uids: number[]): void {
  if (uids.length === 0) return;
  const d = ablage();
  const wegK = d.prepare('delete from nachrichten where konto = ? and ordner = ? and uid = ?');
  const wegI = d.prepare('delete from inhalte where konto = ? and ordner = ? and uid = ?');
  d.exec('begin');
  try {
    for (const uid of uids) {
      loescheAusIndex(d, 'select rowid from nachrichten where konto = ? and ordner = ? and uid = ?', [konto, ordner, uid]);
      wegK.run(konto, ordner, uid);
      wegI.run(konto, ordner, uid);
    }
    d.exec('commit');
  } catch (err) {
    d.exec('rollback');
    throw err;
  }
}

/** Alles eines Kontos verwerfen - beim Entfernen des Kontos. */
export function verwerfeKontoAblage(konto: string): void {
  const d = ablage();
  d.exec('begin');
  try {
    loescheAusIndex(d, 'select rowid from nachrichten where konto = ?', [konto]);
    d.prepare('delete from nachrichten where konto = ?').run(konto);
    d.prepare('delete from inhalte where konto = ?').run(konto);
    d.prepare('delete from ordner where konto = ?').run(konto);
    d.exec('commit');
  } catch (err) {
    d.exec('rollback');
    throw err;
  }
}

export interface AbgelegterInhalt {
  html?: string;
  text?: string;
  anhaenge?: unknown[];
}

/**
 * Inhalt einer Nachricht ablegen. Danach wird der Bestand auf die Obergrenze gestutzt -
 * am längsten nicht Gelesenes zuerst.
 */
export function merkeInhalt(
  konto: string,
  ordner: string,
  uid: number,
  inhalt: AbgelegterInhalt,
): void {
  const d = ablage();
  d.prepare(
    `insert or replace into inhalte (konto, ordner, uid, html, text, anhaenge, zuletzt_gelesen)
     values (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    konto,
    ordner,
    uid,
    inhalt.html ?? null,
    inhalt.text ?? null,
    inhalt.anhaenge ? JSON.stringify(inhalt.anhaenge) : null,
    Date.now(),
  );

  // Den Text mit in den Suchindex nehmen - erst dadurch findet die Suche etwas, das
  // nur im Nachrichtentext steht und weder im Betreff noch beim Absender.
  if (inhalt.text && sucheVerfuegbar()) {
    const zeile = d
      .prepare('select rowid from nachrichten where konto = ? and ordner = ? and uid = ?')
      .get(konto, ordner, uid) as { rowid: number } | undefined;
    if (zeile) {
      const kopf = d
        .prepare('select betreff, absender, empfaenger from suche where rowid = ?')
        .get(zeile.rowid) as
        | { betreff: string; absender: string; empfaenger: string }
        | undefined;
      d.prepare('delete from suche where rowid = ?').run(zeile.rowid);
      d.prepare(
        'insert into suche (rowid, betreff, absender, empfaenger, inhalt) values (?, ?, ?, ?, ?)',
      ).run(
        zeile.rowid,
        kopf?.betreff ?? '',
        kopf?.absender ?? '',
        kopf?.empfaenger ?? '',
        // Gekürzt: die ersten Zehntausend Zeichen tragen praktisch jede Suche, und ein
        // Index über ganze Rundmails würde die Ablage aufblähen.
        inhalt.text.slice(0, 10_000),
      );
    }
  }

  const anzahl = Number(
    (d.prepare('select count(*) as n from inhalte').get() as { n: number }).n,
  );
  if (anzahl > MAX_INHALTE) {
    d.prepare(
      `delete from inhalte where rowid in (
         select rowid from inhalte order by zuletzt_gelesen asc limit ?
       )`,
    ).run(anzahl - MAX_INHALTE);
  }
}

export interface Suchtreffer extends AbgelegteNachricht {
  ordner: string;
}

/**
 * Sucht in der lokalen Ablage.
 *
 * Was gefunden wird: Betreff, Absender und Empfänger **aller** abgelegten Nachrichten,
 * dazu der Text derer, die schon einmal geöffnet waren. Das ist eine bewusste Grenze -
 * den Text aller 31.700 Nachrichten zu holen hieße, Stunden zu laden und Gigabyte
 * abzulegen. Die Oberfläche sagt das dazu und bietet daneben die Suche über den Server
 * an, die auch ungelesene Texte erreicht.
 */
export function sucheLokal(
  konto: string,
  text: string,
  optionen: { ordner?: string; grenze?: number } = {},
): Suchtreffer[] {
  const begriff = text.trim();
  if (!begriff || !sucheVerfuegbar()) return [];

  const d = ablage();
  const grenze = optionen.grenze ?? 100;

  /**
   * Die Eingabe in eine Suchanfrage übersetzen.
   *
   * Jedes Wort wird in Anführungszeichen gesetzt und mit "*" versehen: so gilt es als
   * Wortanfang statt als vollständiges Wort ("rechn" findet "Rechnung"), und
   * Sonderzeichen aus der Eingabe können die Anfrage nicht durcheinanderbringen -
   * ein eingetipptes "AND" oder eine Klammer wäre sonst Teil der Abfragesprache.
   */
  const anfrage = begriff
    .split(/\s+/)
    .filter(Boolean)
    .map((wort) => `"${wort.replace(/"/g, '""')}"*`)
    .join(' AND ');
  if (!anfrage) return [];

  const wo = optionen.ordner ? 'and n.ordner = ?' : '';
  const werte: (string | number)[] = optionen.ordner
    ? [anfrage, konto, optionen.ordner, grenze]
    : [anfrage, konto, grenze];

  try {
    const zeilen = d
      .prepare(
        `select n.* from suche s
         join nachrichten n on n.rowid = s.rowid
         where suche match ? and n.konto = ? ${wo}
         order by n.datum desc limit ?`,
      )
      .all(...werte);
    return (zeilen as unknown as (Zeile & { ordner: string })[]).map((z) => ({
      ...zuNachricht(z),
      ordner: z.ordner,
    }));
  } catch (err) {
    // Eine Anfrage, die FTS5 nicht versteht, ist kein Grund für einen Fehlerbildschirm.
    console.warn(`Lokale Suche nicht möglich: ${(err as Error).message}`);
    return [];
  }
}

/** Wie viele Nachrichten durchsuchbar sind - und bei wie vielen auch der Text. */
export function suchbestand(konto: string): { kopfdaten: number; mitText: number } {
  const d = ablage();
  return {
    kopfdaten: anzahlAbgelegt(konto),
    mitText: Number(
      (d.prepare('select count(*) as n from inhalte where konto = ?').get(konto) as { n: number })
        .n,
    ),
  };
}

export function holeInhalt(
  konto: string,
  ordner: string,
  uid: number,
): AbgelegterInhalt | null {
  const d = ablage();
  const zeile = d
    .prepare('select html, text, anhaenge from inhalte where konto = ? and ordner = ? and uid = ?')
    .get(konto, ordner, uid) as
    | { html: string | null; text: string | null; anhaenge: string | null }
    | undefined;
  if (!zeile) return null;

  // Beim Lesen die Uhr stellen, damit häufig Gelesenes nicht als Erstes hinausfliegt.
  d.prepare('update inhalte set zuletzt_gelesen = ? where konto = ? and ordner = ? and uid = ?').run(
    Date.now(),
    konto,
    ordner,
    uid,
  );

  return {
    html: zeile.html ?? undefined,
    text: zeile.text ?? undefined,
    anhaenge: zeile.anhaenge ? (JSON.parse(zeile.anhaenge) as unknown[]) : undefined,
  };
}

/** Wie groß die Ablage auf der Platte ist - für die Anzeige in den Einstellungen. */
export function ablageGroesse(): { bytes: number; nachrichten: number; inhalte: number } {
  const d = ablage();
  let bytes = 0;
  for (const p of [getPfad(), `${getPfad()}-wal`]) {
    try {
      bytes += fs.statSync(p).size;
    } catch {
      // Die Journaldatei gibt es nicht immer.
    }
  }
  return {
    bytes,
    nachrichten: Number((d.prepare('select count(*) as n from nachrichten').get() as { n: number }).n),
    inhalte: Number((d.prepare('select count(*) as n from inhalte').get() as { n: number }).n),
  };
}
