import type { FolderInfo } from '@energy-mail/mail-core';
import { moveTargets } from '../folderTargets.js';
import { t } from '../sprache.js';

interface Props {
  count: number;
  folders: FolderInfo[];
  currentFolder: string | null;
  isInTrash: boolean;
  busy: boolean;
  /** Nur gesetzt, wenn der Anbieter ein Archiv kennt. */
  archiveLabel: string | null;
  onArchive: () => void;
  onSetSeen: (seen: boolean) => void;
  onDelete: () => void;
  onMove: (targetFolder: string) => void;
  onClear: () => void;
}

export function BulkActionBar({
  count,
  folders,
  currentFolder,
  isInTrash,
  busy,
  archiveLabel,
  onArchive,
  onSetSeen,
  onDelete,
  onMove,
  onClear,
}: Props) {
  if (count === 0) return null;

  return (
    <div className="bulk-bar">
      <span className="bulk-count">
        {count} {count === 1 ? 'Nachricht' : 'Nachrichten'} ausgewählt
      </span>
      {archiveLabel && (
        <button className="btn secondary" disabled={busy} onClick={onArchive} title={archiveLabel}>{t('Archivieren')}</button>
      )}
      <button className="btn secondary" disabled={busy} onClick={() => onSetSeen(true)}>{t('Gelesen')}</button>
      <button className="btn secondary" disabled={busy} onClick={() => onSetSeen(false)}>{t('Ungelesen')}</button>
      <button className="btn danger" disabled={busy} onClick={onDelete}>
        {isInTrash ? t('Endgültig löschen') : t('Löschen')}
      </button>
      <select
        className="move-select"
        value=""
        disabled={busy}
        onChange={(e) => {
          if (e.target.value) onMove(e.target.value);
        }}
      >
        <option value="">{t('Verschieben nach…')}</option>
        {moveTargets(folders, currentFolder).map((folder) => (
          <option key={folder.path} value={folder.path}>
            {folder.name}
          </option>
        ))}
      </select>
      <button className="icon-btn" title={t('Auswahl aufheben')} disabled={busy} onClick={onClear}>
        ×
      </button>
      {busy && <span className="bulk-busy">{t('Wird ausgeführt…')}</span>}
    </div>
  );
}
