import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';
import { setzeNetzzielRegel } from '@energy-mail/mail-core';
import { systemmailEingerichtet } from '../systemmail.js';
import { verschluesselKennwort } from './kennwort.js';
import { KENNWORT_MINDESTLAENGE, findeNutzerNachEmail, nutzerAnzahl } from './nutzerStore.js';

/**
 * Wer sich selbst ein Konto anlegen darf - und was dabei aufbewahrt wird.
 *
 * ## Warum das nicht einfach "Nutzer anlegen ohne Verwalter" ist
 *
 * Bis hierher gab es genau einen Weg zu einem Konto: Ein Verwalter legt es an. Das ist
 * eine Bürgschaft - jemand, der den Dienst betreibt, hat entschieden, dass dieser Mensch
 * hineindarf. Selbstregistrierung nimmt diese Bürgschaft weg, und alles, was hier steht,
 * ist der Versuch, sie durch etwas anderes zu ersetzen. Wer das nicht mitdenkt, baut ein
 * offenes Tor: Jeder Fremde legt sich ein Konto an, hinterlegt darin sein eigenes
 * IMAP-Postfach und benutzt fortan fremde Rechenzeit, fremde Bandbreite und - falls je
 * eine Sperre umgangen wird - fremde Post.
 *
 * ## Die drei Betriebsarten, und warum es genau drei sind
 *
 *  - **aus**: wie bisher. Das ist die VORGABE, und zwar auch für bestehende
 *    Aufstellungen: Ein Server, der aktualisiert wird, darf sich nicht von selbst öffnen.
 *    Das ist die wichtigste Zeile dieser Datei.
 *  - **freigabe**: Wer will, stellt einen Antrag; hereinkommen tut er erst, wenn ein
 *    Verwalter zustimmt. Die Bürgschaft bleibt also - nur die Tipparbeit wandert zu dem,
 *    der das Konto haben will.
 *  - **offen**: Wer seine Mailadresse nachweisen kann, ist drin. Die Bürgschaft wird
 *    ersetzt durch den Nachweis über die Adresse, und deshalb ist diese Betriebsart ohne
 *    Systemversand NICHT ZU HABEN (siehe `betriebsartWirksam`). Sonst hieße "offen"
 *    schlicht: jeder, der ein Formular ausfüllt.
 *
 * ## Was NICHT gespeichert wird, und das ist Absicht
 *
 * Kein Klartextkennwort - der Antrag hält von der ersten Sekunde an nur die Prüfsumme.
 * Keine Anschlusskennung: Die Bremse gegen Massenanträge zählt gesalzen und gehasht
 * (siehe anmeldebremse.ts), der Antrag selbst enthält nichts davon. Kein Zeitpunkt des
 * Aufrufs, kein Browserkennzeichen, keine Herkunft. Was hier liegt, ist das Wenigste,
 * mit dem sich ein Konto anlegen lässt: eine Adresse, eine Prüfsumme und zwei Daten.
 *
 * Und alles davon verfällt von selbst - siehe `raeumeAuf`. Ein Antragsspeicher, aus dem
 * nie etwas verschwindet, ist nach zwei Jahren ein Verzeichnis aller Menschen, die es
 * einmal versucht haben.
 */

export type Betriebsart = 'aus' | 'freigabe' | 'offen';

