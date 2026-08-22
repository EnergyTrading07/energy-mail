import path from 'node:path';
import {
  pruefeSystemversand,
  sendeSystemNachricht,
  type SystemNachricht,
  type SystemversandZugang,
} from '@energy-mail/mail-core';
import { liesJson, schreibeAtomar } from './atomar.js';
import { getWurzelDir } from './paths.js';
import { protokolliere } from './protokollDatei.js';
import {
  entschluesselMitMaster,
  isEncryptionAvailable,
  verschluesselMitMaster,
} from './secretCrypto.js';

/**
 * Der Absender des Dienstes selbst.
 *
 * ## Wozu ein Mailprogramm einen eigenen Absender braucht
 *
 * Bis hierher verschickte dieses Programm ausschließlich im Auftrag eines angemeldeten
 * Menschen, über dessen eigenes Postfach. Mit der Selbstregistrierung kommt eine zweite
 * Sorte hinzu: eine Nachricht an jemanden, der noch kein Konto hat - und der gerade erst
 * behauptet hat, ihm gehöre diese Adresse. Genau das ist ihr Zweck. Der Link, der dort
 * ankommt, ist der Nachweis; wer die Adresse nicht abrufen kann, bekommt ihn nicht.
 *
 * ## Warum das in der WURZEL liegt und mit dem Masterschlüssel verschlüsselt wird
 *
 * Es gehört keinem Nutzer, sondern der Aufstellung - wie das Firmenverzeichnis daneben.
 * Und deshalb geht das Kennwort NICHT durch `encryptSecret`: Dessen Umschlag schlägt den
 * Schlüssel des gerade handelnden Nutzers auf (siehe schluesselHuelle.ts). Systempost
 * geht aber gerade dann hinaus, wenn kein Nutzer da ist - beim Antrag eines Fremden. Ein
 * Geheimnis, das nur im Kontext eines Nutzers lesbar ist, wäre in genau dem Augenblick
 * unerreichbar, für den es hinterlegt wurde.
 *
 * ## Was der Betreiber hier eintragen sollte
 *
 * Ein eigenes Postfach, das sonst niemand benutzt - noreply@firma.de oder ähnlich, mit
 * einem Kennwort, das nur hier steht. Kein persönliches Konto: dessen Kennwort läge damit
 * in der Servereinrichtung, und mit dem Ausscheiden des Menschen hörte die Registrierung
 * auf zu funktionieren.
 */

export interface Systemmail {
  /** Ob überhaupt versendet werden soll. Aus heißt: Es gibt keinen Systemversand. */
  aktiv: boolean;
  host: string;
  port: number;
  /** Ob von der ersten Sekunde an verschlüsselt wird (465) statt über STARTTLS (587). */
  secure: boolean;
  benutzer: string;
  /** Was im Von-Feld steht. */
  absender: string;
  absenderName: string;
}

const VORGABE: Systemmail = {
  aktiv: false,
  host: '',
  /*
   * 587 und nicht 465 als Vorgabe.
   *
   * Beide sind richtig, aber 587 mit STARTTLS ist der Weg, den nahezu jeder Anbieter für
   * das Einliefern durch einen Client vorsieht. Und die Verschlüsselung ist auch dort
   * nicht verhandelbar - siehe requireTLS in mail-core/systemversand.ts.
   */
  port: 587,
  secure: false,
  benutzer: '',
  absender: '',
  absenderName: 'Energy Mail',
};

/** Was gespeichert wird - das Kennwort verschlüsselt. */
type Ablage = Systemmail & { kennwortVerschluesselt?: string };

const getPfad = () => path.join(getWurzelDir(), 'systemmail.json');

