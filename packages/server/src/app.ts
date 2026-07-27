import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocketPlugin from '@fastify/websocket';
import {
  CATEGORY_UNSUPPORTED,
  GMAIL_CATEGORIES,
  closeConnection,
  deleteMessages,
  discardDraft,
  downloadAttachment,
  getMailScope,
  getMessage,
  getProviderId,
  hasMailScope,
  isReauthRequired,
  listCategories,
  listFolders,
  listMessages,
  moveMessages,
  saveDraft,
  searchMessages,
  sendMessage,
  setMessagesSeen,
  verifyImapConnection,
  verifySmtpConnection,
  type AccountConfig,
  type GmailCategory,
  type OAuthProviderId,
  type OutgoingMessage,
} from '@energy-mail/mail-core';
import Fastify from 'fastify';
import {
  buildOAuthAccount,
  buildPasswordAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  saveAccount,
  updateAccountAuth,
  updateAccountSettings,
} from './accountStore.js';
import { ausSpeicherOderHolen, schluessel, verwerfe, verwerfeKonto } from './cache.js';
import { rememberAddresses, searchContacts } from './contactStore.js';
import { clearFlow, getFlow, startOAuthFlow } from './oauthFlow.js';
import { listOAuthClients, removeOAuthClient, setOAuthClient } from './oauthStore.js';
import { installTokenRefresh } from './tokenRefresh.js';
import {
  meldeAktualisierung,
  restartWatcher,
  setRegistryLogger,
  subscribe,
  syncWatchers,
} from './watcherRegistry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Liegt sowohl von src/ (tsx) als auch von dist/ aus eine Ebene unter packages/server.
const webDistDir = path.join(__dirname, '..', '..', 'web', 'dist');

/**
 * Fastify erlaubt standardmäßig nur 1 MB Anfragekörper - damit wäre schon ein kleiner
 * Anhang nicht versendbar. Base64 bläht Dateien um rund ein Drittel auf, 40 MB Limit
 * entsprechen also etwa 30 MB tatsächlicher Anhangsgröße.
 */
const BODY_LIMIT_BYTES = 40 * 1024 * 1024;

