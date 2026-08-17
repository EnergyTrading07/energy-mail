/**
 * Erkennt, ob und wie eine Nachricht mit OpenPGP geschützt ist.
 *
 * Bewusst getrennt von allem Rechnen: hier wird nur entschieden, welcher Fall vorliegt.
 * Diese Entscheidung ist sicherheitsrelevant und muss darum für sich prüfbar sein - eine
 * falsch eingeordnete Nachricht führt entweder zu einem Schloss, wo keines hingehört,
 * oder zu einer verschluckten Signatur.
 *
 * Es gibt zwei Bauformen, und sie haben nichts miteinander zu tun:
 *
 *   PGP/MIME (RFC 3156) - der Schutz steckt in der Struktur der Nachricht. Signiert ist
 *   "multipart/signed" mit zwei Teilen: dem geschützten Inhalt und der Unterschrift.
 *   Verschlüsselt ist "multipart/encrypted" mit einer Kennung und dem Geheimtext.
 *
 *   Inline (die ältere Art) - der Schutz steckt mitten im Text, zwischen Zeilen wie
 *   "-----BEGIN PGP MESSAGE-----". Das ist der gefährlichere Fall, siehe unten.
 */

import { randomBytes } from 'node:crypto';

export type PgpArt =
  | { art: 'keine' }
  /** PGP/MIME: unterschrieben, Inhalt im Klartext lesbar. */
  | { art: 'mime-signiert'; inhaltTeil: string; signaturTeil: string; mikalg?: string }
  /** PGP/MIME: verschlüsselt (und womöglich zusätzlich unterschrieben). */
  | { art: 'mime-verschluesselt'; geheimTeil: string }
  /** Der ganze Text ist ein verschlüsselter Block. */
  | { art: 'inline-verschluesselt' }
  /**
   * Im Text steht ein unterschriebener Block.
   *
   * "vollstaendig" sagt, ob der Block den gesamten Text ausmacht. Steht auch nur ein
   * Zeichen außerhalb, gilt die Unterschrift nicht für das, was man sieht - ein Angreifer
   * kann beliebigen Text davor oder dahinter setzen, ohne die Unterschrift zu berühren.
   * Genau das ist der klassische Trick gegen Inline-PGP, und deshalb muss die Oberfläche
   * diesen Unterschied kennen.
   */
  | { art: 'inline-signiert'; vollstaendig: boolean };

/** Ein Knoten der MIME-Struktur, so weit hier gebraucht. */
export interface MimeKnoten {
  part?: string;
  type?: string;
  parameters?: Record<string, string>;
  childNodes?: MimeKnoten[];
}

const typVon = (knoten: MimeKnoten | undefined) => (knoten?.type ?? '').toLowerCase();

/**
 * Sucht in der Struktur nach PGP/MIME.
 *
 * Nur die oberste Ebene und deren unmittelbare Verschachtelung: ein signierter Teil
 * irgendwo tief in einer weitergeleiteten Nachricht schützt nicht die Nachricht, die man
 * gerade liest. Ihn als "unterschrieben" auszuweisen wäre irreführend.
 */
export function erkenneMimeSchutz(wurzel: MimeKnoten | undefined): PgpArt {
  if (!wurzel) return { art: 'keine' };

  const typ = typVon(wurzel);
  const kinder = wurzel.childNodes ?? [];

  if (typ === 'multipart/signed') {
    // Genau zwei Teile, und der zweite muss die Unterschrift sein.
    const [inhalt, signatur] = kinder;
    if (
      kinder.length === 2 &&
      inhalt?.part &&
      signatur?.part &&
      typVon(signatur) === 'application/pgp-signature'
    ) {
      return {
        art: 'mime-signiert',
        inhaltTeil: inhalt.part,
        signaturTeil: signatur.part,
        // Welches Streuverfahren angekündigt wurde. Nur nachrichtlich - geprüft wird,
        // was in der Unterschrift wirklich steht, nicht was hier behauptet wird.
        mikalg: wurzel.parameters?.['protocol'] ? wurzel.parameters?.['micalg'] : undefined,
      };
    }
    return { art: 'keine' };
  }

  if (typ === 'multipart/encrypted') {
    const [kennung, geheim] = kinder;
    if (
      kinder.length === 2 &&
      geheim?.part &&
      typVon(kennung) === 'application/pgp-encrypted' &&
      typVon(geheim) === 'application/octet-stream'
    ) {
      return { art: 'mime-verschluesselt', geheimTeil: geheim.part };
    }
    return { art: 'keine' };
  }

  return { art: 'keine' };
}

