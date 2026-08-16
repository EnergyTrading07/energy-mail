import fs from 'node:fs';
import path from 'node:path';
import {
  alsVisitenkartenDatei,
  leseVisitenkarten,
  type Telefonnummer,
  type Visitenkarte,
} from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { istVerschluesselt, schreibeGeschuetzt } from './geschuetzteAblage.js';
import { decryptSecret } from './secretCrypto.js';

const getStorePath = () => path.join(getNutzerDir(), 'contacts.json');

/**
 * Obergrenze für nebenbei aufgelesene Adressen. Wer in einem Postfach mit zehntausenden
 * Nachrichten blättert, begegnet sonst irgendwann jeder Adresse, die je geschrieben hat -
 * und schleppt die für immer mit. Zweitausend übersteht jede Namensvervollständigung, die
 * ein Mensch braucht.
 *
 * Von Hand gepflegte Einträge zählen hier nicht mit: die hat jemand bewusst angelegt, sie
 * verschwinden nie. Ein Adressbuch, das aufräumt, was man selbst eingetragen hat, ist
 * kein Adressbuch.
 */
const MAX_KONTAKTE = 2000;

/** Beim Aufräumen etwas Luft lassen, sonst liefe es bei jedem weiteren Eintrag erneut. */
const NACH_AUFRAEUMEN = Math.floor(MAX_KONTAKTE * 0.9);

export interface Contact {
  address: string;
  name?: string;
  /** Wie viele Nachrichten mit dieser Adresse begegnet sind - häufige stehen oben. */
  count: number;
  /** Zeitpunkt der letzten Begegnung als ISO-Zeichenkette. */
  lastSeen: string;
  /**
   * Von Hand angelegt oder eingelesen. Solche Einträge werden nie verdrängt, ihr Name
   * gilt vor dem aus der Post gelesenen, und nur sie erscheinen im Adressbuch.
   */
  gepflegt?: boolean;
  vorname?: string;
  nachname?: string;
  organisation?: string;
  telefone?: Telefonnummer[];
  anschrift?: string;
  geburtstag?: string;
  notiz?: string;
  /** Weitere Mailadressen derselben Person - werden bei Vorschlägen mit angeboten. */
  weitereAdressen?: string[];
}

/**
 * Welcher UID-Bereich eines Ordners schon ausgewertet wurde.
 *
 * Ohne das zählte jede Auffrischung der ersten Seite dieselben Absender erneut: im
 * Bestand des Nutzers stand ein Absender bei 4188, obwohl es keine 4188 Nachrichten von
 * ihm gab - er saß nur oft oben im Posteingang, während die Liste sich erneuerte. Damit
 * verdrängte er bei den Vorschlägen alle, mit denen wirklich Austausch besteht.
 *
 * Da UIDs im Ordner nur steigen und rückwärts geblättert wird, genügen zwei Zahlen: was
 * dazwischen liegt, ist gezählt. Neue Post landet über "hoch", ältere Seiten unter "tief".
 */
interface Bereich {
  tief: number;
  hoch: number;
}

interface Ablage {
  kontakte: Map<string, Contact>;
  bereiche: Map<string, Bereich>;
}

let cache: Ablage | null = null;

/**
 * Zähler aus der alten Ablage stauchen.
 *
 * Sie sind nicht zu gebrauchen, wie sie sind: sie sagen vor allem, wie oft jemand oben
 * im Posteingang saß, während die Liste sich erneuerte, nicht wie viel Austausch
 * besteht. Die Reihenfolge bleibt trotzdem etwas wert - wer 4188 hat, schreibt wirklich
 * mehr als wer 3 hat. Die Wurzel erhält diese Reihenfolge und zieht den Abstand so weit
 * zusammen (4188 wird 65), dass richtig gezählte Begegnungen wieder aufholen können.
 */
const entschaerfe = (count: number) => Math.max(1, Math.round(Math.sqrt(count || 1)));

