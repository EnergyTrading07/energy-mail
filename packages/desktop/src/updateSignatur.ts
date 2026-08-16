import crypto from 'node:crypto';
import fs from 'node:fs';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Die eigene Unterschrift unter einer Aktualisierung.
 *
 * ---
 *
 * WAS VORHER GEPRÜFT WURDE: NICHTS.
 *
 * electron-updater prüft die Codesignatur einer heruntergeladenen Fassung nur dann, wenn
 * in der app-update.yml ein `publisherName` steht - sonst steigt es in der ersten Zeile
 * aus:
 *
 *     publisherName = (await this.configOnDisk.value).publisherName;
 *     if (publisherName == null) return null;
 *
 * Der Eintrag entsteht aus dem Codesignierzertifikat. Es gibt keines, also stand er nicht
 * da, also fand keine Prüfung statt. Übrig blieb als einziger Anker: TLS zu github.com,
 * und die Frage, wer eine Veröffentlichung in das Repository legen darf. Die SHA512 in
 * der latest.yml ist dabei KEINE unabhängige Prüfung - sie schreibt dieselbe Partei, die
 * auch die .exe hochlädt. Wer den GitHub-Zugang übernimmt, bekommt damit die Ausführung
 * von Code auf jedem Rechner, auf dem Energy Mail installiert ist.
 *
 * ---
 *
 * WARUM EIN EIGENER SCHLÜSSEL UND NICHT (NUR) EIN ZERTIFIKAT.
 *
 * Ein Codesignierzertifikat nimmt die SmartScreen-Warnung bei der Erstinstallation, und
 * dafür wird es später auch angeschafft. Gegen die Bedrohung oben hilft es aber nicht:
 * ein Zertifikat, mit dem die CI signiert, liegt als Geheimnis IN der CI. Wer den
 * GitHub-Zugang übernimmt, signiert seine Fassung einfach mit - die Prüfung geht durch,
 * und sie ist danach sogar überzeugender als vorher.
 *
 * Dieser Schlüssel liegt woanders. Er verlässt den Rechner nicht, auf dem er erzeugt
 * wurde, und die CI kennt ihn nicht. Unterschrieben wird von Hand, nach dem Bau - siehe
 * scripts/freigeben.mjs. Damit deckt er genau das ab, was das Zertifikat offenlässt, und
 * umgekehrt. Beide zusammen sind die vollständige Antwort; dieser hier ist der Teil, der
 * nichts kostet und sofort geht.
 *
 * ---
 *
 * WAS ER NICHT KANN.
 *
 * Er sagt nichts über die ERSTE Installation. Wer sich die Datei von Hand herunterlädt,
 * bekommt weiterhin die Warnung von SmartScreen, und diese Prüfung läuft dort gar nicht -
 * sie greift erst, wenn eine installierte Fassung sich selbst erneuert. Das ist keine
 * Nachlässigkeit, sondern die Aufgabenteilung: die Erstinstallation ist die Aufgabe des
 * Zertifikats.
 *
 * Und er wirkt erst ab der übernächsten Fassung vollständig: eine bereits installierte
 * 0.2.1 kennt diesen öffentlichen Schlüssel nicht und prüft deshalb den Schritt auf die
 * Fassung, die ihn einführt, noch nicht. Ab da prüft jede.
 */

/**
 * Der öffentliche Schlüssel, gegen den geprüft wird - als SPKI in Base64.
 *
 * Er steht ausgeschrieben im Programmtext und nicht in einer Datei daneben. Das ist der
 * Kern: eine Datei im Installationsverzeichnis ließe sich austauschen, und wer den
 * Schlüssel austauschen kann, kann jede Fassung unterschreiben. So steckt er im
 * app.asar - dieselbe Datei, deren Unversehrtheit später die Codesignierung mitträgt.
 *
 * Der zugehörige geheime Teil liegt auf genau einem Rechner und ist nirgends sonst.
 * Geht er verloren, lässt sich keine Aktualisierung mehr freigeben, und der Weg zurück
 * führt über eine von Hand verteilte Fassung mit einem neuen Schlüssel - deshalb gehört
 * er gesichert. scripts/schluessel-erzeugen.mjs sagt das beim Anlegen noch einmal.
 */
export const OEFFENTLICHER_SCHLUESSEL =
  'MCowBQYDK2VwAyEA/L+aguonIPMoA/zrjqrrKpRiDg+le8XKVd0S+u535GU=';

/**
 * Ob überhaupt ein Schlüssel hinterlegt ist.
 *
 * Solange der Platzhalter dasteht, gibt es keinen - dann darf die Prüfung nicht
 * stillschweigend durchwinken, aber sie darf auch nicht jede Aktualisierung abweisen und
 * die Selbstaktualisierung damit ganz abschalten. Was in dem Fall geschieht, entscheidet
 * der Aufrufer; hier steht nur die Auskunft.
 */
export function schluesselHinterlegt(): boolean {
  return !OEFFENTLICHER_SCHLUESSEL.includes('PLATZHALTER');
}

/** Wie die unterschriebene Angabe aussieht - dieselbe Form beim Bilden und beim Prüfen. */
export interface Freigabe {
  /** Format dieser Datei, damit sich später etwas ändern lässt. */
  fassung: number;
  /** Die Fassung, für die sie gilt - ohne "v". */
  version: string;
  /** Der Name der Datei, auf die sie sich bezieht. */
  datei: string;
  /** SHA512 dieser Datei, hexadezimal. */
  sha512: string;
  /** Die Unterschrift über den Text aus baueUnterlage(), Base64. */
  signatur: string;
}

