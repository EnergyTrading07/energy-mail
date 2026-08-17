import type {
  CategoryInfo,
  Etikett,
  FolderInfo,
  FullMessage,
  GmailCategory,
  MessageSummary,
  OutgoingMessage,
  ProviderId,
  Regel,
  RegelBedingung,
} from '@energy-mail/mail-core';
import { t } from './sprache.js';

// Leerer Default: UI und API laufen normalerweise auf derselben Origin (der Server
// liefert das gebaute Frontend mit aus). Nur im Vite-Dev-Modus wird VITE_API_URL
// gesetzt, um auf den separat laufenden Server zu zeigen.
/*
 * Der Fragezeichenpunkt ist kein Zierrat.
 *
 * `import.meta.env` setzt Vite beim Bauen ein; unter reinem Node - also in jeder Pruefung,
 * die dieses Modul einbindet - gibt es das Objekt nicht, und `import.meta.env.VITE_API_URL`
 * wirft beim blossen Einbinden. Damit war api.ts fuer Pruefungen unerreichbar, und alles,
 * was es benutzt (also fast jedes Fenster), gleich mit.
 */
const API_BASE = import.meta.env?.VITE_API_URL ?? '';

export interface Account {
  id: string;
  email: string;
  displayName?: string;
  /** Signatur als HTML. */
  signature?: string;
  /** Anbieterkennung - bestimmt Farbgebung und anbietereigene Aktionen. */
  provider?: ProviderId;
  /** Ob sich das Konto über den Anbieter neu anmelden lässt (nur OAuth-Konten). */
  canReauth?: boolean;
  /** Die hinterlegte Anmeldung wird vom Anbieter nicht mehr anerkannt. */
  needsReauth?: boolean;
  /** Weitere Adressen, unter denen von diesem Konto gesendet werden darf. */
  identitaeten?: Identitaet[];
  /**
   * Der eingetragene Weg nach draussen - OHNE Anmeldung.
   *
   * Der Server kuerzt sie heraus, bevor er antwortet: ein Proxy-Kennwort ist in Firmen
   * oft dasselbe wie das Windows-Kennwort, und diese Antwort landet im Browserspeicher
   * und in den Entwicklerwerkzeugen. Nur zum Anzeigen zu gebrauchen, nicht zum
   * Zurueckschicken.
   */
  proxy?: string;
  /**
   * Gesetzt, wenn dieses Postfach jemand anderem gehört und für mich freigegeben ist.
   *
   * Fehlt es, ist es mein eigenes. Die Oberfläche entscheidet daran, was sie anzeigt und
   * was sie kennzeichnet - verboten wird nichts hier: Der Riegel sitzt am Server
   * (nutzer/freigabeHaken.ts), und wer die Adresse von Hand aufruft, bekommt 403.
   */
  freigabe?: {
    id: string;
    /** Kennung des Eigentümers. */
    von: string;
    rechte: 'lesen' | 'voll';
  };
}

/** Eine Freigabe, wie sie der Server führt. */
export interface Freigabe {
  id: string;
  besitzer: string;
  kontoId: string;
  email: string;
  an: string;
  rechte: 'lesen' | 'voll';
  angelegt: string;
}

export function holeFreigaben(): Promise<{ eigene: Freigabe[]; erhalten: Freigabe[] }> {
  return request('/freigaben');
}

export function freigeben(
  kontoId: string,
  an: string,
  rechte: 'lesen' | 'voll',
): Promise<Freigabe> {
  return request('/freigaben', {
    method: 'POST',
    body: JSON.stringify({ kontoId, an, rechte }),
  });
}

