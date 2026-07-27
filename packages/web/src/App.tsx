import { useEffect, useState } from 'react';
import type {
  CategoryInfo,
  FolderInfo,
  FullMessage,
  GmailCategory,
  MessageSummary,
} from '@energy-mail/mail-core';
import * as api from './api.js';
import type { Account } from './api.js';
import { BulkActionBar } from './components/BulkActionBar.js';
import { ComposeModal } from './components/ComposeModal.js';
import { MessageList, type Listeneintrag } from './components/MessageList.js';
import { Sidebar } from './components/Sidebar.js';
import { MessageView } from './components/MessageView.js';
import { AccountSettingsModal } from './components/AccountSettingsModal.js';
import { OAuthSetupModal } from './components/OAuthSetupModal.js';
import { CleanupModal } from './components/CleanupModal.js';
import { RulesModal } from './components/RulesModal.js';
import { SendeMeldung } from './components/SendeMeldung.js';
import type { SucheEingabe } from './components/SearchBar.js';
import { buildForward, buildReply, hasMultipleRecipients, withSignature } from './composeHelpers.js';
import { archiveTarget } from './folderTargets.js';
import { buildFolderView } from './folderTree.js';
import { categoryLabel } from './gmailCategories.js';
import { providerTheme } from './providerTheme.js';
import { textToHtml } from './htmlText.js';
import { useBefehle, type Befehl } from './useBefehle.js';
import { useMailEvents } from './useMailEvents.js';

interface DraftLocation {
  folder: string;
  uid: number | null;
}

