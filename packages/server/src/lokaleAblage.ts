import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MessageSummary } from '@energy-mail/mail-core';
import { getDataDir } from './paths.js';

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

/** Fassung des Aufbaus. Steigt sie, wird die Ablage neu aufgebaut statt umgestellt. */
const AUFBAU_FASSUNG = 1;

let db: DatabaseSync | null = null;

const getPfad = () => path.join(getDataDir(), 'ablage.db');

/**
 * Legt Tabellen und Indizes an.
 *
 * Der Schlüssel jeder Nachricht ist Konto + Ordner + UID. Das ist die einzige Kennung,
 * die IMAP zusichert - und auch die nur, solange die "UID-Gültigkeit" des Ordners
 * gleich bleibt. Ändert der Server sie, sind alle gemerkten UIDs wertlos; darum steht
 * sie mit in der Ordnertabelle und wird bei jedem Abgleich verglichen.
 */
function baueAuf(datenbank: DatabaseSync): void {
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
}

/**
 * Öffnet die Ablage. Beim ersten Zugriff angelegt; bei einer neueren Aufbaufassung
 * wird sie verworfen und neu erstellt - sie ist ein Abbild des Postfachs und lässt
 * sich jederzeit wiederherstellen, eine Umstellung wäre unnötiger Aufwand.
 */
export function ablage(): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(getDataDir(), { recursive: true });
  const pfad = getPfad();

  const oeffnen = () => {
    const d = new DatabaseSync(pfad);
    try {
      // Schreibvorgänge landen erst in einem Journal - dadurch blockiert ein Schreiber
      // die Leser nicht, und ein Absturz zerreißt die Datei nicht.
      d.exec('pragma journal_mode = wal');
      d.exec('pragma synchronous = normal');
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
      baueAuf(d);
      const vorhanden = d
        .prepare("select wert from stand where schluessel = 'fassung'")
        .get() as { wert?: string } | undefined;
      if (vorhanden && Number(vorhanden.wert) !== AUFBAU_FASSUNG) {
        throw new Error(`Aufbaufassung ${vorhanden.wert} statt ${AUFBAU_FASSUNG}`);
      }
      d.prepare("insert or replace into stand (schluessel, wert) values ('fassung', ?)").run(
        String(AUFBAU_FASSUNG),
      );
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
    db = einrichten();
  } catch (err) {
    // Eine beschädigte oder veraltete Ablage darf die Anwendung nicht aufhalten - sie
    // ist ein Abbild, kein Original, und baut sich beim nächsten Abruf wieder auf.
    console.warn(`Lokale Ablage wird neu angelegt: ${(err as Error).message}`);
    loesche();
    db = einrichten();
  }

  return db;
}

export function schliesseAblage(): void {
  db?.close();
  db = null;
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

/** Kopfdaten ablegen. Bereits Bekanntes wird ersetzt - der neue Stand gilt. */
export function merkeKopfdaten(
  konto: string,
  ordner: string,
  nachrichten: MessageSummary[],
): void {
  if (nachrichten.length === 0) return;
  const d = ablage();

  const ein = d.prepare(
    `insert or replace into nachrichten
     (konto, ordner, uid, message_id, thread_id, betreff, absender_name, absender_adresse,
      empfaenger, datum, gelesen, markiert, hat_anhaenge, list_id, abmeldeweg)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // In einem Zug: einzeln wären es bei tausend Nachrichten tausend Schreibvorgänge.
  d.exec('begin');
  try {
    for (const m of nachrichten) {
      const von = m.from[0];
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
        m.to.map((a) => a.address).join(', ') || null,
        m.date ? m.date.getTime() : null,
        m.seen ? 1 : 0,
        m.flags.includes('\\Flagged') ? 1 : 0,
        m.hasAttachments ? 1 : 0,
        m.listId ?? null,
        m.listUnsubscribe ?? null,
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
