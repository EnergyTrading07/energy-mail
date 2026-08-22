import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { kuerzeIpAdresse } from '@energy-mail/mail-core/protokoll';
import { t } from '@energy-mail/mail-core/sprache';
import { liesJson, schreibeAtomar } from '../atomar.js';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';
import { SystemmailFehler, sendeSystemmail, systemmailEingerichtet } from '../systemmail.js';
import { oeffentlicheAdressen } from '../zugang.js';
import { zaehleVersuch } from './anmeldebremse.js';
import { EINPLATZ_NUTZER } from './kontext.js';
import {
  KENNWORT_MINDESTLAENGE,
  NutzerFehler,
  findeNutzerNachEmail,
  hatZweiFaktor,
  setzeKennwort,
  type Nutzer,
} from './nutzerStore.js';
import { beendeAlleSitzungen } from './sitzung.js';

/**
 * Der Weg zurück, wenn jemand sein Kennwort vergessen hat.
 *
 * ## Warum es das erst jetzt gibt
 *
 * Solange ein Verwalter jedes Konto anlegte, war er auch der Weg zurück: Er setzt das
 * Kennwort zurück und gibt es weiter. Das trägt, solange die Nutzer im selben Haus sitzen.
 * Sobald sich Menschen selbst anmelden, trägt es nicht mehr - sie werden ihre Kennwörter
 * genauso selbst vergessen, und ein Dienst, der dafür einen Menschen braucht, hat an
 * dieser Stelle einen Flaschenhals mit Feierabend.
 *
 * ## Was dieser Weg NICHT tut, und das ist der wichtigste Absatz
 *
 * **Er rührt den zweiten Faktor nicht an.** Wer sein Kennwort hierüber neu setzt, wird
 * beim Anmelden weiterhin nach seinem Code gefragt. Das ist keine Nachlässigkeit, sondern
 * der ganze Sinn eines zweiten Faktors: Er soll gerade den Fall abdecken, dass jemand an
 * das Kennwort gekommen ist. Ein Weg, der beides zugleich zurücksetzt, wäre eine Tür, die
 * ausgerechnet die Vorsichtigen trifft - es genügte, einmal an ihr Postfach zu kommen.
 *
 * Wer sein Telefon verloren hat, geht deshalb weiterhin zum Verwalter. Der kann den Faktor
 * abräumen, es steht als Warnung im Protokoll, und ein Mensch hat entschieden.
 *
 * **Er meldet niemanden an.** Am Ende steht das Anmeldefenster, nicht das Postfach - aus
 * demselben Grund wie bei der Registrierung: Der Link liegt in einem Postfach, und wer
 * darauf Zugriff hat, ist nicht zwangsläufig der Kontoinhaber.
 *
 * ## Und was er mitnimmt
 *
 * Alle offenen Sitzungen. Wer sein Kennwort zurücksetzt, tut das oft, weil er den Verdacht
 * hat, dass es jemand kennt - bliebe eine fremde Sitzung offen, wäre der Wechsel
 * wirkungslos. Dieselbe Regel gilt schon beim selbst geänderten Kennwort.
 */

interface Kennwortmarke {
  /** sha256 der Marke - die Marke selbst steht nach dem Versand nirgends. */
  markeHash: string;
  nutzerId: string;
  bis: number;
}

type Ablage = { marken?: Kennwortmarke[] };

const getPfad = () => path.join(getWurzelDir(), 'kennwortmarken.json');

/**
 * Wie lange eine Marke gilt: eine Stunde.
 *
 * Deutlich kürzer als die vierundzwanzig der Registrierung, und der Unterschied hat einen
 * Grund. Eine Bestätigungsmarke eröffnet ein Konto, das es noch nicht gibt; diese hier
 * öffnet ein Konto, das es GIBT - mit Post darin, mit hinterlegten Zugangsdaten. Wer sein
 * Kennwort vergessen hat, sieht in den nächsten Minuten in sein Postfach; er braucht dafür
 * keinen Tag.
 */
const MARKE_GUELTIG_MS = 60 * 60 * 1000;

/** Damit ein Fehler oder ein Angriff die Datei nicht endlos wachsen lässt. */
const MAX_MARKEN = 2000;

let geladen: Kennwortmarke[] | null = null;

