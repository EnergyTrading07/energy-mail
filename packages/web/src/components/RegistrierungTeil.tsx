import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { bestaetige } from '../dialoge.js';
import { t, datum } from '../sprache.js';

/**
 * Die Selbstregistrierung einrichten - nur für Verwalter.
 *
 * ## Die Reihenfolge auf diesem Formular ist eine Aussage
 *
 * Zuoberst steht, WER hereindarf, denn das ist die Entscheidung. Darunter, worauf sie
 * begrenzt ist (Domänen). Dann der Text, den der Antragsteller zu lesen bekommt. Ganz
 * unten der Sendeserver - technisches Beiwerk, ohne das die dritte Betriebsart allerdings
 * nicht zu haben ist.
 *
 * Die Warteschlange steht dazwischen und nicht am Ende: Sie ist das Einzige hier, das
 * eine Handlung verlangt. Ein Antrag, den niemand sieht, wird nicht beschieden - und der
 * Mensch, der ihn gestellt hat, hört nie wieder etwas.
 *
 * ## Was die Oberfläche hier NICHT entscheidet
 *
 * Ob "offen" überhaupt zu haben ist. Der Server weist es ab, solange kein Systemversand
 * eingerichtet ist (siehe registrierungSpeicher.ts) - hier steht nur der Hinweis dazu, und
 * zwar bevor jemand vergeblich speichert.
 */

