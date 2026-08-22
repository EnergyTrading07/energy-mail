import crypto from 'node:crypto';
import path from 'node:path';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';

/**
 * Angemeldete Sitzungen.
 *
 * Serverseitig gehalten, nicht als selbsttragende Marke im Keks. Der Unterschied zählt:
 * eine signierte Marke lässt sich nicht zurücknehmen - wer abgemeldet wird, bleibt bis
 * zum Ablauf angemeldet, und ein gestohlener Keks gilt weiter. Eine Sitzung, die hier
 * steht, ist mit einer Zeile weg.
 *
 * Auf Platte, damit ein Neustart des Servers nicht alle abmeldet. Bei einem
 * Mailprogramm, das den ganzen Tag offen ist, wäre das der auffälligste Nachteil einer
 * reinen Speicherlösung.
 */

export interface Sitzung {
  /** sha256 der Kennung - siehe unten. */
  kennungHash: string;
  nutzerId: string;
  angelegt: number;
  zuletztGenutzt: number;
  /**
   * Seit wann die Sitzung gesperrt ist - gesetzt heißt: gesperrt.
   *
   * Eine gesperrte Sitzung bleibt bestehen und behält ihren Nutzer; sie lässt nur nichts
   * mehr durch, bis das Kennwort wieder eingegeben wurde.
   *
   * Warum nicht einfach beenden und neu anmelden lassen: Weil dann ein halb geschriebener
   * Brief verloren geht. Die Oberfläche hält den Entwurf im Speicher, und ein Nutzer, der
   * zwanzig Minuten telefoniert hat, soll dafür nicht bestraft werden. Er gibt sein
   * Kennwort ein und schreibt weiter.
   *
   * Warum überhaupt am Server und nicht als Vorhang in der Oberfläche: Weil ein Vorhang
   * keiner ist. Der Keks gilt weiter, und ein zweiter Tab - oder ein Abruf von Hand -
   * bekommt die Post ungehindert. Gesperrt ist nur, was der Server nicht mehr beantwortet.
   */
  gesperrtSeit?: number;
  /**
   * "Angemeldet bleiben" - der Mensch hat es ausdrücklich verlangt.
   *
   * ## Was daran anders ist, und warum es beides sein muss
   *
   * Eine dauerhafte Sitzung kennt **weder Ruhefrist noch Untätigkeitssperre**. Das zweite
   * klingt nach zu viel und ist doch der Kern: Wer die Anwendung nach zwei Tagen wieder
   * öffnet, hat länger nichts getan, als die Sperrfrist erlaubt - die Sitzung wäre beim
   * Start zu, und er gäbe sein Kennwort ein. Genau das wollte er mit dem Häkchen
   * vermeiden. Nur die Anmeldung zu erhalten und dann doch nach dem Kennwort zu fragen,
   * wäre ein Versprechen, das die Sache nicht hält.
   *
   * Was BLEIBT: die Sperre auf Verlangen (der Knopf), das Abmelden, die Höchstdauer, und
   * jeder Kennwortwechsel beendet weiterhin alles. Was hier aufgegeben wird, ist der
   * Schutz gegen den, der an den unverschlossenen Rechner tritt - und das ist eine
   * Entscheidung, die dem Menschen davor gehört. Die Oberfläche sagt es ihm daneben.
   */
  dauerhaft?: boolean;
}

type Ablage = { sitzungen: Sitzung[] };

const getPfad = () => path.join(getWurzelDir(), 'sitzungen.json');

/** Nach so langer Untätigkeit ist Schluss. */
const RUHE_FRIST_MS = 14 * 24 * 60 * 60 * 1000;

/** Und spätestens dann in jedem Fall - auch bei täglicher Nutzung. */
const HOECHSTDAUER_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Die Höchstdauer einer dauerhaften Sitzung: ein Jahr.
 *
 * Nicht "unbegrenzt", und das ist mit Absicht so. Eine Sitzung, die nie abläuft, ist ein
 * Schlüssel ohne Verfallsdatum - er überlebt den Wechsel des Arbeitsplatzes, das
 * ausgemusterte Gerät und den Menschen, der den Betrieb verlassen hat. Ein Jahr ist lang
 * genug, dass niemand es im Alltag bemerkt, und kurz genug, dass ein vergessenes Gerät
 * nicht auf ewig hereinkommt.
 */
const DAUERHAFT_MS = 365 * 24 * 60 * 60 * 1000;

