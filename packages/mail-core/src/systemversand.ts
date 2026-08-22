import nodemailer from 'nodemailer';
import { t } from './sprache.js';

/**
 * Post, die der Dienst selbst verschickt - nicht ein Nutzer.
 *
 * ## Warum das ein eigener Weg ist und nicht der vorhandene
 *
 * smtpClient.ts verschickt über ein KONTO: es nimmt eine `AccountConfig`, holt sich
 * gegebenenfalls eine OAuth-Marke, legt eine Kopie im Gesendet-Ordner ab und trägt die
 * Identität eines Menschen in den Absender. Nichts davon passt hier. Eine
 * Bestätigungsmail an jemanden, der noch gar kein Konto hat, geht von niemandem aus -
 * sie geht vom Dienst aus, und der ist kein Postfach.
 *
 * Der Unterschied ist nicht bloß begrifflich. Ginge Systempost über das Konto eines
 * Menschen, dann stünde seine Adresse unter jeder Registrierungsmail, seine
 * Zugangsdaten wären für den Vorgang nötig, und mit seinem Ausscheiden aus dem Betrieb
 * hörte die Registrierung auf zu funktionieren - bei einem Vorgang, der niemandem
 * auffällt, bis ihn jemand braucht.
 *
 * ## Was hier bewusst fehlt
 *
 * **Kein HTML.** Systempost ist reiner Text. Eine HTML-Mail erlaubt es, einen Link
 * anders aussehen zu lassen, als er ist - und genau das ist das Muster, an dem ein
 * Mensch Betrugspost erkennen soll. Wer seinen Nutzern beibringt, dass die eigene
 * Anmeldemail so aussieht wie eine Fälschung, hat ihnen die Prüfregel genommen. Dazu
 * kommt: kein nachladbares Bild, also auch kein Zählpixel, der verriete, wann jemand die
 * Mail geöffnet hat.
 *
 * **Kein Anhang, keine Vorlagen.** Was hier hinausgeht, sind ein paar Zeilen mit einem
 * Link darin. Alles darüber hinaus wäre eine Maschinerie für einen Bedarf, den es nicht
 * gibt.
 */

export interface SystemversandZugang {
  host: string;
  port: number;
  /**
   * Ob von der ersten Sekunde an verschlüsselt wird (üblicherweise Port 465).
   *
   * `false` heißt NICHT "unverschlüsselt", sondern STARTTLS auf Port 587 - siehe
   * `requireTLS` unten. Einen Weg ohne Verschlüsselung gibt es hier gar nicht.
   */
  secure: boolean;
  benutzer?: string;
  kennwort?: string;
  /** Was im Von-Feld steht, etwa `noreply@firma.de`. */
  absender: string;
  /** Der Klarname davor - fehlt er, steht nur die Adresse da. */
  absenderName?: string;
}

export interface SystemNachricht {
  an: string;
  betreff: string;
  /** Reiner Text. Siehe oben, warum es kein HTML gibt. */
  text: string;
}

/**
 * Verbietet CR und LF in einer Kopfzeile.
 *
 * Das ist die Einschleusung von Kopfzeilen, und sie ist hier keine theoretische Sorge:
 * Die Empfängeradresse einer Bestätigungsmail kommt aus einem Formular, das jedem
 * Fremden offensteht. Stünde in dieser Eingabe ein Zeilenumbruch, ließe sich dahinter
 * ein `Bcc:` setzen - und der Dienst verschickte für einen Unbekannten Post an
 * beliebige Dritte. Aus einer Registrierung würde ein offenes Versandtor.
 *
 * nodemailer wehrt das an mehreren Stellen selbst ab. Die Prüfung steht trotzdem hier,
 * und zwar zuerst: Ein Schutz, der in einer fremden Abhängigkeit liegt, ist ein Schutz,
 * dessen Fortbestand niemand prüft.
 */
function ohneUmbruch(wert: string, feld: string): string {
  if (/[\r\n]/.test(wert)) {
    throw new Error(`Unbrauchbare Angabe in "${feld}" - Zeilenumbrüche sind dort nicht möglich.`);
  }
  return wert;
}

function baueTransport(zugang: SystemversandZugang) {
  return nodemailer.createTransport({
    host: zugang.host,
    port: zugang.port,
    secure: zugang.secure,
    /*
     * Dieselbe Härtung wie beim Versand über ein Konto - und aus demselben Grund.
     *
     * Ohne `requireTLS` entscheidet nodemailer allein anhand der EHLO-Antwort, ob es auf
     * TLS hochstuft. Kündigt der Server kein STARTTLS an, geht die Post STILL im
     * Klartext hinaus, und mit ihr das Kennwort des Systemkontos. Ein Angreifer im
     * Netzpfad braucht dafür nur die Zeile "250-STARTTLS" aus der Antwort zu streichen.
     * Mit requireTLS scheitert eine solche Verbindung sichtbar.
     */
    requireTLS: !zugang.secure,
    tls: { minVersion: 'TLSv1.2', servername: zugang.host },
    ...(zugang.benutzer
      ? { auth: { user: zugang.benutzer, pass: zugang.kennwort ?? '' } }
      : {}),
  });
}

/**
 * Verbindung und Zugangsdaten prüfen, ohne etwas zu verschicken.
 *
 * Der Verwalter soll erfahren, dass seine Angaben falsch sind, WÄHREND er sie einträgt -
 * und nicht daran, dass Wochen später niemand mehr eine Bestätigungsmail bekommt. Ein
 * Systemversand ist der Teil einer Registrierung, der lautlos ausfällt: Wer keine Mail
 * bekommt, beschwert sich nicht beim Betreiber, er geht weg.
 */
export async function pruefeSystemversand(zugang: SystemversandZugang): Promise<void> {
  const transport = baueTransport(zugang);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/** Verschickt eine Systemnachricht. Wirft, wenn der Server sie nicht annimmt. */
export async function sendeSystemNachricht(
  zugang: SystemversandZugang,
  nachricht: SystemNachricht,
): Promise<void> {
  const an = ohneUmbruch(nachricht.an.trim(), 'an');
  const betreff = ohneUmbruch(nachricht.betreff, 'betreff');
  const absender = ohneUmbruch(zugang.absender.trim(), 'absender');
  const name = zugang.absenderName ? ohneUmbruch(zugang.absenderName, 'absenderName') : '';

  if (!an.includes('@')) throw new Error(t('Das ist keine brauchbare Mailadresse.'));

  const transport = baueTransport(zugang);
  try {
    await transport.sendMail({
      from: name ? { name, address: absender } : absender,
      to: an,
      subject: betreff,
      text: nachricht.text,
      /*
       * Automatische Antworten unterbinden.
       *
       * Ohne diese Kopfzeilen antwortet die Abwesenheitsnotiz des Empfängers auf die
       * Bestätigungsmail, und der Systemabsender - der niemandem gehört - sammelt Post,
       * die nie jemand liest. Bei einer Adresse namens "noreply" ist das nicht bloß
       * unschön: Der Absender läuft voll, und irgendwann weist der Server ihn ab.
       */
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      },
    });
  } finally {
    transport.close();
  }
}
