import type { FastifyInstance } from 'fastify';
import { erzeugeSchluesselpaar, getBodyStructure, getMessage } from '@energy-mail/mail-core';
import { t } from '@energy-mail/mail-core/sprache';
import { pruefePgp } from '../pgpNachricht.js';
import { pruefeSmime } from '../smimeNachricht.js';
import {
  SchluesselFehler,
  alleSchluessel,
  entferneSchluessel,
  fuegeSchluesselHinzu,
  hatGeheimen,
  kennwortStimmt,
  oeffentlicheFuer,
  oeffentlicherText,
} from '../schluesselbund.js';
import {
  ZertifikatsspeicherFehler,
  alleZertifikate,
  alsPem as smimeAlsPem,
  eigeneFuer,
  entferneZertifikat,
  fuegeSchluesseldateiHinzu,
  fuegeZertifikatHinzu,
  kennwortStimmt as smimeKennwortStimmt,
  zertifikateFuer,
} from '../smimeStore.js';
import { HttpError } from './fehler.js';
import { requireAccount, uidAus } from './gemeinsam.js';

/**
 * Unterschreiben und Verschluesseln - OpenPGP und S/MIME.
 *
 * Zwei Verfahren, ein Zweck, und in der Oberflaeche liegen sie nebeneinander. In app.ts
 * standen sie als zweihundertdreissig Zeilen mitten zwischen den Postfachwegen, obwohl
 * sie mit dem Abrufen von Post nichts zu tun haben: Sie verwalten zwei Speicher und
 * beurteilen den kryptografischen Befund einer einzelnen Nachricht.
 *
 * Zusammen in einer Datei und nicht getrennt, weil sie sich Punkt fuer Punkt
 * entsprechen - Schluessel aufnehmen, entfernen, ausgeben, ein Kennwort pruefen, einen
 * Befund erheben. Wer an einem etwas aendert, muss beim anderen nachsehen, ob dasselbe
 * gilt; nebeneinander faellt das auf, in zwei Dateien nicht.
 */
