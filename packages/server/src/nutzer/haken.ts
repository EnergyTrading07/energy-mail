import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { alsNutzer, istGueltigeNutzerId } from './kontext.js';
import { OFFENE_PFADE } from './anmelden.js';
import { GESUNDHEITS_PFAD, istOberflaeche } from '../zugang.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Setzt für jede Anfrage den Nutzerkontext.
 *
 * Bestimmt wird der Nutzer von einer Funktion, die der Aufrufer mitgibt. Heute liefert
 * sie im Desktop-Betrieb schlicht "lokal"; sobald es eine Anmeldung gibt (Stufe 2), liest
 * sie ihn aus der Sitzung. Der Rest des Servers merkt von diesem Wechsel nichts - das ist
 * der Sinn der Trennung.
 */
export type NutzerErmitteln = (request: FastifyRequest) => string | null;

/**
 * Ob die Sitzung dieser Anfrage gesperrt ist.
 *
 * Als eigene Frage neben `ermittle` und nicht in dessen Rückgabe hineingerechnet: Der
 * Nutzer einer gesperrten Sitzung steht fest, sie darf nur nichts. Gäbe `ermittle` bei
 * Sperre `null` zurück, sähe der Server keinen Unterschied zwischen "gesperrt" und "nie
 * angemeldet" - und die Oberfläche zeigte ein leeres Anmeldefenster statt der Sperre mit
 * dem Namen dessen, der sie aufmachen kann.
 *
 * Fehlt sie, ist nichts gesperrt. Das ist der Desktop-Fall: Dort weist sich das Fenster
 * mit dem Zugangsgeheimnis des Prozesses aus, es gibt keine Sitzung und kein Kennwort -
 * also auch nichts, was eine Sperre wieder aufmachen könnte.
 */
export type SperreErmitteln = (request: FastifyRequest) => boolean;

/**
 * Warum ein preHandler und kein onRequest.
 *
 * Der Kontext muss die gesamte Routenbehandlung umschließen, nicht nur einen Augenblick
 * davor. Ein onRequest-Haken läuft, gibt frei und ist fertig - die Route liefe danach
 * wieder ohne Kontext. Fastify bietet für genau diesen Zweck keinen "um die Route
 * herum"-Haken, wohl aber die Möglichkeit, den Kontext im preHandler zu betreten und
 * ihn NICHT wieder zu verlassen: alles, was danach in derselben Ausführungskette folgt -
 * die Route, ihre awaits, die Antwort - läuft darin weiter.
 *
 * Deshalb wird `fertig()` INNERHALB von alsNutzer gerufen. Das sieht ungewöhnlich aus und
 * ist der Kern der Sache.
 */
export function registriereNutzerkontext(
  app: FastifyInstance,
  ermittle: NutzerErmitteln,
  istGesperrt?: SperreErmitteln,
): void {
  app.addHook('preHandler', (request: FastifyRequest, reply: FastifyReply, fertig: () => void) => {
    const pfad = request.url.split('?')[0] ?? '/';

    /*
     * Die Oberfläche selbst muss ohne Anmeldung ausgeliefert werden.
     *
     * Sonst kommt niemand je bis zum Anmeldefenster: das Fenster lädt "/" als
     * gewöhnliche Navigation, und dabei lässt sich weder eine Kopfzeile setzen noch ein
     * Keks mitgeben, den es noch gar nicht gibt.
     *
     * Ohne diese Zeile bekam die Desktop-Hülle beim Start eine 401 und zeigte die
     * JSON-Fehlermeldung des Servers statt des Mailprogramms - aufgefallen erst beim
     * Starten der paketierten Anwendung, nicht in Typen, Bau oder Prüfungen. Der
     * Zugangsriegel hatte dieselbe Ausnahme längst; hier fehlte sie.
     *
     * Ausgeliefert wird dabei nur, was ohnehin im Installationspaket steht - ein
     * Postfach ist darüber nicht erreichbar.
     */
    if (istOberflaeche(pfad)) {
      fertig();
      return;
    }

    /*
     * Der Gesundheitsweg gehört keinem Nutzer.
     *
     * Die Container-Prüfung und eine spätere Überwachung fragen ihn ohne Sitzung ab -
     * hinge er am Nutzerkontext, meldete er dauerhaft 401, und Docker hielte den
     * gesunden Dienst für krank und startete ihn im Kreis neu.
     */
    if (pfad === GESUNDHEITS_PFAD) {
      fertig();
      return;
    }

    /*
     * Anmelden und abmelden müssen ohne angemeldeten Nutzer erreichbar sein - sonst käme
     * niemand je hinein. Sie fassen von sich aus keine Nutzerdaten an; /ich liest die
     * Sitzung selbst und antwortet auch dann, wenn keine da ist.
     */
    if (OFFENE_PFADE.has(pfad)) {
      fertig();
      return;
    }

    const id = ermittle(request);

    if (!id) {
      // Kein Nutzer feststellbar: keine Anfrage darf ohne Zuordnung weiterlaufen. Bis es
      // eine Anmeldung gibt, kann das nur ein Fehler in der Einrichtung sein.
      reply.code(401).send({ error: t('Kein Nutzer zugeordnet') });
      return;
    }

    /*
     * Gesperrt: 423 und nichts weiter.
     *
     * Nach der Nutzerprüfung und vor der Route - hier läuft jede Anfrage durch, die
     * überhaupt an Daten kommt. Ein Vorhang in der Oberfläche allein wäre wirkungslos:
     * Der Keks gilt weiter, und ein zweiter Tab bekäme die Post ungehindert.
     *
     * 423 (Locked) und nicht 401: Der Unterschied trägt eine Auskunft, an der die
     * Oberfläche etwas entscheidet. 401 heißt "melde dich an" und wirft alles weg, was
     * offen war - auch den halb geschriebenen Brief. 423 heißt "du bist es noch, gib das
     * Kennwort ein", und danach steht der Entwurf noch da.
     */
    if (istGesperrt?.(request)) {
      reply.code(423).send({ error: t('Gesperrt'), gesperrt: true });
      return;
    }

    if (!istGueltigeNutzerId(id)) {
      /*
       * Die Kennung wird zu einem Ordnernamen. Eine wie "../andererNutzer" führte aus dem
       * eigenen Ordner heraus - genau die Vermischung, die das Modul verhindern soll.
       * Hier zusätzlich abgefangen, obwohl alsNutzer() ohnehin prüft: eine geworfene
       * Ausnahme im Haken ergäbe eine 500, und das sähe nach einem kaputten Server aus
       * statt nach einer unbrauchbaren Anfrage.
       */
      reply.code(400).send({ error: 'Unbrauchbare Nutzerkennung' });
      return;
    }

    alsNutzer(id, fertig);
  });
}