export function freigabeBeenden(id: string): Promise<{ ok: boolean }> {
  return request(`/freigaben/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/** Eine weitere Absenderadresse. Leerer Name oder Signatur heißt "wie das Konto". */
export interface Identitaet {
  id: string;
  email: string;
  displayName?: string;
  signature?: string;
}

export interface Contact {
  address: string;
  name?: string;
  count?: number;
  lastSeen?: string;
  /** Im Adressbuch eingetragen - nicht nur nebenbei aus der Post aufgelesen. */
  gepflegt?: boolean;
  /**
   * Der Vorschlag stammt aus dem Firmenverzeichnis und nicht aus dem eigenen Adressbuch.
   *
   * Die Oberflaeche kennzeichnet ihn - wer eine Adresse vorgeschlagen bekommt, soll wissen,
   * woher sie kommt. Aus dem eigenen Adressbuch heisst "damit hatte ich schon zu tun"; aus
   * dem Verzeichnis heisst "so heisst diese Person laut Firmenverzeichnis".
   */
  ausVerzeichnis?: boolean;
  organisation?: string;
  abteilung?: string;
  telefon?: string;
  mobil?: string;
}

// --- Das Firmenverzeichnis (LDAP) ---

export interface Verzeichnis {
  aktiv: boolean;
  host: string;
  port: number;
  verschluesselung: 'ldaps' | 'starttls' | 'einfach';
  zertifikatPruefen: boolean;
  basis: string;
  bindDn: string;
  filter: string;
  sucheIn: string[];
  felder: {
    email: string;
    name: string;
    vorname?: string;
    nachname?: string;
    telefon?: string;
    mobil?: string;
    organisation?: string;
    abteilung?: string;
  };
}

/** Das Kennwort geht nie heraus - nur, ob eines hinterlegt ist. */
export type VerzeichnisAnzeige = Verzeichnis & { kennwortHinterlegt: boolean };

export function holeVerzeichnis(): Promise<VerzeichnisAnzeige> {
  return request('/verwaltung/verzeichnis');
}

/**
 * Speichert die Einrichtung.
 *
 * `kennwort` weggelassen heisst "unveraendert", `null` heisst "loeschen". Der Unterschied
 * ist noetig, weil das Kennwort nie zur Anzeige herauskommt - ohne ihn waere jedes
 * Speichern einer geaenderten Portnummer zugleich ein Loeschen des Kennworts.
 */
export function speichereVerzeichnis(
  wert: Partial<Verzeichnis> & { kennwort?: string | null },
): Promise<VerzeichnisAnzeige> {
  return request('/verwaltung/verzeichnis', { method: 'PUT', body: JSON.stringify(wert) });
}

export function pruefeVerzeichnis(
  wert: Partial<Verzeichnis> & { kennwort?: string },
): Promise<{ ok: boolean; treffer?: number; fehler?: string }> {
  return request('/verwaltung/verzeichnis/pruefen', {
    method: 'POST',
    body: JSON.stringify(wert),
  });
}

export function sucheImVerzeichnis(q: string): Promise<{ treffer: Contact[] }> {
  return request(`/verzeichnis/suche?q=${encodeURIComponent(q)}`);
}

/** Eine Telefonnummer mit ihrer Art ("Privat", "Arbeit", "Mobil" ...). */
export interface Telefonnummer {
  nummer: string;
  art?: string;
}

/** Ein Eintrag im Adressbuch, mit allem, was dazu erfasst werden kann. */
export interface Kontakt extends Contact {
  vorname?: string;
  nachname?: string;
  organisation?: string;
  telefone?: Telefonnummer[];
  anschrift?: string;
  geburtstag?: string;
  notiz?: string;
  weitereAdressen?: string[];
}

/**
 * Wenn die Verbindung gar nicht erst zustande kommt, wirft fetch selbst - und zwar mit
 * "Failed to fetch". Diese Zeichenkette stand bislang als einzige Auskunft in der
 * Meldung: englisch, technisch, und ohne einen Hinweis darauf, woran es liegt.
 */
/*
 * Als Funktion und nicht als Konstante: der Text würde sonst beim Einbinden gebaut, also
 * bevor die Sprache feststeht - und ausgerechnet die Meldung, die man bei einer Störung
 * zu sehen bekommt, stünde dann als einzige deutsch da.
 */
const keineVerbindung = () =>
  t(
    'Keine Verbindung zum Postfach. Prüfen Sie die Netzwerkverbindung – die Anwendung versucht es beim nächsten Abruf erneut.',
  );

/**
 * Kopfzeile, mit der sich die Oberfläche beim lokalen Server ausweist.
 *
 * Der Server beantwortet ohne sie keine Anfrage - sonst könnte jede beliebige Webseite,
 * die der Nutzer im Browser offen hat, das Postfach mitlesen. Das Geheimnis kommt von
 * der Hülle über das Vorschaltskript und wechselt bei jedem Start. Siehe
 * packages/server/src/zugang.ts.
 */
export const ZUGANG_KOPFZEILE = 'X-Energy-Mail-Zugang';

export function zugangsgeheimnis(): string {
  return window.energyMail?.zugang ?? '';
}

/**
 * Hängt das Geheimnis als Abfrageparameter an eine Adresse.
 *
 * Für alles, was nicht über `request()` läuft, sondern vom Browser selbst geladen wird:
 * Anhänge, die mbox-Sicherung, die vCard-Ausfuhr, ein ausgeführter Schlüssel und die
 * eingebetteten Bilder einer Nachricht (`cid:`). Dort lässt sich keine Kopfzeile setzen -
 * ein `<img src>` oder ein Download bestimmt der Browser, nicht die Anwendung.
 */
export function mitZugang(adresse: string): string {
  const geheimnis = zugangsgeheimnis();
  if (!geheimnis) return adresse;
  const trenner = adresse.includes('?') ? '&' : '?';
  return `${adresse}${trenner}zugang=${encodeURIComponent(geheimnis)}`;
}

/**
 * Wie lange auf eine Antwort gewartet wird, bevor abgebrochen wird.
 *
 * Vorher gab es gar keine Grenze. Antwortete der Server nicht mehr - eine hängende
 * IMAP-Verbindung nach dem Standby genügt dafür -, blieb das Versprechen für immer
 * offen. In der Liste stand dann dauerhaft "Lade Nachrichten…", und weil der Knopf
 * "Neu laden" währenddessen gesperrt ist, kam der Nutzer aus dieser Lage nicht mehr
 * heraus. Ein Abbruch mit einem lesbaren Satz ist in jedem Fall besser als eine
 * Anzeige, die nie fertig wird.
 */
const FRIST_MS = 45_000;

/** Vorgänge, die naturgemäß lange dauern und deshalb mehr Zeit bekommen. */
const LANGE_FRIST_MS = 10 * 60_000;
const LANGE_WEGE = ['/sicherung', '/mbox', '/schluessel/erzeugen', '/adressbuch/einfuhr'];

function fristFuer(path: string): number {
  return LANGE_WEGE.some((w) => path.includes(w)) ? LANGE_FRIST_MS : FRIST_MS;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchOderMelden(
    `${API_BASE}${path}`,
    {
      ...init,
      // Content-Type nur bei vorhandenem Inhalt: kündigt man JSON an und schickt nichts,
      // weist Fastify die Anfrage ab ("Body cannot be empty"). Das trifft alle Aufrufe
      // ohne Inhalt - DELETE und das Starten der OAuth-Anmeldung.
      headers: init?.body
        ? {
            'Content-Type': 'application/json',
            [ZUGANG_KOPFZEILE]: zugangsgeheimnis(),
            ...init?.headers,
          }
        : { [ZUGANG_KOPFZEILE]: zugangsgeheimnis(), ...init?.headers },
    },
    fristFuer(path),
  );
  /*
   * 423 heisst: die Sitzung ist zu.
   *
   * Hier abgefangen und nicht an achtzig Aufrufstellen. Jede von ihnen zeigte den Fehler
   * sonst als gewoehnliche rote Meldung - "Gesperrt" ueber einer leeren Nachrichtenliste,
   * und der Nutzer weiss nicht, was er tun soll.
   *
   * Gemeldet wird an alle Horcher, geworfen wird trotzdem: Der Aufrufer soll seinen
   * Vorgang abbrechen und nicht mit einem leeren Ergebnis weiterrechnen.
   */
  if (res.status === 423) {
    for (const hoere of [...sperrHoerer]) hoere();
    throw new Error(t('Gesperrt'));
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Anfrage fehlgeschlagen (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Wer erfahren will, dass die Sitzung zugefallen ist.
 *
 * Ein Ereignis und kein Rueckgabewert: Die Sperre kann bei JEDEM Abruf auftreten, auch
 * bei einem, den der Nutzer gar nicht ausgeloest hat (Hintergrundabgleich). Sie durch
 * achtzig Rueckgabetypen zu reichen hiesse, achtzig Stellen daran zu erinnern.
 */
const sperrHoerer = new Set<() => void>();

export function beiSperre(fn: () => void): () => void {
  sperrHoerer.add(fn);
  return () => sperrHoerer.delete(fn);
}

/** Wie fetch, nur mit einem Satz, den man lesen kann, wenn nichts durchkommt. */
async function fetchOderMelden(
  url: string,
  init: RequestInit,
  frist = FRIST_MS,
): Promise<Response> {
  /*
   * Eigener Abbruchgeber statt AbortSignal.timeout, damit ein vom Aufrufer
   * mitgegebenes Signal erhalten bleibt: beides muss greifen, das erste gewinnt.
   */
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), frist);
  const fremd = init.signal;
  const weiterreichen = () => abbruch.abort();
  fremd?.addEventListener('abort', weiterreichen);
  try {
    return await fetch(url, {
      ...init,
      /*
       * Kekse mitschicken - auch dann, wenn Oberfläche und Server auf verschiedenen
       * Herkünften laufen.
       *
       * Im ausgelieferten Programm liegen beide auf derselben Origin, dort wäre die
       * Vorgabe 'same-origin' ausreichend. Im Entwicklungsbetrieb steht Vite auf 5173
       * und der Server auf 4000: ohne 'include' bliebe der Sitzungskeks zu Hause, und
       * jede Anfrage käme als "nicht angemeldet" zurück.
       */
      credentials: 'include',
      signal: abbruch.signal,
    });
  } catch {
    if (fremd?.aborted) throw new Error(t('Abgebrochen'));
    if (abbruch.signal.aborted) {
      throw new Error(
        t(
          'Das Postfach hat nicht rechtzeitig geantwortet. Versuchen Sie es erneut – bei großen Ordnern kann der erste Abruf länger dauern.',
        ),
      );
    }
    throw new Error(keineVerbindung());
  } finally {
    clearTimeout(uhr);
    fremd?.removeEventListener('abort', weiterreichen);
  }
}

// --- Anmeldung ---

/**
 * Wer gerade angemeldet ist.
 *
 * Wird als Allererstes gefragt, noch vor jedem Postfachabruf: steht hier niemand, zeigt
 * die Anwendung das Anmeldefenster statt eines leeren Posteingangs.
 *
 * In der Desktop-Hülle antwortet der Server immer mit "angemeldet" - dort weist sich das
 * Fenster über das Zugangsgeheimnis des Prozesses aus, und eine Anmeldung gäbe es gar
 * nicht. `abmeldbar` unterscheidet die beiden Fälle.
 */
export interface IchAuskunft {
  angemeldet: boolean;
  nutzer?: { id: string; email: string };
  /** Nur wenn die Sitzung an einem Keks hängt, ist Abmelden sinnvoll. */
  abmeldbar?: boolean;
  /** Ob die Sitzung gerade zu ist - beim Start gefragt, damit nichts aufblitzt. */
  gesperrt?: boolean;
  /** Nach wie vielen Minuten Untätigkeit gesperrt wird; 0 heißt: gar nicht. */
  sperreNachMinuten?: number;
  /**
   * Ob dieser Mensch verwalten darf.
   *
   * Entscheidet nur, ob die Oberfläche den Weg dorthin ANZEIGT. Der Riegel sitzt am
   * Server - eine Oberfläche, die einen Knopf versteckt, hat nichts verboten.
   */
  verwalter?: boolean;
  /** Ob ein zweiter Faktor eingerichtet ist. */
  zweiFaktor?: boolean;
  /** Wie viele Wiederherstellungscodes noch übrig sind - zum Warnen, bevor keiner mehr da ist. */
  codesUebrig?: number;
}

/**
 * Ein Nutzer, wie ihn die Verwaltung sieht.
 *
 * Ohne Prüfsumme und ohne Schlüssel - der Server gibt sie nicht heraus (siehe
 * nutzerStore.oeffentlich).
 */
export interface VerwalteterNutzer {
  id: string;
  email: string;
  angelegt: string;
  gesperrt: boolean;
  verwalter: boolean;
  /** Ob dieser Nutzer einen zweiten Faktor eingerichtet hat. */
  zweiFaktor: boolean;
}

export function verwaltungNutzer(): Promise<{ nutzer: VerwalteterNutzer[]; ich: string }> {
  return request('/verwaltung/nutzer');
}

/** Legt einen Nutzer an. Das Kennwort kommt einmal zurück und steht danach nirgends mehr. */
export function verwaltungAnlegen(
  email: string,
  verwalter = false,
): Promise<{ nutzer: VerwalteterNutzer; kennwort: string }> {
  return request('/verwaltung/nutzer', {
    method: 'POST',
    body: JSON.stringify({ email, verwalter }),
  });
}

export function verwaltungAendern(
  id: string,
  was: {
    gesperrt?: boolean;
    verwalter?: boolean;
    kennwortZuruecksetzen?: boolean;
    zweiFaktorEntfernen?: boolean;
  },
): Promise<{ nutzer: VerwalteterNutzer; kennwort?: string }> {
  return request(`/verwaltung/nutzer/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(was),
  });
}

