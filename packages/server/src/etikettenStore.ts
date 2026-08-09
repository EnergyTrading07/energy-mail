import fs from 'node:fs';
import path from 'node:path';
import {
  STANDARD_ETIKETTEN,
  pruefeEtikettName,
  schluesselFuer,
  type Etikett,
} from '@energy-mail/mail-core';
import { getDataDir } from './paths.js';
import { liesJson, schreibeAtomar } from './atomar.js';
import { protokolliere } from './protokollDatei.js';

/**
 * Das Verzeichnis der Etiketten: welche es gibt, wie sie heißen und welche Farbe sie
 * haben.
 *
 * Die Zuordnung zu einer Nachricht liegt nicht hier, sondern auf dem Mailserver als
 * IMAP-Schlüsselwort. Das ist die wichtigere Hälfte und gehört dorthin: nur so trägt
 * dieselbe Nachricht das Etikett auch auf dem Telefon und in Thunderbird.
 *
 * Was hier liegt, ist die andere Hälfte - Name und Farbe. Die kennt IMAP nicht; ein
 * Schlüsselwort ist nur ein Wort. Thunderbird macht es genauso und hält seine Namen
 * ebenfalls örtlich.
 *
 * Nicht je Konto, sondern für alle zusammen: wer "Steuer" vergibt, meint dasselbe
 * Etikett, egal von welchem Postfach die Nachricht kam. Die Schlüsselwörter sind auf
 * jedem Server dieselben, also passt das auch technisch.
 */

const getPfad = () => path.join(getDataDir(), 'etiketten.json');

interface Ablage {
  etiketten: Etikett[];
}

/**
 * Beim ersten Start stehen die fünf von Thunderbird da.
 *
 * Ein leeres Verzeichnis wäre die ehrlichere Voreinstellung, aber die unbrauchbarere:
 * niemand legt sich Etiketten an, bevor er gesehen hat, wozu sie gut sind. Und diese
 * fünf sind ohnehin schon da - Thunderbird setzt sie unter denselben Schlüsselwörtern.
 */
function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'etiketten',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  if (Array.isArray(befund.wert?.etiketten)) return befund.wert;
  return { etiketten: STANDARD_ETIKETTEN.map((e) => ({ ...e })) };
}

function schreiben(ablage: Ablage): void {
  schreibeAtomar(getPfad(), JSON.stringify(ablage, null, 2));
}

export function alleEtiketten(): Etikett[] {
  return lesen().etiketten;
}

export interface EtikettEingabe {
  /** Fehlt er, wird ein neues Etikett angelegt. */
  schluessel?: string;
  name: string;
  farbe?: string;
}

/** Farbe für ein neues Etikett, wenn keine gewählt wurde. */
const WEITERE_FARBEN = ['#0891b2', '#c026d3', '#65a30d', '#e11d48', '#7c3aed', '#0d9488'];

export class EtikettFehler extends Error {}

/**
 * Legt ein Etikett an oder benennt es um.
 *
 * Der Schlüssel bleibt beim Umbenennen unverändert - er steht auf dem Mailserver an
 * jeder Nachricht, die das Etikett trägt. Ihn mitzuändern hieße, sämtliche Nachrichten
 * anzufassen, und wer offline umbenennt, verlöre die Zuordnung ganz.
 */
export function speichereEtikett(eingabe: EtikettEingabe): Etikett {
  const ablage = lesen();
  const name = eingabe.name?.trim() ?? '';

  const meldung = pruefeEtikettName(name, ablage.etiketten, eingabe.schluessel);
  if (meldung) throw new EtikettFehler(meldung);

  if (eingabe.schluessel) {
    const vorhanden = ablage.etiketten.find((e) => e.schluessel === eingabe.schluessel);
    if (!vorhanden) throw new EtikettFehler('Dieses Etikett gibt es nicht mehr.');
    vorhanden.name = name;
    if (eingabe.farbe) vorhanden.farbe = eingabe.farbe;
    schreiben(ablage);
    return vorhanden;
  }

  const neu: Etikett = {
    schluessel: schluesselFuer(
      name,
      ablage.etiketten.map((e) => e.schluessel),
    ),
    name,
    farbe: eingabe.farbe ?? WEITERE_FARBEN[ablage.etiketten.length % WEITERE_FARBEN.length]!,
  };
  ablage.etiketten.push(neu);
  schreiben(ablage);
  return neu;
}

/**
 * Nimmt ein Etikett aus dem Verzeichnis.
 *
 * Was auf den Nachrichten steht, bleibt stehen - dafür müsste man jeden Ordner jedes
 * Kontos durchgehen, und ohne Verbindung ginge es gar nicht. Die betroffenen
 * Nachrichten zeigen das Schlüsselwort danach in Grau unter seinem nackten Namen. Das
 * ist ehrlicher als ein stilles Verschwinden und lässt sich rückgängig machen, indem
 * man das Etikett unter demselben Namen wieder anlegt.
 */
export function loescheEtikett(schluessel: string): boolean {
  const ablage = lesen();
  const vorher = ablage.etiketten.length;
  ablage.etiketten = ablage.etiketten.filter((e) => e.schluessel !== schluessel);
  if (ablage.etiketten.length === vorher) return false;
  schreiben(ablage);
  return true;
}