export interface Registrierungseinstellungen {
  betriebsart: Betriebsart;
  /**
   * Auf welche Mail-Domänen die Registrierung begrenzt ist. Leer heißt: keine Grenze.
   *
   * Für den Regelfall eines Betriebs ist das die wirksamste einzelne Einstellung: Steht
   * hier `firma.de`, kann sich niemand von außen anmelden, auch nicht bei offener
   * Betriebsart - und der Verwalter muss nicht jeden Antrag einzeln beurteilen.
   */
  domaenen: string[];
  /**
   * Was über dem Absendeknopf steht - der Hinweis nach Art. 13 DSGVO.
   *
   * Vorbelegt mit einem Text, der die Pflichtangaben abdeckt. Er steht hier und nicht fest
   * im Quelltext, weil er betriebsabhängig ist: Wer eine eigene Datenschutzerklärung hat,
   * verlinkt sie; wer einen Datenschutzbeauftragten hat, nennt ihn.
   */
  hinweis: string;
  /**
   * Mail-Domaenen, die ausdruecklich NICHT duerfen - zusaetzlich zur Erlaubnisliste.
   *
   * Gedacht fuer Wegwerfadressen. Sie sind der Grund, warum eine offene Registrierung im
   * offenen Netz ohne Filter nicht traegt: Eine Adresse, die zehn Minuten lebt, macht die
   * Mailbestaetigung wertlos - der Nachweis "diese Adresse gehoert mir" ist dann der
   * Nachweis, dass jemand eine Wegwerfseite aufrufen kann.
   *
   * Was hier steht, gilt ZUSAETZLICH zu WEGWERF_DOMAENEN weiter unten. Die eingebaute
   * Liste deckt die bekannten ab; diese hier ist fuer das, was danach kommt.
   */
  gesperrteDomaenen: string[];
  /**
   * Ob die eingebaute Liste bekannter Wegwerfanbieter gilt.
   *
   * Abschaltbar, weil eine solche Liste immer auch jemanden trifft, der sie nicht meint -
   * es gibt Menschen, die eine Wegwerfadresse als Hauptadresse benutzen. Wer das erlauben
   * will, schaltet sie aus und traegt selbst ein, was er sperren moechte.
   */
  wegwerfSperren: boolean;
  /**
   * Wie viele Nutzer es insgesamt hoechstens geben darf. 0 heisst: keine Grenze.
   *
   * Bei offener Registrierung die wichtigste Zahl ueberhaupt. Jeder Nutzer bekommt einen
   * Ordner, einen Schluessel, eine Ablage und - sobald er ein Postfach einrichtet - bis zu
   * drei dauerhafte IMAP-Verbindungen. Ein Server mit anderthalb Gigabyte Speichergrenze
   * traegt keine tausend davon; ohne Grenze entscheidet darueber, wer sich zuerst
   * anmeldet, und der Dienst faellt fuer alle aus.
   */
  hoechstzahl: number;
  /**
   * Ob sich Postfachserver nur im offenen Netz befinden duerfen.
   *
   * Der Riegel gegen die Abtastung des internen Netzes - die Begruendung steht
   * ausfuehrlich in mail-core/netzziele.ts. Kurz: Wer ein Konto anlegt, bestimmt, wohin
   * dieser Server Verbindungen aufbaut. Bei offener Anmeldung ist das ein Fremder, und
   * der Server steht in einem Netz, in das er sonst nicht hineinkommt.
   *
   * Vorgabe aus, damit ein Betrieb mit eigenem Mailserver im Haus nichts verliert. Wird
   * die Betriebsart auf "offen" gestellt, schaltet setzeRegistrierung() den Riegel
   * ausdruecklich mit ein - dort ist er nicht verhandelbar.
   */
  nurOeffentlicheMailserver: boolean;
}

/**
 * Bekannte Wegwerfanbieter.
 *
 * Bewusst kurz und ohne Anspruch auf Vollstaendigkeit: Eine Liste mit zehntausend
 * Eintraegen waere zu pflegen, und wer sie nicht pflegt, hat eine Liste von gestern. Hier
 * stehen die, die tatsaechlich in Massen auftauchen. Der Rest gehoert in
 * `gesperrteDomaenen`, wo der Betreiber ergaenzt, was bei IHM ankommt - das ist die
 * Auskunft, die keine allgemeine Liste haben kann.
 */
const WEGWERF_DOMAENEN = [
  '10minutemail.com',
  '10minutemail.net',
  'burnermail.io',
  'dispostable.com',
  'fakeinbox.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.net',
  'guerrillamailblock.com',
  'inboxkitten.com',
  'mail-temporaire.fr',
  'mail7.io',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'temp-mail.org',
  'tempail.com',
  'tempmail.dev',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'wegwerfemail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
];

/**
 * Ein Antrag - der Zustand zwischen "Formular abgeschickt" und "Konto vorhanden".
 *
 * Er ist ausdrücklich KEIN Nutzer: Es gibt keinen Ordner, keinen Schlüssel, keine
 * Sitzung, und angemeldet werden kann damit nichts. Erst das Freischalten macht daraus
 * einen Eintrag in nutzer.json.
 */
export interface Antrag {
  /** Zufällig und nicht fortlaufend - eine Nummer ließe auf den Bestand schließen. */
  id: string;
  email: string;
  /** Nur die Prüfsumme. Siehe die Begründung bei NeuerNutzer.kennwortPruefsumme. */
  kennwortPruefsumme: string;
  angelegt: string;
  /** Wann die Adresse nachgewiesen wurde. Fehlt: noch nicht bestätigt. */
  bestaetigt?: string;
  /** sha256 der Bestätigungsmarke - die Marke selbst steht nach dem Versand nirgends. */
  markeHash?: string;
  /** Wann die Marke verfällt. */
  markeBis?: number;
  /** Was der Antragsteller dem Verwalter mitteilen wollte - freiwillig, kurz. */
  bemerkung?: string;
  /** Wann die Datenschutzhinweise angezeigt und bestätigt wurden - der Nachweis dafür. */
  hinweisBestaetigt: string;
}

