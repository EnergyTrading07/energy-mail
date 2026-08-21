import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { MessageSummary } from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { jeNutzer } from './nutzer/jeNutzer.js';
import { istVerschluesselt } from './geschuetzteAblage.js';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secretCrypto.js';
import { protokolliere } from './protokollDatei.js';
import { t } from '@energy-mail/mail-core/sprache';

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
 * Der Wortlaut der Nachrichten - verschlüsselt abgelegt.
 *
 * Bis hierher galt: verschlüsselt sind die Zugangsdaten, nicht die Post. Wer den
 * Benutzerordner kopierte oder die Platte ausbaute, konnte in `ablage.db` den vollen Text
 * jeder gelesenen Nachricht lesen, ohne ein Kennwort zu kennen. Derselbe Schlüssel wie
 * bei den Geheimnissen (siehe geschuetzteAblage.ts): am Windows-Benutzerkonto gebunden,
 * je Nutzer verschieden.
 *
 * **Was das gekostet hat, und zwar bewusst:** der Volltextindex führte den Nachrichtentext
 * mit - eine FTS5-Tabelle legt den Originaltext ab, nicht nur die Wortliste. Verschlüsselt
 * man die Inhalte und lässt den Index, steht der Wortlaut unverändert daneben und die
 * Verschlüsselung ist Theater. Der Index deckt deshalb nur noch Betreff, Absender und
 * Empfänger ab; die Suche im Nachrichtentext gibt es lokal nicht mehr, dafür weiter über
 * den Anbieter. Die Oberfläche sagt das an der Stelle, an der es auffällt.
 *
 * Betreff, Absender und Datum bleiben im Klartext. Sie tragen die Liste, die Sortierung
 * und eben den Index - sie zu verschlüsseln hieße, das Postfach ohne Verbindung gar nicht
 * mehr anzeigen zu können. Das steht so auch in DATENSCHUTZ.md, statt einen Schutz zu
 * behaupten, den es nicht gibt.
 */

/** Verschlüsselt einen Wert für die Ablage - wo keine Verschlüsselung steht, bleibt er. */
function verpacke(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) return null;
  // Ohne eingerichteten Schlüssel (Werkzeuge, Prüfungen, Standalone ohne Master-Passwort)
  // wie bisher im Klartext - sonst bräche dort alles, was mit Post zu tun hat.
  return isEncryptionAvailable() ? encryptSecret(wert) : wert;
}

/**
 * Gegenstück zu verpacke - und der Weg für Altbestand.
 *
 * Drei Fälle, und alle drei kommen vor:
 *  - verschlüsselt und lesbar: der Normalfall.
 *  - Klartext aus der Zeit vor der Umstellung: bleibt lesbar. Ein Zwangsdurchlauf über
 *    alle Zeilen liefe beim ersten Start nach der Aktualisierung über hunderte Megabyte;
 *    die Umstellung erledigt die Migration einmal geordnet (siehe MIGRATIONEN).
 *  - sieht verschlüsselt aus, lässt sich aber nicht öffnen: dann `null`. Das ist der
 *    richtige Ausgang und kein Fehler - die Ablage ist ein Abbild, und was sich nicht
 *    lesen lässt, wird beim nächsten Abruf neu geholt. Eine Nachricht mit Kauderwelsch
 *    anzuzeigen wäre die schlechtere Antwort.
 *
 * Der dritte Fall ist auch der Grund für das try: ein Nachrichtentext, der zufällig mit
 * "v1." anfängt ("v1.2.3 ist draußen"), sieht für istVerschluesselt() aus wie ein
 * Geheimnis. Das Entschlüsseln scheitert dann an der Form, noch bevor ein Schlüssel
 * gebraucht wird - und der Text geht unverändert zurück.
 */
function entpacke(wert: string | null | undefined): string | null {
  if (wert === null || wert === undefined) return null;
  if (!istVerschluesselt(wert)) return wert;
  try {
    return decryptSecret(wert);
  } catch {
    return sichtVerschluesselt(wert) ? null : wert;
  }
}

