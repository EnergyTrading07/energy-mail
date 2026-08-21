import type { FastifyInstance } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';
import { listAccounts } from '../accountStore.js';
import {
  alleEintraege as alleArchivEintraege,
  archivEinstellungen,
  original as archivOriginal,
  siegel as archivSiegel,
  pruefeBestand as pruefeArchivBestand,
  raeumeAuf as raeumeArchivAuf,
  setzeArchivEinstellungen,
  suche as sucheImArchiv,
  trageUm as trageArchivUm,
  vermerke as vermerkeImArchiv,
  type ArchivEinstellungen,
} from '../archiv/archiv.js';
import { erzeugeAusfuhr as erzeugeArchivAusfuhr } from '../archiv/ausfuhr.js';
import type { Aufbewahrungsart } from '../archiv/fristen.js';
import { verfahrensdokumentation } from '../archiv/verfahrensdokumentation.js';
import { HttpError } from './fehler.js';
import { zahlAus } from './gemeinsam.js';

/**
 * Die Wege zum GoBD-Archiv.
 *
 * Der Inhalt liegt seit jeher in archiv/ - Kette, Fristen, Ausfuhr,
 * Verfahrensdokumentation. Nur die Wege dorthin standen in app.ts, und damit war die
 * Aufteilung halb: Wer am Archiv arbeitete, musste zwei Orte kennen und den einen davon
 * in einer Datei mit hundert fremden Wegen suchen. Jetzt liegt beides beieinander.
 */
export function registriereArchiv(app: FastifyInstance): void {
  // --- Das GoBD-Archiv ---

  app.get('/archiv/stand', async () => {
    const eintraege = alleArchivEintraege();
    const nachrichten = eintraege.filter((e) => e.bezugAuf === undefined && e.datei);
    const faellig = raeumeArchivAuf(new Date(), false);
    return {
      einstellungen: archivEinstellungen(),
      anzahl: nachrichten.length,
      kettenlaenge: eintraege.length,
      siegel: archivSiegel(),
      aeltesteAm: nachrichten[0]?.entstandenAm,
      juengsteAm: nachrichten.at(-1)?.entstandenAm,
      bytes: nachrichten.reduce((s, e) => s + e.groesse, 0),
      /** Wie viel die Frist hinter sich hat - angezeigt, aber nicht von selbst entfernt. */
      freigegeben: faellig.anzahl,
    };
  });

  app.put<{ Body: ArchivEinstellungen }>('/archiv/einstellungen', async (request) => {
    const koerper = request.body ?? { konten: [], vorgabe: 'geschaeftsbrief' as const };
    // Nur Konten, die es auch gibt - sonst zeichnete eine Einstellung ins Leere auf.
    const vorhanden = new Set(listAccounts().map((k) => k.id));
    return setzeArchivEinstellungen({
      ...koerper,
      konten: (koerper.konten ?? []).filter((k) => vorhanden.has(k)),
    });
  });

  app.get<{
    Querystring: {
      text?: string;
      von?: string;
      bis?: string;
      richtung?: 'empfangen' | 'gesendet';
      art?: Aufbewahrungsart;
      konto?: string;
    };
  }>('/archiv/suche', async (request) => {
    const q = request.query;
    return sucheImArchiv({
      text: q.text,
      von: q.von,
      bis: q.bis,
      richtung: q.richtung,
      art: q.art,
      kontoId: q.konto,
    });
  });

  /** Die Nachricht im Original. Der Abdruck wird dabei nachgerechnet - siehe original(). */
  app.get<{ Params: { nr: string } }>('/archiv/:nr/original', async (request, reply) => {
    try {
      const { bytes, eintrag } = archivOriginal(zahlAus(request.params.nr, 'nr', { von: 1, bis: Number.MAX_SAFE_INTEGER }));
      reply.type('message/rfc822');
      reply.header(
        'content-disposition',
        `attachment; filename="archiv-${String(eintrag.nr).padStart(7, '0')}.eml"`,
      );
      return bytes;
    } catch (err) {
      throw new HttpError(404, (err as Error).message);
    }
  });

  app.post<{ Params: { nr: string }; Body: { text?: string } }>(
    '/archiv/:nr/vermerk',
    async (request) => {
      const text = request.body?.text?.trim();
      if (!text) throw new HttpError(400, t('Ein leerer Vermerk hilft niemandem.'));
      try {
        return vermerkeImArchiv(zahlAus(request.params.nr, 'nr', { von: 1, bis: Number.MAX_SAFE_INTEGER }), text);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    },
  );

  app.post<{ Params: { nr: string }; Body: { art?: Aufbewahrungsart } }>(
    '/archiv/:nr/art',
    async (request) => {
      const art = request.body?.art;
      if (art !== 'geschaeftsbrief' && art !== 'buchungsbeleg' && art !== 'ohne-pflicht') {
        throw new HttpError(400, t('Unbekannte Aufbewahrungsart.'));
      }
      try {
        return trageArchivUm(zahlAus(request.params.nr, 'nr', { von: 1, bis: Number.MAX_SAFE_INTEGER }), art);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    },
  );

  /** Rechnet den ganzen Bestand nach - dauert bei einem grossen Archiv Minuten. */
  app.post('/archiv/pruefen', async () => pruefeArchivBestand());

  app.post<{ Body: { von?: string; bis?: string } }>('/archiv/ausfuhr', async (request) =>
    erzeugeArchivAusfuhr(undefined, { von: request.body?.von, bis: request.body?.bis }),
  );

  /**
   * Entfernt, was seine Frist hinter sich hat.
   *
   * Ohne "wirklich" wird nur gezaehlt. Zwei Schritte, weil hier etwas verschwindet, das
   * per Gesetz aufzubewahren WAR - wer sich vertut, kann es nicht zurueckholen.
   */
  app.post<{ Body: { wirklich?: boolean } }>('/archiv/aufraeumen', async (request) =>
    raeumeArchivAuf(new Date(), request.body?.wirklich === true),
  );

  app.get('/archiv/verfahrensdokumentation', async (_request, reply) => {
    reply.type('text/markdown; charset=utf-8');
    reply.header('content-disposition', 'attachment; filename="Verfahrensdokumentation.md"');
    return verfahrensdokumentation();
  });
}