/** Was ein Verwalter zu sehen bekommt - ohne Prüfsumme, ohne Marke. */
export interface OeffentlicherAntrag {
  id: string;
  email: string;
  angelegt: string;
  bestaetigt?: string;
  bemerkung?: string;
}

const VORGABE: Registrierungseinstellungen = {
  /*
   * Aus. Immer aus, bis jemand sie einschaltet.
   *
   * Eine neue Fähigkeit, die sich beim Aktualisieren von selbst einschaltet, ist eine
   * Sicherheitslücke mit Änderungsvermerk. Der Betreiber, der heute einen Server für acht
   * Kollegen betreibt, hat nichts davon gelesen und stellt nächste Woche fest, dass
   * einundzwanzig Konten darin stehen.
   */
  betriebsart: 'aus',
  domaenen: [],
  gesperrteDomaenen: [],
  wegwerfSperren: true,
  /*
   * Fuenfzig als Vorgabe.
   *
   * Eine Zahl, bei der ein gewoehnlicher Betrieb nie anstoesst und ein Missbrauch sofort.
   * Wer mehr braucht, hebt sie an - und tut das dann in dem Bewusstsein, dass jeder
   * Nutzer Arbeitsspeicher und offene Verbindungen kostet.
   */
  hoechstzahl: 50,
  nurOeffentlicheMailserver: false,
  hinweis:
    'Für die Anmeldung werden Ihre Mailadresse und ein von Ihnen gewähltes Kennwort ' +
    'gespeichert. Beides wird ausschließlich für den Zugang zu diesem Dienst verwendet ' +
    'und nicht an Dritte weitergegeben. Das Kennwort wird nicht im Klartext gespeichert. ' +
    'Sie können Ihr Konto jederzeit löschen lassen; wenden Sie sich dafür an den ' +
    'Betreiber dieses Dienstes.',
};

type Ablage = {
  einstellungen?: Partial<Registrierungseinstellungen>;
  antraege?: Antrag[];
};

const getPfad = () => path.join(getWurzelDir(), 'registrierung.json');

/**
 * Wie lange ein Bestätigungslink gilt.
 *
 * Vierundzwanzig Stunden. Kürzer wäre lästig für jemanden, der abends registriert und
 * morgens die Post liest; länger hieße, dass eine Marke, die in einem durchsuchbaren
 * Postfach liegt, tagelang ein Konto eröffnen kann.
 */
const MARKE_GUELTIG_MS = 24 * 60 * 60 * 1000;

/** Unbestätigte Anträge verfallen. Eine Woche ist Raum genug für "nochmal schicken". */
const UNBESTAETIGT_FRIST_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Und bestätigte, die niemand freigeschaltet hat, ebenfalls - nach dreißig Tagen.
 *
 * Das ist keine Schikane gegenüber einem Verwalter im Urlaub, sondern
 * Datensparsamkeit: Ein Antrag, der einen Monat unbeachtet liegt, wird nicht mehr
 * beschieden. Die Adresse eines Menschen, der einmal angefragt hat, gehört danach nicht
 * mehr auf diesen Server. Wer weiterhin will, stellt einen neuen Antrag - das kostet ihn
 * eine Minute.
 */
const WARTEND_FRIST_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Wie viele Anträge insgesamt offenstehen dürfen.
 *
 * Gegen den Fall, dass jemand die Bremse mit vielen Anschlüssen umgeht: Die Datei soll
 * nicht ins Unermessliche wachsen. Ist die Grenze erreicht, wird kein weiterer Antrag
 * angenommen - und zwar mit einer Meldung an den Betreiber im Protokoll, denn dann
 * stimmt etwas nicht.
 */
const MAX_ANTRAEGE = 500;

/** Wie lang der Datenschutzhinweis hoechstens sein darf - siehe setzeRegistrierung. */
const HINWEIS_MAX = 4000;

let geladen: Ablage | null = null;

function lesen(): Ablage {
  if (geladen) return geladen;
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'registrierung',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  geladen = befund.wert ?? {};
  return geladen;
}

function schreiben(): void {
  schreibeAtomar(getPfad(), JSON.stringify(geladen ?? {}, null, 2));
}

