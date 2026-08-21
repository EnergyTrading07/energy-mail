import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import * as socks from 'socks';
import { beschreibeProxy, proxyFuer } from './proxy.js';
import { resolveAccessToken } from './oauth/tokenAccess.js';
import { baueSigniertenTeil } from './pgpErkennung.js';
import { baueSigniertePost, baueVerschluesseltePost } from './smime/nachricht.js';
import type { AccountConfig, OutgoingMessage } from './types.js';
import { t } from './sprache.js';

async function buildSmtpAuth(config: AccountConfig) {
  if (config.auth.type === 'password') {
    return { user: config.auth.user, pass: config.auth.pass };
  }
  return {
    type: 'OAuth2' as const,
    user: config.auth.user,
    // Frisch anfordern statt der im Konto gespeicherten, möglicherweise verfallenen Fassung.
    accessToken: await resolveAccessToken(config),
  };
}

async function createTransport(config: AccountConfig) {
  /*
   * Derselbe Weg nach draußen wie beim Abrufen - siehe proxy.ts.
   *
   * Getrennt ermittelt und nicht vom IMAP-Befund übernommen: Abruf- und Sendeserver sind
   * verschiedene Rechner, und sowohl die Ausnahmeliste als auch ein PAC-Skript können für
   * sie Verschiedenes vorsehen.
   */
  const proxy = await proxyFuer(config.smtpHost, config.proxy);
  if (proxy.beanstandet) {
    console.warn(`[energy-mail] ${beschreibeProxy(proxy)}`);
  }

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    ...(proxy.adresse ? { proxy: proxy.adresse } : {}),
    /*
     * Verschlüsselung erzwingen, wenn nicht ohnehin von der ersten Sekunde an
     * verschlüsselt wird.
     *
     * Ohne diese Zeile entscheidet nodemailer allein anhand der EHLO-Antwort, ob es auf
     * TLS hochstuft - kündigt der Server kein STARTTLS an, sendet es STILL im Klartext
     * weiter. Ein Angreifer im Netzpfad (offenes WLAN, untergeschobener Router) braucht
     * also nur die Zeile "250-STARTTLS" aus der Antwort zu streichen, und schon geht
     * "AUTH LOGIN" mit dem Postfachkennwort unverschlüsselt über die Leitung.
     *
     * Das trifft nicht die Ausnahme, sondern den Regelfall: outlook.com, hotmail.com,
     * live.com, gmx.net, gmx.de, web.de und icloud.com stehen in providerPresets.ts
     * alle auf Port 587 mit smtpSecure:false, und buildPasswordAccount faellt ebenfalls
     * darauf zurueck. Mit requireTLS scheitert ein solcher Server sichtbar, statt
     * lautlos das Kennwort preiszugeben.
     */
    requireTLS: !config.smtpSecure,
    tls: { minVersion: 'TLSv1.2', servername: config.smtpHost },
    auth: await buildSmtpAuth(config),
  });

  /*
   * SOCKS muss nodemailer ausdrücklich gereicht werden.
   *
   * HTTP CONNECT bringt es selbst mit; für SOCKS erwartet es das Modul von außen, damit
   * niemand es mitschleppen muss, der es nicht braucht ("proxy_socks_module", siehe
   * nodemailer/lib/mailer/index.js). imapflow bindet dasselbe Paket ohnehin ein - hier
   * steht es als ausdrückliche Abhängigkeit, damit es nicht bloß zufällig im Baum liegt.
   *
   * Nur bei einer SOCKS-Adresse: das Modul zu laden, wo es nicht gebraucht wird, kostet
   * bei jedem Senden Zeit für nichts.
   */
  if (proxy.adresse?.startsWith('socks')) {
    transport.set('proxy_socks_module', socks);
  }

  return transport;
}

