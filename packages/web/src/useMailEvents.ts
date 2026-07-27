import { useEffect, useRef } from 'react';

interface EventBase {
  accountId: string;
  email: string;
  folder: string;
}

export type MailEvent =
  | (EventBase & { type: 'new-mail'; count: number; prevCount: number })
  | (EventBase & { type: 'flags-changed'; uid?: number; seen: boolean })
  | (EventBase & { type: 'messages-removed'; uid?: number });

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
export function useMailEvents(onEvent: (event: MailEvent) => void): void {
  const handlerRef = useRef(onEvent);

  useEffect(() => {
    handlerRef.current = onEvent;
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let retryDelay = INITIAL_RETRY_MS;

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(buildWsUrl());

      socket.onopen = () => {
        retryDelay = INITIAL_RETRY_MS;
      };

      socket.onmessage = (message) => {
        try {
          handlerRef.current(JSON.parse(message.data as string) as MailEvent);
        } catch {
          // Unlesbare Nachricht ignorieren statt die Verbindung abzureißen.
        }
      };

      socket.onclose = () => {
        if (disposed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);
}
