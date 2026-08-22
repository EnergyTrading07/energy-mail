import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { Sprachwahl, Zugangsmarke, Zugangsumschalter } from './Zugangsteile.js';
import { t } from '../sprache.js';

/**
 * Das Anmeldefenster.
 *
 * Erscheint in beiden Betriebsarten - und das ist neu. Die Desktop-Hülle brachte einmal
 * ihren eigenen Server mit und wies sich mit dem Zugangsgeheimnis des Prozesses aus: ein
 * Rechner, ein Mensch, keine Anmeldung. Sie bringt keinen mehr mit; sie ist ein Fenster
 * auf denselben Server, mit dem auch der Browser arbeitet. Damit meldet sie sich an wie
 * jeder andere, und genau deshalb sehen beide dieselben Postfächer.
 *
 * Bewusst schmal gehalten: hier gibt es nichts zu entdecken. Wer hier steht, will nur
 * an seine Post. Was daneben steht - der Umschalter zum Anlegen, der Weg bei einem
 * vergessenen Kennwort, die Sprachwahl -, erscheint nur dort, wo es auch irgendwohin
 * führt; der Server sagt in `lage`, was an diesem Dienst tatsächlich geht.
 */

interface Props {
  /** Wird gerufen, wenn die Anmeldung geklappt hat - die Anwendung darf dann starten. */
  onAngemeldet: () => void;
  /**
   * Was an diesem Dienst ohne Konto möglich ist - oder `null`, wenn nichts davon.
   *
   * Ob der Umschalter und der Weg zum Kennwort erscheinen, entscheidet also der SERVER und
   * nicht dieses Fenster. Dieselbe Regel wie überall hier: Eine Oberfläche, die einen Knopf
   * versteckt, hat nichts verboten - aber einer, den sie zeigt, obwohl der Weg zu ist,
   * führt einen Menschen in eine Fehlermeldung, für die er nichts kann.
   */
  lage: api.Registrierungslage | null;
  /** Umschalten auf Konto anlegen oder auf den Weg bei vergessenem Kennwort. */
  onWechsel: (wohin: 'registrieren' | 'kennwort') => void;
}