function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'systemmail',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).`,
    );
  }
  return { ...VORGABE, ...(befund.wert ?? {}) };
}

/**
 * Die Einrichtung zum Anzeigen - OHNE das Kennwort.
 *
 * Es geht nie hinaus, auch nicht an einen Verwalter; daneben steht nur, OB eines
 * hinterlegt ist. Dieselbe Regel wie beim Firmenverzeichnis, und aus demselben Grund:
 * Diese Antwort landet im Browserspeicher und in den Entwicklerwerkzeugen.
 */
export function systemmailFuerAnzeige(): Systemmail & { kennwortHinterlegt: boolean } {
  const { kennwortVerschluesselt, ...rest } = lesen();
  return { ...rest, kennwortHinterlegt: Boolean(kennwortVerschluesselt) };
}

export class SystemmailFehler extends Error {}

/**
 * Ob tatsächlich versendet werden kann.
 *
 * Diese Frage entscheidet an anderer Stelle über mehr als eine Anzeige: Ohne
 * Systemversand gibt es keine Mailbestätigung, und ohne Mailbestätigung darf es keine
 * offene Selbstregistrierung geben - sonst legte sich jeder ein Konto auf die Adresse
 * eines anderen an. Siehe nutzer/registrierung.ts.
 */
export function systemmailEingerichtet(): boolean {
  const stand = lesen();
  return Boolean(stand.aktiv && stand.host.trim() && stand.absender.trim());
}

function zugangAus(stand: Ablage): SystemversandZugang {
  return {
    host: stand.host.trim(),
    port: stand.port,
    secure: stand.secure,
    benutzer: stand.benutzer.trim() || undefined,
    kennwort: stand.kennwortVerschluesselt
      ? entschluesselMitMaster(stand.kennwortVerschluesselt)
      : undefined,
    absender: stand.absender.trim(),
    absenderName: stand.absenderName.trim() || undefined,
  };
}

function pruefeAngaben(neu: Ablage): void {
  if (!neu.aktiv) return;
  if (!neu.host.trim()) throw new SystemmailFehler('Ohne Adresse des Sendeservers geht es nicht.');
  if (!Number.isInteger(neu.port) || neu.port < 1 || neu.port > 65535) {
    throw new SystemmailFehler('Der Port muss eine Zahl zwischen 1 und 65535 sein.');
  }
  if (!neu.absender.includes('@')) {
    throw new SystemmailFehler('Ohne brauchbare Absenderadresse geht es nicht.');
  }
}

export function setzeSystemmail(
  eingabe: Partial<Systemmail>,
  kennwort?: string | null,
): Systemmail & { kennwortHinterlegt: boolean } {
  const bisher = lesen();
  const neu: Ablage = { ...bisher, ...eingabe };
  pruefeAngaben(neu);

  /*
   * `null` heißt löschen, `undefined` heißt unverändert lassen - dieselbe Unterscheidung
   * wie beim Firmenverzeichnis. Ohne sie wäre jedes Ändern des Ports zugleich ein Löschen
   * des Kennworts, denn die Oberfläche hat es gar nicht.
   */
  if (kennwort === null) {
    delete neu.kennwortVerschluesselt;
  } else if (typeof kennwort === 'string' && kennwort.length > 0) {
    if (!isEncryptionAvailable()) {
      throw new SystemmailFehler(
        'Ohne eingerichtete Verschlüsselung würde das Kennwort im Klartext liegen.',
      );
    }
    neu.kennwortVerschluesselt = verschluesselMitMaster(kennwort);
  }

  schreibeAtomar(getPfad(), JSON.stringify(neu, null, 2));
  protokolliere(
    'info',
    'systemmail',
    neu.aktiv
      ? `Systemversand eingerichtet: ${neu.absender} über ${neu.host}:${neu.port}.`
      : 'Systemversand abgeschaltet.',
  );
  return systemmailFuerAnzeige();
}

/**
 * Ein Verbindungsversuch mit den Angaben aus dem Formular.
 *
 * Mit den eingetippten und nicht mit den gespeicherten: Wer gerade etwas ändert, will
 * wissen, ob das Neue geht - nicht, ob das Alte ging. Fehlt im Formular ein Kennwort,
 * wird das hinterlegte genommen; sonst ließe sich eine bestehende Einrichtung gar nicht
 * prüfen, ohne das Kennwort noch einmal abzutippen.
 */
export async function pruefeSystemmail(
  eingabe: Partial<Systemmail>,
  kennwort?: string,
): Promise<{ ok: true } | { ok: false; fehler: string }> {
  const stand: Ablage = { ...lesen(), ...eingabe };
  try {
    pruefeAngaben({ ...stand, aktiv: true });
    const zugang = zugangAus(stand);
    if (kennwort) zugang.kennwort = kennwort;
    await pruefeSystemversand(zugang);
    return { ok: true };
  } catch (err) {
    return { ok: false, fehler: (err as Error).message };
  }
}

/**
 * Verschickt eine Systemnachricht.
 *
 * Wirft, wenn kein Versand eingerichtet ist. Der Aufrufer muss das behandeln - eine
 * Registrierung, die stillschweigend keine Bestätigungsmail verschickt, ist schlimmer als
 * eine, die mit einer Fehlermeldung abbricht: Im ersten Fall wartet ein Mensch auf Post,
 * die nie kommt.
 */
export async function sendeSystemmail(nachricht: SystemNachricht): Promise<void> {
  const stand = lesen();
  if (!systemmailEingerichtet()) {
    throw new SystemmailFehler('Für diesen Dienst ist kein Systemversand eingerichtet.');
  }
  await sendeSystemNachricht(zugangAus(stand), nachricht);
}