const BEGINN_NACHRICHT = '-----BEGIN PGP MESSAGE-----';
const ENDE_NACHRICHT = '-----END PGP MESSAGE-----';
const BEGINN_SIGNIERT = '-----BEGIN PGP SIGNED MESSAGE-----';
const ENDE_SIGNATUR = '-----END PGP SIGNATURE-----';

/** Erkennt Inline-PGP im Klartext einer Nachricht. */
export function erkenneInlineSchutz(text: string | undefined): PgpArt {
  if (!text) return { art: 'keine' };
  const inhalt = text.replace(/\r\n/g, '\n');

  const beginnGeheim = inhalt.indexOf(BEGINN_NACHRICHT);
  if (beginnGeheim >= 0 && inhalt.includes(ENDE_NACHRICHT)) {
    return { art: 'inline-verschluesselt' };
  }

  const beginnSigniert = inhalt.indexOf(BEGINN_SIGNIERT);
  if (beginnSigniert < 0) return { art: 'keine' };

  const endeSignatur = inhalt.indexOf(ENDE_SIGNATUR);
  if (endeSignatur < 0) return { art: 'keine' };

  // Ausserhalb des Blocks darf nichts stehen ausser Leerraum - sonst gilt die
  // Unterschrift nicht fuer das, was angezeigt wird.
  const davor = inhalt.slice(0, beginnSigniert);
  const danach = inhalt.slice(endeSignatur + ENDE_SIGNATUR.length);
  const vollstaendig = davor.trim() === '' && danach.trim() === '';

  return { art: 'inline-signiert', vollstaendig };
}

/**
 * Wie sehr man dem Absender einer geprüften Unterschrift trauen darf.
 *
 * Der Unterschied zwischen den ersten beiden ist der, an dem sich alles entscheidet und
 * den viele Programme verwischen: eine mathematisch gültige Unterschrift sagt nur, dass
 * der Besitzer eines bestimmten Schlüssels sie geleistet hat. Ob dieser Schlüssel dem
 * Absender gehört, ist eine völlig andere Frage - und sie lässt sich nicht rechnen.
 */
export type Vertrauen =
  /** Gültig, und der Schlüssel gehört nachweislich zu der Adresse, die im Absender steht. */
  | 'gueltig'
  /** Gültig, aber der Schlüssel nennt eine andere Adresse als der Absender. */
  | 'gueltig-fremde-adresse'
  /** Der Schlüssel ist unbekannt - die Unterschrift lässt sich nicht prüfen. */
  | 'schluessel-fehlt'
  /** Geprüft und falsch. Das ist keine Kleinigkeit. */
  | 'ungueltig'
  /** Der Schlüssel ist abgelaufen oder zurückgezogen. */
  | 'schluessel-abgelaufen';

export interface Signaturbefund {
  vertrauen: Vertrauen;
  /** Fingerabdruck des Schlüssels, mit dem unterschrieben wurde. */
  fingerabdruck?: string;
  /** Adressen, die der Schlüssel für sich beansprucht. */
  schluesselAdressen?: string[];
  /** Nur bei Inline: ob die Unterschrift den ganzen angezeigten Text abdeckt. */
  deckungGanzerText?: boolean;
  /** Klartext des Fehlers, wenn etwas schiefging. */
  grund?: string;
}

/**
 * Entscheidet, ob der Schlüssel zum Absender passt.
 *
 * Verglichen wird nur die Adresse, nicht der Anzeigename: Namen sind frei wählbar und
 * beweisen nichts. Groß- und Kleinschreibung spielt keine Rolle, der Teil hinter dem
 * Klammeraffen ist ohnehin unempfindlich, und beim Teil davor halten es alle gängigen
 * Anbieter ebenso.
 */
export function passtZumAbsender(
  absender: string | undefined,
  schluesselAdressen: readonly string[],
): boolean {
  const wer = absender?.trim().toLowerCase();
  if (!wer) return false;
  return schluesselAdressen.some((a) => a.trim().toLowerCase() === wer);
}

/**
 * Fasst zusammen, was man dem Ergebnis einer Prüfung entnehmen darf.
 *
 * Getrennt vom Rechnen, damit sich genau diese Entscheidung prüfen lässt - sie ist die,
 * die dem Nutzer am Ende als Schloss oder Warnung erscheint.
 */
