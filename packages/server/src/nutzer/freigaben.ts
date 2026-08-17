import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from './../protokollDatei.js';
import { istGueltigeNutzerId } from './kontext.js';
import { findeNutzer, findeNutzerNachEmail } from './nutzerStore.js';

/**
 * Freigegebene Postfächer und Stellvertretung.
 *
 * ## Was das ist
 *
 * Anna gibt eines ihrer Konten für Bernd frei. Bernd sieht es in seiner Seitenleiste,
 * gekennzeichnet, und arbeitet darin - lesend oder mit vollem Zugriff. Zwei Fälle, ein
 * Verfahren: das Sammelpostfach `info@`, das drei Leute lesen, und die Vertretung während
 * einer Krankheit.
 *
 * ## Warum die Freigabe in der WURZEL liegt
 *
 * Weil sie zwei Nutzern gehört. Läge sie in Annas Ordner, müsste Bernd zum Nachsehen, ob
 * er etwas darf, in fremde Daten greifen - genau das, was der Nutzerkontext verhindert.
 * Läge sie in beiden, liefen die beiden Fassungen auseinander. Dieselbe Überlegung wie bei
 * nutzer.json, und deshalb steht sie daneben.
 *
 * ## Der Kern: der Kontext wechselt, die Person nicht
 *
 * Ruft Bernd einen Weg unter `/accounts/<Annas Konto>/…` auf, läuft die ganze Anfrage in
 * ANNAS Datenkontext. Das ist keine Abkürzung, sondern das Einzige, was richtig sein kann:
 * Dort liegen die Zugangsdaten des Postfachs, der Zwischenspeicher, die Regeln, die
 * Etiketten. Ein zweiter Weg daneben hieße, all das ein zweites Mal zu bauen - und die
 * zweite Fassung wäre die, in der die Trennung eines Tages nicht mehr stimmt.
 *
 * Was dabei NICHT wechselt, ist die Person: `handelnd` bleibt Bernd. Sonst stünde Annas
 * Name im Protokoll unter Bernds Handlungen.
 *
 * ## Was eine Freigabe ausdrücklich nicht ist
 *
 * Kein Zugriff auf Annas übrige Konten, ihr Adressbuch, ihre Einstellungen oder ihre
 * anderen Freigaben. Der Wechsel geschieht nur auf Wegen, die die Kennung des
 * freigegebenen Kontos im Pfad tragen - alles andere läuft weiter in Bernds eigenem
 * Kontext. Ein Weg, der die Kennung woanders führte, fiele auf die sichere Seite: Bernd
 * hat dieses Konto nicht, und der Server antwortet mit 404.
 */

export type Recht = 'lesen' | 'voll';

export interface Freigabe {
  id: string;
  /** Wem das Konto gehört. */
  besitzer: string;
  /** Welches Konto - die Kennung aus dem Kontenspeicher des Besitzers. */
  kontoId: string;
  /**
   * Die Adresse des Kontos, mitgeschrieben.
   *
   * Redundant, und trotzdem richtig: Bernd soll in seiner Seitenleiste sehen, welches
   * Postfach das ist, ohne dass dafür jemand in Annas Kontenspeicher greifen müsste. Wer
   * das anders löste, bräuchte einen Weg von Bernds Kontext in Annas Daten - genau den,
   * den es nicht geben soll.
   */
  email: string;
  /** An wen. */
  an: string;
  rechte: Recht;
  angelegt: string;
}

type Ablage = { freigaben: Freigabe[] };

const getPfad = () => path.join(getWurzelDir(), 'freigaben.json');

function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'freigabe',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  return Array.isArray(befund.wert?.freigaben) ? befund.wert : { freigaben: [] };
}

function schreiben(ablage: Ablage): void {
  schreibeAtomar(getPfad(), JSON.stringify(ablage, null, 2));
}

export class FreigabeFehler extends Error {}

/** Was ein Nutzer selbst verschenkt hat. */
export function eigeneFreigaben(besitzer: string): Freigabe[] {
  return lesen().freigaben.filter((f) => f.besitzer === besitzer);
}

/** Was ihm andere gegeben haben. */
export function erhalteneFreigaben(an: string): Freigabe[] {
  return lesen().freigaben.filter((f) => f.an === an);
}

/** Alle - nur für die Verwaltung. */
export function alleFreigaben(): Freigabe[] {
  return lesen().freigaben;
}

/**
 * Die Freigabe, über die ein Nutzer an ein bestimmtes Konto kommt - oder `null`.
 *
 * Die Frage, an der die ganze Trennung hängt. Sie wird bei jeder Anfrage auf ein Konto
 * gestellt, das dem Fragenden nicht gehört.
 */
export function freigabeFuer(an: string, kontoId: string): Freigabe | null {
  if (!istGueltigeNutzerId(an) || !kontoId) return null;
  return lesen().freigaben.find((f) => f.an === an && f.kontoId === kontoId) ?? null;
}

export interface NeueFreigabe {
  besitzer: string;
  kontoId: string;
  email: string;
  /** An wen - als Kennung oder als Anmeldeadresse. */
  an: string;
  rechte: Recht;
}

