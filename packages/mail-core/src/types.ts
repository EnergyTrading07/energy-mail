export interface PasswordAuth {
  type: 'password';
  user: string;
  pass: string;
}

export interface OAuth2Auth {
  type: 'oauth2';
  provider: 'google' | 'microsoft';
  user: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export type AccountAuth = PasswordAuth | OAuth2Auth;

export interface AccountConfig {
  id: string;
  email: string;
  /** Anzeigename für ausgehende Nachrichten, z.B. "Hendrik Zeuch". */
  displayName?: string;
  /** Signatur als HTML; wird beim Verfassen unter den Text gesetzt. */
  signature?: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  auth: AccountAuth;
  /**
   * Gesetzt, sobald der Anbieter die hinterlegte Anmeldung nicht mehr anerkennt (bei
   * Google nach sieben Tagen, solange das Cloud-Projekt im Testbetrieb steht).
   *
   * Wird festgehalten statt nur gemeldet, damit die Oberfläche den Zustand auch nach
   * einem Neustart kennt und nicht erst wieder in denselben Fehler laufen muss. Das
   * Konto bleibt dabei vollständig erhalten - Anzeigename, Signatur und Einstellungen
   * überstehen die neue Anmeldung.
   */
  authExpired?: boolean;
}

export interface FolderInfo {
  path: string;
  name: string;
  specialUse?: string;
  flags: string[];
  /** Trennzeichen der Pfadebenen, z.B. "/" bei Gmail - Grundlage für die Baumdarstellung. */
  delimiter: string;
  /** Anzahl ungelesener Nachrichten; fehlt, wenn der Server sie nicht meldet. */
  unseen?: number;
  /**
   * Ob der Ordner Nachrichten enthalten kann. Gmail führt "[Gmail]" als reinen
   * Container - ein Verschieben dorthin scheitert.
   */
  selectable: boolean;
  /**
   * Ob der Ordner alle Nachrichten des Kontos spiegelt (Gmails "Alle Nachrichten").
   * Sein Ungelesen-Zähler dupliziert den Posteingang, und Verschieben ist in Gmails
   * Etikettenmodell bedeutungslos - dafür ist er das richtige Ziel für eine Suche
   * über den gesamten Bestand.
   */
  isAllMail: boolean;
}

export interface EmailAddress {
  name?: string;
  address: string;
}

export interface MessageSummary {
  uid: number;
  subject: string;
  from: EmailAddress[];
  to: EmailAddress[];
  /** Wird für "Allen antworten" gebraucht. */
  cc: EmailAddress[];
  date: Date | null;
  flags: string[];
  /** Abgeleitet aus dem IMAP-Flag \Seen - gelesen oder nicht. */
  seen: boolean;
  hasAttachments: boolean;
}

/**
 * Nur Metadaten - der Inhalt wird bewusst nicht mitgeliefert. Sonst würde jedes Öffnen
 * einer Nachricht sämtliche Anhänge mitschleppen (als JSON-Bytefolge sogar rund
 * dreieinhalbfach aufgebläht). Zum Herunterladen dient downloadAttachment() mit der partId.
 */
export interface AttachmentInfo {
  /** IMAP-Body-Part, über den sich genau dieser Anhang einzeln abrufen lässt. */
  partId?: string;
  filename?: string;
  contentType: string;
  size: number;
  /**
   * Content-ID eines eingebetteten Teils - der Wert, auf den der HTML-Text mit
   * "cid:..." verweist. Nur bei Bildern im Fließtext gesetzt; darüber wird der Verweis
   * auf eine abrufbare Adresse umgeschrieben, statt die Bilddaten in die Antwort zu
   * packen.
   */
  contentId?: string;
}

export interface FullMessage extends MessageSummary {
  text?: string;
  html?: string | false;
  attachments: AttachmentInfo[];
  /**
   * Message-ID dieser Nachricht. Grundlage dafür, dass eine Antwort beim Empfänger im
   * richtigen Gesprächsverlauf einsortiert wird - Mailprogramme gehen über diese
   * Kopfzeilen, nicht über den Betreff.
   */
  messageId?: string;
  /** Kette der vorangegangenen Nachrichten des Verlaufs. */
  references?: string[];
  inReplyTo?: string;
  /** Falls gesetzt, gehen Antworten hierhin statt an den Absender (z.B. Verteiler). */
  replyTo?: EmailAddress[];
}

export interface OutgoingMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
}