/** Nur für Prüfungen: den Zwischenspeicher vergessen - wie ein Neustart des Servers. */
export function vergissRegistrierung(): void {
  geladen = null;
}

// --- Einstellungen ---

export function registrierungseinstellungen(): Registrierungseinstellungen {
  const gespeichert = lesen().einstellungen ?? {};
  return {
    ...VORGABE,
    ...gespeichert,
    domaenen: Array.isArray(gespeichert.domaenen) ? gespeichert.domaenen : VORGABE.domaenen,
    gesperrteDomaenen: Array.isArray(gespeichert.gesperrteDomaenen)
      ? gespeichert.gesperrteDomaenen
      : VORGABE.gesperrteDomaenen,
  };
}

export class RegistrierungsFehler extends Error {}

/**
 * Traegt die eingestellte Netzzielregel in den Kern ein.
 *
 * Wird beim Start gerufen (app.ts) und bei jeder Aenderung. Ueber einen Setter und nicht
 * ueber einen Import in mail-core: Der Kern soll nichts ueber Nutzer und Einstellungen
 * wissen muessen - dasselbe Muster wie beim Umschlag der Verschluesselung.
 */
export function wendeNetzzielRegelAn(): void {
  setzeNetzzielRegel(registrierungseinstellungen().nurOeffentlicheMailserver);
}

/**
 * Bringt eine Domäneneingabe auf eine vergleichbare Form.
 *
 * `@Firma.DE `, `Firma.de` und `firma.de` sollen dasselbe bedeuten. Wer das dem
 * Verwalter überlässt, bekommt eine Liste, in der ein Eintrag nie greift, und niemand
 * sieht warum.
 */
function normalisiereDomaene(roh: string): string {
  return roh.trim().toLowerCase().replace(/^@/, '');
}

export function setzeRegistrierung(
  eingabe: Partial<Registrierungseinstellungen>,
): Registrierungseinstellungen {
  const bisher = registrierungseinstellungen();
  const neu: Registrierungseinstellungen = { ...bisher, ...eingabe };

  if (!['aus', 'freigabe', 'offen'].includes(neu.betriebsart)) {
    throw new RegistrierungsFehler('Unbekannte Betriebsart für die Selbstregistrierung.');
  }

  /*
   * Der Hinweistext wird begrenzt - und zwar nicht aus Ordnungsliebe.
   *
   * Er geht ueber GET /registrierung an JEDEN hinaus, der die Adresse kennt: Das ist der
   * Weg, an dem das Anmeldefenster nachfragt, ob es einen Registrierungsknopf zeigen
   * soll, und er ist notwendigerweise ohne Anmeldung erreichbar. Ein Verwalter, der aus
   * Versehen ein ganzes Dokument hineinkopiert, macht daraus einen Weg, ueber den sich
   * beliebig oft beliebig viele Kilobyte abrufen lassen. Viertausend Zeichen sind fuer
   * einen Datenschutzhinweis reichlich; wer mehr braucht, verlinkt seine Erklaerung.
   */
  neu.hinweis = (eingabe.hinweis ?? bisher.hinweis).slice(0, HINWEIS_MAX);

  neu.gesperrteDomaenen = (eingabe.gesperrteDomaenen ?? bisher.gesperrteDomaenen)
    .map(normalisiereDomaene)
    .filter(Boolean)
    .filter((d) => d.includes('.'));

  if (!Number.isInteger(neu.hoechstzahl) || neu.hoechstzahl < 0) {
    throw new RegistrierungsFehler('Die Höchstzahl muss eine Zahl ab 0 sein (0 = keine Grenze).');
  }

  neu.domaenen = (eingabe.domaenen ?? bisher.domaenen)
    .map(normalisiereDomaene)
    .filter(Boolean)
    /*
     * Eine Domäne ohne Punkt ist mit Sicherheit ein Tippfehler ("firma" statt
     * "firma.de") - und ein Tippfehler in dieser Liste hat die unangenehme Eigenschaft,
     * dass er nichts kaputt macht, sondern nur alle aussperrt.
     */
    .filter((d) => d.includes('.'));

  /*
   * "offen" ohne Systemversand wird nicht gespeichert, sondern abgewiesen.
   *
   * Man könnte es auch still auf "freigabe" zurückfallen lassen. Das wäre freundlicher
   * und falsch: Der Verwalter hätte "offen" eingestellt, die Oberfläche zeigte "offen",
   * und der Dienst täte etwas anderes. Eine Einstellung, die nicht das tut, was
   * danebensteht, ist schlimmer als eine Fehlermeldung.
   */
  if (neu.betriebsart === 'offen' && !systemmailEingerichtet()) {
    throw new RegistrierungsFehler(
      'Ohne Systemversand gibt es keine Bestätigungsmail - und ohne die könnte sich ' +
        'jeder ein Konto auf eine fremde Adresse anlegen. Richten Sie erst den ' +
        'Systemversand ein, oder wählen Sie "Antrag mit Freigabe".',
    );
  }

  /*
   * Bei "offen" ist der Netzriegel nicht verhandelbar.
   *
   * Er wird hier GESETZT und nicht bloss empfohlen. Der Grund steht in netzziele.ts: Wer
   * ein Konto anlegt, bestimmt, wohin dieser Server Verbindungen aufbaut - und bei offener
   * Anmeldung ist das ein Fremder. Ein Schalter, den man dabei vergessen kann, waere der
   * Unterschied zwischen einem Mailserver und einer Portabtastung des Heimnetzes.
   *
   * Wieder abschalten laesst er sich nur, indem die Betriebsart zurueckgenommen wird. Das
   * ist Absicht.
   */
  if (neu.betriebsart === 'offen') neu.nurOeffentlicheMailserver = true;

  const ablage = lesen();
  ablage.einstellungen = neu;
  schreiben();
  wendeNetzzielRegelAn();
  protokolliere(
    'info',
    'registrierung',
    `Selbstregistrierung: ${neu.betriebsart}` +
      (neu.domaenen.length > 0 ? ` (nur ${neu.domaenen.join(', ')})` : ' (alle Domänen)'),
  );
  return neu;
}

