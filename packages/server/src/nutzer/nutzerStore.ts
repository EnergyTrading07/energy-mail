import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';
import { istGueltigeNutzerId, pruefeNutzerId } from './kontext.js';
import { brauchtErneuerung, kennwortStimmt, verschluesselKennwort } from './kennwort.js';

/**
 * Wer den Server benutzen darf.
 *
 * Liegt in der WURZEL, nicht in einem Nutzerordner: es ist die Liste der Nutzer selbst,
 * sie gehört keinem einzelnen. Das ist auch der Grund, warum dieses Modul getWurzelDir()
 * nimmt und nicht getNutzerDir() - es läuft, bevor überhaupt feststeht, wer da ist.
 */

/**
 * Wie kurz ein Anmeldekennwort höchstens sein darf.
 *
 * Stand dreimal als nackte `10` im Quelltext - beim Anlegen, beim Ändern und im Text der
 * Fehlermeldung daneben. Seit sich auch Menschen selbst registrieren, kommt eine vierte
 * Stelle hinzu, und die liegt in der OBERFLÄCHE: Sie sagt beim Tippen, wie viele Zeichen
 * noch fehlen. Ein Formular, das zehn verlangt, während der Server zwölf fordert, ist eine
 * Sackgasse ohne erkennbaren Grund - deshalb geht der Wert von hier aus über /registrierung
 * an den Browser, statt dort ein zweites Mal zu stehen.
 */
export const KENNWORT_MINDESTLAENGE = 10;

export interface Nutzer {
  id: string;
  /** Die Anmeldeadresse. Kleingeschrieben abgelegt, damit die Anmeldung nicht daran scheitert. */
  email: string;
  /** Prüfsumme des Anmeldekennworts - siehe kennwort.ts. */
  kennwort: string;
  angelegt: string;
  /**
   * Die verpackten Schlüssel dieses Nutzers, nach Generation.
   *
   * Mit ihnen werden seine Geheimnisse verschlüsselt (Postfachkennwörter, OAuth-Marken,
   * geheime PGP-Schlüssel). Sie liegen hier NICHT im Klartext, sondern jeweils mit dem
   * Masterschlüssel des Servers verschlüsselt - siehe schluesselHuelle.ts.
   *
   * Mehrere Generationen, damit sich der Schlüssel eines Nutzers wechseln lässt, ohne im
   * selben Augenblick sämtliche Geheimnisse neu verschlüsseln zu müssen: Neues wird mit
   * der aktuellen Generation geschrieben, Altes bleibt mit seiner lesbar, bis ein
   * Umschlüsseln durchgelaufen ist.
   */
  schluessel: Record<string, string>;
  /** Welche Generation für neue Geheimnisse gilt. */
  aktuelleGeneration: string;
  /** Gesperrte Nutzer können sich nicht anmelden, ihre Daten bleiben aber erhalten. */
  gesperrt?: boolean;
  /**
   * Die Rolle. Fehlt sie, ist es ein gewöhnlicher Nutzer.
   *
   * ## Warum zwei Rollen und keine Rechtematrix
   *
   * Weil es genau zwei Sorten Mensch an diesem Dienst gibt: den, der sein Postfach liest,
   * und den, der die Nutzer verwaltet. Eine Matrix aus einzeln vergebbaren Rechten wäre
   * eine Antwort auf eine Frage, die niemand gestellt hat - und jede Zeile darin ein
   * weiterer Weg, sie falsch einzustellen. Wenn eine dritte Rolle gebraucht wird, ist sie
   * hier eine Zeile.
   *
   * ## Was ein Verwalter kann - und was das ehrlicherweise heißt
   *
   * Er legt Nutzer an, setzt Kennwörter zurück, sperrt und entfernt. Ein zurückgesetztes
   * Kennwort heißt: Er kann sich als dieser Nutzer anmelden und dessen Post lesen. Das
   * ist keine Lücke, sondern die Bauart - die Postfachkennwörter liegen mit dem
   * Masterschlüssel des Servers verschlüsselt, und den hat, wer den Server betreibt.
   * Ein Verwalter, der behauptete, nicht an die Post zu können, sagte die Unwahrheit.
   * Deshalb steht es hier, in BETRIEB.md und im Protokoll.
   */
  rolle?: 'verwalter';
  /** Der zweite Faktor, wenn er eingerichtet ist - siehe unten. */
  zweiFaktor?: ZweiFaktorEintrag;
}

