import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocketPlugin from '@fastify/websocket';
import {
  ATTACHMENT_SEARCH_UNSUPPORTED,
  CATEGORY_UNSUPPORTED,
  GMAIL_CATEGORIES,
  closeConnection,
  createFolder,
  deleteFolder,
  deleteMessages,
  emptyFolder,
  markFolderSeen,
  renameFolder,
  discardDraft,
  downloadAttachment,
  bestimmeAbmeldung,
  findSpecialFolder,
  getCapabilities,
  getMailScope,
  getMessage,
  getProviderId,
  hasMailScope,
  isReauthRequired,
  leseAbmeldeWege,
  listCategories,
  listFolders,
  listMessages,
  moveMessages,
  sendeEinKlickAbmeldung,
  offeneVorgaenge,
  senderUebersicht,
  verschiebeVonAbsender,
  saveDraft,
  searchFolders,
  searchMessages,
  sendMessage,
  setMessagesSeen,
  verifyImapConnection,
  verifySmtpConnection,
  type AccountConfig,
  type GmailCategory,
  type OAuthProviderId,
  type OutgoingMessage,
  type Regel,
  type RegelBedingung,
  type SearchCriteria,
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
import {
  WIEDERVORLAGE_ORDNER,
  ladeWiedervorlagen,
  listeWiedervorlagen,
  setWiedervorlageUmgebung,
  sofortZurueck,
  stelleZurueck,
} from './snooze.js';
import {
  ladeGeplanteSendungen,
  listeGeplanteSendungen,
  planeSendung,
  setSendeVerfahren,
  storniereSendung,
} from './sendQueue.js';
import {
  istBrauchbar,
  passt,
  regelLoeschen,
  regelSpeichern,
  regelnFuer,
  regelnVerwerfen,
  wendeRegelnAn,
} from './rules.js';
import { merkeAusListe, rememberAddresses, searchContacts } from './contactStore.js';
import {
  istVertraut,
  vertrauenEntziehen,
  vertrauenGeben,
  vertrauenVerwerfen,
  vertrauteAbsender,
} from './trustedSenders.js';
import {
  aktualisiereGelesen,
  liesNachricht,
  merkeNachricht,
  nachrichtenSchluessel,
  verwirfNachrichten,
} from './messageCache.js';
import { clearFlow, getFlow, startOAuthFlow } from './oauthFlow.js';
import { listOAuthClients, removeOAuthClient, setOAuthClient } from './oauthStore.js';
import { installTokenRefresh } from './tokenRefresh.js';
import {
  meldeAktualisierung,
  meldeAnsicht,
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
    if (
      (err as { code?: string }).code === CATEGORY_UNSUPPORTED ||
      (err as { code?: string }).code === ATTACHMENT_SEARCH_UNSUPPORTED
    ) {
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
    verwirfNachrichten(`${request.params.id}:`);
    regelnVerwerfen(request.params.id);
    vertrauenVerwerfen(request.params.id);
    syncWatchers();
    return { ok: true };
  });

  // --- Vertraute Absender ---

  /**
   * Entfernte Inhalte sind grundsätzlich angehalten - sie melden dem Absender, dass
   * gelesen wurde. Diese Liste ist die Ausnahme für Absender, bei denen man das nicht
   * jedes Mal freigeben will.
   */
  app.get<{ Params: { id: string } }>('/accounts/:id/vertraute-absender', async (request) => {
    requireAccount(request.params.id);
    return { absender: vertrauteAbsender(request.params.id) };
  });

  app.post<{ Params: { id: string }; Body: { adresse?: string } }>(
    '/accounts/:id/vertraute-absender',
    async (request) => {
      requireAccount(request.params.id);
      const adresse = request.body?.adresse?.trim();
      if (!adresse) throw new HttpError(400, 'Feld "adresse" ist erforderlich');
      return { absender: vertrauenGeben(request.params.id, adresse) };
    },
  );

  app.delete<{ Params: { id: string; adresse: string } }>(
    '/accounts/:id/vertraute-absender/:adresse',
    async (request) => {
      requireAccount(request.params.id);
      return { absender: vertrauenEntziehen(request.params.id, decodeURIComponent(request.params.adresse)) };
    },
  );

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
    // Wer gerade geantwortet hat, soll die Nachricht nicht weiter als offen vorfinden.
    verwerfe(`offen:${accountId}:`);
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

  // --- Wiedervorlage ---

  setWiedervorlageUmgebung(
    (accountId) => getAccount(accountId),
    (msg) => app.log.info(msg),
    (accountId, ordner) => {
      // Die Nachricht ist zurück - Zwischenspeicher verwerfen und die Oberfläche
      // nachladen lassen, sonst bliebe sie bis zum nächsten Klick unsichtbar.
      verwerfeStaende(accountId, ordner);
      meldeAktualisierung({ type: 'data-updated', accountId, was: 'messages', folder: ordner });
    },
  );
  ladeWiedervorlagen();

  app.post<{
    Params: { id: string; folder: string };
    Body: { uid?: number; faellig?: string };
  }>('/accounts/:id/folders/:folder/snooze', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const uid = Number(request.body?.uid);
    const faellig = new Date(String(request.body?.faellig)).getTime();

    if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, 'Feld "uid" ist erforderlich');
    if (!Number.isFinite(faellig)) throw new HttpError(400, 'Unbrauchbarer Zeitpunkt.');
    if (faellig <= Date.now()) throw new HttpError(400, 'Der Zeitpunkt liegt in der Vergangenheit.');

    const nachricht = await getMessage(account, ordner, uid);
    const eintrag = await stelleZurueck(account, ordner, uid, nachricht.subject, faellig);

    verwerfeStaende(account.id, ordner, WIEDERVORLAGE_ORDNER);
    verwirfNachrichten(nachrichtenSchluessel(account.id, ordner, uid));
    return { ok: true, ...eintrag };
  });

  app.get<{ Params: { id: string } }>('/accounts/:id/snoozed', async (request) => {
    requireAccount(request.params.id);
    return listeWiedervorlagen(request.params.id);
  });

  app.post<{ Params: { id: string; snoozeId: string } }>(
    '/accounts/:id/snoozed/:snoozeId/return',
    async (request) => {
      requireAccount(request.params.id);
      if (!(await sofortZurueck(request.params.snoozeId))) {
        throw new HttpError(404, 'Diese Wiedervorlage gibt es nicht mehr.');
      }
      return { ok: true };
    },
  );

  // --- Liegengebliebenes ---

  /**
   * Was noch offen ist: worauf eine Antwort aussteht und wem man selbst eine schuldet.
   *
   * Lange im Zwischenspeicher, weil dafür beide Ordner über Monate abgefragt werden -
   * das dauert. Was sich daran ändert, ändert sich ohnehin im Tages-, nicht im
   * Minutentakt.
   */
  app.get<{
    Params: { id: string };
    Querystring: { minDays?: string; maxDays?: string; all?: string };
  }>('/accounts/:id/offen', async (request) => {
    const account = requireAccount(request.params.id);
    const mindestTage = Math.max(0, Number(request.query.minDays ?? 3));
    const hoechstTage = Math.min(Number(request.query.maxDays ?? 90), 365);
    const auchUnbekannte = request.query.all === '1';

    const { wert } = await ausSpeicherOderHolen(
      `offen:${account.id}:${mindestTage}:${hoechstTage}:${auchUnbekannte ? 'alle' : 'eng'}`,
      () => offeneVorgaenge(account, { mindestTage, hoechstTage, auchUnbekannte }),
      { maxAlterMs: 15 * 60_000 },
    );
    return wert;
  });

  // --- Postfach aufräumen ---

  /**
   * Wer den Ordner vollmacht. Länger im Zwischenspeicher als die übrigen Stände: die
   * Erhebung braucht rund zwei Dutzend Suchläufe, und die Rangfolge der Absender ändert
   * sich nicht im Minutentakt.
   */
  app.get<{ Params: { id: string }; Querystring: { folder?: string; sample?: string } }>(
    '/accounts/:id/senders',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = request.query.folder ? decodeURIComponent(request.query.folder) : 'INBOX';
      const stichprobe = Math.min(Number(request.query.sample ?? 500), 2000);

      const { wert } = await ausSpeicherOderHolen(
        `absender:${account.id}:${ordner}:${stichprobe}`,
        () => senderUebersicht(account, ordner, stichprobe),
        { maxAlterMs: 10 * 60_000 },
      );
      return wert;
    },
  );

  /**
   * Meldet von einem Verteiler ab.
   *
   * Der Weg richtet sich danach, was der Absender selbst angibt. Die Ein-Klick-Abmeldung
   * schickt der Server; eine Abmelde-Mail geht über das Konto hinaus; bleibt nur eine
   * Webseite, kann die niemand außer dem Nutzer bedienen - dann kommt die Adresse zurück
   * und die Oberfläche öffnet sie.
   */
  app.post<{ Params: { id: string; folder: string }; Body: { uid?: number } }>(
    '/accounts/:id/folders/:folder/unsubscribe',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const uid = Number(request.body?.uid);
      if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, 'Feld "uid" ist erforderlich');

      const nachricht = await getMessage(account, ordner, uid);
      if (!nachricht.listUnsubscribe) {
        throw new HttpError(400, 'Diese Nachricht nennt keinen Abmeldeweg.');
      }

      const wege = leseAbmeldeWege(nachricht.listUnsubscribe, Boolean(nachricht.einKlickAbmeldung));
      const weg = bestimmeAbmeldung(wege);
      if (!weg) {
        throw new HttpError(
          400,
          'Der Absender gibt zwar eine Abmeldezeile an, darin steht aber keine brauchbare Adresse.',
        );
      }

      if (weg.art === 'ein-klick') {
        try {
          const { status } = await sendeEinKlickAbmeldung(weg.ziel);
          return { art: 'ein-klick', ziel: weg.ziel, status, erfolg: status < 400 };
        } catch (err) {
          throw new HttpError(502, `Abmeldung fehlgeschlagen: ${(err as Error).message}`);
        }
      }

      if (weg.art === 'mail') {
        await sendMessage(account, {
          to: [weg.adresse],
          subject: weg.betreff ?? 'unsubscribe',
          text: weg.text ?? 'unsubscribe',
        });
        return { art: 'mail', adresse: weg.adresse, erfolg: true };
      }

      // Nur eine Seite mit Bestätigung - die muss der Nutzer selbst aufrufen.
      return { art: 'im-browser', ziel: weg.ziel, erfolg: false };
    },
  );

  /** Verschiebt alles von einem Absender in den Papierkorb. */
  app.post<{
    Params: { id: string; folder: string };
    Body: { from?: string; targetFolder?: string };
  }>('/accounts/:id/folders/:folder/from-sender/move', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const absender = request.body?.from?.trim();
    if (!absender) throw new HttpError(400, 'Feld "from" ist erforderlich');

    const ziel =
      request.body?.targetFolder ??
      (await findSpecialFolder(account, '\\Trash', ['trash', 'papierkorb', 'gelöscht', 'deleted']));
    if (!ziel) throw new HttpError(400, 'Für dieses Konto gibt es keinen Papierkorb.');

    const anzahl = await verschiebeVonAbsender(account, ordner, absender, ziel);
    verwerfeStaende(account.id, ordner, ziel);
    verwirfNachrichten(`${account.id}:${ordner}:`);
    verwerfe(`absender:${account.id}:`);
    return { verschoben: anzahl, ziel };
  });

  // --- Regeln ---

  app.get<{ Params: { id: string } }>('/accounts/:id/rules', async (request) => {
    requireAccount(request.params.id);
    return regelnFuer(request.params.id);
  });

  app.put<{ Params: { id: string }; Body: Partial<Regel> }>(
    '/accounts/:id/rules',
    async (request) => {
      requireAccount(request.params.id);
      const { name, aktiv, bedingungen, aktionen, id } = request.body ?? {};
      if (!name?.trim()) throw new HttpError(400, 'Die Regel braucht einen Namen.');

      const regel = {
        id,
        name: name.trim(),
        aktiv: aktiv !== false,
        bedingungen: bedingungen ?? {},
        aktionen: aktionen ?? {},
      };
      // Eine Regel ohne Bedingung träfe auf jede Nachricht zu und würde beim nächsten
      // Eingang das Postfach leerräumen - das darf gar nicht erst gespeichert werden.
      if (!istBrauchbar(regel)) {
        throw new HttpError(
          400,
          'Die Regel braucht mindestens eine Bedingung und eine Aktion - sonst würde sie auf alles zutreffen.',
        );
      }
      return regelSpeichern(request.params.id, regel);
    },
  );

  app.delete<{ Params: { id: string; regelId: string } }>(
    '/accounts/:id/rules/:regelId',
    async (request) => {
      requireAccount(request.params.id);
      if (!regelLoeschen(request.params.id, request.params.regelId)) {
        throw new HttpError(404, 'Regel nicht gefunden');
      }
      return { ok: true };
    },
  );

  /**
   * Zeigt vorab, wie viele Nachrichten eines Ordners eine Regel treffen würde - ohne
   * etwas zu verändern. Wer eine Regel anlegt, die 8.000 Nachrichten verschiebt, soll
   * das vorher wissen und nicht hinterher.
   */
  app.post<{
    Params: { id: string };
    Body: { bedingungen?: RegelBedingung; folder?: string; pageSize?: number };
  }>('/accounts/:id/rules/preview', async (request) => {
    const account = requireAccount(request.params.id);
    const bedingungen = request.body?.bedingungen ?? {};
    const ordner = request.body?.folder ?? 'INBOX';
    if (!istBrauchbar({ bedingungen, aktionen: { alsGelesen: true } })) {
      throw new HttpError(400, 'Ohne Bedingung lässt sich nichts vorführen.');
    }

    // Über eine begrenzte Menge: die Vorschau soll eine Größenordnung zeigen, nicht den
    // gesamten Ordner durchmustern.
    const stichprobe = Math.min(Number(request.body?.pageSize ?? 200), 500);
    const seite = await listMessages(account, ordner, { pageSize: stichprobe });
    const probe = { id: 'vorschau', name: 'Vorschau', aktiv: true, bedingungen, aktionen: {} };
    const treffer = seite.messages.filter((m) => passt(probe as Regel, m));

    return {
      geprueft: seite.messages.length,
      treffer: treffer.length,
      imOrdner: seite.total,
      beispiele: treffer.slice(0, 5).map((m) => ({
        subject: m.subject,
        from: m.from[0]?.name || m.from[0]?.address,
      })),
    };
  });

  /** Wendet die Regeln auf einen bestehenden Ordner an - zum Aufräumen. */
  app.post<{ Params: { id: string; folder: string }; Querystring: { pageSize?: string } }>(
    '/accounts/:id/folders/:folder/apply-rules',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const menge = Math.min(Number(request.query.pageSize ?? 200), 500);

      const seite = await listMessages(account, ordner, { pageSize: menge });
      const ergebnis = await wendeRegelnAn(account, ordner, seite.messages, (m) => app.log.info(m));
      verwerfeStaende(account.id, ordner);
      verwirfNachrichten(`${account.id}:${ordner}:`);
      return { ...ergebnis, geprueft: seite.messages.length };
    },
  );

  /**
   * Sonderordner dürfen weder umbenannt noch gelöscht werden.
   *
   * Die Server lehnen das zwar meist selbst ab, aber mit Meldungen, aus denen niemand
   * schlau wird - und Gmail lässt manches sogar zu, mit Folgen bis in die Weboberfläche
   * hinein. Die Rolle kommt vom Server selbst, es wird also nicht über Namen geraten.
   */
  async function pruefeVeraenderbar(account: AccountConfig, pfad: string): Promise<void> {
    const ordner = (await listFolders(account)).find((f) => f.path === pfad);
    if (!ordner) throw new HttpError(404, `Ordner "${pfad}" gibt es nicht.`);
    if (ordner.specialUse) {
      throw new HttpError(
        400,
        `"${ordner.name}" ist ein Sonderordner des Anbieters und lässt sich nicht ändern.`,
      );
    }
  }

  app.post<{ Params: { id: string }; Body: { path?: string } }>(
    '/accounts/:id/folders',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = request.body?.path?.trim();
      if (!pfad) throw new HttpError(400, 'Feld "path" ist erforderlich');
      await createFolder(account, pfad);
      verwerfe(schluessel.ordner(account.id));
      return { ok: true, path: pfad };
    },
  );

  app.patch<{ Params: { id: string; folder: string }; Body: { path?: string } }>(
    '/accounts/:id/folders/:folder',
    async (request) => {
      const account = requireAccount(request.params.id);
      const alt = decodeURIComponent(request.params.folder);
      const neu = request.body?.path?.trim();
      if (!neu) throw new HttpError(400, 'Feld "path" ist erforderlich');
      await pruefeVeraenderbar(account, alt);
      await renameFolder(account, alt, neu);
      // Der alte Pfad ist weg - alles, was darunter zwischengespeichert war, ebenso.
      verwerfeStaende(account.id, alt);
      verwirfNachrichten(`${account.id}:${alt}:`);
      return { ok: true, path: neu };
    },
  );

  app.delete<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = decodeURIComponent(request.params.folder);
      await pruefeVeraenderbar(account, pfad);
      await deleteFolder(account, pfad);
      verwerfeStaende(account.id, pfad);
      verwirfNachrichten(`${account.id}:${pfad}:`);
      return { ok: true };
    },
  );

  /** Leert einen Ordner unwiderruflich - gedacht für Papierkorb und Spam. */
  app.post<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder/empty',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = decodeURIComponent(request.params.folder);
      const anzahl = await emptyFolder(account, pfad);
      verwerfeStaende(account.id, pfad);
      verwirfNachrichten(`${account.id}:${pfad}:`);
      return { ok: true, geloescht: anzahl };
    },
  );

  app.post<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder/mark-read',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = decodeURIComponent(request.params.folder);
      const anzahl = await markFolderSeen(account, pfad);
      verwerfeStaende(account.id, pfad);
      verwirfNachrichten(`${account.id}:${pfad}:`);
      return { ok: true, markiert: anzahl };
    },
  );

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

  /**
   * Was der Server des Kontos kann. Lange Frist im Zwischenspeicher: die Fähigkeiten
   * eines Servers ändern sich allenfalls bei einem Umbau beim Anbieter.
   */
  app.get<{ Params: { id: string } }>('/accounts/:id/capabilities', async (request) => {
    const account = requireAccount(request.params.id);
    const { wert } = await ausSpeicherOderHolen(
      `faehigkeiten:${account.id}`,
      () => getCapabilities(account),
      { maxAlterMs: 24 * 60 * 60_000 },
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
      merkeAusListe(account.id, ordner, seite.messages);
      return seite;
    };

    // Nur die erste Seite kommt in den Zwischenspeicher. Nachgeladene ältere Seiten holt
    // man einmal beim Blättern - dort wartet man ohnehin auf etwas Neues, und sie alle
    // vorzuhalten würde den Speicher bei großen Postfächern vollaufen lassen.
    if (beforeUid) return holen();

    // Der Abruf der ersten Seite heißt: dieser Ordner wird gerade angesehen. Er kommt
    // damit in die Überwachung, sodass Änderungen dort ebenso sofort ankommen wie im
    // Posteingang.
    meldeAnsicht(account.id, ordner);

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

  /**
   * Ersetzt "cid:"-Verweise auf eingebettete Bilder durch abrufbare Adressen.
   *
   * Ohne das packt der Parser die Bilddaten selbst in den HTML-Text - bei einer
   * Nachricht mit sechs Bildern 197 von 215 KB. So holt der Browser sie einzeln über
   * den vorhandenen Anhang-Abruf, und zwar erst, wenn er sie wirklich anzeigt.
   */
  function mitAbrufbarenBildern(
    nachricht: Awaited<ReturnType<typeof getMessage>>,
    accountId: string,
    ordner: string,
    uid: number,
  ) {
    if (typeof nachricht.html !== 'string') return nachricht;

    let html = nachricht.html;
    for (const anhang of nachricht.attachments) {
      if (!anhang.contentId || !anhang.partId) continue;
      const adresse =
        `/accounts/${accountId}/folders/${encodeURIComponent(ordner)}` +
        `/messages/${uid}/attachments/${encodeURIComponent(anhang.partId)}`;
      // Über split/join statt regulärem Ausdruck: eine Content-ID darf Zeichen
      // enthalten, die dort eine Sonderbedeutung hätten.
      html = html.split(`cid:${anhang.contentId}`).join(adresse);
    }
    return { ...nachricht, html };
  }

  app.get<{ Params: { id: string; folder: string; uid: string } }>(
    '/accounts/:id/folders/:folder/messages/:uid',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const uid = Number(request.params.uid);
      const key = nachrichtenSchluessel(account.id, ordner, uid);

      /**
       * Ob der Absender freigegeben ist, wird bei jedem Abruf frisch bestimmt und nicht
       * mitgespeichert: sonst zeigte eine Nachricht, die vor dem Freigeben schon einmal
       * offen war, weiterhin die Rückfrage.
       */
      const mitVertrauen = (n: Awaited<ReturnType<typeof getMessage>>) => ({
        ...n,
        absenderVertraut: istVertraut(account.id, n.from[0]?.address ?? ''),
      });

      const vorhanden = liesNachricht(key);
      if (vorhanden) return mitVertrauen(vorhanden);

      const nachricht = mitAbrufbarenBildern(
        await getMessage(account, ordner, uid),
        account.id,
        ordner,
        uid,
      );
      merkeNachricht(key, nachricht);
      return mitVertrauen(nachricht);
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
      const uids = parseUids(request.body.uids);
      await setMessagesSeen(account, ordner, uids, request.body.seen);
      verwerfeStaende(account.id, ordner);
      // Nachziehen statt verwerfen: das Öffnen einer Nachricht markiert sie als gelesen,
      // und die vorgehaltene Fassung soll deswegen nicht verlorengehen.
      aktualisiereGelesen(account.id, ordner, uids, request.body.seen);
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
    const uids = parseUids(request.body.uids);
    await moveMessages(account, ordner, uids, request.body.targetFolder);
    verwerfeStaende(account.id, ordner, request.body.targetFolder);
    // Im Quellordner gibt es diese UIDs nicht mehr; im Zielordner haben sie andere.
    for (const uid of uids) verwirfNachrichten(nachrichtenSchluessel(account.id, ordner, uid));
    return { ok: true };
  });

  app.post<{ Params: { id: string; folder: string }; Body: { uids?: unknown } }>(
    '/accounts/:id/folders/:folder/messages/delete',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const uids = parseUids(request.body?.uids);
      await deleteMessages(account, ordner, uids);
      verwerfeStaende(account.id, ordner);
      for (const uid of uids) verwirfNachrichten(nachrichtenSchluessel(account.id, ordner, uid));
      return { ok: true };
    },
  );

  /** Liest die Sucheinschränkungen aus der Anfrage. */
  function parseKriterien(q: Record<string, string | undefined>): SearchCriteria {
    return {
      text: q.q?.trim() || undefined,
      from: q.from?.trim() || undefined,
      subject: q.subject?.trim() || undefined,
      since: q.since || undefined,
      before: q.before || undefined,
      unreadOnly: q.unread === '1',
      withAttachment: q.attachment === '1',
      category: parseCategory(q.category),
    };
  }

  const hatEinschraenkung = (k: SearchCriteria) =>
    Boolean(k.text || k.from || k.subject || k.since || k.before || k.unreadOnly || k.withAttachment);

  app.get<{
    Params: { id: string; folder: string };
    Querystring: Record<string, string | undefined>;
  }>('/accounts/:id/folders/:folder/search', async (request) => {
    const account = requireAccount(request.params.id);
    const kriterien = parseKriterien(request.query);
    if (!hatEinschraenkung(kriterien)) {
      return { messages: [], total: 0, nextCursor: null, hasMore: false };
    }
    const { beforeUid, pageSize } = request.query;
    return searchMessages(account, decodeURIComponent(request.params.folder), kriterien, {
      beforeUid: beforeUid ? Number(beforeUid) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  });

  /**
   * Welche Ordner eines Kontos durchsucht werden.
   *
   * Gmail führt jede Nachricht zusätzlich in "Alle Nachrichten" - dort genügt ein
   * einziger Suchlauf statt acht. Bei anderen Anbietern wird über die Ordner gegangen,
   * ohne Papierkorb und Spam: wer sucht, meint in aller Regel nicht das Weggeworfene.
   */
  async function suchOrdner(account: AccountConfig): Promise<string[]> {
    const alle = await listFolders(account);
    const alleNachrichten = alle.find((f) => f.isAllMail && f.selectable);
    if (alleNachrichten) return [alleNachrichten.path];
    return alle
      .filter((f) => f.selectable && f.specialUse !== '\\Trash' && f.specialUse !== '\\Junk')
      .map((f) => f.path);
  }

  /** Suche über alle Ordner eines Kontos. */
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/accounts/:id/search',
    async (request) => {
      const account = requireAccount(request.params.id);
      const kriterien = parseKriterien(request.query);
      if (!hatEinschraenkung(kriterien)) return { hits: [], total: 0, hasMore: false };

      const grenze = request.query.pageSize ? Number(request.query.pageSize) : DEFAULT_SEITENGROESSE;
      const ergebnis = await searchFolders(account, await suchOrdner(account), kriterien, grenze);
      return {
        ...ergebnis,
        hits: ergebnis.hits.map((h) => ({ ...h, accountId: account.id, email: account.email })),
      };
    },
  );

  /**
   * Suche über alle Konten. Nacheinander statt gleichzeitig - die Anbieter reagieren
   * empfindlich auf Verbindungssalven, und ein Konto, das gerade nicht erreichbar ist,
   * soll die Treffer der übrigen nicht verhindern.
   */
  app.get<{ Querystring: Record<string, string | undefined> }>('/search', async (request) => {
    const kriterien = parseKriterien(request.query);
    if (!hatEinschraenkung(kriterien)) return { hits: [], total: 0, hasMore: false };

    const grenze = request.query.pageSize ? Number(request.query.pageSize) : DEFAULT_SEITENGROESSE;
    const treffer = [];
    let gesamt = 0;

    for (const account of listAccounts()) {
      try {
        const ergebnis = await searchFolders(account, await suchOrdner(account), kriterien, grenze);
        gesamt += ergebnis.total;
        treffer.push(
          ...ergebnis.hits.map((h) => ({ ...h, accountId: account.id, email: account.email })),
        );
      } catch (err) {
        app.log.warn(`Suche in ${account.email} fehlgeschlagen: ${(err as Error).message}`);
      }
    }

    treffer.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
    return { hits: treffer.slice(0, grenze), total: gesamt, hasMore: gesamt > grenze };
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

  /**
   * Der eigentliche Versand - von der Sofort-Route wie von der Warteschlange benutzt.
   *
   * Bewusst eine gemeinsame Stelle: sonst liefen zwei Wege auseinander, und eine
   * verzögert gesendete Nachricht landete etwa nicht im Gesendet-Ordner oder ließe
   * ihren Entwurf stehen.
   */
  async function fuehreVersandAus(
    account: AccountConfig,
    koerper: SendBody & { draftFolder?: string; draftUid?: number },
  ) {
    const { attachOriginal, attachments: wire, draftFolder, draftUid, ...message } = koerper;
    const attachments = await collectAttachments(account, wire, attachOriginal);
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

    // Im Gesendet-Ordner liegt jetzt eine Nachricht mehr, im Entwürfe-Ordner eine weniger.
    verwerfeStaende(account.id, result.sentFolder, draftFolder && decodeURIComponent(draftFolder));
    return result;
  }

  setSendeVerfahren(async (sendung) => {
    const account = getAccount(sendung.accountId);
    if (!account) throw new Error('Das Konto gibt es nicht mehr.');
    await fuehreVersandAus(account, sendung.koerper as SendBody);
  }, (msg) => app.log.info(msg));

  ladeGeplanteSendungen();

  app.post<{
    Params: { id: string };
    Body: SendBody & { draftFolder?: string; draftUid?: number };
  }>('/accounts/:id/send', async (request, reply) => {
    const account = requireAccount(request.params.id);
    const { attachOriginal, attachments: wire, draftFolder, draftUid, ...message } = request.body;

    // Mit Verzögerung: nicht senden, sondern vormerken. Der Körper wandert unverändert
    // in die Warteschlange - Anhänge werden erst beim tatsächlichen Versand aus dem
    // Postfach geholt, sonst läge eine 20-MB-Datei in der Warteschlangendatei.
    const verzoegerung = Number((request.body as { sendenIn?: number }).sendenIn ?? 0);
    const zeitpunkt = (request.body as { sendenAm?: string }).sendenAm;
    if (verzoegerung > 0 || zeitpunkt) {
      const faellig = zeitpunkt ? new Date(zeitpunkt).getTime() : Date.now() + verzoegerung * 1000;
      if (!Number.isFinite(faellig)) throw new HttpError(400, 'Unbrauchbarer Zeitpunkt.');
      const sendung = planeSendung(account.id, request.body as Record<string, unknown>, faellig);
      return { ok: true, geplant: true, id: sendung.id, faellig: sendung.faellig };
    }

    try {
      return { ok: true, ...(await fuehreVersandAus(account, request.body)) };
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  /** Holt eine vorgemerkte Nachricht zurück und gibt sie zum Weiterbearbeiten heraus. */
  app.delete<{ Params: { id: string; sendungId: string } }>(
    '/accounts/:id/send/:sendungId',
    async (request) => {
      requireAccount(request.params.id);
      const sendung = storniereSendung(request.params.sendungId);
      if (!sendung) throw new HttpError(404, 'Diese Nachricht ist bereits unterwegs.');
      return { ok: true, koerper: sendung.koerper };
    },
  );

  /** Was noch aussteht - für eine Übersicht der geplanten Nachrichten. */
  app.get<{ Params: { id: string } }>('/accounts/:id/send/pending', async (request) => {
    requireAccount(request.params.id);
    return listeGeplanteSendungen(request.params.id).map((s) => ({
      id: s.id,
      faellig: s.faellig,
      betreff: s.betreff,
      empfaenger: s.empfaenger,
    }));
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
