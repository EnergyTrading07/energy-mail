import { useState } from 'react';
import type { MessageSummary } from '@energy-mail/mail-core';

interface Props {
  messages: MessageSummary[];
  selectedUid: number | null;
  loading: boolean;
  checkedUids: Set<number>;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  /** Name des Bereichs für eine Suche über alles; null, wenn der Anbieter keinen hat. */
  searchScope: string | null;
  searchActive: boolean;
  folderLabel: string;
  onLoadMore: () => void;
  onSelect: (uid: number) => void;
  onToggleChecked: (uid: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onSearch: (query: string, alleOrdner?: boolean) => void;
}

function absender(message: MessageSummary): string {
  const from = message.from[0];
  if (!from) return '(unbekannt)';
  return from.name || from.address;
}

/**
 * Kurzes, gut überfliegbares Datum: heute nur die Uhrzeit, im laufenden Jahr Tag und
 * Monat, davor mit Jahr. Ein vollständiger Zeitstempel in jeder Zeile wäre nur Rauschen.
 */
function kurzesDatum(date: Date | null): string {
  if (!date) return '';
  const d = new Date(date);
  const jetzt = new Date();
  const gleicherTag =
    d.getDate() === jetzt.getDate() &&
    d.getMonth() === jetzt.getMonth() &&
    d.getFullYear() === jetzt.getFullYear();

  if (gleicherTag) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === jetzt.getFullYear()) {
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  }
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function MessageList({
  messages,
  selectedUid,
  loading,
  checkedUids,
  total,
  hasMore,
  loadingMore,
  searchScope,
  searchActive,
  folderLabel,
  onLoadMore,
  onSelect,
  onToggleChecked,
  onToggleAll,
  onSearch,
}: Props) {
  const [query, setQuery] = useState('');
  const [alleOrdner, setAlleOrdner] = useState(false);
  const alleAngekreuzt = messages.length > 0 && messages.every((m) => checkedUids.has(m.uid));

  return (
    <div className="message-pane">
      <div className="list-head">
        <label className="select-all" title="Alle auf dieser Seite auswählen">
          <input
            type="checkbox"
            checked={alleAngekreuzt}
            disabled={messages.length === 0}
            onChange={(e) => onToggleAll(e.target.checked)}
          />
        </label>
        <span className="list-title">{searchActive ? 'Suchergebnisse' : folderLabel}</span>
        {total > 0 && (
          <span className="list-count">
            {messages.length} von {total.toLocaleString('de-DE')}
          </span>
        )}
      </div>

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch(query, alleOrdner);
        }}
      >
        <input
          type="search"
          placeholder="Suchen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="search-options">
          {searchScope && (
            <label className="search-scope">
              <input
                type="checkbox"
                checked={alleOrdner}
                onChange={(e) => {
                  setAlleOrdner(e.target.checked);
                  if (query.trim()) onSearch(query, e.target.checked);
                }}
              />
              in {searchScope}
            </label>
          )}
          {searchActive && (
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setQuery('');
                onSearch('');
              }}
            >
              Suche aufheben
            </button>
          )}
        </div>
      </form>

      <div className="message-scroll">
        {loading && <div className="empty-state">Lade Nachrichten…</div>}
        {!loading && messages.length === 0 && <div className="empty-state">Keine Nachrichten</div>}
        {!loading &&
          messages.map((message) => (
            <div
              key={message.uid}
              className={
                `message-row` +
                (message.uid === selectedUid ? ' active' : '') +
                (message.seen ? '' : ' unread') +
                (checkedUids.has(message.uid) ? ' checked' : '')
              }
              onClick={() => onSelect(message.uid)}
            >
              <input
                type="checkbox"
                className="row-check"
                checked={checkedUids.has(message.uid)}
                // Klick nicht bis zur Zeile durchreichen - sonst würde das Ankreuzen die
                // Nachricht öffnen und als gelesen markieren.
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onToggleChecked(message.uid, e.target.checked)}
              />
              <div className="row-body">
                <div className="row-top">
                  <span className="row-sender">{absender(message)}</span>
                  {message.hasAttachments && (
                    <span className="row-clip" title="Enthält Anhänge">
                      📎
                    </span>
                  )}
                  <span className="row-date">{kurzesDatum(message.date)}</span>
                </div>
                <div className="row-subject">{message.subject}</div>
              </div>
            </div>
          ))}
        {!loading && hasMore && (
          <button className="load-more" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Lade…' : `Weitere ${(total - messages.length).toLocaleString('de-DE')} laden`}
          </button>
        )}
      </div>
    </div>
  );
}