/**
 * Was zum zweiten Faktor eines Nutzers gespeichert wird.
 *
 * Dieses Modul weiß nichts über TOTP und rechnet nichts nach - es legt ab und gibt heraus.
 * Das Verfahren steht in totp.ts, die Wege in zweiFaktor.ts. Der Grund für die Trennung ist
 * derselbe wie beim Anmeldekennwort: Wo die Buchführung liegt, soll nicht auch die
 * Kryptografie liegen, sonst wandert bei jeder Änderung beides durcheinander.
 */
export interface ZweiFaktorEintrag {
  /**
   * Das gemeinsame Geheimnis - VERSCHLÜSSELT, mit dem Masterschlüssel des Servers.
   *
   * Anders als beim Kennwort geht hier keine Prüfsumme: Der Server muss den Code selbst
   * ausrechnen können und braucht das Geheimnis dafür im Klartext. Eine Prüfsumme wäre
   * unbrauchbar.
   *
   * Deshalb ist die Verschlüsselung hier nicht Zierrat, sondern das Einzige, was zwischen
   * einer abhandengekommenen nutzer.json und einem funktionierenden zweiten Faktor steht:
   * Wer das Geheimnis hat, kann jeden Code erzeugen, den die App des Nutzers anzeigt.
   * Verpackt wird mit dem Masterschlüssel und nicht mit dem Nutzerschlüssel - beim
   * Anmelden steht noch kein Nutzerkontext, und der Nutzerschlüssel wäre unerreichbar.
   */
  geheimnis: string;
  /** Seit wann er gilt. Erst mit diesem Feld ist die Einrichtung abgeschlossen. */
  seit: string;
  /** sha256 der Wiederherstellungscodes. Ein benutzter wird gestrichen, nicht markiert. */
  codes: string[];
  /**
   * Der zuletzt eingelöste Zeitschritt.
   *
   * Ohne ihn ließe sich ein abgelesener Code innerhalb seiner dreißig Sekunden ein zweites
   * Mal einlösen - und TOTP wäre ein Kennwort mit halber Minute Haltbarkeit statt eines
   * Einmalkennworts. Der Name sagt es ja: einmal.
   */
  letzterSchritt?: number;
}

/** Was nach außen gehen darf - ohne Prüfsumme, ohne Schlüssel. */
export interface OeffentlicherNutzer {
  id: string;
  email: string;
  angelegt: string;
  gesperrt: boolean;
  verwalter: boolean;
  /** Ob ein zweiter Faktor eingerichtet ist - nicht, welcher. */
  zweiFaktor: boolean;
}

type Ablage = { nutzer: Nutzer[] };

const getPfad = () => path.join(getWurzelDir(), 'nutzer.json');

function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'nutzer',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }
  return Array.isArray(befund.wert?.nutzer) ? befund.wert : { nutzer: [] };
}

function schreiben(ablage: Ablage): void {
  schreibeAtomar(getPfad(), JSON.stringify(ablage, null, 2));
}

/** Für die Anzeige - nie die Prüfsumme oder die Schlüssel herausgeben. */
export function oeffentlich(n: Nutzer): OeffentlicherNutzer {
  return {
    id: n.id,
    email: n.email,
    angelegt: n.angelegt,
    gesperrt: Boolean(n.gesperrt),
    verwalter: n.rolle === 'verwalter',
    zweiFaktor: Boolean(n.zweiFaktor?.seit),
  };
}

export function alleNutzer(): OeffentlicherNutzer[] {
  return lesen().nutzer.map(oeffentlich);
}

/** Ob dieser Nutzer verwalten darf. */
export function istVerwalter(id: string): boolean {
  return findeNutzer(id)?.rolle === 'verwalter';
}

/** Wie viele Verwalter es gibt - für die Frage, ob der letzte gerade abgeräumt wird. */
export function verwalterAnzahl(): number {
  return lesen().nutzer.filter((n) => n.rolle === 'verwalter').length;
}

/**
 * Setzt oder nimmt die Verwalterrolle.
 *
 * Der letzte Verwalter lässt sich nicht absetzen, und das ist keine Bevormundung: Danach
 * könnte niemand mehr Nutzer anlegen, Kennwörter zurücksetzen oder die Rolle wieder
 * vergeben - der Dienst wäre nur noch über die Befehlszeile auf dem Server zu retten. Wer
 * die Rolle wirklich abgeben will, gibt sie erst jemand anderem.
 */
