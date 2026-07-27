import { type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { withClient, withThrowawayClient } from './connectionPool.js';
import {
  GMAIL_CATEGORIES,
  type AccountConfig,
  type AttachmentInfo,
  type CategoryInfo,
  type FolderInfo,
  type FullMessage,
  type GmailCategory,
  type ListMessagesOptions,
  type MessagePage,
  type MessageSummary,
  type SearchCriteria,
  type SearchHit,
  type SearchResult,
} from './types.js';


interface StructureNode {
  part?: string;
  type?: string;
  size?: number;
  encoding?: string;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  parameters?: Record<string, string>;
  /** Content-ID, in spitzen Klammern - Anker für "cid:"-Verweise im HTML-Text. */
  id?: string;
  childNodes?: StructureNode[];
}

/**
 * bodyStructure meldet die Größe im übertragenen (kodierten) Zustand. Bei base64 sind
 * das rund ein Drittel mehr als die eigentliche Datei - ohne Umrechnung zeigt die
 * Oberfläche durchweg zu große Werte an.
 */
function decodedSize(node: StructureNode): number {
  const size = node.size ?? 0;
  if (node.encoding?.toLowerCase() === 'base64') {
    return Math.floor((size * 3) / 4);
  }
  return size;
}

function attachmentFilename(node: StructureNode): string | undefined {
  return node.dispositionParameters?.filename ?? node.parameters?.name;
}

/**
 * Sammelt Anhänge aus der Nachrichtenstruktur - ohne die Inhalte zu laden; die Struktur
 * allein nennt Dateiname, Typ, Größe und Part-ID.
 *
 * Neben echten Anhängen (disposition "attachment") werden auch eingebettete Teile mit
 * Dateinamen aufgenommen (disposition "inline"), etwa Bilder im HTML-Text. Die sind für
 * den Empfänger genauso Dateien, und gängige Mailprogramme zeigen sie ebenfalls an.
 */
function collectAttachments(node: unknown, into: AttachmentInfo[] = []): AttachmentInfo[] {
  if (!node || typeof node !== 'object') return into;
  const current = node as StructureNode;

  const filename = attachmentFilename(current);
  const isAttachment = current.disposition === 'attachment' || (Boolean(filename) && !current.childNodes);

  if (isAttachment && current.part) {
    into.push({
      partId: current.part,
      filename,
      contentType: current.type ?? 'application/octet-stream',
      size: decodedSize(current),
      // Server liefern die Content-ID mit spitzen Klammern; im HTML steht sie ohne.
      contentId: current.id?.replace(/^<|>$/g, '') || undefined,
    });
  }

  for (const child of current.childNodes ?? []) {
    collectAttachments(child, into);
  }
  return into;
}

function toAddresses(list: { name?: string; address?: string }[] | undefined) {
  return (list ?? [])
    .map((a) => ({ name: a.name || undefined, address: a.address ?? '' }))
    .filter((a) => a.address);
}

/**
 * Liest die Kopfzeilen, die für Abmeldung und Regeln gebraucht werden.
 *
 * IMAP liefert sie als rohen Textblock; ein vollständiger Parser wäre hier überzogen -
 * gesucht sind drei Zeilen mit bekanntem Namen. Fortsetzungszeilen (eingerückt) gehören
 * zur vorigen Zeile und werden angehängt, sonst brächen lange Abmelde-Adressen ab.
 */
function leseKopfzeilen(roh: Buffer | undefined): Record<string, string> {
  if (!roh) return {};
  const zeilen = roh.toString('utf-8').split(/\r?\n/);
  const ergebnis: Record<string, string> = {};
  let zuletzt: string | null = null;

  for (const zeile of zeilen) {
    if (/^[ \t]/.test(zeile) && zuletzt) {
      ergebnis[zuletzt] += ' ' + zeile.trim();
      continue;
    }
    const treffer = zeile.match(/^([A-Za-z-]+):\s*(.*)$/);
    if (!treffer) {
      zuletzt = null;
      continue;
    }
    zuletzt = treffer[1].toLowerCase();
    ergebnis[zuletzt] = treffer[2].trim();
  }
  return ergebnis;
}

function summarizeMessage(msg: FetchMessageObject): MessageSummary {
  const flags = msg.flags ? Array.from(msg.flags) : [];
  const kopf = leseKopfzeilen(msg.headers);
  return {
    uid: msg.uid,
    subject: msg.envelope?.subject ?? '(kein Betreff)',
    from: toAddresses(msg.envelope?.from),
    to: toAddresses(msg.envelope?.to),
    cc: toAddresses(msg.envelope?.cc),
    date: msg.envelope?.date ?? null,
    flags,
    seen: flags.includes('\\Seen'),
    // Gleiche Erkennung wie in der Leseansicht, damit Liste und Detail übereinstimmen.
    hasAttachments: collectAttachments(msg.bodyStructure).length > 0,
    // Grundlage für die Gruppierung zu Gesprächen. threadId führt nur, wer sie kennt
    // (Gmail); sonst wird aus messageId und inReplyTo abgeleitet.
    threadId: msg.threadId || undefined,
    messageId: msg.envelope?.messageId || undefined,
    inReplyTo: msg.envelope?.inReplyTo || undefined,
    listUnsubscribe: kopf['list-unsubscribe'] || undefined,
    // Der Absender kündigt damit an, eine schlichte Anfrage zu akzeptieren - kein
    // Umweg über eine Webseite, kein Bestätigungsklick.
    einKlickAbmeldung: kopf['list-unsubscribe-post'] ? true : undefined,
    listId: kopf['list-id'] || undefined,
  };
}

/**
 * ImapFlow wirft für Login- wie Netzwerkfehler gleichermaßen "Command failed"; die
 * verwertbare Information steckt in responseText bzw. im Node-Fehlercode.
 */
function describeImapError(err: unknown): string {
  const e = err as {
    responseText?: string;
    authenticationFailed?: boolean;
    code?: string;
    message?: string;
  };
  if (e.authenticationFailed) {
    return e.responseText ?? 'Anmeldung abgelehnt – E-Mail oder Passwort falsch.';
  }
  if (e.responseText) return e.responseText;
  switch (e.code) {
    case 'ENOTFOUND':
      return 'Server nicht gefunden – stimmt die Adresse?';
    case 'ECONNREFUSED':
      return 'Verbindung abgelehnt – falscher Port?';
    case 'ETIMEDOUT':
    case 'ECONNRESET':
      return 'Zeitüberschreitung – Server nicht erreichbar.';
    default:
      return e.message ?? 'Unbekannter Verbindungsfehler';
  }
}

/**
 * Baut eine IMAP-Verbindung auf und meldet sich sofort wieder ab. Wirft bei falschen
 * Zugangsdaten oder unerreichbarem Host - dient dem Prüfen eines Kontos beim Anlegen,
 * damit der Nutzer sofort Rückmeldung bekommt statt eines Folgefehlers beim Abruf.
 */
export async function verifyImapConnection(config: AccountConfig): Promise<void> {
  try {
    // Absichtlich ohne Pool: hier werden noch nicht gespeicherte Zugangsdaten geprüft,
    // eine dauerhafte Verbindung wäre unerwünscht und würde bei Fehleingaben im Pool
    // hängen bleiben.
    await withThrowawayClient(config, async () => undefined);
  } catch (err) {
    throw new Error(describeImapError(err));
  }
}

export async function listFolders(config: AccountConfig): Promise<FolderInfo[]> {
  return withClient(config, async (client) => {
    // statusQuery holt die Ungelesen-Zähler in derselben Abfrage - sonst bräuchte es
    // einen zusätzlichen STATUS-Aufruf pro Ordner.
    const list = await client.list({ statusQuery: { unseen: true } });
    return list.map((box) => {
      const flags = box.flags ? Array.from(box.flags) : [];
      // \Noselect bzw. \NonExistent kennzeichnen Container ohne eigene Nachrichten.
      const selectable = !flags.some((flag) => /^\\(Noselect|NonExistent)$/i.test(flag));
      return {
        path: box.path,
        name: box.name,
        specialUse: box.specialUse || undefined,
        flags,
        delimiter: box.delimiter || '/',
        unseen: box.status?.unseen,
        selectable,
        isAllMail: box.specialUse === '\\All',
      };
    });
  });
}

/** Der von withClient bereitgestellte ImapFlow-Client. */
type Client = Parameters<Parameters<typeof withClient>[1]>[0];

/** Ordner, in dem Gmail seine Einordnung vornimmt - sie gilt nur für den Posteingang. */
export const CATEGORY_FOLDER = 'INBOX';

/**
 * Ob der Server Gmails Suchsprache beherrscht. Wird an der IMAP-Erweiterung erkannt, die
 * der Server selbst ankündigt - nicht am Anbieternamen oder der Adresse. Ein
 * Firmenpostfach hinter Google Workspace wird damit genauso erkannt wie gmail.com.
 */
function supportsCategories(client: Client): boolean {
  return client.capabilities.has('X-GM-EXT-1');
}

/** Suchbedingung für eine Einordnung, als Gmail-Rohsuche. */
function categoryQuery(category: GmailCategory): { gmraw: string } {
  return { gmraw: `category:${category}` };
}

/**
 * Zählt die Nachrichten je Einordnung des Posteingangs, jeweils gesamt und ungelesen.
 * Meldet der Server die Gmail-Erweiterung nicht, kommt eine leere Liste zurück - die
 * Oberfläche zeigt dann gar keine Einordnungen.
 *
 * Die Ungelesen-Zahl wird nicht je Einordnung erfragt, sondern aus einer einzigen Suche
 * nach ungelesenen Nachrichten und einem Abgleich der UID-Mengen gebildet: das sind vier
 * Serverabfragen weniger. Übertragen werden dabei nur Zahlen, keine Kopfdaten.
 */
export async function listCategories(config: AccountConfig): Promise<CategoryInfo[]> {
  return withClient(config, async (client) => {
    if (!supportsCategories(client)) return [];

    const lock = await client.getMailboxLock(CATEGORY_FOLDER);
    try {
      const ungelesen = new Set((await client.search({ seen: false }, { uid: true })) || []);

      const ergebnis: CategoryInfo[] = [];
      for (const category of GMAIL_CATEGORIES) {
        const uids = (await client.search(categoryQuery(category), { uid: true })) || [];
        ergebnis.push({
          id: category,
          total: uids.length,
          unseen: uids.reduce((summe, uid) => summe + (ungelesen.has(uid) ? 1 : 0), 0),
        });
      }
      return ergebnis;
    } finally {
      lock.release();
    }
  });
}

/**
 * Setzt oder entfernt das \Seen-Flag. ImapFlow ruft Nachrichteninhalte grundsätzlich
 * mit BODY.PEEK ab, das Lesen allein ändert den Status also nicht - er wird bewusst
 * hier gesetzt.
 */
export async function setMessagesSeen(
  config: AccountConfig,
  folder: string,
  uids: number[],
  seen: boolean,
): Promise<void> {
  if (uids.length === 0) return;
  await withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // Alle UIDs in einem einzigen STORE-Befehl - nicht pro Nachricht einzeln.
      if (seen) {
        await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
      } else {
        await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}

/**
 * Setzt oder entfernt das \Flagged-Flag ("markiert", in vielen Programmen ein Stern).
 * Wie beim Gelesen-Status alle UIDs in einem Befehl.
 */
export async function setMessagesFlagged(
  config: AccountConfig,
  folder: string,
  uids: number[],
  flagged: boolean,
): Promise<void> {
  if (uids.length === 0) return;
  await withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (flagged) {
        await client.messageFlagsAdd(uids, ['\\Flagged'], { uid: true });
      } else {
        await client.messageFlagsRemove(uids, ['\\Flagged'], { uid: true });
      }
    } finally {
      lock.release();
    }
  });
}

