import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';
import { getWurzelDir } from './paths.js';
import { protokolliere } from './protokollDatei.js';

/**
 * Die Desktop-Fassung zum Herunterladen - vom eigenen Server.
 *
 * ## Warum vom eigenen und nicht von GitHub
 *
 * Weil ein Betrieb, der diesen Dienst selbst betreibt, meistens genau deshalb selbst
 * betreibt: Die Arbeitsplätze sollen nicht ins offene Netz müssen, und welche Fassung
 * seine Leute bekommen, entscheidet er. Ein Knopf, der auf eine fremde Seite führt,
 * nimmt ihm beides ab.
 *
 * ## Warum es hier KEINEN Weg zum Hochladen gibt
 *
 * Das ist die wichtigste Entscheidung an dieser Datei, und sie ist bewusst unbequem: Der
 * Betreiber legt die Datei über den Weg in den Ordner, den er ohnehin hat - SSH, ein
 * eingebundenes Verzeichnis, das Bereitstellungswerkzeug. Ein Upload über HTTP wäre
 * bequemer und wäre zugleich das Gefährlichste, was dieser Server anbieten könnte: eine
 * Route, über die sich ausführbare Dateien auf den Server schreiben lassen. Sie hinge an
 * genau einer Rechteprüfung, und ein übernommenes Verwalterkonto - über ein
 * zurückgesetztes Kennwort etwa - wäre damit die Erlaubnis, an alle Arbeitsplätze des
 * Betriebs ein eigenes Programm zu verteilen. Aus einem Mailserver würde eine
 * Softwareverteilung.
 *
 * Der Ordner steht deshalb in der Verwaltung nur mit seinem Pfad und seinem Inhalt da.
 *
 * ## Und warum der Abruf eine Anmeldung verlangt
 *
 * Eine Installationsdatei ist nichts Geheimes. Sie im offenen Netz auszulegen ist
 * trotzdem unnötig: Es ist Bandbreite, die sich von außen abrufen lässt, ohne dass
 * jemand dazugehört. Wer die Desktop-Fassung braucht, meldet sich vorher im Browser an -
 * er hat ja ein Konto, sonst nützte ihm das Programm nichts.
 */

/** Wo die Dateien liegen. Ein Unterordner des Datenverzeichnisses. */
export const DOWNLOAD_ORDNER = 'downloads';

export function downloadOrdner(): string {
  return path.join(getWurzelDir(), DOWNLOAD_ORDNER);
}

/**
 * Welche Endungen ausgeliefert werden.
 *
 * Eine Erlaubnisliste und keine Verbotsliste - der Unterschied ist der zwischen "was wir
 * uns vorstellen konnten" und "was wir gemeint haben". Was hier nicht steht, wird nicht
 * herausgegeben, auch wenn es im Ordner liegt: ein versehentlich dorthin geratenes
 * Sicherungsarchiv, eine Textdatei mit Notizen, irgendetwas mit `.env` im Namen.
 */
const ERLAUBTE_ENDUNGEN = ['.exe', '.msi', '.dmg', '.pkg', '.appimage', '.deb', '.rpm', '.zip'];

/** Was der Oberfläche über eine Datei mitgeteilt wird. */
export interface Downloaddatei {
  name: string;
  groesse: number;
  /** ISO-Zeitpunkt der letzten Änderung - damit sich alte Stände erkennen lassen. */
  stand: string;
  /** Grob geratene Zielplattform, für die Beschriftung des Knopfes. */
  system: 'windows' | 'mac' | 'linux' | 'unbekannt';
}

function systemAus(name: string): Downloaddatei['system'] {
  const endung = path.extname(name).toLowerCase();
  if (endung === '.exe' || endung === '.msi') return 'windows';
  if (endung === '.dmg' || endung === '.pkg') return 'mac';
  if (endung === '.appimage' || endung === '.deb' || endung === '.rpm') return 'linux';
  return 'unbekannt';
}

/**
 * Ob ein Name als Datei in diesem Ordner durchgeht.
 *
 * Geprüft wird der NAME und nicht der zusammengesetzte Pfad, und er muss ein reiner
 * Dateiname sein: kein Trennzeichen, kein `..`, kein Laufwerksbuchstabe. Damit ist der
 * Ausbruch aus dem Ordner ausgeschlossen, bevor überhaupt ein Pfad entsteht - der
 * Vergleich hinterher ("liegt das Ergebnis noch im Ordner?") ist die zweite Sicherung
 * und nicht die erste.
 */
function nameErlaubt(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name !== path.basename(name)) return false;
  if (name.startsWith('.')) return false;
  return ERLAUBTE_ENDUNGEN.includes(path.extname(name).toLowerCase());
}

