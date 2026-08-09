import { type FetchMessageObject, type ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { withClient, withThrowawayClient } from './connectionPool.js';
import { nimmtEtikettenAn } from './etiketten.js';
import { leseEinladung, type Einladung } from './ics.js';
import { alsMboxEintragBytes } from './mbox.js';
import { findeOffeneVorgaenge, type OffenerVorgang } from './nachfassen.js';
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
/*
 * Die folgenden vier Umwandlungen brauchen kein Netz und werden deshalb ausdruecklich
 * herausgereicht - allein damit sie sich pruefen lassen. Sie stecken in dieser Datei,
 * weil sie nur hier gebraucht werden; geprueft gehoeren sie trotzdem, denn an ihnen
 * haengt, was der Nutzer als Absender, Anhang, Treffer und Fehlermeldung zu sehen
 * bekommt.
 */

export function decodedSize(node: StructureNode): number {
  const size = node.size ?? 0;
  if (node.encoding?.toLowerCase() === 'base64') {
    return Math.floor((size * 3) / 4);
  }
  return size;
}

export function attachmentFilename(node: StructureNode): string | undefined {
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
export function collectAttachments(node: unknown, into: AttachmentInfo[] = []): AttachmentInfo[] {
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

/**
 * Bis zu dieser Größe wird eine Nachricht ohne einzeln abrufbare Teile noch vollständig
 * geladen.
 *
 * Ohne Mehrteiligkeit gibt es keine Anhänge - solche Nachrichten sind praktisch immer
 * klein. Die Grenze fängt den seltenen Rest: eine einzelne große Datei, die jemand ohne
 * MIME-Umschlag verschickt hat. Sie ganz zu laden hieße, den Server für alle anzuhalten.
 */
const RUECKFALL_HOECHSTGROESSE = 25 * 1024 * 1024;

/** Welche Teile einer Nachricht ihren Text ausmachen - und welcher die Einladung ist. */
export interface Textteile {
  /** Part-ID des reinen Texts, falls vorhanden. */
  text?: string;
  /** Part-ID der HTML-Fassung, falls vorhanden. */
  html?: string;
  /** Part-ID einer Termineinladung (text/calendar). */
  einladung?: string;
}

/**
 * Sucht in der Struktur die Teile heraus, die den Nachrichtentext tragen.
 *
 * Der Grund für diese Funktion: bisher wurde die VOLLSTÄNDIGE Nachricht geladen und
 * durch den MIME-Leser geschickt, nur um Text und HTML herauszuholen. Bei einer Mail mit
 * einem 80-MB-Anhang belegte allein das Öffnen ein Vielfaches davon im Arbeitsspeicher -
 * Rohbytes, dekodierte Anhänge und Textteile nebeneinander. Zwei gleichzeitige Zugriffe
 * genügten, um den Serverprozess mit "JavaScript heap out of memory" zu beenden. Bei
 * einem Nutzer ist das ein Absturz; bei fünfzig nimmt einer alle mit.
 *
 * Die Anhänge kommen ohnehin schon aus der Struktur (collectAttachments) - ihre Bytes
 * wurden also geladen, wieder verworfen und später bei Bedarf einzeln erneut geholt.
 *
 * Was ein "Textteil" ist und was ein Anhang, entscheidet dieselbe Regel wie bei den
 * Anhängen: ein Teil mit Dateinamen oder mit disposition "attachment" ist eine Datei,
 * auch wenn er text/plain ist. Eine beigelegte Textdatei gehört nicht in den
 * Nachrichtenkörper.
 *
 * Bei mehreren Teilen derselben Art gewinnt der erste - das ist bei multipart/alternative
 * die Reihenfolge, in der der Absender sie angeboten hat.
 */
export function findeTextteile(node: unknown, gefunden: Textteile = {}): Textteile {
  if (!node || typeof node !== 'object') return gefunden;
  const current = node as StructureNode;

  const typ = current.type?.toLowerCase();
  const istDatei = Boolean(attachmentFilename(current)) || current.disposition === 'attachment';

  if (current.part && !istDatei) {
    if (typ === 'text/plain' && !gefunden.text) gefunden.text = current.part;
    else if (typ === 'text/html' && !gefunden.html) gefunden.html = current.part;
    else if (typ === 'text/calendar' && !gefunden.einladung) gefunden.einladung = current.part;
  }

  /*
   * In eine eingebettete Nachricht wird NICHT hineingestiegen.
   *
   * message/rfc822 ist eine weitergeleitete Mail. Ihr Text ist nicht der Text dieser
   * Nachricht - er würde sonst als Körper erscheinen, obwohl er zu einem Anhang gehört.
   */
  if (typ === 'message/rfc822') return gefunden;

  for (const child of current.childNodes ?? []) {
    findeTextteile(child, gefunden);
  }
  return gefunden;
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
    // Der ganze Faden, nicht nur der unmittelbare Vorgänger: manche Programme antworten
    // auf eine ältere Nachricht des Gesprächs, dann führt inReplyTo allein in die Irre.
    references: kopf['references']?.split(/\s+/).filter(Boolean),
    listUnsubscribe: kopf['list-unsubscribe'] || undefined,
    // Der Absender kündigt damit an, eine schlichte Anfrage zu akzeptieren - kein
    // Umweg über eine Webseite, kein Bestätigungsklick.
    einKlickAbmeldung: kopf['list-unsubscribe-post'] ? true : undefined,
    listId: kopf['list-id'] || undefined,
    // Beide sagen dasselbe: hier hat eine Maschine geschrieben, keine Person.
    // "Precedence: bulk" ist der alte Weg, "Auto-Submitted" der von RFC 3834.
    maschinell:
      /^bulk|list|junk$/i.test(kopf['precedence'] ?? '') ||
      /^auto-/i.test(kopf['auto-submitted'] ?? '')
        ? true
        : undefined,
  };
}

/**
 * ImapFlow wirft für Login- wie Netzwerkfehler gleichermaßen "Command failed"; die
 * verwertbare Information steckt in responseText bzw. im Node-Fehlercode.
 */
export function describeImapError(err: unknown): string {
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

/** Was beim Setzen eines Etiketts herauskam. */
export interface EtikettErgebnis {
  /** Ob der Ordner eigene Schlüsselwörter dauerhaft behält. */
  dauerhaft: boolean;
}

/**
 * Hängt Etiketten an Nachrichten oder nimmt sie ab.
 *
 * Vor dem Setzen wird gefragt, ob der Ordner eigene Schlüsselwörter überhaupt behält.
 * Der Grund ist unangenehm: ein STORE mit einem unbekannten Schlüsselwort gelingt auch
 * dann, wenn der Server es gleich wieder vergisst - gemeldet wird nichts, und das
 * Etikett ist beim nächsten Öffnen des Ordners spurlos verschwunden. Ob er es behält,
 * sagt er nur beim Öffnen in PERMANENTFLAGS.
 *
 * Nachgemessen bei GMX und Gmail: beide nennen dort "\*", nehmen "$label1" wie auch
 * eigene Wörter an und haben sie nach dem Trennen der Verbindung noch.
 */
export async function setzeEtiketten(
  config: AccountConfig,
  folder: string,
  uids: number[],
  hinzu: string[],
  weg: string[] = [],
): Promise<EtikettErgebnis> {
  if (uids.length === 0 || (hinzu.length === 0 && weg.length === 0)) {
    return { dauerhaft: true };
  }

  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const permanent = client.mailbox ? [...(client.mailbox.permanentFlags ?? [])] : [];
      const dauerhaft = nimmtEtikettenAn(permanent);

      // Abnehmen zuerst: wer ein Etikett gegen ein anderes tauscht, soll nicht kurz
      // beide tragen - manche Ansicht liest genau dazwischen.
      if (weg.length > 0) await client.messageFlagsRemove(uids, weg, { uid: true });
      if (hinzu.length > 0) await client.messageFlagsAdd(uids, hinzu, { uid: true });

      return { dauerhaft };
    } finally {
      lock.release();
    }
  });
}