export function setzeRolle(id: string, verwalter: boolean): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');

  if (!verwalter && nutzer.rolle === 'verwalter') {
    const uebrig = ablage.nutzer.filter((n) => n.rolle === 'verwalter' && n.id !== id).length;
    if (uebrig === 0) {
      throw new NutzerFehler(
        'Das ist der letzte Verwalter. Ernennen Sie erst einen anderen.',
      );
    }
  }

  if (verwalter) nutzer.rolle = 'verwalter';
  else delete nutzer.rolle;
  schreiben(ablage);
  protokolliere(
    'info',
    'nutzer',
    `Nutzer "${id}" ist ${verwalter ? 'jetzt Verwalter' : 'kein Verwalter mehr'}.`,
  );
}

/**
 * Sorgt dafür, dass es einen Verwalter gibt.
 *
 * Zwei Fälle, und beide brauchen das:
 *
 *  - **Eine bestehende Aufstellung.** In nutzer.json steht bis heute keine Rolle. Ohne
 *    diesen Schritt hätte nach der Aktualisierung niemand Verwalterrechte, und die neue
 *    Verwaltung wäre für den, der sie am nötigsten hat, unerreichbar.
 *  - **Der erste Nutzer überhaupt.** Wer als Erster angelegt wird, ist derjenige, der den
 *    Dienst aufsetzt.
 *
 * Genommen wird der zuerst Angelegte, nicht irgendeiner: Das ist der, der den Server
 * eingerichtet hat. Und es wird laut ins Protokoll geschrieben - eine Rechteerweiterung,
 * die stillschweigend geschieht, ist genau die Sorte Vorgang, die man später sucht.
 */
export function stelleVerwalterSicher(ausser?: string): void {
  const ablage = lesen();
  if (ablage.nutzer.some((n) => n.rolle === 'verwalter')) return;

  /*
   * Der Pseudo-Nutzer der Hülle kommt nicht in Frage - und das ist keine Kleinigkeit.
   *
   * Auch im Serverbetrieb legt der Start einen Eintrag "lokal" an; über ihn weist sich das
   * Desktop-Fenster aus. Sein Kennwort sind vierundzwanzig zufällige Bytes, die nie jemand
   * zu sehen bekommt. Er ist zugleich der ZUERST angelegte Eintrag - ohne diese Zeile
   * bekäme also ausgerechnet das Konto die Verwalterrolle, an das niemand herankommt, und
   * der Mensch, der den Dienst betreibt, stünde ohne Rechte da.
   */
  const inFrage = ablage.nutzer.filter((n) => n.id !== ausser);
  if (inFrage.length === 0) return;

  const erster = [...inFrage].sort((a, b) => a.angelegt.localeCompare(b.angelegt))[0]!;
  erster.rolle = 'verwalter';
  schreiben(ablage);
  protokolliere(
    'warnung',
    'nutzer',
    `Kein Verwalter vorhanden - "${erster.id}" (zuerst angelegt) wurde dazu ernannt.`,
  );
}

export function nutzerAnzahl(): number {
  return lesen().nutzer.length;
}

export function findeNutzer(id: string): Nutzer | null {
  if (!istGueltigeNutzerId(id)) return null;
  return lesen().nutzer.find((n) => n.id === id) ?? null;
}

export function findeNutzerNachEmail(email: string): Nutzer | null {
  const gesucht = email.trim().toLowerCase();
  if (!gesucht) return null;
  return lesen().nutzer.find((n) => n.email === gesucht) ?? null;
}

export class NutzerFehler extends Error {}

/**
 * Macht aus einer Mailadresse eine brauchbare Kennung.
 *
 * Die Kennung wird zu einem Ordnernamen (siehe kontext.ts), taugt also nur mit
 * Kleinbuchstaben, Ziffern, Bindestrich und Unterstrich. "Anna.Müller+mail@beispiel.de"
 * ergibt "anna-mueller-mail"; kollidiert das, wird durchnummeriert.
 */
function kennungAus(email: string, vergeben: readonly string[]): string {
  const roh = email.split('@')[0] ?? 'nutzer';
  const basis =
    roh
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'nutzer';

  if (!vergeben.includes(basis) && istGueltigeNutzerId(basis)) return basis;
  for (let i = 2; i < 10_000; i++) {
    const versuch = `${basis}-${i}`;
    if (!vergeben.includes(versuch)) return versuch;
  }
  // Praktisch unerreichbar; besser als eine Endlosschleife.
  return `nutzer-${crypto.randomBytes(6).toString('hex')}`;
}