/** Trägt der Wert die volle Form eines Geheimnisses - oder fängt er nur zufällig so an? */
function sichtVerschluesselt(wert: string): boolean {
  return wert.split('.').length === 4;
}

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
  {
    fassung: 2,
    beschreibung: 'Nachrichtentexte verschluesseln und aus dem Suchindex nehmen',
    auf: (d) => verschluesseleInhalte(d),
  },
];

/**
 * Bringt eine bestehende Ablage auf die verschlüsselten Inhalte.
 *
 * Zwei Dinge, und nur zusammen ergeben sie etwas: die abgelegten Texte werden
 * verschlüsselt, und der Nachrichtentext verschwindet aus dem Volltextindex. Bliebe der
 * Index, stünde der Wortlaut weiterhin im Klartext in derselben Datei - eine FTS5-Tabelle
 * legt den Originaltext ab, nicht nur die Wortliste.
 *
 * Läuft genau einmal je Installation, in der Transaktion des Migrationsschritts. Bei den
 * 2.000 Inhalten, die höchstens vorliegen, sind das gemessen unter zwei Sekunden.
 *
 * Ohne eingerichteten Schlüssel wird nur der Index geleert. Das ist der Fall bei
 * Werkzeugen und Prüfungen; die Inhalte gehen dann später durch verpacke(), sobald sie
 * ohnehin neu geschrieben werden.
 */
function verschluesseleInhalte(d: DatabaseSync): void {
  const zeilen = d
    .prepare('select rowid as nummer, html, text, anhaenge from inhalte')
    .all() as { nummer: number; html: string | null; text: string | null; anhaenge: string | null }[];

  if (isEncryptionAvailable() && zeilen.length > 0) {
    const schreibe = d.prepare(
      'update inhalte set html = ?, text = ?, anhaenge = ? where rowid = ?',
    );
    for (const z of zeilen) {
      // Was schon verschlüsselt ist, bleibt: ein zweiter Umschlag wäre kein Schaden, aber
      // ein abgebrochener und wiederholter Lauf soll nichts doppelt verpacken.
      schreibe.run(
        istVerschluesselt(z.html ?? '') ? z.html : verpacke(z.html),
        istVerschluesselt(z.text ?? '') ? z.text : verpacke(z.text),
        istVerschluesselt(z.anhaenge ?? '') ? z.anhaenge : verpacke(z.anhaenge),
        z.nummer,
      );
    }
  }

  /*
   * Den Index WEGWERFEN und neu aufbauen - nicht leeren.
   *
   * Das ist der Unterschied, an dem die ganze Umstellung hing, und er war an einer Kopie
   * des echten Bestands zu sehen: nach einem "delete from suche" standen die Wörter der
   * alten Nachrichtentexte weiterhin in der Datei. FTS5 führt seinen Index in
   * Segmentblöcken (der Schattentabelle suche_data); ein Löschen von Zeilen setzt dort
   * Grabsteine und schreibt die Segmente erst bei einer späteren Verschmelzung neu. Der
   * gesamte Wortschatz jeder gelesenen Nachricht blieb also lesbar - ohne Reihenfolge,
   * aber vollständig. Für "verschlüsselt" wäre das zu wenig gewesen.
   *
   * "drop table" nimmt alle Schattentabellen mit. Danach steht der Index neu und enthält
   * nur, was hier ausdrücklich hineingeschrieben wird.
   */
  try {
    d.exec('drop table if exists suche');
    d.exec(SUCHINDEX_AUFBAU);
    const ein = d.prepare(
      'insert into suche (rowid, betreff, absender, empfaenger, inhalt) values (?, ?, ?, ?, ?)',
    );
    const kopf = d
      .prepare(
        'select rowid as nummer, betreff, absender_name, absender_adresse, empfaenger from nachrichten',
      )
      .all() as {
      nummer: number;
      betreff: string | null;
      absender_name: string | null;
      absender_adresse: string | null;
      empfaenger: string | null;
    }[];
    for (const k of kopf) {
      ein.run(
        k.nummer,
        k.betreff ?? '',
        [k.absender_name, k.absender_adresse].filter(Boolean).join(' '),
        k.empfaenger ?? '',
        '',
      );
    }
  } catch (err) {
    // Ohne Volltextsuche (FTS5 nicht verfügbar) gibt es auch nichts auszuräumen.
    console.warn(`Suchindex nicht neu aufgebaut: ${(err as Error).message}`);
  }
}

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
    datenbank.exec(SUCHINDEX_AUFBAU);
  } catch (err) {
    console.warn(`Volltextsuche steht nicht bereit: ${(err as Error).message}`);
  }
}

