import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { bestaetige } from '../dialoge.js';
import { Fenster } from './Fenster.js';
import { t, tp } from '../sprache.js';

/**
 * Das eigene Konto: Kennwort und zweiter Faktor.
 *
 * ## Warum beides in einem Fenster
 *
 * Weil es dieselbe Frage beantwortet - "wie komme ich hier herein". Der Kennwortwechsel
 * hatte bis hierher überhaupt keine Oberfläche: Der Weg dafür stand seit Langem im Server
 * (/ich/kennwort), aber niemand konnte ihn erreichen, ohne einen Abruf von Hand zu bauen.
 * Ein Kennwort, das sich nicht wechseln lässt, ist beim ersten Verdacht ein Problem.
 *
 * ## Warum überall das Kennwort abgefragt wird
 *
 * Bei jedem der drei Vorgänge - einschalten, abschalten, neue Codes - steht ein
 * Kennwortfeld. Die Sitzung ist längst angemeldet; die Abfrage gilt einem anderen Fall:
 * dem unbeaufsichtigten Bildschirm. Ohne sie könnte ein Vorübergehender den zweiten Faktor
 * abschalten (dann schützt er nichts mehr) oder auf sein eigenes Telefon einrichten (dann
 * kommt der rechtmäßige Nutzer ohne Verwalter nicht mehr herein).
 *
 * ## In der Desktop-Hülle gibt es das nicht
 *
 * Dort weist sich das Fenster über das Zugangsgeheimnis des Prozesses aus - es gibt kein
 * Anmeldekennwort und keine Sitzung. Ein zweiter Faktor vor einer Anmeldung, die nicht
 * stattfindet, wäre eine Hürde ohne Gegenwert. Die Seitenleiste zeigt den Weg hierher
 * deshalb nur, wo `abmeldbar` gilt.
 */

interface Props {
  onClose: () => void;
  /** Nach dem Kennwortwechsel ist jede Sitzung beendet - auch diese. */
  onAbgemeldet: () => void;
}

/**
 * Das QR-Bild.
 *
 * Gezeichnet wird aus dem Modulraster, das der Server schickt - kein Bild, kein
 * eingebettetes SVG aus fremder Hand, sondern Rechtecke, die diese Datei selbst setzt.
 *
 * Zwei Festlegungen, die nicht nach Geschmack gehen:
 *
 *  - **Immer dunkel auf hell, auch im dunklen Erscheinungsbild.** Ein umgekehrtes QR-Bild
 *    lesen manche Kameras und viele nicht. Ein Bild, das bei der Hälfte der Kunden nicht
 *    funktioniert, ist kein Bild.
 *  - **Vier Module Rand.** Die Norm verlangt sie, und ohne sie findet der Leser die Ecken
 *    nicht. Deshalb sitzt der Rand im viewBox und nicht in einem CSS-Abstand, den ein
 *    späteres Feinschleifen wegnehmen könnte.
 */
function QrAnzeige({ bild, beschreibung }: { bild: api.QrBild; beschreibung: string }) {
  const rand = 4;
  const kante = bild.groesse + 2 * rand;

  // Waagerechte Läufe statt eines Rechtecks je Modul: aus rund zweitausend Elementen
  // werden ein paar hundert, und der Browser zeichnet es ohne Zucken.
  const laeufe: { x: number; y: number; breite: number }[] = [];
  bild.zeilen.forEach((zeile, y) => {
    let start = -1;
    for (let x = 0; x <= zeile.length; x++) {
      const dunkel = zeile[x] === '1';
      if (dunkel && start < 0) start = x;
      if (!dunkel && start >= 0) {
        laeufe.push({ x: start, y, breite: x - start });
        start = -1;
      }
    }
  });

  return (
    <svg
      className="qr-bild"
      viewBox={`${-rand} ${-rand} ${kante} ${kante}`}
      role="img"
      aria-label={beschreibung}
    >
      <rect x={-rand} y={-rand} width={kante} height={kante} fill="#ffffff" />
      {laeufe.map((l) => (
        <rect key={`${l.x}-${l.y}`} x={l.x} y={l.y} width={l.breite} height={1} fill="#000000" />
      ))}
    </svg>
  );
}

/**
 * Die Wiederherstellungscodes - sie erscheinen genau einmal.
 *
 * Derselbe Gedanke wie beim einmalig gezeigten Kennwort in der Nutzerverwaltung: Was
 * nirgends mehr steht, gehört nicht in eine beiläufige Zeile. Wer sie wegklickt, ohne sie
 * mitzunehmen, kann sich neue erzeugen - solange er noch hereinkommt.
 */