function load(): Ablage {
  if (cache) return cache;
  cache = { kontakte: new Map(), bereiche: new Map() };
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    try {
      const datei = fs.readFileSync(storePath, 'utf-8');
      /*
       * Verschlüsselt oder aus der Zeit davor.
       *
       * Das Adressbuch ist der Speicher, bei dem es am meisten zählt: es enthält Namen
       * und Adressen von Menschen, die nie gefragt wurden, ob sie hier stehen wollen -
       * und es füllt sich beim bloßen Lesen von selbst. Klartext aus einer Installation
       * von vor der Umstellung wird weiter gelesen und beim nächsten Schreiben ersetzt.
       */
      const roh = JSON.parse(
        istVerschluesselt(datei) ? decryptSecret(datei.trim()) : datei,
      );
      // Ältere Fassungen legten nur eine Liste ab.
      const alt = Array.isArray(roh);
      const kontakte: Contact[] = alt ? roh : (roh.kontakte ?? []);
      for (const entry of kontakte) {
        cache.kontakte.set(entry.address.toLowerCase(), {
          ...entry,
          count: alt ? entschaerfe(entry.count) : entry.count,
        });
      }
      for (const [schluessel, bereich] of Object.entries(roh?.bereiche ?? {})) {
        cache.bereiche.set(schluessel, bereich as Bereich);
      }
    } catch {
      // Beschädigte Datei ist kein Grund, die Anwendung zu blockieren - Vorschläge
      // sind Komfort, keine Kernfunktion.
    }
  }
  return cache;
}

/**
 * Selten und lange nicht Begegnete zuerst hinaus. Die Häufigkeit wiegt schwerer als das
 * Datum: eine Adresse, mit der seit Jahren Austausch besteht, soll nicht durch einen
 * einmaligen Newsletter von gestern verdrängt werden.
 *
 * Gepflegte Einträge bleiben außen vor - weder werden sie gezählt noch verdrängt.
 */
function raeumeAuf(kontakte: Map<string, Contact>): void {
  const aufgelesen = [...kontakte.entries()].filter(([, k]) => !k.gepflegt);
  if (aufgelesen.length <= MAX_KONTAKTE) return;

  const sortiert = aufgelesen.sort(([, a], [, b]) => {
    if (a.count !== b.count) return b.count - a.count;
    return b.lastSeen.localeCompare(a.lastSeen);
  });
  for (const [key] of sortiert.slice(NACH_AUFRAEUMEN)) kontakte.delete(key);
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

function schreibe(): void {
  const ablage = cache;
  if (!ablage) return;

  raeumeAuf(ablage.kontakte);
  const inhalt = JSON.stringify({
    kontakte: [...ablage.kontakte.values()],
    bereiche: Object.fromEntries(ablage.bereiche),
  });

  fs.mkdirSync(getNutzerDir(), { recursive: true });
  /*
   * Erst daneben schreiben, dann umbenennen - und verschlüsselt.
   *
   * Hier stand dasselbe Verfahren von Hand ausgeschrieben, ohne fsync und ohne
   * Sicherungskopie; schreibeGeschuetzt() bringt beides mit (siehe atomar.ts).
   */
  schreibeGeschuetzt(getStorePath(), inhalt);
}

/** Gebündelt schreiben: beim Durchblättern fallen sonst Dutzende Schreibvorgänge an. */
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    schreibe();
  }, 2000);
}

/** Beim Beenden: was in den letzten Sekunden dazukam, soll nicht verlorengehen. */
export function speichereKontakteSofort(): void {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = undefined;
  schreibe();
}

/**
 * Was von Hand kam, muss sofort auf der Platte stehen.
 *
 * Beim Auflesen aus der Post darf gebündelt werden - geht dabei etwas verloren, wird es
 * beim nächsten Blättern wieder aufgelesen. Ein eingetragener Kontakt dagegen kommt nicht
 * wieder: stürzte die Anwendung in den zwei Sekunden ab, wäre die Arbeit weg.
 */
function speichereJetzt(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  schreibe();
}

export interface ObservedAddress {
  address: string;
  name?: string;
}

/**
 * Merkt sich Adressen, die in Nachrichten vorkommen. Daraus entstehen die Vorschläge
 * beim Verfassen - ein eigenes Adressbuch muss dafür niemand pflegen.
 */
