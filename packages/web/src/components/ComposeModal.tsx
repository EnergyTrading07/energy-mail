import { useEffect, useRef, useState } from 'react';
import type { Draft, DraftAttachment } from '../api.js';
import type { Absender } from '../identitaeten.js';
import { pruefeAnhaenge } from '../anhangErinnerung.js';
import { bestaetige, frage, sendeVorschlaege, waehleZeitpunkt } from '../dialoge.js';
import { htmlToText } from '../htmlText.js';
import { AddressInput } from './AddressInput.js';
import { RichTextEditor } from './RichTextEditor.js';
import {
  bausteinLoeschen,
  bausteinSichern,
  ladeBausteine,
  type Textbaustein,
} from '../textbausteine.js';

interface Props {
  initial?: Partial<Draft>;
  title?: string;
  /** Ort einer bereits gespeicherten Fassung - wird beim Speichern ersetzt. */
  draftLocation?: { folder: string; uid: number | null };
  onClose: () => void;
  onSend: (draft: Draft, sendenAm?: string) => Promise<void>;
  onSaveDraft: (draft: Draft) => Promise<{ folder: string; uid: number | null }>;
  onDiscardDraft?: () => Promise<void>;
  /** Alle eigenen Adressen des Kontos - die erste ist die des Kontos selbst. */
  absender?: Absender[];
}

/** Muss zum bodyLimit des Servers passen (40 MB inkl. Base64-Aufschlag). */
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const AUTOSAVE_DELAY_MS = 8000;

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * Fragt einen Sendezeitpunkt ab.
 *
 * Bewusst mit Vorschlägen statt eines freien Datumsfeldes: "morgen früh" ist der
 * überwiegende Fall, und ein Zeitpunkt, den man aus Ziffern zusammensetzt, wird leicht
 * zum falschen Tag. Die Vorschläge und ihre Prüfung stehen in dialoge.tsx, weil die
 * Wiedervorlage dieselbe Frage stellt - bis dahin gab es beides doppelt, mit
 * unterschiedlichen Vorschlägen und unterschiedlichen Fehlermeldungen.
 *
 * Liefert null, wenn abgebrochen wurde.
 */
async function frageZeitpunkt(): Promise<string | null> {
  const gewaehlt = await waehleZeitpunkt({
    titel: 'Wann soll die Nachricht raus?',
    text: 'Bis dahin bleibt sie hier liegen. Läuft Energy Mail zu diesem Zeitpunkt nicht, geht sie beim nächsten Start hinaus.',
    vorschlaege: sendeVorschlaege(),
  });
  return gewaehlt ? gewaehlt.toISOString() : null;
}

