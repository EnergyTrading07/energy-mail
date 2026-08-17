import { useState } from 'react';
import type { CategoryInfo, Etikett, FolderInfo, GmailCategory } from '@energy-mail/mail-core';
import { beschreibeSuche } from '@energy-mail/mail-core/etiketten';
import { ordnerBeschriftung } from '../barrierefrei.js';
import { FRACHT_ART, ausFracht, darfAblegen, type Fracht } from '../ziehen.js';
import type {
  Account,
  GespeicherteSuche,
  OAuthClients,
  OAuthProvider,
  Serverangaben,
} from '../api.js';
import { bestaetige, frage } from '../dialoge.js';
import { buildFolderView, type AnzeigeOrdner } from '../folderTree.js';
import { categoryDescription, categoryLabel, visibleCategories } from '../gmailCategories.js';
import { providerTheme } from '../providerTheme.js';
import { FolderIcon } from './FolderIcon.js';
import { FolderMenu, type MenuEintrag } from './FolderMenu.js';
import { LEERE_HANDWERTE, Serverauskunft, type HandWerte } from './Serverauskunft.js';
import { Monogramm } from './Monogramm.js';
import { Abwesend, Buch, Feder, Plus, Uhr, Winkel, Zahnrad } from './Symbole.js';
import type { Einstellungsbereich } from './EinstellungenModal.js';
import { t, tp } from '../sprache.js';

interface Props {
  accounts: Account[];
  selectedAccountId: string | null;
  accountsWithNewMail: Set<string>;
  /** Ordner je Konto - nur für Konten geladen, die aufgeklappt sind. */
  foldersByAccount: Record<string, FolderInfo[]>;
  selectedFolder: string | null;
  /** Gmails Einordnung des Posteingangs; bei anderen Anbietern leer. */
  categories: CategoryInfo[];
  selectedCategory: GmailCategory | null;
  loadingFolders: boolean;
  oauthClients: OAuthClients | null;
  oauthBusy: OAuthProvider | null;
  /** Kennung des Kontos, dessen Neuanmeldung gerade läuft. */
  reauthBusy: string | null;
  onReauth: (accountId: string) => void;
  /** Wie viele Nachrichten geplant oder zurueckgestellt sind. */
  wartendAnzahl: number;
  onOpenWartend: () => void;
  onOpenAdressbuch: () => void;
  /**
   * Das Einstellungsfenster, wahlweise gleich bei einem Bereich.
   *
   * Hier standen einmal sieben eigene Rückrufe (Schlüssel, Zertifikate, Archiv, Bestand,
   * Abwesenheit, Nutzer, Mein Konto), und im Fuß dazu sieben gleich aussehende
   * Textknöpfe. Sieben Wege für eine Frage - "wo stelle ich etwas ein?" - sind kein Weg.
   */
  onOpenEinstellungen: (bereich?: Einstellungsbereich) => void;
  /** Ein freigegebenes Postfach weglegen - der Beschenkte darf das selbst. */
  onFreigabeWeglegen: (freigabeId: string) => void;
  /**
   * Konten, deren Abwesenheitsnotiz gerade wirklich antwortet.
   *
   * Nicht "eingeschaltet", sondern "antwortet jetzt" - eine Notiz mit abgelaufenem
   * Zeitraum soll nicht mahnen. Sie ist der Grund, warum im Fuß der Seitenleiste
   * überhaupt noch ein Hinweis steht und nicht bloß das Zahnrad: Eine
   * Abwesenheitsnotiz, die man nicht sieht, bleibt drei Monate nach dem Urlaub an.
   * Deshalb erscheint der Hinweis auch nur dann, wenn wirklich geantwortet wird.
   */
  abwesenheitAktiv: string[];
  /** Ob die Sitzung an einem Keks hängt - nur dann gibt es etwas abzumelden. */
  abmeldbar: boolean;
  /** Für den Hinweistext am Knopf: unter welcher Adresse man angemeldet ist. */
  angemeldetAls?: string;
  /** Die eigene Adresse - sie steht im Fuß, damit man sieht, wer man gerade ist. */
  eigeneAdresse?: string;
  onAbmelden: () => void;
  /** Sperrt den Bildschirm sofort - siehe Sperrschirm.tsx. */
  onSperren: () => void;
  /** Verschiebt gezogene Nachrichten in einen Ordner. */
  onAblegen: (fracht: Fracht, ziel: FolderInfo) => void;
  /** Ob gerade der Posteingang aller Konten angezeigt wird. */
  gesamtAnsicht: boolean;
  onGesamtAnsicht: () => void;
  /** Gespeicherte Suchen - Ordner, die es gar nicht gibt. */
  suchen: GespeicherteSuche[];
  /** Verzeichnis der Etiketten - damit in der Beschreibung ihr Name steht, nicht das
      Schluesselwort, das nur der Server versteht. */
  etiketten: Etikett[];
  onSucheAusfuehren: (suche: GespeicherteSuche) => void;
  onSucheLoeschen: (suche: GespeicherteSuche) => void;
  /** Ordnerverwaltung. Die Rückfragen stellt die Seitenleiste, ausgeführt wird oben. */
  ordnerAktionen: {
    anlegen: (accountId: string, pfad: string) => void;
    umbenennen: (accountId: string, folder: FolderInfo, neuerPfad: string) => void;
    loeschen: (accountId: string, folder: FolderInfo) => void;
    leeren: (accountId: string, folder: FolderInfo) => void;
    alleGelesen: (accountId: string, folder: FolderInfo) => void;
    sichern: (accountId: string, folder: FolderInfo) => void;
  };
  onSelectAccount: (id: string) => void;
  onSelectFolder: (path: string) => void;
  onSelectCategory: (folder: string, category: GmailCategory) => void;
  onCompose: () => void;
  onAddAccount: (email: string, password: string, overrides?: Serverangaben) => Promise<void>;
  onDeleteAccount: (id: string) => Promise<void>;
  onOpenSettings: (account: Account) => void;
  onOAuthLogin: (provider: OAuthProvider) => void;
  onOpenOAuthSetup: () => void;
}