export function Anmeldung({ onAngemeldet, lage, onWechsel }: Props) {
  const [email, setEmail] = useState('');
  const [kennwort, setKennwort] = useState('');
  const [bleiben, setBleiben] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState('');
  const ersteEingabe = useRef<HTMLInputElement>(null);
  const codeFeld = useRef<HTMLInputElement>(null);

  /**
   * Die Marke aus dem ersten Schritt - solange sie hier steht, fehlt noch der Code.
   *
   * Sie ist keine Anmeldung, sondern eine Quittung über ein richtiges Kennwort: fünf
   * Minuten gültig, fünf Versuche, und sie öffnet genau einen Weg. Steht sie leer, zeigt
   * dieses Fenster das gewöhnliche Anmeldeformular.
   */
  const [marke, setMarke] = useState('');
  const [code, setCode] = useState('');

  // Der Fokus gehört ins erste Feld: wer hier landet, will tippen und nicht erst klicken.
  useEffect(() => {
    ersteEingabe.current?.focus();
  }, []);

  // Und beim Wechsel in die zweite Stufe ins Codefeld - wer sein Telefon schon in der Hand
  // hat, soll nicht erst mit der Maus hinklicken.
  useEffect(() => {
    if (marke) codeFeld.current?.focus();
  }, [marke]);

  const abschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;
    setFehler('');
    setLaeuft(true);
    try {
      const befund = await api.anmelden(email, kennwort, bleiben);
      if (befund.zweiFaktor && befund.marke) {
        /*
         * Das Kennwort stimmt, die Anmeldung ist aber noch nicht fertig.
         *
         * Das Kennwort wird hier aus dem Speicher genommen. Es wird nicht mehr gebraucht -
         * die Marke tritt an seine Stelle -, und ein Kennwort, das ohne Grund im Zustand
         * eines Fensters steht, steht auch in jedem Fehlerbericht dieses Fensters.
         */
        setKennwort('');
        setMarke(befund.marke);
        setLaeuft(false);
        return;
      }
      onAngemeldet();
    } catch (err) {
      setFehler((err as Error).message);
      /*
       * Nur das Kennwort leeren, nicht die Adresse.
       *
       * Wer sich vertippt hat, tippt das Kennwort neu - die Adresse noch einmal
       * einzugeben wäre eine Schikane. Und das falsche Kennwort stehen zu lassen führt
       * dazu, dass man dasselbe zweimal abschickt.
       */
      setKennwort('');
      setLaeuft(false);
    }
  };

  const codeAbschicken = async (ereignis: React.FormEvent) => {
    ereignis.preventDefault();
    if (laeuft) return;
    setFehler('');
    setLaeuft(true);
    try {
      await api.anmeldenMitCode(marke, code);
      onAngemeldet();
    } catch (err) {
      setFehler((err as Error).message);
      setCode('');
      setLaeuft(false);
      /*
       * Nach fünf Fehlversuchen ist die Marke weg, und der Server sagt das ausdrücklich.
       * Dann zurück auf Anfang - ein Codefeld, das zu nichts mehr führt, ist eine Falle.
       */
      if (/abgelaufen/i.test((err as Error).message)) {
        setMarke('');
        setKennwort('');
      }
    }
  };

  if (marke) {
    return (
      <div className="anmeldung">
        <form className="anmeldung-karte" onSubmit={codeAbschicken}>
          <Zugangsmarke />

          <p className="anmeldung-hinweis">
            {t('Geben Sie den Code aus Ihrer Authenticator-App ein.')}
          </p>

          <label htmlFor="anmeldung-code">{t('Code')}</label>
          <input
            id="anmeldung-code"
            ref={codeFeld}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            /*
             * inputMode="numeric" holt auf dem Telefon die Zifferntastatur, und
             * autoComplete="one-time-code" lässt iOS und Android den Code aus der
             * Zwischenablage anbieten. autoCorrect und Großschreibung müssen weg -
             * sonst macht das Telefon aus einem Wiederherstellungscode etwas anderes.
             */
            inputMode="numeric"
            autoComplete="one-time-code"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            required
            disabled={laeuft}
          />

          {fehler && (
            <p className="anmeldung-fehler" role="alert">
              {fehler}
            </p>
          )}

          <button type="submit" className="btn anmeldung-knopf" disabled={laeuft}>
            {laeuft ? t('Wird geprüft…') : t('Weiter')}
          </button>

          <p className="anmeldung-fussnote">
            {t('Kein Telefon zur Hand? Hier geht auch einer Ihrer Wiederherstellungscodes.')}
          </p>
          <button
            type="button"
            className="link-btn anmeldung-zurueck"
            onClick={() => {
              setMarke('');
              setCode('');
              setFehler('');
            }}
          >
            {t('Zurück')}
          </button>

          {/*
            Hier steht bewusst keine Sprachwahl. Sie lädt die Seite neu, und dabei ginge
            die Marke verloren - der Mensch stünde mitten in der Anmeldung wieder am
            Anfang, ohne zu verstehen warum. Umgestellt wird einen Schritt vorher.
          */}
        </form>
      </div>
    );
  }

  return (
    <div className="anmeldung">
      <form className="anmeldung-karte" onSubmit={abschicken}>
        <Zugangsmarke />

        {lage && <Zugangsumschalter aktiv="anmelden" onWechsel={(w) => w === 'registrieren' && onWechsel(w)} />}

        <label htmlFor="anmeldung-email">{t('Adresse')}</label>
        <input
          id="anmeldung-email"
          ref={ersteEingabe}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          required
          disabled={laeuft}
        />

        <label htmlFor="anmeldung-kennwort">{t('Kennwort')}</label>
        <input
          id="anmeldung-kennwort"
          type="password"
          value={kennwort}
          onChange={(e) => setKennwort(e.target.value)}
          autoComplete="current-password"
          required
          disabled={laeuft}
        />

        {/*
          role="alert" statt einer stillen Zeile: eine Vorlesesoftware nennt den Fehler
          von selbst. Ohne das säße jemand vor einem Formular, das sich nicht abschicken
          lässt, ohne zu erfahren warum.
        */}
        {fehler && (
          <p className="anmeldung-fehler" role="alert">
            {fehler}
          </p>
        )}

        {/*
          Das Haekchen steht UEBER dem Knopf und nicht darunter.
          Wer es darunter setzt, hat es schon abgeschickt, bevor er es gelesen hat - und
          es ist die einzige Entscheidung auf diesem Formular, die etwas aufgibt.
        */}
        <label className="anmeldung-bleiben" htmlFor="anmeldung-bleiben">
          <input
            id="anmeldung-bleiben"
            type="checkbox"
            checked={bleiben}
            onChange={(e) => setBleiben(e.target.checked)}
            disabled={laeuft}
          />
          <span>{t('Angemeldet bleiben')}</span>
        </label>

        <button type="submit" className="btn anmeldung-knopf" disabled={laeuft}>
          {laeuft ? t('Wird geprüft…') : t('Anmelden')}
        </button>

        {/*
          Der Hinweis erscheint erst, wenn das Haekchen gesetzt ist.
          Dauerhaft danebenzustehen hiesse, ihn nach dem dritten Mal nicht mehr zu lesen -
          und er betrifft nur den, der sich gerade dafuer entschieden hat.
        */}
        {bleiben && (
          <p className="anmeldung-fussnote anmeldung-warnung">
            {t('Dieses Gerät bleibt ein Jahr lang angemeldet, auch nach einem Neustart – und der Bildschirm sperrt sich nicht mehr von selbst. Nur auf einem Gerät, zu dem sonst niemand Zugang hat.')}
          </p>
        )}

        {lage?.kennwortZuruecksetzbar && (
          <button
            type="button"
            className="link-btn anmeldung-zurueck"
            onClick={() => onWechsel('kennwort')}
          >
            {t('Kennwort vergessen?')}
          </button>
        )}

        <p className="anmeldung-fussnote">{t('Das ist das Kennwort für Energy Mail – nicht das Ihres Postfachs.')}</p>

        <Sprachwahl />
      </form>
    </div>
  );
}