export function rememberAddresses(addresses: ObservedAddress[], when: Date = new Date()): void {
  const { kontakte } = load();
  let changed = false;

  for (const entry of addresses) {
    const address = entry.address?.trim();
    if (!address || !address.includes('@')) continue;

    const key = address.toLowerCase();
    const existing = kontakte.get(key);
    if (existing) {
      existing.count += 1;
      // Namen nur ergänzen, nicht überschreiben - der erste ist meist der bessere. Bei
      // gepflegten Einträgen gilt ohnehin, was eingetragen wurde.
      if (!existing.name && entry.name) existing.name = entry.name;
      if (when.toISOString() > existing.lastSeen) existing.lastSeen = when.toISOString();
    } else {
      kontakte.set(key, {
        address,
        name: entry.name,
        count: 1,
        lastSeen: when.toISOString(),
      });
    }
    changed = true;
  }

  if (changed) scheduleSave();
}

interface GesehenNachricht {
  uid: number;
  date: Date | null;
  from: ObservedAddress[];
  to: ObservedAddress[];
  cc: ObservedAddress[];
}

/**
 * Wertet eine geladene Seite aus und überspringt dabei, was aus diesem Ordner schon
 * gezählt wurde. Ohne das trieb jede Auffrischung der Liste die Zähler hoch, und mit
 * ihnen fiel bei praktisch jedem Ordnerwechsel ein Schreibvorgang an.
 */
export function merkeAusListe(
  accountId: string,
  folder: string,
  nachrichten: GesehenNachricht[],
): void {
  if (nachrichten.length === 0) return;

  const ablage = load();
  const schluessel = `${accountId} ${folder}`;
  const bekannt = ablage.bereiche.get(schluessel);

  const neue = bekannt
    ? nachrichten.filter((m) => m.uid > bekannt.hoch || m.uid < bekannt.tief)
    : nachrichten;

  const uids = nachrichten.map((m) => m.uid);
  ablage.bereiche.set(schluessel, {
    tief: Math.min(...uids, bekannt?.tief ?? Infinity),
    hoch: Math.max(...uids, bekannt?.hoch ?? 0),
  });

  for (const message of neue) {
    rememberAddresses([...message.from, ...message.to, ...message.cc], message.date ?? undefined);
  }
  // Auch wenn nichts Neues dabei war, hat sich der ausgewertete Bereich verschoben.
  if (neue.length === 0) scheduleSave();
}

/** Ein Vorschlag beim Verfassen - genau das, was die Adresszeile braucht. */
export interface Vorschlag {
  address: string;
  name?: string;
  count: number;
  lastSeen: string;
  gepflegt?: boolean;
}

/** Alle Adressen eines Eintrags, die Hauptadresse zuerst. */
function adressenVon(kontakt: Contact): string[] {
  return [kontakt.address, ...(kontakt.weitereAdressen ?? [])];
}

function passt(kontakt: Contact, needle: string): boolean {
  if (adressenVon(kontakt).some((a) => a.toLowerCase().includes(needle))) return true;
  const felder = [kontakt.name, kontakt.vorname, kontakt.nachname, kontakt.organisation];
  return felder.some((f) => (f ?? '').toLowerCase().includes(needle));
}

/** Liefert passende Adressen, häufig genutzte und zuletzt verwendete zuerst. */
export function searchContacts(query: string, limit = 8): Vorschlag[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const treffer: Vorschlag[] = [];
  for (const kontakt of load().kontakte.values()) {
    if (!passt(kontakt, needle)) continue;
    for (const address of adressenVon(kontakt)) {
      treffer.push({
        address,
        name: kontakt.name,
        count: kontakt.count,
        lastSeen: kontakt.lastSeen,
        gepflegt: kontakt.gepflegt,
      });
    }
  }

  return treffer
    .sort((a, b) => {
      // Wer im Adressbuch steht, wurde bewusst eingetragen - der ist meist gemeint.
      const aGepflegt = a.gepflegt ? 1 : 0;
      const bGepflegt = b.gepflegt ? 1 : 0;
      if (aGepflegt !== bGepflegt) return bGepflegt - aGepflegt;
      // Treffer am Anfang der Adresse sind meist gemeint.
      const aStarts = a.address.toLowerCase().startsWith(needle) ? 1 : 0;
      const bStarts = b.address.toLowerCase().startsWith(needle) ? 1 : 0;
      if (aStarts !== bStarts) return bStarts - aStarts;
      if (a.count !== b.count) return b.count - a.count;
      return b.lastSeen.localeCompare(a.lastSeen);
    })
    .slice(0, limit);
}

export function contactCount(): number {
  return load().kontakte.size;
}

// --- Das Adressbuch: was von Hand gepflegt wird ---

