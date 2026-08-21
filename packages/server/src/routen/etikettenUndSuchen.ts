import type { FastifyInstance } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';
import {
  EtikettFehler,
  alleEtiketten,
  loescheEtikett,
  speichereEtikett,
  type EtikettEingabe,
} from '../etikettenStore.js';
import {
  SucheFehler,
  alleSuchen,
  loescheSuche,
  speichereSuche,
  type GespeicherteSuche,
} from '../gespeicherteSuchen.js';
import { HttpError } from './fehler.js';

/**
 * Etiketten und gemerkte Suchen - die beiden Verzeichnisse der Seitenleiste.
 *
 * Zusammen in einer Datei, weil sie dieselbe Bauart haben: ein Verzeichnis lesen, einen
 * Eintrag speichern, einen entfernen. Sechs Wege, die sich in zwanzig Zeilen erschoepfen
 * und in app.ts zwischen S/MIME und OAuth standen - also zwischen zwei Dingen, mit denen
 * sie nichts zu tun haben.
 *
 * Beide Speicher werfen einen eigenen Fehler bei unbrauchbarer Eingabe. Der wird hier zu
 * einer 400 gemacht und nicht durchgereicht: Sonst faende ihn der Behandler in app.ts
 * nicht wieder und machte eine 500 daraus - aus "so nicht" also "hier ist etwas kaputt".
 */
export function registriereEtikettenUndSuchen(app: FastifyInstance): void {
  app.get('/etiketten', async () => alleEtiketten());

  app.put<{ Body: EtikettEingabe }>('/etiketten', async (request) => {
    try {
      return speichereEtikett(request.body ?? ({} as EtikettEingabe));
    } catch (err) {
      if (err instanceof EtikettFehler) throw new HttpError(400, err.message);
      throw err;
    }
  });

  app.delete<{ Params: { schluessel: string } }>('/etiketten/:schluessel', async (request) => {
    const weg = loescheEtikett(decodeURIComponent(request.params.schluessel));
    if (!weg) throw new HttpError(404, t('Etikett nicht gefunden'));
    return { ok: true };
  });

  // --- Gespeicherte Suchen ---

  app.get('/suchen', async () => alleSuchen());

  app.put<{ Body: Omit<GespeicherteSuche, 'id'> & { id?: string } }>('/suchen', async (request) => {
    try {
      return speichereSuche(request.body ?? ({} as GespeicherteSuche));
    } catch (err) {
      if (err instanceof SucheFehler) throw new HttpError(400, err.message);
      throw err;
    }
  });

  app.delete<{ Params: { id: string } }>('/suchen/:id', async (request) => {
    if (!loescheSuche(request.params.id)) throw new HttpError(404, t('Suche nicht gefunden'));
    return { ok: true };
  });
}