/**
 * Was TATSÄCHLICH gilt - im Unterschied zu dem, was eingestellt ist.
 *
 * Die beiden können auseinanderfallen, und zwar ohne Zutun: Wer den Systemversand
 * abschaltet, nachdem er "offen" eingestellt hat, hätte sonst eine offene Registrierung
 * ohne jeden Nachweis. Deshalb wird die Frage bei JEDEM Antrag neu gestellt und nicht
 * einmal beim Speichern beantwortet.
 */
export function betriebsartWirksam(): Betriebsart {
  const eingestellt = registrierungseinstellungen().betriebsart;
  if (eingestellt === 'offen' && !systemmailEingerichtet()) return 'freigabe';
  return eingestellt;
}

/** Ob die Adresse zu den erlaubten Domänen gehört. Ohne Liste: jede. */
export function domaeneErlaubt(email: string): boolean {
  const erlaubt = registrierungseinstellungen().domaenen;
  if (erlaubt.length === 0) return true;
  const domaene = email.trim().toLowerCase().split('@')[1] ?? '';
  return erlaubt.includes(domaene);
}

/**
 * Ob die Adresse auf einer Sperrliste steht - eingebaut oder selbst gepflegt.
 *
 * Geprüft wird auch die übergeordnete Domäne: Wer `trashmail.com` sperrt, meint auch
 * `sub.trashmail.com`. Ohne diese Zeile wäre die Liste mit einem Punkt zu umgehen, und
 * genau das tun Wegwerfanbieter - sie bieten Dutzende Unterdomänen an.
 */
export function domaeneGesperrt(email: string): boolean {
  const e = registrierungseinstellungen();
  const domaene = email.trim().toLowerCase().split('@')[1] ?? '';
  if (!domaene) return true;

  const listen = [...e.gesperrteDomaenen, ...(e.wegwerfSperren ? WEGWERF_DOMAENEN : [])];
  return listen.some((gesperrt) => domaene === gesperrt || domaene.endsWith(`.${gesperrt}`));
}

// --- Anträge ---

function antraege(): Antrag[] {
  const ablage = lesen();
  if (!Array.isArray(ablage.antraege)) ablage.antraege = [];
  return ablage.antraege;
}

/**
 * Wirft weg, was verfallen ist.
 *
 * Beim Zugriff und nicht über einen Zeitgeber - dieselbe Überlegung wie bei den
 * Sitzungen: Ein Zeitgeber liefe in einem Prozess, der zwischendurch neu startet, und
 * die Aufräumung hinge daran, ob er gerade lief.
 */
