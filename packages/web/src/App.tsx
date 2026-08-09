import { useEffect, useMemo, useRef, useState } from 'react';
import { beschreibeSuche } from '@energy-mail/mail-core/etiketten';
import type {
  CategoryInfo,
  Etikett,
  FolderInfo,
  FullMessage,
  GmailCategory,
  MessageSummary,
} from '@energy-mail/mail-core';
import * as api from './api.js';
import type { Account } from './api.js';
import { Aktualisierung } from './components/Aktualisierung.js';
import { BulkActionBar } from './components/BulkActionBar.js';
import { ComposeModal } from './components/ComposeModal.js';
import { MessageList, type Listeneintrag } from './components/MessageList.js';
import { Sidebar } from './components/Sidebar.js';
import { Titelleiste } from './components/Titelleiste.js';
import { MessageView } from './components/MessageView.js';
import { AccountSettingsModal } from './components/AccountSettingsModal.js';
import { OAuthSetupModal } from './components/OAuthSetupModal.js';
import { CleanupModal } from './components/CleanupModal.js';
import { AdressbuchModal } from './components/AdressbuchModal.js';
import { bringtDateien, type Fracht } from './ziehen.js';
import {
  STANDARD_SORTIERUNG,
  alsDichte,
  alsSortierung,
  alsText,
  sortiere,
  umfasstAlles,
  type Dichte,
  type Sortierung,
} from './sortierung.js';
import { SchluesselModal } from './components/SchluesselModal.js';
import { RulesModal } from './components/RulesModal.js';
import { QuelltextModal } from './components/QuelltextModal.js';
import { absenderFuerAntwort, alleAbsender } from './identitaeten.js';
import { WartendModal } from './components/WartendModal.js';
import { SendeMeldung } from './components/SendeMeldung.js';
import { SicherungsMeldung } from './components/SicherungsMeldung.js';
import type { SucheEingabe } from './components/SearchBar.js';
import {
  buildFollowUpSubject,
  buildForward,
  buildReply,
  hasMultipleRecipients,
  withSignature,
} from './composeHelpers.js';
import { zeichneAbzeichen } from './design/abzeichen.js';
import { useThema } from './design/thema.js';
import { bestaetige, frage, waehleZeitpunkt, wiedervorlageVorschlaege } from './dialoge.js';
import { archiveTarget } from './folderTargets.js';
import { buildFolderView } from './folderTree.js';
import { categoryLabel } from './gmailCategories.js';
import { meldeErfolg, meldeFehler, meldeMitRueckweg, meldeWarnung } from './meldungen.js';
import { providerTheme } from './providerTheme.js';
import { escapeHtml, textToHtml } from './htmlText.js';
import { useAktualisierung } from './useAktualisierung.js';
import { useBefehle, type Befehl } from './useBefehle.js';
import { useMailEvents } from './useMailEvents.js';

interface DraftLocation {
  folder: string;
  uid: number | null;
}

/** Fügt neue Treffer zu vorhandenen hinzu, ersetzt gleiche UIDs und sortiert nach Datum. */
/**
 * Führt eine nachgeladene Seite mit dem Vorhandenen zusammen.
 *
 * Die Richtung muss mit hinein. Vorher ordnete diese Funktion fest nach Datum
 * absteigend - und machte damit "Älteste zuerst" wirkungslos: der Server lieferte
 * brav die ältesten, hier wurden sie wieder umgedreht, und in der Liste stand
 * unverändert die neueste oben. Vom Umschalten war nichts zu sehen.
 */
function mergeMessages(
  existing: Listeneintrag[],
  incoming: Listeneintrag[],
  aeltesteZuerst = false,
): Listeneintrag[] {
  const byUid = new Map(existing.map((m) => [m.uid, m]));
  for (const message of incoming) byUid.set(message.uid, message);
  return [...byUid.values()].sort((a, b) => {
    const abstand = new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime();
    return aeltesteZuerst ? -abstand : abstand;
  });
}

