import { useEffect, useId, useRef, useState } from 'react';
import * as api from '../api.js';
import type { Draft, DraftAttachment } from '../api.js';
import type { Absender } from '../identitaeten.js';
import { pruefeAnhaenge } from '../anhangErinnerung.js';
import { bringtDateien } from '../ziehen.js';
import { bestaetige, frage, sendeVorschlaege, waehleZeitpunkt } from '../dialoge.js';
import { htmlToText } from '../htmlText.js';
import { AddressInput } from './AddressInput.js';
import { RichTextEditor } from './RichTextEditor.js';
import { Fenster } from './Fenster.js';
import {
  bausteinLoeschen,
  bausteinSichern,
  ladeBausteine,
  type Textbaustein,
} from '../textbausteine.js';
import { t, uhrzeit } from '../sprache.js';

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
  /** Kennung des Kontos - fuer die Frage, was mit OpenPGP moeglich ist. */
  accountId?: string | null;
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
    titel: t('Wann soll die Nachricht raus?'),
    text: t(
      'Bis dahin bleibt sie hier liegen. Läuft Energy Mail zu diesem Zeitpunkt nicht, geht sie beim nächsten Start hinaus.',
    ),
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
  accountId,
  onSaveDraft,
  onDiscardDraft,
  absender,
}: Props) {
  // Eine Kennung je Feld, damit die Beschriftung daneben darauf zeigen kann.
  const felder = useId();
  const [to, setTo] = useState(initial?.to?.join(', ') ?? '');
  const [cc, setCc] = useState(initial?.cc?.join(', ') ?? '');
  const [bcc, setBcc] = useState(initial?.bcc?.join(', ') ?? '');
  const [subject, setSubject] = useState(initial?.subject ?? '');
  const [html, setHtml] = useState(initial?.html ?? '');
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Ob und wie die Nachricht geschuetzt hinausgeht. */
  const [pgp, setPgp] = useState<'signieren' | 'verschluesseln' | undefined>(undefined);
  /**
   * Ob um eine Lesebestaetigung gebeten wird.
   *
   * Faellt bei jedem neuen Fenster auf aus zurueck, und das ist Absicht: Wer sie einmal
   * braucht, braucht sie nicht immer - und eine Bitte, die man vergessen hat, geht an
   * Leute hinaus, die sich darueber wundern.
   */
  const [lesebestaetigung, setLesebestaetigung] = useState(false);
  const [pgpLage, setPgpLage] = useState<api.PgpLage | null>(null);
  const [smimeLage, setSmimeLage] = useState<api.SmimeLage | null>(null);
  /**
   * Womit geschuetzt wird, wenn beides moeglich ist.
   *
   * Die Auswahl erscheint nur dann, wenn wirklich beides eingerichtet ist - was selten
   * vorkommt. Bei allen anderen bleibt die Leiste so schmal wie bisher und zeigt still
   * das, was sie haben.
   */
  const [verfahren, setVerfahren] = useState<'pgp' | 'smime'>('smime');
  /**
   * Ob gerade Dateien ueber dem Fenster haengen.
   *
   * Ein Zaehler statt eines Schalters: beim Ueberfahren feuert "dragleave" auch dann,
   * wenn der Zeiger nur von einem Kind zum naechsten wandert. Mit einem Schalter
   * flackerte die Flaeche bei jeder Bewegung.
   */
  const [ueberDatei, setUeberDatei] = useState(0);

  /**
   * Was mit OpenPGP moeglich waere - haengt am eigenen Schluessel und daran, ob fuer
   * jeden Empfaenger einer vorliegt. Neu gefragt, sobald sich die Empfaenger aendern.
   */
  useEffect(() => {
    if (!accountId) return;
    // to/cc/bcc sind Eingabezeilen, keine Listen - erst zerlegen.
    const alleEmpfaenger = [
      ...parseAddresses(to),
      ...parseAddresses(cc),
      ...parseAddresses(bcc),
    ];
    /*
     * Bewusst NICHT "t" - so hiess diese Variable, und damit verdeckte sie den
     * Uebersetzer aus sprache.js. Heute stoert das nichts, weil in diesem Block kein Text
     * uebersetzt wird; wer aber einmal einen hinzufuegt, bekaeme "t is not a function"
     * und suchte den Grund an der falschen Stelle.
     */
    const uhr = setTimeout(() => {
      api
        .ladePgpLage(accountId, alleEmpfaenger)
        .then(setPgpLage)
        .catch(() => setPgpLage(null));
      api
        .ladeSmimeLage(accountId, alleEmpfaenger)
        .then(setSmimeLage)
        .catch(() => setSmimeLage(null));
    }, 300);
    return () => clearTimeout(uhr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, to, cc, bcc]);

  /**
   * Welches der beiden Verfahren gerade gemeint ist.
   *
   * Ist nur eines eingerichtet, ist es dieses - unabhaengig davon, was gewaehlt wurde.
   * Sonst gilt die Wahl. So bekommt niemand eine Auswahl zu sehen, die fuer ihn aus
   * einem einzigen Punkt bestuende.
   */
  const beides = Boolean(pgpLage?.kannSignieren && smimeLage?.kannSignieren);
  const schutzVerfahren: 'pgp' | 'smime' = beides
    ? verfahren
    : smimeLage?.kannSignieren
      ? 'smime'
      : 'pgp';
  const lage = schutzVerfahren === 'smime' ? smimeLage : pgpLage;
  const ohneSchluessel =
    schutzVerfahren === 'smime'
      ? (smimeLage?.ohneZertifikat ?? [])
      : (pgpLage?.ohneSchluessel ?? []);

  // Faellt die Moeglichkeit weg, faellt auch die Absicht weg - sonst schiene die
  // Nachricht geschuetzt, waehrend der Versand sie unverschluesselt hinausliesse.
  useEffect(() => {
    if (pgp === 'verschluesseln' && lage && !lage.kannVerschluesseln) setPgp(undefined);
    if (pgp === 'signieren' && lage && !lage.kannSignieren) setPgp(undefined);
  }, [pgp, lage]);
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
        titel: t('Anhang vergessen?'),
        text: t('Im Text steht „{fundstelle}“, aber es hängt keine Datei an. Trotzdem senden?', {
          fundstelle: erinnerung.fundstelle ?? '',
        }),
        ok: t('Trotzdem senden'),
        abbrechen: t('Zurück zum Text'),
      });
      if (!trotzdem) return;
    }

    /**
     * Das Kennwort des geheimen Schluessels - bei jedem geschuetzten Versand neu.
     *
     * Es wird weder gespeichert noch im Entwurf abgelegt: sonst laege es im
     * Entwuerfe-Ordner auf dem Server des Anbieters, und der Sinn der Sache waere dahin.
     */
    let kennwort: string | undefined;
    /*
     * Bei S/MIME nur dann, wenn der Schluessel auch mit einem Kennwort abgelegt wurde.
     * Wer beim Einlesen keines vergeben hat, hat sich fuer den anderen Tausch
     * entschieden - dann hier danach zu fragen waere eine Frage ohne Antwort.
     */
    const brauchtKennwort =
      Boolean(pgp) && (schutzVerfahren === 'pgp' || Boolean(smimeLage?.brauchtKennwort));
    if (brauchtKennwort) {
      const eingabe = await frage({
        titel: t('Kennwort Ihres Schlüssels'),
        text:
          pgp === 'verschluesseln'
            ? t(
                'Zum Verschlüsseln und Unterschreiben wird Ihr geheimer Schlüssel gebraucht. Das Kennwort wird nicht gespeichert.',
              )
            : t(
                'Zum Unterschreiben wird Ihr geheimer Schlüssel gebraucht. Das Kennwort wird nicht gespeichert.',
              ),
        ok: t('Senden'),
        geheim: true,
      });
      if (eingabe === null) return;
      kennwort = eingabe || undefined;

      if (accountId) {
        const { stimmt } =
          schutzVerfahren === 'smime'
            ? await api.pruefeSmimeKennwort(accountId, kennwort ?? '')
            : await api.pruefePgpKennwort(accountId, kennwort ?? '');
        if (!stimmt) {
          setError(t('Das Kennwort des Schlüssels stimmt nicht.'));
          return;
        }
      }
    }

    setBusy(true);
    try {
      await onSend(
        {
          ...buildDraft(),
          // Genau eines von beiden wird gesetzt - der Server weist es sonst ab.
          pgp: schutzVerfahren === 'pgp' ? pgp : undefined,
          pgpKennwort: schutzVerfahren === 'pgp' ? kennwort : undefined,
          smime: schutzVerfahren === 'smime' ? pgp : undefined,
          smimeKennwort: schutzVerfahren === 'smime' ? kennwort : undefined,
          lesebestaetigung: lesebestaetigung || undefined,
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
    const wahl = await bestaetige({
      titel: t('Die Nachricht wurde geändert.'),
      text: t(
        'Soll sie als Entwurf gespeichert werden? Der Entwurf liegt danach im Entwürfe-Ordner und lässt sich jederzeit weiterschreiben.',
      ),
      ok: t('Als Entwurf speichern'),
      abbrechen: t('Weiter bearbeiten'),
      // Ohne diesen dritten Weg sass man fest: ein aus Versehen getipptes Zeichen
      // liess sich nicht mehr loswerden, ohne einen Entwurf im echten Postfach zu
      // hinterlassen. Der einzige Ausweg war, den Text von Hand ganz zu loeschen.
      verwerfen: t('Verwerfen'),
    });
    if (wahl === 'verwerfen') {
      onClose();
      return;
    }
    if (!wahl) return;
    if (await speichern()) onClose();
  };

  const verwerfen = async () => {
    const ja = await bestaetige({
      titel: t('Entwurf verwerfen?'),
      text: t('Der geschriebene Inhalt geht verloren. Das lässt sich nicht rückgängig machen.'),
      stil: 'gefahr',
      ok: t('Verwerfen'),
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
    /*
     * Der Weg hinaus ist hier ein eigener: nur an dieser Stelle ist bekannt, ob etwas
     * geschrieben wurde, das verlorengehen könnte. Escape und der Klick daneben nehmen
     * deshalb denselben Weg wie der Schließen-Knopf - mit Rückfrage und dem Angebot,
     * als Entwurf zu sichern.
     */
    <Fenster
      titel={title}
      onClose={() => void schliessen()}
      klasse={`modal-wide${ueberDatei > 0 ? ' datei-ueber' : ''}`}
      rahmenZusatz={{
        onDragEnter: (e: React.DragEvent) => {
          if (bringtDateien([...e.dataTransfer.types])) setUeberDatei((n) => n + 1);
        },
        onDragOver: (e: React.DragEvent) => {
          // Ohne preventDefault oeffnet der Browser die Datei einfach im Fenster - und
          // die Nachricht, an der man gerade schreibt, ist weg.
          if (bringtDateien([...e.dataTransfer.types])) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        },
        onDragLeave: () => setUeberDatei((n) => Math.max(0, n - 1)),
        onDrop: (e: React.DragEvent) => {
          if (!bringtDateien([...e.dataTransfer.types])) return;
          e.preventDefault();
          setUeberDatei(0);
          void addFiles(e.dataTransfer.files);
        },
      }}
    >
      {ueberDatei > 0 && (
        <div className="datei-flaeche" aria-hidden="true">{t('Dateien hier ablegen, um sie anzuhängen')}</div>
      )}
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
          {/* Der Knopf stand im Etikett - ein Klick darauf sprang zugleich ins Feld
              daneben. Nebeneinander bleiben sie trotzdem. */}
          <div className="etikett-zeile">
            <label htmlFor={`${felder}-an`}>An</label>
            {!showCopyFields && (
              <button
                type="button"
                className="link-btn"
                aria-expanded={false}
                onClick={() => setShowCopyFields(true)}
              >
                + Kopie / Blindkopie
              </button>
            )}
          </div>
          <AddressInput
            id={`${felder}-an`}
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
              <label htmlFor={`${felder}-cc`}>{t('Kopie (CC)')}</label>
              <AddressInput
                id={`${felder}-cc`}
                value={cc}
                onChange={(v) => {
                  setCc(v);
                  markDirty();
                }}
                disabled={busy}
                placeholder={t('sichtbar für alle')}
              />
            </div>
            <div className="form-row">
              <label htmlFor={`${felder}-bcc`}>{t('Blindkopie (BCC)')}</label>
              <AddressInput
                id={`${felder}-bcc`}
                value={bcc}
                onChange={(v) => {
                  setBcc(v);
                  markDirty();
                }}
                disabled={busy}
                placeholder={t('für andere Empfänger nicht sichtbar')}
              />
            </div>
          </>
        )}

        <div className="form-row">
          <label htmlFor={`${felder}-betreff`}>{t('Betreff')}</label>
          <input
            id={`${felder}-betreff`}
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
          <span className="feld-titel">{t('Nachricht')}</span>
          <RichTextEditor
            beschriftung="Nachricht"
            html={html}
            disabled={busy}
            onChange={(v) => {
              setHtml(v);
              markDirty();
            }}
          />
        </div>

        <div className="form-row">
          <label htmlFor={`${felder}-anhaenge`}>
            Anhänge{attachments.length > 0 && ` (${attachments.length}, ${formatSize(totalBytes)})`}
          </label>
          <input
            id={`${felder}-anhaenge`}
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
                    title={t('Anhang entfernen')}
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
              ? t('Entwurf wird gespeichert…')
              : savedAt
                ? t('Entwurf gespeichert um {uhr}', { uhr: uhrzeit(savedAt) })
                : dirty
                  ? t('Nicht gespeicherte Änderungen')
                  : ''}
          </span>
          {lage?.kannSignieren && (
            <div className="pgp-wahl">
              <span className="pgp-wahl-titel">{t('Schutz')}</span>
              {/*
                Die Wahl des Verfahrens erscheint nur, wenn wirklich beides eingerichtet
                ist. Das ist selten - fast jeder hat entweder das eine oder das andere -,
                und wer nur eines hat, soll keine Auswahl vor sich haben, die aus einem
                Punkt besteht.
              */}
              {beides && (
                <select
                  className="pgp-verfahren"
                  value={verfahren}
                  onChange={(e) => setVerfahren(e.target.value as 'pgp' | 'smime')}
                  aria-label={t('Verfahren')}
                >
                  <option value="smime">S/MIME</option>
                  <option value="pgp">OpenPGP</option>
                </select>
              )}
              {(
                [
                  [undefined, t('ohne')],
                  ['signieren', t('unterschreiben')],
                  ['verschluesseln', t('verschlüsseln')],
                ] as const
              ).map(([wert, wort]) => (
                <label
                  key={wort}
                  className={wert === 'verschluesseln' && !lage.kannVerschluesseln ? 'aus' : ''}
                  title={
                    wert === 'verschluesseln' && !lage.kannVerschluesseln
                      ? ohneSchluessel.length > 0
                        ? t('Kein Schlüssel für: {adressen}', {
                            adressen: ohneSchluessel.join(', '),
                          })
                        : t('Zuerst einen Empfänger angeben')
                      : undefined
                  }
                >
                  <input
                    type="radio"
                    name="pgp-schutz"
                    checked={pgp === wert}
                    disabled={wert === 'verschluesseln' && !lage.kannVerschluesseln}
                    onChange={() => setPgp(wert)}
                  />
                  {wort}
                </label>
              ))}
              {pgp && attachments.length > 0 && (
                <span className="pgp-wahl-hinweis">{t('Anhänge lassen sich noch nicht mitschützen – bitte ohne senden.')}</span>
              )}
            </div>
          )}

          {/*
            Die Bitte um eine Lesebestaetigung - neben den PGP-Schaltern, weil beides
            dasselbe ist: eine Eigenschaft dieser einen Nachricht, kein Dauerzustand.
          */}
          <label className="compose-lesebest">
            <input
              type="checkbox"
              checked={lesebestaetigung}
              onChange={(e) => setLesebestaetigung(e.target.checked)}
              disabled={busy}
            />
            <span>{t('Lesebestätigung anfordern')}</span>
            <span className="hint">
              {t('Der Empfänger entscheidet, ob er eine schickt – viele Programme fragen nach, manche antworten nie.')}
            </span>
          </label>

          <div className="compose-actions">
            {location.current?.uid && (
              <button type="button" className="btn danger" onClick={() => void verwerfen()} disabled={busy}>{t('Verwerfen')}</button>
            )}
            <button
              type="button"
              className="btn secondary"
              onClick={() => void speichern()}
              disabled={busy || saving}
            >{t('Als Entwurf speichern')}</button>
            <button type="button" className="btn secondary" onClick={() => void schliessen()} disabled={busy}>{t('Schließen')}</button>
            <select
              className="baustein-wahl"
              value=""
              disabled={busy}
              title={t('Textbaustein einfügen oder verwalten')}
              onChange={(e) => {
                const wert = e.target.value;
                if (!wert) return;

                if (wert === '__sichern') {
                  void frage({
                    titel: t('Text als Baustein sichern'),
                    text: t('Unter diesem Namen steht er künftig in der Auswahl.'),
                    platzhalter: t('z. B. Freundlicher Gruß'),
                    ok: t('Sichern'),
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
                    titel: t('Welchen Baustein löschen?'),
                    text: `${t('Vorhanden:')}\n${bausteine.map((b) => `· ${b.name}`).join('\n')}`,
                    stil: 'gefahr',
                    ok: t('Löschen'),
                    pruefe: (name) =>
                      name && !treffer(name) ? t('„{name}“ gibt es nicht.', { name }) : null,
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
              <option value="">{t('Baustein…')}</option>
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
              title={t('Zu einem späteren Zeitpunkt senden')}
              onClick={(e) => {
                e.preventDefault();
                void frageZeitpunkt().then((zeitpunkt) => {
                  if (zeitpunkt) void submit(e, zeitpunkt);
                });
              }}
            >{t('Später…')}</button>
            <button type="submit" className="btn" disabled={busy}>
              {busy ? 'Sende…' : 'Senden'}
            </button>
          </div>
        </div>
      </form>
    </Fenster>
  );
}