export function raeumeAuf(): number {
  const jetzt = Date.now();
  const vorher = antraege();
  const uebrig = vorher.filter((a) => {
    const alter = jetzt - Date.parse(a.angelegt);
    if (!Number.isFinite(alter)) return false;
    return alter < (a.bestaetigt ? WARTEND_FRIST_MS : UNBESTAETIGT_FRIST_MS);
  });
  const weg = vorher.length - uebrig.length;
  if (weg > 0) {
    lesen().antraege = uebrig;
    schreiben();
    protokolliere('info', 'registrierung', `${weg} verfallene(r) Antrag/Anträge entfernt.`);
  }
  return weg;
}

export function oeffentlicherAntrag(a: Antrag): OeffentlicherAntrag {
  return {
    id: a.id,
    email: a.email,
    angelegt: a.angelegt,
    bestaetigt: a.bestaetigt,
    bemerkung: a.bemerkung,
  };
}

/** Alle offenen Anträge - für die Verwaltung. Räumt dabei auf. */
export function offeneAntraege(): OeffentlicherAntrag[] {
  raeumeAuf();
  return antraege()
    .map(oeffentlicherAntrag)
    .sort((a, b) => a.angelegt.localeCompare(b.angelegt));
}

/** Wie viele Anträge auf eine Entscheidung warten - für die Anzeige am Verwaltungsknopf. */
export function wartendeAntraege(): number {
  raeumeAuf();
  /*
   * Gezählt werden nur die BESTÄTIGTEN, und bei einer Aufstellung ohne Systemversand
   * alle. Ein unbestätigter Antrag ist für den Verwalter keine Aufgabe: Er wartet auf
   * den Antragsteller, nicht auf ihn - und eine Zahl am Knopf, die sich durch Warten von
   * selbst erledigt, lehrt binnen einer Woche, sie zu übersehen.
   */
  const brauchtBestaetigung = systemmailEingerichtet();
  return antraege().filter((a) => !brauchtBestaetigung || a.bestaetigt).length;
}

function markeHash(marke: string): string {
  return crypto.createHash('sha256').update(marke).digest('hex');
}

/** Was beim Aufnehmen eines Antrags herauskam - der Aufrufer entscheidet, was er verschickt. */
export type Aufnahme =
  /** Angelegt, es fehlt der Nachweis über die Adresse. Die Marke geht genau einmal hinaus. */
  | { art: 'bestaetigen'; antrag: Antrag; marke: string }
  /** Angelegt und wartet auf einen Verwalter - ohne Systemversand gibt es keinen Nachweis. */
  | { art: 'wartet'; antrag: Antrag }
  /** Auf diese Adresse gibt es bereits ein Konto. */
  | { art: 'schonKonto' }
  /** Ein Antrag dieser Adresse läuft schon und wird nicht überschrieben. */
  | { art: 'laeuftSchon' };

export interface Antragseingabe {
  email: string;
  kennwort: string;
  bemerkung?: string;
}

/**
 * Nimmt einen Antrag auf.
 *
 * ## Die Antwort nach außen ist IMMER dieselbe
 *
 * Diese Funktion unterscheidet vier Ausgänge, die Route daraus genau einen Satz - siehe
 * registrierung.ts. Das ist keine Schludrigkeit, sondern der Kern: Wer hier "Diese
 * Adresse ist bereits vergeben" zu lesen bekäme, hätte ein Werkzeug in der Hand, mit dem
 * sich durchprobieren lässt, wer an diesem Dienst ein Konto hat. Bei einem Mailprogramm
 * ist das eine Auskunft, die niemanden etwas angeht - dieselbe Überlegung wie bei
 * "Adresse oder Kennwort stimmen nicht" in anmelden.ts.
 *
 * Was der Mensch, dem die Adresse wirklich gehört, stattdessen bekommt: eine Mail. Bei
 * einem bestehenden Konto eine, die ihn darauf hinweist - das ist zugleich die Warnung,
 * falls es nicht er selbst war.
 *
 * ## Wann ein laufender Antrag ersetzt werden darf - und wann nicht
 *
 * Das ist die Stelle, an der Bequemlichkeit und Sicherheit tatsächlich gegeneinander
 * stehen, und beide haben einen Fall, in dem sie recht haben.
 *
 * **Ein UNBESTÄTIGTER Antrag darf ersetzt werden**, sofern es einen Systemversand gibt.
 * Er ist nichts wert: Wer die Marke nicht einlöst, kommt nicht herein. Und der Fall ist
 * häufig - jemand tippt sich beim Kennwort vertippt, die Mail landet im Spam, der Rechner
 * stürzt ab. Bliebe der erste Antrag stehen, säße dieser Mensch eine Woche fest, ohne zu
 * verstehen warum. Das getauschte Kennwort nützt einem Angreifer nichts, weil er die Mail
 * nicht abrufen kann.
 *
 * **Ein BESTÄTIGTER Antrag bleibt stehen**, immer. Hier ist der Nachweis erbracht und der
 * Antrag liegt beim Verwalter - dürfte ihn jetzt noch jemand überschreiben, wäre das der
 * ganze Einbruch: Der Verwalter gibt den Antrag von Frau Meier frei, und das Kennwort
 * darin ist das des Angreifers.
 *
 * **Ohne Systemversand bleibt jeder Antrag stehen.** Ohne Bestätigung gibt es keinen
 * Nachweis, also gilt derselbe Grund wie eben - nur von Anfang an.
 */