function lesen(): Kennwortmarke[] {
  if (geladen) return geladen;
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    /*
     * Kaputt heißt hier: Alle laufenden Zurücksetzungen sind hinfällig, und das ist die
     * richtige Richtung. Eine Marke, die aus einer beschädigten Datei stammt, sollte kein
     * Kennwort öffnen dürfen - der Betroffene fordert eine neue an und verliert eine
     * Minute.
     */
    protokolliere(
      'warnung',
      'kennwort',
      `${befund.beschaedigt.pfad} war unlesbar - laufende Zurücksetzungen gelten nicht mehr.`,
    );
  }
  geladen = Array.isArray(befund.wert?.marken) ? befund.wert.marken : [];
  return geladen;
}

function schreiben(): void {
  try {
    schreibeAtomar(getPfad(), JSON.stringify({ marken: geladen ?? [] }, null, 2));
  } catch (err) {
    protokolliere('warnung', 'kennwort', `Marken nicht gesichert: ${(err as Error).message}`);
  }
}

function hashe(marke: string): string {
  return crypto.createHash('sha256').update(marke).digest('hex');
}

function gueltige(jetzt: number): Kennwortmarke[] {
  const uebrig = lesen().filter((m) => m.bis > jetzt);
  if (uebrig.length > MAX_MARKEN) {
    uebrig.sort((a, b) => b.bis - a.bis);
    uebrig.length = MAX_MARKEN;
  }
  return uebrig;
}

/**
 * Entwertet alle Marken eines Nutzers.
 *
 * ## Warum das an DREI Stellen gerufen werden muss
 *
 * Weil eine Marke sonst ein Kennwort überschreibt, das inzwischen jemand anderes gesetzt
 * hat. Der Angriff ist nicht theoretisch und er ist einfach:
 *
 *  1. Der Angreifer fordert eine Zurücksetzung für ein fremdes Konto an. Er kommt an die
 *     Mail nicht heran - die Marke ist für ihn wertlos, noch.
 *  2. Der Kontoinhaber merkt etwas, wundert sich und ändert sein Kennwort. Er hält die
 *     Sache damit für erledigt.
 *  3. Kommt der Angreifer später doch an die alte Mail - ein geteiltes Postfach, eine
 *     Sicherung, ein Gerät, das herumliegt -, setzt die Marke das frische Kennwort wieder
 *     außer Kraft.
 *
 * Deshalb: Jeder Kennwortwechsel entwertet, was noch offensteht. Gerufen wird das beim
 * eigenen Wechsel (anmelden.ts), beim Zurücksetzen durch einen Verwalter (verwaltung.ts)
 * und hier selbst.
 */
export function entwerteKennwortmarken(nutzerId: string): void {
  const vorher = lesen();
  const uebrig = vorher.filter((m) => m.nutzerId !== nutzerId);
  if (uebrig.length === vorher.length) return;
  geladen = uebrig;
  schreiben();
}

/** Nur für Prüfungen: den Zwischenspeicher vergessen - wie ein Neustart des Servers. */
export function vergissKennwortmarken(): void {
  geladen = null;
}

/**
 * Was auf eine Anfrage hin zu tun ist.
 *
 * Die drei Ausgänge unterscheiden sich in der MAIL, die hinausgeht - nicht in der Antwort
 * an den Browser. Die ist immer dieselbe; sonst wäre dieses Formular ein Werkzeug, mit dem
 * sich durchprobieren lässt, wer an diesem Dienst ein Konto hat.
 */
export type Zuruecksetzung =
  /** Es gibt ein Konto, und der Weg steht offen. Die Marke geht genau einmal hinaus. */
  | { art: 'marke'; nutzer: Nutzer; marke: string }
  /** Es gibt ein Konto, aber es ist gesperrt - hier hilft nur der Betreiber. */
  | { art: 'gesperrt'; email: string }
  /** Es gibt kein Konto zu dieser Adresse. */
  | { art: 'unbekannt'; email: string };

/**
 * Nimmt eine Anfrage entgegen und legt - wenn angebracht - eine Marke an.
 *
 * ## Warum in ALLEN drei Fällen eine Mail hinausgeht
 *
 * Das sieht auf den ersten Blick nach Verschwendung aus und ist zweierlei zugleich.
 *
 * Erstens der **Zeitkanal**: Ein Mailversand dauert eine Verbindung lang, ein Blick in
 * eine Liste nicht. Ginge nur im Erfolgsfall eine Mail hinaus, wäre die Antwortzeit die
 * Auskunft, die die immer gleiche Antwort gerade verbergen soll.
 *
 * Zweitens **für den Menschen**: Wer sich mit der falschen Adresse versucht hat -
 * dienstlich statt privat, alter Arbeitgeber, Tippfehler -, sitzt sonst vor einem
 * Postfach und wartet auf Post, die nie kommt. Eine Zeile "hier gibt es kein Konto" spart
 * ihm den Anruf.
 *
 * Missbrauch ist dadurch nicht möglich: Wer eine fremde Adresse einträgt, löst genau eine
 * kurze Nachricht aus, und die Bremse am Anschluss begrenzt das auf wenige je Stunde.
 */
