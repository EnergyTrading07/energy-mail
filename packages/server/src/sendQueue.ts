import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getNutzerDir } from './paths.js';
import { liesGeschuetzt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { jeNutzer } from './nutzer/jeNutzer.js';
import { istVerbindungsfehler } from './verbindungsfehler.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Warteschlange für ausgehende Nachrichten.
 *
 * Deckt zwei Dinge mit einem Mechanismus ab: die kurze Bedenkzeit nach dem Absenden
 * ("Rückgängig") und das geplante Senden zu einem späteren Zeitpunkt. Beides ist
 * dasselbe - eine Nachricht, die noch nicht raus ist und noch zurückgeholt werden kann.
 *
 * Auf Platte gehalten, damit ein für morgen früh geplanter Versand einen Neustart
 * übersteht. Was beim Start bereits fällig ist, geht sofort raus.
 *
 * Die Grenze der Sache ist offen zu benennen: gesendet wird nur, solange die Anwendung
 * läuft. Ist sie zum geplanten Zeitpunkt zu, geht die Nachricht beim nächsten Start
 * hinaus - nicht zur geplanten Minute. Anders ginge es nur mit einem Dienst, der
 * durchgehend läuft, und den gibt es hier bewusst nicht.
 */

export interface GeplanteSendung {
  id: string;
  accountId: string;
  /** Zeitpunkt, ab dem gesendet werden soll. */
  faellig: number;
  /** Der Nachrichtenkörper, wie ihn die Oberfläche geschickt hat (mit base64-Anhängen). */
  koerper: Record<string, unknown>;
  /** Nur zur Anzeige in der Rückgängig-Meldung. */
  betreff: string;
  empfaenger: string[];
  /** Wie oft der Versand schon fehlgeschlagen ist. Fehlt bei allem, was vorher entstand. */
  versuche?: number;
  /** Grund des letzten Fehlschlags - für die Anzeige in der Wartend-Liste. */
  letzterFehler?: string;
}

const getPfad = () => path.join(getNutzerDir(), 'sendungen.json');

/**
 * Warteschlange und Zeitgeber JE NUTZER.
 *
 * Vorher zwei prozessglobale Maps. Der Nutzerkontext schaltete nur die Datei um: die
 * Sendungen zweier Nutzer lagen im selben Speicher, und speichern() schrieb die
 * vermischte Menge in die Datei dessen, der gerade dran war - fremde Entwürfe samt
 * Empfängern und Anhängen in einer fremden Datei.
 *
 * Ausdrücklich OHNE Obergrenze: fiele ein Eintrag heraus, verschwänden mit ihm die
 * Zeitgeber, und eine für morgen früh geplante Nachricht ginge nie hinaus. Die Menge ist
 * klein - es sind wartende Sendungen, keine Nachrichtenbestände.
 */
interface NutzerWarteschlange {
  geplant: Map<string, GeplanteSendung>;
  timer: Map<string, ReturnType<typeof setTimeout>>;
}

const warteschlangen = jeNutzer<NutzerWarteschlange>(() => ({
  geplant: new Map(),
  timer: new Map(),
}));

const geplantVon = () => warteschlangen.hole().geplant;
const timerVon = () => warteschlangen.hole().timer;

let senden: ((sendung: GeplanteSendung) => Promise<void>) | null = null;
let log: (msg: string) => void = () => {};

/**
 * Hinterlegt, wie tatsächlich gesendet wird. Getrennt, weil das Versenden die Konten und
 * das Anhängen von Dateien kennt - beides gehört nicht in die Warteschlange.
 */
export function setSendeVerfahren(
  fn: (sendung: GeplanteSendung) => Promise<void>,
  logger: (msg: string) => void,
): void {
  senden = fn;
  log = logger;
}

function speichern(): void {
  try {
    schreibeGeschuetzt(getPfad(), JSON.stringify([...geplantVon().values()], null, 2));
  } catch (err) {
    log(`Geplante Sendungen konnten nicht gesichert werden: ${(err as Error).message}`);
  }
}

/** Wie oft ein vorübergehender Fehler wiederholt wird, bevor aufgegeben wird. */
const MAX_VERSUCHE = 5;

/**
 * Fehlendes Netz zählt anders - dieselbe Unterscheidung wie bei der Wiedervorlage.
 *
 * Fünf Versuche sind in gut anderthalb Stunden aufgebraucht. Wer abends auf "senden für
 * morgen früh" drückt und über Nacht kein Netz hat, hätte seine Nachricht damit verloren,
 * obwohl an ihr nichts falsch ist. Ein Verbindungsfehler geht vorüber; eine abgewiesene
 * Adresse tut es nicht. Zwanzig Versuche mit dem gedeckelten Abstand tragen über rund
 * siebzehn Stunden - lange genug für eine Nacht, eine Zugfahrt oder einen Umzug.
 */
const MAX_VERSUCHE_OHNE_NETZ = 20;

/** Abstände zwischen den Versuchen - wachsend, damit ein toter Server nicht bestürmt wird. */
const ABSTAENDE_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

async function ausfuehren(id: string): Promise<void> {
  const sendung = geplantVon().get(id);
  if (!sendung || !senden) return;

  timerVon().delete(id);

  /*
   * Erst senden, dann aus der Warteschlange nehmen.
   *
   * Vorher stand es andersherum: delete + speichern liefen VOR dem Sendeversuch. Schlug
   * er fehl, war der Nachrichtenkörper weg - der catch protokollierte nur. Wer auf
   * "Senden" drückte, gleich darauf das Programm schloss und dabei kein Netz hatte,
   * verlor die Nachricht ersatzlos, ohne Entwurf und ohne Meldung.
   *
   * Die alte Begründung (bei dauerhaft falscher Adresse liefe die Nachricht endlos im
   * Kreis) war richtig, warf aber den vorübergehenden Fehler mit dem dauerhaften in
   * einen Topf. Der Zähler unten trennt beide: fünf Versuche mit wachsendem Abstand,
   * danach wird aufgegeben - aber sichtbar und mit Grund.
   */
  try {
    await senden(sendung);
    geplantVon().delete(id);
    speichern();
    log(`Geplante Nachricht "${sendung.betreff}" versendet.`);
  } catch (err) {
    const versuche = (sendung.versuche ?? 0) + 1;
    const grund = (err as Error).message;
    const grenze = istVerbindungsfehler(err) ? MAX_VERSUCHE_OHNE_NETZ : MAX_VERSUCHE;

    if (versuche >= grenze) {
      /*
       * Aufgeben heißt NICHT wegwerfen.
       *
       * Gelöscht wird der Eintrag erst, wenn der Körper nachweislich woanders liegt - als
       * Entwurf im Postfach. Vorher stand hier ein `delete` und daneben ein Aufruf, den
       * niemand entgegennahm: `setAufgabeVerfahren` war geschrieben, exportiert und
       * dokumentiert, aber nirgends im Programm gesetzt. `aufgegeben` blieb damit für
       * immer null, der Aufruf war ein Nichts, und die Nachricht verschwand nach dem
       * fünften Versuch ersatzlos - genau der Verlust, den der Kommentar weiter oben als
       * behoben beschreibt.
       *
       * Misslingt auch das Ablegen, bleibt der Eintrag in der Warteschlange und wird
       * weiter versucht. Das kann bei einer dauerhaft unzustellbaren Adresse lange
       * dauern, aber es verliert nichts: Sobald wieder eine Verbindung steht, greift
       * entweder der Versand oder die Rettung als Entwurf, und beides beendet die Sache.
       */
      const gerettet = aufgegeben ? await aufgegeben(sendung, grund).catch(() => false) : false;
      if (gerettet) {
        geplantVon().delete(id);
        speichern();
        log(
          `Geplante Nachricht "${sendung.betreff}" wurde nach ${versuche} Versuchen aufgegeben ` +
            `und als Entwurf abgelegt: ${grund}`,
        );
        return;
      }
      log(
        `Geplante Nachricht "${sendung.betreff}" ging nach ${versuche} Versuchen nicht hinaus ` +
          `und ließ sich auch nicht als Entwurf ablegen: ${grund}. Sie bleibt in der ` +
          'Warteschlange, damit sie nicht verlorengeht.',
      );
    }

    sendung.versuche = versuche;
    sendung.letzterFehler = grund;
    sendung.faellig = Date.now() + (ABSTAENDE_MS[versuche - 1] ?? 60 * 60_000);
    geplantVon().set(id, sendung);
    speichern();
    planen(sendung);
    log(
      `Geplante Nachricht "${sendung.betreff}" ging nicht hinaus (Versuch ${versuche}): ${grund}. ` +
        'Wird erneut versucht.',
    );
  }
}

/**
 * Wird gerufen, wenn eine Sendung endgültig nicht hinausgeht - der Aufrufer legt sie als
 * Entwurf ab.
 *
 * Die Antwort ist `true`, wenn der Körper sicher woanders liegt. Nur dann verschwindet er
 * hier. Ein blosses `void` genügte nicht: Der häufigste Grund, warum ein Versand endgültig
 * scheitert, ist ein fehlendes Netz - und dann scheitert auch das Ablegen des Entwurfs,
 * denn der Entwürfe-Ordner liegt beim selben Anbieter.
 */
let aufgegeben: ((sendung: GeplanteSendung, grund: string) => Promise<boolean>) | null = null;

export function setAufgabeVerfahren(
  fn: (sendung: GeplanteSendung, grund: string) => Promise<boolean>,
): void {
  aufgegeben = fn;
}

/**
 * Node kann höchstens 2^31-1 Millisekunden warten - etwa 24,8 Tage.
 *
 * Wird mehr übergeben, wartet setTimeout nicht länger, sondern feuert SOFORT. Eine auf
 * den nächsten Quartalsanfang geplante Nachricht ging damit unmittelbar hinaus, ohne
 * Fehlermeldung und ohne dass irgendwo etwas falsch aussah.
 */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

function planen(sendung: GeplanteSendung): void {
  const wartezeit = Math.max(0, sendung.faellig - Date.now());
  // Über der Grenze in Etappen: der Zeitgeber plant sich selbst neu, bis die Restzeit
  // klein genug ist.
  const dieseEtappe = Math.min(wartezeit, MAX_TIMEOUT_MS);
  const t = setTimeout(() => {
    if (Date.now() < sendung.faellig) {
      planen(sendung);
      return;
    }
    void ausfuehren(sendung.id);
  }, dieseEtappe);
  // Ein wartender Versand soll die Anwendung nicht am Beenden hindern - beim Beenden
  // wird ohnehin alles Ausstehende abgeschickt.
  t.unref?.();
  timerVon().set(sendung.id, t);
}

/** Lädt Ausstehendes beim Start und schickt ab, was bereits fällig ist. */
export function ladeGeplanteSendungen(): void {
  const befund = liesGeschuetzt<unknown>(getPfad(), []);
  if (befund.beschaedigt) {
    log(
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).` +
        (befund.beschaedigt.beiseite ? ` Beiseite gelegt: ${befund.beschaedigt.beiseite}` : ''),
    );
  }

  /*
   * Form prüfen statt sie zu behaupten.
   *
   * Vorher umfasste das try nur Lesen und Parsen. Enthielt die Datei gültiges JSON, das
   * aber kein Array war - etwa "{}" nach einem abgebrochenen Schreibvorgang -, warf das
   * anschließende for...of AUSSERHALB des catch, und zwar beim Serverstart. Eine
   * beschädigte Datei konnte damit den Start des ganzen Programms verhindern.
   *
   * Ebenso die Einträge selbst: ein Eintrag ohne "faellig" ergab Math.max(0, NaN) = NaN,
   * und setTimeout(fn, NaN) feuert sofort - der Versand lief dann mit Unfug los.
   */
  const roh = Array.isArray(befund.wert) ? (befund.wert as unknown[]) : [];
  const gespeichert = roh.filter((s): s is GeplanteSendung => {
    const e = s as Partial<GeplanteSendung> | null;
    return Boolean(
      e &&
        typeof e === 'object' &&
        typeof e.id === 'string' &&
        typeof e.accountId === 'string' &&
        Number.isFinite(e.faellig) &&
        e.koerper &&
        typeof e.koerper === 'object',
    );
  });
  if (gespeichert.length < roh.length) {
    log(`${roh.length - gespeichert.length} unbrauchbare Einträge in sendungen.json übergangen.`);
  }

  for (const sendung of gespeichert) {
    geplantVon().set(sendung.id, sendung);
    planen(sendung);
  }
  if (gespeichert.length > 0) {
    const faellig = gespeichert.filter((s) => s.faellig <= Date.now()).length;
    log(
      `${gespeichert.length} geplante Nachricht(en) geladen` +
        (faellig > 0 ? `, davon ${faellig} überfällig - gehen jetzt raus.` : '.'),
    );
  }
}

export function planeSendung(
  accountId: string,
  koerper: Record<string, unknown>,
  faellig: number,
): GeplanteSendung {
  const sendung: GeplanteSendung = {
    id: randomUUID(),
    accountId,
    faellig,
    koerper,
    betreff: String(koerper.subject ?? t('(kein Betreff)')),
    empfaenger: Array.isArray(koerper.to) ? (koerper.to as string[]) : [],
  };
  geplantVon().set(sendung.id, sendung);
  speichern();
  planen(sendung);
  return sendung;
}

/** Holt eine Nachricht zurück und liefert sie heraus - zum Weiterbearbeiten. */
export function storniereSendung(id: string): GeplanteSendung | null {
  const sendung = geplantVon().get(id);
  if (!sendung) return null;
  clearTimeout(timerVon().get(id));
  timerVon().delete(id);
  geplantVon().delete(id);
  speichern();
  return sendung;
}

/**
 * Beim Entfernen eines Kontos gehen auch seine vorgemerkten Sendungen.
 *
 * Zurückgegeben wird, was dabei wegfällt - und das ist keine Höflichkeit gegenüber dem
 * Aufrufer, sondern der Grund dieser Bauart: Hier verschwinden Nachrichtenkörper, die
 * niemand mehr versenden kann, weil es das absendende Postfach nicht mehr gibt. Sie
 * anderswohin zu retten, geht nicht - ein Entwürfe-Ordner braucht dasselbe Konto. Also
 * wird wenigstens benannt, was verlorengeht, statt es still zu tun.
 */
export function verwerfeKontoSendungen(accountId: string): GeplanteSendung[] {
  const geplant = geplantVon();
  const zeitgeber = timerVon();
  const weg: GeplanteSendung[] = [];
  for (const [id, sendung] of [...geplant]) {
    if (sendung.accountId !== accountId) continue;
    clearTimeout(zeitgeber.get(id));
    zeitgeber.delete(id);
    geplant.delete(id);
    weg.push(sendung);
  }
  if (weg.length > 0) speichern();
  return weg;
}

export function listeGeplanteSendungen(accountId?: string): GeplanteSendung[] {
  return [...geplantVon().values()]
    .filter((s) => !accountId || s.accountId === accountId)
    .sort((a, b) => a.faellig - b.faellig);
}

/**
 * Schickt alles Ausstehende sofort ab - beim Beenden der Anwendung.
 *
 * Ohne das ginge eine Nachricht, die gerade in der Bedenkzeit steht, beim Schließen
 * verloren: der Nutzer hat auf "Senden" gedrückt und nichts widerrufen, also ist sie
 * gewollt. Für weit in der Zukunft geplante gilt das nicht - die bleiben liegen.
 */
export async function sendeAusstehendeSofort(): Promise<number> {
  const gleich = [...geplantVon().values()].filter((s) => s.faellig - Date.now() < 5 * 60_000);
  for (const sendung of gleich) {
    clearTimeout(timerVon().get(sendung.id));
    await ausfuehren(sendung.id);
  }
  return gleich.length;
}
