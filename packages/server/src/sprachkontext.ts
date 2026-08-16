import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import {
  alsSprache,
  ausAcceptLanguage,
  setzeSprachquelle,
  type Sprache,
} from '@energy-mail/mail-core/sprache';

/**
 * Die Sprache einer Anfrage.
 *
 * In der Hülle ist die Sprache eine Einstellung des Programms: ein Wert, der beim Start
 * feststeht. Im Serverbetrieb ist sie das nicht. Dort bedient ein Prozess viele Menschen
 * gleichzeitig, und zwischen zwei Anfragen liegt womöglich ein anderer Mensch mit einer
 * anderen Sprache.
 *
 * Eine Variable im Modul wäre hier nicht bloß unsauber, sondern falsch - und zwar auf die
 * unangenehmste Art: Sie funktionierte in jeder Prüfung, in der nur einer arbeitet, und
 * versagte im Betrieb genau dann, wenn zwei gleichzeitig etwas tun. Der eine bekäme die
 * Fehlermeldung in der Sprache des anderen, je nachdem, wessen Anfrage zuletzt geschrieben
 * hat.
 *
 * Deshalb AsyncLocalStorage - dasselbe Mittel, mit dem dieser Server schon den Nutzer je
 * Anfrage führt (siehe nutzer/kontext.ts). Der Wert reist mit dem Aufrufstapel, auch über
 * `await` hinweg, und zwei gleichzeitige Anfragen sehen einander nicht.
 */

const speicher = new AsyncLocalStorage<Sprache>();

/**
 * Woher die Sprache einer Anfrage kommt.
 *
 * 1. **Der Nutzer**, falls er eine gewählt hat. Sie gehört zu ihm und nicht zum Browser,
 *    mit dem er gerade hereinkommt.
 * 2. **`Accept-Language`.** Der Weg, den jeder Browser von sich aus mitbringt - ohne dass
 *    irgendwo etwas einzustellen wäre.
 * 3. Sonst Deutsch, die Quelle.
 */
export function spracheFuerAnfrage(
  amNutzer: string | undefined,
  acceptLanguage: string | undefined,
): Sprache {
  return alsSprache(amNutzer) ?? ausAcceptLanguage(acceptLanguage) ?? 'de';
}

/** Führt etwas in der Sprache einer Anfrage aus. */
export function inSprache<T>(sprache: Sprache, fn: () => T): T {
  return speicher.run(sprache, fn);
}

/** Die Sprache der laufenden Anfrage - außerhalb einer Anfrage die Vorgabe. */
export function aktuelleSprache(): Sprache | undefined {
  return speicher.getStore();
}

/**
 * Hängt die Sprache in jede Anfrage.
 *
 * Über einen `onRequest`-Haken, weil er vor allem anderen läuft: Eine Fehlermeldung aus
 * der Eingangskontrolle soll bereits in der richtigen Sprache herauskommen.
 *
 * `setzeSprachquelle` verbindet den Kontext mit t() in mail-core. Ohne diese eine Zeile
 * wäre der ganze Aufbau wirkungslos - t() läse weiterhin die Variable im Modul und gäbe
 * allen dieselbe Sprache.
 */
export function registriereSprachkontext(
  app: FastifyInstance,
  spracheDesNutzers: (request: { headers: Record<string, unknown> }) => string | undefined,
): void {
  setzeSprachquelle(() => aktuelleSprache() ?? 'de');

  app.addHook('onRequest', (request, _reply, weiter) => {
    const sprache = spracheFuerAnfrage(
      spracheDesNutzers(request as never),
      request.headers['accept-language'],
    );
    /*
     * Der Rest der Anfrage läuft INNERHALB des Kontexts.
     *
     * Fastify erwartet, dass der Haken weitermacht; genau das geschieht hier - nur eben
     * im Kontext. Alles, was danach kommt (Routen, Datenbank, Antwort), sieht die
     * Sprache. Ein `speicher.enterWith()` daneben wäre kürzer und würde bei mehreren
     * gleichzeitigen Anfragen wieder überlaufen.
     */
    inSprache(sprache, weiter);
  });
}