export function verwaltungEntfernen(
  id: string,
  mitDaten: boolean,
): Promise<{ entfernt: boolean; mitDaten: boolean }> {
  return request(
    `/verwaltung/nutzer/${encodeURIComponent(id)}?mitDaten=${mitDaten ? 'true' : 'false'}`,
    { method: 'DELETE' },
  );
}

export function verwaltungSitzungenSperren(id: string): Promise<{ gesperrt: number }> {
  return request(`/verwaltung/nutzer/${encodeURIComponent(id)}/sperren`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** Sperrt die eigene Sitzung sofort. */
export function sperren(): Promise<{ gesperrt: boolean }> {
  return request('/sperre', { method: 'POST', body: JSON.stringify({}) });
}

/** Macht sie mit dem Kennwort wieder auf. */
export function sperreOeffnen(kennwort: string): Promise<{ gesperrt: boolean }> {
  return request('/sperre/oeffnen', { method: 'POST', body: JSON.stringify({ kennwort }) });
}

export function frageIch(): Promise<IchAuskunft> {
  return request('/ich');
}

/**
 * Was auf ein richtiges Kennwort hin zurückkommt.
 *
 * Zwei Fälle, und die Oberfläche muss beide unterscheiden: Entweder ist die Anmeldung
 * fertig (`nutzer` steht da, der Keks ist gesetzt), oder es fehlt noch der zweite Faktor -
 * dann kommt eine Marke, die fünf Minuten gilt und ausschließlich `anmeldenMitCode` öffnet.
 */
export interface Anmeldebefund {
  nutzer?: { id: string };
  zweiFaktor?: boolean;
  marke?: string;
}

export function anmelden(email: string, kennwort: string): Promise<Anmeldebefund> {
  return request('/anmelden', { method: 'POST', body: JSON.stringify({ email, kennwort }) });
}

/** Die zweite Stufe: das Einmalkennwort oder ein Wiederherstellungscode. */
export function anmeldenMitCode(
  marke: string,
  code: string,
): Promise<{ nutzer: { id: string }; wiederherstellung?: number }> {
  return request('/anmelden/code', { method: 'POST', body: JSON.stringify({ marke, code }) });
}

// --- Der zweite Faktor am eigenen Konto ---

/** Ein QR-Bild, wie es der Server liefert: Kantenlänge und Zeilen aus "0"/"1". */
export interface QrBild {
  groesse: number;
  zeilen: string[];
}

/**
 * Schritt eins: ein Geheimnis erzeugen lassen.
 *
 * Gespeichert ist danach noch nichts - wer hier abbricht, hat nichts verändert.
 */
export function zweiFaktorBeginnen(): Promise<{ geheimnis: string; weg: string; qr: QrBild }> {
  return request('/ich/zweifaktor/beginnen', { method: 'POST', body: JSON.stringify({}) });
}

/** Schritt zwei: Kennwort und ein Code aus der App. Die Wiederherstellungscodes kommen einmal. */
export function zweiFaktorBestaetigen(kennwort: string, code: string): Promise<{ codes: string[] }> {
  return request('/ich/zweifaktor/bestaetigen', {
    method: 'POST',
    body: JSON.stringify({ kennwort, code }),
  });
}

export function zweiFaktorAus(kennwort: string): Promise<{ zweiFaktor: boolean }> {
  return request('/ich/zweifaktor/aus', { method: 'POST', body: JSON.stringify({ kennwort }) });
}

/** Ein frischer Satz Wiederherstellungscodes - die alten gelten danach nicht mehr. */
export function zweiFaktorCodes(kennwort: string): Promise<{ codes: string[] }> {
  return request('/ich/zweifaktor/codes', { method: 'POST', body: JSON.stringify({ kennwort }) });
}

// --- Abwesenheitsnotiz ---

export interface Abwesenheit {
  aktiv: boolean;
  /** Ab wann (ISO-Datum, "2026-08-01"). Leer heißt: sofort. */
  von?: string;
  /** Bis einschließlich diesem Tag. Leer heißt: bis auf Widerruf. */
  bis?: string;
  /** Eigener Betreff. Leer heißt: „Re:" und der ursprüngliche Betreff. */
  betreff?: string;
  text: string;
  /** Nur an Menschen antworten, die im Adressbuch stehen. */
  nurBekannte?: boolean;
  /** Nach wie vielen Tagen derselbe Absender wieder eine bekommt. */
  wiederholungTage?: number;
}

export function holeAbwesenheit(accountId: string): Promise<Abwesenheit> {
  return request(`/accounts/${encodeURIComponent(accountId)}/abwesenheit`);
}

export function speichereAbwesenheit(
  accountId: string,
  wert: Abwesenheit,
): Promise<Abwesenheit> {
  return request(`/accounts/${encodeURIComponent(accountId)}/abwesenheit`, {
    method: 'PUT',
    body: JSON.stringify(wert),
  });
}

/**
 * Welche Konten gerade wirklich antworten.
 *
 * Für den Hinweis in der Seitenleiste - und der ist der Punkt: Eine Abwesenheitsnotiz,
 * die man nicht sieht, bleibt drei Monate nach dem Urlaub an.
 */
export function aktiveAbwesenheiten(): Promise<{ aktiv: string[] }> {
  return request('/abwesenheit');
}

/** Das eigene Anmeldekennwort wechseln. Meldet überall ab - auch hier. */
export function kennwortAendern(alt: string, neu: string): Promise<{ ok: boolean }> {
  return request('/ich/kennwort', { method: 'POST', body: JSON.stringify({ alt, neu }) });
}

export function abmelden(): Promise<{ ok: boolean }> {
  return request('/abmelden', { method: 'POST', body: JSON.stringify({}) });
}

export function fetchAccounts(): Promise<Account[]> {
  return request('/accounts');
}

/** Von Hand eingetragene Serveradressen - sie gewinnen gegen die Suche. */
export interface Serverangaben {
  imapHost?: string;
  imapPort?: number;
  smtpHost?: string;
  smtpPort?: number;
}

export function createAccount(
  email: string,
  password: string,
  overrides?: Serverangaben,
): Promise<Account> {
  return request('/accounts', {
    method: 'POST',
    body: JSON.stringify({ email, password, overrides }),
  });
}

export function deleteAccount(accountId: string): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}`, { method: 'DELETE' });
}

export function updateAccount(
  accountId: string,
  settings: {
    displayName?: string;
    signature?: string;
    identitaeten?: Identitaet[];
    proxy?: string;
  },
): Promise<Account> {
  return request(`/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify(settings) });
}

export function fetchContacts(query: string): Promise<Contact[]> {
  return request(`/contacts?q=${encodeURIComponent(query)}`);
}

// --- Adressbuch ---

export interface Kontaktliste {
  eintraege: Kontakt[];
  gesamt: number;
}