export function fordereZuruecksetzung(email: string): Zuruecksetzung {
  const gesucht = email.trim().toLowerCase();
  const nutzer = findeNutzerNachEmail(gesucht);

  /*
   * Der Einplatznutzer der Hülle kommt nicht in Frage.
   *
   * Sein Kennwort sind vierundzwanzig zufällige Bytes, die nie jemand zu sehen bekommt -
   * angemeldet wird sich dort über das Zugangsgeheimnis des Prozesses. Ein Weg, der es
   * zurücksetzen kann, wäre eine Tür in ein Konto, das gar keine haben soll; seine Adresse
   * (lokal@energy-mail.local) ist obendrein bekannt und steht im Quelltext.
   */
  if (!nutzer || nutzer.id === EINPLATZ_NUTZER) return { art: 'unbekannt', email: gesucht };
  if (nutzer.gesperrt) return { art: 'gesperrt', email: gesucht };

  const jetzt = Date.now();
  /*
   * Eine Marke je Nutzer, nicht mehr.
   *
   * Wer zehnmal auf "Kennwort vergessen" klickt, hat sonst zehn gültige Schlüssel in zehn
   * Mails liegen - jeder davon eine Stunde lang brauchbar, und jeder ein eigener Weg, auf
   * dem einer davon abhandenkommen kann. Die neue ersetzt die alte; die letzte Mail ist
   * die, die gilt.
   */
  const uebrig = gueltige(jetzt).filter((m) => m.nutzerId !== nutzer.id);
  const marke = crypto.randomBytes(32).toString('base64url');
  uebrig.push({ markeHash: hashe(marke), nutzerId: nutzer.id, bis: jetzt + MARKE_GUELTIG_MS });

  geladen = uebrig;
  schreiben();
  protokolliere('info', 'kennwort', `Zurücksetzung für "${nutzer.id}" angefordert.`);
  return { art: 'marke', nutzer, marke };
}

/**
 * Löst eine Marke ein und gibt den Nutzer zurück - oder `null`.
 *
 * Die Marke ist danach verbraucht, und zwar in jedem Fall. Ein zweiter Aufruf findet
 * nichts: Der Link liegt in einem Postfach, und was dort liegt, wird später womöglich von
 * jemand anderem gelesen.
 */
export function loeseKennwortmarke(marke: string): string | null {
  if (typeof marke !== 'string' || marke.length < 20) return null;
  const jetzt = Date.now();
  const gesucht = hashe(marke);
  const eintrag = gueltige(jetzt).find((m) => m.markeHash === gesucht);
  if (!eintrag) return null;

  // Alle Marken dieses Nutzers gehen mit - nicht nur die eingelöste.
  geladen = gueltige(jetzt).filter((m) => m.nutzerId !== eintrag.nutzerId);
  schreiben();
  return eintrag.nutzerId;
}

/**
 * Ob dieser Weg überhaupt angeboten werden darf.
 *
 * Ohne Systemversand gibt es keine Mail und damit keinen Nachweis - dann bleibt es beim
 * Verwalter, der zurücksetzt. Die Oberfläche fragt das ab, bevor sie den Link anzeigt: Ein
 * "Kennwort vergessen?", das in eine Fehlermeldung führt, ist schlimmer als keines.
 */
export function zuruecksetzenMoeglich(): boolean {
  return systemmailEingerichtet();
}

// --- Die Wege ---

/**
 * Zwei Wege, beide ohne Anmeldung erreichbar - notwendigerweise: Wer sein Kennwort nicht
 * mehr weiss, kann sich nicht erst anmelden.
 *
 * Damit stehen sie neben der Registrierung an der am staerksten ausgesetzten Stelle des
 * Servers, und sie tragen dieselben drei Vorkehrungen: eine Bremse am Anschluss, eine
 * einzige Antwort fuer alle Ausgaenge und einen kleinen Rumpf.
 */

/** Adresse oder Marke samt neuem Kennwort - mehr passt hier nicht hinein. */
const RUMPF_MAX = 4 * 1024;

/**
 * Wie oft von einem Anschluss aus eine Zuruecksetzung angefordert werden darf.
 *
 * Drei in der Stunde. Noch enger als bei der Registrierung, und das mit Grund: Jede
 * Anfrage loest eine Mail an eine Adresse aus, die der Anfragende bestimmt. Ein Mensch,
 * der sein Kennwort vergessen hat, braucht einen Versuch; wer drei braucht, hat ein
 * anderes Problem als die Bremse.
 */
