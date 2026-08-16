import type { Einladung } from './ics.js';
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

/**
 * Eine weitere Absenderadresse desselben Kontos.
 *
 * Anzeigename und Signatur können je Adresse eigene sein - wer dienstlich und privat
 * über dasselbe Postfach schreibt, will unter beiden nicht gleich unterschreiben.
 * Bleiben sie leer, gelten die des Kontos.
 */
export interface Identitaet {
  id: string;
  email: string;
  displayName?: string;
  signature?: string;
}

export interface AccountConfig {
  id: string;
  email: string;
  /** Anzeigename für ausgehende Nachrichten, z.B. "Hendrik Zeuch". */
  displayName?: string;
  /** Signatur als HTML; wird beim Verfassen unter den Text gesetzt. */
  signature?: string;
  /**
   * Weitere Adressen, unter denen von diesem Konto gesendet werden darf.
   *
   * Fast jeder hat davon welche: Aliase des Anbieters, eine Adresse der eigenen Domain,
   * die auf dasselbe Postfach zeigt, oder eine Sammeladresse wie "info@". Verschickt
   * wird immer über denselben Sendeserver - nur der Absender im Kopf ist ein anderer.
   *
   * Die Adresse des Kontos selbst steht nicht in dieser Liste; sie ist immer die erste
   * Wahl und ergibt sich aus "email".
   */
  identitaeten?: Identitaet[];
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  auth: AccountAuth;
  /**
   * Der Weg nach draußen für dieses Konto, falls es keinen direkten gibt.
   *
   * Eine Adresse wie `http://proxy.firma.de:3128` oder `socks5://…`, wahlweise mit
   * Anmeldung. Leer heißt nicht "direkt", sondern "was allgemein gilt" - siehe die
   * Reihenfolge in proxy.ts. Eine Vorgabe aus der Richtliniendatei schlägt diesen Wert;
   * sonst könnte ein Nutzer die Ausgangskontrolle seines Unternehmens umgehen, indem er
   * hier etwas anderes einträgt.
   *
   * Enthält im Zweifel ein Kennwort und wird deshalb wie ein Geheimnis behandelt: bei der
   * Sicherung ausgelassen, im Protokoll unkenntlich gemacht.
   */
  proxy?: string;
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
  /**
   * Kennung des Gesprächs, sofern der Server eine führt (Gmail über X-GM-THRID).
   * Dann ist die Gruppierung eindeutig und muss nicht abgeleitet werden.
   */
  threadId?: string;
  /** Eigene Kennung der Nachricht - Anker für abgeleitete Gespräche. */
  messageId?: string;
  /** Kennung der Nachricht, auf die geantwortet wurde. */
  inReplyTo?: string;
  /**
   * Alle Kennungen des Gesprächsfadens aus der Kopfzeile "References". Manche Programme
   * antworten auf eine ältere Nachricht des Gesprächs statt auf die letzte - dann führt
   * inReplyTo allein in die Irre, und erst diese Liste stellt den Bezug her.
   */
  references?: string[];
  /**
   * Der Absender kennzeichnet die Nachricht selbst als maschinell erzeugt, über
   * "Precedence: bulk" oder "Auto-Submitted" (RFC 3834). Eine Antwort erwartet dort
   * niemand - Versandbestätigungen und Rechnungen tragen es.
   */
  maschinell?: boolean;
  /**
   * Inhalt der Kopfzeile "List-Unsubscribe", sofern vorhanden - der vom Absender selbst
   * angegebene Weg, den Verteiler zu verlassen. In einer Stichprobe trugen 72 % der
   * eingehenden Nachrichten diese Zeile.
   */
  listUnsubscribe?: string;
  /**
   * Ob der Absender die Abmeldung per einfacher Anfrage unterstützt (RFC 8058) - dann
   * genügt ein Klick, ohne den Umweg über eine Webseite oder eine Mail.
   */
  einKlickAbmeldung?: boolean;
  /** Kennung des Verteilers ("List-Id") - taugt als Bedingung für Regeln. */
  listId?: string;
  /**
   * Der Rückweg der Nachricht ("Return-Path") - die Adresse des Umschlags.
   *
   * Nicht dasselbe wie `from`: Der Kopf sagt, wer unterschrieben hat, der Umschlag, wohin
   * eine Rückmeldung geht. Bei einem Verteiler stehen dort verschiedene Adressen, und für
   * eine maschinelle Antwort gilt der Umschlag - so steht es in RFC 3834.
   *
   * **Eine leere Zeichenkette ist die wichtigste Ausprägung.** `Return-Path: <>` heißt
   * "hierauf wird nicht geantwortet" und kennzeichnet Zustellberichte. Wer darauf
   * antwortet, baut sich eine Endlosschleife: Der Bericht kommt zurück, die Antwort geht
   * hinaus, und so fort. Deshalb wird hier zwischen `undefined` (keine Zeile vorhanden)
   * und `''` (ausdrücklich leer) unterschieden.
   */
  rueckweg?: string;
  /**
   * Der Absender bittet ausdrücklich darum, keine maschinelle Antwort zu bekommen
   * ("X-Auto-Response-Suppress", von Microsoft eingeführt und weithin beachtet).
   *
   * Getrennt von `maschinell`, weil es etwas anderes sagt: Diese Zeile kann auch an einer
   * Nachricht stehen, die ein Mensch geschrieben hat.
   */
  keineAutoAntwort?: boolean;
  /**
   * Die Adresse, an die der Absender eine Lesebestätigung haben will
   * ("Disposition-Notification-To", RFC 8098).
   *
   * Roh übernommen, samt Namensteil - wer sie auswertet, muss die Adresse selbst
   * herauslösen und vor allem mit dem Absender vergleichen. Dass die beiden auseinander
   * fallen können, ist kein Sonderfall, sondern der bekannte Missbrauch: Eine Nachricht
   * an einen Verteiler, deren Bestätigungen an ein fremdes Postfach gehen, macht aus
   * vierhundert Lesern vierhundert Absender. Siehe lesebestaetigung.ts.
   */
  bestaetigungAn?: string;
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
   * Eine Besprechungseinladung, sofern die Nachricht eine trägt. Ohne das Auswerten
   * bekäme der Nutzer nur eine Datei namens "invite.ics" zu sehen.
   */
  einladung?: Einladung;
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
  /**
   * Ob der Absender freigegeben ist, seine entfernten Bilder also ohne Rückfrage geladen
   * werden dürfen. Wird vom Server bei jedem Abruf frisch bestimmt, nicht mitgespeichert.
   */
  absenderVertraut?: boolean;
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
  /**
   * Unter welcher der eigenen Adressen gesendet wird. Fehlt sie, ist es die des Kontos.
   * Der Sendeserver bleibt in jedem Fall derselbe.
   */
  absender?: { email: string; displayName?: string };
  /**
   * Eine iCalendar-Antwort (METHOD:REPLY). Geht als gleichrangige Fassung neben dem
   * Text hinaus, nicht als Anhang - nur so trägt der Organisator die Zusage ein.
   */
  kalenderAntwort?: string;
  /**
   * Eine abgetrennte OpenPGP-Unterschrift. Ist sie gesetzt, wird die Nachricht als
   * "multipart/signed" nach RFC 3156 gebaut.
   */
  pgpSignatur?: string;
  /**
   * Der unterschriebene Teil, wie er unterschrieben wurde. Wird unverändert übernommen -
   * ihn hier neu zu bauen hieße, die Unterschrift zu brechen.
   */
  pgpSignierterTeil?: string;
  /**
   * Der Geheimtext einer verschlüsselten Nachricht. Ist er gesetzt, wird sie als
   * "multipart/encrypted" gebaut, und "text" wie "html" bleiben leer.
   */
  pgpGeheimtext?: string;
  /**
   * Dasselbe noch einmal für S/MIME - und bewusst als eigene Felder.
   *
   * Sie mit den PGP-Feldern zusammenzulegen wäre verlockend und falsch: Die beiden
   * Verfahren bauen die Nachricht unterschiedlich (RFC 3156 gegen RFC 8551), und ein
   * gemeinsames Feld hieße, an jeder Stelle mitzuführen, welches der beiden gerade
   * gemeint ist. Ein vergessenes Mitführen wäre eine Nachricht, die niemand lesen kann.
   *
   * "smimeSignatur" ist die fertige Signatur in Base64, "smimeGeheimtext" das ganze
   * verschlossene Paket, ebenfalls in Base64.
   */
  smimeSignatur?: string;
  smimeSignierterTeil?: string;
  smimeGeheimtext?: string;
  /**
   * Weitere Kopfzeilen, wörtlich übernommen.
   *
   * Gebraucht für die Abwesenheitsnotiz, und dort nicht als Beiwerk: `Auto-Submitted:
   * auto-replied` ist nach RFC 3834 die Zeile, an der die Gegenseite erkennt, dass hier
   * eine Maschine geantwortet hat - und ohne die zwei Abwesenheitsnotizen einander bis
   * zum Postfachüberlauf beantworten.
   */
  kopfzeilen?: Record<string, string>;
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
  /**
   * Nur Nachrichten mit diesem Etikett - dem IMAP-Schlüsselwort, nicht dem angezeigten
   * Namen. Serverseitig über SEARCH KEYWORD, das jeder Server kennt, der Etiketten
   * überhaupt annimmt.
   */
  etikett?: string;
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

/**
 * Bedingungen einer Regel. Alles, was gesetzt ist, muss zutreffen - eine Regel ohne jede
 * Bedingung würde auf alles passen und wird deshalb abgewiesen.
 */
export interface RegelBedingung {
  /** Teilzeichenkette in Absendername oder -adresse. */
  von?: string;
  betreff?: string;
  /** Teilzeichenkette in einer der Empfängeradressen. */
  an?: string;
  /** Kennung des Verteilers ("List-Id"). */
  listId?: string;
  /** Trifft nur auf Rundmails zu - erkennbar an der Abmelde-Kopfzeile. */
  nurRundmail?: boolean;
}

/** Was mit einer passenden Nachricht geschehen soll. Mehreres ist zugleich möglich. */
export interface RegelAktion {
  /** Zielordner; leer bedeutet: liegen lassen. */
  verschiebeNach?: string;
  alsGelesen?: boolean;
  markieren?: boolean;
  /** In den Papierkorb - bewusst nicht endgültig. */
  inDenPapierkorb?: boolean;
}

export interface Regel {
  id: string;
  name: string;
  aktiv: boolean;
  bedingungen: RegelBedingung;
  aktionen: RegelAktion;
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
  /**
   * Älteste zuerst statt neueste. Kostet nichts: geblättert wird durch dieselbe Liste
   * von Nummern, nur vom anderen Ende her.
   */
  aeltesteZuerst?: boolean;
}

export interface MessagePage {
  messages: MessageSummary[];
  /** Gesamtzahl im Ordner bzw. Treffer bei einer Suche. */
  total: number;
  /** Marke für die nächste Seite; null, wenn nichts mehr folgt. */
  nextCursor: number | null;
  hasMore: boolean;
  /**
   * Die "UID-Gültigkeit" des Ordners. Ändert der Server sie, hat er die Nummerierung
   * neu begonnen und alle gemerkten UIDs zeigen ins Leere - die lokale Ablage muss den
   * Ordner dann räumen. Fehlt, wenn der Server sie nicht meldet.
   */
  uidValidity?: number;
}