function parseAddresses(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** FileReader liefert eine data:-URL - für den Versand wird nur der Base64-Teil gebraucht. */
function readAsAttachment(file: File): Promise<DraftAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`"${file.name}" konnte nicht gelesen werden.`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        contentBase64: result.slice(result.indexOf(',') + 1),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function ComposeModal({
  initial,
  title = 'Neue Nachricht',
  draftLocation,
  onClose,
  onSend,
  onSaveDraft,
  onDiscardDraft,
  absender,
}: Props) {
  const [to, setTo] = useState(initial?.to?.join(', ') ?? '');
  const [cc, setCc] = useState(initial?.cc?.join(', ') ?? '');
  const [bcc, setBcc] = useState(initial?.bcc?.join(', ') ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [html, setHtml] = useState(initial?.html ?? '');
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCopyFields, setShowCopyFields] = useState(
    Boolean(initial?.cc?.length || initial?.bcc?.length),
  );

  const [bausteine, setBausteine] = useState<Textbaustein[]>(() => ladeBausteine());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const location = useRef(draftLocation);
  // Zählt Änderungen seit dem letzten Speichern - null heißt "nichts Ungesichertes".
  const [dirty, setDirty] = useState(false);

  const totalBytes = attachments.reduce((sum, att) => sum + att.size, 0);

  /**
   * Unter welcher Adresse gesendet wird. Beim Antworten hat der Aufrufer schon die
   * richtige ausgesucht - hier wird sie nur noch aufgenommen und ist aenderbar.
   */
  const auswahl = absender ?? [];
  const [absenderId, setAbsenderId] = useState<string>(
    initial?.absender?.email
      ? (auswahl.find((a) => a.email === initial.absender?.email)?.id ?? '')
      : '',
  );
  const gewaehlt = auswahl.find((a) => (a.id ?? '') === absenderId) ?? auswahl[0];

  const buildDraft = (): Draft => ({
    ...initial,
    to: parseAddresses(to),
    cc: showCopyFields ? parseAddresses(cc) : undefined,
    bcc: showCopyFields ? parseAddresses(bcc) : undefined,
    subject,
    html,
    // Textfassung immer mitschicken: Empfänger ohne HTML-Anzeige sähen sonst nichts.
    text: htmlToText(html),
    attachments: attachments.length > 0 ? attachments : undefined,
    // Nur mitgeben, wenn es nicht die Adresse des Kontos ist - sonst trüge jeder
    // Entwurf eine Angabe, die ohnehin dem Standard entspricht.
    absender: gewaehlt?.id
      ? { email: gewaehlt.email, displayName: gewaehlt.displayName }
      : undefined,
  });

  const markDirty = () => {
    setDirty(true);
    setSavedAt(null);
  };

  const speichern = async (): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    try {
      const ziel = await onSaveDraft({
        ...buildDraft(),
        draftFolder: location.current?.folder,
        draftUid: location.current?.uid ?? undefined,
      });
      location.current = ziel;
      setSavedAt(new Date());
      setDirty(false);
      return true;
    } catch (err) {
      setError(`Entwurf konnte nicht gespeichert werden: ${(err as Error).message}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Automatisch speichern, wenn eine Weile nichts mehr getippt wurde.
  useEffect(() => {
    if (!dirty || busy) return;
    const timer = setTimeout(() => void speichern(), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, busy, to, cc, bcc, subject, html, attachments]);

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const added = await Promise.all(Array.from(files).map(readAsAttachment));
      const next = [...attachments, ...added];
      const nextTotal = next.reduce((sum, att) => sum + att.size, 0);
      if (nextTotal > MAX_TOTAL_BYTES) {
        setError(
          `Anhänge zusammen ${formatSize(nextTotal)} - erlaubt sind ${formatSize(MAX_TOTAL_BYTES)}.`,
        );
        return;
      }
      setAttachments(next);
      markDirty();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submit = async (e: React.FormEvent, sendenAm?: string) => {
    e.preventDefault();
    setError(null);

    // Angekündigt, aber nichts angehängt? Lieber einmal fragen als hinterher nachreichen.
    const erinnerung = pruefeAnhaenge(subject, htmlToText(html), attachments.length);
    if (erinnerung.nachfragen) {
      const trotzdem = await bestaetige({
        titel: 'Anhang vergessen?',
        text:
          `Im Text steht „${erinnerung.fundstelle}“, aber es hängt keine Datei an. ` +
          'Trotzdem senden?',
        ok: 'Trotzdem senden',
        abbrechen: 'Zurück zum Text',
      });
      if (!trotzdem) return;
    }

    setBusy(true);
    try {
      await onSend(
        {
          ...buildDraft(),
          // Nach dem Versand entfernt der Server den zugehörigen Entwurf.
          draftFolder: location.current?.folder,
          draftUid: location.current?.uid ?? undefined,
        },
        sendenAm,
      );
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Beim Schließen nicht stillschweigend verwerfen, sondern nachfragen. */
  const schliessen = async () => {
    const leer = !to && !subject && !htmlToText(html).trim() && attachments.length === 0;
    if (leer || (!dirty && !location.current?.uid)) {
      onClose();
      return;
    }
    if (!dirty && location.current?.uid) {
      onClose();
      return;
    }

    // Die Beschriftungen sagen, was geschieht. Vorher stand hier "OK / Abbrechen" mit
    // einer Erklärung im Fließtext darüber, weil das Browserfenster nichts anderes
    // zuließ - und "Abbrechen" für "weiter bearbeiten" ist genau verkehrt herum.
    const speichernJa = await bestaetige({
      titel: 'Die Nachricht wurde geändert.',
      text: 'Soll sie als Entwurf gespeichert werden? Der Entwurf liegt danach im Entwürfe-Ordner und lässt sich jederzeit weiterschreiben.',
      ok: 'Als Entwurf speichern',
      abbrechen: 'Weiter bearbeiten',
    });
    if (!speichernJa) return;
    if (await speichern()) onClose();
  };

  /**
   * Esc schließt das Fenster - über denselben Weg wie der Klick daneben, also mit
   * Rückfrage und Angebot, als Entwurf zu sichern. Bewusst hier und nicht in der
   * allgemeinen Tastaturbehandlung: nur an dieser Stelle ist bekannt, ob überhaupt
   * etwas geschrieben wurde, das verlorengehen könnte.
   */
  useEffect(() => {
    const beiTaste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void schliessen();
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  });

  const verwerfen = async () => {
    const ja = await bestaetige({
      titel: 'Entwurf verwerfen?',
      text: 'Der geschriebene Inhalt geht verloren. Das lässt sich nicht rückgängig machen.',
      stil: 'gefahr',
      ok: 'Verwerfen',
    });
    if (!ja) return;
    if (location.current?.uid && onDiscardDraft) {
      try {
        await onDiscardDraft();
      } catch (err) {
        setError((err as Error).message);
        return;
      }
    }
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={() => void schliessen()}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <form onSubmit={submit}>
          {/* Nur zeigen, wenn es etwas zu wählen gibt - bei einem Konto ohne weitere
              Adressen wäre die Zeile bloßes Beiwerk. */}
          {auswahl.length > 1 && (
            <div className="form-row">
              <label htmlFor="absenderwahl">Von</label>
              <select
                id="absenderwahl"
                value={absenderId}
                disabled={busy}
                onChange={(e) => {
                  setAbsenderId(e.target.value);
                  markDirty();
                }}
              >
                {auswahl.map((a) => (
                  <option key={a.id ?? ''} value={a.id ?? ''}>
                    {a.displayName ? `${a.displayName} <${a.email}>` : a.email}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="form-row">
            <label>
              An
              {!showCopyFields && (
                <button type="button" className="link-btn" onClick={() => setShowCopyFields(true)}>
                  + Kopie / Blindkopie
                </button>
              )}
            </label>
            <AddressInput
              value={to}
              onChange={(v) => {
                setTo(v);
                markDirty();
              }}
              required
              disabled={busy}
              placeholder="a@b.de, c@d.de"
            />
          </div>

          {showCopyFields && (
            <>
              <div className="form-row">
                <label>Kopie (CC)</label>
                <AddressInput
                  value={cc}
                  onChange={(v) => {
                    setCc(v);
                    markDirty();
                  }}
                  disabled={busy}
                  placeholder="sichtbar für alle"
                />
              </div>
              <div className="form-row">
                <label>Blindkopie (BCC)</label>
                <AddressInput
                  value={bcc}
                  onChange={(v) => {
                    setBcc(v);
                    markDirty();
                  }}
                  disabled={busy}
                  placeholder="für andere Empfänger nicht sichtbar"
                />
              </div>
            </>
          )}

          <div className="form-row">
            <label>Betreff</label>
            <input
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                markDirty();
              }}
              required
              disabled={busy}
            />
          </div>

          <div className="form-row">
            <label>Nachricht</label>
            <RichTextEditor
              html={html}
              disabled={busy}
              onChange={(v) => {
                setHtml(v);
                markDirty();
              }}
            />
          </div>

          <div className="form-row">
            <label>
              Anhänge{attachments.length > 0 && ` (${attachments.length}, ${formatSize(totalBytes)})`}
            </label>
            <input
              type="file"
              multiple
              disabled={busy}
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            {initial?.attachOriginal && initial.attachOriginal.filenames.length > 0 && (
              <ul className="draft-attachments">
                {initial.attachOriginal.filenames.map((name, i) => (
                  <li key={`orig-${i}`}>
                    <span className="draft-attachment-name">{name}</span>
                    <span className="attachment-size">aus der Originalnachricht</span>
                  </li>
                ))}
              </ul>
            )}
            {attachments.length > 0 && (
              <ul className="draft-attachments">
                {attachments.map((att, i) => (
                  <li key={`${att.filename}-${i}`}>
                    <span className="draft-attachment-name">{att.filename}</span>
                    <span className="attachment-size">{formatSize(att.size)}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Anhang entfernen"
                      disabled={busy}
                      onClick={() => {
                        setAttachments((prev) => prev.filter((_, index) => index !== i));
                        markDirty();
                      }}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <div className="error-banner">{error}</div>}

          <div className="compose-footer">
            <span className="draft-state">
              {saving
                ? 'Entwurf wird gespeichert…'
                : savedAt
                  ? `Entwurf gespeichert um ${savedAt.toLocaleTimeString('de-DE')}`
                  : dirty
                    ? 'Nicht gespeicherte Änderungen'
                    : ''}
            </span>
            <div className="compose-actions">
              {location.current?.uid && (
                <button type="button" className="btn danger" onClick={() => void verwerfen()} disabled={busy}>
                  Verwerfen
                </button>
              )}
              <button
                type="button"
                className="btn secondary"
                onClick={() => void speichern()}
                disabled={busy || saving}
              >
                Als Entwurf speichern
              </button>
              <button type="button" className="btn secondary" onClick={() => void schliessen()} disabled={busy}>
                Schließen
              </button>
              <select
                className="baustein-wahl"
                value=""
                disabled={busy}
                title="Textbaustein einfügen oder verwalten"
                onChange={(e) => {
                  const wert = e.target.value;
                  if (!wert) return;

                  if (wert === '__sichern') {
                    void frage({
                      titel: 'Text als Baustein sichern',
                      text: 'Unter diesem Namen steht er künftig in der Auswahl.',
                      platzhalter: 'z. B. Freundlicher Gruß',
                      ok: 'Sichern',
                    }).then((name) => name && setBausteine(bausteinSichern(name, html)));
                    return;
                  }

                  if (wert === '__loeschen') {
                    // Die vorhandenen Namen stehen mit in der Frage, und die Prüfung
                    // meldet einen Tippfehler am Feld. Vorher kam dafür ein zweites
                    // Fenster ("… gibt es nicht"), nachdem das erste schon zu war.
                    const treffer = (name: string) =>
                      bausteine.find((b) => b.name.toLowerCase() === name.toLowerCase());
                    void frage({
                      titel: 'Welchen Baustein löschen?',
                      text: `Vorhanden:\n${bausteine.map((b) => `· ${b.name}`).join('\n')}`,
                      stil: 'gefahr',
                      ok: 'Löschen',
                      pruefe: (name) =>
                        name && !treffer(name) ? `"${name}" gibt es nicht.` : null,
                    }).then((name) => {
                      const b = name && treffer(name);
                      if (b) setBausteine(bausteinLoeschen(b.id));
                    });
                    return;
                  }

                  const baustein = bausteine.find((b) => b.id === wert);
                  if (baustein) {
                    // Anhängen statt ersetzen: der Baustein ergaenzt das Geschriebene,
                    // er tritt nicht an seine Stelle.
                    setHtml((vorher) => vorher + baustein.html);
                    markDirty();
                  }
                }}
              >
                <option value="">Baustein…</option>
                {bausteine.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
                <option value="__sichern">— Text als Baustein sichern</option>
                {bausteine.length > 0 && <option value="__loeschen">— Baustein löschen</option>}
              </select>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                title="Zu einem späteren Zeitpunkt senden"
                onClick={(e) => {
                  e.preventDefault();
                  void frageZeitpunkt().then((zeitpunkt) => {
                    if (zeitpunkt) void submit(e, zeitpunkt);
                  });
                }}
              >
                Später…
              </button>
              <button type="submit" className="btn" disabled={busy}>
                {busy ? 'Sende…' : 'Senden'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