/** Damit ein voller Datenträger oder ein Fehler die Anmeldung nicht endlos wachsen lässt. */
const MAX_SITZUNGEN = 10_000;

/**
 * Nach so langer Untätigkeit wird gesperrt - nicht abgemeldet.
 *
 * Der Unterschied zur RUHE_FRIST darüber ist der zwischen "weg" und "zu": Nach vierzehn
 * Tagen ist die Sitzung erledigt und muss neu angemeldet werden. Nach der Sperrfrist ist
 * sie nur verschlossen; das Kennwort öffnet sie wieder, und was in der Oberfläche offen
 * stand, steht danach noch.
 *
 * Voreingestellt eine Stunde. Ein Mailprogramm steht den ganzen Tag offen, aber es wird
 * auch den ganzen Tag angefasst - eine Stunde wirklicher Untätigkeit ist die Mittagspause
 * und nicht die Denkpause. Wer es schärfer braucht, setzt ENERGY_MAIL_SPERRE_MINUTEN;
 * eine 0 schaltet die Sperre ab.
 */
/**
 * Dieselbe Frist in Minuten - für die Oberfläche.
 *
 * Sie muss den Wert kennen, denn sie sperrt den Bildschirm SELBST, sobald niemand mehr
 * tippt. Der Server merkt Untätigkeit erst bei der nächsten Anfrage, und die kommt bei
 * einem Fenster, vor dem gerade niemand sitzt, per Definition nicht. Ohne die Oberfläche
 * bliebe die Post sichtbar stehen, bis jemand vorbeikommt und klickt.
 *
 * Eine Quelle für beide: sonst sperrt die eine nach zehn und die andere nach sechzig
 * Minuten, und niemand weiß, welche gilt.
 */
export function sperrfristMinuten(): number {
  return Math.round(sperrfristMs() / 60000);
}

function sperrfristMs(): number {
  const roh = process.env.ENERGY_MAIL_SPERRE_MINUTEN;
  if (roh === undefined) return 60 * 60 * 1000;
  const minuten = Number(roh);
  if (!Number.isFinite(minuten) || minuten < 0) return 60 * 60 * 1000;
  return minuten * 60 * 1000;
}

/**
 * Wie oft die letzte Nutzung überhaupt fortgeschrieben wird.
 *
 * Das ist keine Feinheit, sondern der Unterschied zwischen einer Sperre, die funktioniert,
 * und einer, die zufällig zuschlägt. Fortgeschrieben wurde bisher höchstens stündlich, um
 * nicht bei jeder Anfrage auf die Platte zu schreiben. Bei einer Sperrfrist von einer
 * Stunde hieße das: Wer um 9:00 und um 9:59 arbeitet, hat einen Zeitstempel von 9:00 -
 * und wird um 10:00 gesperrt, obwohl er gerade eben getippt hat.
 *
 * Deshalb ein Viertel der Sperrfrist, höchstens eine Stunde. Bei fünfzehn Minuten Sperre
 * sind das knapp vier Minuten - vier Schreibvorgänge je Stunde statt einem, und dafür eine
 * Sperre, die den Namen verdient.
 */
function auffrischAbstandMs(): number {
  const frist = sperrfristMs();
  return frist > 0 ? Math.min(60 * 60 * 1000, Math.max(30 * 1000, frist / 4)) : 60 * 60 * 1000;
}

let geladen: Sitzung[] | null = null;

function lesen(): Sitzung[] {
  if (geladen) return geladen;
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'warnung',
      'sitzung',
      `${befund.beschaedigt.pfad} war unlesbar - alle Nutzer müssen sich neu anmelden.`,
    );
  }
  geladen = Array.isArray(befund.wert?.sitzungen) ? befund.wert.sitzungen : [];
  return geladen;
}

function schreiben(): void {
  try {
    schreibeAtomar(getPfad(), JSON.stringify({ sitzungen: geladen ?? [] }, null, 2));
  } catch (err) {
    protokolliere('warnung', 'sitzung', `Sitzungen nicht gesichert: ${(err as Error).message}`);
  }
}

/**
 * Gespeichert wird nur eine Prüfsumme der Kennung, nicht die Kennung selbst.
 *
 * Damit ist die Datei kein Generalschlüssel: Wer sie in die Hände bekommt - aus einer
 * Sicherung, über einen Lesefehler anderswo -, kann daraus keine gültige Sitzung bauen.
 * sha256 genügt hier, anders als beim Kennwort: die Kennung sind 32 zufällige Bytes, da
 * gibt es nichts zu erraten, und ein langsames Verfahren käme bei jeder Anfrage zum
 * Tragen.
 */