/**
 * Sagt für einen Ordner, ob Etiketten dort halten. Wird beim Öffnen des Etikettenfensters
 * gefragt, damit man es erfährt, bevor man welche vergibt.
 */
export async function pruefeEtikettenUnterstuetzung(
  config: AccountConfig,
  folder: string,
): Promise<boolean> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      return nimmtEtikettenAn(client.mailbox ? [...(client.mailbox.permanentFlags ?? [])] : []);
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
  aeltesteZuerst = false,
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
      // Nur diese wenigen Zeilen, nicht der ganze Kopf: sie tragen Abmeldeweg,
      // Verteilerkennung und Gespraechsfaden - Grundlage fuer Abmeldung, Regeln und
      // die Suche nach Liegengebliebenem.
      headers: ['list-unsubscribe', 'list-unsubscribe-post', 'list-id', 'references', 'precedence', 'auto-submitted'],
    },
    { uid: true },
  )) {
    messages.push(summarizeMessage(msg));
  }
  messages.sort((a, b) => {
    const abstand = (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
    return aeltesteZuerst ? -abstand : abstand;
  });
  return messages;
}

/** Schneidet aus aufsteigenden UIDs die nächste Seite heraus (höchste = neueste). */
function seitenAnteil(
  aufsteigend: number[],
  beforeUid: number | undefined,
  pageSize: number,
  aeltesteZuerst = false,
): { uids: number[]; nextCursor: number | null; hasMore: boolean } {
  /**
   * Von hinten oder von vorn.
   *
   * "Älteste zuerst" kostet nichts: die Liste aller Nummern liegt beim Öffnen des
   * Ordners ohnehin vor, und statt vom Ende wird eben vom Anfang genommen. Das ist der
   * Grund, warum sich nach Datum der ganze Ordner sortieren lässt und nach Absender
   * oder Betreff nicht - dafür bräuchte man die Kopfdaten jeder einzelnen Nachricht.
   */
  if (aeltesteZuerst) {
    const kandidaten = beforeUid ? aufsteigend.filter((uid) => uid > beforeUid) : aufsteigend;
    const uids = kandidaten.slice(0, pageSize);
    return {
      uids,
      nextCursor: uids.length > 0 ? Math.max(...uids) : null,
      hasMore: kandidaten.length > uids.length,
    };
  }

  const kandidaten = beforeUid ? aufsteigend.filter((uid) => uid < beforeUid) : aufsteigend;
  const uids = kandidaten.slice(-pageSize);
  return {
    uids,
    nextCursor: uids.length > 0 ? Math.min(...uids) : null,
    hasMore: kandidaten.length > uids.length,
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
      const { uids, nextCursor, hasMore } = seitenAnteil(
        treffer,
        options.beforeUid,
        pageSize,
        options.aeltesteZuerst,
      );

      return {
        messages: await fetchSummaries(client, uids, options.aeltesteZuerst),
        total,
        nextCursor,
        hasMore,
        // Reicht die lokale Ablage durch: ändert sie sich, sind alle gemerkten UIDs
        // dieses Ordners wertlos und müssen weg. Der Server liefert sie als bigint,
        // weil sie bis 2^32 gehen darf - als Zahl bleibt sie bis dahin genau.
        uidValidity:
          mailbox && typeof mailbox !== 'boolean' && mailbox.uidValidity !== undefined
            ? Number(mailbox.uidValidity)
            : undefined,
      };
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
      let replyTo: { name?: string; address: string }[] = [];
      /** Für den Rückfall unten: nur die Größe entscheidet, ob er noch vertretbar ist. */
      let groesse = 0;
      for await (const msg of client.fetch(
        String(uid),
        {
      envelope: true,
      flags: true,
      uid: true,
      bodyStructure: true,
      threadId: true,
      // Nur fuer den Rueckfall unten gebraucht: er entscheidet daran, ob das Laden der
      // vollstaendigen Nachricht noch vertretbar ist.
      size: true,
      // Nur diese wenigen Zeilen, nicht der ganze Kopf: sie tragen Abmeldeweg,
      // Verteilerkennung und Gespraechsfaden - Grundlage fuer Abmeldung, Regeln und
      // die Suche nach Liegengebliebenem.
      headers: ['list-unsubscribe', 'list-unsubscribe-post', 'list-id', 'references', 'precedence', 'auto-submitted'],
    },
        { uid: true },
      )) {
        summary = summarizeMessage(msg);
        structure = msg.bodyStructure;
        replyTo = toAddresses(msg.envelope?.replyTo);
        groesse = msg.size ?? 0;
      }
      if (!summary) throw new Error(`Nachricht ${uid} nicht gefunden in ${folder}`);

      /*
       * Nur die Teile holen, die gebraucht werden - nicht die ganze Nachricht.
       *
       * Vorher lud diese Stelle die vollständige Nachricht herunter und schickte sie
       * durch den MIME-Leser, nur um Text und HTML herauszuholen. Die Anhänge kamen
       * ohnehin schon aus der Struktur; ihre Bytes wurden also geladen, wieder verworfen
       * und später bei Bedarf einzeln erneut geholt.
       *
       * Bei einer Mail mit einem 80-MB-Anhang belegte allein das Öffnen ein Vielfaches
       * davon: Rohbytes, dekodierte Anhänge und Textteile nebeneinander im Speicher.
       * Zwei gleichzeitige Zugriffe genügten für "JavaScript heap out of memory" - bei
       * einem Nutzer ein Absturz, bei fünfzig nimmt einer alle mit.
       *
       * imapflow dekodiert einen einzeln geholten Teil vollständig: Transfer-Encoding,
       * format=flowed und den Zeichensatz nach UTF-8. Was hier ankommt, ist fertiger
       * Text.
       */
      const teile = findeTextteile(structure);

      const holeTeil = async (part: string | undefined): Promise<string | undefined> => {
        if (!part) return undefined;
        try {
          const { content } = await client.download(String(uid), part, { uid: true });
          if (!content) return undefined;
          const stuecke: Buffer[] = [];
          for await (const stueck of content) stuecke.push(stueck as Buffer);
          return Buffer.concat(stuecke).toString('utf-8');
        } catch {
          // Ein Teil, den der Server nicht herausgibt, darf nicht die ganze Nachricht
          // kosten - lieber ohne HTML anzeigen als gar nicht.
          return undefined;
        }
      };

      const [text, html, kalender] = await Promise.all([
        holeTeil(teile.text),
        holeTeil(teile.html),
        holeTeil(teile.einladung),
      ]);

      /*
       * Rückfall für Nachrichten ohne brauchbare Struktur.
       *
       * Eine Nachricht ohne Mehrteiligkeit hat keine Teil-Kennung, die sich einzeln
       * abrufen ließe. Solche Nachrichten sind aber genau die kleinen: ohne Mehrteiligkeit
       * gibt es keine Anhänge. Der alte Weg bleibt also für den billigen Fall - und mit
       * einer Obergrenze, damit eine einzelne riesige Datei ohne Umschlag nicht doch
       * durchrutscht.
       */
      let rueckfall: Awaited<ReturnType<typeof simpleParser>> | null = null;
      if (text === undefined && html === undefined) {
        if (groesse > RUECKFALL_HOECHSTGROESSE) {
          throw new Error(
            `Diese Nachricht ist ${Math.round(groesse / 1024 / 1024)} MB groß und hat keine ` +
              'einzeln abrufbaren Teile. Sie lässt sich über "Quelltext" ansehen oder als ' +
              'Datei sichern.',
          );
        }
        const { content } = await client.download(String(uid), undefined, { uid: true });
        // keepCidLinks: sonst ersetzt mailparser jeden "cid:"-Verweis durch die
        // Bilddaten selbst. Bei einer Nachricht mit sechs eingebetteten Bildern machte
        // das 197 von 215 KB der Antwort aus - Daten, die der Browser ohnehin einzeln
        // und bei Bedarf laden kann.
        rueckfall = await simpleParser(content, { keepCidLinks: true });
      }

      /*
       * Message-ID, In-Reply-To und References stehen bereits in `summary`.
       *
       * Sie kommen aus dem Umschlag und den wenigen ausdrücklich geholten Kopfzeilen -
       * summarizeMessage liest sie ohnehin. Der MIME-Leser hat sie bisher nur noch
       * einmal ermittelt und überschrieben: die ganze Nachricht zu laden war damit auch
       * der teuerste denkbare Weg zu vier Zeichenketten.
       */
      return {
        ...summary,
        einladung: kalender
          ? findeEinladung([{ contentType: 'text/calendar', content: Buffer.from(kalender) }])
          : findeEinladung(rueckfall?.attachments),
        text: text ?? (typeof rueckfall?.text === 'string' ? rueckfall.text : undefined),
        html: html ?? rueckfall?.html ?? undefined,
        // Aus der Struktur statt aus den geladenen Teilen - so gehen keine Anhangsbytes
        // mit in die Antwort.
        attachments: collectAttachments(structure),
        replyTo: replyTo.length > 0 ? replyTo : undefined,
      };
    } finally {
      lock.release();
    }
  });
}

