import type { MessageSummary } from '@energy-mail/mail-core';
import { SearchBar, type SucheEingabe } from './SearchBar.js';

/**
 * Eine Zeile der Liste. Bei einer Suche über mehrere Ordner oder Konten steht dabei, wo
 * der Treffer liegt - ohne das wäre eine Trefferliste aus fünf Ordnern nicht deutbar.
 */
export type Listeneintrag = MessageSummary & {
  folder?: string;
  accountId?: string;
  email?: string;
};

interface Props {
  messages: Listeneintrag[];
  selectedUid: number | null;
  loading: boolean;
  checkedUids: Set<number>;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  searchActive: boolean;
  /** Ob der Anbieter nach Anhängen suchen kann - nur Gmail beherrscht das. */
  anhangSuchbar: boolean;
  mehrereKonten: boolean;
  /** Zeigt bei Treffern die Herkunft an - nur sinnvoll, wenn sie sich unterscheiden kann. */
  zeigeHerkunft: boolean;
  folderLabel: string;
  onLoadMore: () => void;
  onSelect: (eintrag: Listeneintrag) => void;
  onToggleChecked: (uid: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onSearch: (eingabe: SucheEingabe) => void;
  onClear: () => void;
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
  searchActive,
  anhangSuchbar,
  mehrereKonten,
  zeigeHerkunft,
  folderLabel,
  onLoadMore,
  onSelect,
  onToggleChecked,
  onToggleAll,
  onSearch,
  onClear,
}: Props) {
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

      <SearchBar
        searchActive={searchActive}
        anhangSuchbar={anhangSuchbar}
        mehrereKonten={mehrereKonten}
        onSearch={onSearch}
        onClear={onClear}
      />

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
              onClick={() => onSelect(message)}
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
                {zeigeHerkunft && message.folder && (
                  <div className="row-herkunft">
                    {message.folder}
                    {message.email ? ` · ${message.email}` : ''}
                  </div>
                )}
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