export function ladeAdressbuch(suche = '', auchAufgelesene = false): Promise<Kontaktliste> {
  const teile = [`q=${encodeURIComponent(suche)}`];
  if (auchAufgelesene) teile.push('alle=1');
  return request(`/adressbuch?${teile.join('&')}`);
}

export function speichereKontakt(
  kontakt: Partial<Kontakt> & { address: string; vorherigeAdresse?: string },
): Promise<Kontakt> {
  return request('/adressbuch', { method: 'PUT', body: JSON.stringify(kontakt) });
}

export function loescheKontakt(adresse: string): Promise<{ ok: boolean }> {
  return request(`/adressbuch/${encodeURIComponent(adresse)}`, { method: 'DELETE' });
}

export interface EinfuhrErgebnis {
  angelegt: number;
  aktualisiert: number;
  uebergangen: number;
}

export function fuehreVisitenkartenEin(inhalt: string): Promise<EinfuhrErgebnis> {
  return request('/adressbuch/einfuhr', { method: 'POST', body: JSON.stringify({ inhalt }) });
}

/** Die Adresse, unter der die vCard-Datei heruntergeladen wird. */
export const adressbuchAusfuhrAdresse = () => mitZugang(`${API_BASE}/adressbuch/ausfuhr`);

// --- Kontenübergreifender Posteingang ---

export interface GesamtSeite {
  messages: (MessageSummary & { folder: string; accountId: string; email: string })[];
  total: number;
  /** Marke für die nächste Seite: je Konto die zuletzt gelieferte UID. */
  nextCursor: string | null;
  hasMore: boolean;
  /** Konten, die nicht antworteten - die Liste ist dann unvollständig. */
  fehlende: { accountId: string; email: string; grund: string }[];
}

export function ladeGesamtPosteingang(nach?: string | null): Promise<GesamtSeite> {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  if (nach) params.set('nach', nach);
  return request(`/posteingang?${params}`);
}

// --- OpenPGP ---

export interface SchluesselAngaben {
  fingerabdruck: string;
  kennung: string;
  adressen: string[];
  namen: string[];
  geheim: boolean;
  abgelaufen: boolean;
  zurueckgezogen: boolean;
  laeuftAb?: string;
  erzeugtAm?: string;
}

export interface SchluesselEintrag {
  fingerabdruck: string;
  angaben: SchluesselAngaben;
  fuerKonto?: string;
  hinzugefuegtAm: string;
}

export type Vertrauen =
  | 'gueltig'
  | 'gueltig-fremde-adresse'
  | 'schluessel-fehlt'
  | 'ungueltig'
  | 'schluessel-abgelaufen';

export interface PgpBefund {
  verschluesselt: boolean;
  geoeffnet: boolean;
  klartext?: string;
  signatur?: {
    vertrauen: Vertrauen;
    fingerabdruck?: string;
    schluesselAdressen?: string[];
    grund?: string;
  };
  deckungGanzerText?: boolean;
  grund?: string;
  /** Gesetzt, wenn an der Nachricht gar nichts mit OpenPGP geschuetzt ist. */
  ohnePgp?: boolean;
}

export function ladeSchluessel(): Promise<SchluesselEintrag[]> {
  return request('/schluessel');
}

export function fuegeSchluesselHinzu(
  armored: string,
  fuerKonto?: string,
): Promise<{ aufgenommen: SchluesselEintrag[]; ersetzt: number }> {
  return request('/schluessel', { method: 'POST', body: JSON.stringify({ armored, fuerKonto }) });
}

export function entferneSchluessel(fingerabdruck: string, geheim: boolean): Promise<{ ok: boolean }> {
  return request(`/schluessel/${fingerabdruck}?geheim=${geheim ? '1' : '0'}`, { method: 'DELETE' });
}

export const schluesselAusfuhrAdresse = (fingerabdruck: string) =>
  mitZugang(`${API_BASE}/schluessel/${fingerabdruck}/ausfuhr`);

export function erzeugeSchluesselpaar(
  accountId: string,
  kennwort?: string,
  art?: 'curve25519' | 'rsa4096',
): Promise<{ angaben: SchluesselAngaben; oeffentlich: string }> {
  return request(`/accounts/${accountId}/schluesselpaar`, {
    method: 'POST',
    body: JSON.stringify({ kennwort, art }),
  });
}

export interface PgpLage {
  kannSignieren: boolean;
  kannVerschluesseln: boolean;
  ohneSchluessel: string[];
}

export function ladePgpLage(accountId: string, an: string[] = []): Promise<PgpLage> {
  return request(`/accounts/${accountId}/pgp-lage?an=${encodeURIComponent(an.join(','))}`);
}

export function pruefePgpKennwort(accountId: string, kennwort: string): Promise<{ stimmt: boolean }> {
  return request(`/accounts/${accountId}/pgp-kennwort`, {
    method: 'POST',
    body: JSON.stringify({ kennwort }),
  });
}

export function pruefeNachrichtPgp(
  accountId: string,
  folder: string,
  uid: number,
  kennwort?: string,
): Promise<PgpBefund> {
  return request(
    `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/pgp`,
    { method: 'POST', body: JSON.stringify({ kennwort }) },
  );
}

// --- S/MIME ---

export interface Zertifikatsangaben {
  fingerabdruck: string;
  name: string;
  adressen: string[];
  aussteller: string;
  seriennummer: string;
  giltAb: string;
  giltBis: string;
  ausgabestelle: boolean;
  fuerMail: boolean;
  darfUnterschreiben: boolean;
  darfVerschluesseln: boolean;
  schluesselart: string;
}

export interface ZertifikatEintrag {
  fingerabdruck: string;
  angaben: Zertifikatsangaben;
  eigen: boolean;
  mitKennwort?: boolean;
  fuerKonto?: string;
  quelle?: 'nachricht' | 'datei';
  hinzugefuegtAm: string;
}

export type SmimeVertrauen =
  | 'gueltig'
  | 'gueltig-fremde-adresse'
  | 'gueltig-wurzel-unbekannt'
  | 'zertifikat-abgelaufen'
  | 'zweck-passt-nicht'
  | 'ungueltig'
  | 'nicht-pruefbar';

export interface SmimeBefund {
  verschluesselt: boolean;
  geoeffnet: boolean;
  klartext?: string;
  html?: string;
  signatur?: {
    vertrauen: SmimeVertrauen;
    fingerabdruck?: string;
    name?: string;
    zertifikatAdressen?: string[];
    aussteller?: string;
    kette?: string[];
    giltBis?: string;
    zeitpunkt?: string;
    grund?: string;
  };
  zertifikatGelernt?: boolean;
  grund?: string;
  /** Gesetzt, wenn an der Nachricht gar nichts mit S/MIME geschuetzt ist. */
  ohneSmime?: boolean;
}

export function ladeZertifikate(): Promise<ZertifikatEintrag[]> {
  return request('/smime');
}

export function ladeSchluesseldateiHoch(
  dateiBase64: string,
  kennwort: string,
  optionen: { neuesKennwort?: string; fuerKonto?: string } = {},
): Promise<ZertifikatEintrag[]> {
  return request('/smime/schluesseldatei', {
    method: 'POST',
    body: JSON.stringify({ dateiBase64, kennwort, ...optionen }),
  });
}

export function fuegeZertifikatHinzu(dateiBase64: string): Promise<ZertifikatEintrag> {
  return request('/smime/zertifikat', { method: 'POST', body: JSON.stringify({ dateiBase64 }) });
}

export function entferneZertifikat(fingerabdruck: string): Promise<{ ok: boolean }> {
  return request(`/smime/${fingerabdruck}`, { method: 'DELETE' });
}

export const zertifikatAusfuhrAdresse = (fingerabdruck: string) =>
  mitZugang(`${API_BASE}/smime/${fingerabdruck}/ausfuhr`);

export interface SmimeLage {
  kannSignieren: boolean;
  brauchtKennwort: boolean;
  kannVerschluesseln: boolean;
  ohneZertifikat: string[];
}

