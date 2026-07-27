import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './paths.js';

const getStorePath = () => path.join(getDataDir(), 'contacts.json');

interface Contact {
  address: string;
  name?: string;
  /** Wie oft die Adresse begegnet ist - häufige stehen bei Vorschlägen oben. */
  count: number;
  /** Zeitpunkt der letzten Begegnung als ISO-Zeichenkette. */
  lastSeen: string;
}

let cache: Map<string, Contact> | null = null;

function load(): Map<string, Contact> {
  if (cache) return cache;
  cache = new Map();
  const storePath = getStorePath();
  if (fs.existsSync(storePath)) {
    try {
      const entries = JSON.parse(fs.readFileSync(storePath, 'utf-8')) as Contact[];
      for (const entry of entries) cache.set(entry.address.toLowerCase(), entry);
    } catch {
      // Beschädigte Datei ist kein Grund, die Anwendung zu blockieren - Vorschläge
      // sind Komfort, keine Kernfunktion.
    }
  }
  return cache;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Gebündelt schreiben: beim Durchblättern fallen sonst Dutzende Schreibvorgänge an. */
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const entries = [...(cache ?? new Map<string, Contact>()).values()];
    fs.mkdirSync(getDataDir(), { recursive: true });
    fs.writeFileSync(getStorePath(), JSON.stringify(entries, null, 2), 'utf-8');
  }, 2000);
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
  const contacts = load();
  let changed = false;

  for (const entry of addresses) {
    const address = entry.address?.trim();
    if (!address || !address.includes('@')) continue;

    const key = address.toLowerCase();
    const existing = contacts.get(key);
    if (existing) {
      existing.count += 1;
      // Namen nur ergänzen, nicht überschreiben - der erste ist meist der bessere.
      if (!existing.name && entry.name) existing.name = entry.name;
      if (when.toISOString() > existing.lastSeen) existing.lastSeen = when.toISOString();
    } else {
      contacts.set(key, {
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

/** Liefert passende Adressen, häufig genutzte und zuletzt verwendete zuerst. */
export function searchContacts(query: string, limit = 8): Contact[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return [...load().values()]
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
  return load().size;
}