export interface NeuerNutzer {
  email: string;
  kennwort?: string;
  /**
   * Statt eines Klartextkennworts eine fertige Prüfsumme.
   *
   * Für die Selbstregistrierung, und dort ist es keine Bequemlichkeit, sondern der Punkt:
   * Zwischen dem Ausfüllen des Formulars und dem Anlegen des Kontos liegt eine
   * Mailbestätigung oder die Freigabe durch einen Verwalter - also Stunden bis Tage. Das
   * Kennwort so lange irgendwo aufzubewahren, hieße, es im Klartext (oder umkehrbar
   * verschlüsselt) in einer Datei liegen zu haben, die nur darauf wartet, gelesen zu
   * werden. Der Antrag hält deshalb von Anfang an nur die Prüfsumme, und die wandert hier
   * unverändert in den Nutzereintrag - siehe registrierungSpeicher.ts.
   *
   * Genau eines von beiden muss gesetzt sein.
   */
  kennwortPruefsumme?: string;
  /** Nur für den Einplatzbetrieb: dort heißt der Nutzer fest "lokal". */
  id?: string;
}

/**
 * Legt einen Nutzer an - samt seinem verpackten Schlüssel.
 *
 * Der Schlüssel entsteht hier und nicht erst beim ersten Geheimnis: ein Nutzer ohne
 * Schlüssel wäre ein halber Zustand, in dem das Anlegen eines Kontos an einer Stelle
 * scheiterte, die damit nichts zu tun hat.
 */