/**
 * Sucht in den Teilen einer Nachricht die Kalenderdatei.
 *
 * Eine Besprechungseinladung steckt als Teil vom Typ "text/calendar" in der Nachricht -
 * mal mit Dateinamen ("invite.ics"), mal ohne. mailparser reicht beides unter den
 * Anhängen durch, weil es weder Text noch HTML ist.
 *
 * Eine Antwort auf eine Einladung (METHOD:REPLY) wird bewusst mit ausgewertet: dann
 * steht in der Nachricht, wer zu- oder abgesagt hat, und das gehört angezeigt.
 */
function findeEinladung(
  teile: { contentType?: string; filename?: string; content?: Buffer }[] | undefined,
): Einladung | undefined {
  for (const teil of teile ?? []) {
    const istKalender =
      (teil.contentType ?? '').toLowerCase().startsWith('text/calendar') ||
      (teil.filename ?? '').toLowerCase().endsWith('.ics');
    if (!istKalender || !teil.content) continue;

    try {
      const gelesen = leseEinladung(teil.content.toString('utf8'));
      if (gelesen.termine.length > 0) return gelesen;
    } catch {
      // Eine unlesbare Kalenderdatei ist kein Grund, die Nachricht nicht zu zeigen.
    }
  }
  return undefined;
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
 * Gibt einen ganzen Ordner als mbox aus.
 *
 * Strömend statt am Stück: ein Ordner mit 31.700 Nachrichten wäre als Zeichenkette im
 * Arbeitsspeicher mehrere Gigabyte. Jede Nachricht geht einzeln durch "schreibe" und
 * ist danach wieder weg.
 *
 * Gibt die Zahl der ausgegebenen Nachrichten zurück. Einzelne, die sich nicht holen
 * lassen, werden übersprungen und gezählt - eine Sicherung, die an einer beschädigten
 * Nachricht ganz abbricht, ist keine.
 */
export async function exportiereAlsMbox(
  config: AccountConfig,
  folder: string,
  // Buffer statt string: siehe alsMboxEintragBytes - der Weg über eine Zeichenkette
  // zerstörte alles, was nicht UTF-8 ist.
  schreibe: (stueck: Buffer) => void | Promise<void>,
  optionen: { melde?: Fortschritt; hoechstens?: number } = {},
): Promise<{ ausgegeben: number; uebersprungen: number; gruende: string[] }> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const alle = (await client.search({ all: true }, { uid: true })) || [];
      const uids = optionen.hoechstens ? alle.slice(-optionen.hoechstens) : alle;

      let ausgegeben = 0;
      let uebersprungen = 0;
      /** Die ersten Gründe für übersprungene Nachrichten - für die Rückmeldung. */
      const gruende: string[] = [];

      for (const [i, uid] of uids.entries()) {
        // Nicht bei jeder einzelnen melden - bei 30.000 Nachrichten wäre die Meldung
        // teurer als die Arbeit.
        if (i % 25 === 0) {
          optionen.melde?.(i, uids.length, `${i} von ${uids.length} gesichert`);
        }

        try {
          const { content } = await client.download(String(uid), undefined, { uid: true });
          const teile: Buffer[] = [];
          for await (const stueck of content) teile.push(stueck as Buffer);
          const roh = Buffer.concat(teile);

          /*
           * Absender und Datum kommen aus dem Kopf - und nur der wird als Text gelesen.
           *
           * Der Kopf ist nach RFC 5322 ASCII; alles darüber hinaus steht dort als
           * kodiertes Wort. 'latin1' bildet jedes Byte eindeutig auf ein Zeichen ab und
           * kann daher nichts verlieren - anders als 'utf-8', das ungültige Folgen durch
           * U+FFFD ersetzt. Der Rumpf wird gar nicht erst umgewandelt.
           */
          const kopfEnde = roh.indexOf('\r\n\r\n');
          const kopf = (kopfEnde >= 0 ? roh.subarray(0, kopfEnde) : roh.subarray(0, 8192)).toString(
            'latin1',
          );
          const von = kopf.match(/^From:\s*.*?([^\s<>]+@[^\s<>]+)/im)?.[1];
          const datumZeile = kopf.match(/^Date:\s*(.+)$/im)?.[1];
          const datum = datumZeile ? new Date(datumZeile) : null;

          await schreibe(
            alsMboxEintragBytes(roh, von, datum && !Number.isNaN(datum.getTime()) ? datum : null),
          );
          ausgegeben++;
        } catch (err) {
          uebersprungen++;
          // Den Grund festhalten, statt ihn zu verschlucken: "0 ausgegeben, 31.700
          // übersprungen" ohne jede Erklärung ist für den Nutzer wertlos.
          if (gruende.length < 5) gruende.push(`UID ${uid}: ${(err as Error).message}`);
        }
      }

      optionen.melde?.(uids.length, uids.length, 'fertig');
      return { ausgegeben, uebersprungen, gruende };
    } finally {
      lock.release();
    }
  });
}