export function beurteileSignatur(pruefung: {
  /** Ob die Unterschrift mathematisch aufgeht. */
  stimmt: boolean;
  /** Ob der zugehörige Schlüssel überhaupt vorlag. */
  schluesselBekannt: boolean;
  schluesselAbgelaufen?: boolean;
  schluesselZurueckgezogen?: boolean;
  absender?: string;
  schluesselAdressen?: string[];
}): Vertrauen {
  if (!pruefung.schluesselBekannt) return 'schluessel-fehlt';
  if (!pruefung.stimmt) return 'ungueltig';
  if (pruefung.schluesselAbgelaufen || pruefung.schluesselZurueckgezogen) {
    return 'schluessel-abgelaufen';
  }
  return passtZumAbsender(pruefung.absender, pruefung.schluesselAdressen ?? [])
    ? 'gueltig'
    : 'gueltig-fremde-adresse';
}

/**
 * Schneidet aus der rohen Nachricht genau den Teil heraus, der unterschrieben wurde.
 *
 * Das ist die heikelste Stelle der ganzen Signaturprüfung, und zwar aus einem Grund:
 * unterschrieben ist nicht der Text, sondern der MIME-Teil Byte für Byte - samt seiner
 * eigenen Kopfzeilen und mit CRLF als Zeilenende. Wird beim Herausschneiden auch nur ein
 * Zeilenende umgeschrieben oder ein Byte zu viel mitgenommen, schlägt die Prüfung fehl,
 * obwohl mit der Nachricht alles in Ordnung ist. Eine Warnung, die grundlos erscheint,
 * ist schlimmer als keine: man gewöhnt sich an sie und übersieht die echte.
 *
 * Die Regel aus RFC 2046: der Teil beginnt nach der Zeile "--grenze" und endet vor dem
 * CRLF, das der nächsten Grenzzeile vorangeht. Dieses CRLF gehört zur Grenze, nicht zum
 * Inhalt - es mitzunehmen ist der klassische Fehler.
 */
export function schneideSigniertenTeil(roh: Buffer, grenze: string): Buffer | null {
  if (!grenze) return null;

  const anfangsMarke = Buffer.from(`--${grenze}`, 'utf8');
  const start = roh.indexOf(anfangsMarke);
  if (start < 0) return null;

  // Hinter der Grenzzeile geht es los - erst nach deren Zeilenende.
  const zeilenende = roh.indexOf('\r\n', start);
  if (zeilenende < 0) return null;
  const inhaltAb = zeilenende + 2;

  // Die nächste Grenze, mit dem CRLF davor.
  const endMarke = Buffer.from(`\r\n--${grenze}`, 'utf8');
  const inhaltBis = roh.indexOf(endMarke, inhaltAb);
  if (inhaltBis < 0) return null;

  return roh.subarray(inhaltAb, inhaltBis);
}

/**
 * Holt die Grenze aus einer Content-Type-Zeile.
 *
 * Sie kann in Anführungszeichen stehen oder nicht, und der Name des Feldes ist
 * unempfindlich gegenüber Groß- und Kleinschreibung.
 */
