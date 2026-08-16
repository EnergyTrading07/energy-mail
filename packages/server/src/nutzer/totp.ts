import crypto from 'node:crypto';

/**
 * Der zweite Faktor: zeitbasierte Einmalkennwörter (TOTP, RFC 6238).
 *
 * ## Warum ausgerechnet TOTP
 *
 * Weil es das einzige Verfahren ist, das ohne fremden Dienst auskommt. Ein Code per SMS
 * braucht einen Versender und ist obendrein das schwächste der gängigen Verfahren - eine
 * umgemeldete Rufnummer hebelt es aus. Ein Code per Mail schützt ein Mailprogramm nicht:
 * Wer das Postfach hat, hat den Code. Passkeys wären das beste Verfahren, verlangen aber
 * eine sichere Herkunft (https) und einen Browser mit WebAuthn - für einen Dienst, der
 * auch im Hausnetz auf http läuft, ist das keine Grundlage.
 *
 * TOTP dagegen ist Rechnerei: ein gemeinsames Geheimnis, die Uhrzeit, ein HMAC. Es
 * funktioniert mit jeder Authenticator-App, offline, ohne Konto bei irgendwem.
 *
 * ## Dieses Modul rechnet nur
 *
 * Es kennt keine Nutzer, keine Datei und keine Route. Das ist Absicht: So lässt sich alles
 * hier gegen die Prüfvektoren aus RFC 4226 und RFC 6238 prüfen - Zahlen, die von außen
 * kommen und nicht von mir. Was mit Nutzern zu tun hat, steht in zweiFaktor.ts.
 */

/** Ziffern eines Codes. Sechs, wie es jede Authenticator-App erwartet. */
export const STELLEN = 6;

/** Ein Zeitschritt in Sekunden - dreißig, wie überall. */
export const SCHRITT_SEKUNDEN = 30;

/**
 * Wie viele Schritte nach vorn und hinten noch gelten.
 *
 * Einer, also plus/minus dreißig Sekunden. Das fängt zwei Dinge: eine Uhr, die ein wenig
 * falsch geht, und den Menschen, der den Code abliest, während der Schritt umspringt.
 * Zwei oder drei wären bequemer und verdreifachten die Zahl der gültigen Codes - bei
 * sechs Ziffern ist das keine Kleinigkeit, sondern der Unterschied zwischen einer
 * Million und dreihunderttausend Versuchen.
 */
export const FENSTER = 1;

// --- Base32, RFC 4648 ---

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32, weil Authenticator-Apps nichts anderes lesen.
 *
 * Der otpauth-Weg schreibt es vor, und wer den Schlüssel von Hand abtippt, bekommt mit
 * Base32 ein Alphabet ohne Kleinbuchstaben und ohne die Ziffern 0, 1 und 8 - genau die,
 * die man mit O, l und B verwechselt.
 */
