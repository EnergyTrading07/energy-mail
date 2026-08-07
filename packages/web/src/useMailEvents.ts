import { useEffect, useRef } from 'react';

interface EventBase {
  accountId: string;
  email: string;
  folder: string;
}

export type MailEvent =
  | (EventBase & { type: 'new-mail'; count: number; prevCount: number })
  | (EventBase & { type: 'flags-changed'; uid?: number; seen: boolean })
  | (EventBase & { type: 'messages-removed'; uid?: number })
  /**
   * Der Server hat im Hintergrund nachgesehen und einen neueren Stand gefunden als den,
   * der gerade angezeigt wird. Kommt daher, dass Ordner, Einordnung und die erste Seite
   * aus einem Zwischenspeicher beantwortet werden: erst das Vorhandene zeigen, dann
   * stillschweigend nachziehen.
   */
  | {
      type: 'data-updated';
      accountId: string;
      was: 'folders' | 'categories' | 'messages';
      folder?: string;
      category?: string;
    }
  /** Ein Vorgang, der länger dauert, meldet, wie weit er ist. */
  | {
      type: 'fortschritt';
      accountId: string;
      vorgang: 'absender' | 'offen' | 'sicherung';
      getan: number;
      von: number;
      text?: string;
    };

const INITIAL_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

function buildWsUrl(): string {
  const base = import.meta.env.VITE_API_URL;
  if (base) {
    const url = new URL(base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/ws';
    return url.toString();
  }
  // Normalfall: Server liefert das Frontend selbst aus, daher gleiche Origin.
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * Hält eine WebSocket-Verbindung zum Server offen und meldet Ereignisse *aller*
 * Konten. Bei Verbindungsabbruch (Server-Neustart, Standby) wird mit wachsender
 * Wartezeit neu verbunden.
 */
/**
 * Eine Verbindung für alle Zuhörer.
 *
 * Früher öffnete jeder Aufruf des Hakens eine eigene - solange nur die Hauptansicht
 * zuhörte, fiel das nicht auf. Sobald aber ein Fenster mithört, um den Fortschritt eines
 * Vorgangs zu zeigen, wären es zwei, und der Server hielte zwei Sitzungen offen. Die
 * Verbindung entsteht beim ersten Zuhörer und schließt sich mit dem letzten.
 */
const zuhoerer = new Set<(event: MailEvent) => void>();
let verbindung: WebSocket | null = null;
let neuVersuchTimer: ReturnType<typeof setTimeout> | undefined;
let neuVersuchMs = INITIAL_RETRY_MS;

function verbinde(): void {
  if (verbindung || zuhoerer.size === 0) return;
  const socket = new WebSocket(buildWsUrl());
  verbindung = socket;

  socket.onopen = () => {
    neuVersuchMs = INITIAL_RETRY_MS;
  };

  socket.onmessage = (message) => {
    let ereignis: MailEvent;
    try {
      ereignis = JSON.parse(message.data as string) as MailEvent;
    } catch {
      // Unlesbare Nachricht ignorieren statt die Verbindung abzureißen.
      return;
    }
    // Über eine Kopie: ein Zuhörer, der sich währenddessen abmeldet, dürfte sonst die
    // Schleife durcheinanderbringen.
    for (const hoere of [...zuhoerer]) hoere(ereignis);
  };

  socket.onclose = () => {
    if (verbindung !== socket) return;
    verbindung = null;
    if (zuhoerer.size === 0) return;
    neuVersuchTimer = setTimeout(verbinde, neuVersuchMs);
    neuVersuchMs = Math.min(neuVersuchMs * 2, MAX_RETRY_MS);
  };
}

export function useMailEvents(onEvent: (event: MailEvent) => void): void {
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  });

  useEffect(() => {
    // Über eine feste Hülle angemeldet, damit ein wechselnder onEvent die Anmeldung
    // nicht jedes Mal löst und neu setzt.
    const huelle = (event: MailEvent) => handlerRef.current(event);
    zuhoerer.add(huelle);
    verbinde();

    return () => {
      zuhoerer.delete(huelle);
      if (zuhoerer.size > 0) return;
      clearTimeout(neuVersuchTimer);
      const offen = verbindung;
      verbindung = null;
      offen?.close();
    };
  }, []);
}