/**
 * Die Nachricht so, wie sie über die Leitung kam - alle Kopfzeilen, alle Teile.
 *
 * Man braucht sie, um zu prüfen, ob eine Mail echt ist (Absenderprüfung, Weg über die
 * Server), um zu verstehen, warum etwas nicht dargestellt wird, und um sie als Datei
 * zu sichern. Jedes andere Mailprogramm kann das.
 */
/**
 * Die Nachricht als reine Bytes, ohne jede Umwandlung.
 *
 * Für das Prüfen einer Unterschrift ist das der einzig gangbare Weg. getRawMessage()
 * deutet den Inhalt als UTF-8; bei einer Nachricht mit "Content-Transfer-Encoding: 8bit"
 * und Zeichen, die kein gültiges UTF-8 ergeben, kämen dabei Ersatzzeichen heraus - und
 * die Unterschrift schlüge fehl, obwohl mit der Nachricht alles in Ordnung ist. Eine
 * grundlose Warnung ist schlimmer als keine.
 */
/**
 * Die MIME-Struktur einer Nachricht, ohne ihren Inhalt zu laden.
 *
 * Daran erkennt man, ob eine Nachricht mit OpenPGP geschützt ist - und zwar bevor man
 * sie überhaupt herunterlädt.
 */
export async function getBodyStructure(
  config: AccountConfig,
  folder: string,
  uid: number,
): Promise<unknown> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const nachricht = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
      return nachricht ? nachricht.bodyStructure : undefined;
    } finally {
      lock.release();
    }
  });
}