export function nimmAntragAn(eingabe: Antragseingabe): Aufnahme {
  raeumeAuf();

  const email = eingabe.email.trim().toLowerCase();
  if (!email.includes('@') || email.length < 3) {
    throw new RegistrierungsFehler('Das ist keine brauchbare Mailadresse.');
  }
  if (typeof eingabe.kennwort !== 'string' || eingabe.kennwort.length < KENNWORT_MINDESTLAENGE) {
    throw new RegistrierungsFehler(
      `Das Kennwort muss mindestens ${KENNWORT_MINDESTLAENGE} Zeichen haben.`,
    );
  }
  if (domaeneGesperrt(email)) {
    /*
     * Auch hier wird der Grund GENANNT, so wie bei der Domänengrenze - und aus demselben
     * Überlegen heraus: Es ist eine Auskunft über diesen Dienst und nicht über einen
     * Menschen. Wer es verschwiege, ließe jemanden auf eine Bestätigungsmail warten, die
     * nie kommt.
     *
     * Dass ein Angreifer damit erfährt, welche Wegwerfanbieter gesperrt sind, ist kein
     * Verlust: Er merkt es ohnehin beim ersten Versuch, und die Liste schützt nicht durch
     * Geheimhaltung, sondern dadurch, dass er sich eine echte Adresse besorgen muss.
     */
    throw new RegistrierungsFehler(
      'Mit einer Wegwerfadresse geht es hier nicht. Bitte nehmen Sie eine Adresse, die Sie behalten.',
    );
  }

  const grenze = registrierungseinstellungen().hoechstzahl;
  if (grenze > 0 && nutzerAnzahl() >= grenze) {
    /*
     * Die Obergrenze ist erreicht - und das ist eine Auskunft für den BETREIBER, nicht
     * für den Antragsteller. Er bekommt nur, dass es gerade nicht geht; im Protokoll
     * steht, warum.
     */
    protokolliere(
      'warnung',
      'registrierung',
      `Die Höchstzahl von ${grenze} Nutzern ist erreicht - der Antrag von ${email} wurde abgewiesen.`,
    );
    throw new RegistrierungsFehler(
      'Zurzeit können keine weiteren Anmeldungen aufgenommen werden. Bitte wenden Sie sich an den Betreiber dieses Dienstes.',
    );
  }

  if (!domaeneErlaubt(email)) {
    /*
     * Die Domänengrenze DARF gesagt werden, und sie muss sogar.
     *
     * Anders als die Frage "gibt es dieses Konto" verrät sie nichts über einen einzelnen
     * Menschen - sie ist eine Eigenschaft des Dienstes. Und wer sie verschwiege, ließe
     * jemanden mit seiner privaten Adresse registrieren, eine Bestätigungsmail erwarten
     * und nie erfahren, dass er die dienstliche hätte nehmen müssen.
     */
    const erlaubt = registrierungseinstellungen().domaenen;
    throw new RegistrierungsFehler(
      `An diesem Dienst können sich nur Adressen dieser Domänen anmelden: ${erlaubt.join(', ')}.`,
    );
  }

  const laufend = antraege();
  if (laufend.length >= MAX_ANTRAEGE) {
    protokolliere(
      'warnung',
      'registrierung',
      `Die Grenze von ${MAX_ANTRAEGE} offenen Anträgen ist erreicht - weitere werden ` +
        'abgewiesen. Sehen Sie in der Verwaltung nach, ob hier jemand massenhaft anlegt.',
    );
    throw new RegistrierungsFehler(
      'Zurzeit können keine weiteren Anmeldungen aufgenommen werden. Bitte später erneut versuchen.',
    );
  }

  /*
   * Die Pruefsumme wird IMMER gerechnet - auch dann, wenn schon feststeht, dass gar kein
   * Antrag entsteht.
   *
   * Das ist keine Verschwendung, sondern derselbe Schutz, den pruefeAnmeldung() in
   * nutzerStore.ts hat, und aus demselben Grund. scrypt mit N=2^16 braucht ein paar
   * zehntel Sekunden; die uebrigen Wege hier brauchen Mikrosekunden. Rechnete man erst
   * nach der Entscheidung, waere die Antwortzeit die Auskunft, die dieses Formular
   * gerade nicht geben darf:
   *
   *     ~0,2 s  ->  diese Adresse ist hier unbekannt
   *     ~0 ms   ->  es gibt bereits ein Konto oder einen laufenden Antrag
   *
   * Damit liesse sich in aller Ruhe durchprobieren, wer an diesem Dienst ein Konto hat -
   * und die sorgfaeltig gleiche Antwort darueber (siehe oben) waere umsonst gewesen.
   */
  const kennwortPruefsumme = verschluesselKennwort(eingabe.kennwort);

  if (findeNutzerNachEmail(email)) return { art: 'schonKonto' };

  /*
   * Bestätigt wird, wo bestätigt werden KANN - unabhängig von der Betriebsart.
   *
   * Bei "offen" ist die Bestätigung der einzige Nachweis und damit zwingend. Bei
   * "freigabe" wäre sie verzichtbar, weil ohnehin ein Mensch daraufsieht - aber sie
   * nimmt ihm Arbeit ab: Ein Antrag, dessen Adresse nachweislich erreichbar ist, ist
   * bereits vorsortiert, und offensichtlicher Unsinn kommt gar nicht erst auf seinen
   * Tisch.
   */
  const mitBestaetigung = systemmailEingerichtet();

  const bisheriger = laufend.find((a) => a.email === email);
  if (bisheriger && (bisheriger.bestaetigt || !mitBestaetigung)) {
    return { art: 'laeuftSchon' };
  }

  const antrag: Antrag = bisheriger ?? {
    id: crypto.randomBytes(12).toString('base64url'),
    email,
    kennwortPruefsumme: '',
    angelegt: new Date().toISOString(),
    hinweisBestaetigt: new Date().toISOString(),
  };

  antrag.kennwortPruefsumme = kennwortPruefsumme;
  antrag.hinweisBestaetigt = new Date().toISOString();
  if (eingabe.bemerkung) antrag.bemerkung = eingabe.bemerkung.slice(0, 200);

  if (mitBestaetigung) {
    const marke = crypto.randomBytes(32).toString('base64url');
    antrag.markeHash = markeHash(marke);
    antrag.markeBis = Date.now() + MARKE_GUELTIG_MS;
    if (!bisheriger) laufend.push(antrag);
    schreiben();
    protokolliere('info', 'registrierung', `Antrag für ${email} aufgenommen - Bestätigung unterwegs.`);
    return { art: 'bestaetigen', antrag, marke };
  }

  laufend.push(antrag);
  schreiben();
  protokolliere('info', 'registrierung', `Antrag für ${email} aufgenommen - wartet auf Freigabe.`);
  return { art: 'wartet', antrag };
}

