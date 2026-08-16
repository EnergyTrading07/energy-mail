import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { bestaetige } from '../dialoge.js';
import { Fenster } from './Fenster.js';
import { VerzeichnisTeil } from './VerzeichnisTeil.js';
import { DatenschutzTeil } from './DatenschutzTeil.js';
import { t, datum } from '../sprache.js';

/**
 * Die Nutzerverwaltung.
 *
 * Dasselbe, was das Befehlszeilenwerkzeug kann - nur ohne SSH-Sitzung. Wer einem Betrieb
 * einen Mailserver hinstellt, kann nicht verlangen, dass für jedes neue Postfach jemand
 * eine Konsole öffnet.
 *
 * ## Das Kennwort erscheint genau einmal
 *
 * Beim Anlegen und beim Zurücksetzen erzeugt der Server ein Kennwort und gibt es einmal
 * heraus; danach steht im Eintrag nur noch die Prüfsumme. Deshalb steht es hier nicht als
 * beiläufige Zeile, sondern als Kasten, der stehen bleibt, bis der Verwalter ihn wegklickt
 * - und mit einem Knopf zum Kopieren daneben. Wer ihn wegklickt, ohne das Kennwort
 * mitzunehmen, muss es zurücksetzen; das ist unangenehm, aber ehrlich.
 *
 * ## Was hier NICHT entschieden wird
 *
 * Die Rechte. Dieses Fenster zeigt einem Verwalter Knöpfe und einem gewöhnlichen Nutzer
 * gar nichts - aber das ist Höflichkeit, kein Schutz. Der Riegel sitzt am Server
 * (nutzer/verwaltung.ts): Wer die Adresse von Hand eingibt, bekommt 403, gleich was diese
 * Datei anzeigt.
 */

interface Props {
  onClose: () => void;
}

/** Ein Kennwort, das man nur einmal zu sehen bekommt. */
function Kennwortkasten({ wert, name, onWeg }: { wert: string; name: string; onWeg: () => void }) {
  const [kopiert, setKopiert] = useState(false);

  return (
    <div className="verwaltung-kennwort" role="alert">
      <p>
        <strong>{t('Kennwort für {name}', { name })}</strong>
      </p>
      <code>{wert}</code>
      <p className="hint">
        {t('Es erscheint nur dieses eine Mal. Geben Sie es weiter und bitten Sie darum, es nach der ersten Anmeldung zu ändern.')}
      </p>
      <div className="verwaltung-kennwort-knoepfe">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard
              .writeText(wert)
              .then(() => setKopiert(true))
              .catch(() => undefined);
          }}
        >
          {kopiert ? t('Kopiert') : t('Kopieren')}
        </button>
        <button type="button" className="btn still" onClick={onWeg}>
          {t('Verstanden')}
        </button>
      </div>
    </div>
  );
}

