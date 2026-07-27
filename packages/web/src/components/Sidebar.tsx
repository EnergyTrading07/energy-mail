import { useState } from 'react';
import type { CategoryInfo, FolderInfo, GmailCategory } from '@energy-mail/mail-core';
import type { Account, OAuthClients, OAuthProvider } from '../api.js';
import { buildFolderView, type AnzeigeOrdner } from '../folderTree.js';
import { categoryDescription, categoryLabel, visibleCategories } from '../gmailCategories.js';
import { providerTheme } from '../providerTheme.js';
import { FolderIcon } from './FolderIcon.js';
import { FolderMenu, type MenuEintrag } from './FolderMenu.js';

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
  /** Ordnerverwaltung. Die Rückfragen stellt die Seitenleiste, ausgeführt wird oben. */
  ordnerAktionen: {
    anlegen: (accountId: string, pfad: string) => void;
    umbenennen: (accountId: string, folder: FolderInfo, neuerPfad: string) => void;
    loeschen: (accountId: string, folder: FolderInfo) => void;
    leeren: (accountId: string, folder: FolderInfo) => void;
    alleGelesen: (accountId: string, folder: FolderInfo) => void;
  };
  onSelectAccount: (id: string) => void;
  onSelectFolder: (path: string) => void;
  onSelectCategory: (folder: string, category: GmailCategory) => void;
  onCompose: () => void;
  onAddAccount: (email: string, password: string) => Promise<void>;
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
  onSelect,
  onContextMenu,
}: {
  eintrag: AnzeigeOrdner;
  active: boolean;
  onSelect: (path: string) => void;
  onContextMenu?: (e: React.MouseEvent, folder: FolderInfo) => void;
}) {
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
    <div
      className={`folder-row${active ? ' active' : ''}`}
      style={{ paddingLeft: 10 + tiefe * 14 }}
      onClick={() => onSelect(folder.path)}
      onContextMenu={(e) => onContextMenu?.(e, folder)}
      title={folder.path}
    >
      <FolderIcon role={folder.specialUse} />
      <span className={zaehler ? 'folder-name unread' : 'folder-name'}>{label}</span>
      {zaehler ? <span className="unread-badge">{badge(zaehler)}</span> : null}
    </div>
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
    <div
      className={`folder-row category-row${active ? ' active' : ''}`}
      style={{ paddingLeft: 24 }}
      onClick={() => onSelect(info.id)}
      title={`${categoryDescription(info.id)} · ${info.total} Nachrichten`}
    >
      <FolderIcon role={info.id} />
      <span className={info.unseen ? 'folder-name unread' : 'folder-name'}>
        {categoryLabel(info.id)}
      </span>
      {info.unseen ? <span className="unread-badge">{badge(info.unseen)}</span> : null}
    </div>
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const formSichtbar = formOffen || accounts.length === 0;

  /**
   * Fragt einen Ordnernamen ab. Verweigert das Trennzeichen des Servers: damit würde
   * unbeabsichtigt eine Ebene angelegt, und der Ordner erschiene nicht dort, wo man ihn
   * erwartet.
   */
  const frageName = (titel: string, vorgabe: string, delimiter: string): string | null => {
    const eingabe = prompt(titel, vorgabe)?.trim();
    if (!eingabe) return null;
    if (eingabe.includes(delimiter)) {
      alert(`Ein Ordnername darf kein "${delimiter}" enthalten - das trennt beim Anbieter die Ebenen.`);
      return null;
    }
    return eingabe;
  };

  const menueEintraege = (): MenuEintrag[] => {
    if (!menue) return [];
    const { accountId, folder, delimiter } = menue;
    const istSonderordner = Boolean(folder.specialUse);
    const istPapierkorbOderSpam =
      folder.specialUse === '\\Trash' || folder.specialUse === '\\Junk';

    return [
      {
        label: 'Unterordner anlegen…',
        onClick: folder.selectable
          ? () => {
              const name = frageName(`Unterordner in "${folder.name}" anlegen:`, '', delimiter);
              if (name) ordnerAktionen.anlegen(accountId, `${folder.path}${delimiter}${name}`);
            }
          : undefined,
        grund: folder.selectable ? undefined : 'Dieser Eintrag ist nur eine Überschrift.',
      },
      {
        label: 'Umbenennen…',
        onClick: istSonderordner
          ? undefined
          : () => {
              const name = frageName('Neuer Name:', folder.name, delimiter);
              if (!name) return;
              // Nur den letzten Teil ersetzen, damit der Ordner an seinem Platz bleibt.
              const teile = folder.path.split(delimiter);
              teile[teile.length - 1] = name;
              ordnerAktionen.umbenennen(accountId, folder, teile.join(delimiter));
            },
        grund: istSonderordner ? 'Sonderordner des Anbieters lassen sich nicht umbenennen.' : undefined,
      },
      {
        label: 'Alle als gelesen markieren',
        onClick: folder.unseen
          ? () => ordnerAktionen.alleGelesen(accountId, folder)
          : undefined,
        grund: folder.unseen ? undefined : 'Hier ist nichts ungelesen.',
      },
      {
        label: 'Ordner leeren…',
        gefaehrlich: true,
        onClick: istPapierkorbOderSpam
          ? () => {
              if (
                confirm(
                  `Alle Nachrichten in "${folder.name}" endgültig löschen?\n\n` +
                    'Das lässt sich nicht rückgängig machen.',
                )
              ) {
                ordnerAktionen.leeren(accountId, folder);
              }
            }
          : undefined,
        grund: istPapierkorbOderSpam ? undefined : 'Nur für Papierkorb und Spam vorgesehen.',
      },
      {
        label: 'Ordner löschen…',
        gefaehrlich: true,
        onClick: istSonderordner
          ? undefined
          : () => {
              if (
                confirm(
                  `Ordner "${folder.name}" mit allen darin enthaltenen Nachrichten löschen?\n\n` +
                    'Das lässt sich nicht rückgängig machen.',
                )
              ) {
                ordnerAktionen.loeschen(accountId, folder);
              }
            },
        grund: istSonderordner ? 'Sonderordner des Anbieters lassen sich nicht löschen.' : undefined,
      },
    ];
  };

  const hinzufuegen = async (e: React.FormEvent) => {
    e.preventDefault();
    setFehler(null);
    setBusy(true);
    try {
      await onAddAccount(email, password);
      setEmail('');
      setPassword('');
      setFormOffen(false);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sidebar">
      {menue && (
        <FolderMenu
          x={menue.x}
          y={menue.y}
          eintraege={menueEintraege()}
          onClose={() => setMenue(null)}
        />
      )}
      <div className="sidebar-head">
        <button className="btn compose-btn" onClick={onCompose} disabled={!selectedAccountId}>
          ✎ Neue Nachricht
        </button>
      </div>

      <div className="sidebar-scroll">
        {accounts.map((account) => {
          const aktiv = account.id === selectedAccountId;
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
                <span className="caret">{aktiv ? '▾' : '▸'}</span>
                <span className="provider-badge" title={thema.label}>
                  {thema.initial}
                </span>
                <span className="account-label" title={`${account.email} · ${thema.label}`}>
                  {account.displayName || account.email}
                </span>
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
                <button
                  className="icon-btn"
                  title="Konto entfernen"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Konto ${account.email} entfernen?`)) void onDeleteAccount(account.id);
                  }}
                >
                  ×
                </button>
              </div>

              {aktiv && (
                <div className="folder-list">
                  {/* Steht über den Ordnern, weil ohne gültige Anmeldung ohnehin nichts
                      geladen werden kann - der Hinweis ist dann das Einzige, was hilft. */}
                  {account.needsReauth && account.canReauth && (
                    <div className="reauth-notice">
                      <strong>Anmeldung abgelaufen</strong>
                      <p>
                        {account.email} kann nicht mehr abgerufen werden. Eine neue Anmeldung
                        genügt – Signatur und Einstellungen bleiben erhalten.
                      </p>
                      <button
                        className="btn"
                        disabled={reauthBusy !== null}
                        onClick={() => onReauth(account.id)}
                      >
                        {reauthBusy === account.id ? 'Warte auf Anmeldung…' : 'Neu anmelden'}
                      </button>
                    </div>
                  )}
                  {loadingFolders && ordner.length === 0 && <div className="empty-state">Lade Ordner…</div>}
                  {ansicht.sonder.map((eintrag) => (
                    <div key={eintrag.folder.path}>
                      <FolderRow
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
                      const name = frageName('Name des neuen Ordners:', '', delimiter);
                      if (name) ordnerAktionen.anlegen(account.id, name);
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
      </div>

      <div className="sidebar-foot">
        <button className="link-btn" onClick={() => setFormOffen((v) => !v)}>
          {formSichtbar ? '× Konto hinzufügen abbrechen' : '+ Konto hinzufügen'}
        </button>

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
                  {oauthBusy === provider ? 'Warte auf Anmeldung…' : `Mit ${label} anmelden`}
                  {!eingerichtet && <span className="badge-setup">Einrichtung nötig</span>}
                </button>
              );
            })}
            <div className="oauth-divider">oder mit Passwort</div>

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
                  placeholder="Passwort / App-Passwort"
                  disabled={busy}
                />
              </div>
              {fehler && <div className="error-banner">{fehler}</div>}
              <div className="form-row">
                <button className="btn" type="submit" disabled={busy}>
                  {busy ? 'Prüfe Verbindung…' : 'Hinzufügen'}
                </button>
              </div>
            </form>
            <p className="hint">
              Server werden aus der Adresse erkannt. Bei den meisten Anbietern wird ein
              App-Passwort benötigt, nicht das Login-Passwort.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