const DEFAULT_PAGE_SIZE = 25;

/**
 * Holt die Kopfdaten zu einer Menge von UIDs, neueste zuerst.
 *
 * Bewusst getrennt von der UID-Ermittlung: die UID-Liste kann sehr lang sein (bei einer
 * breiten Suche zehntausende Treffer), abgerufen wird aber nur der aktuelle Seitenanteil.
 * Vorher lud die Suche die Kopfdaten *aller* Treffer in einem Zug.
 */
async function fetchSummaries(
  client: Parameters<Parameters<typeof withClient>[1]>[0],
  uids: number[],
): Promise<MessageSummary[]> {
  if (uids.length === 0) return [];
  const messages: MessageSummary[] = [];
  for await (const msg of client.fetch(
    uids,
    {
      envelope: true,
      flags: true,
      uid: true,
      bodyStructure: true,
      threadId: true,
      // Nur diese drei Zeilen, nicht der ganze Kopf: sie tragen Abmeldeweg und
      // Verteilerkennung und sind Grundlage fuer Abmeldung wie Regeln.
      headers: ['list-unsubscribe', 'list-unsubscribe-post', 'list-id'],
    },
    { uid: true },
  )) {
    messages.push(summarizeMessage(msg));
  }
  messages.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  return messages;
}

