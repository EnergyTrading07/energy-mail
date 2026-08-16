import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { kuerzeIpAdresse } from '@energy-mail/mail-core/protokoll';
import { t } from '@energy-mail/mail-core/sprache';
import { protokolliere } from '../protokollDatei.js';
import { handelnderNutzer } from './kontext.js';
import {
  NutzerFehler,
  alleNutzer,
  entferneNutzer,
  entferneZweiFaktor,
  findeNutzer,
  istVerwalter,
  legeNutzerAn,
  oeffentlich,
  setzeKennwort,
  setzeRolle,
  setzeSperre,
} from './nutzerStore.js';
import { verpackeNutzerschluessel } from './schluesselHuelle.js';
import { beendeAlleSitzungen, sperreAlleSitzungen } from './sitzung.js';
import { entferneNutzerdaten } from './umzug.js';
import { freigabenZuNutzer } from './freigaben.js';
import {
  VerzeichnisFehler,
  pruefeVerzeichnis,
  setzeVerzeichnis,
  verzeichnisFuerAnzeige,
  type Verzeichnis,
} from '../verzeichnis.js';
import { alsNutzer } from './kontext.js';
import { listAccounts } from '../accountStore.js';
import { archivEinstellungen } from '../archiv/archiv.js';
import { angaben, erhebe, setzeAngaben, umstaendeAus, type Angaben } from '../datenschutz/bestandsaufnahme.js';
import { beurteileLage } from '../datenschutz/lage.js';
import { erzeugeUnterlagen } from '../datenschutz/unterlagen.js';

/**
 * Die Nutzerverwaltung im Browser.
 *
 * ## Warum es sie jetzt gibt
 *
 * Bisher ging das nur von der Befehlszeile (nutzerWerkzeug.ts), und dessen Kommentar nannte
 * den Grund: "Ein Verwaltungsweg im Server bräuchte einen Verwalterbegriff, eine zweite
 * Rechteebene und deren Prüfungen. Beides ist verfrüht." Verfrüht war es, solange der
 * Dienst im Bekanntenkreis lief. Wer ihn einem Betrieb hinstellt, kann nicht verlangen,
 * dass für jedes neue Postfach jemand eine SSH-Sitzung öffnet.
 *
 * Das Werkzeug bleibt. Es ist der Weg zurück, wenn niemand mehr hereinkommt - und der
 * einzige, der ohne einen funktionierenden Verwalter auskommt.
 *
 * ## Die Rechteprüfung steht an EINER Stelle
 *
 * Nicht in jeder Route ein `if (istVerwalter(...))`. Bei sieben Routen wäre die achte die,
 * bei der es jemand vergisst - und eine vergessene Rechteprüfung sieht im Quelltext genau
 * so aus wie eine Route ohne Rechtebedarf. Hier hängt sie am Präfix: Was unter
 * `/verwaltung` liegt, ist geprüft, weil es dort liegt.
 */

const PRAEFIX = '/verwaltung';

/**
 * Ob diese Anfrage auf einem Verwaltungsweg landet.
 *
 * ## Der Fehler, den diese Funktion behebt
 *
 * Hier stand `request.url.split('?')[0].startsWith('/verwaltung')` - die ROHE Adresse.
 * Fastifys Router entschlüsselt die Prozentschreibweise aber, BEVOR er eine Route sucht,
 * und lässt `request.url` dabei unverändert. Beides fällt auseinander:
 *
 *     GET /%76erwaltung/nutzer
 *         request.url        = "/%76erwaltung/nutzer"   -> Riegel greift NICHT
 *         getroffene Route   = "/verwaltung/nutzer"     -> Route laeuft
 *
 * Ein angemeldeter gewöhnlicher Nutzer bekam damit die vollständige Nutzerliste, und über
 * denselben Weg jede weitere Verwaltungsroute: Nutzer anlegen, Kennwörter zurücksetzen,
 * sich selbst zum Verwalter machen. Wer ein Kennwort zurücksetzen kann, kann sich als
 * dieser Mensch anmelden und dessen Post lesen - der Weg führte also vom gewöhnlichen
 * Konto bis in fremde Postfächer. Ein einziger Buchstabe in Prozentschreibweise genügte.
 *
 * Nachgewiesen gegen den laufenden Dienst, nicht hergeleitet: `/%76erwaltung/nutzer` und
 * `/verwaltun%67/nutzer` gaben beide 200 samt Nutzerliste, `/verwaltung/nutzer` daneben
 * korrekt 403.
 *
 * ## Warum jetzt drei Vergleiche und nicht ein anderer
 *
 * Maßgeblich ist die GETROFFENE Route (`routeOptions.url`) - das ist genau die Angabe,
 * nach der Fastify entschieden hat, und sie kann mit keiner Schreibweise auseinanderlaufen.
 * Die beiden anderen bleiben trotzdem stehen:
 *
 *  - Die rohe Adresse, falls eine künftige Fastify-Fassung `routeOptions` in einem Haken
 *    nicht mehr füllt. Dann gilt wieder das alte Verhalten - schlechter als heute, aber
 *    nicht schlechter als vorher.
 *  - Die entschlüsselte Adresse als dritte Sicherung.
 *
 * Der Riegel greift, sobald EINER davon anschlägt. Bei einer Rechteprüfung ist die
 * Richtung des Zweifels immer dieselbe: lieber einmal zu viel prüfen als einmal zu wenig.
 */