const ANFRAGE_MAX = 3;
const ANFRAGE_FENSTER_MS = 60 * 60 * 1000;

/** Und wie oft eine Marke eingeloest werden darf: zehnmal in der Stunde. */
const EINLOESEN_MAX = 10;
const EINLOESEN_FENSTER_MS = 60 * 60 * 1000;

/**
 * Der Link mit der Marke.
 *
 * Dieselben zwei Regeln wie beim Bestaetigungslink der Registrierung, und dort stehen sie
 * ausfuehrlich: Die Adresse kommt aus der Einrichtung des Betreibers und niemals aus der
 * Anfrage (sonst schickte der eigene Server einem Fremden einen Link auf den Rechner des
 * Angreifers), und die Marke steht hinter dem Doppelkreuz, damit sie in keinem
 * Zugriffsprotokoll und in keiner Referrer-Kopfzeile landet.
 */
function kennwortLink(marke: string): string | null {
  const basis = oeffentlicheAdressen()[0];
  if (!basis) return null;
  return `${basis}/#kennwort=${encodeURIComponent(marke)}`;
}

async function sendeMarke(email: string, marke: string, mitZweiFaktor: boolean): Promise<void> {
  const link = kennwortLink(marke);
  if (!link) {
    throw new SystemmailFehler(
      'Für diesen Dienst ist keine öffentliche Adresse eingerichtet ' +
        '(ENERGY_MAIL_OEFFENTLICHE_ADRESSE) - ohne sie lässt sich kein Link bauen.',
    );
  }

  await sendeSystemmail({
    an: email,
    betreff: t('Neues Kennwort für Energy Mail'),
    text:
      t('Guten Tag,') +
      '\n\n' +
      t('für dieses Konto wurde ein neues Kennwort angefordert. Mit diesem Link vergeben Sie eines:') +
      '\n\n' +
      link +
      '\n\n' +
      t('Der Link gilt eine Stunde und lässt sich nur einmal verwenden.') +
      '\n\n' +
      (mitZweiFaktor
        ? t('Ihr zweiter Faktor bleibt unverändert - Sie werden beim Anmelden weiterhin nach Ihrem Code gefragt.') +
          '\n\n'
        : '') +
      t('Waren Sie das nicht? Dann tun Sie bitte nichts. Ohne diesen Link ändert sich an Ihrem Kennwort nichts, und der Link verfällt von selbst.') +
      '\n',
  });
}

async function sendeGesperrt(email: string): Promise<void> {
  await sendeSystemmail({
    an: email,
    betreff: t('Neues Kennwort für Energy Mail'),
    text:
      t('Guten Tag,') +
      '\n\n' +
      t('für dieses Konto wurde ein neues Kennwort angefordert. Der Zugang ist allerdings gesperrt - ein neues Kennwort würde daran nichts ändern.') +
      '\n\n' +
      t('Bitte wenden Sie sich an den Betreiber dieses Dienstes.') +
      '\n',
  });
}

async function sendeUnbekannt(email: string): Promise<void> {
  await sendeSystemmail({
    an: email,
    betreff: t('Neues Kennwort für Energy Mail'),
    text:
      t('Guten Tag,') +
      '\n\n' +
      t('für diese Adresse wurde ein neues Kennwort angefordert. Zu ihr besteht hier allerdings kein Zugang - möglicherweise haben Sie eine andere Adresse verwendet.') +
      '\n\n' +
      t('Waren Sie das nicht, brauchen Sie nichts zu tun. Es wurde nichts angelegt und nichts gespeichert.') +
      '\n',
  });
}