export function legeFreigabeAn(eingabe: NeueFreigabe): Freigabe {
  const empfaenger = findeEmpfaenger(eingabe.an);
  if (!empfaenger) throw new FreigabeFehler('Diesen Nutzer gibt es hier nicht.');

  /*
   * An sich selbst geht nicht.
   *
   * Nicht weil es gefährlich wäre, sondern weil es nichts täte: Das Konto steht bereits
   * in der eigenen Liste. Eine Freigabe an sich selbst ergäbe es doppelt, einmal davon
   * mit dem Hinweis "freigegeben von mir".
   */
  if (empfaenger.id === eingabe.besitzer) {
    throw new FreigabeFehler('Das ist Ihr eigenes Postfach.');
  }
  if (empfaenger.gesperrt) {
    throw new FreigabeFehler('Dieser Nutzer ist gesperrt.');
  }

  const ablage = lesen();
  const vorhanden = ablage.freigaben.find(
    (f) => f.kontoId === eingabe.kontoId && f.an === empfaenger.id,
  );
  if (vorhanden) {
    // Zweimal dasselbe freizugeben ist keine zweite Freigabe, sondern eine geänderte.
    vorhanden.rechte = eingabe.rechte;
    vorhanden.email = eingabe.email;
    schreiben(ablage);
    protokolliere(
      'info',
      'freigabe',
      `"${eingabe.besitzer}" hat die Rechte von "${empfaenger.id}" an ${eingabe.email} auf "${eingabe.rechte}" gesetzt.`,
    );
    return vorhanden;
  }

  const neu: Freigabe = {
    id: crypto.randomUUID(),
    besitzer: eingabe.besitzer,
    kontoId: eingabe.kontoId,
    email: eingabe.email,
    an: empfaenger.id,
    rechte: eingabe.rechte,
    angelegt: new Date().toISOString(),
  };
  ablage.freigaben.push(neu);
  schreiben(ablage);
  /*
   * Als Warnung ins Protokoll, nicht als Notiz.
   *
   * Ab hier liest ein zweiter Mensch fremde Post. Das ist gewollt und trotzdem der eine
   * Vorgang, nach dem später jemand fragt - "seit wann kommt Bernd da eigentlich rein?".
   */
  protokolliere(
    'warnung',
    'freigabe',
    `"${eingabe.besitzer}" hat ${eingabe.email} für "${empfaenger.id}" freigegeben (${eingabe.rechte}).`,
  );
  return neu;
}

/**
 * Nimmt eine Freigabe zurück.
 *
 * `wer` ist der, der es verlangt - zurücknehmen darf nur der Besitzer, der Beschenkte
 * selbst (wer ein Postfach nicht mehr sehen will, soll es weglegen dürfen) oder ein
 * Verwalter.
 */
export function entferneFreigabe(id: string, wer: string, verwalter = false): boolean {
  const ablage = lesen();
  const freigabe = ablage.freigaben.find((f) => f.id === id);
  if (!freigabe) return false;
  if (!verwalter && freigabe.besitzer !== wer && freigabe.an !== wer) {
    throw new FreigabeFehler('Diese Freigabe gehört Ihnen nicht.');
  }
  ablage.freigaben = ablage.freigaben.filter((f) => f.id !== id);
  schreiben(ablage);
  protokolliere(
    'info',
    'freigabe',
    `"${wer}" hat die Freigabe von ${freigabe.email} an "${freigabe.an}" beendet.`,
  );
  return true;
}

/** Beim Entfernen eines Kontos gehen auch dessen Freigaben. */
export function freigabenZuKonto(kontoId: string): void {
  const ablage = lesen();
  const uebrig = ablage.freigaben.filter((f) => f.kontoId !== kontoId);
  if (uebrig.length === ablage.freigaben.length) return;
  ablage.freigaben = uebrig;
  schreiben(ablage);
}

/**
 * Beim Entfernen eines Nutzers gehen seine Freigaben - in beide Richtungen.
 *
 * Beide Richtungen, und das ist der Punkt: Was er verschenkt hat, wäre sonst eine Freigabe
 * auf ein Postfach, dessen Schlüssel es nicht mehr gibt. Was er bekommen hat, wäre ein
 * Eintrag auf einen Nutzer, den es nicht mehr gibt - und käme, wenn seine Kennung eines
 * Tages neu vergeben wird, einem Fremden zugute.
 */
export function freigabenZuNutzer(nutzerId: string): void {
  const ablage = lesen();
  const uebrig = ablage.freigaben.filter((f) => f.besitzer !== nutzerId && f.an !== nutzerId);
  if (uebrig.length === ablage.freigaben.length) return;
  // Vor dem Zuweisen zählen: danach IST ablage.freigaben die Liste uebrig, und die
  // Differenz wäre zwangsläufig null. Genau das stand hier und meldete jedes Mal "(0)".
  const entfernt = ablage.freigaben.length - uebrig.length;
  ablage.freigaben = uebrig;
  schreiben(ablage);
  protokolliere(
    'info',
    'freigabe',
    `Alle Freigaben von und an "${nutzerId}" entfernt (${entfernt}).`,
  );
}

/**
 * Nimmt eine Kennung oder eine Anmeldeadresse und findet den Nutzer.
 *
 * Beides, weil beides vorkommt: In der Oberfläche tippt man die Adresse des Kollegen ein -
 * die kennt man -, im Werkzeug auf der Befehlszeile die Kennung.
 */
function findeEmpfaenger(wen: string): { id: string; gesperrt: boolean } | null {
  const gesucht = (wen ?? '').trim().toLowerCase();
  if (!gesucht) return null;
  const nutzer = gesucht.includes('@') ? findeNutzerNachEmail(gesucht) : findeNutzer(gesucht);
  return nutzer ? { id: nutzer.id, gesperrt: Boolean(nutzer.gesperrt) } : null;
}