export function istVerwaltungsweg(request: FastifyRequest): boolean {
  const gemustert = request.routeOptions?.url;
  if (typeof gemustert === 'string' && gemustert.startsWith(PRAEFIX)) return true;

  const roh = request.url.split('?')[0] ?? '/';
  if (roh.startsWith(PRAEFIX)) return true;

  try {
    return decodeURIComponent(roh).startsWith(PRAEFIX);
  } catch {
    // Eine Adresse, die sich nicht entschlüsseln lässt ("%zz"), trifft auch keine Route.
    return false;
  }
}

/** Ein neues Kennwort, das man vorlesen kann, ohne sich zu verhaspeln. */
function frischesKennwort(): string {
  /*
   * Aus einem Alphabet ohne die Zeichen, die man beim Vorlesen oder Abtippen verwechselt:
   * kein 0/O, kein 1/l/I. Das Kennwort wird genau einmal weitergegeben - meist mündlich
   * oder auf einem Zettel -, und ein "war das eine Null oder ein O?" kostet mehr als die
   * zwei Bit Entropie, die das Weglassen kostet.
   */
  const zeichen = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  return [...bytes].map((b) => zeichen[b % zeichen.length]).join('');
}

/** Wer die Anfrage stellt - im Verwaltungsbereich immer ein angemeldeter Mensch. */
function wer(request: FastifyRequest): string {
  return handelnderNutzer();
}

/**
 * Die Erhebung, mit den drei Zugriffen, die sie braucht.
 *
 * Hereingereicht statt in bestandsaufnahme.ts importiert: Sonst haenge das Modul am
 * Kontenspeicher, am Nutzerkontext und am Archiv - und damit an drei Dingen, die es fuer
 * seine eigentliche Aufgabe (Zahlen zusammentragen) nicht kennen muss. So bleibt es fuer
 * sich pruefbar, ohne einen halben Server aufzubauen.
 */
function erhebeStand() {
  return erhebe(
    (id, fn) => alsNutzer(id, fn),
    () => listAccounts(),
    () => {
      const e = archivEinstellungen();
      return { aktiv: e.konten.length > 0, konten: e.konten.length };
    },
  );
}