export function legeNutzerAn(
  eingabe: NeuerNutzer,
  verpackeSchluessel: (roh: Buffer) => string,
): Nutzer {
  const email = eingabe.email.trim().toLowerCase();
  if (!email.includes('@') || email.length < 3) {
    throw new NutzerFehler('Das ist keine brauchbare Mailadresse.');
  }
  if (!eingabe.kennwortPruefsumme && (typeof eingabe.kennwort !== 'string' || eingabe.kennwort.length < KENNWORT_MINDESTLAENGE)) {
    /*
     * Zehn Zeichen als Untergrenze, keine Regeln über Sonderzeichen.
     *
     * Die üblichen Regeln ("mindestens eine Ziffer, ein Großbuchstabe...") führen
     * nachweislich zu schlechteren Kennwörtern, weil sie Menschen zu "Passwort1!"
     * treiben. Länge ist die einzige Anforderung, die tatsächlich hilft.
     */
    throw new NutzerFehler('Das Kennwort muss mindestens zehn Zeichen haben.');
  }

  const ablage = lesen();
  if (ablage.nutzer.some((n) => n.email === email)) {
    throw new NutzerFehler('Diese Adresse ist hier bereits angemeldet.');
  }

  const id = eingabe.id
    ? pruefeNutzerId(eingabe.id)
    : kennungAus(
        email,
        ablage.nutzer.map((n) => n.id),
      );
  if (ablage.nutzer.some((n) => n.id === id)) {
    throw new NutzerFehler(`Die Kennung "${id}" ist bereits vergeben.`);
  }

  const neu: Nutzer = {
    id,
    email,
    kennwort: eingabe.kennwortPruefsumme ?? verschluesselKennwort(eingabe.kennwort!),
    angelegt: new Date().toISOString(),
    schluessel: { '1': verpackeSchluessel(crypto.randomBytes(32)) },
    aktuelleGeneration: '1',
  };

  ablage.nutzer.push(neu);
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Nutzer "${id}" angelegt.`);
  return neu;
}

/**
 * Prüft eine Anmeldung.
 *
 * Gibt bei Erfolg den Nutzer zurück, sonst `null` - und zwar mit demselben Aufwand,
 * gleich ob es die Adresse gibt oder nicht. Sonst verriete die Antwortzeit, welche
 * Adressen angemeldet sind.
 */
export function pruefeAnmeldung(email: string, kennwort: string): Nutzer | null {
  const nutzer = findeNutzerNachEmail(email);

  if (!nutzer) {
    /*
     * Auch ohne Treffer rechnen.
     *
     * Ohne das wäre die Antwort bei einer unbekannten Adresse sofort da und bei einer
     * bekannten erst nach der scrypt-Rechnung. Aus dem Unterschied ließe sich ablesen,
     * wer hier ein Konto hat - eine Auskunft, die niemanden etwas angeht.
     */
    verschluesselKennwort(kennwort);
    return null;
  }
  if (nutzer.gesperrt) return null;
  if (!kennwortStimmt(kennwort, nutzer.kennwort)) return null;

  // Der einzige Augenblick, in dem das Kennwort im Klartext vorliegt: die Gelegenheit,
  // eine mit schwächeren Parametern gerechnete Prüfsumme still zu erneuern.
  if (brauchtErneuerung(nutzer.kennwort)) {
    setzeKennwort(nutzer.id, kennwort);
    protokolliere('info', 'nutzer', `Kennwortprüfsumme von "${nutzer.id}" erneuert.`);
  }

  return nutzer;
}

export function setzeKennwort(id: string, neuesKennwort: string): void {
  if (typeof neuesKennwort !== 'string' || neuesKennwort.length < KENNWORT_MINDESTLAENGE) {
    throw new NutzerFehler('Das Kennwort muss mindestens zehn Zeichen haben.');
  }
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  nutzer.kennwort = verschluesselKennwort(neuesKennwort);
  schreiben(ablage);
}

/**
 * Sperrt einen Nutzer oder gibt ihn wieder frei.
 *
 * Der Unterschied zum Entfernen ist der Punkt: gesperrt kommt er nicht mehr herein, seine
 * Daten bleiben aber lesbar. Das ist, was man in der Testphase tatsächlich braucht -
 * jemand hört auf, oder etwas ist unklar und soll bis zur Klärung ruhen. Entfernen ist
 * endgültig: mit dem Eintrag geht sein Schlüssel, und danach sind seine Geheimnisse in
 * jeder Sicherung nur noch Bytes.
 *
 * `gesperrt` wurde in pruefeAnmeldung() schon abgefragt, seit es das Feld gibt - nur
 * konnte es niemand setzen. Die Abfrage lief also ins Leere.
 */
export function setzeSperre(id: string, gesperrt: boolean): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  /*
   * Den letzten Verwalter zu sperren hat dieselbe Wirkung wie ihn abzusetzen: Danach kommt
   * niemand mehr herein, der die Sperre wieder aufheben könnte. Deshalb dieselbe Bremse
   * wie in setzeRolle - sonst wäre sie über diesen Weg zu umgehen.
   */
  if (gesperrt && nutzer.rolle === 'verwalter') {
    const uebrig = ablage.nutzer.filter(
      (n) => n.rolle === 'verwalter' && n.id !== id && !n.gesperrt,
    ).length;
    if (uebrig === 0) {
      throw new NutzerFehler('Das ist der letzte Verwalter. Ernennen Sie erst einen anderen.');
    }
  }
  if (gesperrt) nutzer.gesperrt = true;
  else delete nutzer.gesperrt;
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Nutzer "${id}" ${gesperrt ? 'gesperrt' : 'wieder freigegeben'}.`);
}

/** Ob ein Nutzer gesperrt ist - für die Anzeige im Verwaltungswerkzeug. */
export function istGesperrt(id: string): boolean {
  return Boolean(findeNutzer(id)?.gesperrt);
}

// --- Der zweite Faktor ---

/** Ob ein Nutzer einen zweiten Faktor eingerichtet hat. */
export function hatZweiFaktor(id: string): boolean {
  return Boolean(findeNutzer(id)?.zweiFaktor?.seit);
}

/** Was zum zweiten Faktor gespeichert ist - das Geheimnis darin ist verschlüsselt. */
export function liesZweiFaktor(id: string): ZweiFaktorEintrag | null {
  return findeNutzer(id)?.zweiFaktor ?? null;
}