/** Fügt neue Treffer zu vorhandenen hinzu, ersetzt gleiche UIDs und sortiert nach Datum. */
function mergeMessages(existing: Listeneintrag[], incoming: Listeneintrag[]): Listeneintrag[] {
  const byUid = new Map(existing.map((m) => [m.uid, m]));
  for (const message of incoming) byUid.set(message.uid, message);
  return [...byUid.values()].sort(
    (a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime(),
  );
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
   * Nach einem Fehler den Kontostand nachladen.
   *
   * Dass eine Anmeldung abgelaufen ist, stellt sich erst beim fehlgeschlagenen Abruf
   * heraus - der Server hält es dann fest. Ohne dieses Nachladen bliebe die Seitenleiste
   * bis zum Neustart ahnungslos, und der Knopf zum Neuanmelden erschiene nie.
   */
  useEffect(() => {
    if (!error) return;
    api.fetchAccounts().then(setAccounts).catch(() => {});
  }, [error]);

  // Beim Kontowechsel die Ordnerauswahl verwerfen, damit unten wieder der Posteingang
  // des neuen Kontos gewählt wird.
  useEffect(() => {
    setSelectedFolder(null);
    setSelectedCategory(null);
  }, [selectedAccountId]);

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
  const viewKey = `${selectedAccountId ?? ''}|${selectedFolder ?? ''}|${selectedCategory ?? ''}`;
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
  }, [selectedAccountId, selectedFolder, selectedCategory]);

  useEffect(() => {
    if (!selectedAccountId || !selectedFolder) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    api
      .fetchMessages(selectedAccountId, selectedFolder, undefined, selectedCategory)
      .then((res) => {
        setTotalMessages(res.total);
        setCursor(res.nextCursor);
        setHasMore(res.hasMore);
        // Zusammenführen statt ersetzen: bereits nachgeladene ältere Seiten bleiben
        // erhalten, wenn oben eine neue Nachricht eintrifft.
        setMessages((prev) => mergeMessages(prev, res.messages));
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoadingMessages(false));
  }, [selectedAccountId, selectedFolder, selectedCategory, reloadCounter]);

  /**
   * Lädt die nächste, ältere Seite. Bei aktiver Suche wird innerhalb der Trefferliste
   * weitergeblättert, sonst innerhalb des Ordners.
   */
  const loadMore = async () => {
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
        : await api.fetchMessages(selectedAccountId, ordner, cursor, selectedCategory);
      setTotalMessages(res.total);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
      setMessages((prev) => mergeMessages(prev, res.messages));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };

  useMailEvents((event) => {
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
    if (!selectedAccountId || !selectedFolder || selectedUid === null) {
      setSelectedMessage(null);
      return;
    }
    setLoadingMessage(true);
    api
      .fetchMessage(selectedAccountId, selectedFolder, selectedUid)
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
  }, [selectedAccountId, selectedFolder, selectedUid]);

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
      void api.prefetchMessage(selectedAccountId, selectedFolder, naechste.uid, abbruch.signal);
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
    if (!selectedAccountId || !selectedFolder || uids.length === 0) return;
    const affected = new Set(uids);

    const setLocalSeen = (value: boolean) => {
      setMessages((prev) => prev.map((m) => (affected.has(m.uid) ? { ...m, seen: value } : m)));
      setSelectedMessage((prev) => (prev && affected.has(prev.uid) ? { ...prev, seen: value } : prev));
    };

    setLocalSeen(seen);
    try {
      await api.setMessagesSeen(selectedAccountId, selectedFolder, uids, seen);
      setFolderReload((n) => n + 1);
    } catch (err) {
      setLocalSeen(!seen);
      setError((err as Error).message);
    }
  };

  const handleAddAccount = async (email: string, password: string) => {
    const account = await api.createAccount(email, password);
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
      await api.moveMessages(selectedAccountId, selectedFolder, uids, targetFolder);
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
      if (!confirm(`${reason}\n\n${what} endgültig löschen? Das lässt sich nicht rückgängig machen.`)) {
        return;
      }
    }

    setBulkBusy(true);
    try {
      if (permanent) {
        await api.deleteMessages(selectedAccountId, selectedFolder, uids);
      } else {
        await api.moveMessages(selectedAccountId, selectedFolder, uids, trashFolder!.path);
      }
      removeFromView(uids);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const allMailFolder = folders.find((folder) => folder.isAllMail);

  // Überschrift der Nachrichtenliste - mit dem vereinheitlichten Namen der Seitenleiste.
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
  };

  /** Ordnerwechsel hebt eine aktive Einordnung auf - sie gilt nur für den Posteingang. */
  const waehleOrdner = (path: string) => {
    setSelectedFolder(path);
    setSelectedCategory(null);
  };

  const waehleKategorie = (path: string, category: GmailCategory) => {
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
    const eingabe = prompt(
      'Wann soll die Nachricht wieder auftauchen?\n\n' +
        '1 = in drei Stunden\n' +
        '2 = heute Abend (18:00)\n' +
        '3 = morgen früh (08:00)\n' +
        '4 = nächste Woche (Montag 08:00)\n\n' +
        'Oder ein Zeitpunkt als JJJJ-MM-TT HH:MM',
      '3',
    );
    if (!eingabe) return;

    const jetzt = new Date();
    const ziel = new Date(jetzt);
    switch (eingabe.trim()) {
      case '1':
        ziel.setHours(ziel.getHours() + 3);
        break;
      case '2':
        ziel.setHours(18, 0, 0, 0);
        if (ziel <= jetzt) ziel.setDate(ziel.getDate() + 1);
        break;
      case '3':
        ziel.setDate(ziel.getDate() + 1);
        ziel.setHours(8, 0, 0, 0);
        break;
      case '4': {
        // Bis zum nächsten Montag: getDay() liefert 0 für Sonntag.
        const tageBisMontag = (8 - ziel.getDay()) % 7 || 7;
        ziel.setDate(ziel.getDate() + tageBisMontag);
        ziel.setHours(8, 0, 0, 0);
        break;
      }
      default: {
        const eigen = new Date(eingabe.trim().replace(' ', 'T'));
        if (Number.isNaN(eigen.getTime()) || eigen <= jetzt) {
          setError(`"${eingabe.trim()}" ist kein brauchbarer Zeitpunkt in der Zukunft.`);
          return;
        }
        ziel.setTime(eigen.getTime());
      }
    }

    try {
      await api.snoozeMessage(selectedAccountId, selectedFolder, uid, ziel.toISOString());
      removeFromView([uid]);
      setError(null);
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
    setLoadingMessages(true);
    setCheckedUids(new Set());
    try {
      const res = await api.fetchMessages(
        selectedAccountId,
        selectedFolder,
        undefined,
        selectedCategory,
      );
      setMessages(res.messages);
      setTotalMessages(res.total);
      setCursor(res.nextCursor);
      setHasMore(res.hasMore);
      setSuche(null);
      setSearchFolder(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMessages(false);
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
  const handleSearch = async (eingabe: SucheEingabe) => {
    if (!selectedAccountId || !selectedFolder) return;
    setLoadingMessages(true);
    setCheckedUids(new Set());
    setSelection(null);
    try {
      if (eingabe.bereich === 'ordner') {
        // Eine aktive Einordnung bleibt Bedingung: wer in "Werbung" sucht, will nicht
        // plötzlich Treffer aus dem ganzen Posteingang sehen.
        const res = await api.searchMessages(selectedAccountId, selectedFolder, eingabe, {
          category: selectedCategory,
        });
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
        setMessages(res.hits);
        setTotalMessages(res.total);
        setCursor(null);
        setHasMore(false);
        setSearchFolder(null);
      }
      setSuche(eingabe);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMessages(false);
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

  const handleReply = (message: FullMessage, toAll: boolean) => {
    const entwurf = buildReply(message, ownEmail, toAll);
    oeffneVerfassen(toAll ? 'Allen antworten' : 'Antworten', {
      ...entwurf,
      html: withSignature(entwurf.html ?? '', selectedAccount?.signature),
    });
  };

  const handleForward = (message: FullMessage) => {
    if (!selectedFolder) return;
    const entwurf = buildForward(message);
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
      case 'suchen':
        // Über den Baum statt über eine durchgereichte Referenz: das Suchfeld liegt zwei
        // Ebenen tiefer, und der Fokus ist das Einzige, was von hier daran gebraucht wird.
        document.querySelector<HTMLInputElement>('.search-bar input')?.focus();
        return;
      case 'neuLaden':
        setReloadCounter((n) => n + 1);
        setFolderReload((n) => n + 1);
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
    // Hinweis anzeigen, aber nicht als Fehlschlag: sonst würde man erneut senden.
    if (!result.savedToSent) {
      setError(
        `Nachricht wurde versendet, konnte aber nicht im Gesendet-Ordner abgelegt werden: ${
          result.saveError ?? 'unbekannter Grund'
        }`,
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

  const handleSaveSettings = async (settings: { displayName?: string; signature?: string }) => {
    if (!settingsFor) return;
    const updated = await api.updateAccount(settingsFor.id, settings);
    setAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  // Im Entwürfe-Ordner öffnet ein Klick die Nachricht zum Weiterschreiben statt zum Lesen.
  const draftsFolder = folders.find((f) => f.specialUse === '\\Drafts');
  const inDraftsFolder = Boolean(draftsFolder) && selectedFolder === draftsFolder?.path;

  return (
    <>
      {error && (
        <div className="toast-error" role="alert">
          <span>{error}</span>
          <button className="icon-btn" onClick={() => setError(null)} title="Schließen">
            ×
          </button>
        </div>
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
      {/* Akzentfarbe des aktiven Kontos gilt für die ganze Ansicht: Verfassen-Knopf,
          aktive Zeile, Balken. So ist beim Schreiben sichtbar, aus welcher Adresse. */}
      <div
        className="app"
        style={{ ['--accent' as string]: providerTheme(selectedAccount?.provider).accent }}
      >
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
          onSelectAccount={setSelectedAccountId}
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
          messages={messages}
          selectedUid={selectedUid}
          loading={loadingMessages}
          checkedUids={checkedUids}
          total={totalMessages}
          hasMore={hasMore && cursor !== null}
          loadingMore={loadingMore}
          searchActive={suche !== null}
          anhangSuchbar={faehigkeiten.gmailSearch}
          mehrereKonten={accounts.length > 1}
          zeigeHerkunft={suche !== null && suche.bereich !== 'ordner'}
          konversationen={konversationen}
          onToggleKonversationen={(an) => {
            setKonversationen(an);
            localStorage.setItem('energy-mail:konversationen', an ? 'an' : 'aus');
          }}
          folderLabel={aktuellerOrdnerName}
          onLoadMore={() => void loadMore()}
          onSelect={(eintrag) => {
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
        <div className="reader-pane">
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
            currentFolder={selectedFolder}
            attachmentUrl={(partId) =>
              selectedAccountId && selectedFolder && selectedMessage
                ? api.attachmentUrl(selectedAccountId, selectedFolder, selectedMessage.uid, partId)
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
          />
        </div>
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
          />
        )}
        {settingsFor && (
          <AccountSettingsModal
            account={settingsFor}
            onClose={() => setSettingsFor(null)}
            onSave={handleSaveSettings}
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
      </div>
    </>
  );
}