/** Prüft Erreichbarkeit und Zugangsdaten des SMTP-Servers, ohne eine Mail zu senden. */
export async function verifySmtpConnection(config: AccountConfig): Promise<void> {
  const transport = await createTransport(config);
  try {
    await transport.verify();
  } finally {
    transport.close();
  }
}

/**
 * Baut die vollständige MIME-Nachricht. Bewusst getrennt vom Versand, damit exakt
 * dieselben Bytes verschickt und im Gesendet-Ordner abgelegt werden können - sonst
 * unterschieden sich Message-ID und Zeitstempel zwischen Versand und Ablage.
 */
/**
 * Kodiert eine Kopfzeile, falls sie Zeichen jenseits von ASCII enthält (RFC 2047).
 *
 * Ein Betreff mit Umlauten ginge sonst als rohe Bytes hinaus, und Mailserver dürfen
 * solche Kopfzeilen abweisen oder verstümmeln.
 */
function kodiereKopfzeile(text: string): string {
  const sicher = sichereKopfzeile(text);
  if (!/[^\x20-\x7E]/.test(sicher)) return sicher;
  /*
   * Kodierte Wörter sind auf 75 Zeichen begrenzt (RFC 2047). Ein langer Betreff mit
   * Umlauten ergab bisher EIN Wort beliebiger Länge; zusammen mit der fehlenden Faltung
   * überschritt die Kopfzeile die 998 Zeichen aus RFC 5322. Strenge Server antworten
   * darauf mit "500 line too long", mildere schneiden ab - und bei einer
   * unterschriebenen Nachricht bricht damit die Prüfsumme.
   *
   * 45 Bytes je Stück, damit "=?UTF-8?B?" + Base64 + "?=" unter 75 Zeichen bleibt.
   */
  const stuecke: string[] = [];
  const bytes = Buffer.from(sicher, 'utf8');
  let ab = 0;
  while (ab < bytes.length) {
    let bis = Math.min(ab + 45, bytes.length);
    // Nie mitten in einer UTF-8-Folge trennen: Fortsetzungsbytes beginnen mit 10xxxxxx.
    while (bis < bytes.length && (bytes[bis]! & 0xc0) === 0x80) bis--;
    stuecke.push(`=?UTF-8?B?${bytes.subarray(ab, bis).toString('base64')}?=`);
    ab = bis;
  }
  // Fortsetzungszeilen werden mit CRLF + Leerzeichen angehängt (RFC 5322, Faltung).
  return stuecke.join('\r\n ');
}

/**
 * Nimmt einer Kopfzeile die Möglichkeit, den Kopf zu verlassen.
 *
 * Der Angriff geht so: Ein fremder Absender schickt eine Nachricht mit
 * `Subject: =?UTF-8?B?<base64 von "Rechnung\r\nBcc: angreifer@example.org">?=`.
 * imapflow dekodiert das kodierte Wort - der Betreff enthält danach ein echtes CRLF.
 * Antwortet der Nutzer, übernimmt composeHelpers ihn mitsamt "Re: " in den Entwurf, und
 * beim Versand entsteht daraus eine zusätzliche, echte Kopfzeile.
 *
 * Auf dem üblichen Weg fängt MailComposer das ab. Der handgebaute PGP/MIME-Zweig
 * darunter tut es ausdrücklich nicht - er darf am geschützten Teil nichts anfassen -,
 * und genau dort wäre der Schaden am größten: eine mit OpenPGP unterschriebene, also für
 * den Empfänger besonders vertrauenswürdige Nachricht ginge mit eingeschleustem Bcc an
 * einen Dritten, oder der Kopf würde vorzeitig beendet und der ganze Text ersetzt.
 *
 * Ersetzt statt abzuweisen: ein Betreff mit einem Zeilenumbruch ist kein Angriff,
 * sondern meistens ein Versehen beim Einfügen - und die Nachricht deshalb gar nicht zu
 * senden wäre die schlechtere Antwort.
 */
