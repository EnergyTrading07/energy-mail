import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import type { Kontakt, Telefonnummer } from '../api.js';
import { bestaetige } from '../dialoge.js';
import { meldeErfolg, meldeFehler, meldeHinweis } from '../meldungen.js';
import { Fenster } from './Fenster.js';

/**
 * Das Adressbuch.
 *
 * Bis hierher hat das Programm Adressen nur nebenbei aus der Post aufgelesen - gut für
 * Vorschläge beim Verfassen, aber kein Adressbuch: nichts ließ sich eintragen, ändern
 * oder mitnehmen. Hier kommt beides zusammen. Links stehen die eingetragenen Kontakte,
 * rechts wird einer bearbeitet, und über vCard geht es hinein und wieder hinaus.
 *
 * Aufgelesene Adressen bleiben absichtlich aus der Liste heraus: zweitausend Absender,
 * durch die niemand blättern will. Über den Schalter lassen sie sich einblenden - dann
 * genügt ein Klick, um eine davon zu einem richtigen Kontakt zu machen.
 */

interface Props {
  onClose: () => void;
  /** Mit einer Adresse geöffnet - etwa aus einer Nachricht heraus. */
  vorgabe?: { address: string; name?: string };
}

/** Die Arten, die zur Auswahl stehen. Beim Ausführen werden sie zurückübersetzt. */
const TELEFONARTEN = ['Privat', 'Arbeit', 'Mobil', 'Fax', 'Zentrale', 'Sonstige'];

type Entwurf = Omit<Kontakt, 'count' | 'lastSeen'> & { vorherigeAdresse?: string };

const LEER: Entwurf = { address: '', telefone: [] };