/** Was im Ordner liegt - leer, wenn es ihn nicht gibt. */
export function verfuegbareDateien(): Downloaddatei[] {
  const ordner = downloadOrdner();
  let eintraege: fs.Dirent[];
  try {
    eintraege = fs.readdirSync(ordner, { withFileTypes: true });
  } catch {
    // Kein Ordner heißt: nichts bereitgestellt. Das ist kein Fehler, sondern der
    // Auslieferungszustand.
    return [];
  }

  const dateien: Downloaddatei[] = [];
  for (const eintrag of eintraege) {
    /*
     * Nur echte Dateien. Ein Symlink könnte auf etwas außerhalb des Ordners zeigen -
     * `withFileTypes` meldet ihn als `isSymbolicLink`, und `isFile` ist dann falsch.
     */
    if (!eintrag.isFile()) continue;
    if (!nameErlaubt(eintrag.name)) continue;
    try {
      const stand = fs.statSync(path.join(ordner, eintrag.name));
      dateien.push({
        name: eintrag.name,
        groesse: stand.size,
        stand: stand.mtime.toISOString(),
        system: systemAus(eintrag.name),
      });
    } catch {
      // Eine Datei, die zwischen readdir und stat verschwindet, gehört nicht in die Liste.
    }
  }
  return dateien.sort((a, b) => a.name.localeCompare(b.name));
}

export function registriereDownload(app: FastifyInstance): void {
  /**
   * Was es zum Herunterladen gibt.
   *
   * Hinter der Anmeldung, weil alles hinter der Anmeldung liegt, was nicht ausdrücklich
   * in OFFENE_PFADE steht - und das ist hier richtig so.
   */
  app.get('/download', async () => ({ dateien: verfuegbareDateien() }));

  /**
   * Eine Datei ausliefern.
   *
   * Der Name wird gegen die LISTE geprüft und nicht nur gegen ein Muster: Ausgeliefert
   * wird ausschließlich, was `verfuegbareDateien()` ohnehin schon anzeigt. Damit gibt es
   * genau eine Stelle, die entscheidet, was in diesem Ordner zählt - und keine zweite,
   * die es beim nächsten Mal anders sieht.
   */
  app.get<{ Params: { datei: string } }>('/download/:datei', async (request, reply) => {
    const gewuenscht = request.params.datei;
    if (!nameErlaubt(gewuenscht)) {
      return reply.code(400).send({ error: t('Diese Datei gibt es hier nicht.') });
    }
    if (!verfuegbareDateien().some((d) => d.name === gewuenscht)) {
      return reply.code(404).send({ error: t('Diese Datei gibt es hier nicht.') });
    }

    const voll = path.join(downloadOrdner(), gewuenscht);
    /*
     * Die zweite Sicherung: Der zusammengesetzte Pfad muss im Ordner liegen.
     *
     * Nach nameErlaubt() kann er das gar nicht anders - aber diese Zeile kostet nichts
     * und fängt den Tag ab, an dem jemand die Namensprüfung "nur ein bisschen"
     * auflockert. Bei einem Weg, an dessen Ende eine Datei vom Server geht, ist die
     * Richtung des Zweifels immer dieselbe.
     */
    const ordner = path.resolve(downloadOrdner());
    if (!path.resolve(voll).startsWith(ordner + path.sep)) {
      protokolliere('warnung', 'download', `Abgewiesener Pfad: ${gewuenscht}`);
      return reply.code(400).send({ error: t('Diese Datei gibt es hier nicht.') });
    }

    /*
     * `attachment` und ein neutraler Inhaltstyp.
     *
     * Ohne beides entscheidet der Browser, was er mit der Datei tut - und bei manchen
     * Typen heißt das: anzeigen statt speichern. Eine Installationsdatei will
     * gespeichert werden, und der Name in der Kopfzeile ist der, den der Ordner vorgibt.
     */
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Disposition', `attachment; filename="${gewuenscht}"`);
    return reply.send(fs.createReadStream(voll));
  });
}

/**
 * Was der Verwalter ueber den Ordner wissen muss.
 *
 * Unter /verwaltung und damit hinter dem Riegel dieses Praefixes - nicht weil der Pfad
 * geheim waere, sondern weil er einen gewoehnlichen Nutzer nichts angeht: Er ist eine
 * Angabe ueber den Rechner, auf dem der Dienst laeuft.
 *
 * Herausgegeben wird der Pfad, ob es den Ordner gibt, und was darin liegt. Kein Weg zum
 * Hochladen - die Begruendung dafuer steht oben im Kopf dieser Datei und ist der
 * wichtigste Absatz darin.
 */
export function registriereDownloadVerwaltung(app: FastifyInstance): void {
  app.get('/verwaltung/download', async () => {
    const ordner = downloadOrdner();
    return {
      ordner,
      /*
       * Ob es ihn gibt. Der Unterschied zwischen "leer" und "nicht angelegt" ist der
       * zwischen zwei ganz verschiedenen Saetzen fuer den Betreiber: einmal "legen Sie
       * etwas hinein", einmal "legen Sie ihn an".
       */
      vorhanden: fs.existsSync(ordner),
      endungen: ERLAUBTE_ENDUNGEN,
      dateien: verfuegbareDateien(),
    };
  });
}