export function sichereKopfzeile(wert: string): string {
  // eslint-disable-next-line no-control-regex
  return wert.replace(/[\r\n\x00]+/g, ' ').trim();
}

/**
 * Dasselbe für Adressfelder - hier wird verworfen statt ersetzt.
 *
 * Eine Empfängeradresse mit einem Zeilenumbruch darin ist keine Adresse. Sie mit einem
 * Leerzeichen zu reparieren ergäbe eine, die es nicht gibt; sie wegzulassen ist ehrlicher
 * und fällt beim Senden auf.
 */
function sichereAdressen(adressen: readonly string[]): string[] {
  // eslint-disable-next-line no-control-regex
  return adressen.filter((a) => !/[\r\n\x00]/.test(a));
}

/**
 * Baut eine mit OpenPGP geschützte Nachricht nach RFC 3156.
 *
 * Von Hand zusammengesetzt und nicht über den üblichen Weg, und das aus einem zwingenden
 * Grund: bei einer unterschriebenen Nachricht muss der geschützte Teil beim Empfänger
 * Byte für Byte so ankommen, wie er unterschrieben wurde. Jede Bibliothek, die den Teil
 * noch einmal anfasst - ihn umbricht, neu kodiert oder auch nur ein Zeilenende ändert -,
 * macht die Unterschrift ungültig. Also wird hier nichts angefasst.
 */
function baueGeschuetzteNachricht(
  kopfzeilen: string[],
  message: OutgoingMessage,
): Buffer | null {
  /*
   * Die Trennmarke aus echtem Zufall statt aus Date.now() und Math.random().
   *
   * Beides war vorhersagbar. Wer den Inhalt der Nachricht teilweise steuert - bei einer
   * Weiterleitung oder einem Zitat ist das der Normalfall -, konnte die Marke damit
   * erraten und sie in den Text schreiben: die MIME-Struktur zerfällt dann an einer
   * Stelle, die der Absender bestimmt, und das ausgerechnet in einer unterschriebenen
   * Nachricht.
   */
  const grenze = `=_EnergyMail_${randomBytes(18).toString('base64url')}`;

  if (message.pgpGeheimtext) {
    const teile = [
      ...kopfzeilen,
      `Content-Type: multipart/encrypted; protocol="application/pgp-encrypted"; boundary="${grenze}"`,
      '',
      t('Diese Nachricht ist mit OpenPGP verschlüsselt.'),
      `--${grenze}`,
      'Content-Type: application/pgp-encrypted',
      'Content-Description: PGP/MIME version identification',
      '',
      'Version: 1',
      `--${grenze}`,
      'Content-Type: application/octet-stream; name="encrypted.asc"',
      'Content-Description: OpenPGP encrypted message',
      'Content-Disposition: inline; filename="encrypted.asc"',
      '',
      message.pgpGeheimtext.trimEnd(),
      `--${grenze}--`,
      '',
    ];
    return Buffer.from(teile.join('\r\n'), 'utf8');
  }

  if (message.pgpSignatur) {
    /**
     * Genau dieser Block wurde unterschrieben, Byte für Byte - er wird hier nicht mehr
     * angefasst. Gebaut hat ihn baueSigniertenTeil(), und zwar dieselbe Funktion, die
     * auch der Unterschrift zugrunde lag. Zwei Stellen, die denselben Teil unabhängig
     * voneinander zusammensetzen, laufen unweigerlich irgendwann auseinander.
     */
    const geschuetzt = message.pgpSignierterTeil ?? baueSigniertenTeil(message.text ?? '');

    const teile = [
      ...kopfzeilen,
      `Content-Type: multipart/signed; micalg=pgp-sha256; protocol="application/pgp-signature"; boundary="${grenze}"`,
      '',
      t('Diese Nachricht ist mit OpenPGP unterschrieben.'),
      `--${grenze}`,
      geschuetzt,
      `--${grenze}`,
      'Content-Type: application/pgp-signature; name="signature.asc"',
      'Content-Description: OpenPGP digital signature',
      'Content-Disposition: attachment; filename="signature.asc"',
      '',
      message.pgpSignatur.trimEnd(),
      `--${grenze}--`,
      '',
    ];
    return Buffer.from(teile.join('\r\n'), 'utf8');
  }

  /*
   * S/MIME. Aufgebaut nach RFC 8551 statt RFC 3156 - dieselbe Idee, andere Marken: Die
   * Unterschrift heißt hier "application/pkcs7-signature" und ist Base64 statt Text, und
   * die verschlüsselte Form ist kein "multipart/encrypted", sondern ein einziger Teil.
   *
   * Zusammengesetzt wird auch das nicht hier, sondern in smime/nachricht.ts. Grund: Bei
   * einer Nachricht, die unterschrieben UND verschlüsselt ist, steckt genau dieselbe
   * Einheit noch einmal im Umschlag. Zwei Stellen, die sie unabhängig voneinander bauen,
   * liefen auseinander - und der Fehler fiele erst dem Empfänger auf.
   */
  if (message.smimeGeheimtext) {
    const paket = baueVerschluesseltePost(Buffer.from(message.smimeGeheimtext, 'base64'));
    return Buffer.from(
      [...kopfzeilen, ...paket.kopfzeilen, '', paket.koerper].join('\r\n'),
      'utf8',
    );
  }

  if (message.smimeSignatur) {
    const geschuetzt = message.smimeSignierterTeil ?? baueSigniertenTeil(message.text ?? '');
    const paket = baueSigniertePost(
      geschuetzt,
      Buffer.from(message.smimeSignatur, 'base64'),
      grenze,
    );
    return Buffer.from(
      [...kopfzeilen, ...paket.kopfzeilen, '', t('Diese Nachricht ist mit S/MIME unterschrieben.'), paket.koerper].join('\r\n'),
      'utf8',
    );
  }

  return null;
}