/** Schneidet aus aufsteigenden UIDs die nächste Seite heraus (höchste = neueste). */
function seitenAnteil(
  aufsteigend: number[],
  beforeUid: number | undefined,
  pageSize: number,
): { uids: number[]; nextCursor: number | null; hasMore: boolean } {
  const kandidaten = beforeUid ? aufsteigend.filter((uid) => uid < beforeUid) : aufsteigend;
  const uids = kandidaten.slice(-pageSize);
  const hasMore = kandidaten.length > uids.length;
  return {
    uids,
    nextCursor: uids.length > 0 ? Math.min(...uids) : null,
    hasMore,
  };
}

/**
 * Kennzeichen für "der Server kann das nicht" - das ist eine unpassende Anfrage, kein
 * Serverfehler. Über den Code kann der Aufrufer das unterscheiden, ohne die Meldung
 * auszuwerten; dieselbe Art der Unterscheidung nutzt auch describeImapError.
 */
export const CATEGORY_UNSUPPORTED = 'CATEGORY_UNSUPPORTED';

/** Kennzeichen für "dieser Anbieter kann nicht nach Anhängen suchen". */
export const ATTACHMENT_SEARCH_UNSUPPORTED = 'ATTACHMENT_SEARCH_UNSUPPORTED';

/**
 * Was der Server des Kontos kann. Wird gebraucht, damit die Oberfläche nur anbietet, was
 * auch geht - statt es zu versuchen und hinterher eine Fehlermeldung zu zeigen.
 */