/** Komma, Leerzeichen oder Semikolon trennen - der Mensch soll nicht raten muessen. */
function zerlege(text: string): string[] {
  return text
    .split(/[,\s;]+/)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Was die drei Betriebsarten bedeuten - einmal geschrieben, zweimal gebraucht. */
function beschreibung(art: 'aus' | 'freigabe' | 'offen'): string {
  if (art === 'aus') {
    return t('Konten legt allein ein Verwalter an. Im Anmeldefenster steht kein Weg zur Anmeldung.');
  }
  if (art === 'freigabe') {
    return t('Wer will, stellt einen Antrag. Hereinkommen tut er erst, wenn Sie ihn freigeben.');
  }
  return t('Wer seine Mailadresse über den Bestätigungslink nachweist, ist damit angemeldet. Sie erfahren davon nur über die Nutzerliste.');
}

export function RegistrierungTeil() {
  const [stand, setStand] = useState<api.Registrierungsverwaltung | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const [gesichert, setGesichert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  /** Die Domänen als Text, wie sie im Feld stehen - erst beim Sichern zerlegt. */
  const [domaenenText, setDomaenenText] = useState('');
  const [gesperrtText, setGesperrtText] = useState('');

  /**
   * Bringt die Antwort des Servers auf eine Form, mit der sich zeichnen laesst.
   *
   * Das ist keine Zierde. Dieser Teil haengt IN der Nutzerverwaltung; wirft er beim ersten
   * Zeichnen, ist nicht nur er weg, sondern das ganze Fenster - samt Nutzerliste, samt
   * Kennwortknoepfen. Eine Antwort, in der ein Feld fehlt, kommt aber tatsaechlich vor:
   * im Browser, wenn die Oberflaeche aus dem Zwischenspeicher stammt und der Server
   * inzwischen ein anderer ist. Dann soll hier "aus" stehen und nicht ein leeres Fenster.
   */
  const zurechtlegen = (a: Partial<api.Registrierungsverwaltung>): api.Registrierungsverwaltung => ({
    einstellungen: {
      betriebsart: 'aus',
      domaenen: [],
      hinweis: '',
      gesperrteDomaenen: [],
      wegwerfSperren: true,
      hoechstzahl: 50,
      nurOeffentlicheMailserver: false,
      ...(a.einstellungen ?? {}),
    },
    wirksam: a.wirksam ?? a.einstellungen?.betriebsart ?? 'aus',
    systemmail: {
      aktiv: false,
      host: '',
      port: 587,
      secure: false,
      benutzer: '',
      absender: '',
      absenderName: '',
      ...(a.systemmail ?? {}),
    },
    antraege: Array.isArray(a.antraege) ? a.antraege : [],
  });

  const laden = () => {
    api
      .verwaltungRegistrierung()
      .then((antwort) => {
        const sicher = zurechtlegen(antwort ?? {});
        setStand(sicher);
        setDomaenenText(sicher.einstellungen.domaenen.join(', '));
        setGesperrtText(sicher.einstellungen.gesperrteDomaenen.join(', '));
        setFehler(null);
      })
      .catch((err) => setFehler((err as Error).message));
  };

  useEffect(laden, []);

  if (!stand) {
    return (
      <div className="form-row anmeldeverwaltung-teil">
        <label>{t('Selbstanmeldung')}</label>
        {fehler ? (
          <p className="hint hinweis-fehler">{fehler}</p>
        ) : (
          <p className="hint">{t('Wird geladen…')}</p>
        )}
      </div>
    );
  }

  const { einstellungen, wirksam, systemmail, antraege } = stand;
  const aendere = (teil: Partial<typeof einstellungen>) => {
    setStand({ ...stand, einstellungen: { ...einstellungen, ...teil } });
    setGesichert(false);
  };

  const sichern = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      await api.verwaltungRegistrierungSetzen({
        ...einstellungen,
        domaenen: zerlege(domaenenText),
        gesperrteDomaenen: zerlege(gesperrtText),
      });
      setGesichert(true);
      laden();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

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

  return (
    <div className="form-row anmeldeverwaltung-teil">
      <label>{t('Selbstanmeldung')}</label>
      <p className="hint">
        {t('Ob sich Menschen hier selbst ein Konto anlegen können – und unter welchen Bedingungen.')}
      </p>
      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      <div className="anmeldeverwaltung-arten">
        {(['aus', 'freigabe', 'offen'] as const).map((art) => (
          <label key={art} className="anmeldeverwaltung-art">
            <input
              type="radio"
              name="registrierung-betriebsart"
              checked={einstellungen.betriebsart === art}
              onChange={() => aendere({ betriebsart: art })}
            />
            <span>
              <strong>
                {art === 'aus'
                  ? t('Aus')
                  : art === 'freigabe'
                    ? t('Antrag mit Freigabe')
                    : t('Offen mit Mailbestätigung')}
              </strong>
              <span className="hint">{beschreibung(art)}</span>
            </span>
          </label>
        ))}
      </div>

      {/*
        Der Fall, in dem Eingestelltes und Geltendes auseinanderfallen: "offen" ist
        gespeichert, der Systemversand aber abgeschaltet worden. Der Server fällt dann auf
        "freigabe" zurück - das darf nicht stillschweigend geschehen, sonst hält der
        Betreiber eine Tür für offen, die zu ist (oder umgekehrt).
      */}
      {einstellungen.betriebsart !== wirksam && (
        <p className="hint hinweis-fehler">
          {t('Eingestellt ist „offen“, es gilt aber „Antrag mit Freigabe“: Ohne Systemversand gibt es keine Bestätigungsmail. Richten Sie ihn weiter unten ein.')}
        </p>
      )}

      {einstellungen.betriebsart === 'offen' && !systemmail.aktiv && (
        <p className="hint hinweis-fehler">
          {t('„Offen“ verlangt einen Systemversand – ohne Bestätigungsmail könnte sich jeder ein Konto auf eine fremde Adresse anlegen.')}
        </p>
      )}

      {einstellungen.betriebsart !== 'aus' && (
        <>
          <div className="anmeldeverwaltung-zeile">
            <div>
              <label htmlFor="reg-domaenen">{t('Nur diese Mail-Domänen')}</label>
              <input
                id="reg-domaenen"
                value={domaenenText}
                placeholder={t('firma.de, tochter.de')}
                onChange={(e) => {
                  setDomaenenText(e.target.value);
                  setGesichert(false);
                }}
              />
            </div>
          </div>
          <p className="hint">
            {t('Leer heißt: jede Adresse. Für einen Betrieb ist das die wirksamste einzelne Einstellung – wer nicht dazugehört, kommt gar nicht erst bis zum Antrag.')}
          </p>

          <div className="anmeldeverwaltung-zeile">
            <div>
              <label htmlFor="reg-gesperrt">{t('Gesperrte Mail-Domänen')}</label>
              <input
                id="reg-gesperrt"
                value={gesperrtText}
                placeholder={t('aerger.example, noch-eine.example')}
                onChange={(e) => {
                  setGesperrtText(e.target.value);
                  setGesichert(false);
                }}
              />
            </div>
            <div className="schmal">
              <label htmlFor="reg-hoechstzahl">{t('Höchstens Nutzer')}</label>
              <input
                id="reg-hoechstzahl"
                type="number"
                min={0}
                value={einstellungen.hoechstzahl}
                onChange={(e) => aendere({ hoechstzahl: Number(e.target.value) })}
              />
            </div>
          </div>

          <label className="anmeldeverwaltung-schalter">
            <input
              type="checkbox"
              checked={einstellungen.wegwerfSperren}
              onChange={(e) => aendere({ wegwerfSperren: e.target.checked })}
            />
            <span>{t('Bekannte Wegwerfadressen abweisen')}</span>
          </label>
          <p className="hint">
            {t('Eine Adresse, die zehn Minuten lebt, macht die Bestätigung wertlos – nachgewiesen ist dann nur, dass jemand eine Wegwerfseite aufrufen kann. Was die eingebaute Liste nicht kennt, tragen Sie oben ein.')}
          </p>

          <label className="anmeldeverwaltung-schalter">
            <input
              type="checkbox"
              checked={einstellungen.nurOeffentlicheMailserver}
              /*
               * Bei "offen" nicht abwaehlbar - der Server setzt ihn ohnehin wieder. Ein
               * Haken, der nach dem Sichern von selbst zurueckspringt, sieht nach einem
               * Fehler aus; gesperrt mit Begruendung daneben sagt, was Sache ist.
               */
              disabled={einstellungen.betriebsart === 'offen'}
              onChange={(e) => aendere({ nurOeffentlicheMailserver: e.target.checked })}
            />
            <span>{t('Postfachserver nur im offenen Netz')}</span>
          </label>
          <p className="hint">
            {einstellungen.betriebsart === 'offen'
              ? t('Bei offener Anmeldung fest eingeschaltet. Wer ein Konto anlegt, bestimmt, wohin dieser Server Verbindungen aufbaut – bei Fremden wäre das eine Abtastung Ihres internen Netzes, ausgeführt vom Server selbst.')
              : t('Verhindert, dass jemand als Postfachserver eine Adresse aus Ihrem internen Netz einträgt. Für einen eigenen Mailserver im Haus muss das aus bleiben.')}
          </p>

          <label htmlFor="reg-hinweis">{t('Datenschutzhinweis auf dem Formular')}</label>
          <textarea
            id="reg-hinweis"
            className="anmeldeverwaltung-hinweistext"
            rows={5}
            value={einstellungen.hinweis}
            onChange={(e) => aendere({ hinweis: e.target.value })}
          />
          <p className="hint">
            {t('Er steht über dem Absendeknopf und muss angehakt werden. Nennen Sie hier, wer die Daten verarbeitet und wie man sie wieder loswird; verlinken Sie Ihre Datenschutzerklärung, wenn Sie eine haben.')}
          </p>
        </>
      )}

      <div className="anmeldeverwaltung-knoepfe">
        <button type="button" className="btn" disabled={laeuft} onClick={() => void sichern()}>
          {laeuft ? t('Wird gesichert…') : t('Sichern')}
        </button>
        {gesichert && <span className="hint">{t('Gesichert.')}</span>}
      </div>

      {/* --- Die Warteschlange --- */}

      {antraege.length > 0 && (
        <div className="anmeldeverwaltung-antraege">
          <h4>{t('Offene Anträge')}</h4>
          <table className="verwaltung-tabelle anmeldeverwaltung-tabelle">
            <thead>
              <tr>
                <th>{t('Adresse')}</th>
                <th>{t('Gestellt')}</th>
                <th>{t('Adresse bestätigt')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {antraege.map((a) => {
                const arbeitet = busy === a.id;
                return (
                  <tr key={a.id}>
                    <td>
                      {a.email}
                      {a.bemerkung && <span className="hint fein"> – {a.bemerkung}</span>}
                    </td>
                    <td>{datum(new Date(a.angelegt))}</td>
                    <td>
                      {a.bestaetigt ? (
                        datum(new Date(a.bestaetigt))
                      ) : (
                        <span className="hint">{t('noch nicht')}</span>
                      )}
                    </td>
                    <td className="verwaltung-aktionen">
                      <button
                        className="link-btn"
                        disabled={arbeitet}
                        onClick={() =>
                          void (async () => {
                            /*
                             * Die Rückfrage nennt genau das, was hier zu entscheiden ist:
                             * ob dieser Mensch hereindarf. Bei einem unbestätigten
                             * Antrag steht zusätzlich da, dass die Adresse noch nichts
                             * bewiesen hat - das ist der Unterschied zwischen "Frau
                             * Meier hat sich angemeldet" und "jemand hat Frau Meiers
                             * Adresse eingetippt".
                             */
                            const ja = await bestaetige({
                              titel: t('Antrag von {name} annehmen?', { name: a.email }),
                              text: a.bestaetigt
                                ? t('Das Konto entsteht sofort. Das Kennwort hat dieser Mensch selbst gewählt – Sie bekommen es nicht zu sehen und brauchen es nicht.')
                                : t('Diese Adresse ist NICHT bestätigt: Es ist nicht nachgewiesen, dass sie dem Antragsteller gehört. Geben Sie nur frei, wenn Sie wissen, wer das ist.'),
                              stil: a.bestaetigt ? 'warnung' : 'gefahr',
                              ok: t('Annehmen'),
                            });
                            if (!ja) return;
                            await tue(a.id, () => api.verwaltungAntragFreigeben(a.id));
                          })()
                        }
                      >
                        {t('Annehmen')}
                      </button>
                      <button
                        className="link-btn gefaehrlich"
                        disabled={arbeitet}
                        onClick={() =>
                          void (async () => {
                            const ja = await bestaetige({
                              titel: t('Antrag von {name} ablehnen?', { name: a.email }),
                              text: t('Der Antrag wird gelöscht – nicht vermerkt. Eine Liste abgelehnter Bewerber führt dieser Dienst bewusst nicht.'),
                              stil: 'warnung',
                              ok: t('Ablehnen'),
                            });
                            if (!ja) return;
                            /*
                             * Ob eine Nachricht hinausgeht, ist eine eigene Frage: Bei
                             * einem offensichtlichen Massenantrag wäre sie eine Mail an
                             * eine Adresse, die den Antrag nie gestellt hat - und damit
                             * genau die Belästigung, die wir vermeiden wollen.
                             */
                            const melden = systemmail.aktiv
                              ? await bestaetige({
                                  titel: t('Ablehnung mitteilen?'),
                                  text: t('Der Antragsteller bekommt eine kurze Nachricht ohne Begründung. Bei einem Antrag, den offensichtlich niemand gestellt hat, lassen Sie es besser.'),
                                  ok: t('Mitteilen'),
                                  abbrechen: t('Ohne Nachricht'),
                                })
                              : false;
                            await tue(a.id, () => api.verwaltungAntragAblehnen(a.id, melden));
                          })()
                        }
                      >
                        {t('Ablehnen')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SystemmailTeil wert={systemmail} onGeaendert={laden} />
    </div>
  );
}

/**
 * Der Absender des Dienstes.
 *
 * Steht hier und nicht bei den Konten, weil er keinem Nutzer gehört: Es ist der Absender,
 * unter dem der DIENST schreibt - Bestätigungslinks, die Meldung über eine Freigabe. Ein
 * persönliches Postfach dafür zu nehmen ist der bequeme und der falsche Weg; die
 * Begründung steht in systemmail.ts.
 */
function SystemmailTeil({
  wert,
  onGeaendert,
}: {
  wert: api.Systemmail;
  onGeaendert: () => void;
}) {
  const [stand, setStand] = useState(wert);
  const [kennwort, setKennwort] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [befund, setBefund] = useState<{ ok: boolean; text: string } | null>(null);
  const [gesichert, setGesichert] = useState(false);

  const aendere = (teil: Partial<api.Systemmail>) => {
    setStand({ ...stand, ...teil });
    setGesichert(false);
    setBefund(null);
  };

  const angaben = () => {
    const { kennwortHinterlegt: _weg, ...rest } = stand;
    return rest;
  };

  const pruefen = async () => {
    setLaeuft(true);
    setBefund(null);
    try {
      const antwort = await api.verwaltungSystemmailPruefen({
        ...angaben(),
        ...(kennwort ? { kennwort } : {}),
      });
      setBefund(
        antwort.ok
          ? { ok: true, text: t('Die Verbindung steht und die Anmeldung wird angenommen.') }
          : { ok: false, text: antwort.fehler },
      );
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  const sichern = async () => {
    setLaeuft(true);
    setFehler(null);
    try {
      /*
       * Das Kennwort geht nur mit, wenn eines eingetippt wurde. Sonst hieße jedes
       * Speichern eines geänderten Ports zugleich: Kennwort löschen - siehe die
       * Unterscheidung zwischen null und undefined in systemmail.ts.
       */
      const neu = await api.verwaltungSystemmailSetzen({
        ...angaben(),
        ...(kennwort ? { kennwort } : {}),
      });
      setStand(neu);
      setKennwort('');
      setGesichert(true);
      onGeaendert();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <div className="anmeldeverwaltung-systemmail">
      <h4>{t('Absender des Dienstes')}</h4>
      <p className="hint">
        {t('Über dieses Postfach verschickt der Dienst seine eigenen Nachrichten – den Bestätigungslink vor allem. Nehmen Sie ein eigenes Postfach dafür, kein persönliches.')}
      </p>
      {fehler && <p className="hint hinweis-fehler">{fehler}</p>}

      <label className="anmeldeverwaltung-schalter">
        <input
          type="checkbox"
          checked={stand.aktiv}
          onChange={(e) => aendere({ aktiv: e.target.checked })}
        />
        <span>{t('Systemversand benutzen')}</span>
      </label>

      {stand.aktiv && (
        <>
          <div className="anmeldeverwaltung-zeile">
            <div>
              <label htmlFor="sys-host">{t('Sendeserver (SMTP)')}</label>
              <input
                id="sys-host"
                value={stand.host}
                placeholder="smtp.firma.de"
                onChange={(e) => aendere({ host: e.target.value })}
              />
            </div>
            <div className="schmal">
              <label htmlFor="sys-port">{t('Port')}</label>
              <input
                id="sys-port"
                type="number"
                value={stand.port}
                onChange={(e) => aendere({ port: Number(e.target.value) })}
              />
            </div>
          </div>

          <label className="anmeldeverwaltung-schalter">
            <input
              type="checkbox"
              checked={stand.secure}
              onChange={(e) =>
                // Der Port folgt der Wahl - 465 verschlüsselt ab Verbindungsaufbau, 587
                // mit STARTTLS. Wer ihn danach von Hand ändert, behält seine Änderung.
                aendere({ secure: e.target.checked, port: e.target.checked ? 465 : 587 })
              }
            />
            <span>{t('Verschlüsselt ab Verbindungsaufbau (Port 465)')}</span>
          </label>
          <p className="hint">
            {t('Aus heißt STARTTLS auf Port 587 – ebenfalls verschlüsselt. Unverschlüsselt versendet dieser Dienst nicht.')}
          </p>

          <div className="anmeldeverwaltung-zeile">
            <div>
              <label htmlFor="sys-benutzer">{t('Benutzername')}</label>
              <input
                id="sys-benutzer"
                value={stand.benutzer}
                autoComplete="off"
                onChange={(e) => aendere({ benutzer: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="sys-kennwort">
                {stand.kennwortHinterlegt ? t('Kennwort (hinterlegt)') : t('Kennwort')}
              </label>
              <input
                id="sys-kennwort"
                type="password"
                value={kennwort}
                autoComplete="new-password"
                placeholder={stand.kennwortHinterlegt ? '••••••••' : ''}
                onChange={(e) => {
                  setKennwort(e.target.value);
                  setGesichert(false);
                  setBefund(null);
                }}
              />
            </div>
          </div>

          <div className="anmeldeverwaltung-zeile">
            <div>
              <label htmlFor="sys-absender">{t('Absenderadresse')}</label>
              <input
                id="sys-absender"
                type="email"
                value={stand.absender}
                placeholder="noreply@firma.de"
                onChange={(e) => aendere({ absender: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="sys-name">{t('Angezeigter Name')}</label>
              <input
                id="sys-name"
                value={stand.absenderName}
                onChange={(e) => aendere({ absenderName: e.target.value })}
              />
            </div>
          </div>

          {befund && (
            <p className={befund.ok ? 'hint hinweis-gut' : 'hint hinweis-fehler'}>{befund.text}</p>
          )}
        </>
      )}

      <div className="anmeldeverwaltung-knoepfe">
        <button type="button" className="btn" disabled={laeuft} onClick={() => void sichern()}>
          {laeuft ? t('Wird gesichert…') : t('Sichern')}
        </button>
        {stand.aktiv && (
          <button type="button" className="btn still" disabled={laeuft} onClick={() => void pruefen()}>
            {t('Verbindung prüfen')}
          </button>
        )}
        {gesichert && <span className="hint">{t('Gesichert.')}</span>}
      </div>
    </div>
  );
}
