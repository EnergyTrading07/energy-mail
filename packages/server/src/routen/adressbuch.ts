import type { FastifyInstance } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';
import {
  einfuhrVisitenkarten,
  kontakteAlsVcf,
  listeKontakte,
  loescheKontakt,
  searchContacts,
  speichereKontakt,
  type KontaktEingabe,
} from '../contactStore.js';
import { sucheImVerzeichnis } from '../verzeichnis.js';
import { HttpError } from './fehler.js';

/**
 * Das Adressbuch und die Vervollstaendigung beim Schreiben.
 *
 * Erste Gruppe, die aus app.ts herausgewandert ist - und ausgewaehlt, weil sie fast
 * nichts braucht: zwei Speicher, `t()` und `HttpError`. Nichts davon haengt am Aufbau
 * des Servers, es gibt also keinen Grund, warum diese siebzig Zeilen zwischen den
 * Postfachwegen stehen sollten.
 *
 * Das Muster ist dasselbe wie bei nutzer/verwaltung.ts und nutzer/zweiFaktor.ts: ein
 * `registriereX(app)`, das seine Wege selbst anmeldet. buildServer ruft es auf und muss
 * von dem, was hier drinsteht, nichts wissen.
 */
export function registriereAdressbuch(app: FastifyInstance): void {
  /**
   * Vorschlaege beim Tippen einer Adresse - aus dem eigenen Adressbuch UND aus dem
   * Firmenverzeichnis.
   *
   * Das eigene zuerst, und das ist keine Geschmacksfrage: Wer eine Adresse schon einmal
   * benutzt hat, meint mit hoher Wahrscheinlichkeit genau die. Das Verzeichnis liefert
   * die Kollegen, an die man noch nie geschrieben hat - wertvoll, aber die zweite Wahl.
   *
   * Wer schon im Adressbuch steht, kommt nicht doppelt: verglichen wird ueber die Adresse.
   */
  app.get<{ Querystring: { q?: string } }>('/contacts', async (request) => {
    const suchtext = request.query.q ?? '';
    const eigene = searchContacts(suchtext);
    const ausVerzeichnis = await sucheImVerzeichnis(suchtext, 15);
    if (ausVerzeichnis.length === 0) return eigene;

    const bekannt = new Set(eigene.map((k) => k.address.toLowerCase()));
    return [...eigene, ...ausVerzeichnis.filter((e) => !bekannt.has(e.address.toLowerCase()))];
  });

  /** Nur das Firmenverzeichnis - für die eigene Ansicht im Adressbuch. */
  app.get<{ Querystring: { q?: string } }>('/verzeichnis/suche', async (request) => {
    return { treffer: await sucheImVerzeichnis(request.query.q ?? '', 50) };
  });

  app.get<{ Querystring: { q?: string; alle?: string } }>('/adressbuch', async (request) => {
    return listeKontakte({
      suche: request.query.q,
      auchAufgelesene: request.query.alle === '1',
    });
  });

  app.put<{ Body: KontaktEingabe & { vorherigeAdresse?: string } }>(
    '/adressbuch',
    async (request) => {
      const { vorherigeAdresse, ...eingabe } = request.body ?? ({} as KontaktEingabe);
      try {
        return speichereKontakt(eingabe, vorherigeAdresse);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    },
  );

  app.delete<{ Params: { adresse: string } }>('/adressbuch/:adresse', async (request) => {
    const weg = loescheKontakt(decodeURIComponent(request.params.adresse));
    if (!weg) throw new HttpError(404, t('Kontakt nicht gefunden'));
    return { ok: true };
  });

  /**
   * Das Adressbuch als vCard-Datei. Der Weg hinaus - ohne ihn wären die Kontakte hier
   * gefangen, und ein Adressbuch, aus dem man nicht herauskommt, ist keins.
   */
  app.get('/adressbuch/ausfuhr', async (_request, reply) => {
    const heute = new Date().toISOString().slice(0, 10);
    reply.type('text/vcard; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="Adressbuch-${heute}.vcf"`);
    return kontakteAlsVcf();
  });

  /**
   * Eine vCard-Datei einlesen. Der Inhalt kommt als Text im Rumpf - die Datei wird im
   * Fenster gelesen, damit hier kein Pfad und keine Dateiablage nötig ist.
   */
  app.post<{ Body: { inhalt?: string } }>('/adressbuch/einfuhr', async (request) => {
    const inhalt = request.body?.inhalt;
    if (typeof inhalt !== 'string' || !inhalt.trim()) {
      throw new HttpError(400, t('Die Datei ist leer'));
    }
    return einfuhrVisitenkarten(inhalt);
  });
}