/** Kürzt große Zähler, damit die Zeile nicht auseinanderläuft. */
function badge(anzahl: number): string {
  return anzahl > 999 ? '999+' : String(anzahl);
}

function FolderRow({
  eintrag,
  active,
  accountId,
  onSelect,
  onContextMenu,
  onAblegen,
}: {
  eintrag: AnzeigeOrdner;
  active: boolean;
  /** Zu welchem Konto dieser Ordner gehoert - ohne das liesse sich "INBOX" verwechseln. */
  accountId: string;
  onSelect: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, folder: FolderInfo) => void;
  onAblegen?: (fracht: Fracht, ziel: FolderInfo) => void;
}) {
  /** Ob gerade etwas Ablegbares ueber dieser Zeile haengt. */
  const [ueber, setUeber] = useState<'ja' | 'nein' | null>(null);
  const { folder, tiefe, label } = eintrag;
  // "Alle Nachrichten" spiegelt bei Gmail den gesamten Bestand; sein Zähler wiederholte
  // nur den des Posteingangs.
  const zaehler = folder.isAllMail ? undefined : folder.unseen;

  if (!folder.selectable) {
    // Container ohne eigene Nachrichten (Gmails "[Gmail]") - als Gruppenüberschrift.
    return (
      <div className="folder-group" style={{ paddingLeft: 12 + tiefe * 14 }}>
        {label}
      </div>
    );
  }

  return (
    // Ein echter Knopf, kein angeklicktes div: nur so ist die Zeile mit der Tabulator-
    // taste erreichbar und laesst sich mit Eingabe und Leertaste ausloesen, ohne dass
    // beides hier nachgebaut werden muesste.
    <button
      type="button"
      className={
        `folder-row${active ? ' active' : ''}` +
        (ueber === 'ja' ? ' ablegbar' : ueber === 'nein' ? ' nicht-ablegbar' : '')
      }
      style={{ paddingLeft: 10 + tiefe * 14 }}
      // Der Hinweis beim Ueberfahren nennt den Pfad auf dem Server; vorgelesen wird der
      // angezeigte Name samt der Zahl daneben - "3" allein sagt nicht, wovon.
      aria-label={ordnerBeschriftung(label, zaehler)}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(folder.path)}
      onContextMenu={(e) => onContextMenu?.(e, folder)}
      onDragOver={(e) => {
        // Nur wenn wirklich Nachrichten daran haengen: gezogener Text aus einem anderen
        // Fenster soll die Ordnerliste nicht aufleuchten lassen.
        if (!e.dataTransfer.types.includes(FRACHT_ART)) return;
        e.preventDefault();
        // Die Pruefung geht erst beim Ablegen vollstaendig - beim Ueberfahren gibt der
        // Browser den Inhalt nicht heraus. Was hier feststeht, genuegt aber schon.
        const moeglich = folder.selectable;
        e.dataTransfer.dropEffect = moeglich ? 'move' : 'none';
        setUeber(moeglich ? 'ja' : 'nein');
      }}
      onDragLeave={() => setUeber(null)}
      onDrop={(e) => {
        setUeber(null);
        const fracht = ausFracht(e.dataTransfer.getData(FRACHT_ART));
        if (!darfAblegen(fracht, folder, accountId).erlaubt) return;
        e.preventDefault();
        onAblegen?.(fracht!, folder);
      }}
      title={folder.path}
    >
      <FolderIcon role={folder.specialUse} />
      <span className={zaehler ? 'folder-name unread' : 'folder-name'}>{label}</span>
      {zaehler ? <span className="unread-badge">{badge(zaehler)}</span> : null}
    </button>
  );
}