function hashe(kennung: string): string {
  return crypto.createHash('sha256').update(kennung).digest('hex');
}

function abgelaufen(s: Sitzung, jetzt: number): boolean {
  // Eine dauerhafte Sitzung kennt keine Ruhefrist - nur die Höchstdauer. Siehe `dauerhaft`.
  if (s.dauerhaft) return jetzt - s.angelegt > DAUERHAFT_MS;
  return jetzt - s.zuletztGenutzt > RUHE_FRIST_MS || jetzt - s.angelegt > HOECHSTDAUER_MS;
}

/**
 * Wie lange der Keks zu dieser Sitzung gelten soll - in Sekunden, oder `null`.
 *
 * `null` heißt: ein Sitzungskeks ohne Verfallsdatum, den der Browser beim Schließen
 * wegwirft. Das ist die VORGABE und der wesentliche Unterschied zu vorher: Bisher bekam
 * jede Anmeldung neunzig Tage mit, ob gewollt oder nicht - auch die an einem fremden
 * Rechner, an dem jemand nur kurz seine Post lesen wollte.
 */
export function keksDauerSekunden(dauerhaft: boolean): number | null {
  return dauerhaft ? Math.round(DAUERHAFT_MS / 1000) : null;
}

/** Legt eine Sitzung an und gibt die Kennung zurück - sie steht danach nirgends mehr. */
export function eroeffneSitzung(nutzerId: string, dauerhaft = false): string {
  const sitzungen = lesen();
  const jetzt = Date.now();

  // Beim Anmelden aufräumen: ein eigener Zeitgeber dafür wäre ein Aufwand, der nichts
  // besser macht - hier kommt ohnehin regelmäßig jemand vorbei.
  const uebrig = sitzungen.filter((s) => !abgelaufen(s, jetzt));
  if (uebrig.length >= MAX_SITZUNGEN) {
    uebrig.sort((a, b) => b.zuletztGenutzt - a.zuletztGenutzt);
    uebrig.length = MAX_SITZUNGEN - 1;
  }

  const kennung = crypto.randomBytes(32).toString('base64url');
  uebrig.push({
    kennungHash: hashe(kennung),
    nutzerId,
    angelegt: jetzt,
    zuletztGenutzt: jetzt,
    ...(dauerhaft ? { dauerhaft: true } : {}),
  });

  geladen = uebrig;
  schreiben();
  return kennung;
}

/**
 * Wem eine Kennung gehört - oder `null`.
 *
 * Frischt nebenbei die letzte Nutzung auf, damit eine benutzte Sitzung nicht mitten in
 * der Arbeit abläuft. Geschrieben wird dabei nicht bei jeder Anfrage: das wären bei einem
 * offenen Mailprogramm hunderte Schreibvorgänge je Stunde für eine Angabe, die auf ein
 * paar Minuten genau nicht ankommt.
 */
export function nutzerZurSitzung(kennung: string | undefined): string | null {
  return sitzungsstand(kennung).nutzerId;
}

/** Was von einer Sitzung zu wissen ist: wem sie gehört und ob sie zu ist. */
export interface Sitzungsstand {
  nutzerId: string | null;
  gesperrt: boolean;
}

/**
 * Wie `nutzerZurSitzung`, aber mit der Auskunft über die Sperre.
 *
 * Der Nutzer kommt auch bei gesperrter Sitzung zurück, und das ist Absicht: Die
 * Oberfläche soll "Gesperrt - Kennwort für anna@beispiel.de" zeigen können und nicht ein
 * leeres Anmeldefenster, das so tut, als sei nie jemand da gewesen. Wer den Stand hier
 * abfragt, muss `gesperrt` selbst beachten - der Haken in haken.ts tut das.
 */
