import { useEffect, useState } from 'react';
import * as api from '../api.js';

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

const HERKUNFT: Record<string, string> = {
  eingebaut: 'bekannter Anbieter',
  anbieterdatenbank: 'aus der Anbieterdatenbank',
  domain: 'von der Domain selbst',
  dns: 'aus den DNS-Einträgen',
};

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
      {sucht && <span className="server-status">Serveradressen werden gesucht…</span>}

      {fertig && gefunden && (
        <span className="server-status server-gefunden">
          {/* Manche Anbieter tragen einen ganzen Werbesatz als Namen ein
              ("mailbox.org -- damit Privates privat bleibt"). Nur der Anfang. */}
          {gefunden.anbieter
            ? `${gefunden.anbieter.split(/\s[-–—]{1,2}\s/)[0]!.slice(0, 40)} erkannt`
            : 'Serveradressen gefunden'}
          <span className="server-details">
            {gefunden.imapHost}:{gefunden.imapPort} · {gefunden.smtpHost}:{gefunden.smtpPort}
            {' · '}
            {HERKUNFT[gefunden.fundort] ?? gefunden.fundort}
          </span>
        </span>
      )}

      {fertig && !gefunden && (
        <span className="server-status server-fehlt">
          Für {domain} ist nichts hinterlegt
          <span className="server-details">
            Die Adressen stehen in der Hilfe deines Anbieters, meist unter „IMAP“.
          </span>
        </span>
      )}

      {fertig && gefunden && !vonHand && (
        <button type="button" className="link-btn" onClick={() => onVonHand(true)}>
          Andere Server eintragen
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
              aria-label="IMAP-Server"
            />
            <input
              type="text"
              className="server-port"
              value={werte.imapPort}
              onChange={(e) => onWert('imapPort', e.target.value)}
              aria-label="IMAP-Anschluss"
            />
          </div>
          <div className="form-row">
            <input
              type="text"
              value={werte.smtpHost}
              onChange={(e) => onWert('smtpHost', e.target.value)}
              placeholder={gefunden?.smtpHost ?? 'smtp.anbieter.de'}
              aria-label="SMTP-Server"
            />
            <input
              type="text"
              className="server-port"
              value={werte.smtpPort}
              onChange={(e) => onWert('smtpPort', e.target.value)}
              aria-label="SMTP-Anschluss"
            />
          </div>
          {gefunden && (
            <button type="button" className="link-btn" onClick={() => onVonHand(false)}>
              Doch das Gefundene nehmen
            </button>
          )}
        </div>
      )}
    </div>
  );
}