export async function getCapabilities(
  config: AccountConfig,
): Promise<{ gmailSearch: boolean }> {
  return withClient(config, async (client) => ({ gmailSearch: supportsCategories(client) }));
}

/**
 * Stellt sicher, dass eine angeforderte Einordnung überhaupt möglich ist. Ohne diese
 * Prüfung würde ImapFlow den Befehl gar nicht erst senden und einen technischen Fehler
 * melden, der nicht erklärt, woran es liegt.
 */
function requireCategorySupport(client: Client, category: GmailCategory): void {
  if (!supportsCategories(client)) {
    const err = new Error(
      `Dieser Server kennt Gmails Einordnung "${category}" nicht ` +
        '(IMAP-Erweiterung X-GM-EXT-1 fehlt).',
    ) as Error & { code?: string };
    err.code = CATEGORY_UNSUPPORTED;
    throw err;
  }
}

export async function listMessages(
  config: AccountConfig,
  folder: string,
  options: ListMessagesOptions = {},
): Promise<MessagePage> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const mailbox = client.mailbox;
      const imOrdner = mailbox && typeof mailbox !== 'boolean' ? mailbox.exists : 0;
      if (imOrdner === 0) return { messages: [], total: 0, nextCursor: null, hasMore: false };

      // Der Server liefert nur Zahlen zurück - auch bei 30.000 Nachrichten ein
      // Bruchteil der Datenmenge, die ein Abruf der Kopfdaten bedeuten würde.
      let treffer: number[];
      if (options.category) {
        requireCategorySupport(client, options.category);
        treffer = (await client.search(categoryQuery(options.category), { uid: true })) || [];
      } else {
        treffer = (await client.search({ all: true }, { uid: true })) || [];
      }

      // Bei einer Einordnung zählt deren Umfang, nicht der des Ordners - sonst stünde in
      // der Liste "25 von 31.700" statt "25 von 8.868".
      const total = options.category ? treffer.length : imOrdner;
      const { uids, nextCursor, hasMore } = seitenAnteil(treffer, options.beforeUid, pageSize);

      return { messages: await fetchSummaries(client, uids), total, nextCursor, hasMore };
    } finally {
      lock.release();
    }
  });
}

export async function getMessage(config: AccountConfig, folder: string, uid: number): Promise<FullMessage> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      let summary: MessageSummary | null = null;
      let structure: unknown = null;
      for await (const msg of client.fetch(
        String(uid),
        {
      envelope: true,
      flags: true,
      uid: true,
      bodyStructure: true,
      threadId: true,
      // Nur diese drei Zeilen, nicht der ganze Kopf: sie tragen Abmeldeweg und
      // Verteilerkennung und sind Grundlage fuer Abmeldung wie Regeln.
      headers: ['list-unsubscribe', 'list-unsubscribe-post', 'list-id'],
    },
        { uid: true },
      )) {
        summary = summarizeMessage(msg);
        structure = msg.bodyStructure;
      }
      if (!summary) throw new Error(`Nachricht ${uid} nicht gefunden in ${folder}`);

      const { content } = await client.download(String(uid), undefined, { uid: true });
      // keepCidLinks: sonst ersetzt mailparser jeden "cid:"-Verweis durch die
      // Bilddaten selbst. Bei einer Nachricht mit sechs eingebetteten Bildern machte
      // das 197 von 215 KB der Antwort aus - Daten, die der Browser ohnehin einzeln
      // und bei Bedarf laden kann.
      const parsed = await simpleParser(content, { keepCidLinks: true });

      // References kann als einzelner Wert oder als Liste kommen - vereinheitlichen.
      const references = Array.isArray(parsed.references)
        ? parsed.references
        : parsed.references
          ? [parsed.references]
          : undefined;

      const replyTo = parsed.replyTo?.value?.map((a) => ({
        name: a.name || undefined,
        address: a.address ?? '',
      }));

      return {
        ...summary,
        text: typeof parsed.text === 'string' ? parsed.text : undefined,
        html: parsed.html,
        // Aus der Struktur statt aus parsed.attachments - so gehen keine Anhangsbytes
        // mit in die Antwort.
        attachments: collectAttachments(structure),
        messageId: parsed.messageId,
        references,
        inReplyTo: parsed.inReplyTo,
        replyTo: replyTo?.filter((a) => a.address),
      };
    } finally {
      lock.release();
    }
  });
}

export interface DownloadedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