/**
 * Löst eine Bestätigungsmarke ein.
 *
 * Gibt den Antrag zurück, wenn die Marke stimmt und noch gilt. Die Marke ist danach
 * verbraucht: Sie steht nicht mehr im Antrag, ein zweiter Aufruf findet nichts. Das ist
 * nötig, weil ein Bestätigungslink in einem Postfach liegt, das später jemand anderes
 * lesen könnte - eine Marke, die beliebig oft gilt, ist ein dauerhafter Schlüssel.
 */
export function loeseMarkeEin(marke: string): Antrag | null {
  if (typeof marke !== 'string' || marke.length < 20) return null;
  raeumeAuf();

  const gesucht = markeHash(marke);
  const antrag = antraege().find((a) => a.markeHash === gesucht);
  if (!antrag) return null;
  if (!antrag.markeBis || antrag.markeBis < Date.now()) return null;

  antrag.bestaetigt = new Date().toISOString();
  delete antrag.markeHash;
  delete antrag.markeBis;
  schreiben();
  protokolliere('info', 'registrierung', `${antrag.email} hat die Adresse bestätigt.`);
  return antrag;
}

export function findeAntrag(id: string): Antrag | null {
  return antraege().find((a) => a.id === id) ?? null;
}

export function entferneAntrag(id: string): boolean {
  const vorher = antraege();
  const uebrig = vorher.filter((a) => a.id !== id);
  if (uebrig.length === vorher.length) return false;
  lesen().antraege = uebrig;
  schreiben();
  return true;
}