export function VerwaltungModal({ onClose }: Props) {
  const [nutzer, setNutzer] = useState<api.VerwalteterNutzer[]>([]);
  const [ich, setIch] = useState('');
  const [laeuft, setLaeuft] = useState(true);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [neueAdresse, setNeueAdresse] = useState('');
  const [neuIstVerwalter, setNeuIstVerwalter] = useState(false);
  /** Das einmalig gezeigte Kennwort - samt der Adresse, zu der es gehört. */
  const [frisch, setFrisch] = useState<{ name: string; kennwort: string } | null>(null);

  const laden = () => {
    setLaeuft(true);
    api
      .verwaltungNutzer()
      .then((antwort) => {
        setNutzer(antwort.nutzer);
        setIch(antwort.ich);
        setFehler(null);
      })
      .catch((err) => setFehler((err as Error).message))
      .finally(() => setLaeuft(false));
  };

  useEffect(laden, []);

  /** Ein Vorgang mit Sperre auf der Zeile, damit nichts doppelt losgeht. */
  const tue = async (id: string, was: () => Promise<unknown>) => {
    setBusy(id);
    setFehler(null);
    try {
      await was();
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const anlegen = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    const adresse = neueAdresse.trim();
    if (!adresse) return;
    await tue('neu', async () => {
      const { kennwort } = await api.verwaltungAnlegen(adresse, neuIstVerwalter);
      setFrisch({ name: adresse, kennwort });
      setNeueAdresse('');
      setNeuIstVerwalter(false);
    });
  };

  /** Wie viele Verwalter es gibt - für die Frage, ob der letzte gerade abgeräumt wird. */
  const verwalterAnzahl = nutzer.filter((n) => n.verwalter).length;

  return (
    <Fenster titel={t('Nutzer verwalten')} onClose={onClose} klasse="modal-wide">
      {fehler && (
        <p className="fehler" role="alert">
          {fehler}
        </p>
      )}

      {frisch && (
        <Kennwortkasten
          wert={frisch.kennwort}
          name={frisch.name}
          onWeg={() => setFrisch(null)}
        />
      )}

      <form className="verwaltung-neu" onSubmit={(e) => void anlegen(e)}>
        <input
          type="email"
          value={neueAdresse}
          onChange={(e) => setNeueAdresse(e.target.value)}
          placeholder={t('Adresse des neuen Nutzers')}
          aria-label={t('Adresse des neuen Nutzers')}
        />
        <label className="verwaltung-haken">
          <input
            type="checkbox"
            checked={neuIstVerwalter}
            onChange={(e) => setNeuIstVerwalter(e.target.checked)}
          />
          {t('Darf verwalten')}
        </label>
        <button className="btn" type="submit" disabled={busy !== null || !neueAdresse.trim()}>
          {t('Anlegen')}
        </button>
      </form>

      {laeuft && <p className="hint">{t('Wird geladen…')}</p>}

      <table className="verwaltung-tabelle">
        <thead>
          <tr>
            <th>{t('Adresse')}</th>
            <th>{t('Angelegt')}</th>
            <th>{t('Stand')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {nutzer.map((n) => {
            const selbst = n.id === ich;
            /*
             * Der letzte Verwalter lässt sich nicht abräumen - das prüft der Server, und
             * hier wird der Knopf gar nicht erst angeboten. Beides: Ein Knopf, der immer
             * eine Fehlermeldung bringt, ist eine Falle; und ein Server, der sich auf die
             * Oberfläche verlässt, ist keine Prüfung.
             */
            const letzterVerwalter = n.verwalter && verwalterAnzahl === 1;
            const arbeitet = busy === n.id;

            return (
              <tr key={n.id} className={n.gesperrt ? 'verwaltung-gesperrt' : undefined}>
                <td>
                  <span className="verwaltung-adresse">{n.email}</span>
                  <span className="verwaltung-kennung">{n.id}</span>
                </td>
                <td>{datum(new Date(n.angelegt))}</td>
                <td>
                  {n.verwalter && <span className="marke-verwalter">{t('Verwalter')}</span>}
                  {n.zweiFaktor && (
                    <span className="marke-faktor" title={t('Zwei-Faktor-Anmeldung eingeschaltet')}>
                      {t('2 Faktoren')}
                    </span>
                  )}
                  {n.gesperrt && <span className="marke-gesperrt">{t('Gesperrt')}</span>}
                  {selbst && <span className="marke-selbst">{t('Das sind Sie')}</span>}
                </td>
                <td className="verwaltung-aktionen">
                  <button
                    className="link-btn"
                    disabled={arbeitet}
                    onClick={() =>
                      void (async () => {
                        const ja = await bestaetige({
                          titel: t('Kennwort von {name} zurücksetzen?', { name: n.email }),
                          text: t(
                            'Es wird ein neues erzeugt und einmal angezeigt. Alle offenen Sitzungen dieses Nutzers werden beendet. Wer das Kennwort kennt, kommt an dessen Post – der Vorgang steht deshalb im Protokoll.',
                          ),
                          stil: 'warnung',
                          ok: t('Zurücksetzen'),
                        });
                        if (!ja) return;
                        await tue(n.id, async () => {
                          const { kennwort } = await api.verwaltungAendern(n.id, {
                            kennwortZuruecksetzen: true,
                          });
                          if (kennwort) setFrisch({ name: n.email, kennwort });
                        });
                      })()
                    }
                  >
                    {t('Kennwort')}
                  </button>

                  {!selbst && (
                    <button
                      className="link-btn"
                      disabled={arbeitet || letzterVerwalter}
                      title={letzterVerwalter ? t('Das ist der letzte Verwalter.') : undefined}
                      onClick={() =>
                        void tue(n.id, () =>
                          api.verwaltungAendern(n.id, { gesperrt: !n.gesperrt }),
                        )
                      }
                    >
                      {n.gesperrt ? t('Freigeben') : t('Sperren')}
                    </button>
                  )}

                  {!selbst && (
                    <button
                      className="link-btn"
                      disabled={arbeitet || letzterVerwalter}
                      title={letzterVerwalter ? t('Das ist der letzte Verwalter.') : undefined}
                      onClick={() =>
                        void tue(n.id, () =>
                          api.verwaltungAendern(n.id, { verwalter: !n.verwalter }),
                        )
                      }
                    >
                      {n.verwalter ? t('Rolle nehmen') : t('Zum Verwalter machen')}
                    </button>
                  )}

                  {/*
                    Nur dort, wo es etwas abzuräumen gibt - und auch an der eigenen Zeile.
                    Der Fall ist alltäglich: Ein Verwalter mit neuem Telefon, dessen alte
                    Codes weg sind, muss sich selbst wieder freimachen können. Für ihn
                    allein ist das Werkzeug auf der Befehlszeile da, und das setzt eine
                    SSH-Sitzung voraus.
                  */}
                  {n.zweiFaktor && (
                    <button
                      className="link-btn"
                      disabled={arbeitet}
                      onClick={() =>
                        void (async () => {
                          const ja = await bestaetige({
                            titel: t('Zweiten Faktor von {name} entfernen?', { name: n.email }),
                            text: t(
                              'Danach genügt das Kennwort allein, um an dieses Postfach zu kommen – bis ein neuer Faktor eingerichtet ist. Nur tun, wenn Sie sicher sind, dass die Bitte wirklich von diesem Menschen kommt.',
                            ),
                            stil: 'warnung',
                            ok: t('Entfernen'),
                          });
                          if (!ja) return;
                          await tue(n.id, () =>
                            api.verwaltungAendern(n.id, { zweiFaktorEntfernen: true }),
                          );
                        })()
                      }
                    >
                      {t('2FA zurücksetzen')}
                    </button>
                  )}

                  <button
                    className="link-btn"
                    disabled={arbeitet}
                    title={t('Alle angemeldeten Geräte dieses Nutzers sperren')}
                    onClick={() => void tue(n.id, () => api.verwaltungSitzungenSperren(n.id))}
                  >
                    {t('Geräte sperren')}
                  </button>

                  {!selbst && (
                    <button
                      className="link-btn gefaehrlich"
                      disabled={arbeitet || letzterVerwalter}
                      title={letzterVerwalter ? t('Das ist der letzte Verwalter.') : undefined}
                      onClick={() =>
                        void (async () => {
                          /*
                           * Zwei Rückfragen, und die zweite ist die eigentliche.
                           *
                           * Entfernen nimmt den Schlüssel dieses Nutzers mit - seine
                           * Geheimnisse sind danach unlesbar, auch in jeder Sicherung.
                           * Das Löschen der Dateien ist der zweite, getrennte Schritt;
                           * er soll ausdrücklich verlangt werden.
                           */
                          const ja = await bestaetige({
                            titel: t('{name} entfernen?', { name: n.email }),
                            text: t(
                              'Mit dem Eintrag geht der Schlüssel dieses Nutzers. Seine Zugangsdaten und sein Adressbuch sind danach unlesbar – auch in jeder Sicherung. Das lässt sich nicht rückgängig machen.',
                            ),
                            stil: 'gefahr',
                            ok: t('Entfernen'),
                          });
                          if (!ja) return;
                          const mitDaten = await bestaetige({
                            titel: t('Auch die Dateien löschen?'),
                            text: t(
                              'Der Ordner dieses Nutzers bleibt sonst liegen. Ohne seinen Schlüssel ist er nur noch Bytes – Platz belegt er trotzdem.',
                            ),
                            stil: 'warnung',
                            ok: t('Dateien löschen'),
                            abbrechen: t('Ordner behalten'),
                          });
                          await tue(n.id, () => api.verwaltungEntfernen(n.id, mitDaten));
                        })()
                      }
                    >
                      {t('Entfernen')}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p className="hint fein">
        {t('Ein Verwalter kann Kennwörter zurücksetzen und damit an die Post der anderen. Das ist die Bauart des Servers und keine Lücke – jeder solche Vorgang steht im Protokoll.')}
      </p>
      <VerzeichnisTeil />
      <DatenschutzTeil />
    </Fenster>
  );
}