function Codekasten({ codes, onWeg }: { codes: string[]; onWeg: () => void }) {
  const [kopiert, setKopiert] = useState(false);

  return (
    <div className="konto-codes" role="alert">
      <p>
        <strong>{t('Ihre Wiederherstellungscodes')}</strong>
      </p>
      <p className="hint">
        {t('Drucken Sie sie aus oder legen Sie sie an einen sicheren Ort. Jeder Code lässt sich genau einmal benutzen – und ersetzt Ihr Telefon, wenn es einmal nicht zur Hand ist.')}
      </p>
      <ol className="konto-codeliste">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ol>
      <div className="konto-codeknoepfe">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void navigator.clipboard
              .writeText(codes.join('\n'))
              .then(() => setKopiert(true))
              .catch(() => undefined);
          }}
        >
          {kopiert ? t('Kopiert') : t('Kopieren')}
        </button>
        <button type="button" className="btn still" onClick={onWeg}>
          {t('Ich habe sie notiert')}
        </button>
      </div>
    </div>
  );
}

export function KontoModal({ onClose, onAbgemeldet }: Props) {
  const [ich, setIch] = useState<api.IchAuskunft | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  // Kennwortwechsel
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [neuWieder, setNeuWieder] = useState('');

  /** Die angefangene Einrichtung: Geheimnis und Bild, solange sie nicht bestätigt ist. */
  const [einrichtung, setEinrichtung] = useState<{
    geheimnis: string;
    weg: string;
    qr: api.QrBild;
  } | null>(null);
  const [code, setCode] = useState('');
  const [faktorKennwort, setFaktorKennwort] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const laden = () => {
    api
      .frageIch()
      .then(setIch)
      .catch((err) => setFehler((err as Error).message));
  };

  useEffect(laden, []);

  const tue = async (was: () => Promise<unknown>) => {
    setLaeuft(true);
    setFehler(null);
    try {
      await was();
    } catch (err) {
      setFehler((err as Error).message);
    } finally {
      setLaeuft(false);
    }
  };

  const kennwortWechseln = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (neu !== neuWieder) {
      setFehler(t('Die beiden neuen Kennwörter stimmen nicht überein.'));
      return;
    }
    await tue(async () => {
      await api.kennwortAendern(alt, neu);
      /*
       * Der Server hat mit dem Wechsel jede Sitzung beendet - auch diese. Das ist Absicht
       * und steht dort begründet: Wer sein Kennwort wechselt, tut das oft, weil er den
       * Verdacht hat, dass es jemand kennt; eine fremde Sitzung, die den Wechsel überlebt,
       * macht ihn wirkungslos. Hier bleibt nur, den Menschen ordentlich zum Anmeldefenster
       * zu bringen, statt ihn in eine Oberfläche laufen zu lassen, die ab jetzt bei jedem
       * Abruf 401 bekommt.
       */
      setAlt('');
      setNeu('');
      setNeuWieder('');
      onAbgemeldet();
    });
  };

  const faktorBeginnen = () =>
    tue(async () => {
      setEinrichtung(await api.zweiFaktorBeginnen());
      setCode('');
      setFaktorKennwort('');
    });

  const faktorBestaetigen = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    await tue(async () => {
      const antwort = await api.zweiFaktorBestaetigen(faktorKennwort, code);
      setCodes(antwort.codes);
      setEinrichtung(null);
      setCode('');
      setFaktorKennwort('');
      laden();
    });
  };

  const faktorAus = async () => {
    const ja = await bestaetige({
      titel: t('Zweiten Faktor abschalten?'),
      text: t(
        'Danach genügt Ihr Kennwort allein, um an Ihre Post zu kommen. Ihre Wiederherstellungscodes werden ungültig.',
      ),
      stil: 'warnung',
      ok: t('Abschalten'),
    });
    if (!ja) return;
    await tue(async () => {
      await api.zweiFaktorAus(faktorKennwort);
      setFaktorKennwort('');
      laden();
    });
  };

  const neueCodes = async () => {
    const ja = await bestaetige({
      titel: t('Neue Wiederherstellungscodes?'),
      text: t('Die bisherigen gelten dann nicht mehr – auch die auf einem Zettel, den Sie noch haben.'),
      ok: t('Neue erzeugen'),
    });
    if (!ja) return;
    await tue(async () => {
      const antwort = await api.zweiFaktorCodes(faktorKennwort);
      setCodes(antwort.codes);
      setFaktorKennwort('');
      laden();
    });
  };

  const anZweiFaktor = Boolean(ich?.zweiFaktor);
  const uebrig = ich?.codesUebrig ?? 0;

  return (
    <Fenster titel={t('Mein Konto')} onClose={onClose}>
      {fehler && (
        <p className="fehler" role="alert">
          {fehler}
        </p>
      )}

      <p className="konto-adresse">{ich?.nutzer?.email}</p>

      <section className="konto-teil">
        <h3>{t('Kennwort ändern')}</h3>
        <p className="hint">
          {t('Das ist das Kennwort für Energy Mail – nicht das Ihres Postfachs. Nach der Änderung müssen Sie sich überall neu anmelden.')}
        </p>
        <form onSubmit={(e) => void kennwortWechseln(e)} className="konto-form">
          <label htmlFor="konto-alt">{t('Bisheriges Kennwort')}</label>
          <input
            id="konto-alt"
            type="password"
            autoComplete="current-password"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            required
          />
          <label htmlFor="konto-neu">{t('Neues Kennwort')}</label>
          <input
            id="konto-neu"
            type="password"
            autoComplete="new-password"
            value={neu}
            onChange={(e) => setNeu(e.target.value)}
            required
            minLength={10}
          />
          <label htmlFor="konto-neu2">{t('Noch einmal')}</label>
          <input
            id="konto-neu2"
            type="password"
            autoComplete="new-password"
            value={neuWieder}
            onChange={(e) => setNeuWieder(e.target.value)}
            required
          />
          {/*
            Zehn Zeichen, keine Regeln über Sonderzeichen - dieselbe Grenze wie im Server.
            Die üblichen Regeln treiben Menschen nachweislich zu "Passwort1!"; Länge ist
            die einzige Anforderung, die tatsächlich hilft.
          */}
          <p className="hint">{t('Mindestens zehn Zeichen. Ein Satz ist besser als ein Wort.')}</p>
          <button className="btn" type="submit" disabled={laeuft || !alt || !neu}>
            {t('Kennwort ändern')}
          </button>
        </form>
      </section>

      <section className="konto-teil">
        <h3>{t('Zwei-Faktor-Anmeldung')}</h3>

        {codes && <Codekasten codes={codes} onWeg={() => setCodes(null)} />}

        {!anZweiFaktor && !einrichtung && (
          <>
            <p className="hint">
              {t('Zusätzlich zum Kennwort ein Einmalcode aus einer App auf Ihrem Telefon. Wer Ihr Kennwort in die Hände bekommt, kommt damit trotzdem nicht an Ihre Post.')}
            </p>
            <button className="btn" onClick={() => void faktorBeginnen()} disabled={laeuft}>
              {t('Einrichten')}
            </button>
          </>
        )}

        {einrichtung && (
          <div className="konto-einrichtung">
            <p>{t('1. Scannen Sie dieses Bild mit Ihrer Authenticator-App.')}</p>
            <QrAnzeige
              bild={einrichtung.qr}
              beschreibung={t('QR-Bild zum Einrichten der Zwei-Faktor-Anmeldung')}
            />
            <p className="hint">
              {t('Keine Kamera zur Hand? Tippen Sie diesen Schlüssel in der App ein:')}
            </p>
            <code className="konto-geheimnis">{einrichtung.geheimnis}</code>

            <form onSubmit={(e) => void faktorBestaetigen(e)} className="konto-form">
              <p>{t('2. Geben Sie den Code ein, den die App jetzt anzeigt.')}</p>
              <label htmlFor="konto-code">{t('Code')}</label>
              <input
                id="konto-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoCorrect="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
              <label htmlFor="konto-faktorkennwort">{t('Ihr Kennwort')}</label>
              <input
                id="konto-faktorkennwort"
                type="password"
                autoComplete="current-password"
                value={faktorKennwort}
                onChange={(e) => setFaktorKennwort(e.target.value)}
                required
              />
              <div className="konto-knoepfe">
                <button className="btn" type="submit" disabled={laeuft || !code || !faktorKennwort}>
                  {t('Einschalten')}
                </button>
                <button
                  className="btn still"
                  type="button"
                  onClick={() => {
                    setEinrichtung(null);
                    setCode('');
                    setFaktorKennwort('');
                  }}
                >
                  {t('Abbrechen')}
                </button>
              </div>
            </form>
          </div>
        )}

        {anZweiFaktor && (
          <>
            <p className="konto-stand">
              <span className="marke-an">{t('Eingeschaltet')}</span>{' '}
              {tp(uebrig, '{anzahl} Wiederherstellungscode übrig', '{anzahl} Wiederherstellungscodes übrig', {
                anzahl: uebrig,
              })}
            </p>
            {/*
              Gewarnt wird, bevor es zu spät ist. Wer erst merkt, dass kein Code mehr
              daliegt, wenn er einen braucht, merkt es an dem Tag, an dem sein Telefon
              kaputt ist - und dann hilft nur noch ein Verwalter.
            */}
            {uebrig <= 2 && (
              <p className="warnung" role="alert">
                {uebrig === 0
                  ? t('Sie haben keinen Wiederherstellungscode mehr. Ohne Ihr Telefon kommen Sie dann nicht mehr herein.')
                  : t('Es sind nur noch wenige Wiederherstellungscodes übrig. Erzeugen Sie jetzt neue.')}
              </p>
            )}
            <label htmlFor="konto-kennwort-faktor">{t('Ihr Kennwort')}</label>
            <input
              id="konto-kennwort-faktor"
              type="password"
              autoComplete="current-password"
              value={faktorKennwort}
              onChange={(e) => setFaktorKennwort(e.target.value)}
            />
            <div className="konto-knoepfe">
              <button className="btn" onClick={() => void neueCodes()} disabled={laeuft || !faktorKennwort}>
                {t('Neue Wiederherstellungscodes')}
              </button>
              <button
                className="btn gefahr"
                onClick={() => void faktorAus()}
                disabled={laeuft || !faktorKennwort}
              >
                {t('Abschalten')}
              </button>
            </div>
          </>
        )}
      </section>
    </Fenster>
  );
}