export default function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);

  // Ordner je Konto: dadurch zeigt die Seitenleiste auch Zähler für gerade nicht
  // geöffnete Konten - sonst bliebe unsichtbar, dass dort Post liegt.
  const [foldersByAccount, setFoldersByAccount] = useState<Record<string, FolderInfo[]>>({});
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [loadingFolders, setLoadingFolders] = useState(false);

  // Gmails Einordnung des Posteingangs (Werbung, Soziale Netzwerke, …). Kein Ordner,
  // sondern ein Filter auf den Posteingang - deshalb getrennt von selectedFolder.
  const [categories, setCategories] = useState<CategoryInfo[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<GmailCategory | null>(null);

  /**
   * Was der Server des aktiven Kontos kann. Bestimmt, welche Sucheinschränkungen
   * überhaupt angeboten werden - nach Anhängen kann nur Gmail suchen.
   */
  const [faehigkeiten, setFaehigkeiten] = useState<{ gmailSearch: boolean }>({
    gmailSearch: false,
  });

  /** Aus einer angeklickten Benachrichtigung: was geöffnet werden soll, sobald es geht. */
  const [zuOeffnen, setZuOeffnen] = useState<{
    accountId: string;
    folder: string;
    uid: number;
  } | null>(null);

  const [messages, setMessages] = useState<Listeneintrag[]>([]);
  /**
   * Die Auswahl merkt sich, zu welcher Ansicht sie gehört (Konto + Ordner).
   *
   * UIDs gelten nur innerhalb eines Ordners. Ohne diese Bindung wurde beim Kontowechsel
   * die zuvor gewählte UID im neuen Konto gesucht - der Abruf lief los, bevor die
   * Zurücksetzung wirkte, und es erschien "Nachricht ... nicht gefunden". Als abgeleiteter
   * Wert kann das gar nicht mehr passieren.
   */
  const [selection, setSelection] = useState<{ view: string; uid: number } | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<FullMessage | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);

  const [composeInitial, setComposeInitial] = useState<Partial<api.Draft> | null>(null);
  const [composeTitle, setComposeTitle] = useState('Neue Nachricht');
  const [draftLocation, setDraftLocation] = useState<DraftLocation | undefined>(undefined);
  const [settingsFor, setSettingsFor] = useState<api.Account | null>(null);
  /** Konto, dessen Regeln gerade verwaltet werden. */
  const [rulesFor, setRulesFor] = useState<api.Account | null>(null);
  /** Vorbelegung, wenn die Regel aus dem Aufraeumen heraus angelegt wird. */
  const [regelVorgabe, setRegelVorgabe] = useState<{ von: string; name: string } | undefined>();
  /** Konto, dessen Postfach gerade aufgeraeumt wird. */
  const [cleanupFor, setCleanupFor] = useState<api.Account | null>(null);
  /** Konto, dessen ausstehende Sendungen und Wiedervorlagen gezeigt werden. */
  const [wartendFor, setWartendFor] = useState<api.Account | null>(null);
  /** Für welche Nachricht der Quelltext offen ist - Ordner und Konto ergeben sich. */
  const [quelltextFuer, setQuelltextFuer] = useState<{ uid: number; betreff: string } | null>(null);
  /** Gesetzt, solange Treffer aus der lokalen Ablage angezeigt werden. */
  const [lokalerStand, setLokalerStand] = useState<api.LokaleSuche | null>(null);
  /** Gesetzt, solange die Liste aus der Ablage kommt, weil keine Verbindung besteht. */
  const [ohneVerbindung, setOhneVerbindung] = useState(false);
  /** Welcher Ordner gerade gesichert wird - traegt die Fortschrittsanzeige. */
  const [sicherungLaeuft, setSicherungLaeuft] = useState<{
    accountId: string;
    ordner: string;
  } | null>(null);
  /** Wie viel aussteht - fuer den Hinweis in der Seitenleiste. */
  const [wartendAnzahl, setWartendAnzahl] = useState(0);
  /** Verzeichnis der Etiketten: Name und Farbe zu jedem Schluesselwort. */
  const [etiketten, setEtiketten] = useState<Etikett[]>([]);
  /**
   * Ob der offene Ordner Etiketten dauerhaft behaelt. null heisst "noch nicht gefragt" -
   * gefragt wird beim ersten Vergeben, nicht bei jedem Ordnerwechsel.
   */
  const [etikettenDauerhaft, setEtikettenDauerhaft] = useState<boolean | null>(null);
  /** Gespeicherte Suchen - Ordner, die es gar nicht gibt. */
  const [suchen, setSuchen] = useState<api.GespeicherteSuche[]>([]);
  /** Ob der Schluesselbund offen ist. */
  const [schluesselOffen, setSchluesselOffen] = useState(false);
  /**
   * Sortierung und Anzeigedichte. Beide ueberdauern den Neustart - eine Einstellung,
   * die man bei jedem Start neu treffen muss, ist keine.
   */
  const [sortierung, setSortierung] = useState<Sortierung>(() =>
    alsSortierung(localStorage.getItem('energy-mail:sortierung')),
  );
  const [dichte, setDichte] = useState<Dichte>(() =>
    alsDichte(localStorage.getItem('energy-mail:dichte')),
  );
  /** Von aussen in die Suchleiste gesetzte Eingabe - aus einer gemerkten Suche. */
  const [sucheVorgabe, setSucheVorgabe] = useState<SucheEingabe | null>(null);
  /** Ob der Posteingang aller Konten in einer Liste steht. */
  const [gesamtAnsicht, setGesamtAnsicht] = useState(false);
  /** Marke fuer die naechste Seite der Gesamtliste - je Konto die zuletzt gelieferte UID. */
  const [gesamtCursor, setGesamtCursor] = useState<string | null>(null);
  /** Konten, die beim letzten Abruf nicht antworteten. */
  const [gesamtFehlende, setGesamtFehlende] = useState<
    { accountId: string; email: string; grund: string }[]
  >([]);
  /**
   * In der Gesamtliste bestimmt die angeklickte Nachricht, welches Konto und welcher
   * Ordner gemeint sind - nicht die Auswahl in der Seitenleiste.
   */
  const [gesamtHerkunft, setGesamtHerkunft] = useState<{
    accountId: string;
    folder: string;
  } | null>(null);
  /**
   * Eine gemerkte Suche, die noch auf ihren Ordner wartet.
   *
   * Sie sofort auszufuehren ginge schief: der Ordnerwechsel laedt den Ordnerinhalt, und
   * welche der beiden Antworten zuletzt eintraefe, waere Zufall. Darum erst merken, dann
   * ausfuehren, sobald der richtige Ordner offen ist.
   */
  const [offeneSuche, setOffeneSuche] = useState<{
    eingabe: SucheEingabe;
    folder?: string;
  } | null>(null);
  /**
   * Das Adressbuch. Ein leeres Objekt heisst "offen ohne Vorgabe" - mit "vorgabe" wird
   * gleich ein Eintrag zum Anlegen vorgelegt, etwa aus einer Nachricht heraus.
   */
  const [adressbuch, setAdressbuch] = useState<{
    vorgabe?: { address: string; name?: string };
  } | null>(null);
  /** Vorgemerkte Nachricht - waehrend der Bedenkzeit oder bis zum geplanten Zeitpunkt. */
  const [geplant, setGeplant] = useState<{
    id: string;
    faellig: number;
    betreff: string;
    draft: api.Draft;
    spaeter: boolean;
  } | null>(null);
  const [oauthClients, setOauthClients] = useState<api.OAuthClients | null>(null);
  const [oauthBusy, setOauthBusy] = useState<api.OAuthProvider | null>(null);
  /** Kennung des Kontos, dessen Neuanmeldung gerade läuft. */
  const [reauthBusy, setReauthBusy] = useState<string | null>(null);
  const [showOAuthSetup, setShowOAuthSetup] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hochzählen erzwingt ein Neuladen der Nachrichtenliste, ohne die Auswahl zu verlieren.
  const [reloadCounter, setReloadCounter] = useState(0);
  /** Laufende Nummer der Suchen - nur die jüngste darf das Ergebnis setzen. */
  const sucheNummer = useRef(0);
  // Getrennt davon, weil sich die Ungelesen-Zähler der Ordner auch ändern, wenn die
  // Nachrichtenliste selbst gleich bleibt (z.B. beim Als-gelesen-Markieren).
  const [folderReload, setFolderReload] = useState(0);
  // Konten, die neue Mail haben, während sie gerade nicht angezeigt werden.
  const [accountsWithNewMail, setAccountsWithNewMail] = useState<Set<string>>(new Set());

  // Angekreuzte Nachrichten für Sammelaktionen - unabhängig von der geöffneten Nachricht.
  const [checkedUids, setCheckedUids] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Nachladen älterer Nachrichten über eine UID-Marke statt Seitennummern: Positionen
  // verschieben sich, sobald Mail eintrifft, und beim Blättern in großen Postfächern
  // würden Nachrichten übersprungen oder doppelt erscheinen.
  const [cursor, setCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Gesetzt, solange Suchergebnisse angezeigt werden. */
  const [suche, setSuche] = useState<SucheEingabe | null>(null);
  /**
   * Ob zusammengehörige Nachrichten als ein Eintrag erscheinen. Bleibt über Neustarts
   * hinweg erhalten - an der Gruppierung scheiden sich die Geister, und wer sie abstellt,
   * will sie nicht beim nächsten Start wieder vorfinden.
   */
  const [konversationen, setKonversationen] = useState<boolean>(
    () => localStorage.getItem('energy-mail:konversationen') !== 'aus',
  );
  const [searchFolder, setSearchFolder] = useState<string | null>(null);

  /** Helle oder dunkle Ansicht; Aktualisierungsablauf der Desktop-Hülle. */
  const thema = useThema();
  const aktualisierung = useAktualisierung();

  useEffect(() => {
    api
      .fetchAccounts()
      .then((accs) => {
        setAccounts(accs);
        if (accs.length > 0) setSelectedAccountId(accs[0].id);
      })
      .catch((err) => setError((err as Error).message));

    // Nur zur Anzeige, ob "Mit Google anmelden" schon nutzbar ist.
    api.fetchOAuthClients().then(setOauthClients).catch(() => setOauthClients(null));
  }, []);

  /**
   * Einen aufgetretenen Fehler melden und den Kontostand nachladen.
   *
   * Dass eine Anmeldung abgelaufen ist, stellt sich erst beim fehlgeschlagenen Abruf
   * heraus - der Server hält es dann fest. Ohne dieses Nachladen bliebe die Seitenleiste
   * bis zum Neustart ahnungslos, und der Knopf zum Neuanmelden erschiene nie.
   *
   * Der Wert wird gleich wieder geleert: die Meldung führt jetzt ein Eigenleben (sie
   * kann weggeklickt werden und stapelt sich mit anderen), und ohne das Leeren würde
   * derselbe Fehler beim zweiten Auftreten stillschweigend verschluckt, weil sich der
   * Zustand nicht geändert hätte.
   */
  useEffect(() => {
    if (!error) return;
    meldeFehler(error);
    api.fetchAccounts().then(setAccounts).catch(() => {});
    setError(null);
  }, [error]);

  /**
   * Auf welches Konto und welchen Ordner sich eine Aktion bezieht.
   *
   * Ausserhalb der Gesamtliste ist das schlicht die Auswahl der Seitenleiste. In der
   * Gesamtliste dagegen stammt jede Zeile aus einem anderen Postfach - dort entscheidet
   * die angeklickte Nachricht. Ohne diese Unterscheidung ginge ein Loeschen an das
   * zuletzt gewaehlte Konto, nicht an das der Nachricht.
   */
  const arbeitsKonto = gesamtAnsicht ? (gesamtHerkunft?.accountId ?? null) : selectedAccountId;
  const arbeitsOrdner = gesamtAnsicht ? (gesamtHerkunft?.folder ?? null) : selectedFolder;

  // Beim Kontowechsel die Ordnerauswahl verwerfen, damit unten wieder der Posteingang
  // des neuen Kontos gewählt wird.
  useEffect(() => {
    setSelectedFolder(null);
    setSelectedCategory(null);
  }, [selectedAccountId]);

  /**
   * Etiketten und gespeicherte Suchen einmal beim Start.
   *
   * Beides gilt für alle Konten zusammen und ändert sich selten - es beim Ordnerwechsel
   * neu zu holen wäre reine Last.
   */
  useEffect(() => {
    api.ladeEtiketten().then(setEtiketten).catch(() => setEtiketten([]));
    api.ladeSuchen().then(setSuchen).catch(() => setSuchen([]));
  }, []);

  // Ob Etiketten halten, hängt am Ordner - beim Wechsel gilt die Antwort nicht mehr.
  useEffect(() => {
    setEtikettenDauerhaft(null);
  }, [selectedAccountId, selectedFolder]);

  /**
   * Lädt Gmails Einordnung des Posteingangs - bewusst getrennt von der Ordnerliste.
   *
   * Dafür braucht es vier Suchabfragen (etwa eine Sekunde bei 30.000 Nachrichten). In
   * denselben Durchgang gelegt würde jede neu eintreffende Mail die Ordnerliste um diese
   * Zeit verzögern; so bleibt sie bei ihren rund 120 ms und die Zähler kommen nach.
   *
   * Anbieter ohne Gmails Suchsprache antworten mit einer leeren Liste - die Zeilen
   * erscheinen dann gar nicht.
   */
  /**
   * Wie viel aussteht. Ohne diesen Zaehler bliebe eine geplante Nachricht unsichtbar,
   * bis sie von selbst hinausgeht - und eine zurueckgestellte, bis sie zurueckkommt.
   * Beides sind lokale Abfragen, sie kosten nichts.
   */
  useEffect(() => {
    if (!selectedAccountId) {
      setWartendAnzahl(0);
      return;
    }
    let abgebrochen = false;
    void Promise.all([
      api.fetchPendingSends(selectedAccountId),
      api.fetchSnoozed(selectedAccountId),
    ])
      .then(([s, w]) => {
        if (!abgebrochen) setWartendAnzahl(s.length + w.length);
      })
      .catch(() => {
        if (!abgebrochen) setWartendAnzahl(0);
      });
    return () => {
      abgebrochen = true;
    };
  }, [selectedAccountId, folderReload, wartendFor, geplant]);

  useEffect(() => {
    if (!selectedAccountId) {
      setFaehigkeiten({ gmailSearch: false });
      return;
    }
    let abgebrochen = false;
    api
      .fetchCapabilities(selectedAccountId)
      .then((f) => {
        if (!abgebrochen) setFaehigkeiten(f);
      })
      .catch(() => {
        // Im Zweifel nichts anbieten, was vielleicht nicht geht.
        if (!abgebrochen) setFaehigkeiten({ gmailSearch: false });
      });
    return () => {
      abgebrochen = true;
    };
  }, [selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) {
      setCategories([]);
      return;
    }
    let abgebrochen = false;
    // Sofort leeren: sonst blieben beim Kontowechsel kurz die Zeilen des vorigen Kontos
    // stehen, und deren Zähler gehörten zu einem anderen Postfach.
    setCategories([]);

    api
      .fetchCategories(selectedAccountId)
      .then((liste) => {
        if (!abgebrochen) setCategories(liste);
      })
      .catch(() => {
        // Kein Fehlerhinweis: die Einordnung ist eine Zugabe, ihr Fehlen macht das
        // Postfach nicht unbenutzbar.
        if (!abgebrochen) setCategories([]);
      });

    return () => {
      abgebrochen = true;
    };
  }, [selectedAccountId, folderReload]);

  /**
   * Lädt die Ordner aller Konten. Nacheinander statt parallel: die Anbieter reagieren
   * empfindlich auf Verbindungssalven, und dank der wiederverwendeten Verbindungen
   * kostet ein Durchlauf nur noch etwa 120 ms pro Konto.
   */
  useEffect(() => {
    if (accounts.length === 0) {
      setFoldersByAccount({});
      return;
    }
    let abgebrochen = false;
    setLoadingFolders(true);

    (async () => {
      for (const account of accounts) {
        try {
          const ordner = await api.fetchFolders(account.id);
          if (abgebrochen) return;
          setFoldersByAccount((prev) => ({ ...prev, [account.id]: ordner }));

          if (account.id === selectedAccountId) {
            // Beim reinen Aktualisieren der Zähler die bestehende Auswahl behalten.
            setSelectedFolder((current) => {
              if (current && ordner.some((box) => box.path === current)) return current;
              const inbox = ordner.find(
                (box) => box.specialUse === '\\Inbox' || box.name.toUpperCase() === 'INBOX',
              );
              return inbox?.path ?? ordner[0]?.path ?? null;
            });
          }
        } catch (err) {
          if (!abgebrochen) setError((err as Error).message);
        }
      }
      if (!abgebrochen) setLoadingFolders(false);
    })();

    return () => {
      abgebrochen = true;
    };
    // accounts.length statt accounts: die Kennungen ändern sich nur beim Hinzufügen
    // oder Entfernen, nicht bei jeder Zustandsänderung.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length, selectedAccountId, folderReload]);

  const folders = selectedAccountId ? foldersByAccount[selectedAccountId] ?? [] : [];

  /** Kennung der aktuellen Ansicht - bindet die Nachrichtenauswahl an Konto und Ordner. */
  /**
   * Wozu die gemerkte Auswahl gehört. Passt der Schlüssel nicht mehr, gilt sie nicht -
   * eine UID gilt nur innerhalb ihres Ordners.
   *
   * Die Gesamtliste braucht einen eigenen Schlüssel, und zwar ohne Konto und Ordner:
   * dort wechselt beides von Zeile zu Zeile, die Auswahl gehört aber weiterhin zur
   * Gesamtliste. Ohne diesen Zweig trug eine dort gewählte Nachricht den Schlüssel des
   * zuletzt in der Seitenleiste angeklickten Kontos - und beim Wechsel in dessen
   * Posteingang wurde eine Gmail-Nummer bei GMX gesucht ("Nachricht 32273 nicht
   * gefunden in INBOX").
   */
  const viewKey = gesamtAnsicht
    ? 'ALLE-POSTEINGAENGE'
    : `${selectedAccountId ?? ''}|${selectedFolder ?? ''}|${selectedCategory ?? ''}`;
  const selectedUid = selection && selection.view === viewKey ? selection.uid : null;
  const setSelectedUid = (uid: number) => setSelection({ view: viewKey, uid });

  // Auswahl nur beim echten Wechsel von Konto/Ordner zurücksetzen - nicht beim
  // automatischen Neuladen, sonst würde eine offene Mail bei neuer Post zuklappen.
  useEffect(() => {
    setSelection(null);
    setSelectedMessage(null);
    // UIDs gelten nur innerhalb eines Ordners - eine mitgeschleppte Auswahl würde sich
    // nach dem Wechsel auf völlig andere Nachrichten beziehen.
    setCheckedUids(new Set());
    setMessages([]);
    setCursor(null);
    setHasMore(false);
    setTotalMessages(0);
    setSuche(null);
    setSearchFolder(null);
    // Auch beim Verlassen der Gesamtliste: hatte die Seitenleiste denselben Ordner schon
    // stehen, aendert sich sonst kein einziger der anderen Werte, und die Zeilen aus
    // allen Konten blieben stehen. Beim Wechsel in einen GMX-Posteingang mit 17
    // Nachrichten standen so 40 Zeilen da - die Gmail-Post der Gesamtliste war noch dabei.
    //
    // Und beim Umschalten der Datumsrichtung: die neue Seite wird sonst in die alte
    // Liste eingefuegt statt sie zu ersetzen, und weil das Zusammenfuehren nach Datum
    // absteigend ordnet, stuenden weiter die neuesten oben. "Aelteste zuerst" aenderte
    // dann sichtbar gar nichts.
  }, [
    gesamtAnsicht,
    selectedAccountId,
    selectedFolder,
    selectedCategory,
    sortierung.schluessel === 'datum' ? sortierung.richtung : 'egal',
  ]);

  /**
   * Der Posteingang aller Konten. Eigener Effekt, weil er weder Ordner noch Kategorie
   * kennt - er fragt eine einzige Adresse, die den Rest zusammensetzt.
   */
  useEffect(() => {
    if (!gesamtAnsicht) return;
    setLoadingMessages(true);
    api
      .ladeGesamtPosteingang(null)
      .then((seite) => {
        setMessages(seite.messages);
        setTotalMessages(seite.total);
        setGesamtCursor(seite.nextCursor);
        setHasMore(seite.hasMore);
        setGesamtFehlende(seite.fehlende);
        setOhneVerbindung(false);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingMessages(false));
  }, [gesamtAnsicht, accounts.length, reloadCounter]);

  useEffect(() => {
    if (gesamtAnsicht) return;
    if (!selectedAccountId || !selectedFolder) {
      setMessages([]);
      return;
    }
    // Steht eine gemerkte Suche an, waere der Ordnerinhalt gleich wieder ueberschrieben -
    // und welche der beiden Antworten zuletzt eintraefe, waere Zufall.
    if (offeneSuche) return;
    setLoadingMessages(true);
    api
      .fetchMessages(
        selectedAccountId,
        selectedFolder,
        undefined,
        selectedCategory,
        sortierung.schluessel === 'datum' && sortierung.richtung === 'auf',
      )
      .then((res) => {
        setTotalMessages(res.total);
        setCursor(res.nextCursor);
        setHasMore(res.hasMore);
        // Kommt die Liste aus der Ablage, wird das gesagt - ein stiller alter Stand
        // wäre schlimmer als gar keiner.
        setOhneVerbindung(Boolean(res.ausAblage));
        // Zusammenführen statt ersetzen: bereits nachgeladene ältere Seiten bleiben
        // erhalten, wenn oben eine neue Nachricht eintrifft.
        setMessages((prev) => mergeMessages(prev, res.messages, aeltesteZuerst));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingMessages(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    gesamtAnsicht,
    selectedAccountId,
    selectedFolder,
    selectedCategory,
    reloadCounter,
    offeneSuche,
    // Die Datumsrichtung entscheidet, von welchem Ende der Server blaettert - dafuer
    // muss neu geladen werden. Bei Absender und Betreff nicht: dort wird nur das
    // Geladene umsortiert, und ein Neuladen wuerde nur warten lassen.
    sortierung.schluessel === 'datum' ? sortierung.richtung : 'egal',
  ]);

  /**
   * Lädt die nächste, ältere Seite. Bei aktiver Suche wird innerhalb der Trefferliste
   * weitergeblättert, sonst innerhalb des Ordners.
   */
  const loadMore = async () => {
    if (gesamtAnsicht) {
      if (loadingMore || !gesamtCursor) return;
      setLoadingMore(true);
      try {
        const seite = await api.ladeGesamtPosteingang(gesamtCursor);
        setMessages((prev) => [...prev, ...seite.messages]);
        setGesamtCursor(seite.nextCursor);
        setHasMore(seite.hasMore);
        setGesamtFehlende(seite.fehlende);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoadingMore(false);
      }
      return;
    }
    if (!selectedAccountId || loadingMore || cursor === null) return;
    const ordner = suche ? searchFolder : selectedFolder;
    if (!ordner) return;

    setLoadingMore(true);
    try {
      const res = suche
        ? await api.searchMessages(selectedAccountId, ordner, suche, {
            beforeUid: cursor,
            category: selectedCategory,
          })
        : await api.fetchMessages(
            selectedAccountId,
            ordner,
            cursor,
            selectedCategory,
            sortierung.schluessel === 'datum' && sortierung.richtung === 'auf',
          );
      setTotalMessages(res.total);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
      setMessages((prev) => mergeMessages(prev, res.messages, aeltesteZuerst));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  useMailEvents((event) => {
    // Fortschrittsmeldungen gehen die Hauptansicht nichts an - sie zeigen die Fenster,
    // die den jeweiligen Vorgang angestoßen haben.
    if (event.type === 'fortschritt') return;

    const isVisible = event.accountId === selectedAccountId && event.folder === selectedFolder;

    if (event.type === 'data-updated') {
      // Der Server hat im Hintergrund nachgesehen und etwas Neueres gefunden als das,
      // was aus dem Zwischenspeicher kam. Nur das betroffene Stück nachladen - der Abruf
      // trifft jetzt auf den frischen Stand und kostet nichts mehr.
      if (event.accountId !== selectedAccountId) return;
      if (event.was === 'messages') {
        const gleicheAnsicht =
          event.folder === selectedFolder && (event.category ?? null) === selectedCategory;
        // Nicht während einer Suche: sonst würde die Trefferliste ohne Zutun durch den
        // gewöhnlichen Ordnerinhalt ersetzt.
        if (gleicheAnsicht && !suche) setReloadCounter((n) => n + 1);
      } else {
        setFolderReload((n) => n + 1);
      }
      return;
    }

    if (event.type === 'new-mail') {
      if (isVisible) {
        setReloadCounter((n) => n + 1);
      } else {
        setAccountsWithNewMail((prev) => new Set(prev).add(event.accountId));
      }
    } else if (event.type === 'flags-changed' && isVisible) {
      if (event.uid !== undefined) {
        // Punktgenau aktualisieren - kein Neuladen, also kein Springen der Liste.
        const { uid, seen } = event;
        setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen } : m)));
        setSelectedMessage((prev) => (prev && prev.uid === uid ? { ...prev, seen } : prev));
      } else {
        setReloadCounter((n) => n + 1);
      }
    } else if (event.type === 'messages-removed' && isVisible) {
      setReloadCounter((n) => n + 1);
    }

    // Ungelesen-Zähler des Ordners aktualisieren, auch wenn er nicht angezeigt wird.
    if (event.accountId === selectedAccountId) {
      setFolderReload((n) => n + 1);
    }
  });

  // Markierung entfernen, sobald das betroffene Konto angesehen wird.
  useEffect(() => {
    if (!selectedAccountId) return;
    setAccountsWithNewMail((prev) => {
      if (!prev.has(selectedAccountId)) return prev;
      const next = new Set(prev);
      next.delete(selectedAccountId);
      return next;
    });
  }, [selectedAccountId, selectedFolder]);

  useEffect(() => {
    if (!arbeitsKonto || !arbeitsOrdner || selectedUid === null) {
      setSelectedMessage(null);
      return;
    }
    setLoadingMessage(true);
    api
      .fetchMessage(arbeitsKonto, arbeitsOrdner, selectedUid)
      .then((full) => {
        setSelectedMessage(full);
        // Abrufen allein ändert den Status nicht (IMAP-Abruf erfolgt mit PEEK), das
        // Als-gelesen-Markieren passiert also bewusst hier.
        if (!full.seen) void applySeen([full.uid], true);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingMessage(false));
    // applySeen hängt an denselben Werten und wird bewusst nicht als Abhängigkeit geführt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arbeitsKonto, arbeitsOrdner, selectedUid]);

  /**
   * Nimmt entgegen, worauf in einer Benachrichtigung geklickt wurde.
   *
   * Die Desktop-Hülle löst dafür ein gewöhnliches Browser-Ereignis im Fenster aus - so
   * bleibt die Oberfläche eine normale Webanwendung ohne Sonderrechte, und im Browser
   * betrieben passiert schlicht nichts.
   */
  useEffect(() => {
    const bearbeite = (e: Event) =>
      setZuOeffnen(
        (e as CustomEvent<{ accountId: string; folder: string; uid: number }>).detail,
      );
    window.addEventListener('energy-mail:oeffne', bearbeite);
    return () => window.removeEventListener('energy-mail:oeffne', bearbeite);
  }, []);

  /**
   * Stellt Konto, Ordner und Auswahl nacheinander um.
   *
   * Nicht in einem Zug: der Wechsel des Kontos verwirft die Ordnerwahl, der Wechsel des
   * Ordners die Nachrichtenauswahl - beides zu Recht, aber eine sofort gesetzte Auswahl
   * wäre damit gleich wieder weg. Jeder Durchlauf erledigt deshalb einen Schritt und
   * wartet, bis er angekommen ist.
   */
  useEffect(() => {
    if (!zuOeffnen) return;
    if (selectedAccountId !== zuOeffnen.accountId) {
      setSelectedAccountId(zuOeffnen.accountId);
      return;
    }
    if (selectedFolder !== zuOeffnen.folder) {
      setSelectedFolder(zuOeffnen.folder);
      setSelectedCategory(null);
      return;
    }
    setSelection({ view: viewKey, uid: zuOeffnen.uid });
    setZuOeffnen(null);
  }, [zuOeffnen, selectedAccountId, selectedFolder, viewKey]);

  /**
   * Lädt die nächste Nachricht der Liste im Hintergrund, während die aktuelle gelesen
   * wird.
   *
   * Der Server hält geöffnete Nachrichten vor; ein Abruf hier bedeutet also, dass der
   * nächste Klick sofort etwas anzuzeigen hat statt der üblichen halben Sekunde. Nur die
   * unmittelbar folgende - beim Lesen geht man der Reihe nach vor, und jede weitere wäre
   * geraten und würde den Anbieter unnötig belasten.
   */
  useEffect(() => {
    if (!selectedAccountId || !selectedFolder || selectedUid === null) return;
    const stelle = messages.findIndex((m) => m.uid === selectedUid);
    const naechste = stelle >= 0 ? messages[stelle + 1] : undefined;
    if (!naechste) return;

    const abbruch = new AbortController();
    // Kurz warten: wer schnell durchklickt, soll nicht für jede übersprungene Nachricht
    // einen Abruf auslösen.
    const timer = setTimeout(() => {
      void api.prefetchMessage(arbeitsKonto!, arbeitsOrdner!, naechste.uid, abbruch.signal);
    }, 400);

    return () => {
      clearTimeout(timer);
      abbruch.abort();
    };
  }, [selectedAccountId, selectedFolder, selectedUid, messages]);

  /**
   * Setzt den Gelesen-Status. Die Anzeige wird sofort umgestellt und bei einem Fehler
   * zurückgenommen, damit sich das Anklicken nicht verzögert anfühlt.
   */
  const applySeen = async (uids: number[], seen: boolean) => {
    if (!arbeitsKonto || !arbeitsOrdner || uids.length === 0) return;
    const affected = new Set(uids);

    const setLocalSeen = (value: boolean) => {
      setMessages((prev) => prev.map((m) => (affected.has(m.uid) ? { ...m, seen: value } : m)));
      setSelectedMessage((prev) => (prev && affected.has(prev.uid) ? { ...prev, seen: value } : prev));
    };

    setLocalSeen(seen);
    try {
      await api.setMessagesSeen(arbeitsKonto, arbeitsOrdner, uids, seen);
      setFolderReload((n) => n + 1);
    } catch (err) {
      setLocalSeen(!seen);
      setError((err as Error).message);
    }
  };

  /**
   * Hängt ein Etikett an eine Nachricht oder nimmt es ab.
   *
   * Wie beim Gelesen-Status wird die Anzeige sofort umgestellt und bei einem Fehler
   * zurückgenommen. Zusätzlich wird beim ersten Mal gefragt, ob der Ordner Etiketten
   * überhaupt behält: ein Server, der es nicht tut, nimmt den Befehl trotzdem an und
   * vergisst ihn beim Schließen - ohne die Rückfrage wäre das eine stille Enttäuschung.
   */
  const setzeEtikett = async (uid: number, schluessel: string, an: boolean) => {
    if (!arbeitsKonto || !arbeitsOrdner) return;

    const aendere = (flags: string[]): string[] => {
      const ohne = flags.filter((f) => f.toLowerCase() !== schluessel.toLowerCase());
      return an ? [...ohne, schluessel] : ohne;
    };
    const setzeOertlich = (setzen: boolean) => {
      const wandeln = (flags: string[]) =>
        setzen ? aendere(flags) : flags.filter((f) => f.toLowerCase() !== schluessel.toLowerCase());
      setMessages((prev) =>
        prev.map((m) => (m.uid === uid ? { ...m, flags: wandeln(m.flags) } : m)),
      );
      setSelectedMessage((prev) =>
        prev && prev.uid === uid ? { ...prev, flags: wandeln(prev.flags) } : prev,
      );
    };

    const vorher = messages.find((m) => m.uid === uid)?.flags ?? selectedMessage?.flags ?? [];
    setzeOertlich(an);

    try {
      const ergebnis = await api.setzeEtiketten(
        arbeitsKonto,
        arbeitsOrdner,
        [uid],
        an ? [schluessel] : [],
        an ? [] : [schluessel],
      );
      setEtikettenDauerhaft(ergebnis.dauerhaft);
      if (!ergebnis.dauerhaft) {
        meldeWarnung(
          'Dieser Ordner behält keine Etiketten',
          'Der Server hat den Befehl angenommen, vergisst das Etikett aber beim Schließen des Ordners wieder.',
        );
      }
    } catch (err) {
      // Genau zurücksetzen, nicht nur umkehren: die Nachricht kann das Etikett schon
      // vorher getragen haben.
      setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, flags: vorher } : m)));
      setSelectedMessage((prev) => (prev && prev.uid === uid ? { ...prev, flags: vorher } : prev));
      meldeFehler('Etikett nicht gesetzt', (err as Error).message);
    }
  };

  /**
   * Fuehrt eine gemerkte Suche aus, sobald ihr Ordner offen ist. Nach dem Ladeeffekt
   * angemeldet, damit er in derselben Runde vor diesem laeuft und nicht danach.
   */
  useEffect(() => {
    if (!offeneSuche || !selectedAccountId || !selectedFolder) return;
    if (offeneSuche.folder && offeneSuche.folder !== selectedFolder) return;

    const { eingabe } = offeneSuche;
    setOffeneSuche(null);
    setSucheVorgabe(eingabe);
    void handleSearch(eingabe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offeneSuche, selectedAccountId, selectedFolder]);

  /**
   * Merkt sich die laufende Suche unter einem Namen.
   *
   * Ordner und Konto kommen mit: "Rechnungen im Archiv" ist etwas anderes als
   * "Rechnungen im Posteingang", und ohne die Angabe liefe die Suche später dort, wo man
   * gerade zufällig steht.
   */
  const merkeSuche = async (eingabe: SucheEingabe) => {
    const name = await frage({
      titel: 'Diese Suche merken',
      text: beschreibeSuche({ ...eingabe, etikett: eingabe.etikett || undefined }, etiketten),
      vorgabe: eingabe.text || eingabe.from || eingabe.subject || '',
      ok: 'Merken',
    });
    if (!name) return;

    try {
      const gemerkt = await api.speichereSuche({
        name,
        accountId: selectedAccountId ?? undefined,
        folder: eingabe.bereich === 'ordner' ? (selectedFolder ?? undefined) : undefined,
        kriterien: {
          text: eingabe.text || undefined,
          from: eingabe.from || undefined,
          subject: eingabe.subject || undefined,
          since: eingabe.since || undefined,
          before: eingabe.before || undefined,
          unreadOnly: eingabe.unreadOnly || undefined,
          withAttachment: eingabe.withAttachment || undefined,
          etikett: eingabe.etikett || undefined,
        },
      });
      setSuchen((prev) => [...prev, gemerkt]);
      meldeErfolg(`„${gemerkt.name}“ gemerkt`, 'Steht jetzt unten in der Seitenleiste.');
    } catch (err) {
      meldeFehler('Suche nicht gemerkt', (err as Error).message);
    }
  };

  /** Führt eine gemerkte Suche aus - im hinterlegten Konto und Ordner, wenn angegeben. */
  const fuehreSucheAus = (gemerkt: api.GespeicherteSuche) => {
    if (gemerkt.accountId && gemerkt.accountId !== selectedAccountId) {
      setSelectedAccountId(gemerkt.accountId);
    }
    if (gemerkt.folder) setSelectedFolder(gemerkt.folder);

    const eingabe: SucheEingabe = {
      text: gemerkt.kriterien.text ?? '',
      from: gemerkt.kriterien.from ?? '',
      subject: gemerkt.kriterien.subject ?? '',
      since: gemerkt.kriterien.since ?? '',
      before: gemerkt.kriterien.before ?? '',
      unreadOnly: gemerkt.kriterien.unreadOnly ?? false,
      withAttachment: gemerkt.kriterien.withAttachment ?? false,
      etikett: gemerkt.kriterien.etikett ?? '',
      bereich: gemerkt.folder ? 'ordner' : 'konto',
    };
    // Nicht sofort suchen: erst muss der Ordnerwechsel durch sein.
    setOffeneSuche({ eingabe, folder: gemerkt.folder });
  };

  const vergissSuche = async (gemerkt: api.GespeicherteSuche) => {
    const ja = await bestaetige({
      titel: `Suche „${gemerkt.name}“ vergessen?`,
      text: 'Nur die gemerkte Suche verschwindet – an Ihren Nachrichten ändert sich nichts.',
      ok: 'Vergessen',
    });
    if (!ja) return;
    await api.loescheSuche(gemerkt.id);
    setSuchen((prev) => prev.filter((s) => s.id !== gemerkt.id));
  };

  /**
   * Verschiebt Nachrichten, die auf einen Ordner gezogen wurden.
   *
   * Konto und Ordner kommen aus der Fracht, nicht aus der Ansicht: gezogen werden kann
   * auch aus einer Trefferliste, in der jede Zeile woanders liegt.
   */
  const verschiebeGezogene = async (fracht: Fracht, ziel: FolderInfo) => {
    const betroffen = new Set(fracht.uids);
    // Sofort aus der Liste nehmen - sonst steht die Nachricht noch da, wo sie nicht
    // mehr ist, und ein Klick liefe ins Leere.
    setMessages((prev) => prev.filter((m) => !betroffen.has(m.uid)));
    setCheckedUids((prev) => new Set([...prev].filter((uid) => !betroffen.has(uid))));
    setSelection((aktuell) => (aktuell && betroffen.has(aktuell.uid) ? null : aktuell));

    try {
      await api.moveMessages(fracht.accountId, fracht.ordner, fracht.uids, ziel.path);
      setFolderReload((n) => n + 1);
      meldeErfolg(
        fracht.uids.length === 1
          ? `Nach „${ziel.name}“ verschoben`
          : `${fracht.uids.length} Nachrichten nach „${ziel.name}“ verschoben`,
      );
    } catch (err) {
      // Zurueckholen, was gar nicht weg ist.
      setReloadCounter((n) => n + 1);
      meldeFehler('Verschieben nicht möglich', (err as Error).message);
    }
  };

  const handleAddAccount = async (
    email: string,
    password: string,
    overrides?: api.Serverangaben,
  ) => {
    const account = await api.createAccount(email, password, overrides);
    setAccounts((prev) => [...prev, account]);
    setSelectedAccountId(account.id);
  };

  /**
   * Führt einen Anmeldevorgang zu Ende. Die Anmeldeseite läuft im Systembrowser -
   * eingebettete Fenster weisen beide Anbieter ab. Der Server nimmt die Rückleitung auf
   * einem lokalen Port entgegen; hier wird nur der Fortschritt abgefragt.
   *
   * Gemeinsam für das Hinzufügen eines Kontos und die Neuanmeldung eines bestehenden -
   * der Ablauf ist derselbe, nur der Startaufruf und das Ergebnis unterscheiden sich.
   */
  const durchlaufeAnmeldung = async (
    starten: () => Promise<{ state: string; authUrl: string }>,
  ): Promise<api.Account> => {
    const { state, authUrl } = await starten();
    window.open(authUrl, '_blank');

    const frist = Date.now() + 5 * 60 * 1000;
    while (Date.now() < frist) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await api.pollOAuth(state);
      if (status.status === 'done') return status.account;
      if (status.status === 'error') throw new Error(status.error);
    }
    throw new Error('Zeitüberschreitung – die Anmeldung wurde nicht abgeschlossen.');
  };

  const handleOAuthLogin = async (provider: api.OAuthProvider) => {
    setOauthBusy(provider);
    setError(null);
    try {
      const account = await durchlaufeAnmeldung(() => api.startOAuth(provider));
      setAccounts((prev) => [...prev, account]);
      setSelectedAccountId(account.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setOauthBusy(null);
    }
  };

  /**
   * Meldet ein bestehendes Konto neu an, wenn der Anbieter die gespeicherte Anmeldung
   * nicht mehr anerkennt. Das Konto selbst bleibt bestehen, deshalb wird es ersetzt und
   * nicht angehängt - Anzeigename und Signatur überstehen den Vorgang.
   */
  const handleReauth = async (accountId: string) => {
    setReauthBusy(accountId);
    setError(null);
    try {
      const account = await durchlaufeAnmeldung(() => api.startReauth(accountId));
      setAccounts((prev) => prev.map((a) => (a.id === account.id ? account : a)));
      // Ordner und Nachrichten waren wegen der abgelehnten Anmeldung leer geblieben.
      setFolderReload((n) => n + 1);
      setReloadCounter((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReauthBusy(null);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    try {
      await api.deleteAccount(id);
      const remaining = accounts.filter((a) => a.id !== id);
      setAccounts(remaining);
      if (selectedAccountId === id) {
        setSelectedAccountId(remaining[0]?.id ?? null);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const trashFolder = folders.find((folder) => folder.specialUse === '\\Trash');
  const isInTrash = Boolean(trashFolder) && selectedFolder === trashFolder?.path;

  /** Entfernt Nachrichten lokal aus Liste und Auswahl und aktualisiert die Ordnerzähler. */
  const removeFromView = (uids: number[]) => {
    const removed = new Set(uids);
    setMessages((prev) => prev.filter((m) => !removed.has(m.uid)));
    setSelection((current) => (current && removed.has(current.uid) ? null : current));
    setSelectedMessage((prev) => (prev && removed.has(prev.uid) ? null : prev));
    setCheckedUids((prev) => {
      const next = new Set(prev);
      for (const uid of uids) next.delete(uid);
      return next;
    });
    setFolderReload((n) => n + 1);
  };

  const handleMove = async (uids: number[], targetFolder: string) => {
    if (!selectedAccountId || !selectedFolder || uids.length === 0) return;
    setBulkBusy(true);
    try {
      await api.moveMessages(arbeitsKonto!, arbeitsOrdner!, uids, targetFolder);
      removeFromView(uids);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  /**
   * Ohne Papierkorb-Ordner (oder wenn die Nachrichten schon darin liegen) bleibt nur das
   * endgültige Löschen - und das wird immer bestätigt, weil es nicht umkehrbar ist.
   */
  const handleDelete = async (uids: number[]) => {
    if (!selectedAccountId || !selectedFolder || uids.length === 0) return;
    const permanent = isInTrash || !trashFolder;

    if (permanent) {
      const reason = trashFolder
        ? uids.length === 1
          ? 'Diese Nachricht liegt bereits im Papierkorb.'
          : 'Diese Nachrichten liegen bereits im Papierkorb.'
        : 'Für dieses Konto gibt es keinen Papierkorb-Ordner.';
      const what = uids.length === 1 ? 'Nachricht' : `${uids.length} Nachrichten`;
      const ja = await bestaetige({
        titel: `${what} endgültig löschen?`,
        text: `${reason}\n\nDas lässt sich nicht rückgängig machen.`,
        stil: 'gefahr',
        ok: 'Endgültig löschen',
      });
      if (!ja) return;
    }

    setBulkBusy(true);
    const vonKonto = arbeitsKonto!;
    const vonOrdner = arbeitsOrdner!;
    try {
      let imPapierkorb: number[] = [];
      if (permanent) {
        await api.deleteMessages(vonKonto, vonOrdner, uids);
      } else {
        const { neueUids } = await api.moveMessages(vonKonto, vonOrdner, uids, trashFolder!.path);
        imPapierkorb = neueUids;
      }
      removeFromView(uids);

      /*
       * Gesagt haben, dass etwas weg ist - und einen Weg zurück lassen.
       *
       * Vorher geschah das Löschen stumm: ein Druck auf Entf, die Nachricht war im
       * Papierkorb, und nichts wies darauf hin. Beim Senden gibt es acht Sekunden
       * Bedenkzeit; beim Löschen gab es nichts. Endgültiges Löschen wird weiterhin
       * vorher bestätigt - da hilft ein Weg zurück nicht mehr.
       */
      if (!permanent) {
        const was = uids.length === 1 ? 'Nachricht' : `${uids.length} Nachrichten`;
        /*
         * Zurückgeholt wird mit den Nummern im Papierkorb, nicht mit denen von vorher.
         * Beim Verschieben vergibt der Server neue; mit den alten griffe man dort nach
         * irgendetwas anderem. Nennt der Server keine (kein UIDPLUS), gibt es auch
         * keinen Rückweg - dann bleibt es bei der schlichten Meldung.
         */
        if (imPapierkorb.length === uids.length) {
          meldeMitRueckweg(`${was} in den Papierkorb`, undefined, {
            text: 'Rückgängig',
            tu: () => {
              void api
                .moveMessages(vonKonto, trashFolder!.path, imPapierkorb, vonOrdner)
                .then(() => {
                  setFolderReload((n) => n + 1);
                  setReloadCounter((n) => n + 1);
                })
                .catch((err) => meldeFehler('Zurückholen misslungen', (err as Error).message));
            },
          });
        } else {
          meldeErfolg(`${was} in den Papierkorb`);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const allMailFolder = folders.find((folder) => folder.isAllMail);

  // Überschrift der Nachrichtenliste - mit dem vereinheitlichten Namen der Seitenleiste.
  /**
   * Die Liste, wie sie angezeigt wird.
   *
   * Nach Datum sortiert schon der Server, indem er vom anderen Ende blättert - dann ist
   * hier nichts zu tun, und die Sortierung gilt für den ganzen Ordner. Nach Absender
   * oder Betreff wird hier sortiert, und zwar nur über das Geladene; die Liste sagt das
   * auch.
   */
  /** Ob vom aelteren Ende her geblaettert wird - haengt allein an der Datumsrichtung. */
  const aeltesteZuerst = sortierung.schluessel === 'datum' && sortierung.richtung === 'auf';

  const angezeigteNachrichten = useMemo(
    () => (sortierung.schluessel === 'datum' ? messages : sortiere(messages, sortierung)),
    [messages, sortierung],
  );

  const aktuellerOrdnerName = (() => {
    // Bei aktiver Einordnung deren Name: dieselbe Beschriftung wie die hervorgehobene
    // Zeile in der Seitenleiste.
    if (selectedCategory) return categoryLabel(selectedCategory);
    if (!selectedFolder) return 'Nachrichten';
    const ansicht = buildFolderView(folders);
    const treffer = [...ansicht.sonder, ...ansicht.weitere].find(
      (e) => e.folder.path === selectedFolder,
    );
    return treffer?.label ?? selectedFolder;
  })();

  /**
   * Ordnerverwaltung. Alles nach demselben Muster: ausführen, Ordnerliste neu laden,
   * Fehler als Meldung zeigen. Die Rückfragen stellt die Seitenleiste - dort ist
   * bekannt, um welchen Ordner es geht.
   */
  const ordnerAktion = async (was: string, tun: () => Promise<unknown>) => {
    try {
      await tun();
      setFolderReload((n) => n + 1);
    } catch (err) {
      setError(`${was} fehlgeschlagen: ${(err as Error).message}`);
    }
  };

  const ordnerAktionen = {
    anlegen: (accountId: string, pfad: string) =>
      void ordnerAktion('Ordner anlegen', () => api.createFolder(accountId, pfad)),

    umbenennen: (accountId: string, folder: FolderInfo, neuerPfad: string) =>
      void ordnerAktion('Umbenennen', async () => {
        await api.renameFolder(accountId, folder.path, neuerPfad);
        // Der angezeigte Ordner heißt jetzt anders - sonst zeigte die Liste ins Leere.
        if (selectedFolder === folder.path) waehleOrdner(neuerPfad);
      }),

    loeschen: (accountId: string, folder: FolderInfo) =>
      void ordnerAktion('Löschen', async () => {
        await api.deleteFolder(accountId, folder.path);
        if (selectedFolder === folder.path) setSelectedFolder(null);
      }),

    leeren: (accountId: string, folder: FolderInfo) =>
      void ordnerAktion('Leeren', async () => {
        await api.emptyFolder(accountId, folder.path);
        if (selectedFolder === folder.path) setReloadCounter((n) => n + 1);
      }),

    alleGelesen: (accountId: string, folder: FolderInfo) =>
      void ordnerAktion('Als gelesen markieren', async () => {
        await api.markFolderRead(accountId, folder.path);
        if (selectedFolder === folder.path) setReloadCounter((n) => n + 1);
      }),

    /**
     * Sichert einen Ordner als mbox-Datei.
     *
     * Der Browser lädt die Adresse selbst herunter, statt dass die Anwendung die Datei
     * durch den Arbeitsspeicher schleust - bei einem großen Ordner wären das Gigabyte.
     * Er schreibt mit, während der Server noch holt.
     */
    sichern: (accountId: string, folder: FolderInfo) => {
      void bestaetige({
        titel: `"${folder.name}" sichern?`,
        text:
          'Alle Nachrichten des Ordners werden vom Anbieter geholt und als mbox-Datei ' +
          'gespeichert - das Format, das Thunderbird, Apple Mail und die üblichen ' +
          'Umstellungswerkzeuge lesen. Bei großen Ordnern dauert das einige Minuten.',
        ok: 'Sichern',
      }).then((ja) => {
        if (!ja) return;
        setSicherungLaeuft({ accountId, ordner: folder.name });
        window.location.href = api.sicherungsAdresse(accountId, folder.path);
      });
    },
  };

  /** Ordnerwechsel hebt eine aktive Einordnung auf - sie gilt nur für den Posteingang. */
  const waehleOrdner = (path: string) => {
    setGesamtAnsicht(false);
    setGesamtHerkunft(null);
    /*
     * Auf den Ordner zu klicken, in dem man schon steht, laedt neu.
     *
     * Vorher geschah dann nichts, weil sich der Zustand nicht aenderte. Nach einer
     * Stoerung sass man damit vor einer leeren Liste: der erste Reflex - nochmal auf
     * "Posteingang" - half nicht, nur der Umweg ueber einen anderen Ordner und zurueck.
     */
    if (path === selectedFolder && !gesamtAnsicht) setReloadCounter((n) => n + 1);
    setSelectedFolder(path);
    setSelectedCategory(null);
  };

  /** Schaltet auf den Posteingang aller Konten um. */
  const waehleGesamt = () => {
    setGesamtAnsicht(true);
    setGesamtHerkunft(null);
    setSelection(null);
    setSelectedMessage(null);
    setCheckedUids(new Set());
    setSuche(null);
    setMessages([]);
    setGesamtCursor(null);
  };

  const waehleKategorie = (path: string, category: GmailCategory) => {
    setGesamtAnsicht(false);
    setGesamtHerkunft(null);
    setSelectedFolder(path);
    setSelectedCategory(category);
  };

  // Ziel für "Archivieren": eigener Archivordner, sonst Gmails "Alle Nachrichten",
  // sonst nichts - dann entfällt der Knopf.
  const archivZiel = archiveTarget(folders, selectedFolder);

  /**
   * Nimmt eine Nachricht aus dem Posteingang und legt sie später wieder vor.
   *
   * Dieselben Vorschläge wie beim späteren Senden, aus demselben Grund: es geht um
   * "nachher", nicht um einen bestimmten Zeitstempel.
   */
  const handleSnooze = async (uid: number) => {
    if (!selectedAccountId || !selectedFolder) return;

    const ziel = await waehleZeitpunkt({
      titel: 'Wann soll die Nachricht wieder auftauchen?',
      text: 'Sie verschwindet bis dahin aus dem Posteingang und liegt zum gewählten Zeitpunkt wieder oben.',
      vorschlaege: wiedervorlageVorschlaege(),
    });
    if (!ziel) return;

    try {
      await api.snoozeMessage(arbeitsKonto!, arbeitsOrdner!, uid, ziel.toISOString());
      removeFromView([uid]);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleArchive = async (uids: number[]) => {
    if (!archivZiel) return;
    await handleMove(uids, archivZiel.path);
  };

  /** Beendet die Suche und lädt den Ordner wieder normal. */
  const handleSearchClear = async () => {
    if (!selectedAccountId || !selectedFolder) return;
    /*
     * Zaehlt mit derselben Nummer wie das Suchen.
     *
     * Sonst gewinnt eine Suche, die schon unterwegs war, gegen das Aufraeumen danach -
     * und der Nutzer steht mit leerem Feld vor Suchergebnissen.
     */
    const meine = ++sucheNummer.current;
    const nochAktuell = () => meine === sucheNummer.current;

    setLoadingMessages(true);
    setCheckedUids(new Set());
    try {
      const res = await api.fetchMessages(
        selectedAccountId,
        selectedFolder,
        undefined,
        selectedCategory,
        sortierung.schluessel === 'datum' && sortierung.richtung === 'auf',
      );
      if (!nochAktuell()) return;
      setMessages(res.messages);
      setTotalMessages(res.total);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
      setSuche(null);
      setSearchFolder(null);
      setLokalerStand(null);
    } catch (err) {
      if (nochAktuell()) setError((err as Error).message);
    } finally {
      if (nochAktuell()) setLoadingMessages(false);
    }
  };

  /**
   * Sucht im gewählten Bereich.
   *
   * Nur die Suche im aktuellen Ordner kann nachladen - dort gibt es eine durchgehende
   * Reihenfolge über die UIDs. Über mehrere Ordner hinweg fehlt die: dort werden die
   * jüngsten Treffer je Ordner zusammengeführt und nach Datum sortiert, weiter blättern
   * wäre nur mit vollständigem Abruf aller Treffer möglich.
   */
  const handleSearch = async (eingabe: SucheEingabe, ohneAblage = false) => {
    if (!selectedAccountId || !selectedFolder) return;
    /*
     * Nur die jüngste Suche darf das Ergebnis setzen.
     *
     * Wer tippt und sofort wieder löscht, schickt in einem Wimpernschlag mehrere
     * Suchen los. Ohne diese Nummer gewann die, die zufällig zuletzt antwortete:
     * gemessen blieb ein leeres Feld mit der Überschrift "Suchergebnisse" und einer
     * einzigen Zeile stehen, wo siebzehn hingehörten.
     */
    const meine = ++sucheNummer.current;
    const nochAktuell = () => meine === sucheNummer.current;

    setLoadingMessages(true);
    setCheckedUids(new Set());
    setSelection(null);
    setLokalerStand(null);
    try {
      /**
       * Erst in der lokalen Ablage nachsehen.
       *
       * Sie antwortet sofort statt in Hunderten von Millisekunden, und was sie findet,
       * steht da, bevor der Server überhaupt geantwortet hätte. Nur bei einer einfachen
       * Textsuche - sobald jemand nach Absender, Anhang oder Zeitraum einschränkt,
       * gehört das dem Server, der diese Felder kennt.
       */
      const nurText =
        !ohneAblage && Boolean(eingabe.text.trim()) && !eingabe.from && !eingabe.subject;
      if (nurText) {
        try {
          const lokal = await api.sucheLokal(
            selectedAccountId,
            eingabe.text,
            eingabe.bereich === 'ordner' ? selectedFolder : undefined,
          );
          if (lokal.treffer.length > 0) {
            if (!nochAktuell()) return;
            setMessages(lokal.treffer);
            setTotalMessages(lokal.treffer.length);
            setCursor(null);
            setHasMore(false);
            setSearchFolder(null);
            setSuche(eingabe);
            setLokalerStand(lokal);
            setLoadingMessages(false);
            return;
          }
        } catch {
          // Die Ablage ist eine Abkürzung, kein Muss - notfalls fragt der Server.
        }
      }

      if (eingabe.bereich === 'ordner') {
        // Eine aktive Einordnung bleibt Bedingung: wer in "Werbung" sucht, will nicht
        // plötzlich Treffer aus dem ganzen Posteingang sehen.
        const res = await api.searchMessages(selectedAccountId, selectedFolder, eingabe, {
          category: selectedCategory,
        });
        if (!nochAktuell()) return;
        setMessages(res.messages);
        setTotalMessages(res.total);
        setCursor(res.nextCursor);
        setHasMore(res.hasMore);
        setSearchFolder(selectedFolder);
      } else {
        const res =
          eingabe.bereich === 'konto'
            ? await api.searchAccount(selectedAccountId, eingabe)
            : await api.searchAll(eingabe);
        if (!nochAktuell()) return;
        setMessages(res.hits);
        setTotalMessages(res.total);
        setCursor(null);
        setHasMore(false);
        setSearchFolder(null);
      }
      if (!nochAktuell()) return;
      setSuche(eingabe);
    } catch (err) {
      if (nochAktuell()) setError((err as Error).message);
    } finally {
      if (nochAktuell()) setLoadingMessages(false);
    }
  };

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const ownEmail = selectedAccount?.email ?? '';

  /** Baut die Angabe, aus welcher Nachricht der Server Anhänge übernehmen soll. */
  const originalAttachments = (message: FullMessage, folder: string) => {
    const withPartId = message.attachments.filter((a) => a.partId);
    if (withPartId.length === 0) return undefined;
    return {
      folder,
      uid: message.uid,
      partIds: withPartId.map((a) => a.partId!),
      filenames: withPartId.map((a) => a.filename ?? 'Anhang'),
    };
  };

  const oeffneVerfassen = (titel: string, entwurf: Partial<api.Draft>, ort?: DraftLocation) => {
    setComposeTitle(titel);
    setDraftLocation(ort);
    setComposeInitial(entwurf);
  };

  const handleCompose = () => {
    oeffneVerfassen('Neue Nachricht', { html: withSignature('', selectedAccount?.signature) });
  };

  /**
   * Ein Klick auf eine mailto:-Adresse im Browser oder im Explorer.
   *
   * Windows startet die Anwendung damit (oder holt die laufende nach vorn) und übergibt
   * die Adresse; die Hülle liest sie und meldet sie hier. Ohne diese Behandlung wäre die
   * Eintragung als Standard-E-Mail-Programm ein leeres Versprechen - das Fenster ginge
   * auf und zeigte den Posteingang statt eines Entwurfs.
   */
  useEffect(() => {
    const behandle = (ereignis: Event) => {
      const roh = (ereignis as CustomEvent<string>).detail;
      let angaben: {
        an?: string[];
        kopie?: string[];
        blindkopie?: string[];
        betreff?: string;
        text?: string;
      };
      try {
        angaben = JSON.parse(roh) as typeof angaben;
      } catch {
        return;
      }

      /*
       * Der Text kommt als reiner Text und wird maskiert, bevor er in den HTML-Entwurf
       * geht. Eine Webseite bestimmt hier den Inhalt - ein <script> darin dürfte im
       * Editor nicht als Auszeichnung ankommen.
       */
      const alsHtml = angaben.text
        ? angaben.text
            .split('\n')
            .map((zeile) => `<div>${escapeHtml(zeile) || '<br>'}</div>`)
            .join('')
        : '';

      oeffneVerfassen('Neue Nachricht', {
        to: angaben.an ?? [],
        cc: angaben.kopie ?? [],
        bcc: angaben.blindkopie ?? [],
        subject: angaben.betreff ?? '',
        html: withSignature(alsHtml, selectedAccount?.signature),
      });
    };

    window.addEventListener('energy-mail:mailto', behandle);
    return () => window.removeEventListener('energy-mail:mailto', behandle);
  }, [selectedAccount?.signature]);

  /**
   * Gibt die entfernten Inhalte eines Absenders dauerhaft frei.
   *
   * Danach wird die Nachricht neu geholt, damit sie das Vertrauen auch selbst kennt -
   * sonst stünde die Rückfrage beim nächsten Öffnen wieder da.
   */
  const handleVertrauen = async (adresse: string) => {
    if (!selectedAccountId) return;
    try {
      await api.vertrauenGeben(selectedAccountId, adresse);
      setReloadCounter((n) => n + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleReply = (message: FullMessage, toAll: boolean) => {
    const entwurf = buildReply(message, ownEmail, toAll, document);
    /**
     * Unter der Adresse antworten, an die geschrieben wurde. Post an "info@" privat zu
     * beantworten verwirrt den Empfänger, und die nächste Antwort landet wieder woanders.
     */
    const von = selectedAccount
      ? absenderFuerAntwort(selectedAccount, { to: message.to, cc: message.cc })
      : null;
    oeffneVerfassen(toAll ? 'Allen antworten' : 'Antworten', {
      ...entwurf,
      absender: von?.id ? { email: von.email, displayName: von.displayName } : undefined,
      html: withSignature(entwurf.html ?? '', von?.signature ?? selectedAccount?.signature),
    });
  };

  const handleForward = (message: FullMessage) => {
    if (!selectedFolder) return;
    const entwurf = buildForward(message, document);
    oeffneVerfassen('Weiterleiten', {
      ...entwurf,
      html: withSignature(entwurf.html ?? '', selectedAccount?.signature),
      // Der Server holt die Anhänge selbst per IMAP - sie müssen nicht durch den Browser.
      attachOriginal: originalAttachments(message, selectedFolder),
    });
  };

  /**
   * Führt einen Befehl aus - gleichgültig, ob er aus dem Menü, per Tastenkürzel oder per
   * Mausklick kommt. Alles läuft über dieselben Behandlungen wie die Schaltflächen, es
   * gibt also keinen zweiten Weg, der auseinanderlaufen könnte.
   */
  const fuehreAus = (befehl: Befehl) => {
    // Solange das Verfassen-Fenster offen ist, gehört die Tastatur ihm. Auch Esc: das
    // Fenster behandelt es selbst, mit Rückfrage und Angebot, als Entwurf zu sichern.
    if (composeInitial !== null) return;

    const stelle = messages.findIndex((m) => m.uid === selectedUid);

    switch (befehl) {
      case 'verfassen':
        handleCompose();
        return;
      case 'antworten':
      case 'allenAntworten':
        if (selectedMessage) handleReply(selectedMessage, befehl === 'allenAntworten');
        return;
      case 'weiterleiten':
        if (selectedMessage) handleForward(selectedMessage);
        return;
      case 'gelesenUmschalten':
        if (selectedMessage) void applySeen([selectedMessage.uid], !selectedMessage.seen);
        return;
      case 'archivieren':
        if (selectedMessage && archivZiel) void handleArchive([selectedMessage.uid]);
        return;
      case 'loeschen':
        // Angekreuzte Nachrichten haben Vorrang - sonst würde eine Sammelauswahl
        // stillschweigend übergangen.
        if (checkedUids.size > 0) void handleDelete([...checkedUids]);
        else if (selectedUid !== null) void handleDelete([selectedUid]);
        return;
      case 'regeln':
        if (selectedAccount) {
          setRegelVorgabe(undefined);
          setRulesFor(selectedAccount);
        }
        return;
      case 'aufraeumen':
        if (selectedAccount) setCleanupFor(selectedAccount);
        return;
      case 'wartet':
        if (selectedAccount) setWartendFor(selectedAccount);
        return;
      case 'suchen':
        // Über den Baum statt über eine durchgereichte Referenz: das Suchfeld liegt zwei
        // Ebenen tiefer, und der Fokus ist das Einzige, was von hier daran gebraucht wird.
        document.querySelector<HTMLInputElement>('.search-bar input')?.focus();
        return;
      case 'neuLaden':
        setReloadCounter((n) => n + 1);
        setFolderReload((n) => n + 1);
        return;
      case 'ansichtUmschalten':
        thema.umschalten();
        return;
      case 'kontoWeiter': {
        if (accounts.length < 2) return;
        const jetzt = accounts.findIndex((a) => a.id === selectedAccountId);
        setSelectedAccountId(accounts[(jetzt + 1) % accounts.length].id);
        return;
      }
      case 'weiter':
      case 'zurueck': {
        if (messages.length === 0) return;
        // Ohne Auswahl beginnt "weiter" oben, "zurück" unten.
        const ziel =
          stelle === -1
            ? befehl === 'weiter'
              ? 0
              : messages.length - 1
            : Math.min(Math.max(stelle + (befehl === 'weiter' ? 1 : -1), 0), messages.length - 1);
        setSelectedUid(messages[ziel].uid);
        return;
      }
      case 'abbrechen':
        setError(null);
        if (suche) void handleSearchClear();
        return;
    }
  };

  useBefehle(fuehreAus);

  /**
   * Öffnet eine Nachricht aus dem Entwürfe-Ordner zum Weiterschreiben. Anhänge bleiben
   * auf dem Server und werden beim Speichern oder Senden von dort übernommen.
   */
  const handleEditDraft = (message: FullMessage) => {
    if (!selectedFolder) return;
    oeffneVerfassen(
      'Entwurf bearbeiten',
      {
        to: message.to.map((a) => a.address),
        cc: message.cc.map((a) => a.address),
        subject: message.subject,
        html: typeof message.html === 'string' ? message.html : textToHtml(message.text ?? ''),
        attachOriginal: originalAttachments(message, selectedFolder),
      },
      { folder: selectedFolder, uid: message.uid },
    );
  };

  /**
   * Bedenkzeit nach dem Absenden. Acht Sekunden reichen, um den vergessenen Anhang oder
   * den falschen Empfänger zu bemerken, und halten niemanden auf - länger würde man beim
   * Schließen der Anwendung spüren, weil dann alles Wartende noch hinausgeht.
   */
  const BEDENKZEIT_SEKUNDEN = 8;

  const handleSend = async (draft: api.Draft, sendenAm?: string) => {
    if (!selectedAccountId) throw new Error('Kein Konto ausgewählt');

    const result = await api.sendMessage(
      selectedAccountId,
      draft,
      sendenAm ? { sendenAm } : { sendenIn: BEDENKZEIT_SEKUNDEN },
    );

    if (result.geplant && result.id && result.faellig) {
      setGeplant({
        id: result.id,
        faellig: result.faellig,
        betreff: draft.subject ?? '',
        draft,
        spaeter: Boolean(sendenAm),
      });
      return;
    }

    // Die Mail ist raus - nur die Ablage im Gesendet-Ordner hat nicht geklappt. Als
    // Warnung und nicht als Fehler: sonst würde man erneut senden. Erst seit es die
    // Abstufung gibt, lässt sich das überhaupt unterscheiden - vorher sah beides gleich
    // aus, nämlich rot.
    if (!result.savedToSent) {
      meldeWarnung(
        'Versendet, aber nicht abgelegt',
        `Die Nachricht ist beim Empfänger unterwegs. Nur die Kopie im Gesendet-Ordner ` +
          `konnte nicht geschrieben werden: ${result.saveError ?? 'unbekannter Grund'}`,
      );
    } else {
      setFolderReload((n) => n + 1);
    }
    // Ordner- und Nachrichtenstand auffrischen: der Entwurf ist weg, im Gesendet-Ordner
    // liegt eine neue Nachricht.
    setReloadCounter((n) => n + 1);
  };

  const handleSaveDraft = async (draft: api.Draft): Promise<DraftLocation> => {
    if (!selectedAccountId) throw new Error('Kein Konto ausgewählt');
    const result = await api.saveDraft(selectedAccountId, draft, draft.draftUid);
    const ort = { folder: result.folder, uid: result.uid };
    setDraftLocation(ort);
    // Zeigt man gerade den Entwürfe-Ordner an, soll die Liste den neuen Stand zeigen.
    if (selectedFolder === result.folder) setReloadCounter((n) => n + 1);
    setFolderReload((n) => n + 1);
    return ort;
  };

  const handleDiscardDraft = async () => {
    if (!selectedAccountId || !draftLocation?.uid) return;
    await api.deleteDraft(selectedAccountId, draftLocation.folder, draftLocation.uid);
    if (selectedFolder === draftLocation.folder) setReloadCounter((n) => n + 1);
    setFolderReload((n) => n + 1);
  };

  const handleSaveSettings = async (settings: {
    displayName?: string;
    signature?: string;
    identitaeten?: api.Identitaet[];
  }) => {
    if (!settingsFor) return;
    const updated = await api.updateAccount(settingsFor.id, settings);
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  // Im Entwürfe-Ordner öffnet ein Klick die Nachricht zum Weiterschreiben statt zum Lesen.
  const draftsFolder = folders.find((f) => f.specialUse === '\\Drafts');
  const inDraftsFolder = Boolean(draftsFolder) && selectedFolder === draftsFolder?.path;

  /**
   * Die Farbe des Anbieters. Sie färbt nicht mehr die ganze Oberfläche - dafür trägt das
   * Programm seit der Neugestaltung eine eigene -, sondern nur noch das runde Kennzeichen,
   * den Streifen an den Ordnern und den Punkt in der Titelleiste. Das genügt für die
   * Frage, die sie beantworten soll ("aus welcher Adresse schreibe ich gerade"), und
   * lässt der Anwendung ein eigenes Gesicht.
   */
  const kontoFarbe = providerTheme(selectedAccount?.provider).accent;

  /**
   * Ungelesene Nachrichten über alle Konten - für das Abzeichen am Taskleistensymbol.
   *
   * Zusammengezählt aus den Ordnern, die ohnehin schon geladen sind; ein eigener Abruf
   * dafür wäre reine Verschwendung. Gezählt wird nur der Posteingang: was in Werbung
   * oder Spam liegt, ist ungelesen und soll es auch bleiben - eine Zahl, die davon
   * hochgeht, meldet nichts, was jemand wissen will.
   *
   * Das Bild entsteht hier (siehe design/abzeichen.ts) und geht fertig an die Hülle.
   */
  useEffect(() => {
    const summe = Object.values(foldersByAccount)
      .flat()
      .filter((f) => f.specialUse === '\\Inbox')
      .reduce((n, f) => n + (f.unseen ?? 0), 0);
    window.energyMail?.setzeUngelesen(summe, zeichneAbzeichen(summe));
    // thema.ansicht steht bewusst dabei: das Abzeichen nimmt die Markenfarbe der gerade
    // gültigen Ansicht an und muss beim Umschalten neu gezeichnet werden.
  }, [foldersByAccount, thema.ansicht]);

  return (
    <div className="rahmen" style={{ ['--konto-farbe' as string]: kontoFarbe }}>
      <Titelleiste
        kontoName={selectedAccount?.displayName || selectedAccount?.email || null}
        kontoFarbe={kontoFarbe}
        ordnerName={selectedFolder ? aktuellerOrdnerName : null}
        wahl={thema.wahl}
        ansicht={thema.ansicht}
        onThemaUmschalten={thema.umschalten}
        aktualisierung={aktualisierung.knopf}
        onAktualisierung={aktualisierung.anstossen}
      />
      {aktualisierung.sichtbar && (
        <Aktualisierung
          stand={aktualisierung.stand}
          onNeuStarten={aktualisierung.neuStarten}
          onSchliessen={aktualisierung.verbergen}
        />
      )}
      {sicherungLaeuft && (
        <SicherungsMeldung
          accountId={sicherungLaeuft.accountId}
          ordner={sicherungLaeuft.ordner}
          onFertig={() => setSicherungLaeuft(null)}
        />
      )}
      {/* Bedenkzeit nach dem Absenden. Für "später senden" gibt es keine Meldung mit
          Rücklauf - dort wartet man Stunden, nicht Sekunden. */}
      {geplant && !geplant.spaeter && (
        <SendeMeldung
          betreff={geplant.betreff}
          faellig={geplant.faellig}
          onFertig={() => {
            setGeplant(null);
            setReloadCounter((n) => n + 1);
            setFolderReload((n) => n + 1);
          }}
          onRueckgaengig={() => {
            const laufend = geplant;
            setGeplant(null);
            void api
              .cancelSend(selectedAccountId!, laufend.id)
              .then(({ koerper }) => {
                // Zurück ins Verfassen-Fenster, mit allem was drinstand.
                oeffneVerfassen('Nachricht weiterbearbeiten', koerper);
              })
              .catch((err) => setError((err as Error).message));
          }}
        />
      )}
      {/*
        Zwei Sprungmarken, unsichtbar bis sie den Fokus bekommen.
        Mit der Tastatur liegen sonst ueber dreissig Ordnerzeilen vor der
        Nachrichtenliste und die ganze Liste vor der geoeffneten Nachricht - jedes Mal
        aufs Neue.
      */}
      <a className="sprungmarke" href="#nachrichtenliste">
        Zur Nachrichtenliste
      </a>
      <a className="sprungmarke" href="#nachricht">
        Zur geöffneten Nachricht
      </a>
      <div className="app">
        <Sidebar
          accounts={accounts}
          selectedAccountId={selectedAccountId}
          accountsWithNewMail={accountsWithNewMail}
          foldersByAccount={foldersByAccount}
          selectedFolder={selectedFolder}
          categories={categories}
          selectedCategory={selectedCategory}
          loadingFolders={loadingFolders}
          oauthClients={oauthClients}
          oauthBusy={oauthBusy}
          reauthBusy={reauthBusy}
          onReauth={(id) => void handleReauth(id)}
          ordnerAktionen={ordnerAktionen}
          wartendAnzahl={wartendAnzahl}
          onOpenWartend={() => selectedAccount && setWartendFor(selectedAccount)}
          onOpenAdressbuch={() => setAdressbuch({})}
          onOpenSchluessel={() => setSchluesselOffen(true)}
          onAblegen={(fracht, ziel) => void verschiebeGezogene(fracht, ziel)}
          gesamtAnsicht={gesamtAnsicht}
          onGesamtAnsicht={waehleGesamt}
          suchen={suchen}
          etiketten={etiketten}
          onSucheAusfuehren={fuehreSucheAus}
          onSucheLoeschen={(gemerkt) => void vergissSuche(gemerkt)}
          onSelectAccount={(id) => {
            // Auch der Griff zu einem Konto verlaesst die Gesamtliste - sonst liesse
            // sich dessen Ordnerbaum gar nicht aufklappen, und man saesse in der
            // Uebersicht fest.
            setGesamtAnsicht(false);
            setGesamtHerkunft(null);
            setSelectedAccountId(id);
          }}
          onSelectFolder={waehleOrdner}
          onSelectCategory={waehleKategorie}
          onCompose={handleCompose}
          onAddAccount={handleAddAccount}
          onDeleteAccount={handleDeleteAccount}
          onOpenSettings={setSettingsFor}
          onOAuthLogin={(provider) => void handleOAuthLogin(provider)}
          onOpenOAuthSetup={() => setShowOAuthSetup(true)}
        />
        <MessageList
          messages={angezeigteNachrichten}
          selectedUid={selectedUid}
          loading={loadingMessages}
          checkedUids={checkedUids}
          total={totalMessages}
          hasMore={hasMore && cursor !== null}
          loadingMore={loadingMore}
          searchActive={suche !== null}
          ohneVerbindung={ohneVerbindung}
          lokalerStand={lokalerStand}
          onVollstaendigSuchen={() => {
            // Dieselbe Eingabe noch einmal, diesmal ohne die Abkürzung über die Ablage.
            if (suche) void handleSearch(suche, true);
          }}
          anhangSuchbar={faehigkeiten.gmailSearch}
          mehrereKonten={accounts.length > 1}
          // In der Gesamtliste steht neben jeder Zeile, aus welchem Postfach sie kommt -
          // ohne das waere eine gemischte Liste nicht deutbar.
          zeigeHerkunft={gesamtAnsicht || (suche !== null && suche.bereich !== 'ordner')}
          konversationen={konversationen}
          onToggleKonversationen={(an) => {
            setKonversationen(an);
            localStorage.setItem('energy-mail:konversationen', an ? 'an' : 'aus');
          }}
          etiketten={etiketten}
          accountId={arbeitsKonto}
          ordner={arbeitsOrdner}
          sortierung={sortierung}
          onSortierung={(neu) => {
            setSortierung(neu);
            localStorage.setItem('energy-mail:sortierung', alsText(neu));
          }}
          onNeuLaden={() => setReloadCounter((n) => n + 1)}
          dichte={dichte}
          onDichte={(neu) => {
            setDichte(neu);
            localStorage.setItem('energy-mail:dichte', neu);
          }}
          gesamtAnsicht={gesamtAnsicht}
          fehlendeKonten={gesamtFehlende}
          sucheVorgabe={sucheVorgabe}
          onSucheSpeichern={(eingabe) => void merkeSuche(eingabe)}
          folderLabel={aktuellerOrdnerName}
          onLoadMore={() => void loadMore()}
          onSelect={(eintrag) => {
            // In der Gesamtliste bleibt die Liste stehen; geöffnet wird die Nachricht
            // dort, wo sie liegt. Sie ins Konto zu verfolgen hiesse, die Übersicht bei
            // jedem Klick zu verlassen.
            if (gesamtAnsicht) {
              setGesamtHerkunft({
                accountId: eintrag.accountId ?? '',
                folder: eintrag.folder ?? 'INBOX',
              });
              setSelectedUid(eintrag.uid);
              return;
            }
            // Ein Treffer aus einem anderen Ordner oder Konto: dorthin wechseln und ihn
            // öffnen - über denselben Weg wie eine angeklickte Benachrichtigung.
            if (eintrag.folder && eintrag.folder !== selectedFolder) {
              setZuOeffnen({
                accountId: eintrag.accountId ?? selectedAccountId!,
                folder: eintrag.folder,
                uid: eintrag.uid,
              });
            } else {
              setSelectedUid(eintrag.uid);
            }
          }}
          onToggleChecked={(uid, checked) =>
            setCheckedUids((prev) => {
              const next = new Set(prev);
              if (checked) next.add(uid);
              else next.delete(uid);
              return next;
            })
          }
          onToggleAll={(checked) =>
            setCheckedUids(checked ? new Set(messages.map((m) => m.uid)) : new Set())
          }
          onSearch={handleSearch}
          onClear={() => void handleSearchClear()}
        />
        <main className="reader-pane" id="nachricht" tabIndex={-1} aria-label="Geöffnete Nachricht">
          <BulkActionBar
            count={checkedUids.size}
            folders={folders}
            currentFolder={selectedFolder}
            isInTrash={isInTrash}
            busy={bulkBusy}
            archiveLabel={archivZiel ? `Verschiebt nach "${archivZiel.name}"` : null}
            onArchive={() => void handleArchive([...checkedUids])}
            onSetSeen={(seen) => void applySeen([...checkedUids], seen)}
            onDelete={() => void handleDelete([...checkedUids])}
            onMove={(target) => void handleMove([...checkedUids], target)}
            onClear={() => setCheckedUids(new Set())}
          />
          <MessageView
            message={selectedMessage}
            loading={loadingMessage}
            folders={folders}
            currentFolder={arbeitsOrdner}
            attachmentUrl={(partId) =>
              arbeitsKonto && arbeitsOrdner && selectedMessage
                ? api.attachmentUrl(arbeitsKonto, arbeitsOrdner, selectedMessage.uid, partId)
                : '#'
            }
            isInTrash={isInTrash}
            isDraft={inDraftsFolder}
            canReplyAll={Boolean(selectedMessage) && hasMultipleRecipients(selectedMessage!, ownEmail)}
            onReply={handleReply}
            onForward={handleForward}
            onEditDraft={handleEditDraft}
            archiveLabel={archivZiel ? `Verschiebt nach "${archivZiel.name}"` : null}
            onArchive={(uid) => void handleArchive([uid])}
            onSetSeen={(uid, seen) => void applySeen([uid], seen)}
            onSnooze={(uid) => void handleSnooze(uid)}
            onDelete={(uid) => void handleDelete([uid])}
            onMove={(uid, target) => void handleMove([uid], target)}
            onVertrauen={(adresse) => void handleVertrauen(adresse)}
            onQuelltext={(m) => setQuelltextFuer({ uid: m.uid, betreff: m.subject })}
            onZumAdressbuch={(address, name) => setAdressbuch({ vorgabe: { address, name } })}
            etiketten={etiketten}
            etikettenDauerhaft={etikettenDauerhaft}
            onEtikettSetzen={(uid, schluessel, an) => setzeEtikett(uid, schluessel, an)}
            onEtikettenGeaendert={setEtiketten}
            accountId={arbeitsKonto}
            eigeneAdressen={
              // Auch die weiteren Adressen: eine Einladung kann an einen Alias gegangen
              // sein, und dann steht man unter diesem in der Teilnehmerliste.
              arbeitsKonto
                ? (() => {
                    const konto = accounts.find((k) => k.id === arbeitsKonto);
                    return konto
                      ? [konto.email, ...(konto.identitaeten ?? []).map((i) => i.email)]
                      : [];
                  })()
                : []
            }
          />
        </main>
        {quelltextFuer && selectedAccountId && selectedFolder && (
          <QuelltextModal
            accountId={selectedAccountId}
            ordner={selectedFolder}
            uid={quelltextFuer.uid}
            betreff={quelltextFuer.betreff}
            onClose={() => setQuelltextFuer(null)}
          />
        )}
        {composeInitial !== null && (
          <ComposeModal
            initial={composeInitial}
            title={composeTitle}
            draftLocation={draftLocation}
            onClose={() => {
              setComposeInitial(null);
              setDraftLocation(undefined);
            }}
            onSend={handleSend}
            onSaveDraft={handleSaveDraft}
            onDiscardDraft={handleDiscardDraft}
            absender={selectedAccount ? alleAbsender(selectedAccount) : undefined}
            accountId={selectedAccountId}
          />
        )}
        {settingsFor && (
          <AccountSettingsModal
            account={settingsFor}
            onClose={() => setSettingsFor(null)}
            onSave={handleSaveSettings}
          />
        )}
        {wartendFor && (
          <WartendModal
            account={wartendFor}
            onClose={() => setWartendFor(null)}
            onGeaendert={() => {
              setReloadCounter((n) => n + 1);
              setFolderReload((n) => n + 1);
            }}
            onWeiterbearbeiten={(entwurf) =>
              oeffneVerfassen('Nachricht weiterbearbeiten', entwurf)
            }
            onOeffnen={(ordner, uid) =>
              setZuOeffnen({ accountId: wartendFor.id, folder: ordner, uid })
            }
            onNachfassen={(an, betreff) =>
              oeffneVerfassen('Nachfassen', {
                to: an.map((a) => a.address),
                subject: buildFollowUpSubject(betreff),
                html: withSignature('', wartendFor.signature),
              })
            }
          />
        )}
        {cleanupFor && (
          <CleanupModal
            account={cleanupFor}
            onClose={() => setCleanupFor(null)}
            onRegelAnlegen={(von, name) => {
              // Der Absender steht fest - die Regel schliesst sich unmittelbar an.
              setRegelVorgabe({ von, name });
              setCleanupFor(null);
              setRulesFor(cleanupFor);
            }}
            onGeaendert={() => {
              setReloadCounter((n) => n + 1);
              setFolderReload((n) => n + 1);
            }}
          />
        )}
        {rulesFor && (
          <RulesModal
            account={rulesFor}
            folders={foldersByAccount[rulesFor.id] ?? []}
            vorgabe={regelVorgabe}
            onClose={() => {
              setRulesFor(null);
              setRegelVorgabe(undefined);
            }}
            onGeaendert={() => {
              setReloadCounter((n) => n + 1);
              setFolderReload((n) => n + 1);
            }}
          />
        )}
        {showOAuthSetup && (
          <OAuthSetupModal onClose={() => setShowOAuthSetup(false)} onChanged={setOauthClients} />
        )}
        {schluesselOffen && (
          <SchluesselModal accounts={accounts} onClose={() => setSchluesselOffen(false)} />
        )}
        {adressbuch && (
          <AdressbuchModal
            vorgabe={adressbuch.vorgabe}
            onClose={() => setAdressbuch(null)}
          />
        )}
      </div>
    </div>
  );
}
