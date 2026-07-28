import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './paths.js';

const getStorePath = () => path.join(getDataDir(), 'contacts.json');

/**
 * Obergrenze. Wer in einem Postfach mit zehntausenden Nachrichten blättert, begegnet
 * sonst irgendwann jeder Adresse, die je geschrieben hat - und schleppt die für immer
 * mit. Zweitausend übersteht jede Namensvervollständigung, die ein Mensch braucht.
 */
const MAX_KONTAKTE = 2000;

/** Beim Aufräumen etwas Luft lassen, sonst liefe es bei jedem weiteren Eintrag erneut. */
const NACH_AUFRAEUMEN = Math.floor(MAX_KONTAKTE * 0.9);

interface Contact {
  address: string;
  name?: string;
  /** Wie viele Nachrichten mit dieser Adresse begegnet sind - häufige stehen oben. */
  count: number;
  /** Zeitpunkt der letzten Begegnung als ISO-Zeichenkette. */
  lastSeen: string;
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
      const roh = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
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
 */
function raeumeAuf(kontakte: Map<string, Contact>): void {
  if (kontakte.size <= MAX_KONTAKTE) return;

  const sortiert = [...kontakte.entries()].sort(([, a], [, b]) => {
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

  fs.mkdirSync(getDataDir(), { recursive: true });
  // Erst daneben schreiben, dann umbenennen: bricht der Vorgang ab, bleibt der alte
  // Stand heil statt halb geschrieben liegenzubleiben.
  const ziel = getStorePath();
  const zwischen = `${ziel}.neu`;
  fs.writeFileSync(zwischen, inhalt, 'utf-8');
  fs.renameSync(zwischen, ziel);
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
      // Namen nur ergänzen, nicht überschreiben - der erste ist meist der bessere.
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

/** Liefert passende Adressen, häufig genutzte und zuletzt verwendete zuerst. */
export function searchContacts(query: string, limit = 8): Contact[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return [...load().kontakte.values()]
    .filter(
      (contact) =>
        contact.address.toLowerCase().includes(needle) ||
        (contact.name ?? '').toLowerCase().includes(needle),
    )
    .sort((a, b) => {
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

/** Nur für Tests: den geladenen Stand vergessen. */
export function verwirfKontaktSpeicher(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = undefined;
  cache = null;
}
