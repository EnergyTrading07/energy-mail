import fs from 'node:fs';
import path from 'node:path';
import { getNutzerDirFuer, getWurzelDir } from '../paths.js';

/**
 * Bringt die Daten einer bestehenden Einplatz-Installation in den Ordner ihres Nutzers.
 *
 * Bis hierher lagen Konten, Adressbuch, Regeln und alles Übrige unmittelbar im
 * Benutzerordner. Mit dem Nutzerbegriff liegen sie unter nutzer/<id>/. Ohne diesen Umzug
 * fände die Anwendung nach der Aktualisierung nichts mehr wieder: kein Konto, kein
 * Adressbuch, keine Regeln - für den Nutzer sähe es aus, als hätte das Programm alles
 * vergessen.
 *
 * Nur einmal, und nur nach oben: was schon im Nutzerordner liegt, wird nie überschrieben.
 */

/**
 * Was mitkommt.
 *
 * Ausdrücklich aufgezählt und nicht "alles, was da liegt" - im Wurzelverzeichnis liegen
 * auch Dinge, die dort BLEIBEN sollen: die Schlüsseldatei (sie gilt für alle Nutzer),
 * das Salt des Masterschlüssels und der Protokollordner. Eine Ausschlussliste hätte
 * genau diese drei vergessen können; eine Aufzählung kann das nicht.
 */
const NUTZERDATEIEN = [
  'accounts.json',
  'contacts.json',
  'regeln.json',
  'etiketten.json',
  'suchen.json',
  'sendungen.json',
  'wiedervorlage.json',
  'vertraute-absender.json',
  'schluesselbund.json',
  'oauth-clients.json',
  'cache.json',
  'ablage.db',
  // SQLite legt neben der Datei zwei Begleiter an. Bleiben sie zurück, hält SQLite die
  // Datenbank für beschädigt - ein Umzug, der den Bestand kostet.
  'ablage.db-wal',
  'ablage.db-shm',
];

/** Merkt, dass der Umzug gelaufen ist - er soll sich nicht bei jedem Start wiederholen. */
const MARKE = '.umzug-nutzer-v1';

export interface Umzugsbericht {
  gelaufen: boolean;
  verschoben: string[];
  /** Was nicht verschoben werden konnte, mit Grund - nichts davon ist ein Abbruchgrund. */
  probleme: string[];
}

/**
 * Führt den Umzug aus, falls nötig.
 *
 * @param nachNutzer Wessen Ordner die Bestandsdaten bekommen - im Einplatzbetrieb "lokal".
 */
export function ziehePerBestandUm(nachNutzer: string): Umzugsbericht {
  const wurzel = getWurzelDir();
  const bericht: Umzugsbericht = { gelaufen: false, verschoben: [], probleme: [] };

  const markeDatei = path.join(wurzel, MARKE);
  if (fs.existsSync(markeDatei)) return bericht;

  // Gibt es überhaupt etwas umzuziehen? Bei einer frischen Installation nicht - dann
  // wird nur die Marke gesetzt, damit die Prüfung nicht bei jedem Start läuft.
  const vorhanden = NUTZERDATEIEN.filter((name) => fs.existsSync(path.join(wurzel, name)));

  const ziel = getNutzerDirFuer(nachNutzer);
  fs.mkdirSync(ziel, { recursive: true, mode: 0o700 });

  for (const name of vorhanden) {
    const von = path.join(wurzel, name);
    const nach = path.join(ziel, name);
    try {
      if (fs.existsSync(nach)) {
        /*
         * Im Zielordner steht schon etwas. Das darf nicht überschrieben werden - es wäre
         * der neuere Stand. Die alte Datei bleibt liegen, statt sie zu löschen: sie
         * kostet ein paar Kilobyte und ist im Zweifel die letzte Kopie.
         */
        bericht.probleme.push(`${name}: liegt im Nutzerordner bereits - alte Fassung bleibt stehen`);
        continue;
      }
      fs.renameSync(von, nach);
      bericht.verschoben.push(name);
    } catch (err) {
      /*
       * Ein einzelner Fehlschlag bricht den Umzug nicht ab.
       *
       * Sonst hinge die Anwendung dauerhaft: eine Datei, die etwa vom Virenwächter kurz
       * gehalten wird, ließe den Umzug bei jedem Start neu und immer wieder scheitern.
       * Was nicht mitkam, steht im Bericht und kann von Hand nachgeholt werden.
       */
      bericht.probleme.push(`${name}: ${(err as Error).message}`);
    }
  }

  bericht.gelaufen = true;

  // Die Marke erst ganz am Ende: bricht der Vorgang vorher ab, läuft er beim nächsten
  // Start erneut und holt nach, was fehlt.
  try {
    fs.writeFileSync(
      markeDatei,
      `Am ${new Date().toISOString()} wurden die Bestandsdaten nach nutzer/${nachNutzer}/ ` +
        `verschoben.\nDiese Datei verhindert, dass der Umzug erneut laeuft.\n`,
      'utf-8',
    );
  } catch (err) {
    bericht.probleme.push(`Marke nicht gesetzt: ${(err as Error).message}`);
  }

  return bericht;
}

/**
 * Löscht den Datenordner eines Nutzers.
 *
 * Hier und nicht zweimal: Das Befehlszeilenwerkzeug tat es mit einem eigenen `rmSync`, die
 * Verwaltung im Browser hätte ein zweites gebraucht. Zwei Fassungen desselben Löschvorgangs
 * laufen früher oder später auseinander - und bei einem Löschvorgang heisst das, dass die
 * eine etwas stehen lässt, was die andere mitnimmt.
 *
 * Bewusst getrennt vom Entfernen des Eintrags: Mit dem Eintrag geht der Schlüssel, und
 * damit ist alles in diesem Ordner ohnehin nur noch Bytes. Die Dateien wegzuwerfen ist der
 * unumkehrbare Teil, und den soll ausdrücklich verlangen, wer ihn will.
 */
export function entferneNutzerdaten(id: string): void {
  fs.rmSync(getNutzerDirFuer(id), { recursive: true, force: true });
}
