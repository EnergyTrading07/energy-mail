import fs from 'node:fs';
import path from 'node:path';
import { getWurzelDir } from '../paths.js';
import { schreibeAtomar } from '../atomar.js';
import { alleNutzer, verwalterAnzahl } from '../nutzer/nutzerStore.js';
import { alleFreigaben } from '../nutzer/freigaben.js';
import { sperrfristMinuten } from '../nutzer/sitzung.js';
import { verzeichnisFuerAnzeige } from '../verzeichnis.js';
import { isEncryptionAvailable } from '../secretCrypto.js';
import type { Umstaende } from './lage.js';

/**
 * Was hier tatsächlich läuft.
 *
 * ## Warum das erhoben und nicht angenommen wird
 *
 * Weil eine Datenschutzunterlage, die Beispielangaben enthält, schlechter ist als keine.
 * Sie sieht vollständig aus, wird abgeheftet, und in dem Moment, in dem jemand sie liest -
 * eine Aufsichtsbehörde, ein Betriebsrat, ein Kunde im Audit -, stellt sich heraus, dass
 * sie einen anderen Betrieb beschreibt.
 *
 * Alles, was sich aus dem laufenden Stand ablesen lässt, wird deshalb abgelesen: welche
 * Anbieter benutzt werden, wie viele Menschen Zugang haben, ob das Verzeichnis angebunden
 * ist, wie lang die Sperrfrist steht. Was sich nicht ablesen lässt - ob es einen
 * Betriebsrat gibt, wer den Server betreibt -, wird gefragt und aufbewahrt.
 *
 * ## Die Trennlinie
 *
 * `erhoben` kommt aus dem System und lässt sich nicht eintippen. `angegeben` kommt vom
 * Menschen. Beides getrennt zu halten ist wichtig: In den Papieren steht später, welche
 * Angabe woher stammt, und niemand soll eine erhobene Zahl für eine geschätzte halten -
 * oder umgekehrt.
 */

export interface Angaben {
  betrieb?: string;
  anschrift?: string;
  vertreten?: string;
  datenschutzbeauftragter?: string;
  /** Wer den Server betreibt - der Betrieb selbst oder ein Dienstleister. */
  betreiber: 'selbst' | 'dienstleister';
  dienstleister?: string;
  /** Ob jemand von außen zu Wartungszwecken herankommen kann. */
  fernwartung: boolean;
  fernwarter?: string;
  betriebsrat: boolean;
  /** Ob die Nutzer Beschäftigte des Betriebs sind. */
  beschaeftigte: boolean;
  /** Rein private Nutzung - dann greift die Haushaltsausnahme. */
  privat: boolean;
}

const VORGABE: Angaben = {
  betreiber: 'selbst',
  fernwartung: false,
  betriebsrat: false,
  beschaeftigte: true,
  privat: false,
};

const getPfad = () => path.join(getWurzelDir(), 'datenschutz.json');

export function angaben(): Angaben {
  try {
    const roh = JSON.parse(fs.readFileSync(getPfad(), 'utf-8')) as Angaben;
    if (roh && typeof roh === 'object') return { ...VORGABE, ...roh };
  } catch {
    // Keine Datei - dann die Vorgaben.
  }
  return VORGABE;
}

export function setzeAngaben(neu: Partial<Angaben>): Angaben {
  const wert: Angaben = { ...angaben(), ...neu };
  fs.mkdirSync(getWurzelDir(), { recursive: true, mode: 0o700 });
  schreibeAtomar(getPfad(), JSON.stringify(wert, null, 2));
  return wert;
}

/** Was sich aus dem laufenden Stand ablesen lässt. */
export interface Erhoben {
  nutzer: number;
  verwalter: number;
  mitZweiFaktor: number;
  freigaben: number;
  /** Die Anbieter, bei denen Postfächer liegen - nach Domäne des Servers. */
  postfachanbieter: string[];
  /** Wie viele Konten insgesamt eingerichtet sind. */
  konten: number;
  /** Wie viele davon über OAuth angemeldet sind statt mit Kennwort. */
  ueberOAuth: number;
  verzeichnis: boolean;
  archiv: boolean;
  archivKonten: number;
  verschluesselungBereit: boolean;
  sperrfristMinuten: number;
}