/**
 * Gmails Einordnung des Posteingangs ("Tabs" in Gmails eigener Oberfläche).
 *
 * Keine IMAP-Ordner und keine Etiketten - sie sind ausschließlich über Gmails
 * Suchsprache erreichbar (X-GM-RAW, Erweiterung X-GM-EXT-1). Andere Anbieter haben
 * nichts Vergleichbares, deshalb gibt es das nur dort, wo der Server die Erweiterung
 * meldet.
 */
export const GMAIL_CATEGORIES = ['promotions', 'social', 'updates', 'forums'] as const;

export type GmailCategory = (typeof GMAIL_CATEGORIES)[number];

export interface CategoryInfo {
  id: GmailCategory;
  /** Nachrichten in dieser Einordnung. */
  total: number;
  /** Davon ungelesen. */
  unseen: number;
}

/**
 * Einschränkungen einer Suche. Alles, was gesetzt ist, muss zutreffen - der Server
 * verknüpft die Bedingungen mit UND.
 */
export interface SearchCriteria {
  /** Freitext; trifft in Betreff, Absender, Empfänger oder Inhalt. */
  text?: string;
  from?: string;
  subject?: string;
  /** Tagesdatum (JJJJ-MM-TT); Nachrichten ab diesem Tag. */
  since?: string;
  /** Tagesdatum (JJJJ-MM-TT); Nachrichten vor diesem Tag. */
  before?: string;
  unreadOnly?: boolean;
  /**
   * Nur Nachrichten mit Anhang. Bei Gmail über dessen eigene Suche und damit genau; bei
   * anderen Anbietern kennt IMAP kein solches Kriterium, dort wird über den Nachrichtentyp
   * angenähert (siehe imapClient).
   */
  withAttachment?: boolean;
  category?: GmailCategory;
}

/** Ein Suchtreffer weiß, wo er liegt - eine UID gilt nur innerhalb ihres Ordners. */
export interface SearchHit extends MessageSummary {
  folder: string;
  /** Nur bei kontoübergreifender Suche gesetzt. */
  accountId?: string;
  email?: string;
}

export interface SearchResult {
  hits: SearchHit[];
  /** Zahl aller Treffer, auch der nicht mitgelieferten. */
  total: number;
  /** Ob mehr Treffer vorliegen, als zurückgegeben wurden. */
  hasMore: boolean;
}

export interface ListMessagesOptions {
  /**
   * Nur Nachrichten mit kleinerer UID liefern - das ist die Marke für "die nächste,
   * ältere Seite". Bewusst nicht nach Seitennummern: Positionen verschieben sich, sobald
   * Mail eintrifft oder gelöscht wird, und beim Blättern in großen Postfächern würden
   * dadurch Nachrichten übersprungen oder doppelt erscheinen.
   */
  beforeUid?: number;
  pageSize?: number;
  /**
   * Auf eine Einordnung von Gmail einschränken. Wirkt als zusätzliche Bedingung der
   * serverseitigen Suche, nicht als Ordnerwechsel - die Nachrichten liegen weiterhin im
   * angegebenen Ordner, weshalb Löschen, Verschieben und Markieren unverändert arbeiten.
   */
  category?: GmailCategory;
}

export interface MessagePage {
  messages: MessageSummary[];
  /** Gesamtzahl im Ordner bzw. Treffer bei einer Suche. */
  total: number;
  /** Marke für die nächste Seite; null, wenn nichts mehr folgt. */
  nextCursor: number | null;
  hasMore: boolean;
}
