import type {
  CategoryInfo,
  FolderInfo,
  FullMessage,
  GmailCategory,
  MessageSummary,
  OutgoingMessage,
  ProviderId,
} from '@energy-mail/mail-core';

// Leerer Default: UI und API laufen normalerweise auf derselben Origin (der Server
// liefert das gebaute Frontend mit aus). Nur im Vite-Dev-Modus wird VITE_API_URL
// gesetzt, um auf den separat laufenden Server zu zeigen.
const API_BASE = import.meta.env.VITE_API_URL ?? '';

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
}

export interface Contact {
  address: string;
  name?: string;
  count: number;
  lastSeen: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // Content-Type nur bei vorhandenem Inhalt: kündigt man JSON an und schickt nichts,
    // weist Fastify die Anfrage ab ("Body cannot be empty"). Das trifft alle Aufrufe
    // ohne Inhalt - DELETE und das Starten der OAuth-Anmeldung.
    headers: init?.body
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : { ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Anfrage fehlgeschlagen (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export function fetchAccounts(): Promise<Account[]> {
  return request('/accounts');
}

export function createAccount(email: string, password: string): Promise<Account> {
  return request('/accounts', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function deleteAccount(accountId: string): Promise<{ ok: boolean }> {
  return request(`/accounts/${accountId}`, { method: 'DELETE' });
}

export function updateAccount(
  accountId: string,
  settings: { displayName?: string; signature?: string },
): Promise<Account> {
  return request(`/accounts/${accountId}`, { method: 'PATCH', body: JSON.stringify(settings) });
}

export function fetchContacts(query: string): Promise<Contact[]> {
  return request(`/contacts?q=${encodeURIComponent(query)}`);
}

// --- OAuth ---

export type OAuthProvider = 'google' | 'microsoft';

export type OAuthClients = Record<OAuthProvider, { configured: boolean; clientId?: string }>;

export function fetchOAuthClients(): Promise<OAuthClients> {
  return request('/oauth/clients');
}

export function saveOAuthClient(
  provider: OAuthProvider,
  credentials: { clientId: string; clientSecret?: string },
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

/** Gmails Einordnung des Posteingangs; bei anderen Anbietern eine leere Liste. */
export function fetchCategories(accountId: string): Promise<CategoryInfo[]> {
  return request(`/accounts/${accountId}/categories`);
}

/** Nachrichten je Seite. Bewusst hier festgelegt und nicht dem Server überlassen. */
export const PAGE_SIZE = 25;

export interface MessagePage {
  messages: MessageSummary[];
  total: number;
  /** Marke für die nächste, ältere Seite. */
  nextCursor: number | null;
  hasMore: boolean;
}

export function fetchMessages(
  accountId: string,
  folder: string,
  beforeUid?: number,
  category?: GmailCategory | null,
): Promise<MessagePage> {
  const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
  if (beforeUid !== undefined) params.set('beforeUid', String(beforeUid));
  if (category) params.set('category', category);
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/messages?${params}`);
}

export function fetchMessage(accountId: string, folder: string, uid: number): Promise<FullMessage> {
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
      { signal },
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
  return (
    `${API_BASE}/accounts/${accountId}/folders/${encodeURIComponent(folder)}` +
    `/messages/${uid}/attachments/${encodeURIComponent(partId)}`
  );
}

export function moveMessages(
  accountId: string,
  folder: string,
  uids: number[],
  targetFolder: string,
): Promise<{ ok: boolean }> {
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

export function searchMessages(
  accountId: string,
  folder: string,
  query: string,
  beforeUid?: number,
  category?: GmailCategory | null,
): Promise<MessagePage> {
  const params = new URLSearchParams({ q: query, pageSize: String(PAGE_SIZE) });
  if (beforeUid !== undefined) params.set('beforeUid', String(beforeUid));
  if (category) params.set('category', category);
  return request(`/accounts/${accountId}/folders/${encodeURIComponent(folder)}/search?${params}`);
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

export type Draft = Omit<OutgoingMessage, 'attachments'> & {
  attachments?: DraftAttachment[];
  attachOriginal?: ForwardSource;
  /** Beim Senden: der zugehörige Entwurf wird danach entfernt. */
  draftFolder?: string;
  draftUid?: number;
};

export interface SendResponse {
  ok: boolean;
  savedToSent: boolean;
  sentFolder?: string;
  saveError?: string;
}

export function sendMessage(accountId: string, draft: Draft): Promise<SendResponse> {
  return request(`/accounts/${accountId}/send`, { method: 'POST', body: JSON.stringify(draft) });
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