export interface KontaktEingabe {
  address: string;
  name?: string;
  vorname?: string;
  nachname?: string;
  organisation?: string;
  telefone?: Telefonnummer[];
  anschrift?: string;
  geburtstag?: string;
  notiz?: string;
  weitereAdressen?: string[];
}

/** Bildet den Anzeigenamen, wenn keiner eingegeben wurde. */
function abgeleiteterName(eingabe: KontaktEingabe): string | undefined {
  const ausTeilen = [eingabe.vorname, eingabe.nachname].filter(Boolean).join(' ').trim();
  return eingabe.name?.trim() || ausTeilen || eingabe.organisation?.trim() || undefined;
}

const sauber = (text?: string) => {
  const ohneRand = text?.trim();
  return ohneRand ? ohneRand : undefined;
};

/** Trägt einen Kontakt ein, ohne zu speichern - für die Einfuhr, die viele auf einmal setzt. */
function setzeKontakt(eingabe: KontaktEingabe, vorherigeAdresse?: string): Contact {
  const address = eingabe.address?.trim();
  if (!address || !address.includes('@')) {
    throw new Error('Ohne Mailadresse lässt sich kein Kontakt anlegen');
  }

  const { kontakte } = load();
  const key = address.toLowerCase();
  const altKey = vorherigeAdresse?.trim().toLowerCase();

  // Was beim Auflesen schon zusammenkam - Zähler und letzte Begegnung - bleibt erhalten.
  const bisher = kontakte.get(altKey && altKey !== key ? altKey : key);
  if (altKey && altKey !== key) kontakte.delete(altKey);

  const weitere = (eingabe.weitereAdressen ?? [])
    .map((a) => a.trim())
    .filter((a) => a.includes('@') && a.toLowerCase() !== key);

  const kontakt: Contact = {
    address,
    name: abgeleiteterName(eingabe),
    count: bisher?.count ?? 1,
    lastSeen: bisher?.lastSeen ?? new Date().toISOString(),
    gepflegt: true,
    vorname: sauber(eingabe.vorname),
    nachname: sauber(eingabe.nachname),
    organisation: sauber(eingabe.organisation),
    telefone: (eingabe.telefone ?? [])
      .map((t) => ({ nummer: t.nummer?.trim() ?? '', art: sauber(t.art) }))
      .filter((t) => t.nummer),
    anschrift: sauber(eingabe.anschrift),
    geburtstag: sauber(eingabe.geburtstag),
    notiz: sauber(eingabe.notiz),
    weitereAdressen: weitere.length > 0 ? weitere : undefined,
  };

  kontakte.set(key, kontakt);
  return kontakt;
}

/**
 * Legt einen Kontakt an oder ändert ihn.
 *
 * "vorherigeAdresse" wird gebraucht, wenn beim Bearbeiten die Hauptadresse geändert
 * wurde: der Eintrag hängt am Schlüssel der Adresse, und ohne den alten Schlüssel bliebe
 * die alte Fassung als Zweiteintrag stehen.
 */
export function speichereKontakt(eingabe: KontaktEingabe, vorherigeAdresse?: string): Contact {
  const kontakt = setzeKontakt(eingabe, vorherigeAdresse);
  speichereJetzt();
  return kontakt;
}

/**
 * Löscht einen Kontakt aus dem Adressbuch.
 *
 * Aufgelesene Adressen kommen beim nächsten Blättern von selbst wieder - das ist keine
 * Panne, sondern der Sinn des Auflesens. Wer eine Adresse endgültig los sein will, muss
 * sie erst gar nicht eintragen.
 */
export function loescheKontakt(address: string): boolean {
  const { kontakte } = load();
  const entfernt = kontakte.delete(address.trim().toLowerCase());
  if (entfernt) speichereJetzt();
  return entfernt;
}

/** Ein einzelner Kontakt, zum Bearbeiten. */
export function findeKontakt(address: string): Contact | undefined {
  return load().kontakte.get(address.trim().toLowerCase());
}

/** Nach Anzeigename sortieren, unabhängig von Groß- und Kleinschreibung und Umlauten. */
const nachName = (a: Contact, b: Contact) =>
  (a.name ?? a.address).localeCompare(b.name ?? b.address, 'de', { sensitivity: 'base' });