export function registriereSchluessel(app: FastifyInstance): void {
  // --- OpenPGP: der Schluesselbund ---

  app.get('/schluessel', async () => alleSchluessel());

  app.post<{ Body: { armored?: string; fuerKonto?: string } }>('/schluessel', async (request) => {
    const armored = request.body?.armored;
    if (typeof armored !== 'string' || !armored.trim()) {
      throw new HttpError(400, t('Es wurde kein Schlüssel übergeben'));
    }
    try {
      return await fuegeSchluesselHinzu(armored, request.body?.fuerKonto);
    } catch (err) {
      if (err instanceof SchluesselFehler) throw new HttpError(400, err.message);
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.delete<{ Params: { fingerabdruck: string }; Querystring: { geheim?: string } }>(
    '/schluessel/:fingerabdruck',
    async (request) => {
      const weg = entferneSchluessel(
        request.params.fingerabdruck.toUpperCase(),
        request.query.geheim === '1',
      );
      if (!weg) throw new HttpError(404, t('Schlüssel nicht gefunden'));
      return { ok: true };
    },
  );

  /** Den eigenen oeffentlichen Schluessel zum Weitergeben. */
  app.get<{ Params: { fingerabdruck: string } }>(
    '/schluessel/:fingerabdruck/ausfuhr',
    async (request, reply) => {
      const text = oeffentlicherText(request.params.fingerabdruck.toUpperCase());
      if (!text) throw new HttpError(404, t('Schlüssel nicht gefunden'));
      reply.type('application/pgp-keys; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="${request.params.fingerabdruck.slice(-16)}.asc"`,
      );
      return text;
    },
  );

  /** Ein neues Schluesselpaar. Der geheime Teil landet gleich im Bund. */
  app.post<{ Params: { id: string }; Body: { kennwort?: string; art?: 'curve25519' | 'rsa4096' } }>(
    '/accounts/:id/schluesselpaar',
    async (request) => {
      const account = requireAccount(request.params.id);
      const erzeugt = await erzeugeSchluesselpaar({
        name: account.displayName,
        adresse: account.email,
        kennwort: request.body?.kennwort,
        art: request.body?.art,
      });
      await fuegeSchluesselHinzu(erzeugt.geheim, account.id);
      await fuegeSchluesselHinzu(erzeugt.oeffentlich);
      return { angaben: erzeugt.angaben, oeffentlich: erzeugt.oeffentlich };
    },
  );

  /**
   * Was fuer ein Konto moeglich ist: eigener Schluessel vorhanden, und fuer welche
   * Empfaenger einer vorliegt. Danach richtet sich, was die Oberflaeche anbietet.
   */
  app.get<{ Params: { id: string }; Querystring: { an?: string } }>(
    '/accounts/:id/pgp-lage',
    async (request) => {
      const account = requireAccount(request.params.id);
      const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
      const empfaenger = (request.query.an ?? '')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);

      return {
        kannSignieren: hatGeheimen(account.id, adressen),
        // Verschluesselt wird nur, wenn fuer JEDEN Empfaenger ein Schluessel vorliegt -
        // einen zu uebergehen hiesse, ihm eine unlesbare Nachricht zu schicken.
        kannVerschluesseln:
          empfaenger.length > 0 && empfaenger.every((a) => oeffentlicheFuer(a).length > 0),
        ohneSchluessel: empfaenger.filter((a) => oeffentlicheFuer(a).length === 0),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { kennwort?: string } }>(
    '/accounts/:id/pgp-kennwort',
    async (request) => {
      const account = requireAccount(request.params.id);
      const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
      return { stimmt: await kennwortStimmt(account.id, adressen, request.body?.kennwort ?? '') };
    },
  );

  /**
   * Prueft und oeffnet, was an einer Nachricht mit OpenPGP geschuetzt ist.
   *
   * Eigener Aufruf statt Teil des Nachrichtenabrufs: das Pruefen holt die Nachricht ein
   * zweites Mal im Original und kann bei einem verschlossenen Schluessel nach dem
   * Kennwort verlangen. Beides gehoert nicht in den Weg, den jede Nachricht nimmt.
   */
  app.post<{
    Params: { id: string; folder: string; uid: string };
    Body: { kennwort?: string };
  }>('/accounts/:id/folders/:folder/messages/:uid/pgp', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const uid = uidAus(request.params.uid);

    const nachricht = await getMessage(account, ordner, uid);
    const struktur = await getBodyStructure(account, ordner, uid);
    const befund = await pruefePgp(account, ordner, nachricht, struktur, request.body?.kennwort);
    return befund ?? { verschluesselt: false, geoeffnet: true, ohnePgp: true };
  });

  // --- S/MIME: der Zertifikatsspeicher ---

  app.get('/smime', async () => alleZertifikate());

  /**
   * Eine Schluesseldatei einlesen.
   *
   * Die Datei kommt als Base64 herein und nicht als Datei-Upload: Der Server nimmt sonst
   * nirgends Dateien entgegen, und eine zweite Art, Daten hereinzureichen, waere eine
   * zweite Stelle, an der man sich vertun kann. Das Kennwort geht denselben Weg und wird
   * nirgends abgelegt - es dient nur zum Oeffnen.
   */
  app.post<{
    Body: {
      dateiBase64?: string;
      kennwort?: string;
      /** Kennwort, mit dem der Schluessel hier abgelegt wird. Leer = nur Windows-Schutz. */
      neuesKennwort?: string;
      fuerKonto?: string;
    };
  }>('/smime/schluesseldatei', async (request) => {
    const roh = request.body?.dateiBase64;
    if (typeof roh !== 'string' || !roh.trim()) {
      throw new HttpError(400, t('Es wurde keine Datei übergeben'));
    }
    try {
      return fuegeSchluesseldateiHinzu(Buffer.from(roh, 'base64'), request.body?.kennwort ?? '', {
        fuerKonto: request.body?.fuerKonto,
        neuesKennwort: request.body?.neuesKennwort || undefined,
      });
    } catch (err) {
      if (err instanceof ZertifikatsspeicherFehler) throw new HttpError(400, err.message);
      throw new HttpError(400, (err as Error).message);
    }
  });

  /** Ein einzelnes Zertifikat - der Weg fuer jemanden, der noch nie unterschrieben schrieb. */
  app.post<{ Body: { dateiBase64?: string } }>('/smime/zertifikat', async (request) => {
    const roh = request.body?.dateiBase64;
    if (typeof roh !== 'string' || !roh.trim()) {
      throw new HttpError(400, t('Es wurde keine Datei übergeben'));
    }
    try {
      return fuegeZertifikatHinzu(Buffer.from(roh, 'base64'));
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.delete<{ Params: { fingerabdruck: string } }>('/smime/:fingerabdruck', async (request) => {
    if (!entferneZertifikat(request.params.fingerabdruck.toUpperCase())) {
      throw new HttpError(404, t('Zertifikat nicht gefunden'));
    }
    return { ok: true };
  });

  app.get<{ Params: { fingerabdruck: string } }>(
    '/smime/:fingerabdruck/ausfuhr',
    async (request, reply) => {
      const text = smimeAlsPem(request.params.fingerabdruck.toUpperCase());
      if (!text) throw new HttpError(404, t('Zertifikat nicht gefunden'));
      reply.type('application/x-pem-file; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="${request.params.fingerabdruck.slice(0, 16)}.pem"`,
      );
      return text;
    },
  );

  app.get<{ Params: { id: string }; Querystring: { an?: string } }>(
    '/accounts/:id/smime-lage',
    async (request) => {
      const account = requireAccount(request.params.id);
      const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
      const empfaenger = (request.query.an ?? '')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const eigene = eigeneFuer(account.id, adressen);

      return {
        kannSignieren: eigene.length > 0,
        /** Ob beim Unterschreiben nach einem Kennwort gefragt werden muss. */
        brauchtKennwort: eigene.some((e) => e.mitKennwort),
        kannVerschluesseln:
          eigene.length > 0 &&
          empfaenger.length > 0 &&
          empfaenger.every((a) => zertifikateFuer(a).length > 0),
        ohneZertifikat: empfaenger.filter((a) => zertifikateFuer(a).length === 0),
      };
    },
  );

  app.post<{ Params: { id: string }; Body: { kennwort?: string } }>(
    '/accounts/:id/smime-kennwort',
    async (request) => {
      const account = requireAccount(request.params.id);
      const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
      return { stimmt: smimeKennwortStimmt(account.id, adressen, request.body?.kennwort ?? '') };
    },
  );

  /** Prueft und oeffnet, was an einer Nachricht mit S/MIME geschuetzt ist. */
  app.post<{
    Params: { id: string; folder: string; uid: string };
    Body: { kennwort?: string };
  }>('/accounts/:id/folders/:folder/messages/:uid/smime', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const nachricht = await getMessage(account, ordner, uidAus(request.params.uid));
    const befund = await pruefeSmime(account, ordner, nachricht, request.body?.kennwort);
    return befund ?? { verschluesselt: false, geoeffnet: true, ohneSmime: true };
  });
}