export async function getRawMessageBytes(
  config: AccountConfig,
  folder: string,
  uid: number,
): Promise<Buffer> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      const teile: Buffer[] = [];
      for await (const stueck of content) teile.push(stueck as Buffer);
      return Buffer.concat(teile);
    } finally {
      lock.release();
    }
  });
}

export async function getRawMessage(
  config: AccountConfig,
  folder: string,
  uid: number,
): Promise<string> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { content } = await client.download(String(uid), undefined, { uid: true });
      const teile: Buffer[] = [];
      for await (const stueck of content) teile.push(stueck as Buffer);
      // Nachrichten sind nach RFC in ASCII kodiert; alles darüber hinaus steckt in
      // kodierten Wörtern und bleibt so lesbar, wie es im Original steht.
      return Buffer.concat(teile).toString('utf-8');
    } finally {
      lock.release();
    }
  });
}

/**
 * Sucht, was liegengeblieben ist: worauf noch eine Antwort aussteht und wem man selbst
 * noch eine schuldet.
 *
 * Beide Ordner werden über einen Zeitraum abgefragt statt über eine feste Anzahl. Eine
 * Anzahl wäre bei stark genutzten Postfächern zu kurz und bei ruhigen unnötig lang; der
 * Zeitraum trifft in beiden Fällen genau das, was überhaupt als offen gelten kann.
 */
