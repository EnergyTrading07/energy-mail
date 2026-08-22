import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { datum, t } from '../sprache.js';

/**
 * Die Desktop-Fassung herunterladen.
 *
 * Erscheint nur im Browserbetrieb - wer die Hülle vor sich hat, hat sie ja schon. Und nur
 * dort, wo der Betreiber tatsächlich etwas hinterlegt hat: Ein Knopf, hinter dem nichts
 * liegt, ist eine Enttäuschung mit Ankündigung.
 *
 * Die Dateien kommen vom eigenen Server und nicht von einer fremden Seite. Für einen
 * Betrieb ist das meist der Grund, warum er selbst betreibt - die Arbeitsplätze sollen
 * nicht ins offene Netz, und welche Fassung sie bekommen, entscheidet er.
 */

/** Bytes in etwas, das ein Mensch liest. */
function groesse(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  if (mb >= 1) return `${mb.toFixed(0)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function systemname(system: api.Downloaddatei['system']): string {
  if (system === 'windows') return t('Windows');
  if (system === 'mac') return t('macOS');
  if (system === 'linux') return t('Linux');
  return t('Unbekanntes System');
}

/**
 * Auf welchem System dieser Browser läuft - für die Reihenfolge.
 *
 * Nur zum Sortieren, nicht zum Ausblenden: Wer von seinem Windows-Rechner aus die
 * Fassung für den Mac im Nebenzimmer holen will, soll das können. Oben steht trotzdem
 * das, was der Mensch mit einiger Wahrscheinlichkeit meint.
 */
function eigenesSystem(): api.Downloaddatei['system'] {
  const kennung = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase();
  if (kennung.includes('win')) return 'windows';
  if (kennung.includes('mac')) return 'mac';
  if (kennung.includes('linux') || kennung.includes('x11')) return 'linux';
  return 'unbekannt';
}

export function DownloadTeil() {
  const [dateien, setDateien] = useState<api.Downloaddatei[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    api
      .downloads()
      .then((antwort) => {
        if (!abgebrochen) setDateien(antwort.dateien ?? []);
      })
      .catch((err) => {
        if (!abgebrochen) setFehler((err as Error).message);
      });
    return () => {
      abgebrochen = true;
    };
  }, []);

  const meins = eigenesSystem();
  const sortiert = [...(dateien ?? [])].sort((a, b) => {
    if (a.system === b.system) return a.name.localeCompare(b.name);
    if (a.system === meins) return -1;
    if (b.system === meins) return 1;
    return a.system.localeCompare(b.system);
  });

  return (
    <section className="modal eingebettet">
      <h3>{t('Energy Mail auf dem Rechner')}</h3>
      <p className="hint">
        {t('Dieselbe Anwendung als Programm für Ihren Rechner: Sie meldet sich an diesem Server an und zeigt dieselben Postfächer. Benachrichtigungen und der Infobereich kommen dazu.')}
      </p>

      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}
      {!dateien && !fehler && <p className="hint">{t('Wird geladen…')}</p>}

      {dateien && dateien.length === 0 && (
        <p className="hint">
          {t('Der Betreiber dieses Dienstes hat noch keine Fassung hinterlegt. Fragen Sie ihn danach.')}
        </p>
      )}

      {sortiert.length > 0 && (
        <ul className="download-liste">
          {sortiert.map((d) => (
            <li key={d.name}>
              <div className="download-angaben">
                <strong>{systemname(d.system)}</strong>
                <span className="hint">
                  {d.name} · {groesse(d.groesse)} · {t('Stand')} {datum(new Date(d.stand))}
                </span>
              </div>
              {/*
                Ein gewoehnlicher Link mit `download` und nicht ein Knopf mit fetch: Der
                Browser kann grosse Dateien besser als diese Anwendung - er zeigt einen
                Fortschritt, kann fortsetzen und legt die Datei dorthin, wo der Mensch
                seine Dateien erwartet. Ueber `request()` liefe sie erst vollstaendig durch
                den Speicher des Fensters.
              */}
              <a className="btn" href={api.downloadAdresse(d.name)} download={d.name}>
                {t('Herunterladen')}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