export function ladeSmimeLage(accountId: string, an: string[] = []): Promise<SmimeLage> {
  return request(`/accounts/${accountId}/smime-lage?an=${encodeURIComponent(an.join(','))}`);
}

export function pruefeSmimeKennwort(
  accountId: string,
  kennwort: string,
): Promise<{ stimmt: boolean }> {
  return request(`/accounts/${accountId}/smime-kennwort`, {
    method: 'POST',
    body: JSON.stringify({ kennwort }),
  });
}

export function pruefeNachrichtSmime(
  accountId: string,
  folder: string,
  uid: number,
  kennwort?: string,
): Promise<SmimeBefund> {
  return request(
    `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/smime`,
    { method: 'POST', body: JSON.stringify({ kennwort }) },
  );
}

// --- Datenschutz: Bestandsaufnahme und Unterlagen ---

export interface DatenschutzAngaben {
  betrieb?: string;
  anschrift?: string;
  vertreten?: string;
  datenschutzbeauftragter?: string;
  betreiber: 'selbst' | 'dienstleister';
  dienstleister?: string;
  fernwartung: boolean;
  fernwarter?: string;
  betriebsrat: boolean;
  beschaeftigte: boolean;
  privat: boolean;
}

export interface DatenschutzErhoben {
  nutzer: number;
  verwalter: number;
  mitZweiFaktor: number;
  freigaben: number;
  postfachanbieter: string[];
  konten: number;
  ueberOAuth: number;
  verzeichnis: boolean;
  archiv: boolean;
  archivKonten: number;
  verschluesselungBereit: boolean;
  sperrfristMinuten: number;
}

export interface DatenschutzBefund {
  verantwortlicher: string;
  auftragsverarbeiter: { wer: string; weil: string }[];
  keineAuftragsverarbeitung: { wer: string; weil: string }[];
  unterlagen: string[];
  hinweise: string[];
}

export interface Datenschutzlage {
  angaben: DatenschutzAngaben;
  erhoben: DatenschutzErhoben;
  befund: DatenschutzBefund;
}

export function ladeDatenschutz(): Promise<Datenschutzlage> {
  return request('/verwaltung/datenschutz');
}

export function speichereDatenschutz(
  wert: Partial<DatenschutzAngaben>,
): Promise<Datenschutzlage> {
  return request('/verwaltung/datenschutz', { method: 'PUT', body: JSON.stringify(wert) });
}

export function erzeugeDatenschutzUnterlagen(): Promise<{
  ordner: string;
  dateien: string[];
  befund: DatenschutzBefund;
}> {
  return request('/verwaltung/datenschutz/unterlagen', { method: 'POST' });
}

// --- Das GoBD-Archiv ---

export type Aufbewahrungsart = 'geschaeftsbrief' | 'buchungsbeleg' | 'ohne-pflicht';

export interface ArchivEinstellungen {
  konten: string[];
  vorgabe: Aufbewahrungsart;
  betrieb?: string;
  verantwortlich?: string;
}

export interface ArchivStand {
  einstellungen: ArchivEinstellungen;
  anzahl: number;
  kettenlaenge: number;
  siegel: string;
  aeltesteAm?: string;
  juengsteAm?: string;
  bytes: number;
  freigegeben: number;
}

export interface ArchivFund {
  nr: number;
  erfasstAm: string;
  entstandenAm: string;
  richtung: 'empfangen' | 'gesendet';
  kontoId: string;
  absender: string;
  empfaenger: string[];
  betreff: string;
  groesse: number;
  art: Aufbewahrungsart;
  aufbewahrenBis: string;
  freigegeben: boolean;
  vermerke: { erfasstAm: string; wer: string; text: string }[];
}

export interface Bestandsbefund {
  kette:
    | { heil: true; anzahl: number; siegel: string }
    | { heil: false; beiNr: number; grund: string; heilBis: number };
  geprueft: number;
  fehlend: number[];
  verfaelscht: number[];
}

export function ladeArchivStand(): Promise<ArchivStand> {
  return request('/archiv/stand');
}

export function speichereArchivEinstellungen(
  wert: ArchivEinstellungen,
): Promise<ArchivEinstellungen> {
  return request('/archiv/einstellungen', { method: 'PUT', body: JSON.stringify(wert) });
}

export function sucheImArchiv(bedingung: {
  text?: string;
  von?: string;
  bis?: string;
  richtung?: 'empfangen' | 'gesendet';
  art?: Aufbewahrungsart;
  konto?: string;
}): Promise<{ treffer: ArchivFund[]; gesamt: number }> {
  const teile = Object.entries(bedingung)
    .filter(([, w]) => w)
    .map(([k, w]) => `${k}=${encodeURIComponent(String(w))}`);
  return request(`/archiv/suche${teile.length ? `?${teile.join('&')}` : ''}`);
}

export const archivOriginalAdresse = (nr: number) =>
  mitZugang(`${API_BASE}/archiv/${nr}/original`);

export const verfahrensdokumentationAdresse = () =>
  mitZugang(`${API_BASE}/archiv/verfahrensdokumentation`);

export function vermerkeImArchiv(nr: number, text: string): Promise<unknown> {
  return request(`/archiv/${nr}/vermerk`, { method: 'POST', body: JSON.stringify({ text }) });
}

export function trageArchivUm(nr: number, art: Aufbewahrungsart): Promise<unknown> {
  return request(`/archiv/${nr}/art`, { method: 'POST', body: JSON.stringify({ art }) });
}

export function pruefeArchivBestand(): Promise<Bestandsbefund> {
  return request('/archiv/pruefen', { method: 'POST' });
}

export function erzeugeArchivAusfuhr(bedingung: { von?: string; bis?: string } = {}): Promise<{
  ordner: string;
  anzahl: number;
  bytes: number;
  siegel: string;
  bestandHeil: boolean;
  hinweis?: string;
}> {
  return request('/archiv/ausfuhr', { method: 'POST', body: JSON.stringify(bedingung) });
}

export function raeumeArchivAuf(wirklich: boolean): Promise<{ anzahl: number; bytes: number }> {
  return request('/archiv/aufraeumen', { method: 'POST', body: JSON.stringify({ wirklich }) });
}

// --- Einladungen ---

export type EinladungsAntwort = 'zusagen' | 'absagen' | 'vorbehalten';

export function beantworteEinladung(
  accountId: string,
  folder: string,
  uid: number,
  antwort: EinladungsAntwort,
  bemerkung?: string,
): Promise<{ ok: boolean; an: string; als: string }> {
  return request(
    `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/einladung`,
    { method: 'POST', body: JSON.stringify({ antwort, bemerkung }) },
  );
}

// --- Etiketten ---

export function ladeEtiketten(): Promise<Etikett[]> {
  return request('/etiketten');
}

export function speichereEtikett(eingabe: {
  schluessel?: string;
  name: string;
  farbe?: string;
}): Promise<Etikett> {
  return request('/etiketten', { method: 'PUT', body: JSON.stringify(eingabe) });
}

export function loescheEtikett(schluessel: string): Promise<{ ok: boolean }> {
  return request(`/etiketten/${encodeURIComponent(schluessel)}`, { method: 'DELETE' });
}

/**
 * Hängt Etiketten an Nachrichten oder nimmt sie ab. "dauerhaft: false" heißt, dass der
 * Server sie beim Schließen des Ordners wieder vergisst - der Befehl gelingt trotzdem.
 */
export function setzeEtiketten(
  accountId: string,
  folder: string,
  uids: number[],
  hinzu: string[],
  weg: string[] = [],
): Promise<{ dauerhaft: boolean }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/etiketten`, {
    method: 'PATCH',
    body: JSON.stringify({ uids, hinzu, weg }),
  });
}

export function pruefeEtikettenMoeglich(
  accountId: string,
  folder: string,
): Promise<{ dauerhaft: boolean }> {
  return request(
    `/accounts/${accountId}/folders/${encodeURIComponent(folder)}/etiketten-moeglich`,
  );
}

// --- Gespeicherte Suchen ---

export interface GespeicherteSuche {
  id: string;
  name: string;
  accountId?: string;
  folder?: string;
  kriterien: {
    text?: string;
    from?: string;
    subject?: string;
    since?: string;
    before?: string;
    unreadOnly?: boolean;
    withAttachment?: boolean;
    etikett?: string;
    category?: GmailCategory;
  };
}

export function ladeSuchen(): Promise<GespeicherteSuche[]> {
  return request('/suchen');
}

export function speichereSuche(
  eingabe: Omit<GespeicherteSuche, 'id'> & { id?: string },
): Promise<GespeicherteSuche> {
  return request('/suchen', { method: 'PUT', body: JSON.stringify(eingabe) });
}

export function loescheSuche(id: string): Promise<{ ok: boolean }> {
  return request(`/suchen/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- OAuth ---