export interface Kontaktliste {
  eintraege: Contact[];
  /** Wie viele es insgesamt gäbe - die Liste selbst ist gekürzt. */
  gesamt: number;
}

/**
 * Das Adressbuch zum Anzeigen. Ohne "auchAufgelesene" stehen nur die gepflegten darin:
 * die zweitausend nebenbei aufgelesenen Adressen wären keine Liste, durch die jemand
 * blättern möchte.
 */
export function listeKontakte(optionen?: {
  suche?: string;
  auchAufgelesene?: boolean;
  limit?: number;
}): Kontaktliste {
  const needle = optionen?.suche?.trim().toLowerCase() ?? '';
  const limit = optionen?.limit ?? 500;

  const passend = [...load().kontakte.values()]
    .filter((k) => (optionen?.auchAufgelesene ? true : k.gepflegt))
    .filter((k) => !needle || passt(k, needle))
    .sort(nachName);

  return { eintraege: passend.slice(0, limit), gesamt: passend.length };
}

// --- Visitenkarten: der Weg herein und hinaus ---

function alsVisitenkarte(kontakt: Contact): Visitenkarte {
  return {
    name: kontakt.name,
    vorname: kontakt.vorname,
    nachname: kontakt.nachname,
    adressen: adressenVon(kontakt),
    organisation: kontakt.organisation,
    telefone: kontakt.telefone ?? [],
    anschrift: kontakt.anschrift,
    geburtstag: kontakt.geburtstag,
    notiz: kontakt.notiz,
  };
}

/**
 * Gibt das Adressbuch als vCard-Datei aus - lesbar für Thunderbird, Outlook, Apple und
 * jedes Telefon.
 */
export function kontakteAlsVcf(nurGepflegte = true): string {
  const eintraege = [...load().kontakte.values()]
    .filter((k) => (nurGepflegte ? k.gepflegt : true))
    .sort(nachName);
  return alsVisitenkartenDatei(eintraege.map(alsVisitenkarte));
}

export interface EinfuhrErgebnis {
  angelegt: number;
  aktualisiert: number;
  uebergangen: number;
}

/**
 * Liest eine vCard-Datei ein.
 *
 * Wer schon im Adressbuch steht, wird ergänzt statt verdoppelt: erkannt wird das an der
 * Mailadresse, denn Namen kommen in fremden Dateien in allen Schreibweisen vor. Karten
 * ganz ohne Adresse werden übergangen - ohne sie ließe sich der Eintrag später weder
 * wiederfinden noch anschreiben.
 */
export function einfuhrVisitenkarten(inhalt: string): EinfuhrErgebnis {
  const karten = leseVisitenkarten(inhalt);
  const ergebnis: EinfuhrErgebnis = { angelegt: 0, aktualisiert: 0, uebergangen: 0 };

  for (const karte of karten) {
    const [haupt, ...weitere] = karte.adressen;
    if (!haupt) {
      ergebnis.uebergangen++;
      continue;
    }

    const bisher = findeKontakt(haupt);
    // Was schon dasteht, bleibt stehen: eine Einfuhr soll ergänzen, nicht überschreiben.
    setzeKontakt(
      {
        address: haupt,
        name: bisher?.gepflegt ? (bisher.name ?? karte.name) : karte.name,
        vorname: bisher?.vorname ?? karte.vorname,
        nachname: bisher?.nachname ?? karte.nachname,
        organisation: bisher?.organisation ?? karte.organisation,
        telefone: bisher?.telefone?.length ? bisher.telefone : karte.telefone,
        anschrift: bisher?.anschrift ?? karte.anschrift,
        geburtstag: bisher?.geburtstag ?? karte.geburtstag,
        notiz: bisher?.notiz ?? karte.notiz,
        weitereAdressen: [...new Set([...(bisher?.weitereAdressen ?? []), ...weitere])],
      },
      haupt,
    );

    if (bisher?.gepflegt) ergebnis.aktualisiert++;
    else ergebnis.angelegt++;
  }

  // Einmal am Ende, nicht bei jeder Karte: eine Datei mit tausend Einträgen ergäbe sonst
  // tausend Schreibvorgänge.
  if (karten.length > 0) speichereJetzt();
  return ergebnis;
}

/** Nur für Tests: den geladenen Stand vergessen. */
export function verwirfKontaktSpeicher(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  cache = null;
}