/** Schaltet ihn ein. Das Geheimnis kommt fertig verschlüsselt herein - siehe zweiFaktor.ts. */
export function setzeZweiFaktor(id: string, geheimnis: string, codes: string[]): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  nutzer.zweiFaktor = { geheimnis, seit: new Date().toISOString(), codes };
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Zweiter Faktor für "${id}" eingerichtet.`);
}

/** Und wieder aus. Gibt zurück, ob überhaupt einer da war. */
export function entferneZweiFaktor(id: string): boolean {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer?.zweiFaktor) return false;
  delete nutzer.zweiFaktor;
  schreiben(ablage);
  protokolliere('warnung', 'nutzer', `Zweiter Faktor für "${id}" entfernt.`);
  return true;
}

/**
 * Bucht einen eingelösten Zeitschritt - und meldet, ob er schon einmal dran war.
 *
 * `false` heißt: Dieser Code wurde bereits benutzt. Der Aufrufer muss die Anmeldung dann
 * abweisen, obwohl der Code rechnerisch stimmt. Genau darin besteht der Unterschied
 * zwischen einem Einmalkennwort und einem Kennwort, das sich alle dreißig Sekunden ändert.
 *
 * Der Vergleich ist "kleiner oder gleich" und nicht "gleich": Wer die Uhr seines Rechners
 * zurückstellt, könnte sonst einen alten Code erneut einlösen.
 */
export function merkeZweiFaktorSchritt(id: string, schritt: number): boolean {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer?.zweiFaktor) return false;
  if (nutzer.zweiFaktor.letzterSchritt !== undefined && schritt <= nutzer.zweiFaktor.letzterSchritt) {
    return false;
  }
  nutzer.zweiFaktor.letzterSchritt = schritt;
  schreiben(ablage);
  return true;
}

/**
 * Löst einen Wiederherstellungscode ein.
 *
 * Er wird gestrichen und nicht als "benutzt" markiert - ein Code, der noch dasteht, wird
 * irgendwann wieder abgetippt. Zurück kommt, wie viele noch übrig sind, damit der Nutzer
 * rechtzeitig neue bekommt.
 */
export function verbraucheWiederherstellungscode(id: string, pruefsumme: string): number | null {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  const stelle = nutzer?.zweiFaktor?.codes.indexOf(pruefsumme) ?? -1;
  if (!nutzer?.zweiFaktor || stelle < 0) return null;
  nutzer.zweiFaktor.codes.splice(stelle, 1);
  schreiben(ablage);
  protokolliere(
    'warnung',
    'anmeldung',
    `"${id}" hat einen Wiederherstellungscode eingelöst - ${nutzer.zweiFaktor.codes.length} übrig.`,
  );
  return nutzer.zweiFaktor.codes.length;
}

/** Legt einen frischen Satz Wiederherstellungscodes an - die alten gelten dann nicht mehr. */
export function setzeWiederherstellungscodes(id: string, codes: string[]): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer?.zweiFaktor) throw new NutzerFehler('Für diesen Nutzer ist kein zweiter Faktor eingerichtet.');
  nutzer.zweiFaktor.codes = codes;
  schreiben(ablage);
}

/** Trägt eine neue Schlüsselgeneration ein - für den Wechsel des Nutzerschlüssels. */
export function setzeSchluesselGeneration(id: string, generation: string, verpackt: string): void {
  const ablage = lesen();
  const nutzer = ablage.nutzer.find((n) => n.id === id);
  if (!nutzer) throw new NutzerFehler('Diesen Nutzer gibt es nicht.');
  nutzer.schluessel[generation] = verpackt;
  nutzer.aktuelleGeneration = generation;
  schreiben(ablage);
}

/**
 * Entfernt einen Nutzer aus der Liste.
 *
 * Damit sind seine Geheimnisse unlesbar - auch in jeder Sicherung, die es von ihnen
 * gibt: der Schlüssel dazu steht ausschließlich hier. Die Dateien in seinem Ordner löscht
 * der Aufrufer; ohne Schlüssel sind sie nur noch Bytes.
 */
export function entferneNutzer(id: string): boolean {
  const ablage = lesen();
  // Auch hier: Der letzte Verwalter geht nicht. Ein Dienst ohne Verwalter lässt sich nur
  // noch auf dem Server selbst wieder in Ordnung bringen.
  const weg = ablage.nutzer.find((n) => n.id === id);
  if (weg?.rolle === 'verwalter') {
    const uebrig = ablage.nutzer.filter((n) => n.rolle === 'verwalter' && n.id !== id).length;
    if (uebrig === 0) {
      throw new NutzerFehler('Das ist der letzte Verwalter. Ernennen Sie erst einen anderen.');
    }
  }
  const vorher = ablage.nutzer.length;
  ablage.nutzer = ablage.nutzer.filter((n) => n.id !== id);
  if (ablage.nutzer.length === vorher) return false;
  schreiben(ablage);
  protokolliere('info', 'nutzer', `Nutzer "${id}" entfernt - seine Geheimnisse sind unlesbar.`);
  return true;
}
