import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { alsNutzer, istGueltigeNutzerId } from './kontext.js';
import { OFFENE_PFADE } from './anmelden.js';

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
export function registriereNutzerkontext(app: FastifyInstance, ermittle: NutzerErmitteln): void {
  app.addHook('preHandler', (request: FastifyRequest, reply: FastifyReply, fertig: () => void) => {
    /*
     * Anmelden und abmelden müssen ohne angemeldeten Nutzer erreichbar sein - sonst käme
     * niemand je hinein. Sie fassen von sich aus keine Nutzerdaten an; /ich liest die
     * Sitzung selbst und antwortet auch dann, wenn keine da ist.
     */
    const pfad = request.url.split('?')[0] ?? '/';
    if (OFFENE_PFADE.has(pfad)) {
      fertig();
      return;
    }

    const id = ermittle(request);

    if (!id) {
      // Kein Nutzer feststellbar: keine Anfrage darf ohne Zuordnung weiterlaufen. Bis es
      // eine Anmeldung gibt, kann das nur ein Fehler in der Einrichtung sein.
      reply.code(401).send({ error: 'Kein Nutzer zugeordnet' });
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