/**
 * Liest die Anbieter aus den Konten aller Nutzer.
 *
 * Der Serverteil der Postfachadresse und nicht die Mailadresse: Wir brauchen die STELLE,
 * an der die Post liegt, und die steht im IMAP-Server. Wer eine eigene Domäne bei
 * Microsoft betreibt, hat "firma.de" in der Adresse und Microsoft als Verarbeiter - und
 * genau der gehört ins Verzeichnis.
 */
function anbieterAus(konten: readonly { imap?: { host?: string } }[]): string[] {
  const namen = new Set<string>();
  for (const konto of konten) {
    const host = konto.imap?.host?.trim().toLowerCase();
    if (!host) continue;
    const teile = host.split('.');
    namen.add(teile.length > 2 ? teile.slice(-2).join('.') : host);
  }
  return [...namen].sort();
}

/**
 * Erhebt den Stand über alle Nutzer hinweg.
 *
 * ## Warum hier fremde Nutzerordner betreten werden
 *
 * Weil ein Verarbeitungsverzeichnis für den Betrieb gilt und nicht für einen Menschen
 * darin. „Bei welchen Anbietern liegt unsere Post?" lässt sich nur beantworten, indem man
 * alle Konten ansieht.
 *
 * Gelesen wird dabei ausdrücklich **nur der Servername und die Anmeldeart** - nicht die
 * Zugangsdaten, nicht die Adressen, nicht ein einziges Wort einer Nachricht. Die Angabe,
 * die herauskommt, ist "microsoft.com" und "google.com", und die steht am Ende in einem
 * Papier, das der Betrieb ohnehin führen muss.
 *
 * Aufgerufen wird das nur von einem Verwalter; der Riegel steht in der Route.
 */
export function erhebe(
  alsNutzer: <T>(id: string, fn: () => T) => T,
  konten: () => readonly { imap?: { host?: string }; auth?: { type?: string } }[],
  archivStand: () => { aktiv: boolean; konten: number },
): Erhoben {
  const nutzer = alleNutzer();
  let verzeichnisAn = false;
  try {
    verzeichnisAn = verzeichnisFuerAnzeige().aktiv;
  } catch {
    // Kein Verzeichnis eingerichtet.
  }

  const alleKonten: { imap?: { host?: string }; auth?: { type?: string } }[] = [];
  let archivAn = false;
  let archivKonten = 0;
  for (const n of nutzer) {
    try {
      alsNutzer(n.id, () => {
        alleKonten.push(...konten());
        const stand = archivStand();
        if (stand.aktiv) archivAn = true;
        archivKonten += stand.konten;
      });
    } catch {
      // Ein Nutzer ohne lesbaren Ordner darf die Erhebung nicht aufhalten - was fehlt,
      // fehlt, und das Papier soll trotzdem entstehen.
    }
  }

  return {
    nutzer: nutzer.length,
    verwalter: verwalterAnzahl(),
    mitZweiFaktor: nutzer.filter((n) => n.zweiFaktor).length,
    freigaben: alleFreigaben().length,
    postfachanbieter: anbieterAus(alleKonten),
    konten: alleKonten.length,
    ueberOAuth: alleKonten.filter((k) => k.auth?.type === 'oauth').length,
    verzeichnis: verzeichnisAn,
    archiv: archivAn,
    archivKonten,
    verschluesselungBereit: isEncryptionAvailable(),
    sperrfristMinuten: sperrfristMinuten(),
  };
}

/** Fügt die beiden Teile zu den Umständen zusammen, die beurteileLage() braucht. */
export function umstaendeAus(a: Angaben, e: Erhoben): Umstaende {
  return {
    betriebsart: e.nutzer > 1 || a.beschaeftigte ? 'server' : 'einzelplatz',
    beschaeftigte: a.beschaeftigte,
    privat: a.privat,
    betreiber: a.betreiber,
    fernwartung: a.fernwartung,
    betriebsrat: a.betriebsrat,
    postfachanbieter: e.postfachanbieter,
    verzeichnis: e.verzeichnis,
    archiv: e.archiv,
  };
}
