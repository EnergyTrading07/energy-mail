import { memo, useMemo, useRef, useState } from 'react';
import type { Etikett } from '@energy-mail/mail-core';
import { gruppiere, type Konversation } from '../konversationen.js';
import type { Listeneintrag } from '../listenTypen.js';
import {
  DICHTEN,
  beschreibeSortierung,
  umfasstAlles,
  type Dichte,
  type Sortierschluessel,
  type Sortierung,
} from '../sortierung.js';
import { EtikettMarken } from './Etiketten.js';
import { SearchBar, type SucheEingabe } from './SearchBar.js';
import { LeererKorb } from './Symbole.js';

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
  /** Gesetzt, wenn die Liste mangels Verbindung von der Platte kommt. */
  ohneVerbindung?: boolean;
  /** Gesetzt, solange Treffer aus der lokalen Ablage gezeigt werden. */
  lokalerStand?: { dauerMs: number; bestand: { kopfdaten: number; mitText: number } } | null;
  /** Sucht dieselbe Eingabe noch einmal beim Anbieter, über den ganzen Bestand. */
  onVollstaendigSuchen?: () => void;
  /** Ob der Anbieter nach Anhängen suchen kann - nur Gmail beherrscht das. */
  anhangSuchbar: boolean;
  mehrereKonten: boolean;
  /** Zeigt bei Treffern die Herkunft an - nur sinnvoll, wenn sie sich unterscheiden kann. */
  zeigeHerkunft: boolean;
  /** Ob zusammengehörige Nachrichten als ein Eintrag erscheinen. */
  konversationen: boolean;
  onToggleKonversationen: (an: boolean) => void;
  /** Verzeichnis der Etiketten - fuer Farbe und Name der Marken an den Zeilen. */
  etiketten: Etikett[];
  /** Wonach sortiert wird - und in welche Richtung. */
  sortierung: Sortierung;
  onSortierung: (neu: Sortierung) => void;
  /** Wie eng die Zeilen stehen. */
  dichte: Dichte;
  onDichte: (neu: Dichte) => void;
  /** Ob die Liste die Posteingaenge aller Konten zeigt. */
  gesamtAnsicht?: boolean;
  /** Konten, die beim Zusammensetzen nicht antworteten - dann fehlt deren Post. */
  fehlendeKonten?: { accountId: string; email: string; grund: string }[];
  /** Vorgegebene Sucheingabe, etwa aus einer gespeicherten Suche. */
  sucheVorgabe?: SucheEingabe | null;
  /** Legt die laufende Suche in der Seitenleiste ab. */
  onSucheSpeichern?: (eingabe: SucheEingabe) => void;
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
 * Hinweis über Treffern aus der lokalen Ablage.
 *
 * Nötig, weil die schnelle Suche eine echte Grenze hat: Betreff und Absender kennt sie
 * von allen Nachrichten, den Text nur von den bereits geöffneten. Diese Grenze zu
 * verschweigen wäre schlimmer als die Wartezeit - wer glaubt, vollständig gesucht zu
 * haben, hört auf zu suchen.
 */