/**
 * Lädt genau einen Anhang über seine Part-ID. Damit wird nur dieser Teil der Nachricht
 * vom Server geholt, nicht die vollständige Mail.
 */
export async function downloadAttachment(
  config: AccountConfig,
  folder: string,
  uid: number,
  partId: string,
): Promise<DownloadedAttachment> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // Struktur vorab lesen: liefert Dateiname und Reihenfolge für den Rückfallweg.
      let attachments: AttachmentInfo[] = [];
      for await (const msg of client.fetch(
        String(uid),
        { uid: true, bodyStructure: true },
        { uid: true },
      )) {
        attachments = collectAttachments(msg.bodyStructure);
      }
      const meta = attachments.find((a) => a.partId === partId);

      // Regulärer Weg: nur diesen einen Teil vom Server holen.
      const result = await client.download(String(uid), partId, { uid: true });
      if (result?.content) {
        const chunks: Buffer[] = [];
        for await (const chunk of result.content) {
          chunks.push(Buffer.from(chunk));
        }
        const content = Buffer.concat(chunks);
        return {
          filename: result.meta?.filename || meta?.filename || `anhang-${partId}`,
          contentType: result.meta?.contentType || meta?.contentType || 'application/octet-stream',
          size: content.length,
          content,
        };
      }

      // Rückfallweg für kleine Anhänge:
      // Antwortet der Server einen Teil als kurze Zeichenkette statt als Literal (das
      // tun IMAP-Server bei wenigen hundert Bytes), ordnet ImapFlow ihn intern falsch
      // zu und download() liefert nichts zurück. Nachweisbar an zwei Anhängen derselben
      // Nachricht: 12 Bytes schlagen fehl, 12 kB gelingen. Dann wird die vollständige
      // Nachricht geladen und der Anhang daraus entnommen - langsamer, aber korrekt.
      const whole = await client.download(String(uid), undefined, { uid: true });
      if (!whole?.content) {
        throw new Error(`Anhang ${partId} konnte nicht geladen werden.`);
      }
      const parsed = await simpleParser(whole.content);
      const candidates = parsed.attachments ?? [];

      // Zuordnung über den Dateinamen; bei mehreren gleichnamigen über die Position.
      const sameName = attachments.filter((a) => a.filename === meta?.filename);
      const occurrence = Math.max(0, sameName.findIndex((a) => a.partId === partId));
      const matching = candidates.filter((a) => a.filename === meta?.filename);
      const picked =
        matching[occurrence] ??
        matching[0] ??
        candidates[Math.max(0, attachments.findIndex((a) => a.partId === partId))];

      if (!picked) {
        throw new Error(`Anhang ${partId} nicht in der Nachricht gefunden.`);
      }

      return {
        filename: picked.filename || meta?.filename || `anhang-${partId}`,
        contentType: picked.contentType || meta?.contentType || 'application/octet-stream',
        size: picked.content.length,
        content: picked.content,
      };
    } finally {
      lock.release();
    }
  });
}

/**
 * Legt eine fertige Nachricht in einem Ordner ab (IMAP APPEND). Wird gebraucht, weil
 * SMTP nur verschickt - eine Kopie im Gesendet-Ordner muss der Client selbst anlegen.
 */
export async function appendMessage(
  config: AccountConfig,
  folder: string,
  raw: Buffer,
  flags: string[] = ['\\Seen'],
): Promise<number | null> {
  return withClient(config, async (client) => {
    const result = await client.append(folder, raw, flags, new Date());
    if (!result) {
      throw new Error(`Ablegen in "${folder}" wurde vom Server abgelehnt.`);
    }
    // Nicht jeder Server meldet die vergebene UID zurück (UIDPLUS-Erweiterung).
    return result.uid ?? null;
  });
}

/**
 * Sucht einen Sonderordner. Bevorzugt wird die SPECIAL-USE-Kennzeichnung des Servers;
 * meldet der Anbieter keine, wird über bekannte Ordnernamen gesucht.
 */
export async function findSpecialFolder(
  config: AccountConfig,
  specialUse: string,
  fallbackNames: string[],
): Promise<string | null> {
  const folders = await listFolders(config);
  const bySpecialUse = folders.find((folder) => folder.specialUse === specialUse);
  if (bySpecialUse) return bySpecialUse.path;

  const byName = folders.find((folder) => fallbackNames.includes(folder.name.toLowerCase()));
  return byName?.path ?? null;
}

export function findSentFolder(config: AccountConfig): Promise<string | null> {
  return findSpecialFolder(config, '\\Sent', [
    'sent',
    'gesendet',
    'sent items',
    'gesendete elemente',
    'gesendete objekte',
  ]);
}

export function findDraftsFolder(config: AccountConfig): Promise<string | null> {
  return findSpecialFolder(config, '\\Drafts', ['drafts', 'entwürfe', 'entwuerfe']);
}

