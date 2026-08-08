import fs from 'node:fs';
import path from 'node:path';
import { baueZeile, saeubere, type Stufe } from '@energy-mail/mail-core/protokoll';
import { getDataDir } from './paths.js';

/**
 * Das Protokoll auf der Platte.
 *
 * Bisher schrieb der Server nach stdout. Aus dem Quellbaum gestartet sieht man das im
 * Terminal; in der ausgelieferten Anwendung geht es ins Nichts. Sagt dort jemand "es
 * geht nicht", gibt es nichts zum Nachsehen.
 *
 * Zwei Dateien im Wechsel statt vieler: die laufende und die vorherige. Mehr braucht
 * niemand - was vor drei Tagen war, hilft bei einem Fehler von heute nicht, und eine
 * unbegrenzt wachsende Datei ist ihr eigenes Problem.
 *
 * Alles geht durch saeubere() (siehe protokoll.ts), damit der Bericht verschickt werden
 * kann, ohne ihn vorher Zeile für Zeile zu lesen.
 */

/** Ab hier wird umgeschaltet. Eine Million Zeichen sind grob 10.000 Zeilen. */
const HOECHSTENS_ZEICHEN = 1_000_000;

function ordner(): string {
  return path.join(getDataDir(), 'protokoll');
}

/** Die laufende Datei. */
export function protokollDatei(): string {
  return path.join(ordner(), 'energy-mail.log');
}

/** Die vorherige - beim Umschalten wird die laufende dorthin geschoben. */
export function vorherigeProtokollDatei(): string {
  return path.join(ordner(), 'energy-mail.1.log');
}

/**
 * Schaltet um, wenn die Datei zu groß geworden ist.
 *
 * Die vorherige wird dabei überschrieben. Das ist gewollt: zwei Stände genügen, und
 * eine Datei, die sich niemand ansieht, soll keinen Platz belegen.
 */
function schalteUmWennNoetig(): void {
  try {
    if (!fs.existsSync(protokollDatei())) return;
    if (fs.statSync(protokollDatei()).size < HOECHSTENS_ZEICHEN) return;
    fs.rmSync(vorherigeProtokollDatei(), { force: true });
    fs.renameSync(protokollDatei(), vorherigeProtokollDatei());
  } catch {
    // Lässt sich die Datei nicht verschieben (etwa weil ein Virenwächter sie hält),
    // wird weitergeschrieben. Ein zu großes Protokoll ist besser als gar keines.
  }
}

/**
 * Schreibt eine Zeile - und zwar sofort auf die Platte.
 *
 * Bewusst synchron. Ein Schreibstrom puffert, und beim Absturz wäre die letzte Zeile
 * womöglich nie angekommen - genau die, um die es dann geht. Eine Prüfung hat mir das
 * hier vorgeführt: geschrieben, gleich darauf gelesen, nichts da.
 *
 * Der Preis ist gering. Im Betrieb fallen wenige Zeilen je Sekunde an; ein Anhängen an
 * eine offene Datei kostet Mikrosekunden. Bei einem Protokoll ist Verlässlichkeit mehr
 * wert als Durchsatz.
 *
 * Wirft nie: von hier aus werden auch Abstürze festgehalten, und dann ist ohnehin schon
 * etwas schiefgelaufen.
 */
export function protokolliere(stufe: Stufe, herkunft: string, text: string): void {
  try {
    fs.mkdirSync(ordner(), { recursive: true });
    schalteUmWennNoetig();
    fs.appendFileSync(protokollDatei(), baueZeile(new Date(), stufe, herkunft, text) + '\n');
  } catch {
    /* siehe oben */
  }
}

/** Liest beide Stände, ältester Teil zuerst. Für den Fehlerbericht. */
export function lesProtokoll(): string {
  const teile: string[] = [];
  for (const datei of [vorherigeProtokollDatei(), protokollDatei()]) {
    try {
      if (fs.existsSync(datei)) teile.push(fs.readFileSync(datei, 'utf8'));
    } catch {
      teile.push(`(${path.basename(datei)} ließ sich nicht lesen)`);
    }
  }
  // Noch einmal durch die Reinigung: die Datei kann aus einer älteren Fassung stammen,
  // deren Regeln weniger streng waren.
  return saeubere(teile.join(''));
}

/**
 * Hängt den Protokollschreiber an einen Fastify-Logger.
 *
 * Fastify schreibt über pino nach stdout. Statt pino umzubauen, wird hier mitgehört -
 * so bleibt die Ausgabe im Terminal erhalten, wenn man aus dem Quellbaum startet, und
 * die Datei bekommt dasselbe.
 */
export function fastifyProtokollZiel(): { write: (zeile: string) => void } {
  return {
    write(roh: string) {
      process.stdout.write(roh);
      try {
        const eintrag = JSON.parse(roh) as {
          level?: number;
          msg?: string;
          req?: { method?: string; url?: string };
          res?: { statusCode?: number };
          responseTime?: number;
          err?: { message?: string };
        };
        // Nur das Wesentliche in die Datei: eine Zeile je Anfrage, nicht zwei, und
        // ohne den ganzen Kopfzeilensalat.
        const stufe: Stufe = (eintrag.level ?? 30) >= 50 ? 'fehler' : (eintrag.level ?? 30) >= 40 ? 'warnung' : 'info';
        if (eintrag.res && eintrag.req === undefined) return; // die "incoming request"-Hälfte
        if (eintrag.req) {
          protokolliere(stufe, 'http', `${eintrag.req.method} ${eintrag.req.url}`);
          return;
        }
        const text = eintrag.err?.message ?? eintrag.msg;
        if (text) protokolliere(stufe, 'server', text);
      } catch {
        // Keine JSON-Zeile - dann wörtlich übernehmen.
        protokolliere('info', 'server', roh.trimEnd());
      }
    },
  };
}