function LokalHinweis({
  stand,
  onVollstaendig,
}: {
  stand: { dauerMs: number; bestand: { kopfdaten: number; mitText: number } };
  onVollstaendig: () => void;
}) {
  return (
    <div className="lokal-hinweis">
      <span>
        Sofort gefunden ({stand.dauerMs} ms) — in Betreff und Absender von{' '}
        {stand.bestand.kopfdaten.toLocaleString('de-DE')} Nachrichten, im Text von{' '}
        {stand.bestand.mitText.toLocaleString('de-DE')} bereits geöffneten.
      </span>
      <button className="link-btn" onClick={onVollstaendig}>
        Beim Anbieter vollständig suchen
      </button>
    </div>
  );
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
  etiketten,
  ohneKaestchen,
  nurKonto,
  onSelect,
  onToggleChecked,
}: {
  message: Listeneintrag;
  aktiv: boolean;
  angekreuzt: boolean;
  eingerueckt: boolean;
  zeigeHerkunft: boolean;
  etiketten: Etikett[];
  ohneKaestchen: boolean;
  /** Nur das Postfach nennen, nicht auch den Ordner - in der Gesamtliste sind alle im
      Posteingang, und "INBOX" vor jeder Zeile waere reine Wiederholung. */
  nurKonto: boolean;
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
      {!ohneKaestchen && (
        <input
          type="checkbox"
          className="row-check"
          checked={angekreuzt}
          // Klick nicht bis zur Zeile durchreichen - sonst würde das Ankreuzen die
          // Nachricht öffnen und als gelesen markieren.
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleChecked(message.uid, e.target.checked)}
        />
      )}
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
        <div className="row-subject">
          {/* Nur Farbpunkte: ausgeschriebene Namen fraessen in einer Liste den Platz,
              den der Betreff braucht. Beim Ueberfahren stehen sie im Hinweis. */}
          <EtikettMarken flags={message.flags} bekannte={etiketten} wenige />
          {message.subject}
        </div>
        {zeigeHerkunft && message.folder && (
          <div className="row-herkunft">
            {nurKonto ? (message.email ?? message.folder) : message.folder}
            {!nurKonto && message.email ? ` · ${message.email}` : ''}
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
  ohneVerbindung,
  lokalerStand,
  onVollstaendigSuchen,
  anhangSuchbar,
  mehrereKonten,
  zeigeHerkunft,
  konversationen,
  onToggleKonversationen,
  etiketten,
  sortierung,
  onSortierung,
  dichte,
  onDichte,
  gesamtAnsicht,
  fehlendeKonten,
  sucheVorgabe,
  onSucheSpeichern,
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
  /**
   * In der Gesamtliste wird nicht gruppiert.
   *
   * Ein Gespraech kann sich sonst ueber zwei Postfaecher erstrecken - etwa auf einem
   * Verteiler, auf dem beide Adressen stehen. Die Kopfzeile eines solchen Eintrags
   * zaehlte dann Nachrichten aus verschiedenen Konten zusammen und traegt keine
   * Herkunft mehr. Fuer eine Uebersicht ist die schlichte Liste die ehrlichere Form.
   */
  const gruppieren = konversationen && !gesamtAnsicht;
  const gruppen = gruppieren
    ? gruppiere(messages, sortierung.schluessel === 'datum' && sortierung.richtung === 'auf')
    : null;

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
      etiketten={etiketten}
      ohneKaestchen={Boolean(gesamtAnsicht)}
      nurKonto={Boolean(gesamtAnsicht)}
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
    // Die Dichte haengt an der ganzen Flaeche - so wirkt sie auf Zeilen, Gespraeche und
    // Kopfzeile zugleich, ohne dass jede Stelle sie einzeln kennen muesste.
    <div className={`message-pane dichte-${dichte}`}>
      <div className="list-head">
        {/* In der Gesamtliste gibt es kein Ankreuzen. Eine UID gilt nur innerhalb
            ihres Postfachs: die 34 von GMX und die 34 von Gmail sind verschiedene
            Nachrichten, und eine Sammelaktion traefe die falsche. Lieber gar nicht
            anbieten als im Postfach eines anderen Kontos etwas loeschen. */}
        {!gesamtAnsicht && (
          <label className="select-all" title="Alle auf dieser Seite auswählen">
            <input
              type="checkbox"
              checked={alleAngekreuzt}
              disabled={messages.length === 0}
              onChange={(e) => onToggleAll(e.target.checked)}
            />
          </label>
        )}
        <span className="list-title">{searchActive ? 'Suchergebnisse' : folderLabel}</span>
        {!gesamtAnsicht && (
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
        )}
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
        etiketten={etiketten}
        vorgabe={sucheVorgabe}
        onSpeichern={onSucheSpeichern}
        onSearch={onSearch}
        onClear={onClear}
      />

      {/* Sortierung und Dichte. Beides Ansichtssache und deshalb hier statt in den
          Einstellungen - man will es sehen, waehrend man es aendert. */}
      <div className="listen-steuerung">
        <label className="steuerung-feld">
          <span>Sortieren</span>
          <select
            value={`${sortierung.schluessel}:${sortierung.richtung}`}
            onChange={(e) => {
              const [schluessel, richtung] = e.target.value.split(':');
              onSortierung({
                schluessel: schluessel as Sortierschluessel,
                richtung: richtung === 'auf' ? 'auf' : 'ab',
              });
            }}
          >
            {(
              [
                { schluessel: 'datum', richtung: 'ab' },
                { schluessel: 'datum', richtung: 'auf' },
                { schluessel: 'absender', richtung: 'auf' },
                { schluessel: 'absender', richtung: 'ab' },
                { schluessel: 'betreff', richtung: 'auf' },
                { schluessel: 'betreff', richtung: 'ab' },
              ] as Sortierung[]
            ).map((s) => (
              <option key={`${s.schluessel}:${s.richtung}`} value={`${s.schluessel}:${s.richtung}`}>
                {beschreibeSortierung(s)}
              </option>
            ))}
          </select>
        </label>

        <label className="steuerung-feld">
          <span>Dichte</span>
          <select value={dichte} onChange={(e) => onDichte(e.target.value as Dichte)}>
            {DICHTEN.map((d) => (
              <option key={d.wert} value={d.wert} title={d.erklaerung}>
                {d.name}
              </option>
            ))}
          </select>
        </label>

        {/* Die Grenze, die man kennen muss: nach Absender oder Betreff wird nur das
            Geladene sortiert. Eine Sortierung, die so tut, als umfasse sie alles, laesst
            einen oben nach etwas suchen, das weiter unten steht. */}
        {!umfasstAlles(sortierung) && messages.length < total && (
          <span className="steuerung-hinweis">
            sortiert die {messages.length} geladenen von {total.toLocaleString('de-DE')}
          </span>
        )}
      </div>

      {gesamtAnsicht && (fehlendeKonten?.length ?? 0) > 0 && (
        <div className="ohne-verbindung" role="status">
          <span>
            {fehlendeKonten!.map((k) => k.email).join(', ')} antwortet nicht – die Liste ist
            unvollständig.
          </span>
        </div>
      )}

      {ohneVerbindung && (
        <div className="ohne-verbindung" role="status">
          <span>
            <strong>Keine Verbindung.</strong> Gezeigt wird der zuletzt geholte Stand von
            deinem Rechner. Gelesen werden kann alles, was schon einmal offen war.
          </span>
        </div>
      )}

      {lokalerStand && onVollstaendigSuchen && (
        <LokalHinweis stand={lokalerStand} onVollstaendig={onVollstaendigSuchen} />
      )}

      <div className="message-scroll">
        {loading && <div className="empty-state">Lade Nachrichten…</div>}
        {!loading && messages.length === 0 && (
          <div className="empty-state">
            <LeererKorb groesse={38} />
            <span>{searchActive ? 'Keine Treffer' : 'Keine Nachrichten'}</span>
          </div>
        )}
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
