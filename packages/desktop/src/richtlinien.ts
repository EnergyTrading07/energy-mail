import fs from 'node:fs';
import path from 'node:path';

/**
 * Vorgaben, die nicht der Nutzer macht, sondern seine Organisation.
 *
 * Der Unterschied zu einstellungen.ts ist nicht technischer, sondern grundsätzlicher
 * Art: dort steht, was der Nutzer will, und er darf es jederzeit ändern. Hier steht, was
 * für ihn entschieden wurde, und er kann es nicht. Deshalb liegen die beiden an
 * verschiedenen Orten - und dieser hier ist einer, an den ein gewöhnliches Benutzerkonto
 * unter Windows nicht schreiben darf:
 *
 *   %PROGRAMDATA%\Energy Mail\richtlinien.json
 *
 * Läge die Datei im Profil des Nutzers, wäre sie keine Vorgabe, sondern ein Vorschlag.
 *
 * ## Warum es das überhaupt gibt
 *
 * Die Selbstaktualisierung. Sie ist für einen Privatrechner richtig - sie schließt
 * Sicherheitslücken, ohne dass jemand daran denken muss. In einem Unternehmen ist sie
 * genau verkehrt herum: dort entscheidet die IT, welche Fassung wann auf welchen Rechner
 * kommt, sie prüft vorher, und sie will nicht, dass sich hundert Arbeitsplätze
 * eigenmächtig und zu verschiedenen Zeitpunkten umstellen. Ein Programm, das sich das
 * nicht abgewöhnen lässt, wird in solchen Umgebungen gar nicht erst zugelassen.
 *
 * ## Bewusst klein gehalten
 *
 * Hier steht nur, was heute wirklich gebraucht wird. Eine ausgewachsene Richtlinienablage
 * mit dreißig Schaltern ist leicht geschrieben und schwer wieder loszuwerden; jeder
 * Schalter ist ein Versprechen, das in jeder künftigen Fassung noch gelten muss.
 */

export interface Richtlinien {
  /**
   * Die Selbstaktualisierung bleibt aus - Suche, Download und Einspielen.
   *
   * Auch der Knopf "Nach Aktualisierungen suchen" sagt dann, dass die Fassung von der
   * Organisation vorgegeben wird. Ihn stillschweigend wirkungslos zu machen wäre
   * schlimmer als ihn abzuschalten: der Nutzer klickte und bekäme nichts, und niemand
   * wüsste warum.
   */
  aktualisierungAbschalten: boolean;

  /**
   * Ein Text, der in "Über Energy Mail" erscheint - für den innerbetrieblichen
   * Ansprechpartner.
   *
   * Ohne das steht dort die Projektseite auf GitHub, und ein Mitarbeiter mit einem
   * Problem wendet sich an Fremde statt an seine eigene IT.
   */
  ansprechpartner?: string;

  /**
   * Der vorgeschriebene Weg nach draußen - etwa `http://proxy.firma.de:3128`.
   *
   * Schlägt eine abweichende Angabe am Konto. Das ist der Punkt: sonst genügte ein
   * eigener Eintrag im Kontodialog, um die Ausgangskontrolle des Unternehmens zu
   * umgehen, und dann wäre diese Datei keine Richtlinie, sondern ein Vorschlag. Die
   * Reihenfolge steht in mail-core/proxy.ts.
   *
   * Bleibt das Feld leer, gilt der Systemproxy von Windows - der übliche Fall, weil er
   * ohne jede Einstellung funktioniert und PAC-Skripte mit abdeckt.
   */
  proxy?: string;

  /**
   * Rechner, die am Proxy vorbeigehen - in der Schreibweise von `NO_PROXY`.
   *
   * Fast jede Aufstellung hat solche Ausnahmen: der Mailserver im eigenen Haus, ein
   * Testsystem. Gilt NICHT gegen `proxy` weiter oben; wer die Ausnahmen bestimmte,
   * bestimmte sonst auch, was am vorgeschriebenen Weg vorbeiläuft.
   */
  keinProxyFuer?: string;