/**
 * Der Aufbau des Suchindex - an einer Stelle, weil er an zweien gebraucht wird.
 *
 * Die Spalte "inhalt" steht noch darin und bleibt leer, seit die Nachrichtentexte
 * verschlüsselt liegen. Sie zu entfernen hieße, den Index bei jeder bestehenden
 * Installation neu aufzubauen - für eine Spalte, die überall leer ist.
 */
const SUCHINDEX_AUFBAU = `
  create virtual table if not exists suche using fts5(
    betreff, absender, empfaenger, inhalt,
    tokenize = "unicode61 remove_diacritics 2"
  );
`;

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
      // Die Ursache haengt daran: Die Meldung nennt die Umstellung, der urspruengliche
      // Fehler nennt die Zeile in SQLite, an der es scheiterte - und die braucht man.
      throw new Error(
        `Umstellung auf Fassung ${migration.fassung} (${migration.beschreibung}) ` +
          `fehlgeschlagen: ${(err as Error).message}`,
        { cause: err },
      );
    }

    protokolliere(
      'info',
      'ablage',
      `Ablage auf Fassung ${migration.fassung} gebracht: ${migration.beschreibung}`,
    );
  }

  /*
   * Die Datei einmal neu schreiben, nachdem umgestellt wurde.
   *
   * Ohne das wäre die Umstellung auf verschlüsselte Inhalte eine halbe: der ersetzte
   * Klartext bliebe in den freigewordenen Seiten der Datei stehen, und wer sie mit einem
   * Editor öffnet, läse weiterhin die alten Nachrichten - neben ihrer verschlüsselten
   * Fassung. "pragma secure_delete" fängt das beim laufenden Betrieb ab, aber auf eine
   * Zusicherung dieser Größe soll sich nicht verlassen, wer sie einmal geordnet
   * herstellen kann.
   *
   * Muss außerhalb jeder Transaktion stehen - innerhalb weist SQLite es ab -, und darf
   * scheitern: umgestellt ist dann trotzdem.
   */
  try {
    d.exec('vacuum');
  } catch (err) {
    protokolliere(
      'warnung',
      'ablage',
      `Ablage nach der Umstellung nicht neu geschrieben: ${(err as Error).message}`,
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
      /*
       * Gelöscht heißt hier auch überschrieben.
       *
       * Ohne diese Angabe hakt SQLite eine gelöschte Zeile nur als "Platz ist wieder
       * frei" ab und lässt den Inhalt stehen, bis zufällig etwas anderes darüber
       * geschrieben wird. Die Folge war eine, die kein Nutzer erwartet: er löscht eine
       * Nachricht, sie verschwindet aus der Liste - und ihr vollständiger Text steht
       * weiter in ablage.db, für jeden lesbar, der die Datei mit einem Texteditor
       * öffnet. Dasselbe beim Entfernen eines ganzen Kontos, und dasselbe bei der
       * Ausdünnung der Inhalte auf MAX_INHALTE.
       *
       * Der Preis ist gering: SQLite schreibt die freigewordenen Bytes mit Nullen zu,
       * also ein zusätzlicher Schreibvorgang je gelöschter Seite. Bei einer Ablage, in
       * die im Betrieb ein paar Zeilen je Minute gehen, ist das nicht messbar. Gemessen
       * an dem, was hier steht - der Text fremder Post -, wäre auch ein spürbarer Preis
       * angemessen.
       *
       * Bezieht sich nur auf künftige Löschungen. Was in einer bestehenden Ablage schon
       * in freien Seiten liegt, räumt das "vacuum" in verwerfeKontoAblage() aus.
       */
      d.exec('pragma secure_delete = on');
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
  /*
   * Die Spalte "inhalt" bleibt in der Tabelle und bleibt leer.
   *
   * Hier wurde vorher ein bereits indizierter Nachrichtentext herübergerettet, damit er
   * beim erneuten Hereinkommen der Kopfdaten nicht verlorenging. Seit die Inhalte
   * verschlüsselt liegen, geht kein Text mehr in den Index - es gibt nichts zu retten.
   *
   * Stehen bleibt die Spalte trotzdem: sie aus einer FTS5-Tabelle zu entfernen hieße, den
   * Index bei jeder bestehenden Installation neu aufzubauen, und der Gewinn wäre eine
   * Spalte, die überall leer ist.
   */

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

      indexWeg!.run(zeile.rowid);
      indexEin!.run(
        zeile.rowid,
        m.subject ?? '',
        [von?.name, von?.address].filter(Boolean).join(' '),
        empfaenger ?? '',
        '',
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
    subject: z.betreff ?? t('(kein Betreff)'),
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

  /*
   * Die Datei danach neu schreiben.
   *
   * "Konto entfernen" ist die eine Handlung, bei der ein Mensch erwartet, dass danach
   * nichts mehr da ist - und bis hierher stimmt das für die Datenbank, aber nicht für
   * die Datei: SQLite behält die freigewordenen Seiten und gibt sie erst nach und nach
   * wieder aus. Das "vacuum" schreibt die Ablage von Grund auf neu, ohne diese Seiten.
   * Es ist die einzige Stelle, an der auch Altbestände verschwinden, die vor
   * "secure_delete" gelöscht wurden.
   *
   * Muss AUSSERHALB der Transaktion stehen - innerhalb weist SQLite es ab. Und es darf
   * scheitern, ohne dass das Entfernen des Kontos scheitert: die Daten sind dann gelöscht,
   * nur die Datei ist noch so groß wie vorher.
   */
  try {
    d.exec('vacuum');
  } catch (err) {
    protokolliere(
      'warnung',
      'ablage',
      `Ablage nach dem Entfernen eines Kontos nicht neu geschrieben: ${(err as Error).message}`,
    );
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
    verpacke(inhalt.html),
    verpacke(inhalt.text),
    verpacke(inhalt.anhaenge ? JSON.stringify(inhalt.anhaenge) : null),
    Date.now(),
  );

  /*
   * Hier stand die Aufnahme des Nachrichtentextes in den Suchindex, und sie ist bewusst
   * weg.
   *
   * Eine FTS5-Tabelle legt den Originaltext ab, nicht nur die Wortliste. Der Index war
   * damit eine vollständige, unverschlüsselte zweite Fassung jeder gelesenen Nachricht -
   * gleich daneben in derselben Datei. Die Inhalte oben zu verschlüsseln und den Index zu
   * lassen, hieße den Wortlaut zu verschließen und den Schlüssel danebenzulegen.
   *
   * Der Preis ist echt und wird nicht kleingeredet: "Rechnung" im Nachrichtentext findet
   * die lokale Suche nicht mehr, nur noch im Betreff, beim Absender und beim Empfänger.
   * Dafür gibt es die Suche über den Anbieter, die ohnehin weiter reicht - sie erreicht
   * auch die 29.700 Nachrichten, deren Text nie hier lag. Der Hinweis unter dem
   * Suchergebnis sagt beides (siehe MessageList.tsx).
   */

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
 * Was gefunden wird: Betreff, Absender und Empfänger **aller** abgelegten Nachrichten.
 * Nicht mehr der Nachrichtentext - seit die Inhalte verschlüsselt liegen, geht er nicht
 * mehr in den Index, weil eine FTS5-Tabelle den Originaltext ablegt und damit die
 * Verschlüsselung aufhöbe (siehe oben bei verpacke()).
 *
 * Das ist die eine Stelle, an der der Schutz etwas gekostet hat, und die Oberfläche sagt
 * es unter jedem Suchergebnis: für den Nachrichtentext gibt es die Suche über den
 * Anbieter. Die reichte ohnehin weiter - sie erreicht auch die Nachrichten, deren Text
 * nie hier lag, und das sind die allermeisten.
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

/**
 * Wie viele Nachrichten durchsuchbar sind - und bei wie vielen der Text ohne Verbindung
 * bereitliegt.
 *
 * "mitText" heißt seit der Verschlüsselung der Inhalte nicht mehr "durchsuchbar", sondern
 * "offline lesbar". Der Name bleibt, damit die Oberfläche nicht mitwandern muss; was er
 * bedeutet, steht dort in Worten (siehe MessageList.tsx).
 */
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

  const anhaenge = entpacke(zeile.anhaenge);
  return {
    html: entpacke(zeile.html) ?? undefined,
    text: entpacke(zeile.text) ?? undefined,
    /*
     * Der Auffang gilt der Anhangsliste, nicht der Entschlüsselung.
     *
     * Steht dort etwas, das kein JSON ist - ein halb geschriebener Stand, ein Rest aus
     * einer älteren Fassung -, ist die richtige Antwort "keine Anhänge bekannt" und nicht
     * ein Fehler beim Öffnen der Nachricht. Der Text ist das, wofür sie geöffnet wird.
     */
    anhaenge: anhaenge ? sicherAlsListe(anhaenge) : undefined,
  };
}

function sicherAlsListe(roh: string): unknown[] | undefined {
  try {
    const wert = JSON.parse(roh) as unknown;
    return Array.isArray(wert) ? wert : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wirft den gesamten zwischengespeicherten Bestand weg.
 *
 * Der Gegenpol zu allem, was diese Datei sonst tut. Was hier liegt, ist die eigentliche
 * Post: Betreffzeilen, Absender und der Wortlaut der zuletzt gelesenen Nachrichten - und
 * anders als die Zugangsdaten liegt es unverschlüsselt da (siehe DATENSCHUTZ.md). Bis
 * hierher gab es keinen Weg, es wieder loszuwerden, außer die Datei von Hand im
 * Benutzerordner zu suchen. Wer seinen Rechner weitergibt, jemandem beim Vortrag den
 * Bildschirm überlässt oder schlicht nicht möchte, dass ein halbes Jahr Post
 * mitgeschrieben wird, hatte keinen Knopf dafür.
 *
 * Der Preis ist gering und genau benannt: die Liste ist ohne Verbindung eine Weile leer,
 * und die Volltextsuche findet nur, was seitdem wieder abgerufen wurde. Nichts davon ist
 * verloren - das Original liegt beim Postfachanbieter, und der Bestand baut sich beim
 * nächsten Abruf von selbst wieder auf.
 *
 * Gibt zurück, was weggeworfen wurde - die Oberfläche soll es benennen können, statt
 * "erledigt" zu melden.
 */
export function leereAblage(): { nachrichten: number; inhalte: number; bytes: number } {
  const vorher = ablageGroesse();
  const d = ablage();

  d.exec('begin');
  try {
    // Der Suchindex zuerst: er hängt an den rowids der Nachrichtentabelle, und die sind
    // nach dem Löschen dort nicht mehr aufzulösen.
    if (sucheVerfuegbar()) d.exec('delete from suche');
    d.exec('delete from inhalte');
    d.exec('delete from nachrichten');
    d.exec('delete from ordner');
    d.exec('commit');
  } catch (err) {
    d.exec('rollback');
    throw err;
  }

  /*
   * Und die Datei danach neu schreiben.
   *
   * Ohne das bliebe sie so groß wie zuvor, und der Inhalt stünde weiter in ihren freien
   * Seiten - bei einem Knopf, dessen ganzer Zweck das Wegräumen ist, wäre das die
   * Zusicherung, die am meisten enttäuscht. Wie in verwerfeKontoAblage() außerhalb der
   * Transaktion, und ein Fehlschlag hier macht das Löschen nicht rückgängig.
   */
  try {
    d.exec('vacuum');
  } catch (err) {
    protokolliere(
      'warnung',
      'ablage',
      `Ablage nach dem Leeren nicht neu geschrieben: ${(err as Error).message}`,
    );
  }

  protokolliere(
    'info',
    'ablage',
    `Zwischenspeicher geleert: ${vorher.nachrichten} Kopfdaten, ${vorher.inhalte} Inhalte.`,
  );
  return { nachrichten: vorher.nachrichten, inhalte: vorher.inhalte, bytes: vorher.bytes };
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