export type OAuthProvider = 'google' | 'microsoft';

export type OAuthClients = Record<
  OAuthProvider,
  {
    configured: boolean;
    clientId?: string;
    /** Nur Microsoft: der Mandant, ueber den die Anmeldung laeuft. */
    mandant?: string;
    /**
     * Von der Organisation vorgegeben - dann ist hier nichts einzustellen.
     *
     * Der Server weist ein Speichern in diesem Fall mit 409 ab; die Oberflaeche zeigt das
     * Formular erst gar nicht an.
     */
    vorgegeben?: boolean;
  }
>;

export function fetchOAuthClients(): Promise<OAuthClients> {
  return request('/oauth/clients');
}

export function saveOAuthClient(
  provider: OAuthProvider,
  credentials: { clientId: string; clientSecret?: string; mandant?: string },
): Promise<OAuthClients> {
  return request(`/oauth/clients/${provider}`, { method: 'PUT', body: JSON.stringify(credentials) });
}

export function deleteOAuthClient(provider: OAuthProvider): Promise<OAuthClients> {
  return request(`/oauth/clients/${provider}`, { method: 'DELETE' });
}

export function startOAuth(provider: OAuthProvider): Promise<{ state: string; authUrl: string }> {
  return request(`/oauth/${provider}/start`, { method: 'POST' });
}

/**
 * Startet die Neuanmeldung eines bestehenden Kontos. Der weitere Ablauf ist derselbe
 * wie beim Hinzufügen - nur ersetzt der Server am Ende die Token, statt ein zweites
 * Konto anzulegen.
 */
export function startReauth(accountId: string): Promise<{ state: string; authUrl: string }> {
  return request(`/accounts/${accountId}/reauth`, { method: 'POST' });
}

export type OAuthStatus =
  | { status: 'pending' }
  | { status: 'done'; account: Account }
  | { status: 'error'; error: string };

export function pollOAuth(state: string): Promise<OAuthStatus> {
  return request(`/oauth/status/${encodeURIComponent(state)}`);
}

export function fetchFolders(accountId: string): Promise<FolderInfo[]> {
  return request(`/accounts/${accountId}/folders`);
}

export function createFolder(accountId: string, path: string): Promise<{ path: string }> {
  return request(`/accounts/${accountId}/folders`, {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export function renameFolder(
  accountId: string,
  folder: string,
  path: string,
): Promise<{ path: string }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}`, {
    method: 'PATCH',
    body: JSON.stringify({ path }),
  });
}

export function deleteFolder(accountId: string, folder: string): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}`, {
    method: 'DELETE',
  });
}

/** Löscht alle Nachrichten eines Ordners unwiderruflich. */
export function emptyFolder(
  accountId: string,
  folder: string,
): Promise<{ geloescht: number }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/empty`, {
    method: 'POST',
  });
}

export function markFolderRead(
  accountId: string,
  folder: string,
): Promise<{ markiert: number }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/mark-read`, {
    method: 'POST',
  });
}

/** Gmails Einordnung des Posteingangs; bei anderen Anbietern eine leere Liste. */
export function fetchCategories(accountId: string): Promise<CategoryInfo[]> {
  return request(`/accounts/${accountId}/categories`);
}

/** Nachrichten je Seite. Bewusst hier festgelegt und nicht dem Server überlassen. */
export const PAGE_SIZE = 25;

export interface MessagePage {
  messages: MessageSummary[];
  total: number;
  /** Gesetzt, wenn der Server ohne Verbindung aus der lokalen Ablage geantwortet hat. */
  ausAblage?: boolean;
  /** Marke für die nächste, ältere Seite. */
  nextCursor: number | null;
  hasMore: boolean;
}

export function fetchMessages(
  accountId: string,
  folder: string,
  beforeUid?: number,
  category?: GmailCategory | null,
  /** Aelteste zuerst - der Server blaettert dann vom anderen Ende der Liste. */
  aeltesteZuerst?: boolean,
): Promise<MessagePage> {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  if (beforeUid !== undefined) params.set('beforeUid', String(beforeUid));
  if (category) params.set('category', category);
  if (aeltesteZuerst) params.set('aelteste', '1');
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages?${params}`);
}

/**
 * Was der Server zur Lesebestaetigung einer Nachricht sagt.
 *
 * Fehlt es, ist nichts zu tun - entweder wurde keine angefordert, oder sie faellt aus
 * einem der Gruende weg, die in server/lesebestaetigung.ts stehen.
 */
export interface Bestaetigungslage {
  /** Wohin sie ginge. */
  an: string;
  /** Ob gefragt werden muss - sonst hat der Nutzer sie vorab erlaubt. */
  fragen: boolean;
  /** Die Bestaetigungsadresse weicht vom Absender ab. Dann wird immer gefragt. */
  abweichend: boolean;
}

export type NachrichtMitLage = FullMessage & { lesebestaetigung?: Bestaetigungslage };

export function holeLesebestaetigung(accountId: string): Promise<{ umgang: 'nie' | 'fragen' | 'immer' }> {
  return request(`/accounts/${encodeURIComponent(accountId)}/lesebestaetigung`);
}

export function setzeLesebestaetigung(
  accountId: string,
  umgang: 'nie' | 'fragen' | 'immer',
): Promise<{ umgang: string }> {
  return request(`/accounts/${encodeURIComponent(accountId)}/lesebestaetigung`, {
    method: 'PUT',
    body: JSON.stringify({ umgang }),
  });
}

/** Eine Lesebestaetigung verschicken - oder ausdruecklich keine. Beides wird gemerkt. */
export function sendeLesebestaetigung(
  accountId: string,
  folder: string,
  uid: number,
  senden: boolean,
): Promise<{ gesendet: boolean }> {
  return request(
    `/accounts/${encodeURIComponent(accountId)}/folders/${encodeURIComponent(folder)}/messages/${uid}/lesebestaetigung`,
    { method: 'POST', body: JSON.stringify({ senden }) },
  );
}

export function fetchMessage(accountId: string, folder: string, uid: number): Promise<NachrichtMitLage> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}`);
}

/**
 * Holt eine Nachricht, ohne sie zu verwenden - der Server hält sie danach vor, sodass
 * das Öffnen sofort geht. Fehler bleiben bewusst folgenlos: es ist eine Vorleistung,
 * kein Auftrag, und ein Fehlschlag darf nirgends auftauchen.
 */
export async function prefetchMessage(
  accountId: string,
  folder: string,
  uid: number,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await fetch(
      `${API_BASE}/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}`,
      { signal, headers: { [ZUGANG_KOPFZEILE]: zugangsgeheimnis() } },
    );
  } catch {
    // Abgebrochen oder fehlgeschlagen - beides ohne Belang.
  }
}

export function setMessagesSeen(
  accountId: string,
  folder: string,
  uids: number[],
  seen: boolean,
): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages`, {
    method: 'PATCH',
    body: JSON.stringify({ uids, seen }),
  });
}

/** Direkte URL - der Download läuft über den Browser bzw. Electron, nicht über fetch. */
export function attachmentUrl(
  accountId: string,
  folder: string,
  uid: number,
  partId: string,
): string {
  return mitZugang(
    `${API_BASE}/accounts/${accountId}/folders/${encodeURIComponent(folder)}` +
      `/messages/${uid}/attachments/${encodeURIComponent(partId)}`,
  );
}

export function moveMessages(
  accountId: string,
  folder: string,
  uids: number[],
  targetFolder: string,
  /** Die Nummern im Zielordner - nur mit ihnen laesst sich das Verschieben zuruecknehmen. */
): Promise<{ ok: boolean; neueUids: number[] }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/move`, {
    method: 'POST',
    body: JSON.stringify({ uids, targetFolder }),
  });
}