function publicAccount(account: AccountConfig) {
  // Zugangsdaten bleiben bewusst draußen - nach außen nur, was die Oberfläche braucht.
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    signature: account.signature,
    // Bestimmt Farbgebung und anbietereigene Aktionen in der Oberfläche.
    provider: getProviderId(
      account.email,
      account.auth.type === 'oauth2' ? account.auth.provider : undefined,
    ),
    // Nur OAuth-Konten lassen sich neu anmelden; bei Passwort-Konten wäre der Knopf
    // sinnlos, dort ändert man das Passwort in den Einstellungen.
    canReauth: account.auth.type === 'oauth2',
    needsReauth: Boolean(account.authExpired),
  };
}

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function buildServer() {
  const app = Fastify({ logger: true, bodyLimit: BODY_LIMIT_BYTES });

  await app.register(cors, { origin: true });
  await app.register(websocketPlugin);

  function requireAccount(id: string): AccountConfig {
    const account = getAccount(id);
    if (!account) throw new HttpError(404, 'Konto nicht gefunden');
    return account;
  }

  app.setErrorHandler((err: unknown, _request, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    // Eine Einordnung bei einem Anbieter zu verlangen, der sie nicht kennt, ist eine
    // unpassende Anfrage - kein Serverfehler.
    if ((err as { code?: string }).code === CATEGORY_UNSUPPORTED) {
      reply.code(400).send({ error: (err as Error).message });
      return;
    }
    // Abgelaufene Anmeldung: 401 statt 500 - hier ist nichts kaputt, es fehlt die
    // Berechtigung. Das Konto ist zu diesem Zeitpunkt bereits gekennzeichnet, die
    // Oberfläche zeigt daher gleich den Knopf zum Neuanmelden.
    if (isReauthRequired(err)) {
      reply.code(401).send({ error: (err as Error).message });
      return;
    }
    app.log.error(err);
    // Lokale Einzelplatz-Anwendung: die konkrete Meldung ist hier deutlich hilfreicher
    // als ein generisches "Interner Fehler" - etwa bei Entschlüsselungsproblemen.
    reply.code(500).send({ error: err instanceof Error ? err.message : 'Interner Fehler' });
  });

  app.post<{ Body: { email?: string; password?: string } }>('/accounts', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (!email || !password) {
      reply.code(400);
      return { error: 'E-Mail und Passwort sind erforderlich' };
    }

    let account: AccountConfig;
    try {
      account = buildPasswordAccount({ email, password });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }

    // Erst prüfen, dann speichern - so landen keine unbrauchbaren Konten im Store.
    try {
      await verifyImapConnection(account);
    } catch (err) {
      reply.code(400);
      return { error: `IMAP-Verbindung fehlgeschlagen (${account.imapHost}): ${(err as Error).message}` };
    }
    try {
      await verifySmtpConnection(account);
    } catch (err) {
      reply.code(400);
      return { error: `SMTP-Verbindung fehlgeschlagen (${account.smtpHost}): ${(err as Error).message}` };
    }

    saveAccount(account);
    syncWatchers();
    return publicAccount(account);
  });

  app.get('/accounts', async () => {
    return listAccounts().map(publicAccount);
  });

  app.patch<{ Params: { id: string }; Body: { displayName?: string; signature?: string } }>(
    '/accounts/:id',
    async (request) => {
      const updated = updateAccountSettings(request.params.id, {
        displayName: request.body?.displayName,
        signature: request.body?.signature,
      });
      if (!updated) throw new HttpError(404, 'Konto nicht gefunden');
      return publicAccount(updated);
    },
  );

  app.get<{ Querystring: { q?: string } }>('/contacts', async (request) => {
    return searchContacts(request.query.q ?? '');
  });

  // --- OAuth: Einrichtung der Anbieter-Zugangsdaten ---

  app.get('/oauth/clients', async () => listOAuthClients());

  app.put<{ Params: { provider: OAuthProviderId }; Body: { clientId?: string; clientSecret?: string } }>(
    '/oauth/clients/:provider',
    async (request) => {
      const { clientId, clientSecret } = request.body ?? {};
      if (!clientId?.trim()) throw new HttpError(400, 'Client-ID ist erforderlich');
      setOAuthClient(request.params.provider, { clientId, clientSecret });
      return listOAuthClients();
    },
  );

  app.delete<{ Params: { provider: OAuthProviderId } }>('/oauth/clients/:provider', async (request) => {
    removeOAuthClient(request.params.provider);
    return listOAuthClients();
  });

  // --- OAuth: Anmeldung ---

  app.post<{ Params: { provider: OAuthProviderId } }>('/oauth/:provider/start', async (request) => {
    try {
      // Die Oberfläche öffnet die Adresse im Systembrowser; eingebettete Fenster werden
      // von den Anbietern abgewiesen.
      return await startOAuthFlow(request.params.provider);
    } catch (err) {
      // Fehlende oder unbrauchbare Einrichtung ist ein Anwenderfehler, kein Serverfehler.
      throw new HttpError(400, (err as Error).message);
    }
  });

  /**
   * Meldet ein bestehendes Konto neu an. Nötig, wenn der Anbieter die hinterlegte
   * Anmeldung nicht mehr anerkennt - bei Google verfallen Refresh-Token nach sieben
   * Tagen, solange das Cloud-Projekt im Testbetrieb steht.
   *
   * Bewusst kein Löschen-und-neu-Anlegen: das Konto behält Kennung, Anzeigename und
   * Signatur, und in der Oberfläche bleibt die Auswahl stehen.
   */
  app.post<{ Params: { id: string } }>('/accounts/:id/reauth', async (request) => {
    const account = requireAccount(request.params.id);
    if (account.auth.type !== 'oauth2') {
      throw new HttpError(
        400,
        'Dieses Konto meldet sich mit Passwort an - eine Neuanmeldung über den Anbieter gibt es dafür nicht.',
      );
    }
    try {
      return await startOAuthFlow(account.auth.provider, account.id);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.get<{ Params: { state: string } }>('/oauth/status/:state', async (request, reply) => {
    const flow = getFlow(request.params.state);
    if (!flow) throw new HttpError(404, 'Unbekannter oder abgelaufener Anmeldevorgang');
    if (flow.status.status !== 'done') return flow.status;

    const { tokens } = flow.status;
    if (!tokens.email) {
      clearFlow(request.params.state);
      reply.code(400);
      return { status: 'error', error: 'Der Anbieter hat keine Mailadresse mitgeteilt.' };
    }

    // --- Neuanmeldung eines bestehenden Kontos ---
    if (flow.accountId) {
      const vorhanden = getAccount(flow.accountId);
      clearFlow(request.params.state);
      if (!vorhanden) {
        reply.code(404);
        return { status: 'error', error: 'Das Konto gibt es nicht mehr.' };
      }

      // Sonst würde sich das Konto still auf ein anderes Postfach umstellen, während in
      // der Oberfläche weiterhin die alte Adresse steht.
      if (vorhanden.email.toLowerCase() !== tokens.email.toLowerCase()) {
        reply.code(400);
        return {
          status: 'error',
          error:
            `Angemeldet wurde ${tokens.email}, dieses Konto ist aber ${vorhanden.email}. ` +
            'Bitte mit derselben Adresse anmelden oder das andere Postfach als neues Konto hinzufügen.',
        };
      }

      if (!hasMailScope(flow.provider, tokens.grantedScopes)) {
        reply.code(400);
        return {
          status: 'error',
          error:
            'Die Anmeldung war erfolgreich, aber der Zugriff auf E-Mails wurde nicht gewährt ' +
            `(erforderlich: "${getMailScope(flow.provider)}").`,
        };
      }

      const erneuert: AccountConfig = {
        ...vorhanden,
        auth: {
          type: 'oauth2',
          provider: flow.provider,
          user: vorhanden.email,
          accessToken: tokens.accessToken,
          // Liefert der Anbieter kein neues Refresh-Token, gilt das bisherige weiter.
          // Es hier zu überschreiben würde die Anmeldung nach einer Stunde erneut
          // scheitern lassen - und zwar ohne Aussicht auf Erneuerung.
          refreshToken:
            tokens.refreshToken ??
            (vorhanden.auth.type === 'oauth2' ? vorhanden.auth.refreshToken : undefined),
          expiresAt: tokens.expiresAt,
        },
      };

      try {
        await verifyImapConnection(erneuert);
      } catch (err) {
        reply.code(400);
        return {
          status: 'error',
          error: `IMAP-Verbindung fehlgeschlagen (${erneuert.imapHost}): ${(err as Error).message}`,
        };
      }

      // Reihenfolge zählt: erst speichern (hebt zugleich "abgelaufen" auf), dann die
      // gepoolte Verbindung verwerfen - sie hängt noch an der abgelehnten Anmeldung -,
      // dann die Überwachung neu starten.
      updateAccountAuth(erneuert.id, erneuert.auth);
      closeConnection(erneuert.id);
      restartWatcher(erneuert.id);
      app.log.info(`OAuth ${flow.provider}: ${erneuert.email} neu angemeldet`);

      return { status: 'done', account: publicAccount(getAccount(erneuert.id) ?? erneuert) };
    }

    const bereits = listAccounts().find(
      (account) => account.email.toLowerCase() === tokens.email!.toLowerCase(),
    );
    if (bereits) {
      clearFlow(request.params.state);
      reply.code(409);
      // Bei abgelaufener Anmeldung ist "bereits eingerichtet" die falsche Fährte - dann
      // wollte der Nutzer vermutlich genau dieses Konto wieder flottmachen.
      return {
        status: 'error',
        error: bereits.authExpired
          ? `${tokens.email} ist bereits eingerichtet, die Anmeldung ist nur abgelaufen. ` +
            'Nutze beim Konto "Neu anmelden" – dann bleiben Signatur und Einstellungen erhalten.'
          : `${tokens.email} ist bereits eingerichtet.`,
      };
    }

    app.log.info(
      `OAuth ${flow.provider}: Anmeldung für ${tokens.email}, gewährte Bereiche: ` +
        `${tokens.grantedScopes?.join(' ') ?? '(nicht mitgeteilt)'}` +
        `, Refresh-Token: ${tokens.refreshToken ? 'ja' : 'nein'}`,
    );

    // Ohne den Mail-Bereich schlägt der IMAP-Login mit "Invalid credentials" fehl - eine
    // Meldung, die auf ein falsches Passwort hindeutet und in die Irre führt.
    if (!hasMailScope(flow.provider, tokens.grantedScopes)) {
      clearFlow(request.params.state);
      reply.code(400);
      return {
        status: 'error',
        error:
          `Die Anmeldung war erfolgreich, aber der Zugriff auf E-Mails wurde nicht gewährt. ` +
          `Erforderlich ist der Bereich "${getMailScope(flow.provider)}". ` +
          `Gewährt wurde: ${tokens.grantedScopes?.join(', ') || 'nichts'}. ` +
          `Trage den Bereich beim Anbieter (OAuth-Zustimmungsbildschirm bzw. API-Berechtigungen) ` +
          `nach und melde dich erneut an.`,
      };
    }

    if (!tokens.refreshToken) {
      app.log.warn(
        `OAuth ${flow.provider}: kein Refresh-Token erhalten - die Anmeldung verfällt in etwa einer Stunde.`,
      );
    }

    const account = buildOAuthAccount({
      email: tokens.email,
      provider: flow.provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    // Wie beim Passwort-Konto: erst prüfen, dann speichern.
    try {
      await verifyImapConnection(account);
    } catch (err) {
      clearFlow(request.params.state);
      reply.code(400);
      const meldung = (err as Error).message;
      // Gmail antwortet auf ein Token ohne Mailzugriff mit "Invalid credentials" - was
      // nach falschem Passwort klingt, obwohl die Anmeldung selbst geklappt hat.
      const hinweis = /invalid credentials|authentication failed/i.test(meldung)
        ? ' Die Anmeldung selbst war erfolgreich, der Server lehnt aber das Token ab. ' +
          'Häufigste Ursachen: der Mail-Bereich fehlt in der Anbieter-Konfiguration, ' +
          'IMAP ist im Postfach abgeschaltet, oder die Berechtigungen wurden nach der ' +
          'letzten Zustimmung geändert (dann erneut anmelden).'
        : '';
      return {
        status: 'error',
        error: `IMAP-Verbindung fehlgeschlagen (${account.imapHost}): ${meldung}.${hinweis}`,
      };
    }

    saveAccount(account);
    syncWatchers();
    clearFlow(request.params.state);
    return { status: 'done', account: publicAccount(account) };
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id', async (request, reply) => {
    if (!deleteAccount(request.params.id)) {
      reply.code(404);
      return { error: 'Konto nicht gefunden' };
    }
    // Gepoolte Verbindung schließen, sonst bliebe sie bis zum Leerlauf-Timeout offen.
    closeConnection(request.params.id);
    // Sonst blieben Kopfdaten eines entfernten Kontos auf der Platte liegen.
    verwerfeKonto(request.params.id);
    syncWatchers();
    return { ok: true };
  });

  /**
   * Wie lange ein zwischengespeicherter Stand ohne Nachfrage gilt. Bewusst kurz: die
   * Fristen bestimmen nicht, wie alt Angezeigtes sein darf, sondern nur, wie oft im
   * Hintergrund nachgesehen wird. Veraltetes wird ohnehin sofort ersetzt, sobald die
   * Auffrischung durch ist - und bei neuer Post verwirft der Watcher die Stände direkt.
   */
  const FRIST_ORDNER_MS = 20_000;
  const FRIST_EINORDNUNG_MS = 120_000;
  const FRIST_NACHRICHTEN_MS = 20_000;

  /** Muss zu mail-core passen; steht hier, damit der Schlüssel des Speichers eindeutig ist. */
  const DEFAULT_SEITENGROESSE = 25;

  /**
   * Verwirft die zwischengespeicherten Stände nach einer Änderung durch die Anwendung
   * selbst.
   *
   * Der Watcher erledigt das für Änderungen von außen, greift aber nur im Posteingang -
   * und eine gerade gelöschte oder verschobene Nachricht darf beim nächsten Abruf nicht
   * wieder auftauchen. Ordnerliste und Einordnung kommen mit, weil sich deren
   * Ungelesen-Zähler mitverschieben.
   */
  function verwerfeStaende(accountId: string, ...ordner: (string | undefined)[]): void {
    for (const eintrag of ordner) {
      if (eintrag) verwerfe(`nachrichten:${accountId}:${eintrag}:`);
    }
    verwerfe(schluessel.ordner(accountId));
    verwerfe(schluessel.einordnung(accountId));
  }

  app.get<{ Params: { id: string } }>('/accounts/:id/folders', async (request) => {
    const account = requireAccount(request.params.id);
    const { wert } = await ausSpeicherOderHolen(
      schluessel.ordner(account.id),
      () => listFolders(account),
      {
        maxAlterMs: FRIST_ORDNER_MS,
        beiAenderung: () => meldeAktualisierung({ type: 'data-updated', accountId: account.id, was: 'folders' }),
      },
    );
    return wert;
  });

  /**
   * Gmails Einordnung des Posteingangs. Für alle anderen Anbieter eine leere Liste - die
   * Entscheidung fällt an der IMAP-Erweiterung des Servers, nicht an der Adresse.
   */
  app.get<{ Params: { id: string } }>('/accounts/:id/categories', async (request) => {
    const account = requireAccount(request.params.id);
    // Der teuerste Abruf überhaupt: vier Suchläufe über den gesamten Posteingang, rund
    // 1,2 Sekunden bei 30.000 Nachrichten. Ohne Zwischenspeicher lief er bei jedem Start
    // und bei jedem Kontowechsel erneut.
    const { wert } = await ausSpeicherOderHolen(
      schluessel.einordnung(account.id),
      () => listCategories(account),
      {
        maxAlterMs: FRIST_EINORDNUNG_MS,
        beiAenderung: () =>
          meldeAktualisierung({ type: 'data-updated', accountId: account.id, was: 'categories' }),
      },
    );
    return wert;
  });

  /** Prüft den Wert aus der Anfrage gegen die bekannten Einordnungen. */
  function parseCategory(value: string | undefined): GmailCategory | undefined {
    if (!value) return undefined;
    const treffer = GMAIL_CATEGORIES.find((category) => category === value);
    if (!treffer) throw new HttpError(400, `Unbekannte Einordnung "${value}"`);
    return treffer;
  }

  app.get<{
    Params: { id: string; folder: string };
    Querystring: { beforeUid?: string; pageSize?: string; category?: string };
  }>('/accounts/:id/folders/:folder/messages', async (request) => {
    const account = requireAccount(request.params.id);
    const { beforeUid, pageSize, category } = request.query;
    const ordner = decodeURIComponent(request.params.folder);
    const einordnung = parseCategory(category);

    const groesse = pageSize ? Number(pageSize) : DEFAULT_SEITENGROESSE;

    const holen = async () => {
      const seite = await listMessages(account, ordner, {
        beforeUid: beforeUid ? Number(beforeUid) : undefined,
        pageSize: groesse,
        category: einordnung,
      });

      // Nebenbei Adressen einsammeln - daraus entstehen die Vorschläge beim Verfassen,
      // ohne dass jemand ein Adressbuch pflegen muss. Bewusst hier drin: aus dem
      // Zwischenspeicher beantwortete Anfragen sollen die Zähler nicht hochtreiben.
      for (const message of seite.messages) {
        rememberAddresses([...message.from, ...message.to, ...message.cc], message.date ?? undefined);
      }
      return seite;
    };

    // Nur die erste Seite kommt in den Zwischenspeicher. Nachgeladene ältere Seiten holt
    // man einmal beim Blättern - dort wartet man ohnehin auf etwas Neues, und sie alle
    // vorzuhalten würde den Speicher bei großen Postfächern vollaufen lassen.
    if (beforeUid) return holen();

    const { wert } = await ausSpeicherOderHolen(
      schluessel.nachrichten(account.id, ordner, einordnung, groesse),
      holen,
      {
        maxAlterMs: FRIST_NACHRICHTEN_MS,
        beiAenderung: () =>
          meldeAktualisierung({
            type: 'data-updated',
            accountId: account.id,
            was: 'messages',
            folder: ordner,
            category: einordnung,
          }),
      },
    );
    return wert;
  });

  app.get<{ Params: { id: string; folder: string; uid: string } }>(
    '/accounts/:id/folders/:folder/messages/:uid',
    async (request) => {
      const account = requireAccount(request.params.id);
      return getMessage(account, decodeURIComponent(request.params.folder), Number(request.params.uid));
    },
  );

  /**
   * Sammelaktionen nehmen eine UID-Liste entgegen. Eine einzeln markierte Nachricht ist
   * schlicht eine Liste mit einem Eintrag - dadurch gibt es nur einen Weg im Code, und
   * das Markieren von 20 Mails braucht trotzdem nur eine IMAP-Verbindung.
   */
  function parseUids(value: unknown): number[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new HttpError(400, 'Feld "uids" (nicht leere Liste) ist erforderlich');
    }
    const uids = value.map(Number);
    if (uids.some((uid) => !Number.isInteger(uid) || uid <= 0)) {
      throw new HttpError(400, 'Feld "uids" enthält ungültige Werte');
    }
    return uids;
  }

  app.patch<{ Params: { id: string; folder: string }; Body: { uids?: unknown; seen?: boolean } }>(
    '/accounts/:id/folders/:folder/messages',
    async (request) => {
      const account = requireAccount(request.params.id);
      if (typeof request.body?.seen !== 'boolean') {
        throw new HttpError(400, 'Feld "seen" (true/false) ist erforderlich');
      }
      const ordner = decodeURIComponent(request.params.folder);
      await setMessagesSeen(account, ordner, parseUids(request.body.uids), request.body.seen);
      verwerfeStaende(account.id, ordner);
      return { ok: true };
    },
  );

  app.get<{ Params: { id: string; folder: string; uid: string; partId: string } }>(
    '/accounts/:id/folders/:folder/messages/:uid/attachments/:partId',
    async (request, reply) => {
      const account = requireAccount(request.params.id);
      const attachment = await downloadAttachment(
        account,
        decodeURIComponent(request.params.folder),
        Number(request.params.uid),
        request.params.partId,
      );

      // RFC 5987: filename* transportiert Umlaute zuverlässig, filename bleibt als
      // Rückfallweg für ältere Empfänger erhalten.
      const asciiName = attachment.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      reply
        .header('Content-Type', attachment.contentType)
        .header('Content-Length', attachment.size)
        .header(
          'Content-Disposition',
          `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        );
      return reply.send(attachment.content);
    },
  );

  app.post<{
    Params: { id: string; folder: string };
    Body: { uids?: unknown; targetFolder?: string };
  }>('/accounts/:id/folders/:folder/messages/move', async (request) => {
    const account = requireAccount(request.params.id);
    if (!request.body?.targetFolder) {
      throw new HttpError(400, 'Feld "targetFolder" ist erforderlich');
    }
    const ordner = decodeURIComponent(request.params.folder);
    await moveMessages(account, ordner, parseUids(request.body.uids), request.body.targetFolder);
    verwerfeStaende(account.id, ordner, request.body.targetFolder);
    return { ok: true };
  });

  app.post<{ Params: { id: string; folder: string }; Body: { uids?: unknown } }>(
    '/accounts/:id/folders/:folder/messages/delete',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      await deleteMessages(account, ordner, parseUids(request.body?.uids));
      verwerfeStaende(account.id, ordner);
      return { ok: true };
    },
  );

  app.get<{
    Params: { id: string; folder: string };
    Querystring: { q?: string; beforeUid?: string; pageSize?: string; category?: string };
  }>('/accounts/:id/folders/:folder/search', async (request) => {
    const account = requireAccount(request.params.id);
    const { q, beforeUid, pageSize, category } = request.query;
    if (!q) return { messages: [], total: 0, nextCursor: null, hasMore: false };
    return searchMessages(account, decodeURIComponent(request.params.folder), q, {
      beforeUid: beforeUid ? Number(beforeUid) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      category: parseCategory(category),
    });
  });

  /** Anhänge kommen über JSON, daher base64-kodiert - hier zurück in Rohbytes. */
  interface WireAttachment {
    filename?: string;
    contentType?: string;
    contentBase64?: string;
  }

  /**
   * Beim Weiterleiten sollen die Anhänge der Ursprungsnachricht übernommen werden.
   * Der Server holt sie direkt per IMAP - anders müssten sie erst zum Browser
   * heruntergeladen und base64-kodiert wieder hochgeladen werden.
   */
  interface ForwardSource {
    folder: string;
    uid: number;
    partIds: string[];
  }

  type SendBody = Omit<OutgoingMessage, 'attachments'> & {
    attachments?: WireAttachment[];
    attachOriginal?: ForwardSource;
  };

  type Attachment = NonNullable<OutgoingMessage['attachments']>[number];

  /**
   * Führt hochgeladene und aus einer bestehenden Nachricht übernommene Anhänge zusammen.
   * Wird beim Senden wie beim Speichern eines Entwurfs gebraucht.
   */
  async function collectAttachments(
    account: AccountConfig,
    wire: WireAttachment[] | undefined,
    source: ForwardSource | undefined,
  ): Promise<Attachment[]> {
    const attachments: Attachment[] = (wire ?? []).map((att, index) => {
      if (!att.contentBase64) {
        throw new HttpError(400, `Anhang ${index + 1} enthält keine Daten.`);
      }
      return {
        filename: att.filename || `anhang-${index + 1}`,
        content: Buffer.from(att.contentBase64, 'base64'),
        contentType: att.contentType || undefined,
      };
    });

    for (const partId of source?.partIds ?? []) {
      const original = await downloadAttachment(
        account,
        decodeURIComponent(source!.folder),
        Number(source!.uid),
        partId,
      );
      attachments.push({
        filename: original.filename,
        content: original.content,
        contentType: original.contentType,
      });
    }

    return attachments;
  }

  app.post<{
    Params: { id: string };
    Body: SendBody & { draftFolder?: string; draftUid?: number };
  }>('/accounts/:id/send', async (request, reply) => {
    const account = requireAccount(request.params.id);
    const { attachOriginal, attachments: wire, draftFolder, draftUid, ...message } = request.body;
    const attachments = await collectAttachments(account, wire, attachOriginal);

    try {
      // Das Ergebnis enthält auch, ob die Kopie im Gesendet-Ordner abgelegt werden
      // konnte - die Oberfläche weist darauf hin, ohne den Versand infrage zu stellen.
      const result = await sendMessage(account, { ...message, attachments });

      // Nach erfolgreichem Versand hat der Entwurf ausgedient.
      if (draftFolder && draftUid) {
        try {
          await discardDraft(account, decodeURIComponent(draftFolder), draftUid);
        } catch (err) {
          app.log.warn(`Entwurf konnte nicht entfernt werden: ${(err as Error).message}`);
        }
      }

      rememberAddresses(
        [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map((address) => ({ address })),
      );

      // Im Gesendet-Ordner liegt jetzt eine Nachricht mehr, im Entwürfe-Ordner eine
      // weniger.
      verwerfeStaende(account.id, result.sentFolder, draftFolder && decodeURIComponent(draftFolder));

      return { ok: true, ...result };
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  app.post<{
    Params: { id: string };
    Body: SendBody & { previousUid?: number };
  }>('/accounts/:id/drafts', async (request) => {
    const account = requireAccount(request.params.id);
    const { attachOriginal, previousUid, attachments: wire, ...message } = request.body;

    const attachments = await collectAttachments(account, wire, attachOriginal);
    const result = await saveDraft(
      account,
      { ...message, to: message.to ?? [], subject: message.subject ?? '', attachments },
      previousUid,
    );
    verwerfeStaende(account.id, result.folder);
    return { ok: true, ...result };
  });

  app.delete<{ Params: { id: string; folder: string; uid: string } }>(
    '/accounts/:id/drafts/:folder/:uid',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      await discardDraft(account, ordner, Number(request.params.uid));
      verwerfeStaende(account.id, ordner);
      return { ok: true };
    },
  );

  // Ein Kanal für alle Konten: der Client bekommt jedes Ereignis mitsamt accountId
  // und entscheidet selbst, ob das die gerade sichtbare Ansicht betrifft.
  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = subscribe((event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  // Gebautes Frontend mitausliefern, sofern vorhanden. Dadurch laufen UI und API auf
  // derselben Origin (kein CORS nötig) und die Desktop-App kann http:// statt file://
  // laden - file:// würde an den absoluten /assets-Pfaden des Vite-Builds scheitern.
  // Im Web-Dev-Modus (Vite auf Port 5173) existiert der Ordner nicht, dann greift CORS.
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
    app.log.info(`Frontend wird ausgeliefert aus ${webDistDir}`);
  } else {
    app.log.warn(`Kein gebautes Frontend gefunden (${webDistDir}) - nur API verfügbar.`);
  }

  // Überwachung aller hinterlegten Konten sofort starten, nicht erst wenn sich ein
  // Client verbindet - so ist der erste Verbinder direkt auf aktuellem Stand.
  setRegistryLogger({
    info: (msg) => app.log.info(msg),
    warn: (msg) => app.log.warn(msg),
  });

  // Muss vor den Watchern stehen: OAuth-Konten brauchen beim Verbinden ein gültiges
  // Zugriffstoken, und das wird hier bei Bedarf erneuert und gespeichert.
  installTokenRefresh((msg) => app.log.warn(msg));

  syncWatchers();

  return app;
}