/**
 * Legt einen Ordner an. Der Pfad enthält bei Unterordnern bereits das Trennzeichen des
 * Servers - welches das ist, verrät listFolders.
 */
export async function createFolder(config: AccountConfig, path: string): Promise<void> {
  await withClient(config, async (client) => {
    const ergebnis = await client.mailboxCreate(path);
    if (!ergebnis) throw new Error(`Ordner "${path}" konnte nicht angelegt werden.`);
  });
}

/**
 * Benennt einen Ordner um. Unterordner wandern beim Umbenennen mit - das erledigt der
 * Server, nicht wir.
 */
export async function renameFolder(
  config: AccountConfig,
  path: string,
  neuerPfad: string,
): Promise<void> {
  await withClient(config, async (client) => {
    const ergebnis = await client.mailboxRename(path, neuerPfad);
    if (!ergebnis) throw new Error(`Ordner "${path}" konnte nicht umbenannt werden.`);
  });
}

/** Löscht einen Ordner samt Inhalt. */
export async function deleteFolder(config: AccountConfig, path: string): Promise<void> {
  await withClient(config, async (client) => {
    const ergebnis = await client.mailboxDelete(path);
    if (!ergebnis) throw new Error(`Ordner "${path}" konnte nicht gelöscht werden.`);
  });
}

/**
 * Löscht alle Nachrichten eines Ordners unwiderruflich - gedacht für Papierkorb und
 * Spam. Liefert die Zahl der entfernten Nachrichten zurück.
 */
export async function emptyFolder(config: AccountConfig, folder: string): Promise<number> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const alle = (await client.search({ all: true }, { uid: true })) || [];
      if (alle.length === 0) return 0;
      const ergebnis = await client.messageDelete(alle, { uid: true });
      if (!ergebnis) throw new Error('Leeren wurde vom Server abgelehnt.');
      return alle.length;
    } finally {
      lock.release();
    }
  });
}

/**
 * Markiert alle ungelesenen Nachrichten eines Ordners als gelesen. Liefert die Zahl der
 * betroffenen Nachrichten - erst suchen, dann setzen, damit nicht der ganze Ordner
 * angefasst wird, wenn dort ohnehin nichts Ungelesenes liegt.
 */
export async function markFolderSeen(config: AccountConfig, folder: string): Promise<number> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const ungelesen = (await client.search({ seen: false }, { uid: true })) || [];
      if (ungelesen.length === 0) return 0;
      await client.messageFlagsAdd(ungelesen, ['\\Seen'], { uid: true });
      return ungelesen.length;
    } finally {
      lock.release();
    }
  });
}

/** Verschiebt Nachrichten in einen anderen Ordner (z.B. in den Papierkorb). */
export async function moveMessages(
  config: AccountConfig,
  folder: string,
  uids: number[],
  targetFolder: string,
): Promise<void> {
  if (uids.length === 0) return;
  if (folder === targetFolder) {
    throw new Error('Quell- und Zielordner sind identisch.');
  }
  await withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // ImapFlow nutzt den MOVE-Befehl und weicht auf COPY + \Deleted + EXPUNGE aus,
      // wenn der Server MOVE nicht unterstützt.
      const result = await client.messageMove(uids, targetFolder, { uid: true });
      if (!result) {
        throw new Error(`Verschieben nach "${targetFolder}" wurde vom Server abgelehnt.`);
      }
    } finally {
      lock.release();
    }
  });
}

/** Löscht Nachrichten unwiderruflich (\Deleted + EXPUNGE). */
export async function deleteMessages(
  config: AccountConfig,
  folder: string,
  uids: number[],
): Promise<void> {
  if (uids.length === 0) return;
  await withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const result = await client.messageDelete(uids, { uid: true });
      if (!result) {
        throw new Error('Löschen wurde vom Server abgelehnt.');
      }
    } finally {
      lock.release();
    }
  });
}

/**
 * Übersetzt die Einschränkungen in eine IMAP-Suchbedingung.
 *
 * Die Schlüssel eines Suchobjekts verknüpft ImapFlow mit UND. Gmails Rohsuche kann
 * dabei nur einmal vorkommen, deshalb werden deren Bestandteile zu einer Zeichenkette
 * zusammengesetzt.
 */