export function AdressbuchModal({ onClose, vorgabe }: Props) {
  const [suche, setSuche] = useState('');
  const [auchAufgelesene, setAuchAufgelesene] = useState(false);
  const [liste, setListe] = useState<api.Kontaktliste>({ eintraege: [], gesamt: 0 });
  const [entwurf, setEntwurf] = useState<Entwurf | null>(
    vorgabe ? { ...LEER, address: vorgabe.address, name: vorgabe.name } : null,
  );
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const dateiwahl = useRef<HTMLInputElement>(null);

  const laden = async (s = suche, alle = auchAufgelesene) => {
    try {
      setListe(await api.ladeAdressbuch(s, alle));
    } catch (err) {
      setFehler((err as Error).message);
    }
  };

  useEffect(() => {
    // Die Suche wartet kurz ab: bei jedem Tastendruck sofort zu laden ließe die Liste
    // flackern, ohne dass es schneller würde.
    const t = setTimeout(() => void laden(suche, auchAufgelesene), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche, auchAufgelesene]);

  const bearbeitet = entwurf?.vorherigeAdresse ?? entwurf?.address;

  const speichern = async () => {
    if (!entwurf) return;
    setBusy(true);
    setFehler(null);
    try {
      const gespeichert = await api.speichereKontakt(entwurf);
      await laden();
      // Weiter im Bearbeiten, aber ab jetzt auf der neuen Adresse: sonst legte ein
      // zweites Speichern nach einer Adressänderung einen Zweiteintrag an.
      setEntwurf({ ...gespeichert, vorherigeAdresse: gespeichert.address });
      meldeErfolg(`${gespeichert.name || gespeichert.address} gespeichert`);
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const loeschen = async (kontakt: Entwurf) => {
    const ja = await bestaetige({
      titel: `„${kontakt.name || kontakt.address}“ löschen?`,
      text: 'Der Eintrag verschwindet aus dem Adressbuch. Kommt die Adresse in Ihrer Post vor, wird sie beim nächsten Blättern wieder als Vorschlag aufgelesen – aber ohne Telefonnummer, Firma und Notiz.',
      stil: 'gefahr',
      ok: 'Löschen',
    });
    if (!ja) return;

    try {
      await api.loescheKontakt(kontakt.vorherigeAdresse ?? kontakt.address);
      setEntwurf(null);
      await laden();
    } catch (err) {
      setFehler((err as Error).message);
    }
  };

  const einlesen = async (datei: File) => {
    setBusy(true);
    setFehler(null);
    try {
      const ergebnis = await api.fuehreVisitenkartenEin(await datei.text());
      const teile = [
        ergebnis.angelegt > 0 && `${ergebnis.angelegt} neu`,
        ergebnis.aktualisiert > 0 && `${ergebnis.aktualisiert} ergänzt`,
        ergebnis.uebergangen > 0 && `${ergebnis.uebergangen} ohne Mailadresse übergangen`,
      ].filter(Boolean);

      if (ergebnis.angelegt + ergebnis.aktualisiert === 0) {
        meldeHinweis(
          'Keine Kontakte übernommen',
          `In „${datei.name}“ stand keine Visitenkarte mit einer Mailadresse.`,
        );
      } else {
        meldeErfolg('Adressbuch eingelesen', teile.join(' · '));
      }
      await laden();
    } catch (err) {
      meldeFehler('Einlesen nicht möglich', (err as Error).message);
    } finally {
      setBusy(false);
      // Zurücksetzen, sonst löst dieselbe Datei ein zweites Mal nichts aus.
      if (dateiwahl.current) dateiwahl.current.value = '';
    }
  };

  const setzeFeld = (feld: keyof Entwurf, wert: unknown) =>
    setEntwurf((e) => (e ? { ...e, [feld]: wert } : e));

  const setzeTelefon = (i: number, teil: Partial<Telefonnummer>) =>
    setEntwurf((e) =>
      e
        ? { ...e, telefone: (e.telefone ?? []).map((t, j) => (j === i ? { ...t, ...teil } : t)) }
        : e,
    );

  return (
    <Fenster titel="Adressbuch" onClose={onClose} klasse="modal-wide adressbuch">

      {fehler && <div className="error-banner">{fehler}</div>}

      <div className="adressbuch-leiste">
        <input
          type="search"
          placeholder="Name, Adresse oder Firma"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          aria-label="Im Adressbuch suchen"
        />
        <label className="adressbuch-schalter">
          <input
            type="checkbox"
            checked={auchAufgelesene}
            onChange={(e) => setAuchAufgelesene(e.target.checked)}
          />
          Aufgelesene zeigen
        </label>
        <button className="btn secondary" onClick={() => setEntwurf({ ...LEER })}>
          Neuer Kontakt
        </button>
      </div>

      <div className="adressbuch-flaechen">
        <div className="adressbuch-liste">
          {liste.eintraege.length === 0 ? (
            <div className="empty-state">
              {suche
                ? `Nichts gefunden zu „${suche}“.`
                : 'Noch kein Kontakt eingetragen. Legen Sie einen an oder lesen Sie eine vCard-Datei ein.'}
            </div>
          ) : (
            liste.eintraege.map((kontakt) => (
              <button
                key={kontakt.address}
                type="button"
                className={`kontakt-zeile${
                  bearbeitet?.toLowerCase() === kontakt.address.toLowerCase() ? ' aktiv' : ''
                }`}
                onClick={() =>
                  setEntwurf({
                    ...kontakt,
                    telefone: kontakt.telefone ?? [],
                    // Auch eine aufgelesene Adresse trägt hier ihren bisherigen
                    // Schlüssel - beim Speichern wird sie zum eingetragenen Kontakt.
                    vorherigeAdresse: kontakt.address,
                  })
                }
              >
                <span className="kontakt-name">
                  {kontakt.name || kontakt.address}
                  {!kontakt.gepflegt && (
                    <span className="kontakt-marke">aufgelesen</span>
                  )}
                </span>
                <span className="kontakt-zweitzeile">
                  {kontakt.organisation
                    ? `${kontakt.address} · ${kontakt.organisation}`
                    : kontakt.address}
                </span>
              </button>
            ))
          )}
          {liste.gesamt > liste.eintraege.length && (
            <p className="hint adressbuch-rest">
              {liste.gesamt - liste.eintraege.length} weitere – bitte suchen.
            </p>
          )}
        </div>

        <div className="adressbuch-form">
          {!entwurf ? (
            <div className="empty-state">Links einen Kontakt wählen oder einen neuen anlegen.</div>
          ) : (
            <>
              <div className="form-row adressbuch-namen">
                <span>
                  <label htmlFor="ab-vorname">Vorname</label>
                  <input
                    id="ab-vorname"
                    value={entwurf.vorname ?? ''}
                    onChange={(e) => setzeFeld('vorname', e.target.value)}
                  />
                </span>
                <span>
                  <label htmlFor="ab-nachname">Nachname</label>
                  <input
                    id="ab-nachname"
                    value={entwurf.nachname ?? ''}
                    onChange={(e) => setzeFeld('nachname', e.target.value)}
                  />
                </span>
              </div>

              <div className="form-row">
                <label htmlFor="ab-name">Angezeigter Name</label>
                <input
                  id="ab-name"
                  value={entwurf.name ?? ''}
                  placeholder={
                    [entwurf.vorname, entwurf.nachname].filter(Boolean).join(' ') ||
                    'wird aus Vor- und Nachname gebildet'
                  }
                  onChange={(e) => setzeFeld('name', e.target.value)}
                />
              </div>

              <div className="form-row">
                <label htmlFor="ab-adresse">Mailadresse</label>
                <input
                  id="ab-adresse"
                  type="email"
                  value={entwurf.address}
                  onChange={(e) => setzeFeld('address', e.target.value)}
                />
              </div>

              {(entwurf.weitereAdressen ?? []).map((adresse, i) => (
                <div className="form-row adressbuch-zeile" key={`adresse-${i}`}>
                  <label htmlFor={`ab-weitere-${i}`}>Weitere Adresse</label>
                  <input
                    id={`ab-weitere-${i}`}
                    type="email"
                    value={adresse}
                    onChange={(e) =>
                      setzeFeld(
                        'weitereAdressen',
                        (entwurf.weitereAdressen ?? []).map((a, j) =>
                          j === i ? e.target.value : a,
                        ),
                      )
                    }
                  />
                  <button
                    className="link-btn gefaehrlich"
                    onClick={() =>
                      setzeFeld(
                        'weitereAdressen',
                        (entwurf.weitereAdressen ?? []).filter((_, j) => j !== i),
                      )
                    }
                  >
                    Entfernen
                  </button>
                </div>
              ))}

              {(entwurf.telefone ?? []).map((telefon, i) => (
                <div className="form-row adressbuch-zeile" key={`telefon-${i}`}>
                  <label htmlFor={`ab-telefon-${i}`}>Telefon</label>
                  <select
                    value={telefon.art ?? 'Privat'}
                    onChange={(e) => setzeTelefon(i, { art: e.target.value })}
                    aria-label={`Art der ${i + 1}. Nummer`}
                  >
                    {TELEFONARTEN.map((art) => (
                      <option key={art}>{art}</option>
                    ))}
                  </select>
                  <input
                    id={`ab-telefon-${i}`}
                    value={telefon.nummer}
                    onChange={(e) => setzeTelefon(i, { nummer: e.target.value })}
                  />
                  <button
                    className="link-btn gefaehrlich"
                    onClick={() =>
                      setzeFeld(
                        'telefone',
                        (entwurf.telefone ?? []).filter((_, j) => j !== i),
                      )
                    }
                  >
                    Entfernen
                  </button>
                </div>
              ))}

              <div className="adressbuch-hinzu">
                <button
                  className="link-btn"
                  onClick={() =>
                    setzeFeld('weitereAdressen', [...(entwurf.weitereAdressen ?? []), ''])
                  }
                >
                  + Weitere Adresse
                </button>
                <button
                  className="link-btn"
                  onClick={() =>
                    setzeFeld('telefone', [
                      ...(entwurf.telefone ?? []),
                      { nummer: '', art: 'Privat' },
                    ])
                  }
                >
                  + Telefonnummer
                </button>
              </div>

              <div className="form-row">
                <label htmlFor="ab-firma">Firma</label>
                <input
                  id="ab-firma"
                  value={entwurf.organisation ?? ''}
                  onChange={(e) => setzeFeld('organisation', e.target.value)}
                />
              </div>

              <div className="form-row">
                <label htmlFor="ab-anschrift">Anschrift</label>
                <textarea
                  id="ab-anschrift"
                  rows={2}
                  value={entwurf.anschrift ?? ''}
                  onChange={(e) => setzeFeld('anschrift', e.target.value)}
                />
              </div>

              <div className="form-row">
                <label htmlFor="ab-geburtstag">Geburtstag</label>
                <input
                  id="ab-geburtstag"
                  type="date"
                  value={entwurf.geburtstag ?? ''}
                  onChange={(e) => setzeFeld('geburtstag', e.target.value)}
                />
              </div>

              <div className="form-row">
                <label htmlFor="ab-notiz">Notiz</label>
                <textarea
                  id="ab-notiz"
                  rows={3}
                  value={entwurf.notiz ?? ''}
                  onChange={(e) => setzeFeld('notiz', e.target.value)}
                />
              </div>

              <div className="adressbuch-knoepfe adressbuch-formknoepfe">
                {entwurf.gepflegt && (
                  <button className="link-btn gefaehrlich" onClick={() => void loeschen(entwurf)}>
                    Löschen
                  </button>
                )}
                <span className="adressbuch-fueller" />
                <button className="btn secondary" onClick={() => setEntwurf(null)}>
                  Abbrechen
                </button>
                <button
                  className="btn"
                  onClick={() => void speichern()}
                  disabled={busy || !entwurf.address.includes('@')}
                >
                  Speichern
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="adressbuch-knoepfe adressbuch-unten">
        <input
          ref={dateiwahl}
          type="file"
          accept=".vcf,.vcard,text/vcard,text/x-vcard"
          hidden
          onChange={(e) => {
            const datei = e.target.files?.[0];
            if (datei) void einlesen(datei);
          }}
        />
        <button
          className="btn secondary"
          onClick={() => dateiwahl.current?.click()}
          disabled={busy}
          title="Eine vCard-Datei aus einem anderen Programm einlesen"
        >
          vCard einlesen
        </button>
        <button
          className="btn secondary"
          onClick={() => {
            // Über die Adresse statt über einen Link: so trägt die Datei den Namen aus
            // der Kopfzeile des Servers.
            window.location.href = api.adressbuchAusfuhrAdresse();
          }}
          title="Alle eingetragenen Kontakte als vCard-Datei sichern"
        >
          Als vCard sichern
        </button>
        <span className="adressbuch-fueller" />
        <button className="btn" onClick={onClose}>
          Schließen
        </button>
      </div>
    </Fenster>
  );
}