  /**
   * Die von der IT registrierten Anwendungen bei Google und Microsoft.
   *
   * Ohne das schickt die Einrichtung jeden Mitarbeiter in die Google Cloud Console bzw.
   * ins Azure-Portal, damit er dort selbst eine Anwendung registriert. In einem
   * Unternehmen darf er das nicht und kann es auch nicht - das macht die IT einmal, und
   * die Zustimmung erteilt ein Administrator für alle. Steht hier etwas, entfällt die
   * Einrichtung für den Nutzer vollständig: er klickt auf „Anmelden" und ist fertig.
   *
   * Der `mandant` gehört bei Microsoft dazu (Mandantenkennung oder Firmendomain). Ohne
   * ihn läuft die Anmeldung über `/common`, und dann bekommt jeder Mitarbeiter die
   * Zustimmungsseite doch wieder vorgesetzt, obwohl der Administrator längst zugestimmt
   * hat - siehe mail-core/oauth/provider.ts.
   *
   * Das `clientSecret` ist bei einer Desktop-Anwendung in Entra ID nicht nötig und soll
   * dort auch nicht vergeben werden ("public client" mit PKCE). Google vergibt für
   * installierte Anwendungen eines, das kein echtes Geheimnis ist - es steht in jeder
   * Auslieferung und wird von Google auch so behandelt.
   */
  oauth?: Partial<Record<'google' | 'microsoft', OAuthVorgabeEintrag>>;

  /**
   * Die Sprache der Oberfläche - "de" oder "en".
   *
   * In einem Unternehmen mit englischer Arbeitssprache soll nicht jeder Arbeitsplatz eine
   * andere Oberfläche zeigen, nur weil Windows verschieden eingestellt ist. Ohne Angabe
   * entscheidet die Wahl des Nutzers, und ohne die das Betriebssystem.
   */
  sprache?: string;
}

export interface OAuthVorgabeEintrag {
  clientId: string;
  clientSecret?: string;
  /** Nur Microsoft: Mandantenkennung oder Firmendomain. */
  mandant?: string;
}

const VORGABE: Richtlinien = { aktualisierungAbschalten: false };

/** Nimmt eine Zeichenkette aus der Richtliniendatei an, sonst nichts. */
function alsText(wert: unknown, hoechstens = 500): string | undefined {
  return typeof wert === 'string' && wert.trim() ? wert.trim().slice(0, hoechstens) : undefined;
}

/**
 * Liest den OAuth-Abschnitt.
 *
 * Ohne `clientId` ist ein Eintrag wertlos und wird verworfen - eine halbe Vorgabe wäre
 * schlimmer als keine: die Oberfläche meldete "von der Organisation eingerichtet", und
 * die Anmeldung scheiterte dann am Anbieter mit einer Meldung, die niemand hierher
 * zurückverfolgt.
 */
function alsOAuth(wert: unknown): Richtlinien['oauth'] {
  if (!wert || typeof wert !== 'object') return undefined;
  const ergebnis: NonNullable<Richtlinien['oauth']> = {};
  for (const anbieter of ['google', 'microsoft'] as const) {
    const roh = (wert as Record<string, unknown>)[anbieter];
    if (!roh || typeof roh !== 'object') continue;
    const eintrag = roh as Record<string, unknown>;
    const clientId = alsText(eintrag.clientId, 200);
    if (!clientId) continue;
    ergebnis[anbieter] = {
      clientId,
      clientSecret: alsText(eintrag.clientSecret, 300),
      mandant: alsText(eintrag.mandant, 200),
    };
  }
  return Object.keys(ergebnis).length > 0 ? ergebnis : undefined;
}

/**
 * Wo die Datei liegt.
 *
 * %PROGRAMDATA% und nicht der Installationsordner: der liegt bei dieser Anwendung unter
 * %LOCALAPPDATA%\Programs (perMachine:false, siehe electron-builder.yml) und ist damit
 * für den Nutzer selbst beschreibbar - als Ort für eine Vorgabe untauglich. Die Umgebung
 * kann fehlen, wenn das Programm anders als über Windows gestartet wird.
 */
function datei(): string | null {
  const programmdaten = process.env.ProgramData ?? process.env.PROGRAMDATA;
  if (!programmdaten) return null;
  return path.join(programmdaten, 'Energy Mail', 'richtlinien.json');
}

let zwischenspeicher: Richtlinien | null = null;