export function registriereVerwaltung(app: FastifyInstance): void {
  /*
   * Der Riegel: alles unter /verwaltung nur für Verwalter.
   *
   * Als onRequest-Haken mit Pfadprüfung und nicht als Dekorierung einzelner Routen. Der
   * Unterschied zählt beim Hinzufügen der nächsten Route: Wer sie unter /verwaltung legt,
   * bekommt die Prüfung, ohne daran zu denken. Wer sie woanders hinlegt, hat sie
   * offensichtlich nicht.
   *
   * Läuft NACH dem Nutzerkontext - der steht im preHandler, dieser Haken ebenfalls, und
   * die Reihenfolge ist die der Anmeldung. Deshalb wird registriereVerwaltung in app.ts
   * hinter registriereNutzerkontext gerufen; stünde es davor, gäbe es hier noch keinen
   * Nutzer, und die Prüfung liefe ins Leere.
   */
  app.addHook('preHandler', async (request, reply) => {
    if (!istVerwaltungsweg(request)) return;
    const pfad = request.routeOptions?.url ?? request.url.split('?')[0] ?? '/';

    /*
     * Der HANDELNDE, nicht der Eigentuemer der gerade offenen Daten.
     *
     * Seit es Freigaben gibt, koennen die beiden auseinanderfallen: Wer ein fremdes
     * Postfach geoeffnet hat, arbeitet in dessen Datenkontext. Fragte dieser Riegel
     * `aktuellerNutzer()`, pruefte er die Rolle des Eigentuemers - und ein gewoehnlicher
     * Nutzer kaeme ueber ein freigegebenes Verwalterpostfach in die Verwaltung.
     */
    const ich = handelnderNutzer();
    if (!istVerwalter(ich)) {
      /*
       * Protokolliert, und zwar als Warnung.
       *
       * Ein gewöhnlicher Nutzer landet hier nicht aus Versehen - die Oberfläche zeigt ihm
       * den Weg gar nicht an. Wer hier klopft, hat die Adresse von Hand eingegeben.
       */
      protokolliere(
        'warnung',
        'verwaltung',
        `"${ich}" ohne Verwalterrolle hat ${pfad} versucht (${kuerzeIpAdresse(request.ip)}).`,
      );
      return reply.code(403).send({ error: t('Dafür fehlt Ihnen die Berechtigung.') });
    }
  });

  /** Wer hier ein Postfach hat. */
  app.get(`${PRAEFIX}/nutzer`, async (request) => {
    return { nutzer: alleNutzer(), ich: wer(request) };
  });

  /**
   * Einen Nutzer anlegen.
   *
   * Das Kennwort wird hier erzeugt und genau einmal herausgegeben - danach steht es
   * nirgends mehr. Es vom Verwalter setzen zu lassen wäre bequemer und schlechter: Dann
   * kennt zwei Menschen dasselbe Kennwort, und erfahrungsgemäß bleibt es das erste und
   * einzige.
   */
  app.post<{ Body: { email?: string; verwalter?: boolean } }>(
    `${PRAEFIX}/nutzer`,
    async (request, reply) => {
      const email = typeof request.body?.email === 'string' ? request.body.email : '';
      const kennwort = frischesKennwort();
      try {
        const neu = legeNutzerAn({ email, kennwort }, verpackeNutzerschluessel);
        if (request.body?.verwalter) setzeRolle(neu.id, true);
        protokolliere('info', 'verwaltung', `"${wer(request)}" hat "${neu.id}" angelegt.`);
        return { nutzer: oeffentlich(findeNutzer(neu.id)!), kennwort };
      } catch (err) {
        if (err instanceof NutzerFehler) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  /**
   * Ändern: sperren, freigeben, Rolle, Kennwort zurücksetzen.
   *
   * Ein Weg für alle vier statt vier Wege. Sie betreffen denselben Eintrag, und ein
   * Verwalter, der jemanden sperrt und ihm gleichzeitig die Rolle nimmt, soll das nicht in
   * zwei Anfragen tun müssen, von denen die zweite scheitern kann.
   */
  app.patch<{
    Params: { id: string };
    Body: {
      gesperrt?: boolean;
      verwalter?: boolean;
      kennwortZuruecksetzen?: boolean;
      zweiFaktorEntfernen?: boolean;
    };
  }>(`${PRAEFIX}/nutzer/:id`, async (request, reply) => {
    const ich = wer(request);
    const ziel = request.params.id;
    const nutzer = findeNutzer(ziel);
    if (!nutzer) return reply.code(404).send({ error: t('Diesen Nutzer gibt es nicht.') });

    /*
     * Sich selbst kann man weder sperren noch die Rolle nehmen.
     *
     * Nicht weil es gefährlich wäre - der letzte Verwalter ist schon im Speicher
     * abgesichert -, sondern weil es keinen Fall gibt, in dem es gemeint ist. Wer sich
     * selbst sperrt, hat sich verklickt; und die Meldung "Das ist der letzte Verwalter"
     * wäre dann die falsche Erklärung.
     */
    if (ziel === ich && (request.body?.gesperrt === true || request.body?.verwalter === false)) {
      return reply.code(400).send({ error: t('An sich selbst geht das nicht.') });
    }

    try {
      let neuesKennwort: string | undefined;

      if (typeof request.body?.verwalter === 'boolean') {
        setzeRolle(ziel, request.body.verwalter);
      }

      if (typeof request.body?.gesperrt === 'boolean') {
        setzeSperre(ziel, request.body.gesperrt);
        /*
         * Sperren heißt auch: die offenen Sitzungen beenden.
         *
         * Ohne das arbeitete der Gesperrte weiter, bis sein Keks von selbst abläuft -
         * bis zu vierzehn Tage. "Gesperrt" wäre dann eine Angabe in einer Datei und keine
         * Wirkung.
         */
        if (request.body.gesperrt) beendeAlleSitzungen(ziel);
      }

      if (request.body?.kennwortZuruecksetzen) {
        neuesKennwort = frischesKennwort();
        setzeKennwort(ziel, neuesKennwort);
        /*
         * Und überall abmelden - aus demselben Grund wie beim selbst geänderten Kennwort:
         * Ein Wechsel, nach dem eine fremde Sitzung offen bleibt, ist wirkungslos.
         */
        beendeAlleSitzungen(ziel);
        /*
         * Laut ins Protokoll, und zwar als Warnung.
         *
         * Ein zurückgesetztes Kennwort heißt, dass der Verwalter sich als dieser Mensch
         * anmelden und dessen Post lesen kann. Das ist die Bauart und keine Lücke - aber
         * es ist der eine Vorgang, bei dem hinterher jemand fragen wird, wer das war.
         */
        protokolliere(
          'warnung',
          'verwaltung',
          `"${ich}" hat das Kennwort von "${ziel}" zurückgesetzt.`,
        );
      }

      /**
       * Den zweiten Faktor abräumen - der Weg zurück bei einem verlorenen Telefon.
       *
       * Es ist der Vorgang, der von allen hier am ehesten missbraucht wird, denn er nimmt
       * einem Konto genau den Schutz weg, für den es eingerichtet wurde. Deshalb dreierlei:
       * Er steht als Warnung im Protokoll, er ist im Verwaltungsfenster hinter einer
       * Rückfrage, und er räumt NUR den Faktor ab - das Kennwort bleibt, wie es war. Wer
       * beides will, muss beides ausdrücklich anhaken.
       *
       * Für den Nutzer heißt das: Beim nächsten Anmelden kommt keine Codeabfrage mehr, und
       * er kann den Faktor neu einrichten. Sein bisheriges Geheimnis und seine
       * Wiederherstellungscodes sind weg.
       */
      if (request.body?.zweiFaktorEntfernen) {
        if (entferneZweiFaktor(ziel)) {
          protokolliere(
            'warnung',
            'verwaltung',
            `"${ich}" hat den zweiten Faktor von "${ziel}" entfernt.`,
          );
        }
      }

      return { nutzer: oeffentlich(findeNutzer(ziel)!), kennwort: neuesKennwort };
    } catch (err) {
      if (err instanceof NutzerFehler) return reply.code(400).send({ error: err.message });
      throw err;
    }
  });

  /**
   * Entfernen - mit oder ohne die Daten.
   *
   * Der Eintrag geht in jedem Fall, und mit ihm der Schlüssel dieses Nutzers: Seine
   * Geheimnisse sind ab diesem Augenblick unlesbar, auch in jeder Sicherung. Der Ordner
   * bleibt liegen, solange `mitDaten` nicht gesetzt ist - dieselbe Trennung wie im
   * Befehlszeilenwerkzeug, und aus demselben Grund: Ein versehentliches Entfernen soll
   * nicht zugleich das Löschen sein.
   */
  app.delete<{ Params: { id: string }; Querystring: { mitDaten?: string } }>(
    `${PRAEFIX}/nutzer/:id`,
    async (request, reply) => {
      const ich = wer(request);
      const ziel = request.params.id;
      if (ziel === ich) {
        return reply.code(400).send({ error: t('An sich selbst geht das nicht.') });
      }
      if (!findeNutzer(ziel)) {
        return reply.code(404).send({ error: t('Diesen Nutzer gibt es nicht.') });
      }

      try {
        beendeAlleSitzungen(ziel);
        /*
         * Seine Freigaben gehen mit - in beide Richtungen.
         *
         * Was er verschenkt hat, zeigte sonst auf ein Postfach, dessen Schluessel es
         * nicht mehr gibt. Was er bekommen hat, waere ein Eintrag auf eine Kennung, die
         * eines Tages neu vergeben wird - und dann kaeme ein Fremder in fremde Post.
         */
        freigabenZuNutzer(ziel);
        entferneNutzer(ziel);
        const mitDaten = request.query.mitDaten === 'true';
        if (mitDaten) entferneNutzerdaten(ziel);
        protokolliere(
          'warnung',
          'verwaltung',
          `"${ich}" hat "${ziel}" entfernt${mitDaten ? ' - samt Daten' : ''}.`,
        );
        return { entfernt: true, mitDaten };
      } catch (err) {
        if (err instanceof NutzerFehler) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  /**
   * Alle Sitzungen eines Nutzers sperren - der schnelle Griff bei einem verlorenen Rechner.
   *
   * Sperren und nicht beenden: Der Mensch soll sich mit seinem Kennwort wieder hineinlassen
   * können, sobald er ein Gerät hat, dem er traut. Wer wirklich alles beenden will, sperrt
   * den Nutzer.
   */
  app.post<{ Params: { id: string } }>(`${PRAEFIX}/nutzer/:id/sperren`, async (request, reply) => {
    const ziel = request.params.id;
    if (!findeNutzer(ziel)) {
      return reply.code(404).send({ error: t('Diesen Nutzer gibt es nicht.') });
    }
    const anzahl = sperreAlleSitzungen(ziel);
    protokolliere(
      'info',
      'verwaltung',
      `"${wer(request)}" hat ${anzahl} Sitzung(en) von "${ziel}" gesperrt.`,
    );
    return { gesperrt: anzahl };
  });

  /**
   * Das Firmenverzeichnis - einrichten, prüfen.
   *
   * Unter `/verwaltung`, damit die Rechteprüfung dieses Präfixes gilt. Das ist der Grund,
   * warum diese drei Wege hier stehen und nicht bei den übrigen Verzeichniswegen in
   * app.ts: Suchen darf jeder Nutzer, einrichten nur ein Verwalter - und wo eine Route
   * liegt, entscheidet, welche Prüfung sie bekommt.
   */
  app.get(`${PRAEFIX}/verzeichnis`, async () => verzeichnisFuerAnzeige());

  app.put<{ Body: Partial<Verzeichnis> & { kennwort?: string | null } }>(
    `${PRAEFIX}/verzeichnis`,
    async (request, reply) => {
      const { kennwort, ...rest } = request.body ?? {};
      try {
        const neu = setzeVerzeichnis(rest, kennwort);
        protokolliere(
          'info',
          'verwaltung',
          `"${wer(request)}" hat das Firmenverzeichnis geändert.`,
        );
        return neu;
      } catch (err) {
        if (err instanceof VerzeichnisFehler) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  /**
   * Ein Verbindungsversuch, bevor gespeichert wird.
   *
   * Mit den Angaben aus dem Formular und nicht mit den gespeicherten: Wer gerade etwas
   * ändert, will wissen, ob das Neue geht - nicht, ob das Alte ging.
   */
  app.post<{ Body: Partial<Verzeichnis> & { kennwort?: string } }>(
    `${PRAEFIX}/verzeichnis/pruefen`,
    async (request) => {
      const { kennwort, ...rest } = request.body ?? {};
      return pruefeVerzeichnis(rest, kennwort);
    },
  );
  // --- Datenschutz: Bestandsaufnahme und Unterlagen ---

  /**
   * Was hier laeuft, und was daraus folgt.
   *
   * Unter /verwaltung, weil es den ganzen Betrieb betrifft und nicht einen Menschen darin -
   * und weil die Erhebung ueber alle Nutzerordner geht. Der Riegel oben gilt damit
   * automatisch.
   */
  app.get(`${PRAEFIX}/datenschutz`, async () => {
    const erhoben = erhebeStand();
    const a = angaben();
    return { angaben: a, erhoben, befund: beurteileLage(umstaendeAus(a, erhoben)) };
  });

  app.put<{ Body: Partial<Angaben> }>(`${PRAEFIX}/datenschutz`, async (request) => {
    const a = setzeAngaben(request.body ?? {});
    const erhoben = erhebeStand();
    return { angaben: a, erhoben, befund: beurteileLage(umstaendeAus(a, erhoben)) };
  });

  app.post(`${PRAEFIX}/datenschutz/unterlagen`, async (request) => {
    const ergebnis = erzeugeUnterlagen(erhebeStand());
    protokolliere(
      'info',
      'verwaltung',
      `"${wer(request)}" hat die Datenschutzunterlagen erzeugt (${ergebnis.dateien.length} Dateien).`,
    );
    return ergebnis;
  });
}