/** Wie lange auf die Freigabedatei gewartet wird. */
const FRIST_MS = 15_000;

/**
 * Der Text, der tatsächlich unterschrieben wird.
 *
 * Er nennt Fassung UND Prüfsumme. Beides ist nötig: die Prüfsumme bindet die Unterschrift
 * an genau diese Datei, die Fassung verhindert, dass sich eine gültige Unterschrift von
 * früher für eine andere Fassung wiederverwenden lässt. Der Vorsatz in der ersten Zeile
 * trennt die Verwendung ab - eine Unterschrift von hier soll nirgendwo sonst als gültig
 * durchgehen können.
 */
export function baueUnterlage(version: string, sha512: string): Buffer {
  return Buffer.from(`energy-mail-aktualisierung-v1\n${version}\n${sha512.toLowerCase()}\n`, 'utf-8');
}

/** SHA512 einer Datei, hexadezimal - dasselbe Format, das auch die latest.yml nennt. */
export function sha512VonDatei(pfad: string): Promise<string> {
  return new Promise((fertig, schiefgegangen) => {
    const hash = crypto.createHash('sha512');
    const strom = fs.createReadStream(pfad);
    strom.on('error', schiefgegangen);
    strom.on('data', (stueck) => hash.update(stueck));
    strom.on('end', () => fertig(hash.digest('hex')));
  });
}

/** Prüft eine Unterschrift gegen den hinterlegten Schlüssel. */
export function unterschriftStimmt(
  version: string,
  sha512: string,
  signaturBase64: string,
  oeffentlicherSchluessel: string = OEFFENTLICHER_SCHLUESSEL,
): boolean {
  try {
    const schluessel = crypto.createPublicKey({
      key: Buffer.from(oeffentlicherSchluessel, 'base64'),
      format: 'der',
      type: 'spki',
    });
    // Ed25519: der Algorithmus steckt im Schlüssel, deshalb null als erstes Argument.
    return crypto.verify(
      null,
      baueUnterlage(version, sha512),
      schluessel,
      Buffer.from(signaturBase64, 'base64'),
    );
  } catch {
    // Unbrauchbarer Schlüssel, unbrauchbare Unterschrift - beides heißt "stimmt nicht".
    return false;
  }
}

/**
 * Holt die Freigabedatei zu einer Fassung.
 *
 * Sie liegt als eigener Anhang an derselben Veröffentlichung. Die Adresse wird hier
 * gebaut und nicht aus der Aktualisierungsauskunft übernommen - die bestimmt, wer die
 * Veröffentlichung anlegt, und der soll nicht zusätzlich bestimmen können, wo die
 * Unterschrift herkommt.
 */
export async function holeFreigabe(
  besitzer: string,
  ablage: string,
  version: string,
): Promise<Freigabe> {
  const adresse = `https://github.com/${besitzer}/${ablage}/releases/download/v${version}/signatur.json`;
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const antwort = await fetch(adresse, { signal: abbruch.signal, redirect: 'follow' });
    if (!antwort.ok) {
      throw new Error(`signatur.json nicht abrufbar (HTTP ${antwort.status})`);
    }
    const roh = (await antwort.json()) as Partial<Freigabe>;
    if (
      typeof roh.version !== 'string' ||
      typeof roh.sha512 !== 'string' ||
      typeof roh.signatur !== 'string' ||
      typeof roh.datei !== 'string'
    ) {
      throw new Error('signatur.json hat nicht die erwartete Form');
    }
    return roh as Freigabe;
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * Das Ergebnis der Prüfung.
 *
 * `null` heißt "in Ordnung" - dieselbe Übereinkunft wie bei electron-updater, damit sich
 * das Ergebnis unverändert weiterreichen lässt. Eine Zeichenkette ist die Begründung der
 * Ablehnung und landet in der Fehlermeldung.
 */
export type Befund = string | null;

/**
 * Prüft eine heruntergeladene Datei gegen die Freigabe ihrer Veröffentlichung.
 *
 * Fehlerschließend in jedem Zweig: keine Freigabedatei, kein Netz, eine Prüfsumme, die
 * nicht passt, eine Fassung, die nicht passt - alles führt zur Ablehnung. Das ist die
 * richtige Richtung. Eine Aktualisierung, die nicht eingespielt wird, ist ein Ärgernis;
 * eine, die zu Unrecht eingespielt wird, ist der Verlust des Rechners.
 */
export async function pruefeAktualisierung(
  datei: string,
  version: string,
  besitzer: string,
  ablage: string,
): Promise<Befund> {
  let freigabe: Freigabe;
  try {
    freigabe = await holeFreigabe(besitzer, ablage, version);
  } catch (err) {
    return `Die Freigabe zu Fassung ${version} ließ sich nicht holen: ${(err as Error).message}`;
  }

  if (freigabe.version !== version) {
    return t('Die Freigabe gilt für Fassung {freigegeben}, geladen wurde {geladen}.', {
      freigegeben: freigabe.version,
      geladen: version,
    });
  }

  const gerechnet = await sha512VonDatei(datei);
  if (gerechnet.toLowerCase() !== freigabe.sha512.toLowerCase()) {
    return (
      t(
        'Die heruntergeladene Datei stimmt nicht mit der freigegebenen überein (erwartet {erwartet}…, gerechnet {gerechnet}…).',
        { erwartet: freigabe.sha512.slice(0, 16), gerechnet: gerechnet.slice(0, 16) },
      )
    );
  }

  if (!unterschriftStimmt(freigabe.version, freigabe.sha512, freigabe.signatur)) {
    return t('Die Unterschrift unter dieser Fassung stammt nicht vom Herausgeber.');
  }

  return null;
}