/** Was beim Lesen nicht stimmte - fuer die Zeile im Fehlerbericht. */
let beanstandung: string | null = null;

/**
 * Liest die Vorgaben - einmal je Programmlauf.
 *
 * Bewusst nicht bei jedem Zugriff neu: eine Vorgabe, die sich mitten im Betrieb ändert,
 * wäre schwerer nachzuvollziehen als eine, die beim nächsten Start gilt. Und der
 * Normalfall ist, dass es die Datei gar nicht gibt.
 *
 * Wirft nie. Eine unlesbare Richtliniendatei darf das Programm nicht am Start hindern -
 * dann gälte für einen Tippfehler in einer JSON-Datei dieselbe Wirkung wie für einen
 * Totalausfall.
 */
export function richtlinien(): Richtlinien {
  if (zwischenspeicher) return zwischenspeicher;
  zwischenspeicher = { ...VORGABE };

  const pfad = datei();
  if (!pfad) return zwischenspeicher;

  try {
    if (!fs.existsSync(pfad)) return zwischenspeicher;
    /*
     * Die Byte-Reihenfolgemarke am Anfang wegnehmen.
     *
     * Diese Datei schreibt ein Administrator, und zwar mit den Werkzeugen, die auf einem
     * Windows-Server zur Hand sind: `Out-File -Encoding utf8` in Windows PowerShell und
     * der Editor mit "UTF-8 mit BOM" setzen drei unsichtbare Bytes davor. JSON.parse
     * wirft darüber - und die Vorgabe wäre damit still wirkungslos gewesen. Genau so ist
     * es beim ersten Versuch am laufenden Programm passiert: die Datei wurde gefunden,
     * gelesen und verworfen, und im Protokoll stand "Aktualisierung erlaubt", als stünde
     * dort nichts anderes.
     */
    const text = fs.readFileSync(pfad, 'utf8').replace(/^\uFEFF/, '');
    const roh = JSON.parse(text) as Partial<Richtlinien>;
    zwischenspeicher = {
      aktualisierungAbschalten: roh.aktualisierungAbschalten === true,
      ansprechpartner: alsText(roh.ansprechpartner, 300),
      proxy: alsText(roh.proxy),
      keinProxyFuer: alsText(roh.keinProxyFuer, 2000),
      oauth: alsOAuth(roh.oauth),
      sprache: alsText(roh.sprache, 10),
    };
  } catch (err) {
    /*
     * Unlesbar oder kein JSON - dann gelten die Vorgaben, und das wird GEMELDET.
     *
     * Hier stand nur ein stilles Auffangen, und der erste Versuch am laufenden Programm
     * hat gezeigt, wie schlecht das ist: die Datei war da, ein unsichtbares Zeichen
     * machte sie ungültig, und im Protokoll stand eine Zeile, die aussah, als sei alles
     * in Ordnung. Ein Administrator hätte lange gesucht.
     */
    zwischenspeicher = { ...VORGABE };
    beanstandung = (err as Error).message;
  }
  return zwischenspeicher;
}



/** Eine Zeile fürs Protokoll - im Fehlerbericht muss stehen, was hier gilt. */
export function beschreibeRichtlinien(): string {
  const pfad = datei();
  if (!pfad || !fs.existsSync(pfad)) return 'Richtlinien: keine hinterlegt.';
  const r = richtlinien();
  if (beanstandung) return `Richtlinien aus ${pfad}: NICHT LESBAR (${beanstandung}).`;
  return (
    `Richtlinien aus ${pfad}: Aktualisierung ` +
    `${r.aktualisierungAbschalten ? 'abgeschaltet' : 'erlaubt'}` +
    `${r.proxy ? ', Proxy vorgeschrieben' : ''}` +
    `${r.keinProxyFuer ? ', mit Ausnahmen' : ''}` +
    `${r.oauth ? `, OAuth vorgegeben (${Object.keys(r.oauth).join(', ')})` : ''}` +
    `${r.sprache ? `, Sprache ${r.sprache}` : ''}` +
    `${r.ansprechpartner ? ', Ansprechpartner hinterlegt' : ''}.`
  );
}

/** Nur für Prüfungen: den gemerkten Stand vergessen. */
export function vergissRichtlinien(): void {
  zwischenspeicher = null;
  beanstandung = null;
}