export function deleteMessages(
  accountId: string,
  folder: string,
  uids: number[],
): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/delete`, {
    method: 'POST',
    body: JSON.stringify({ uids }),
  });
}

export interface GeplanteSendung {
  id: string;
  faellig: number;
  betreff: string;
  empfaenger: string[];
}

export interface Wiedervorlage {
  id: string;
  ursprung: string;
  betreff: string;
  faellig: number;
  /** Fehlt, wenn der Server beim Verschieben keine Kennung mitgeteilt hat. */
  uidImOrdner?: number;
}

/**
 * Ein Gespräch, in dem etwas offen ist. Die Felder werden bewusst hier noch einmal
 * beschrieben statt aus mail-core geholt: ein Wert-Import von dort zöge die gesamte
 * IMAP-Schicht in das Bündel für den Browser.
 */
export interface OffenerVorgang {
  art: 'wartetAufAntwort' | 'nichtBeantwortet';
  uid: number;
  ordner: string;
  betreff: string;
  gegenueber: { name?: string; address: string }[];
  datum: string | null;
  tageOffen: number;
  umfang: number;
}

export function fetchOffeneVorgaenge(
  accountId: string,
  optionen: { mindestTage?: number; auchUnbekannte?: boolean } = {},
): Promise<OffenerVorgang[]> {
  const p = new URLSearchParams();
  if (optionen.mindestTage !== undefined) p.set('minDays', String(optionen.mindestTage));
  if (optionen.auchUnbekannte) p.set('all', '1');
  const anhang = p.toString();
  return request(`/accounts/${accountId}/offen${anhang ? `?${anhang}` : ''}`);
}

export interface GefundeneEinstellungen {
  fundort: 'eingebaut' | 'anbieterdatenbank' | 'domain' | 'dns' | 'autodiscover' | 'mx';
  anbieter?: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  benutzername?: 'adresse' | 'ortsteil';
  /**
   * Gesetzt, wenn dieser Anbieter kein Kennwort mehr annimmt.
   *
   * Microsoft hat die Kennwortanmeldung fuer Exchange Online abgeschaltet, Google laesst
   * sie nur noch mit einem eigens erzeugten App-Kennwort zu. Ohne diese Angabe tippt
   * jemand sein Windows-Kennwort in das Formular, bekommt "Anmeldung fehlgeschlagen" und
   * sucht den Fehler bei sich.
   */
  oauthProvider?: 'google' | 'microsoft';
}

/** Sucht die Serveradressen zu einer Mailadresse, ohne ein Konto anzulegen. */
export async function sucheServer(email: string): Promise<GefundeneEinstellungen | null> {
  const { gefunden } = await request<{ gefunden: GefundeneEinstellungen | null }>(
    `/autoconfig?email=${encodeURIComponent(email)}`,
  );
  return gefunden;
}

export interface LokaleSuche {
  treffer: (MessageSummary & { ordner: string })[];
  dauerMs: number;
  /** Woraus gesucht wurde - Grundlage für den Hinweis, was die Suche nicht abdeckt. */
  bestand: { kopfdaten: number; mitText: number };
  verfuegbar: boolean;
}

/**
 * Sucht in der lokalen Ablage. Antwortet sofort und ohne Netz, deckt aber nur ab, was
 * abgelegt ist: Betreff und Absender aller bekannten Nachrichten, Text nur bei den
 * bereits geöffneten.
 */
export function sucheLokal(
  accountId: string,
  text: string,
  folder?: string,
): Promise<LokaleSuche> {
  const p = new URLSearchParams({ q: text });
  if (folder) p.set('folder', folder);
  return request(`/accounts/${accountId}/suche-lokal?${p}`);
}

/**
 * Adresse, unter der ein Ordner als mbox-Datei liegt.
 *
 * Bewusst nur die Adresse und kein Abruf: der Browser laedt sie selbst herunter und
 * schreibt mit, waehrend der Server noch holt. Durch die Anwendung geschleust waeren
 * es bei einem grossen Ordner Gigabyte im Arbeitsspeicher.
 */
export function sicherungsAdresse(accountId: string, folder: string): string {
  return mitZugang(
    `${API_BASE}/accounts/${accountId}/folders/${encodeURIComponent(folder)}/sicherung`,
  );
}

/** Die Nachricht im Original, mit allen Kopfzeilen. */
export async function fetchQuelltext(
  accountId: string,
  folder: string,
  uid: number,
): Promise<string> {
  const antwort = await fetch(
    `${API_BASE}/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages/${uid}/quelltext`,
    { headers: { [ZUGANG_KOPFZEILE]: zugangsgeheimnis() } },
  );
  if (!antwort.ok) {
    // Der Fehlerfall kommt als JSON, der Erfolgsfall als reiner Text.
    const text = await antwort.text();
    let meldung = text;
    try {
      meldung = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // Kein JSON - dann ist der Text selbst die Meldung.
    }
    throw new Error(meldung);
  }
  return antwort.text();
}

/**
 * Was an Nachrichtenbestand auf der Platte liegt - und der Weg, ihn loszuwerden.
 *
 * Beide Wege gab es auf dem Server von Anfang an; hier fehlten sie. Erreichbar waren sie
 * damit nur über das Menü der Desktop-Hülle, und wer die Anwendung im Browser benutzt,
 * hatte keine Möglichkeit, den unverschlüsselt abgelegten Bestand auch nur anzusehen.
 */
export function holeAblageStand(): Promise<{ bytes: number; nachrichten: number; inhalte: number }> {
  return request('/ablage');
}

export function leereAblage(): Promise<{ nachrichten: number; inhalte: number; bytes: number }> {
  return request('/ablage', { method: 'DELETE' });
}

/** Absender, deren entfernte Bilder ohne Rückfrage geladen werden dürfen. */
export function fetchVertrauteAbsender(accountId: string): Promise<{ absender: string[] }> {
  return request(`/accounts/${accountId}/vertraute-absender`);
}

export function vertrauenGeben(accountId: string, adresse: string): Promise<{ absender: string[] }> {
  return request(`/accounts/${accountId}/vertraute-absender`, {
    method: 'POST',
    body: JSON.stringify({ adresse }),
  });
}

export function vertrauenEntziehen(
  accountId: string,
  adresse: string,
): Promise<{ absender: string[] }> {
  return request(`/accounts/${accountId}/vertraute-absender/${encodeURIComponent(adresse)}`, {
    method: 'DELETE',
  });
}

export function fetchPendingSends(accountId: string): Promise<GeplanteSendung[]> {
  return request(`/accounts/${accountId}/send/pending`);
}

export function fetchSnoozed(accountId: string): Promise<Wiedervorlage[]> {
  return request(`/accounts/${accountId}/snoozed`);
}

/** Holt eine zurückgestellte Nachricht sofort zurück, statt auf den Zeitpunkt zu warten. */
export function returnSnoozed(accountId: string, snoozeId: string): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}/snoozed/${snoozeId}/return`, { method: 'POST' });
}

/** Stellt eine Nachricht bis zum genannten Zeitpunkt zurück. */
export function snoozeMessage(
  accountId: string,
  folder: string,
  uid: number,
  faellig: string,
): Promise<{ ok: boolean; faellig: number }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/snooze`, {
    method: 'POST',
    body: JSON.stringify({ uid, faellig }),
  });
}

// --- Postfach aufräumen ---

export interface AbsenderEintrag {
  adresse: string;
  name?: string;
  gesamt: number;
  ungelesen: number;
  beispielUid?: number;
  beispielBetreff?: string;
  listUnsubscribe?: string;
  einKlickAbmeldung?: boolean;
}

export interface AbsenderUebersicht {
  eintraege: AbsenderEintrag[];
  stichprobe: number;
  imOrdner: number;
}

export function fetchSenders(accountId: string, folder = 'INBOX'): Promise<AbsenderUebersicht> {
  return request(`/accounts/${accountId}/senders?folder=${encodeURIComponent(folder)}`);
}

export interface AbmeldeAntwort {
  art: 'ein-klick' | 'mail' | 'im-browser';
  erfolg: boolean;
  ziel?: string;
  adresse?: string;
  status?: number;
}

export function unsubscribe(
  accountId: string,
  folder: string,
  uid: number,
): Promise<AbmeldeAntwort> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/unsubscribe`, {
    method: 'POST',
    body: JSON.stringify({ uid }),
  });
}

