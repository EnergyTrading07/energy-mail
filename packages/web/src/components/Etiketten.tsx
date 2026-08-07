import { useEffect, useRef, useState } from 'react';
import type { Etikett } from '@energy-mail/mail-core';
import { etikettenAusFlags, pruefeEtikettName } from '@energy-mail/mail-core/etiketten';
import * as api from '../api.js';
import { bestaetige } from '../dialoge.js';
import { meldeFehler, meldeWarnung } from '../meldungen.js';

/**
 * Die Anzeige und Vergabe von Etiketten.
 *
 * Etiketten liegen als IMAP-Schlüsselwörter auf dem Mailserver, nicht hier. Was hier
 * liegt, ist Name und Farbe - und die Bedienung.
 */

/** Die farbigen Marken an einer Nachricht. */
export function EtikettMarken({
  flags,
  bekannte,
  wenige,
}: {
  flags: string[];
  bekannte: Etikett[];
  /** In der Liste ist wenig Platz: dort nur Farbpunkte statt ausgeschriebener Namen. */
  wenige?: boolean;
}) {
  const etiketten = etikettenAusFlags(flags, bekannte);
  if (etiketten.length === 0) return null;

  if (wenige) {
    return (
      <span className="etikett-punkte" title={etiketten.map((e) => e.name).join(', ')}>
        {etiketten.slice(0, 4).map((e) => (
          <span key={e.schluessel} className="etikett-punkt" style={{ background: e.farbe }} />
        ))}
      </span>
    );
  }

  return (
    <span className="etikett-marken">
      {etiketten.map((e) => (
        <span
          key={e.schluessel}
          className="etikett-marke"
          style={{ background: `${e.farbe}22`, color: e.farbe, borderColor: `${e.farbe}55` }}
        >
          {e.name}
        </span>
      ))}
    </span>
  );
}

interface MenueProps {
  /** Alle bekannten Etiketten. */
  bekannte: Etikett[];
  /** Die Flags der betroffenen Nachricht(en) - daraus ergibt sich, was schon hängt. */
  flags: string[];
  /** Ob der Ordner Etiketten dauerhaft behält; null heißt "noch nicht gefragt". */
  dauerhaft: boolean | null;
  onSetzen: (schluessel: string, an: boolean) => void | Promise<void>;
  onVerzeichnisGeaendert: (etiketten: Etikett[]) => void;
  onClose: () => void;
}

/**
 * Das Menü zum Anhängen und Abnehmen.
 *
 * Ein neues Etikett lässt sich hier gleich anlegen - der Umweg über eine Verwaltung wäre
 * genau in dem Augenblick im Weg, in dem man merkt, dass eines fehlt.
 */
export function EtikettMenue({
  bekannte,
  flags,
  dauerhaft,
  onSetzen,
  onVerzeichnisGeaendert,
  onClose,
}: MenueProps) {
  const [neu, setNeu] = useState('');
  const [busy, setBusy] = useState(false);
  const kasten = useRef<HTMLDivElement>(null);

  // Ein Klick daneben oder die Fluchttaste schließt - so wie jedes andere Menü auch.
  useEffect(() => {
    const daneben = (e: MouseEvent) => {
      if (kasten.current && !kasten.current.contains(e.target as Node)) onClose();
    };
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Verzögert anmelden: sonst fängt der Klick, der das Menü öffnet, es gleich wieder ein.
    const t = setTimeout(() => document.addEventListener('mousedown', daneben), 0);
    document.addEventListener('keydown', taste);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', daneben);
      document.removeEventListener('keydown', taste);
    };
  }, [onClose]);

  const haengtSchon = (schluessel: string) =>
    flags.some((f) => f.toLowerCase() === schluessel.toLowerCase());

  const anlegen = async () => {
    const meldung = pruefeEtikettName(neu, bekannte);
    if (meldung) {
      meldeWarnung('Das geht so nicht', meldung);
      return;
    }
    setBusy(true);
    try {
      const angelegt = await api.speichereEtikett({ name: neu.trim() });
      onVerzeichnisGeaendert(await api.ladeEtiketten());
      setNeu('');
      // Gleich anhängen: wer es hier anlegt, will es an dieser Nachricht haben.
      await onSetzen(angelegt.schluessel, true);
    } catch (err) {
      meldeFehler('Etikett nicht angelegt', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const entfernen = async (etikett: Etikett) => {
    const ja = await bestaetige({
      titel: `Etikett „${etikett.name}“ löschen?`,
      text: 'Nachrichten, die es tragen, behalten das Schlüsselwort auf dem Server – dort steht danach nur noch der nackte Name in Grau. Legen Sie das Etikett unter demselben Namen wieder an, sind sie wieder eingeordnet.',
      stil: 'warnung',
      ok: 'Löschen',
    });
    if (!ja) return;
    await api.loescheEtikett(etikett.schluessel);
    onVerzeichnisGeaendert(await api.ladeEtiketten());
  };

  return (
    <div className="etikett-menue" ref={kasten} role="menu">
      {dauerhaft === false && (
        <p className="hint etikett-warnung">
          Dieser Ordner behält eigene Etiketten nicht – der Server vergisst sie beim
          Schließen wieder.
        </p>
      )}

      {bekannte.map((etikett) => (
        <div key={etikett.schluessel} className="etikett-zeile">
          <label>
            <input
              type="checkbox"
              checked={haengtSchon(etikett.schluessel)}
              onChange={(e) => void onSetzen(etikett.schluessel, e.target.checked)}
            />
            <span className="etikett-farbe" style={{ background: etikett.farbe }} />
            {etikett.name}
          </label>
          <button
            className="link-btn gefaehrlich"
            onClick={() => void entfernen(etikett)}
            aria-label={`Etikett ${etikett.name} löschen`}
            title="Etikett aus dem Verzeichnis nehmen"
          >
            ×
          </button>
        </div>
      ))}

      <form
        className="etikett-neu"
        onSubmit={(e) => {
          e.preventDefault();
          void anlegen();
        }}
      >
        <input
          value={neu}
          onChange={(e) => setNeu(e.target.value)}
          placeholder="Neues Etikett"
          aria-label="Name des neuen Etiketts"
          disabled={busy}
        />
        <button className="link-btn" type="submit" disabled={busy || !neu.trim()}>
          Anlegen
        </button>
      </form>
    </div>
  );
}