export async function buildRawMessage(
  config: AccountConfig,
  message: OutgoingMessage,
): Promise<Buffer> {
  /**
   * Unter welcher Adresse die Nachricht hinausgeht. Ohne Angabe die des Kontos; sonst
   * eine der weiteren Identitäten - verschickt wird in beiden Fällen über denselben
   * Server, nur der Kopf nennt einen anderen Absender.
   */
  const absender = message.absender?.email ?? config.email;
  const name = message.absender?.displayName ?? config.displayName;

  if (
    message.pgpSignatur ||
    message.pgpGeheimtext ||
    message.smimeSignatur ||
    message.smimeGeheimtext
  ) {
    const empfaenger = sichereAdressen(message.to);
    const kopie = sichereAdressen(message.cc ?? []);
    /*
     * Die Domain für die Message-ID. Ohne "@" in der Absenderadresse stand hier bislang
     * "<...@undefined>" - eine syntaktisch ungültige Kennung, an der Empfänger die
     * Nachricht nicht in den Gesprächsfaden einsortieren können und die manche
     * Spamfilter abwerten.
     */
    const domain = (absender.split('@')[1] ?? config.email.split('@')[1] ?? 'localhost').trim();
    const kopfzeilen = [
      `From: ${name ? `${kodiereKopfzeile(name)} <${sichereKopfzeile(absender)}>` : sichereKopfzeile(absender)}`,
      `To: ${empfaenger.join(', ')}`,
      ...(kopie.length ? [`Cc: ${kopie.join(', ')}`] : []),
      `Subject: ${kodiereKopfzeile(message.subject)}`,
      // toUTCString() endet auf "GMT"; RFC 5322 verlangt "+0000". nodemailer macht
      // dieselbe Ersetzung im Normalweg - der handgebaute Zweig hatte sie nicht.
      `Date: ${new Date().toUTCString().replace(/GMT$/, '+0000')}`,
      // Aus crypto statt aus Math.random: Letzteres ist vorhersagbar, und zusammen mit
      // Date.now() gäbe die Kennung zusätzlich die Sendezeit preis.
      `Message-ID: <${randomBytes(12).toString('hex')}@${domain}>`,
      ...(message.inReplyTo ? [`In-Reply-To: ${sichereKopfzeile(message.inReplyTo)}`] : []),
      ...(message.references?.length
        ? [`References: ${message.references.map(sichereKopfzeile).join(' ')}`]
        : []),
      'MIME-Version: 1.0',
      /*
       * Die zusätzlichen Kopfzeilen auch hier - sonst fehlte ausgerechnet bei
       * unterschriebener Post der Vermerk "im Auftrag von".
       *
       * Sie stehen AUSSEN und brechen die Unterschrift nicht: Nach RFC 3156 wird der
       * MIME-Teil unterschrieben, nicht der Umschlag darum. Was hier dazukommt, ist
       * dieselbe Sorte Zeile wie From, To und Subject, die ebenfalls außerhalb liegen.
       */
      ...Object.entries(message.kopfzeilen ?? {}).map(
        ([name, wert]) => `${sichereKopfzeile(name)}: ${sichereKopfzeile(wert)}`,
      ),
    ];
    const gebaut = baueGeschuetzteNachricht(kopfzeilen, message);
    if (gebaut) return gebaut;
  }

  const composer = new MailComposer({
    from: name ? { name, address: absender } : absender,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    text: message.text,
    html: message.html,
    inReplyTo: message.inReplyTo,
    references: message.references,
    attachments: message.attachments,
    /**
     * Die Antwort auf eine Besprechungseinladung.
     *
     * Sie muss als gleichrangige Fassung neben dem Text stehen ("multipart/alternative"),
     * nicht als Anhang: nur dann erkennt das Programm des Organisators sie als Antwort
     * und trägt die Zu- oder Absage im Termin ein. Als Anhang beigelegt bekäme er eine
     * Datei, die er von Hand öffnen müsste.
     *
     * Der Zusatz "method=REPLY" gehört in den Typ - ohne ihn nimmt Outlook die Datei
     * zwar an, deutet sie aber als neue Einladung.
     */
    alternatives: message.kalenderAntwort
      ? [
          {
            contentType: 'text/calendar; charset=utf-8; method=REPLY',
            content: message.kalenderAntwort,
          },
        ]
      : undefined,
    /*
     * Weitere Kopfzeilen, wörtlich.
     *
     * Gebraucht von der Abwesenheitsnotiz (`Auto-Submitted: auto-replied`) und von der
     * Stellvertretung (`Sender:`). Der handgebaute PGP-Zweig weiter oben nimmt dieselben
     * Zeilen auf - sonst fehlte der Vermerk "im Auftrag von" ausgerechnet bei
     * unterschriebener Post.
     */
    headers: message.kopfzeilen,
  });
  return composer.compile().build();
}

/** Verschickt eine fertig gebaute Nachricht unverändert über SMTP. */
export async function sendRawMessage(
  config: AccountConfig,
  raw: Buffer,
  recipients: string[],
): Promise<void> {
  const transport = await createTransport(config);
  try {
    // envelope muss explizit gesetzt werden: bei "raw" liest Nodemailer die Empfänger
    // nicht aus den Kopfzeilen - und Bcc darf ohnehin nicht im Versand stehen.
    //
    // Der Absender im Umschlag bleibt bewusst der des Kontos, auch wenn im Kopf eine
    // andere Adresse steht: hierhin gehen Unzustellbarkeitsmeldungen, und die
    // Absenderprüfung der Gegenseite rechnet mit der Adresse, unter der wir angemeldet
    // sind. Ein fremder Umschlagabsender führte dort geradewegs in den Spamordner.
    await transport.sendMail({
      envelope: { from: config.email, to: recipients },
      raw,
    });
  } finally {
    transport.close();
  }
}