/**
 * Zeile für eine von Gmails Einordnungen - eingerückt unter dem Posteingang, weil die
 * Nachrichten dort liegen und nur gefiltert werden. Deshalb auch ein eigenes Aussehen:
 * es ist kein Ordner, und Verschieben oder Löschen wirkt weiterhin auf den Posteingang.
 */
function CategoryRow({
  info,
  active,
  onSelect,
}: {
  info: CategoryInfo;
  active: boolean;
  onSelect: (category: GmailCategory) => void;
}) {
  return (
    <button
      type="button"
      className={`folder-row category-row${active ? ' active' : ''}`}
      style={{ paddingLeft: 24 }}
      onClick={() => onSelect(info.id)}
      aria-label={ordnerBeschriftung(categoryLabel(info.id), info.unseen)}
      aria-current={active ? 'true' : undefined}
      title={`${categoryDescription(info.id)} · ${info.total} Nachrichten`}
    >
      <FolderIcon role={info.id} />
      <span className={info.unseen ? 'folder-name unread' : 'folder-name'}>
        {categoryLabel(info.id)}
      </span>
      {info.unseen ? <span className="unread-badge">{badge(info.unseen)}</span> : null}
    </button>
  );
}

export function Sidebar({
  accounts,
  selectedAccountId,
  accountsWithNewMail,
  foldersByAccount,
  selectedFolder,
  categories,
  selectedCategory,
  loadingFolders,
  oauthClients,
  oauthBusy,
  reauthBusy,
  onReauth,
  wartendAnzahl,
  onOpenWartend,
  onOpenAdressbuch,
  onOpenEinstellungen,
  abwesenheitAktiv,
  onFreigabeWeglegen,
  abmeldbar,
  angemeldetAls,
  eigeneAdresse,
  onAbmelden,
  onSperren,
  onAblegen,
  gesamtAnsicht,
  onGesamtAnsicht,
  suchen,
  etiketten,
  onSucheAusfuehren,
  onSucheLoeschen,
  ordnerAktionen,
  onSelectAccount,
  onSelectFolder,
  onSelectCategory,
  onCompose,
  onAddAccount,
  onDeleteAccount,
  onOpenSettings,
  onOAuthLogin,
  onOpenOAuthSetup,
}: Props) {
  const [formOffen, setFormOffen] = useState(false);
  const [alleOrdner, setAlleOrdner] = useState(false);
  const [menue, setMenue] = useState<{
    x: number;
    y: number;
    accountId: string;
    folder: FolderInfo;
    delimiter: string;
  } | null>(null);
  /** Das Menü hinter der Kontozeile im Fuß - Anmeldung, Sperren, Abmelden. */
  const [sitzungsmenue, setSitzungsmenue] = useState<{ x: number; y: number } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Serveradressen von Hand statt aus der Suche - offen, sobald die Suche nichts fand. */
  const [vonHand, setVonHand] = useState(false);
  const [handWerte, setHandWerte] = useState<HandWerte>(LEERE_HANDWERTE);

  const formSichtbar = formOffen || accounts.length === 0;

  /**
   * Fragt einen Ordnernamen ab. Verweigert das Trennzeichen des Servers: damit würde
   * unbeabsichtigt eine Ebene angelegt, und der Ordner erschiene nicht dort, wo man ihn
   * erwartet.
   *
   * Die Beanstandung erscheint jetzt am Feld selbst, sodass der eingetippte Name stehen
   * bleibt und nur die eine Stelle geändert werden muss - vorher wurde er mitsamt dem
   * Fenster verworfen, und man fing von vorn an.
   */
  const frageName = (titel: string, vorgabe: string, delimiter: string): Promise<string | null> =>
    frage({
      titel,
      vorgabe,
      ok: t('Übernehmen'),
      pruefe: (name) =>
        name.includes(delimiter)
          ? t('Ein Ordnername darf kein „{zeichen}“ enthalten – das trennt beim Anbieter die Ebenen.', {
              zeichen: delimiter,
            })
          : null,
    });

  const menueEintraege = (): MenuEintrag[] => {
    if (!menue) return [];
    const { accountId, folder, delimiter } = menue;
    const istSonderordner = Boolean(folder.specialUse);
    const istPapierkorbOderSpam =
      folder.specialUse === '\\Trash' || folder.specialUse === '\\Junk';

    return [
      {
        label: t('Unterordner anlegen…'),
        onClick: folder.selectable
          ? () =>
              void frageName(t('Unterordner in „{ordner}“ anlegen', { ordner: folder.name }), '', delimiter).then(
                (name) =>
                  name && ordnerAktionen.anlegen(accountId, `${folder.path}${delimiter}${name}`),
              )
          : undefined,
        grund: folder.selectable ? undefined : t('Dieser Eintrag ist nur eine Überschrift.'),
      },
      {
        label: t('Umbenennen…'),
        onClick: istSonderordner
          ? undefined
          : () =>
              void frageName(t('Neuer Name'), folder.name, delimiter).then((name) => {
                if (!name) return;
                // Nur den letzten Teil ersetzen, damit der Ordner an seinem Platz bleibt.
                const teile = folder.path.split(delimiter);
                teile[teile.length - 1] = name;
                ordnerAktionen.umbenennen(accountId, folder, teile.join(delimiter));
              }),
        grund: istSonderordner
          ? t('Sonderordner des Anbieters lassen sich nicht umbenennen.')
          : undefined,
      },
      {
        label: t('Alle als gelesen markieren'),
        onClick: folder.unseen
          ? () => ordnerAktionen.alleGelesen(accountId, folder)
          : undefined,
        grund: folder.unseen ? undefined : t('Hier ist nichts ungelesen.'),
      },
      {
        label: t('Als Datei sichern…'),
        onClick: folder.selectable
          ? () => ordnerAktionen.sichern(accountId, folder)
          : undefined,
        grund: folder.selectable ? undefined : t('Dieser Eintrag ist nur eine Überschrift.'),
      },
      {
        label: t('Ordner leeren…'),
        gefaehrlich: true,
        onClick: istPapierkorbOderSpam
          ? () =>
              void bestaetige({
                titel: t('„{ordner}“ leeren?', { ordner: folder.name }),
                text: t(
                  'Alle Nachrichten darin werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.',
                ),
                stil: 'gefahr',
                ok: t('Endgültig löschen'),
              }).then((ja) => ja && ordnerAktionen.leeren(accountId, folder))
          : undefined,
        grund: istPapierkorbOderSpam ? undefined : t('Nur für Papierkorb und Spam vorgesehen.'),
      },
      {
        label: t('Ordner löschen…'),
        gefaehrlich: true,
        onClick: istSonderordner
          ? undefined
          : () =>
              void bestaetige({
                titel: t('Ordner „{ordner}“ löschen?', { ordner: folder.name }),
                text: t(
                  'Alle darin enthaltenen Nachrichten werden mitgelöscht. Das lässt sich nicht rückgängig machen.',
                ),
                stil: 'gefahr',
                ok: t('Ordner löschen'),
              }).then((ja) => ja && ordnerAktionen.loeschen(accountId, folder)),
        grund: istSonderordner
          ? t('Sonderordner des Anbieters lassen sich nicht löschen.')
          : undefined,
      },
    ];
  };

  const hinzufuegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler(null);
    setBusy(true);
    try {
      // Nur mitgeben, was wirklich ausgefüllt ist - ein leeres Feld überschriebe sonst
      // die gefundene Angabe mit nichts.
      const angaben = vonHand
        ? {
            imapHost: handWerte.imapHost.trim() || undefined,
            imapPort: Number(handWerte.imapPort) || undefined,
            smtpHost: handWerte.smtpHost.trim() || undefined,
            smtpPort: Number(handWerte.smtpPort) || undefined,
          }
        : undefined;
      await onAddAccount(email, password, angaben);
      setEmail('');
      setPassword('');
      setVonHand(false);
      setHandWerte(LEERE_HANDWERTE);
      setFormOffen(false);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <nav className="sidebar" aria-label="Konten und Ordner">
      {menue && (
        <FolderMenu
          x={menue.x}
          y={menue.y}
          eintraege={menueEintraege()}
          onClose={() => setMenue(null)}
        />
      )}
      {sitzungsmenue && (
        <FolderMenu
          x={sitzungsmenue.x}
          y={sitzungsmenue.y}
          onClose={() => setSitzungsmenue(null)}
          eintraege={[
            { label: t('Anmeldung ändern…'), onClick: () => onOpenEinstellungen('zugang') },
            /*
              Sperren steht vor Abmelden - es ist der häufigere Griff.

              Wer den Platz verlässt, will zurückkommen und weiterarbeiten, nicht sich neu
              anmelden und den begonnenen Brief verlieren. Abmelden bleibt daneben für den,
              der wirklich Schluss macht.
            */
            { label: t('Bildschirm sperren'), onClick: onSperren },
            { label: t('Abmelden'), onClick: onAbmelden },
          ]}
        />
      )}
      <div className="sidebar-head">
        <button className="btn compose-btn" onClick={onCompose} disabled={!selectedAccountId}>
          {/* Eine gezeichnete Feder statt des Schriftzeichens ✎: das zeichnet jedes
              System anders, steht je nach Schriftschnitt auf einer anderen Höhe und
              bringt in manchen Fassungen eine eigene Farbe mit. */}
          <Feder groesse={14} />{t('Neue Nachricht')}</button>
      </div>

      <div className="sidebar-scroll">
        {/* Nur bei mehreren Konten: bei einem einzigen waere es derselbe Posteingang
            zweimal, und die Liste faenge mit einer Doppelung an. */}
        {accounts.length > 1 && (
          <button
            type="button"
            className={`folder-row gesamt-zeile${gesamtAnsicht ? ' active' : ''}`}
            onClick={onGesamtAnsicht}
            aria-current={gesamtAnsicht ? 'true' : undefined}
            title="Die Posteingänge aller Konten in einer Liste"
          >
            <FolderIcon role="\Inbox" />
            <span className="folder-name">{t('Alle Posteingänge')}</span>
          </button>
        )}

        {accounts.map((account) => {
          const aktiv = account.id === selectedAccountId && !gesamtAnsicht;
          const ordner = foldersByAccount[account.id] ?? [];
          const ansicht = buildFolderView(ordner, alleOrdner);
          const posteingang = ansicht.sonder.find((e) => e.folder.specialUse === '\\Inbox');
          const thema = providerTheme(account.provider);

          return (
            <div
              key={account.id}
              className={`account-block${aktiv ? ' active' : ''}`}
              // Die Akzentfarbe wird als CSS-Variable weitergegeben, damit Kennzeichen,
              // aktiver Ordner und Balken sie ohne zusätzliche Klassen übernehmen.
              style={{ ['--accent' as string]: thema.accent }}
            >
              <div className="account-head" onClick={() => onSelectAccount(account.id)}>
                {/* Gedreht wird der Winkel per CSS, siehe .caret in index.css - dadurch
                    klappt er sichtbar um, statt gegen ein anderes Zeichen getauscht zu
                    werden. */}
                <span className="caret">
                  <Winkel groesse={11} />
                </span>
                <span className="provider-badge" title={thema.label}>
                  {thema.initial}
                </span>
                <span className="account-label" title={`${account.email} · ${thema.label}`}>
                  {account.displayName || account.email}
                </span>
                {/*
                  Ein freigegebenes Postfach traegt seinen Vermerk immer.

                  Wer in fremder Post arbeitet, soll es an jeder Stelle sehen und nicht
                  erst merken, wenn er versehentlich in Annas Namen geantwortet hat. Bei
                  reinem Leserecht steht es ausdruecklich dabei - sonst waere der erste
                  Hinweis darauf eine Fehlermeldung beim Loeschen.
                */}
                {account.freigabe && (
                  <span
                    className={`freigabe-marke${account.freigabe.rechte === 'lesen' ? ' nur-lesen' : ''}`}
                    title={t('Freigegeben von {wer}', { wer: account.freigabe.von })}
                  >
                    {account.freigabe.rechte === 'lesen' ? t('nur lesen') : t('freigegeben')}
                  </span>
                )}
                {account.needsReauth && (
                  <span
                    className="auth-warn"
                    title="Die Anmeldung wird vom Anbieter nicht mehr anerkannt – Konto neu anmelden."
                  >
                    !
                  </span>
                )}
                {accountsWithNewMail.has(account.id) && <span className="new-mail-dot" title="Neue Nachrichten" />}
                {/* Bei zugeklapptem Konto den Posteingangszähler zeigen, sonst wüsste man
                    nicht, dass dort Post liegt. */}
                {!aktiv && posteingang?.folder.unseen ? (
                  <span className="unread-badge">{badge(posteingang.folder.unseen)}</span>
                ) : null}
                {/*
                  Kein Zahnrad an einem fremden Postfach.

                  Name, Signatur, Zugangsdaten und die Freigaben selbst gehoeren dem
                  Eigentuemer - der Server weist das ohnehin mit 403 ab. Ein Knopf, der
                  immer eine Fehlermeldung bringt, ist eine Falle.
                */}
                {!account.freigabe && (
                <button
                  className="icon-btn"
                  title="Einstellungen (Name, Signatur)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenSettings(account);
                  }}
                >
                  ⚙
                </button>
                )}
                {!account.freigabe && (
                <button
                  className="icon-btn"
                  title={t('Konto entfernen')}
                  onClick={(e) => {
                    e.stopPropagation();
                    void bestaetige({
                      titel: t('Konto entfernen?'),
                      text: t(
                        '{adresse} wird aus Energy Mail entfernt. Beim Anbieter bleibt alles unverändert – die Nachrichten liegen weiterhin dort.',
                        { adresse: account.email },
                      ),
                      stil: 'warnung',
                      ok: t('Konto entfernen'),
                    }).then((ja) => ja && void onDeleteAccount(account.id));
                  }}
                >
                  ×
                </button>
                )}
                {/*
                  An einem freigegebenen Postfach steht stattdessen "weglegen".

                  Wer es nicht mehr sehen will, soll es loswerden koennen, ohne den
                  Eigentuemer zu fragen - und ohne dabei Gefahr zu laufen, ein fremdes
                  Konto zu entfernen. Der Server laesst genau das zu: Zuruecknehmen darf
                  auch der Beschenkte.
                */}
                {account.freigabe && (
                  <button
                    className="icon-btn"
                    title={t('Dieses freigegebene Postfach weglegen')}
                    onClick={(e) => {
                      e.stopPropagation();
                      void bestaetige({
                        titel: t('{adresse} weglegen?', { adresse: account.email }),
                        text: t(
                          'Es verschwindet aus Ihrer Seitenleiste. Am Postfach selbst ändert sich nichts – es gehört weiterhin {wer}. Wer es zurückhaben will, muss neu freigegeben werden.',
                          { wer: account.freigabe!.von },
                        ),
                        ok: t('Weglegen'),
                      }).then((ja) => ja && void onFreigabeWeglegen(account.freigabe!.id));
                    }}
                  >
                    ×
                  </button>
                )}
              </div>

              {aktiv && (
                <div className="folder-list">
                  {/* Steht über den Ordnern, weil ohne gültige Anmeldung ohnehin nichts
                      geladen werden kann - der Hinweis ist dann das Einzige, was hilft. */}
                  {account.needsReauth && account.canReauth && (
                    <div className="reauth-notice">
                      <strong>{t('Anmeldung abgelaufen')}</strong>
                      <p>
                        {t(
                          '{adresse} kann nicht mehr abgerufen werden. Eine neue Anmeldung genügt – Signatur und Einstellungen bleiben erhalten.',
                          { adresse: account.email },
                        )}
                      </p>
                      <button
                        className="btn"
                        disabled={reauthBusy !== null}
                        onClick={() => onReauth(account.id)}
                      >
                        {reauthBusy === account.id ? t('Warte auf Anmeldung…') : t('Neu anmelden')}
                      </button>
                    </div>
                  )}
                  {loadingFolders && ordner.length === 0 && <div className="empty-state">{t('Lade Ordner…')}</div>}
                  {ansicht.sonder.map((eintrag) => (
                    <div key={eintrag.folder.path}>
                      <FolderRow
                        accountId={account.id}
                        onAblegen={onAblegen}
                        eintrag={eintrag}
                        // Der Posteingang selbst ist nur hervorgehoben, wenn keine
                        // Einordnung gewählt ist - sonst wären zwei Zeilen aktiv.
                        active={
                          eintrag.folder.path === selectedFolder &&
                          !(selectedCategory && eintrag.folder.specialUse === '\\Inbox')
                        }
                        onSelect={onSelectFolder}
                        onContextMenu={(e, folder) => {
                          e.preventDefault();
                          setMenue({
                            x: e.clientX,
                            y: e.clientY,
                            accountId: account.id,
                            folder,
                            delimiter: folder.delimiter,
                          });
                        }}
                      />
                      {eintrag.folder.specialUse === '\\Inbox' &&
                        visibleCategories(categories).map((info) => (
                          <CategoryRow
                            key={info.id}
                            info={info}
                            active={
                              selectedCategory === info.id &&
                              selectedFolder === eintrag.folder.path
                            }
                            onSelect={(category) =>
                              onSelectCategory(eintrag.folder.path, category)
                            }
                          />
                        ))}
                    </div>
                  ))}
                  {ansicht.weitere.length > 0 && <div className="folder-separator" />}
                  {ansicht.weitere.map((eintrag) => (
                    <FolderRow
                      key={eintrag.folder.path}
                      accountId={account.id}
                      onAblegen={onAblegen}
                      eintrag={eintrag}
                      active={eintrag.folder.path === selectedFolder}
                      onSelect={onSelectFolder}
                      onContextMenu={(e, folder) => {
                        e.preventDefault();
                        setMenue({
                          x: e.clientX,
                          y: e.clientY,
                          accountId: account.id,
                          folder,
                          delimiter: folder.delimiter,
                        });
                      }}
                    />
                  ))}
                  <button
                    className="link-btn folder-toggle"
                    onClick={() => {
                      const delimiter = ordner[0]?.delimiter ?? '/';
                      void frageName('Name des neuen Ordners', '', delimiter).then(
                        (name) => name && ordnerAktionen.anlegen(account.id, name),
                      );
                    }}
                    title="Weitere Aktionen erreichst du mit einem Rechtsklick auf einen Ordner"
                  >
                    + Ordner anlegen
                  </button>
                  {(ansicht.ausgeblendet > 0 || alleOrdner) && (
                    <button className="link-btn folder-toggle" onClick={() => setAlleOrdner((v) => !v)}>
                      {alleOrdner
                        ? 'Leere Doppel-Ordner ausblenden'
                        : `${ansicht.ausgeblendet} leere Doppel-Ordner anzeigen`}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/*
          Ein Postfach kommt dort hinzu, wo die Postfächer stehen.

          Der Knopf stand vorher im Fuß, mitten zwischen "Nutzer" und "Mein Konto" - also
          zwischen zwei Dingen, mit denen er nichts zu tun hat, und weit weg von der
          Liste, die er verlängert. Hier steht er am Ende dieser Liste, und das Formular
          klappt an derselben Stelle auf.
        */}
        {/* Beim allerersten Start steht das Formular ohnehin offen - dann wäre ein Knopf,
            der es zuklappt, ein Weg in eine leere Anwendung. */}
        {accounts.length > 0 && (
          <button className="konto-hinzu" onClick={() => setFormOffen((v) => !v)}>
            <Plus groesse={14} />
            <span>{formOffen ? t('Doch kein Konto hinzufügen') : t('Konto hinzufügen')}</span>
          </button>
        )}

        {formSichtbar && (
          <div className="add-account">
            {(['google', 'microsoft'] as OAuthProvider[]).map((provider) => {
              const eingerichtet = oauthClients?.[provider]?.configured;
              const label = provider === 'google' ? 'Google / Gmail' : 'Microsoft / Outlook';
              return (
                <button
                  key={provider}
                  type="button"
                  className="btn secondary oauth-btn"
                  onClick={() => (eingerichtet ? onOAuthLogin(provider) : onOpenOAuthSetup())}
                  disabled={oauthBusy !== null}
                >
                  {oauthBusy === provider
                    ? t('Warte auf Anmeldung…')
                    : t('Mit {anbieter} anmelden', { anbieter: label })}
                  {!eingerichtet && <span className="badge-setup">{t('Einrichtung nötig')}</span>}
                </button>
              );
            })}
            <div className="oauth-divider">{t('oder mit Passwort')}</div>

            <form onSubmit={hinzufuegen}>
              <div className="form-row">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@anbieter.de"
                  disabled={busy}
                />
              </div>
              <div className="form-row">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('Passwort / App-Passwort')}
                  disabled={busy}
                />
              </div>
              <Serverauskunft
                email={email}
                vonHand={vonHand}
                onVonHand={setVonHand}
                werte={handWerte}
                onWert={(feld, wert) => setHandWerte((v) => ({ ...v, [feld]: wert }))}
              />
              {fehler && <div className="error-banner">{fehler}</div>}
              <div className="form-row">
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? t('Prüfe Verbindung…') : t('Hinzufügen')}
                </button>
              </div>
            </form>
            <p className="hint">
              {t(
                'Server werden aus der Adresse erkannt. Bei den meisten Anbietern wird ein App-Passwort benötigt, nicht das Login-Passwort.',
              )}
            </p>
          </div>
        )}
      </div>

      {suchen.length > 0 && (
        <div className="gemerkte-suchen">
          <div className="sidebar-abschnitt">{t('Gemerkte Suchen')}</div>
          {suchen.map((suche) => (
            <div key={suche.id} className="gemerkte-suche">
              <button
                className="gemerkte-suche-name"
                onClick={() => onSucheAusfuehren(suche)}
                title={beschreibeSuche(suche.kriterien, etiketten)}
              >
                {suche.name}
              </button>
              <button
                className="link-btn gefaehrlich"
                onClick={() => onSucheLoeschen(suche)}
                aria-label={t('Suche „{name}“ vergessen', { name: suche.name })}
                title={t('Diese Suche vergessen')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/*
        Der Fuß der Seitenleiste - vorher elf Textknöpfe untereinander.

        Sie waren alle gleich gesetzt und in keiner erkennbaren Ordnung: "Abwesenheit"
        stand zwischen "Adressbuch" und "Schlüssel", "Abmelden" neben "Archiv". Neun der
        elf öffneten Fenster, die es alle nur um des Einstellens willen gibt - sie stehen
        jetzt im Einstellungsfenster, jedes unter einer Überschrift, die sagt, wonach man
        gesucht hat.

        Was hier blieb, sind drei Griffe und eine Auskunft:

          "Offen" ist keine Einstellung, sondern Arbeit, die noch aussteht.
          "Adressbuch" ist ein Nachschlagewerk und wird beim Schreiben gebraucht.
          "Einstellungen" ist der eine Weg zu allem Übrigen.
          Die Zeile ganz unten sagt, wer man gerade ist - und öffnet die Sitzung.
      */}
      <div className="sidebar-foot">
        {/*
          Der einzige Zustand, der sich selbst melden muss.

          Eine eingeschaltete Abwesenheitsnotiz ist das eine, was man vergisst und was
          dann monatelang Fremden erzählt, man sei im Urlaub. Sie in ein
          Einstellungsfenster zu räumen hieße, sie unsichtbar zu machen - deshalb steht
          hier ein Hinweis, aber nur, solange wirklich geantwortet wird.
        */}
        {abwesenheitAktiv.length > 0 && (
          <button
            className="fuss-hinweis"
            onClick={() => onOpenEinstellungen('abwesenheit')}
            title={t('Es wird gerade automatisch geantwortet.')}
          >
            <Abwesend groesse={14} />
            <span>
              {tp(
                abwesenheitAktiv.length,
                'Abwesenheitsnotiz antwortet für {anzahl} Postfach',
                'Abwesenheitsnotiz antwortet für {anzahl} Postfächer',
                { anzahl: abwesenheitAktiv.length },
              )}
            </span>
          </button>
        )}

        {/* Immer sichtbar, weil dahinter auch das Liegengebliebene steckt - das gibt es
            gerade dann, wenn nichts geplant ist. Die Zahl steht nur dabei, wenn sie
            etwas meldet: eine dauerhafte Null waere Rauschen, und genau dann uebersieht
            man den Hinweis, wenn er zaehlt. */}
        <button
          className={`fuss-zeile${wartendAnzahl > 0 ? ' meldet' : ''}`}
          onClick={onOpenWartend}
        >
          <Uhr groesse={15} />
          <span>
            {wartendAnzahl > 0
              ? tp(wartendAnzahl, 'Offen · {anzahl} wartet', 'Offen · {anzahl} warten', {
                  anzahl: wartendAnzahl,
                })
              : t('Was ist offen?')}
          </span>
        </button>

        <div className="fuss-reihe">
          <button className="fuss-zeile" onClick={onOpenAdressbuch}>
            <Buch groesse={15} />
            <span>{t('Adressbuch')}</span>
          </button>
          <button className="fuss-zeile" onClick={() => onOpenEinstellungen()}>
            <Zahnrad groesse={15} />
            <span>{t('Einstellungen')}</span>
          </button>
        </div>

        {/*
          Die Sitzung - und nur, wo es eine gibt.

          In der Desktop-Hülle weist sich das Fenster über das Zugangsgeheimnis des
          Prozesses aus: Es gibt dort keine Sitzung, die sich beenden ließe, kein Kennwort
          zu ändern und keinen zweiten Faktor. Der Server sagt mit "abmeldbar", ob eine da
          ist; die Oberfläche entscheidet das nicht selbst.

          Als eine Zeile mit Menü statt dreier Knöpfe: "Mein Konto", "Sperren" und
          "Abmelden" beantworten dieselbe Frage - wie komme ich hier herein und wieder
          hinaus -, und die Antwort darauf braucht man selten. Die Zeile selbst tut dafür
          etwas, was drei Knöpfe nicht taten: Sie sagt, wer man gerade ist.
        */}
        {abmeldbar && (
          <button
            className="fuss-konto"
            title={angemeldetAls}
            aria-haspopup="menu"
            onClick={(e) => {
              const kasten = e.currentTarget.getBoundingClientRect();
              setSitzungsmenue({ x: kasten.left, y: kasten.top });
            }}
          >
            <Monogramm adresse={eigeneAdresse} className="fuss-monogramm" />
            <span className="fuss-konto-name">{eigeneAdresse ?? t('Angemeldet')}</span>
            <Winkel groesse={11} />
          </button>
        )}

      </div>
    </nav>
  );
}