export function base32Kodiere(daten: Buffer): string {
  let bits = 0;
  let wert = 0;
  let aus = '';
  for (const byte of daten) {
    wert = (wert << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      aus += BASE32_ALPHABET[(wert >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) aus += BASE32_ALPHABET[(wert << (5 - bits)) & 31];
  // Auffüllen auf ein Vielfaches von acht Zeichen - so steht es in RFC 4648.
  while (aus.length % 8 !== 0) aus += '=';
  return aus;
}

/**
 * Zurück zu Bytes - großzügig beim Lesen.
 *
 * Leerzeichen und Kleinbuchstaben werden hingenommen, weil das Geheimnis zum Abtippen
 * angezeigt wird und Menschen es in Vierergruppen abschreiben. Ein Zeichen, das es im
 * Alphabet nicht gibt, ist dagegen ein Fehler und keine stille Null: Sonst ergäbe ein
 * vertipptes Geheimnis ein anderes, und der Nutzer bekäme statt "das stimmt nicht" ein
 * Konto, dessen Codes nie passen.
 */
export function base32Dekodiere(text: string): Buffer {
  const sauber = text.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let wert = 0;
  const aus: number[] = [];
  for (const zeichen of sauber) {
    const index = BASE32_ALPHABET.indexOf(zeichen);
    if (index < 0) throw new Error(`"${zeichen}" gehört nicht ins Base32-Alphabet.`);
    wert = (wert << 5) | index;
    bits += 5;
    if (bits >= 8) {
      aus.push((wert >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(aus);
}

/**
 * Ein frisches Geheimnis.
 *
 * Zwanzig Bytes, also 160 Bit - die Länge, die RFC 4226 für HMAC-SHA1 empfiehlt, und
 * zugleich die, die jede Authenticator-App erwartet. Als Base32 sind das 32 Zeichen.
 */
export function erzeugeGeheimnis(): string {
  return base32Kodiere(crypto.randomBytes(20)).replace(/=+$/, '');
}

// --- HOTP und TOTP ---

/**
 * Ein Einmalkennwort zu einem Zähler (HOTP, RFC 4226).
 *
 * Der Zähler geht als acht Bytes in einen HMAC-SHA1; aus dessen letztem Halbbyte wird
 * abgelesen, an welcher Stelle die vier Bytes stehen, die zur Zahl werden. Das heißt
 * "dynamic truncation" und steht so in Abschnitt 5.3.
 *
 * SHA1 und nicht SHA256, obwohl SHA1 als Signaturverfahren erledigt ist: In einem HMAC
 * ist es unangetastet, und es ist das Einzige, was jede Authenticator-App beherrscht.
 * Ein Geheimnis mit SHA256 wird von einem Teil der Apps stillschweigend falsch gerechnet -
 * der Nutzer sähe Codes, die nie passen, und keine Fehlermeldung.
 */
export function hotp(geheimnis: Buffer, zaehler: number, stellen = STELLEN): string {
  const zaehlerBytes = Buffer.alloc(8);
  /*
   * Als 64-Bit-Zahl, big endian. writeBigUInt64BE statt zweimal writeUInt32BE: Der Zähler
   * ist bei TOTP die Sekundenzahl geteilt durch dreißig und bleibt damit klein - aber die
   * Prüfvektoren aus RFC 6238 gehen bis 20000000000, und das ist mehr als 2^32.
   */
  zaehlerBytes.writeBigUInt64BE(BigInt(zaehler));

  const summe = crypto.createHmac('sha1', geheimnis).update(zaehlerBytes).digest();
  const versatz = summe[summe.length - 1]! & 0x0f;
  const zahl =
    ((summe[versatz]! & 0x7f) << 24) |
    (summe[versatz + 1]! << 16) |
    (summe[versatz + 2]! << 8) |
    summe[versatz + 3]!;

  return String(zahl % 10 ** stellen).padStart(stellen, '0');
}

/** Der Zeitschritt zu einem Augenblick - die Zahl, die beide Seiten gemeinsam haben. */
export function schrittZu(jetztMs: number): number {
  return Math.floor(jetztMs / 1000 / SCHRITT_SEKUNDEN);
}

/** Der Code, den eine Authenticator-App gerade anzeigen würde. */
export function totp(geheimnisBase32: string, jetztMs = Date.now(), stellen = STELLEN): string {
  return hotp(base32Dekodiere(geheimnisBase32), schrittZu(jetztMs), stellen);
}

/**
 * Prüft einen Code - und gibt zurück, ZU WELCHEM Schritt er gehört.
 *
 * Nicht `true`, sondern die Schrittnummer: Der Aufrufer muss sie sich merken, sonst lässt
 * sich derselbe Code innerhalb seiner dreißig Sekunden zweimal einlösen. Das ist keine
 * Theorie - es ist genau der Fall "jemand liest den Code über die Schulter mit". Ohne
 * diese Buchführung wäre TOTP ein Kennwort mit halber Minute Haltbarkeit.
 *
 * `null` heißt: passt nicht.
 */
export function pruefeCode(
  geheimnisBase32: string,
  code: string,
  jetztMs = Date.now(),
  fenster = FENSTER,
): number | null {
  const sauber = code.replace(/[\s-]/g, '');
  if (!/^[0-9]+$/.test(sauber) || sauber.length !== STELLEN) return null;

  let geheimnis: Buffer;
  try {
    geheimnis = base32Dekodiere(geheimnisBase32);
  } catch {
    return null;
  }

  const mitte = schrittZu(jetztMs);
  let treffer: number | null = null;
  for (let versatz = -fenster; versatz <= fenster; versatz++) {
    const schritt = mitte + versatz;
    if (schritt < 0) continue;
    /*
     * Ohne vorzeitigen Abbruch durch die ganze Schleife, und der Vergleich ist
     * zeitunabhängig.
     *
     * Ein `return` beim ersten Treffer verriete über die Antwortzeit, ob der Code zum
     * vorigen, zum aktuellen oder zum nächsten Schritt gehört. Das ist eine kleine
     * Auskunft, aber eine kostenlose Sparsamkeit dagegen.
     */
    if (gleich(hotp(geheimnis, schritt), sauber)) treffer = schritt;
  }
  return treffer;
}

/** Zeitunabhängiger Vergleich zweier gleich langer Zeichenketten. */
function gleich(a: string, b: string): boolean {
  const links = Buffer.from(a, 'utf8');
  const rechts = Buffer.from(b, 'utf8');
  if (links.length !== rechts.length) return false;
  return crypto.timingSafeEqual(links, rechts);
}

/**
 * Der otpauth-Weg, den die Authenticator-App aus dem QR-Bild liest.
 *
 * Aufbau nach der Festlegung von Google, an die sich alle Apps halten:
 *
 *   otpauth://totp/Aussteller:kennung?secret=...&issuer=Aussteller
 *
 * Der Aussteller steht doppelt darin - einmal im Namen, einmal als Feld. Das ist keine
 * Nachlässigkeit, sondern die Festlegung: Ältere Apps lesen nur den Namen, neuere nur das
 * Feld, und eine App, die beides liest und Unterschiedliches findet, zeigt es doppelt an.
 *
 * `algorithm`, `digits` und `period` bleiben weg. Sie stünden auf ihren Vorgabewerten -
 * und ein Teil der Apps rechnet mit einem ausdrücklich gesetzten Feld nachweislich falsch,
 * während die Vorgabe überall stimmt. Zugleich hält es den Weg kurz, und das entscheidet,
 * wie fein das QR-Bild wird.
 */
export function otpauthWeg(kennung: string, geheimnis: string, aussteller = 'Energy Mail'): string {
  const name = `${encodeURIComponent(aussteller)}:${encodeURIComponent(kennung)}`;
  return `otpauth://totp/${name}?secret=${geheimnis}&issuer=${encodeURIComponent(aussteller)}`;
}

/** Das Geheimnis in Vierergruppen - zum Abtippen, wenn die Kamera nicht mitspielt. */
export function lesbar(geheimnis: string): string {
  return (geheimnis.match(/.{1,4}/g) ?? []).join(' ');
}