function baueSuchbedingung(
  kriterien: SearchCriteria,
  gmailVerfuegbar: boolean,
): Record<string, unknown> {
  const bedingung: Record<string, unknown> = {};
  const gmail: string[] = [];

  if (kriterien.text) {
    bedingung.or = [
      { subject: kriterien.text },
      { from: kriterien.text },
      { to: kriterien.text },
      { body: kriterien.text },
    ];
  }
  if (kriterien.from) bedingung.from = kriterien.from;
  if (kriterien.subject) bedingung.subject = kriterien.subject;
  if (kriterien.since) bedingung.since = new Date(kriterien.since);
  // "before" meint den Tag einschließlich, IMAP schneidet aber davor ab - deshalb einen
  // Tag weiter, sonst fehlte in "bis 31.07." der 31. Juli selbst.
  if (kriterien.before) {
    const bis = new Date(kriterien.before);
    bis.setDate(bis.getDate() + 1);
    bedingung.before = bis;
  }
  if (kriterien.unreadOnly) bedingung.seen = false;

  if (kriterien.withAttachment) {
    if (!gmailVerfuegbar) {
      // IMAP kennt kein Kriterium für Anhänge, und die naheliegende Annäherung über die
      // Kopfzeile "Content-Type: multipart/mixed" ist unbrauchbar: GMX antwortet darauf
      // mit null Treffern, obwohl die betreffenden Nachrichten nachweislich diesen Typ
      // tragen. Ein Filter, der still nichts findet, ist schlechter als keiner - deshalb
      // lieber ein klarer Abbruch, und die Oberfläche bietet ihn gar nicht erst an.
      const err = new Error(
        'Dieser Anbieter kann nicht nach Anhängen suchen - IMAP kennt dafür kein ' +
          'Kriterium, und nur Gmail bietet eine eigene Suche dafür.',
      ) as Error & { code?: string };
      err.code = ATTACHMENT_SEARCH_UNSUPPORTED;
      throw err;
    }
    gmail.push('has:attachment');
  }
  if (kriterien.category) gmail.push(`category:${kriterien.category}`);

  if (gmail.length > 0) bedingung.gmraw = gmail.join(' ');
  // Ohne jede Bedingung würde ImapFlow nichts finden - dann ist alles gemeint.
  if (Object.keys(bedingung).length === 0) bedingung.all = true;
  return bedingung;
}

export interface AbsenderEintrag {
  adresse: string;
  name?: string;
  /** Nachrichten dieses Absenders im Ordner - exakt, nicht hochgerechnet. */
  gesamt: number;
  ungelesen: number;
  /** Jüngste Nachricht des Absenders in der Stichprobe - Anker zum Abmelden. */
  beispielUid?: number;
  beispielBetreff?: string;
  /** Abmeldeweg, sofern der Absender einen angibt. */
  listUnsubscribe?: string;
  einKlickAbmeldung?: boolean;
}

export interface AbsenderUebersicht {
  eintraege: AbsenderEintrag[];
  /** Wie viele Nachrichten für die Ermittlung angesehen wurden. */
  stichprobe: number;
  /** Nachrichten im Ordner insgesamt. */
  imOrdner: number;
}

/**
 * Ermittelt, wer den Ordner vollmacht.
 *
 * Zweistufig, weil beides für sich nicht reicht: Wer die häufigsten Absender sind, ließe
 * sich nur durch Ansehen aller Kopfdaten sicher sagen - bei 30.000 Nachrichten dauert das
 * Minuten. Eine Stichprobe der jüngsten Nachrichten findet sie dagegen zuverlässig, denn
 * wer regelmäßig schreibt, taucht darin auf.
 *
 * Die *Zahlen* dürfen aber nicht geschätzt sein - danach wird gelöscht. Deshalb wird für
 * jeden gefundenen Absender einzeln gesucht: der Server liefert dabei nur Zahlen zurück,
 * das ist auch über den gesamten Bestand schnell.
 */
export async function senderUebersicht(
  config: AccountConfig,
  folder: string,
  stichprobe = 500,
  maxAbsender = 12,
): Promise<AbsenderUebersicht> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const alle = (await client.search({ all: true }, { uid: true })) || [];
      const juengste = alle.slice(-stichprobe);
      if (juengste.length === 0) {
        return { eintraege: [], stichprobe: 0, imOrdner: alle.length };
      }

      const gesehen = new Map<string, AbsenderEintrag & { inStichprobe: number }>();
      for (const nachricht of await fetchSummaries(client, juengste)) {
        const von = nachricht.from[0];
        if (!von?.address) continue;
        const schluessel = von.address.toLowerCase();
        const vorhanden = gesehen.get(schluessel);
        if (vorhanden) {
          vorhanden.inStichprobe++;
          continue;
        }
        gesehen.set(schluessel, {
          adresse: von.address,
          name: von.name,
          gesamt: 0,
          ungelesen: 0,
          inStichprobe: 1,
          // Die jüngste Nachricht steht in fetchSummaries vorn - sie trägt den
          // aktuellsten Abmeldeweg, ältere können veraltete Adressen nennen.
          beispielUid: nachricht.uid,
          beispielBetreff: nachricht.subject,
          listUnsubscribe: nachricht.listUnsubscribe,
          einKlickAbmeldung: nachricht.einKlickAbmeldung,
        });
      }

      const haeufigste = [...gesehen.values()]
        .sort((a, b) => b.inStichprobe - a.inStichprobe)
        .slice(0, maxAbsender);

      for (const eintrag of haeufigste) {
        const treffer = (await client.search({ from: eintrag.adresse }, { uid: true })) || [];
        eintrag.gesamt = treffer.length;
        const offen =
          (await client.search({ from: eintrag.adresse, seen: false }, { uid: true })) || [];
        eintrag.ungelesen = offen.length;
      }

      return {
        eintraege: haeufigste
          .map(({ inStichprobe: _, ...rest }) => rest)
          .sort((a, b) => b.gesamt - a.gesamt),
        stichprobe: juengste.length,
        imOrdner: alle.length,
      };
    } finally {
      lock.release();
    }
  });
}