export async function offeneVorgaenge(
  config: AccountConfig,
  optionen: {
    mindestTage?: number;
    hoechstTage?: number;
    auchUnbekannte?: boolean;
    melde?: Fortschritt;
  } = {},
): Promise<OffenerVorgang[]> {
  const hoechstTage = optionen.hoechstTage ?? 90;
  const gesendetOrdner = await findSentFolder(config);
  // Einen Tag Zuschlag, damit an der Grenze nichts durchfällt: IMAP sucht auf den Tag
  // genau, die Auswertung rechnet dagegen mit vollen Tagen ab dem Zeitpunkt.
  const seit = new Date(Date.now() - (hoechstTage + 1) * 86_400_000);

  return withClient(config, async (client) => {
    const holen = async (ordner: string): Promise<MessageSummary[]> => {
      const lock = await client.getMailboxLock(ordner);
      try {
        const uids = (await client.search({ since: seit }, { uid: true })) || [];
        // Deckel gegen Vielschreiber: mehr als das braucht kein Überblick, und der
        // Abruf soll nicht minutenlang laufen.
        return await fetchSummaries(client, uids.slice(-1500));
      } finally {
        lock.release();
      }
    };

    // Zwei Ordner über Monate - bei einem großen Postfach dauert das Sekunden.
    optionen.melde?.(0, 3, 'Posteingang wird durchgesehen');
    const posteingang = await holen('INBOX');

    // Ohne Gesendet-Ordner fehlt die halbe Wahrheit - dann bleibt nur, was ich schulde.
    optionen.melde?.(1, 3, gesendetOrdner ? 'Gesendet wird durchgesehen' : 'Gesendet fehlt');
    const gesendet = gesendetOrdner ? await holen(gesendetOrdner) : [];

    optionen.melde?.(2, 3, 'Gespräche werden zusammengeführt');

    return findeOffeneVorgaenge(
      { posteingang, gesendet, gesendetOrdner: gesendetOrdner ?? '', posteingangOrdner: 'INBOX' },
      {
        eigeneAdressen: [config.email],
        mindestTage: optionen.mindestTage,
        hoechstTage,
        auchUnbekannte: optionen.auchUnbekannte,
      },
    );
  });
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
      /*
       * Hier ist { all: true } richtig und nicht die UID-Liste: gemeint ist der ganze
       * Ordner, imapflow löst das serverseitig zu "1:*" auf. Das umgeht zugleich die
       * Zeilenlängengrenze, an der die aufgezählte Liste bei großen Ordnern scheiterte -
       * und weil ohnehin alles weg soll, ist ein blankes EXPUNGE hier unbedenklich.
       */
      const ergebnis = await client.messageDelete({ all: true }, { uid: true });
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
): Promise<{ neueUids: number[] }> {
  if (uids.length === 0) return { neueUids: [] };
  if (folder === targetFolder) {
    throw new Error('Quell- und Zielordner sind identisch.');
  }
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // ImapFlow nutzt den MOVE-Befehl und weicht auf COPY + \Deleted + EXPUNGE aus,
      // wenn der Server MOVE nicht unterstützt.
      const result = await client.messageMove(uids, targetFolder, { uid: true });
      if (!result) {
        throw new Error(`Verschieben nach "${targetFolder}" wurde vom Server abgelehnt.`);
      }
      /*
       * Im Zielordner haben die Nachrichten andere Nummern.
       *
       * Wer sie zurückholen will, braucht die neuen - mit den alten griffe er im
       * Papierkorb nach irgendetwas anderem oder ins Leere. Server mit UIDPLUS nennen
       * sie in der Antwort auf COPY/MOVE; ohne UIDPLUS bleibt die Liste leer, und der
       * Aufrufer bietet dann keinen Rückweg an.
       */
      const zuordnung = (result as { uidMap?: Map<number, number> }).uidMap;
      return { neueUids: zuordnung ? [...zuordnung.values()] : [] };
    } finally {
      lock.release();
    }
  });
}