export function registriereKennwortVergessen(app: FastifyInstance): void {
  /**
   * Ein neues Kennwort anfordern.
   *
   * Die Antwort ist fuer alle drei Ausgaenge dieselbe - siehe fordereZuruecksetzung().
   * Unterschiedlich ist nur die Mail, und die bekommt allein zu sehen, wer die Adresse
   * tatsaechlich abrufen kann.
   */
  app.post<{ Body: { email?: string } }>(
    '/kennwort/vergessen',
    { bodyLimit: RUMPF_MAX },
    async (request, reply) => {
      if (!zuruecksetzenMoeglich()) {
        /*
         * Ohne Systemversand gibt es diesen Weg nicht - und das wird gesagt, statt eine
         * Mail zu versprechen, die nie kommt. Es ist keine Auskunft ueber einen Menschen,
         * sondern eine ueber die Einrichtung dieses Dienstes; dieselbe steht ohnehin in
         * GET /registrierung.
         */
        return reply.code(503).send({
          error: t('An diesem Dienst lässt sich das Kennwort nicht selbst zurücksetzen. Bitte wenden Sie sich an den Betreiber.'),
        });
      }

      if (!zaehleVersuch('kennwort-vergessen', request.ip, ANFRAGE_MAX, ANFRAGE_FENSTER_MS)) {
        protokolliere(
          'warnung',
          'kennwort',
          `Zu viele Anfragen aus ${kuerzeIpAdresse(request.ip)}.`,
        );
        return reply.code(429).send({
          error: t('Zu viele Versuche von dieser Verbindung. Bitte in einer Stunde noch einmal probieren.'),
        });
      }

      const email = typeof request.body?.email === 'string' ? request.body.email : '';
      if (!email.includes('@')) {
        return reply.code(400).send({ error: t('Das ist keine brauchbare Mailadresse.') });
      }

      const befund = fordereZuruecksetzung(email);
      try {
        if (befund.art === 'marke') {
          await sendeMarke(befund.nutzer.email, befund.marke, Boolean(befund.nutzer.zweiFaktor?.seit));
        } else if (befund.art === 'gesperrt') {
          await sendeGesperrt(befund.email);
        } else {
          await sendeUnbekannt(befund.email);
        }
      } catch (err) {
        /*
         * Misslingt der Versand, muss die Marke wieder weg: Sonst laege ein Schluessel in
         * der Datei, zu dem es nie eine Mail gab - eine Stunde lang, ohne dass jemand ihn
         * je bekommen hat.
         */
        if (befund.art === 'marke') entwerteKennwortmarken(befund.nutzer.id);
        protokolliere('fehler', 'kennwort', `Nachricht nicht versandt: ${(err as Error).message}`);
        return reply.code(502).send({
          error: t('Die Nachricht konnte nicht verschickt werden. Bitte wenden Sie sich an den Betreiber dieses Dienstes.'),
        });
      }

      return { ok: true as const };
    },
  );

  /**
   * Das neue Kennwort setzen.
   *
   * Angemeldet wird hier ausdruecklich nicht. Und der zweite Faktor bleibt, wie er war -
   * die Begruendung steht oben im Kopf dieser Datei und ist der wichtigste Satz darin.
   */
  app.post<{ Body: { marke?: string; kennwort?: string } }>(
    '/kennwort/neu',
    { bodyLimit: RUMPF_MAX },
    async (request, reply) => {
      if (!zaehleVersuch('kennwort-neu', request.ip, EINLOESEN_MAX, EINLOESEN_FENSTER_MS)) {
        return reply.code(429).send({
          error: t('Zu viele Versuche von dieser Verbindung. Bitte in einer Stunde noch einmal probieren.'),
        });
      }

      const marke = typeof request.body?.marke === 'string' ? request.body.marke : '';
      const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';

      /*
       * Erst das Kennwort pruefen, dann die Marke einloesen.
       *
       * Die Reihenfolge zaehlt: Die Marke ist nach dem Einloesen verbraucht. Waere sie
       * schon weg, wenn das neue Kennwort zu kurz ist, muesste der Mensch eine neue
       * anfordern - fuer einen Tippfehler.
       */
      if (kennwort.length < KENNWORT_MINDESTLAENGE) {
        return reply.code(400).send({
          error: t('Das Kennwort muss mindestens {anzahl} Zeichen haben.', {
            anzahl: KENNWORT_MINDESTLAENGE,
          }),
        });
      }

      const nutzerId = loeseKennwortmarke(marke);
      if (!nutzerId) {
        return reply.code(400).send({
          error: t('Dieser Link gilt nicht mehr. Fordern Sie bitte einen neuen an.'),
        });
      }

      try {
        setzeKennwort(nutzerId, kennwort);
      } catch (err) {
        if (err instanceof NutzerFehler) return reply.code(400).send({ error: err.message });
        throw err;
      }

      /*
       * Ueberall abmelden. Wer sein Kennwort zuruecksetzt, tut das oft, weil er den
       * Verdacht hat, dass es jemand kennt - bliebe eine fremde Sitzung offen, waere der
       * Wechsel wirkungslos.
       */
      const abgemeldet = beendeAlleSitzungen(nutzerId);
      protokolliere(
        'warnung',
        'kennwort',
        `"${nutzerId}" hat sein Kennwort über einen Link neu gesetzt, ${abgemeldet} Sitzung(en) beendet.`,
      );

      return { ok: true as const, zweiFaktor: hatZweiFaktor(nutzerId) };
    },
  );
}
