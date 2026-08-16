import { memo, useMemo, useRef, useState } from 'react';
import type { Etikett } from '@energy-mail/mail-core';
import { gruppiere, type Konversation } from '../konversationen.js';
import { kaestchenBeschriftung, zeilenBeschriftung } from '../barrierefrei.js';
import type { Listeneintrag } from '../listenTypen.js';
import {
  dichten,
  beschreibeSortierung,
  umfasstAlles,
  type Dichte,
  type Sortierschluessel,
  type Sortierung,
} from '../sortierung.js';
import { FRACHT_ART, alsFracht, frachtFuer, ziehtext } from '../ziehen.js';
import { EtikettMarken } from './Etiketten.js';
import { Monogramm } from './Monogramm.js';
import { SearchBar, type SucheEingabe } from './SearchBar.js';
import { Klammer, LeererKorb, Winkel } from './Symbole.js';
import { datum, t, uhrzeit, zahl } from '../sprache.js';

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
  /** Holt die Liste noch einmal vom Server. */
  onNeuLaden: () => void;
  /** Wie eng die Zeilen stehen. */
  dichte: Dichte;
  onDichte: (neu: Dichte) => void;
  /** Wo die Liste herkommt - fuer das Ziehen in einen Ordner. */
  accountId?: string | null;
  ordner?: string | null;
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

  if (gleicherTag) return uhrzeit(d, { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === jetzt.getFullYear()) {
    return datum(d, { day: '2-digit', month: '2-digit' });
  }
  return datum(d, { day: '2-digit', month: '2-digit', year: '2-digit' });
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
      {/*
        Was hier steht, muss stimmen - sonst hört jemand zu früh auf zu suchen.

        Vorher stand hier "im Text von N bereits geöffneten". Das gilt nicht mehr: die
        Nachrichtentexte liegen verschlüsselt auf der Platte, und ein Volltextindex über
        sie wäre eine unverschlüsselte zweite Fassung gleich daneben. Gesucht wird lokal
        deshalb in Betreff, Absender und Empfänger; für den Nachrichtentext steht der Weg
        über den Anbieter rechts daneben, und der reicht ohnehin weiter.
      */}
      <span>
        Sofort gefunden ({stand.dauerMs} ms) — in Betreff, Absender und Empfänger von{' '}
        {zahl(stand.bestand.kopfdaten)} Nachrichten. Im Nachrichtentext
        sucht nur der Anbieter.
      </span>
      <button className="link-btn" onClick={onVollstaendig}>{t('Beim Anbieter vollständig suchen')}</button>
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

/**
 * Die Kennung einer Zeile im Baum.
 *
 * aria-activedescendant muss darauf zeigen koennen. Eine UID ist nur innerhalb ihres
 * Ordners eindeutig - in der Gesamtliste gaebe es die 34 sonst zweimal -, und in einer
 * Kennung darf kein Schraegstrich stehen.
 */
function zeilenId(m: Listeneintrag): string {
  return `zeile-${(m.folder ?? '').replace(/[^\w-]/g, '_')}-${m.uid}`;
}

const MessageRow = memo(function MessageRow({
  message,
  aktiv,
  angekreuzt,
  eingerueckt,
  zeigeHerkunft,
  etiketten,
  ohneKaestchen,
  nurKonto,
  onZiehen,
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
  /** Beginnt einen Ziehvorgang; null heisst, dass hier nicht gezogen werden kann. */
  onZiehen: ((e: React.DragEvent, message: Listeneintrag) => void) | null;
  onSelect: (message: Listeneintrag) => void;
  onToggleChecked: (uid: number, checked: boolean) => void;
}) {
  return (
    <div
      id={zeilenId(message)}
      className={
        `message-row` +
        (aktiv ? ' active' : '') +
        (message.seen ? '' : ' unread') +
        (angekreuzt ? ' checked' : '') +
        (eingerueckt ? ' im-gespraech' : '')
      }
      // Was hier eine Zeile ist, ist fuer eine Vorlesesoftware ein Eintrag in einer
      // Auswahlliste. Ohne diese Angabe blieb die ganze Liste eine Folge von Kaesten
      // ohne Zusammenhang - und dass eine davon ausgewaehlt ist, war nicht zu hoeren.
      role="option"
      aria-selected={aktiv}
      aria-label={zeilenBeschriftung({
        absender: absender(message),
        betreff: message.subject,
        datum: kurzesDatum(message.date),
        gelesen: message.seen,
        mitAnhang: message.hasAttachments,
        herkunft: zeigeHerkunft && message.folder
          ? (nurKonto ? message.email ?? message.folder : message.folder)
          : undefined,
      })}
      onClick={() => onSelect(message)}
      draggable={Boolean(onZiehen)}
      onDragStart={onZiehen ? (e) => onZiehen(e, message) : undefined}
    >
      {!ohneKaestchen && (
        <input
          type="checkbox"
          className="row-check"
          aria-label={kaestchenBeschriftung(message.subject)}
          checked={angekreuzt}
          // Klick nicht bis zur Zeile durchreichen - sonst würde das Ankreuzen die
          // Nachricht öffnen und als gelesen markieren.
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onToggleChecked(message.uid, e.target.checked)}
        />
      )}
      <Monogramm name={message.from[0]?.name} adresse={message.from[0]?.address} />
      <div className="row-body">
        <div className="row-top">
          <span className="row-sender">{absender(message)}</span>
          {message.hasAttachments && (
            <span className="row-clip" title="Enthält Anhänge">
              <Klammer groesse={13} />
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
  onNeuLaden,
  dichte,
  onDichte,
  accountId,
  ordner,
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
    ? gruppiere(messages, sortierung)
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
  const behandlungen = useRef({ onSelect, onToggleChecked, checkedUids, accountId, ordner });
  behandlungen.current = { onSelect, onToggleChecked, checkedUids, accountId, ordner };
  const stabil = useMemo(
    () => ({
      auswaehlen: (m: Listeneintrag) => behandlungen.current.onSelect(m),
      ankreuzen: (uid: number, an: boolean) => behandlungen.current.onToggleChecked(uid, an),
      /**
       * Beginnt das Ziehen einer Nachricht.
       *
       * Konto und Ordner kommen aus der Zeile selbst, wenn sie sie tragen (Suchtreffer,
       * Gesamtliste) - sonst aus der Ansicht. Ohne diese Unterscheidung landete ein
       * gezogener Treffer aus einem anderen Ordner im falschen Postfach.
       */
      ziehen: (e: React.DragEvent, m: Listeneintrag) => {
        const { checkedUids: angekreuzt, accountId: konto, ordner: hier } = behandlungen.current;
        const vonKonto = m.accountId ?? konto;
        const vonOrdner = m.folder ?? hier;
        if (!vonKonto || !vonOrdner) return;

        const uids = frachtFuer(m.uid, angekreuzt);
        e.dataTransfer.setData(
          FRACHT_ART,
          alsFracht({ accountId: vonKonto, ordner: vonOrdner, uids }),
        );
        // Auch als Text, damit ein Ablegen ausserhalb wenigstens etwas Lesbares ergibt.
        e.dataTransfer.setData('text/plain', ziehtext(uids.length));
        e.dataTransfer.effectAllowed = 'move';
      },
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
      onZiehen={stabil.ziehen}
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
          id={zeilenId(gruppe.neueste)}
          className={
            `message-row gespraech` +
            (enthaeltAuswahl && !aufgeklappt ? ' active' : '') +
            (gruppe.ungelesen ? ' unread' : '')
          }
          role="option"
          aria-selected={enthaeltAuswahl && !aufgeklappt}
          aria-expanded={aufgeklappt}
          aria-label={zeilenBeschriftung({
            absender: gruppe.beteiligte.join(', '),
            betreff: gruppe.neueste.subject,
            datum: kurzesDatum(gruppe.neueste.date),
            gelesen: !gruppe.ungelesen,
            mitAnhang: gruppe.mitAnhang,
            imGespraech: gruppe.nachrichten.length,
          })}
          onClick={() => onSelect(gruppe.neueste)}
        >
          <button
            className="gespraech-schalter"
            aria-label={
              aufgeklappt ? t('Gespräch zuklappen') : t('Alle Nachrichten des Gesprächs zeigen')
            }
            aria-expanded={aufgeklappt}
            title={
              aufgeklappt ? t('Gespräch zuklappen') : t('Alle Nachrichten des Gesprächs zeigen')
            }
            onClick={(e) => {
              e.stopPropagation();
              umschalten(gruppe.id);
            }}
          >
            <Winkel groesse={12} />
          </button>
          {/* Das Monogramm der neuesten Nachricht steht für das Gespräch: es ist die,
              die man beim Anklicken bekommt, und die, deren Betreff daneben steht. */}
          <Monogramm
            name={gruppe.neueste.from[0]?.name}
            adresse={gruppe.neueste.from[0]?.address}
          />
          <div className="row-body">
            <div className="row-top">
              <span className="row-sender">{gruppe.beteiligte.join(', ')}</span>
              <span className="gespraech-anzahl" title={`${gruppe.nachrichten.length} Nachrichten`}>
                {gruppe.nachrichten.length}
              </span>
              {gruppe.mitAnhang && (
                <span className="row-clip" title="Enthält Anhänge">
                  <Klammer groesse={13} />
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

  /**
   * Welche Zeile gerade gilt.
   *
   * Eine UID ist nur innerhalb ihres Ordners eindeutig, deshalb gehoert er in die
   * Kennung; und weil in einer Kennung kein Schraegstrich stehen darf, wird alles
   * Ungewoehnliche ersetzt.
   */
  const aktiveZeile = (() => {
    const treffer = messages.find((m) => m.uid === selectedUid);
    return treffer ? zeilenId(treffer) : undefined;
  })();

  return (
    // Die Dichte haengt an der ganzen Flaeche - so wirkt sie auf Zeilen, Gespraeche und
    // Kopfzeile zugleich, ohne dass jede Stelle sie einzeln kennen muesste.
    <section
      className={`message-pane dichte-${dichte}`}
      id="nachrichtenliste"
      aria-label="Nachrichtenliste"
    >
      <div className="list-head">
        {/* In der Gesamtliste gibt es kein Ankreuzen. Eine UID gilt nur innerhalb
            ihres Postfachs: die 34 von GMX und die 34 von Gmail sind verschiedene
            Nachrichten, und eine Sammelaktion traefe die falsche. Lieber gar nicht
            anbieten als im Postfach eines anderen Kontos etwas loeschen. */}
        {!gesamtAnsicht && (
          <label className="select-all" title="Alle auf dieser Seite auswählen">
            <input
              type="checkbox"
              aria-label="Alle Nachrichten auf dieser Seite auswählen"
              checked={alleAngekreuzt}
              disabled={messages.length === 0}
              onChange={(e) => onToggleAll(e.target.checked)}
            />
          </label>
        )}
        <h2 className="list-title">{searchActive ? t('Suchergebnisse') : folderLabel}</h2>
        {!gesamtAnsicht && (
          <button
            className={`gruppieren-schalter${konversationen ? ' an' : ''}`}
            title={
              konversationen
                ? t('Gespräche gruppieren: an – zusammengehörige Nachrichten stehen als ein Eintrag')
                : t('Gespräche gruppieren: aus – jede Nachricht steht für sich')
            }
            onClick={() => onToggleKonversationen(!konversationen)}
          >{t('Gespräche')}</button>
        )}
        {total > 0 && (
          <span className="list-count">
            {t('{geladen} von {gesamt}', { geladen: messages.length, gesamt: zahl(total) })}
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
        {/*
          Ein Weg, nach neuer Post zu sehen. Es gab keinen: der Kreispfeil oben rechts
          sucht nach Aktualisierungen des Programms, nicht nach Nachrichten. Nach einer
          Stoerung stand man damit vor einer leeren Liste ohne einen Knopf zum Erneut-
          Versuchen.
        */}
        <button
          type="button"
          className="link-btn neu-laden"
          onClick={onNeuLaden}
          disabled={loading}
          title="Nach neuen Nachrichten sehen"
        >
          {loading ? t('Lädt…') : '↻ Neu laden'}
        </button>

        <label className="steuerung-feld">
          <span>{t('Sortieren')}</span>
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
          <span>{t('Dichte')}</span>
          <select value={dichte} onChange={(e) => onDichte(e.target.value as Dichte)}>
            {dichten().map((d) => (
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
            sortiert die {messages.length} geladenen von {zahl(total)}
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
            <strong>{t('Keine Verbindung.')}</strong> Gezeigt wird der zuletzt geholte Stand von
            deinem Rechner. Gelesen werden kann alles, was schon einmal offen war.
          </span>
        </div>
      )}

      {lokalerStand && onVollstaendigSuchen && (
        <LokalHinweis stand={lokalerStand} onVollstaendig={onVollstaendigSuchen} />
      )}

      {/*
        Erreichbar mit der Tabulatortaste und als Auswahlliste angekuendigt. Die
        Pfeiltasten wandern schon immer durch die Liste (siehe useBefehle) - nur wusste
        davon nichts ausserhalb des Bildschirms. aria-activedescendant sagt, welche
        Zeile gerade gilt, ohne dass der Fokus die Liste verlassen muesste.
      */}
      <div
        className="message-scroll"
        role="listbox"
        tabIndex={0}
        aria-label={searchActive ? 'Suchergebnisse' : `Nachrichten in ${folderLabel}`}
        aria-busy={loading || undefined}
        aria-activedescendant={aktiveZeile}
      >
        {loading && <div className="empty-state">{t('Lade Nachrichten…')}</div>}
        {!loading && messages.length === 0 && (
          <div className="empty-state">
            <LeererKorb groesse={38} />
            <span>{searchActive ? t('Keine Treffer') : t('Keine Nachrichten')}</span>
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
            {/*
              Der Knopf sagt, was er tut. Vorher stand "Weitere 31.932 laden" darauf,
              geladen wurde eine Seite - wer bei 32.000 Nachrichten darauf drueckte,
              rechnete mit einer langen Wartezeit und bekam 25 Zeilen.
            */}
            {loadingMore
              ? 'Lade…'
              : `Mehr laden (noch ${zahl(total - messages.length)})`}
          </button>
        )}
      </div>
    </section>
  );
}