/**
 * Verschiebt Nachrichten und meldet zurück, welche Kennung sie am Ziel bekommen haben.
 *
 * UIDs gelten nur innerhalb eines Ordners; nach dem Verschieben ist die alte wertlos.
 * Server mit der Erweiterung UIDPLUS teilen die neue mit - ohne sie lässt sich eine
 * verschobene Nachricht nicht mehr sicher wiederfinden, und der Aufrufer muss damit
 * umgehen. Deshalb steht die Zuordnung hier ausdrücklich im Ergebnis statt verworfen zu
 * werden wie bei moveMessages.
 */
export async function verschiebeMitKennung(
  config: AccountConfig,
  folder: string,
  uids: number[],
  targetFolder: string,
): Promise<{ neueUids: Map<number, number> }> {
  return withClient(config, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const ergebnis = await client.messageMove(uids, targetFolder, { uid: true });
      if (!ergebnis) {
        throw new Error(`Verschieben nach "${targetFolder}" wurde vom Server abgelehnt.`);
      }
      return { neueUids: ergebnis.uidMap ?? new Map<number, number>() };
    } finally {
      lock.release();
    }
  });
}

/**
 * Stellt sicher, dass der Server gezielt löschen kann.
 *
 * Ohne die Erweiterung UIDPLUS sendet imapflow ein blankes EXPUNGE - und das entfernt
 * ALLE Nachrichten des Ordners, die irgendwo ein \Deleted tragen, nicht nur die
 * angeforderten. Wer parallel Thunderbird benutzt (das beim Löschen zunächst nur
 * markiert), verlöre damit beim Löschen einer einzigen Mail unwiderruflich alle dort
 * vorgemerkten. Auf einem Server ohne UIDPLUS ist das nicht zurückzuholen.
 *
 * Deshalb: lieber gar nicht löschen als das Falsche löschen. Der Nutzer bekommt einen
 * Satz, der sagt, was er stattdessen tun kann.
 */