export function sitzungsstand(kennung: string | undefined): Sitzungsstand {
  const leer = { nutzerId: null, gesperrt: false };
  if (!kennung) return leer;
  const gesucht = hashe(kennung);
  const jetzt = Date.now();

  const sitzung = lesen().find((s) => s.kennungHash === gesucht);
  if (!sitzung) return leer;
  if (abgelaufen(sitzung, jetzt)) {
    beendeSitzung(kennung);
    return leer;
  }

  if (sitzung.gesperrtSeit) return { nutzerId: sitzung.nutzerId, gesperrt: true };

  /*
   * Zu lange nichts getan: zumachen statt beenden.
   *
   * Geprüft wird beim Zugriff und nicht von einem Zeitgeber. Ein Zeitgeber liefe in einem
   * Prozess, der zwischendurch neu startet, und die Sperre hinge dann daran, ob er gerade
   * lief - genau der Fehler, den die Anmeldebremse hatte.
   */
  /*
   * Die Untätigkeitssperre gilt für dauerhafte Sitzungen nicht.
   *
   * Sonst wäre "angemeldet bleiben" ein halbes Versprechen: Die Anmeldung überlebte den
   * Neustart, aber beim ersten Öffnen stünde die Kennwortabfrage da - denn zwischen
   * gestern Abend und heute früh liegt mehr Untätigkeit, als die Frist erlaubt. Die
   * Begründung steht ausführlich am Feld `dauerhaft`.
   */
  const frist = sitzung.dauerhaft ? 0 : sperrfristMs();
  if (frist > 0 && jetzt - sitzung.zuletztGenutzt > frist) {
    sitzung.gesperrtSeit = jetzt;
    schreiben();
    protokolliere('info', 'sitzung', `${sitzung.nutzerId} wegen Untätigkeit gesperrt.`);
    return { nutzerId: sitzung.nutzerId, gesperrt: true };
  }

  if (jetzt - sitzung.zuletztGenutzt > auffrischAbstandMs()) {
    sitzung.zuletztGenutzt = jetzt;
    schreiben();
  }
  return { nutzerId: sitzung.nutzerId, gesperrt: false };
}

/**
 * Sperrt eine Sitzung sofort - auf Verlangen des Nutzers.
 *
 * Der Knopf dafür ist die eigentliche Sperre. Die Frist fängt den, der es vergisst; wer
 * den Rechner bewusst verlässt, will nicht warten, bis eine Frist abläuft.
 */
export function sperreSitzung(kennung: string | undefined): boolean {
  if (!kennung) return false;
  const gesucht = hashe(kennung);
  const sitzung = lesen().find((s) => s.kennungHash === gesucht);
  if (!sitzung || sitzung.gesperrtSeit) return false;
  sitzung.gesperrtSeit = Date.now();
  schreiben();
  return true;
}

/**
 * Öffnet eine gesperrte Sitzung wieder.
 *
 * Wer prüfen darf, ob das Kennwort stimmt, ist NICHT dieses Modul - das entscheidet der
 * Aufrufer (siehe anmelden.ts). Hier steht nur die Buchführung; sonst hinge die
 * Kennwortprüfung an zwei Stellen im Programm, und die eine liefe der anderen davon.
 */
export function entsperreSitzung(kennung: string | undefined): boolean {
  if (!kennung) return false;
  const gesucht = hashe(kennung);
  const sitzung = lesen().find((s) => s.kennungHash === gesucht);
  if (!sitzung) return false;
  delete sitzung.gesperrtSeit;
  sitzung.zuletztGenutzt = Date.now();
  schreiben();
  return true;
}

/** Sperrt jede Sitzung eines Nutzers - für "überall sperren". */
export function sperreAlleSitzungen(nutzerId: string): number {
  const jetzt = Date.now();
  let gesperrt = 0;
  for (const s of lesen()) {
    if (s.nutzerId === nutzerId && !s.gesperrtSeit) {
      s.gesperrtSeit = jetzt;
      gesperrt += 1;
    }
  }
  if (gesperrt > 0) schreiben();
  return gesperrt;
}

export function beendeSitzung(kennung: string | undefined): void {
  if (!kennung) return;
  const gesucht = hashe(kennung);
  const vorher = lesen().length;
  geladen = lesen().filter((s) => s.kennungHash !== gesucht);
  if (geladen.length !== vorher) schreiben();
}

/** Meldet einen Nutzer überall ab - nach Kennwortwechsel oder auf Verlangen. */
export function beendeAlleSitzungen(nutzerId: string): number {
  const vorher = lesen().length;
  geladen = lesen().filter((s) => s.nutzerId !== nutzerId);
  const weg = vorher - geladen.length;
  if (weg > 0) schreiben();
  return weg;
}

/** Nur für Prüfungen: den Zwischenspeicher vergessen. */
export function vergissSitzungen(): void {
  geladen = null;
}