export function leseGrenze(contentType: string | undefined): string | undefined {
  if (!contentType) return undefined;
  const t = /boundary\s*=\s*(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return t?.[1] ?? t?.[2] ?? undefined;
}

/**
 * Kodiert einen Text als quoted-printable.
 *
 * Nötig, weil eine unterschriebene Nachricht den Transport unverändert überstehen muss.
 * Mit "Content-Transfer-Encoding: 8bit" tut sie das nicht: Mailserver dürfen einen
 * solchen Teil unterwegs umkodieren, und danach stimmt die Unterschrift nicht mehr.
 * Genau das ist bei der ersten Probe über GMX passiert - die eigene Nachricht kam
 * zurück und meldete "Signed digest did not match".
 *
 * RFC 3156 verlangt deshalb ausdrücklich eine Kodierung, die den Weg übersteht.
 * Quoted-printable ist die richtige Wahl: der Text bleibt weitgehend lesbar, und es gibt
 * nichts mehr umzukodieren.
 */
export function alsQuotedPrintable(text: string): string {
  const bytes = Buffer.from(text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
  const zeilen: string[] = [];
  let zeile = '';

  const abschliessen = () => {
    zeilen.push(zeile);
    zeile = '';
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;

    // Ein Zeilenumbruch bleibt einer - er wird nicht kodiert.
    if (b === 0x0d && bytes[i + 1] === 0x0a) {
      // Leerzeichen am Zeilenende gehen unterwegs verloren; deshalb kodiert.
      if (zeile.endsWith(' ')) zeile = zeile.slice(0, -1) + '=20';
      else if (zeile.endsWith('\t')) zeile = zeile.slice(0, -1) + '=09';
      abschliessen();
      i++;
      continue;
    }

    const stueck =
      b === 0x3d || b < 32 || b > 126
        ? `=${b.toString(16).toUpperCase().padStart(2, '0')}`
        : String.fromCharCode(b);

    // Höchstens 76 Zeichen je Zeile, und der weiche Umbruch braucht selbst eines.
    if (zeile.length + stueck.length > 75) {
      zeilen.push(zeile + '=');
      zeile = '';
    }
    zeile += stueck;
  }
  if (zeile.length > 0) zeilen.push(zeile);

  return zeilen.join('\r\n');
}

/**
 * Baut den Teil, der unterschrieben wird - genau so, wie er später hinausgeht.
 *
 * Eine einzige Stelle für beides. Würde der Server etwas anderes unterschreiben, als der
 * Versand dann zusammensetzt, wäre jede Unterschrift ungültig - und das fiele erst dem
 * Empfänger auf.
 */
export function baueSigniertenTeil(text: string, anhaenge: GeschuetzterAnhang[] = []): string {
  const textteil =
    'Content-Type: text/plain; charset=utf-8\r\n' +
    'Content-Transfer-Encoding: quoted-printable\r\n' +
    '\r\n' +
    alsQuotedPrintable(text);

  if (anhaenge.length === 0) return textteil;

  /*
   * Mit Anhängen wird daraus ein mehrteiliger Umschlag - und der GANZE geht in die
   * Unterschrift beziehungsweise in den Geheimtext.
   *
   * Das ist der Punkt der Sache: Ein Schutz, der nur den Text erfasst und die Dateien
   * daneben offen mitschickt, ist schlimmer als keiner - er sieht aus wie Schutz. Bisher
   * wurde deshalb abgewiesen, sobald ein Anhang dabei war ("Anhänge lassen sich noch
   * nicht mitschützen"). Ehrlich, aber eine Lücke: Wer eine Rechnung unterschrieben
   * verschicken wollte, konnte es nicht.
   *
   * Die Kette dahinter bleibt unberührt. Sie behandelt diesen Teil als undurchsichtige
   * Bytes - signiert, verschlüsselt und verschickt werden sie unverändert, gleich ob
   * darin ein Textteil steht oder zehn.
   */
  const grenze = `=_EnergyMailTeil_${randomBytes(18).toString('base64url')}`;

  const stuecke = [
    `--${grenze}`,
    textteil,
    ...anhaenge.map((a) => [`--${grenze}`, anhangAlsTeil(a)].join('\r\n')),
    `--${grenze}--`,
  ];

  return (
    `Content-Type: multipart/mixed; boundary="${grenze}"\r\n` +
    '\r\n' +
    stuecke.join('\r\n') +
    '\r\n'
  );
}

/** Eine Datei, die mitgeschützt wird. */
export interface GeschuetzterAnhang {
  filename: string;
  content: Buffer;
  contentType?: string;
}

/**
 * Ein Anhang als MIME-Teil.
 *
 * Base64 und nicht quoted-printable: Es geht um beliebige Bytes, nicht um Text - eine
 * PDF-Datei als quoted-printable wäre um die Hälfte größer und nirgends lesbarer.
 *
 * Der Dateiname geht ZWEIMAL hinaus. `filename="…"` in ASCII versteht jedes Programm;
 * `filename*=UTF-8''…` nach RFC 2231 trägt die Umlaute. Wer nur eines von beiden
 * mitschickt, verliert entweder die alten Empfänger oder die Umlaute - und ein Anhang, der
 * beim Gegenüber "Rechnung Mrz.pdf" statt "Rechnung März.pdf" heißt, ist genau die Sorte
 * Kleinigkeit, die niemand meldet und die trotzdem stört.
 */
function anhangAlsTeil(anhang: GeschuetzterAnhang): string {
  const art = anhang.contentType || 'application/octet-stream';
  // eslint-disable-next-line no-control-regex
  const ascii = anhang.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const kodiert = encodeURIComponent(anhang.filename);

  // 76 Zeichen je Zeile - RFC 2045 erlaubt nicht mehr, und manche Server schneiden ab.
  const base64 = anhang.content.toString('base64').replace(/(.{76})/g, '$1\r\n');

  return (
    `Content-Type: ${art}; name="${ascii}"\r\n` +
    'Content-Transfer-Encoding: base64\r\n' +
    `Content-Disposition: attachment; filename="${ascii}"; filename*=UTF-8''${kodiert}\r\n` +
    '\r\n' +
    base64
  );
}
