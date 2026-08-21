import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { t } from '../sprache.js';

/**
 * Zeigt beim Anlegen eines Kontos, was die Serversuche ergeben hat.
 *
 * Der Sinn ist nicht Auskunft, sondern Zutrauen: wer "name@seiner-firma.de" eintippt und
 * darunter "imap.seiner-firma.de:993 gefunden" liest, weiß, dass es klappen wird, bevor
 * er das Passwort eingibt. Findet die Suche nichts, klappt an derselben Stelle die
 * Eingabe von Hand auf - dann steht dort nicht bloß eine Fehlermeldung, sondern der Weg.
 */

export interface HandWerte {
  imapHost: string;
  imapPort: string;
  smtpHost: string;
  smtpPort: string;
}

export const LEERE_HANDWERTE: HandWerte = {
  imapHost: '',
  imapPort: '993',
  smtpHost: '',
  smtpPort: '587',
};

interface Props {
  email: string;
  vonHand: boolean;
  onVonHand: (an: boolean) => void;
  werte: HandWerte;
  onWert: (feld: keyof HandWerte, wert: string) => void;
}

/**
 * Woher die Adressen stammen - als Funktion, damit die Sprache schon feststeht.
 *
 * Eine Konstante auf Modulebene würde beim Einbinden gebaut, also noch vor der Wahl der
 * Sprache; die Herkunft stünde dann als einziges deutsch in einer englischen Zeile.
 */
function herkunft(): Record<string, string> {
  return {
    eingebaut: t('bekannter Anbieter'),
    anbieterdatenbank: t('aus der Anbieterdatenbank'),
    domain: t('von der Domain selbst'),
    dns: t('aus den DNS-Einträgen'),
    autodiscover: t('über Autodiscover'),
    mx: t('am Postweg der Domain erkannt'),
  };
}

export function Serverauskunft({ email, vonHand, onVonHand, werte, onWert }: Props) {
  const [gefunden, setGefunden] = useState<api.GefundeneEinstellungen | null>(null);
  const [sucht, setSucht] = useState(false);
  const [gesuchtFuer, setGesuchtFuer] = useState('');

  const domain = email.includes('@') ? email.split('@')[1]?.trim().toLowerCase() : '';

  useEffect(() => {
    if (!domain || domain.length < 3 || !domain.includes('.')) {
      setGefunden(null);
      setGesuchtFuer('');
      return;
    }

    // Eine andere Adresse ist ein neuer Anlauf: die Handeingabe schließt sich, und was
    // die Suche ergibt, entscheidet neu. Sonst bliebe sie nach einer Domain ohne
    // Auskunft für alle folgenden offen, samt der Serveradressen der vorigen.
    onVonHand(false);

    // Kurz abwarten: sonst liefe beim Tippen von "gmx.de" eine Suche für "g", "gm", …
    let abgebrochen = false;
    const uhr = window.setTimeout(() => {
      setSucht(true);
      api
        .sucheServer(email)
        .then((e) => {
          if (abgebrochen) return;
          setGefunden(e);
          setGesuchtFuer(domain);
          // Findet die Suche nichts, ist die Eingabe von Hand der einzige Weg - dann
          // soll sie offen stehen und nicht erst noch aufgeklappt werden müssen.
          if (!e) onVonHand(true);
        })
        .catch(() => {
          if (!abgebrochen) setGefunden(null);
        })
        .finally(() => {
          if (!abgebrochen) setSucht(false);
        });
    }, 700);

    return () => {
      abgebrochen = true;
      window.clearTimeout(uhr);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  const fertig = gesuchtFuer === domain && !sucht;

  return (
    <div className="serverauskunft">
      {sucht && <span className="server-status">{t('Serveradressen werden gesucht…')}</span>}

      {/*
        Der Fall, den ein Firmenkunde als Erstes trifft.

        Liegt die Domain bei Microsoft 365 oder Google Workspace, nimmt dort niemand mehr
        ein Kennwort an - Microsoft hat die Kennwortanmeldung für Exchange Online
        abgeschaltet, Google verlangt ein eigens erzeugtes App-Kennwort. Ohne diesen
        Hinweis tippt jemand sein Windows-Kennwort in das Formular direkt darüber,
        bekommt "Anmeldung fehlgeschlagen" und sucht den Fehler bei sich. Die Auskunft
        gehört genau hierhin, wo er gerade tippt.
      */}
      {fertig && gefunden?.oauthProvider && (
        <span className="server-status server-fehlt">
          {t(
            '{anbieter} verlangt eine Anmeldung über den Anbieter – ein Kennwort wird hier nicht angenommen.',
            { anbieter: gefunden.anbieter ?? t('Dieser Anbieter') },
          )}
          <span className="server-details">
            {t(
              'Bitte den Knopf „Mit {anbieter} anmelden“ weiter oben verwenden. Die Serveradressen stehen dann von selbst richtig.',
              {
                anbieter:
                  gefunden.oauthProvider === 'microsoft'
                    ? 'Microsoft / Outlook'
                    : 'Google / Gmail',
              },
            )}
          </span>
        </span>
      )}

      {fertig && gefunden && (
        <span className="server-status server-gefunden">
          {/* Manche Anbieter tragen einen ganzen Werbesatz als Namen ein
              ("mailbox.org -- damit Privates privat bleibt"). Nur der Anfang. */}
          {gefunden.anbieter
            ? t('{anbieter} erkannt', {
                anbieter: gefunden.anbieter.split(/\s[-–—]{1,2}\s/)[0]!.slice(0, 40),
              })
            : t('Serveradressen gefunden')}
          <span className="server-details">
            {gefunden.imapHost}:{gefunden.imapPort} · {gefunden.smtpHost}:{gefunden.smtpPort}
            {' · '}
            {herkunft()[gefunden.fundort] ?? gefunden.fundort}
          </span>
        </span>
      )}

      {fertig && !gefunden && (
        <span className="server-status server-fehlt">
          {t('Für {domain} ist nichts hinterlegt', { domain: domain ?? '' })}
          <span className="server-details">
            {t('Die Adressen stehen in der Hilfe Ihres Anbieters, meist unter „IMAP“.')}
          </span>
        </span>
      )}

      {fertig && gefunden && !vonHand && (
        <button type="button" className="link-btn" onClick={() => onVonHand(true)}>
          {t('Andere Server eintragen')}
        </button>
      )}

      {vonHand && (
        <div className="server-felder">
          <div className="form-row">
            <input
              type="text"
              value={werte.imapHost}
              onChange={(e) => onWert('imapHost', e.target.value)}
              placeholder={gefunden?.imapHost ?? 'imap.anbieter.de'}
              aria-label={t('IMAP-Server')}
            />
            <input
              type="text"
              className="server-port"
              value={werte.imapPort}
              onChange={(e) => onWert('imapPort', e.target.value)}
              aria-label={t('IMAP-Anschluss')}
            />
          </div>
          <div className="form-row">
            <input
              type="text"
              value={werte.smtpHost}
              onChange={(e) => onWert('smtpHost', e.target.value)}
              placeholder={gefunden?.smtpHost ?? 'smtp.anbieter.de'}
              aria-label={t('SMTP-Server')}
            />
            <input
              type="text"
              className="server-port"
              value={werte.smtpPort}
              onChange={(e) => onWert('smtpPort', e.target.value)}
              aria-label={t('SMTP-Anschluss')}
            />
          </div>
          {gefunden && (
            <button type="button" className="link-btn" onClick={() => onVonHand(false)}>
              {t('Doch das Gefundene nehmen')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
