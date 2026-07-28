import { memo, useMemo, useRef, useState } from 'react';
import { gruppiere, type Konversation } from '../konversationen.js';
import type { Listeneintrag } from '../listenTypen.js';
import { SearchBar, type SucheEingabe } from './SearchBar.js';

// Weitergereicht, damit Aufrufer den Typ nicht aus zwei Modulen holen müssen.
export type { Listeneintrag };


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
  /** Ob zusammengehörige Nachrichten als ein Eintrag erscheinen. */
  konversationen: boolean;
  onToggleKonversationen: (an: boolean) => void;
  folderLabel: string;
  onLoadMore: () => void;
  onSelect: (eintrag: Listeneintrag) => void;
  onToggleChecked: (uid: number, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  onSearch: (eingabe: SucheEingabe) => void;
  onClear: () => void;
}

function absender(message: Listeneintrag): string {
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

/**
 * Eine Zeile der Liste, gemerkt.
 *
 * Ohne das Merken zeichnete jede Auswahl die gesamte Liste neu - gemessen wuchs die Zeit
 * vom Klick bis zur Anzeige linear mit der Zeilenzahl (10 ms bei 25 Zeilen, 41 ms bei
 * 225, hochgerechnet rund 160 ms bei tausend). Das war kein Problem der DOM-Größe, denn
 * das Scrollen blieb durchweg schnell; es lag am Neuzeichnen. Jetzt ändern sich beim
 * Auswählen nur die zwei betroffenen Zeilen.
 *
 * Bewusst kein Virtualisieren: das hätte die sichtbaren Zeilen begrenzt, aber die Höhen
 * sind nicht gleich (Suchtreffer tragen eine Zeile mehr, Gespräche klappen auf), und ein
 * springender Bildlauf wäre schlimmer als der Gewinn.
 */
const MessageRow = memo(function MessageRow({
  message,
  aktiv,
  angekreuzt,
  eingerueckt,
  zeigeHerkunft,
  onSelect,
  onToggleChecked,
}: {
  message: Listeneintrag;
  aktiv: boolean;
  angekreuzt: boolean;
  eingerueckt: boolean;
  zeigeHerkunft: boolean;
  onSelect: (message: Listeneintrag) => void;
  onToggleChecked: (uid: number, checked: boolean) => void;
}) {
  return (
    <div
      className={
        `message-row` +
        (aktiv ? ' active' : '') +
        (message.seen ? '' : ' unread') +
        (angekreuzt ? ' checked' : '') +
        (eingerueckt ? ' im-gespraech' : '')
      }
      onClick={() => onSelect(message)}
    >
      <input
        type="checkbox"
        className="row-check"
        checked={angekreuzt}
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
  );
});

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
  konversationen,
  onToggleKonversationen,
  folderLabel,
  onLoadMore,
  onSelect,
  onToggleChecked,
  onToggleAll,
  onSearch,
  onClear,
}: Props) {
  const alleAngekreuzt = messages.length > 0 && messages.every((m) => checkedUids.has(m.uid));

  /** Aufgeklappte Gespräche - beim Wechsel der Ansicht ohne Bedeutung, daher lokal. */
  const [offen, setOffen] = useState<Set<string>>(new Set());
  const gruppen = konversationen ? gruppiere(messages) : null;

  const umschalten = (id: string) =>
    setOffen((vorher) => {
      const naechste = new Set(vorher);
      if (naechste.has(id)) naechste.delete(id);
      else naechste.add(id);
      return naechste;
    });

  /**
   * Die Behandlungen kommen bei jedem Zeichnen als neue Funktionen herein. Über eine
   * Referenz weitergereicht bleiben sie für die Zeilen dieselben - erst dadurch greift
   * das Merken unten überhaupt.
   */
  const behandlungen = useRef({ onSelect, onToggleChecked });
  behandlungen.current = { onSelect, onToggleChecked };
  const stabil = useMemo(
    () => ({
      auswaehlen: (m: Listeneintrag) => behandlungen.current.onSelect(m),
      ankreuzen: (uid: number, an: boolean) => behandlungen.current.onToggleChecked(uid, an),
    }),
    [],
  );

  /** Eine einzelne Nachrichtenzeile - in beiden Ansichten dieselbe Darstellung. */
  const zeile = (message: Listeneintrag, eingerueckt = false) => (
    <MessageRow
      key={`${message.folder ?? ''}:${message.uid}`}
      message={message}
      aktiv={message.uid === selectedUid}
      angekreuzt={checkedUids.has(message.uid)}
      eingerueckt={eingerueckt}
      zeigeHerkunft={zeigeHerkunft}
      onSelect={stabil.auswaehlen}
      onToggleChecked={stabil.ankreuzen}
    />
  );

  /** Kopfzeile eines Gesprächs mit mehreren Nachrichten. */
  const gespraechsZeile = (gruppe: Konversation) => {
    const aufgeklappt = offen.has(gruppe.id);
    const enthaeltAuswahl = gruppe.nachrichten.some((m) => m.uid === selectedUid);
    return (
      <div key={gruppe.id}>
        <div
          className={
            `message-row gespraech` +
            (enthaeltAuswahl && !aufgeklappt ? ' active' : '') +
            (gruppe.ungelesen ? ' unread' : '')
          }
          onClick={() => onSelect(gruppe.neueste)}
        >
          <button
            className="gespraech-schalter"
            title={aufgeklappt ? 'Gespräch zuklappen' : 'Alle Nachrichten des Gesprächs zeigen'}
            onClick={(e) => {
              e.stopPropagation();
              umschalten(gruppe.id);
            }}
          >
            {aufgeklappt ? '▾' : '▸'}
          </button>
          <div className="row-body">
            <div className="row-top">
              <span className="row-sender">{gruppe.beteiligte.join(', ')}</span>
              <span className="gespraech-anzahl" title={`${gruppe.nachrichten.length} Nachrichten`}>
                {gruppe.nachrichten.length}
              </span>
              {gruppe.mitAnhang && (
                <span className="row-clip" title="Enthält Anhänge">
                  📎
                </span>
              )}
              <span className="row-date">{kurzesDatum(gruppe.neueste.date)}</span>
            </div>
            <div className="row-subject">{gruppe.neueste.subject}</div>
          </div>
        </div>
        {aufgeklappt && gruppe.nachrichten.map((m) => zeile(m, true))}
      </div>
    );
  };

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
        <button
          className={`gruppieren-schalter${konversationen ? ' an' : ''}`}
          title={
            konversationen
              ? 'Gespräche gruppieren: an – zusammengehörige Nachrichten stehen als ein Eintrag'
              : 'Gespräche gruppieren: aus – jede Nachricht steht für sich'
          }
          onClick={() => onToggleKonversationen(!konversationen)}
        >
          Gespräche
        </button>
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
          (gruppen
            ? gruppen.map((gruppe) =>
                gruppe.nachrichten.length > 1 ? gespraechsZeile(gruppe) : zeile(gruppe.neueste),
              )
            : messages.map((message) => zeile(message)))}
        {!loading && hasMore && (
          <button className="load-more" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? 'Lade…' : `Weitere ${(total - messages.length).toLocaleString('de-DE')} laden`}
          </button>
        )}
      </div>
    </div>
  );
}