/** Verschiebt alles von einem Absender - ohne Ziel in den Papierkorb. */
export function moveFromSender(
  accountId: string,
  folder: string,
  from: string,
  targetFolder?: string,
): Promise<{ verschoben: number; ziel: string }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/from-sender/move`, {
    method: 'POST',
    body: JSON.stringify({ from, targetFolder }),
  });
}

// --- Regeln ---

export interface RegelVorschau {
  geprueft: number;
  treffer: number;
  imOrdner: number;
  beispiele: { subject: string; from?: string }[];
}

export function fetchRules(accountId: string): Promise<Regel[]> {
  return request(`/accounts/${accountId}/rules`);
}

export function saveRule(
  accountId: string,
  regel: Omit<Regel, 'id'> & { id?: string },
): Promise<Regel> {
  return request(`/accounts/${accountId}/rules`, {
    method: 'PUT',
    body: JSON.stringify(regel),
  });
}

export function deleteRule(accountId: string, regelId: string): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}/rules/${regelId}`, { method: 'DELETE' });
}

/** Zeigt vorab, wie viele Nachrichten eine Bedingung träfe - ohne etwas zu verändern. */
export function previewRule(
  accountId: string,
  bedingungen: RegelBedingung,
  folder = 'INBOX',
): Promise<RegelVorschau> {
  return request(`/accounts/${accountId}/rules/preview`, {
    method: 'POST',
    body: JSON.stringify({ bedingungen, folder }),
  });
}

export function applyRules(
  accountId: string,
  folder: string,
): Promise<{ betroffen: number; geprueft: number; schritte: string[] }> {
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/apply-rules`, {
    method: 'POST',
  });
}

/** Was der Server des Kontos kann - bestimmt, welche Einschränkungen angeboten werden. */
export function fetchCapabilities(accountId: string): Promise<{ gmailSearch: boolean }> {
  return request(`/accounts/${accountId}/capabilities`);
}

export interface SucheParameter {
  text: string;
  from: string;
  subject: string;
  since: string;
  before: string;
  unreadOnly: boolean;
  withAttachment: boolean;
  /** Das IMAP-Schlüsselwort eines Etiketts, nicht dessen angezeigter Name. */
  etikett?: string;
}

/** Übersetzt die Eingabe in Abfrageparameter - an einer Stelle für alle drei Bereiche. */
function suchParameter(eingabe: SucheParameter): URLSearchParams {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  if (eingabe.text.trim()) params.set('q', eingabe.text.trim());
  if (eingabe.from.trim()) params.set('from', eingabe.from.trim());
  if (eingabe.subject.trim()) params.set('subject', eingabe.subject.trim());
  if (eingabe.since) params.set('since', eingabe.since);
  if (eingabe.before) params.set('before', eingabe.before);
  if (eingabe.unreadOnly) params.set('unread', '1');
  if (eingabe.withAttachment) params.set('attachment', '1');
  if (eingabe.etikett) params.set('etikett', eingabe.etikett);
  return params;
}

export function searchMessages(
  accountId: string,
  folder: string,
  eingabe: SucheParameter,
  optionen: { beforeUid?: number | null; category?: GmailCategory | null } = {},
): Promise<MessagePage> {
  const params = suchParameter(eingabe);
  if (optionen.beforeUid != null) params.set('beforeUid', String(optionen.beforeUid));
  if (optionen.category) params.set('category', optionen.category);
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/search?${params}`);
}

/** Ein Treffer weiß, wo er liegt - eine UID gilt nur innerhalb ihres Ordners. */
export interface SucheErgebnis {
  hits: (MessageSummary & { folder: string; accountId?: string; email?: string })[];
  total: number;
  hasMore: boolean;
}

/** Suche über alle Ordner eines Kontos. */
export function searchAccount(accountId: string, eingabe: SucheParameter): Promise<SucheErgebnis> {
  return request(`/accounts/${accountId}/search?${suchParameter(eingabe)}`);
}

/** Suche über alle Konten. */
export function searchAll(eingabe: SucheParameter): Promise<SucheErgebnis> {
  return request(`/search?${suchParameter(eingabe)}`);
}

/** Im Browser gibt es kein Buffer - Anhänge gehen base64-kodiert über die Leitung. */
export interface DraftAttachment {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
}

/** Beim Weiterleiten: der Server holt diese Anhänge selbst per IMAP dazu. */
export interface ForwardSource {
  folder: string;
  uid: number;
  partIds: string[];
  /** Nur zur Anzeige im Verfassen-Fenster. */
  filenames: string[];
}

export type Draft = Omit<OutgoingMessage, 'attachments' | 'kopfzeilen'> & {
  /**
   * Ob der Absender eine Lesebestaetigung haben moechte.
   *
   * Ein Schalter und keine Adresse: Wohin sie ginge, bestimmt der Server. Eine
   * mitgeschickte Adresse waere genau der Missbrauch, gegen den die Empfangsseite
   * abgesichert ist - siehe server/lesebestaetigung.ts.
   */
  lesebestaetigung?: boolean;
  attachments?: DraftAttachment[];
  /** Ob die Nachricht mit OpenPGP geschuetzt hinausgehen soll. */
  pgp?: 'signieren' | 'verschluesseln';
  /** Kennwort des geheimen Schluessels. Wird nur mitgeschickt, nie gespeichert. */
  pgpKennwort?: string;
  /** Dasselbe mit S/MIME. Beides zugleich weist der Server ab. */
  smime?: 'signieren' | 'verschluesseln';
  smimeKennwort?: string;
  attachOriginal?: ForwardSource;
  /** Beim Senden: der zugehörige Entwurf wird danach entfernt. */
  draftFolder?: string;
  draftUid?: number;
};

export interface SendResponse {
  ok: boolean;
  savedToSent?: boolean;
  sentFolder?: string;
  saveError?: string;
  /** Gesetzt, wenn die Nachricht vorgemerkt statt sofort gesendet wurde. */
  geplant?: boolean;
  id?: string;
  faellig?: number;
}

/**
 * Sendet oder merkt vor. `sendenIn` gibt die Bedenkzeit in Sekunden, `sendenAm` einen
 * festen Zeitpunkt - beides läuft über dieselbe Warteschlange im Server.
 */
export function sendMessage(
  accountId: string,
  draft: Draft,
  optionen: { sendenIn?: number; sendenAm?: string } = {},
): Promise<SendResponse> {
  return request(`/accounts/${accountId}/send`, {
    method: 'POST',
    body: JSON.stringify({ ...draft, ...optionen }),
  });
}

/** Holt eine vorgemerkte Nachricht zurück; der Inhalt kommt zum Weiterbearbeiten mit. */
export function cancelSend(
  accountId: string,
  sendungId: string,
): Promise<{ ok: boolean; koerper: Draft }> {
  return request(`/accounts/${accountId}/send/${sendungId}`, { method: 'DELETE' });
}

export interface DraftLocation {
  folder: string;
  uid: number | null;
}

/** Speichert den Entwurf; previousUid ersetzt die zuvor abgelegte Fassung. */
export function saveDraft(
  accountId: string,
  draft: Draft,
  previousUid?: number,
): Promise<DraftLocation & { ok: boolean }> {
  return request(`/accounts/${accountId}/drafts`, {
    method: 'POST',
    body: JSON.stringify({ ...draft, previousUid }),
  });
}

export function deleteDraft(accountId: string, folder: string, uid: number): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}/drafts/${encodeURIComponent(folder)}/${uid}`, {
    method: 'DELETE',
  });
}
