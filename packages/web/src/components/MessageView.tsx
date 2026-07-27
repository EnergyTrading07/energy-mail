import { useEffect, useRef } from 'react';
import type { FolderInfo, FullMessage } from '@energy-mail/mail-core';
import { moveTargets } from '../folderTargets.js';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface Props {
  message: FullMessage | null;
  loading: boolean;
  folders: FolderInfo[];
  currentFolder: string | null;
  /** Baut die Download-Adresse für einen Anhang der aktuell gezeigten Nachricht. */
  attachmentUrl: (partId: string) => string;
  /** True, wenn die Nachricht bereits im Papierkorb liegt - dann löscht der Knopf endgültig. */
  isInTrash: boolean;
  /** Im Entwürfe-Ordner gehört die Nachricht bearbeitet, nicht beantwortet. */
  isDraft: boolean;
  /** Steuert, ob "Allen antworten" überhaupt sinnvoll ist. */
  canReplyAll: boolean;
  onReply: (message: FullMessage, toAll: boolean) => void;
  onForward: (message: FullMessage) => void;
  onEditDraft: (message: FullMessage) => void;
  /** Nur gesetzt, wenn der Anbieter ein Archiv kennt - sonst entfällt der Knopf. */
  archiveLabel: string | null;
  onArchive: (uid: number) => void;
  onSetSeen: (uid: number, seen: boolean) => void;
  onDelete: (uid: number) => void;
  onMove: (uid: number, targetFolder: string) => void;
}

function formatAddresses(addresses: { name?: string; address: string }[]): string {
  return addresses.map((a) => a.name || a.address).join(', ');
}

/**
 * Rendert HTML-Mailinhalt in einem sandboxed iframe statt per dangerouslySetInnerHTML,
 * damit eingebettete <script>-Tags aus (potenziell bösartigen) E-Mails nicht ausgeführt
 * werden können. "allow-same-origin" erlaubt nur das Auslesen der Höhe fürs Auto-Resize,
 * nicht aber Skriptausführung (kein "allow-scripts").
 */
function HtmlMailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;
    const resize = () => {
      const doc = iframe.contentDocument;
      if (doc?.body) {
        iframe.style.height = `${doc.body.scrollHeight + 20}px`;
      }
    };
    iframe.addEventListener('load', resize);
    return () => iframe.removeEventListener('load', resize);
  }, [html]);

  return (
    <iframe
      ref={ref}
      title="Nachrichteninhalt"
      srcDoc={html}
      sandbox="allow-same-origin"
      style={{ width: '100%', border: 'none' }}
    />
  );
}

export function MessageView({
  message,
  loading,
  folders,
  currentFolder,
  attachmentUrl,
  isInTrash,
  isDraft,
  canReplyAll,
  onReply,
  onForward,
  onEditDraft,
  archiveLabel,
  onArchive,
  onSetSeen,
  onDelete,
  onMove,
}: Props) {
  if (loading) {
    return <div className="reader empty-state">Lade Nachricht…</div>;
  }
  if (!message) {
    return <div className="reader empty-state">Keine Nachricht ausgewählt</div>;
  }

  const absender = message.from[0];

  return (
    <div className="reader">
      <div className="mail-head">
        <h2>{message.subject}</h2>
        <div className="mail-meta">
          <div className="mail-from">
            <span className="mail-from-name">{absender?.name || absender?.address || '(unbekannt)'}</span>
            {absender?.name && <span className="mail-from-address">&lt;{absender.address}&gt;</span>}
          </div>
          <span className="mail-date">
            {message.date ? new Date(message.date).toLocaleString('de-DE') : ''}
          </span>
        </div>
        <div className="mail-to" title={formatAddresses(message.to)}>
          an {formatAddresses(message.to) || '(unbekannt)'}
          {message.cc.length > 0 && <> · Kopie: {formatAddresses(message.cc)}</>}
        </div>
      </div>
      <div className="toolbar">
        {isDraft ? (
          <button className="btn" onClick={() => onEditDraft(message)}>
            Entwurf bearbeiten
          </button>
        ) : (
          <>
            <button className="btn" onClick={() => onReply(message, false)}>
              Antworten
            </button>
            {canReplyAll && (
              <button className="btn secondary" onClick={() => onReply(message, true)}>
                Allen antworten
              </button>
            )}
            <button className="btn secondary" onClick={() => onForward(message)}>
              Weiterleiten
            </button>
          </>
        )}
        {archiveLabel && (
          <button className="btn secondary" onClick={() => onArchive(message.uid)} title={archiveLabel}>
            Archivieren
          </button>
        )}
        <button className="btn secondary" onClick={() => onSetSeen(message.uid, !message.seen)}>
          {message.seen ? 'Als ungelesen' : 'Als gelesen'}
        </button>
        <button className="btn danger" onClick={() => onDelete(message.uid)}>
          {isInTrash ? 'Endgültig löschen' : 'Löschen'}
        </button>
        <select
          className="move-select"
          value=""
          onChange={(e) => {
            if (e.target.value) onMove(message.uid, e.target.value);
          }}
        >
          <option value="">Verschieben nach…</option>
          {moveTargets(folders, currentFolder).map((folder) => (
            <option key={folder.path} value={folder.path}>
              {folder.name}
            </option>
          ))}
        </select>
      </div>
      {message.html ? (
        <HtmlMailBody html={message.html} />
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{message.text}</pre>
      )}
      {message.attachments.length > 0 && (
        <div className="attachments">
          <strong>Anhänge ({message.attachments.length})</strong>
          <ul>
            {message.attachments.map((att, i) => (
              <li key={att.partId ?? i}>
                {att.partId ? (
                  <a href={attachmentUrl(att.partId)} download={att.filename ?? undefined}>
                    {att.filename ?? 'Anhang'}
                  </a>
                ) : (
                  <span>{att.filename ?? 'Anhang'} (nicht abrufbar)</span>
                )}
                <span className="attachment-size">{formatSize(att.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