function pruefeGezieltesLoeschen(client: ImapFlow): void {
  if (client.capabilities?.has('UIDPLUS')) return;
  throw new Error(
    'Dieser Mailserver kennt UIDPLUS nicht. Endgültiges Löschen würde dort auch ' +
      'Nachrichten treffen, die ein anderes Programm nur zum Löschen vorgemerkt hat. ' +
      'Verschieben Sie die Nachricht stattdessen in den Papierkorb.',
  );
}

/** Löscht Nachrichten unwiderruflich (\Deleted + EXPUNGE). */
export async function deleteMessages(
  config: AccountConfig,
  folder: string,
  uids: number[],
): Promise<void> {
  if (uids.length === 0) return;
  await withClient(config, async (client) => {
    pruefeGezieltesLoeschen(client);
    const lock = await client.getMailboxLock(folder);
    try {
      // In Blöcken: eine ungepackte UID-Liste sprengt bei großen Ordnern die
      // Zeilenlängengrenze des Servers (siehe inBloecken).
      for (const block of inBloecken(uids)) {
        const result = await client.messageDelete(block, { uid: true });
        if (!result) {
          throw new Error('Löschen wurde vom Server abgelehnt.');
        }
      }
    } finally {
      lock.release();
    }
  });
}

/**
 * Zerlegt eine UID-Liste in Blöcke.
 *
 * imapflow fügt ein Array nur mit Kommas zusammen; es verdichtet nicht zu Bereichen.
 * Der Papierkorb eines gewachsenen Postfachs mit 31.700 Nachrichten ergab damit eine
 * Befehlszeile von rund 250 kB - Dovecot bricht bei 64 kB (imap_max_line_length) mit
 * BAD ab. "Papierkorb leeren" scheiterte also genau dann, wenn man es braucht.
 */
export function inBloecken(uids: number[], groesse = 500): number[][] {
  const bloecke: number[][] = [];
  for (let i = 0; i < uids.length; i += groesse) {
    bloecke.push(uids.slice(i, i + groesse));
  }
  return bloecke;
}

/**
 * Übersetzt die Einschränkungen in eine IMAP-Suchbedingung.
 *
 * Die Schlüssel eines Suchobjekts verknüpft ImapFlow mit UND. Gmails Rohsuche kann
 * dabei nur einmal vorkommen, deshalb werden deren Bestandteile zu einer Zeichenkette
 * zusammengesetzt.
 */
export function baueSuchbedingung(
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
  if (kriterien.etikett) bedingung.keyword = kriterien.etikett;

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
/**
 * Rückmeldung über den Stand eines länger dauernden Vorgangs. Optional: die Auswertung
 * funktioniert auch ohne, sie meldet dann eben nichts.
 */
export type Fortschritt = (getan: number, von: number, text?: string) => void;

export async function senderUebersicht(
  config: AccountConfig,
  folder: string,
  stichprobe = 500,
  maxAbsender = 12,
  melde?: Fortschritt,
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

      // Hier liegt die Zeit: je Absender ein eigener Suchlauf. Bei zwölf Absendern sind
      // das zwölf Runden, und ohne Rückmeldung sieht das aus wie ein Hänger.
      let getan = 0;
      for (const eintrag of haeufigste) {
        melde?.(getan++, haeufigste.length, `${eintrag.adresse} wird gezählt`);
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

      const { uids, nextCursor, hasMore } = seitenAnteil(
        treffer,
        options.beforeUid,
        pageSize,
        options.aeltesteZuerst,
      );
      return {
        messages: await fetchSummaries(client, uids, options.aeltesteZuerst),
        total: treffer.length,
        nextCursor,
        hasMore,
      };
    } finally {
      lock.release();
    }
  });
}