/**
 * Verschiebt alle Nachrichten eines Absenders in einen Ordner - typischerweise in den
 * Papierkorb. Liefert die Zahl der bewegten Nachrichten.
 */
export async function verschiebeVonAbsender(
  config: AccountConfig,
  folder: string,
  absender: string,
  ziel: string,
): Promise<number> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const uids = (await client.search({ from: absender }, { uid: true })) || [];
      if (uids.length === 0) return 0;
      const ergebnis = await client.messageMove(uids, ziel, { uid: true });
      if (!ergebnis) throw new Error(`Verschieben nach "${ziel}" wurde vom Server abgelehnt.`);
      return uids.length;
    } finally {
      lock.release();
    }
  });
}

/**
 * Sucht in mehreren Ordnern und führt die Treffer zusammen.
 *
 * Alles auf einer Verbindung: pro Ordner die Trefferzahl und die jüngsten UIDs holen,
 * dann nur für diese die Kopfdaten. Ein Postfach mit dreißig Ordnern erzeugt so dreißig
 * Suchbefehle, aber nur einen Abruf von Kopfdaten in der Größe einer Seite.
 *
 * Die Auswahl je Ordner erfolgt über die höchsten UIDs - innerhalb eines Ordners sind das
 * die jüngsten Nachrichten. Über Ordner hinweg sind UIDs nicht vergleichbar, deshalb wird
 * am Ende nach Datum sortiert.
 */
export async function searchFolders(
  config: AccountConfig,
  ordner: string[],
  kriterien: SearchCriteria,
  limit = DEFAULT_PAGE_SIZE,
): Promise<SearchResult> {
  return withClient(config, async (client) => {
    const bedingung = baueSuchbedingung(kriterien, supportsCategories(client));
    const treffer: SearchHit[] = [];
    let gesamt = 0;

    for (const pfad of ordner) {
      let lock;
      try {
        lock = await client.getMailboxLock(pfad);
      } catch {
        // Ein Ordner, der sich nicht öffnen lässt, darf die übrige Suche nicht abbrechen.
        continue;
      }
      try {
        const uids = (await client.search(bedingung, { uid: true })) || [];
        gesamt += uids.length;
        if (uids.length === 0) continue;

        const juengste = uids.slice(-limit);
        for (const zusammenfassung of await fetchSummaries(client, juengste)) {
          treffer.push({ ...zusammenfassung, folder: pfad });
        }
      } finally {
        lock.release();
      }
    }

    treffer.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
    return { hits: treffer.slice(0, limit), total: gesamt, hasMore: gesamt > limit };
  });
}

/**
 * Sucht serverseitig und liefert seitenweise Treffer.
 *
 * Die Begrenzung ist hier wesentlich: eine Volltextsuche nach einem häufigen Wort trifft
 * in einem großen Postfach zehntausende Nachrichten. Vorher wurden die Kopfdaten aller
 * Treffer in einem Durchgang geladen - bei 30.000 Nachrichten hätte das die Anwendung
 * minutenlang blockiert.
 */
export async function searchMessages(
  config: AccountConfig,
  folder: string,
  kriterien: SearchCriteria,
  options: ListMessagesOptions = {},
): Promise<MessagePage> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // Bei aktiver Einordnung müssen beide Bedingungen zutreffen - sonst würde eine
      // Suche in "Werbung" plötzlich den ganzen Posteingang durchsuchen.
      const category = kriterien.category ?? options.category;
      if (category) requireCategorySupport(client, category);
      const bedingung = baueSuchbedingung(
        { ...kriterien, category },
        supportsCategories(client),
      );

      const treffer = (await client.search(bedingung, { uid: true })) || [];

      const { uids, nextCursor, hasMore } = seitenAnteil(treffer, options.beforeUid, pageSize);
      return {
        messages: await fetchSummaries(client, uids),
        total: treffer.length,
        nextCursor,
        hasMore,
      };
    } finally {
      lock.release();
    }
  });
}
