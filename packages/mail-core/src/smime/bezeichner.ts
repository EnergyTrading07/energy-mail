/**
 * Die Objektbezeichner, mit denen S/MIME seine Verfahren benennt.
 *
 * ## Warum eine Tabelle und keine Zeichenketten im Code
 *
 * Weil ein Zahlendreher hier nicht auffällt. `1.2.840.113549.1.9.4` ist der
 * Nachrichtenabdruck, `1.2.840.113549.1.9.5` der Zeitpunkt - wer sich vertippt, prüft
 * den falschen Wert und merkt es nie, denn beide sind vorhanden und beide sehen aus wie
 * Bytes. An einer Stelle geschrieben, ist ein Zahlendreher ein Fehler in allen Prüfungen
 * zugleich und fällt damit sofort auf.
 *
 * ## Was hier NICHT steht
 *
 * Verfahren, die niemand mehr benutzen sollte, stehen nur mit Namen da, damit ein Befund
 * sagen kann, WAS er nicht annimmt. "Diese Nachricht ist mit RC2-40 verschlüsselt" ist
 * eine Auskunft, mit der man etwas anfangen kann; "unbekanntes Verfahren" ist keine.
 * Gerechnet wird mit ihnen nicht.
 */

export const B = {
  // --- CMS-Inhalte (RFC 5652) ---
  daten: '1.2.840.113549.1.7.1',
  signierteDaten: '1.2.840.113549.1.7.2',
  umschlageneDaten: '1.2.840.113549.1.7.3',
  /**
   * Der Umschlag mit Prüfsumme (RFC 5083).
   *
   * Ein eigener Typ und nicht bloß ein anderes Verfahren im gewöhnlichen Umschlag - und
   * das ist keine Formsache: In `EnvelopedData` gibt es kein Feld für die Prüfsumme eines
   * AEAD-Verfahrens. Wer AES-GCM trotzdem dort hineinschreibt und die Prüfsumme hinten an
   * den Geheimtext hängt, baut etwas, das kein Programm annimmt. OpenSSL sagt dazu
   * "cipher aead in enveloped data" und bricht ab - so ist es hier auch aufgefallen.
   */
  authUmschlageneDaten: '1.2.840.113549.1.9.16.1.23',
  verschluesselteDaten: '1.2.840.113549.1.7.6',

  // --- Unterschriebene Merkmale (RFC 5652 §11, RFC 8551 §2.5) ---
  merkmalInhaltstyp: '1.2.840.113549.1.9.3',
  merkmalAbdruck: '1.2.840.113549.1.9.4',
  merkmalZeitpunkt: '1.2.840.113549.1.9.5',
  merkmalFaehigkeiten: '1.2.840.113549.1.9.15',
  merkmalBindungAlgorithmen: '1.2.840.113549.1.9.52',

  // --- Streuverfahren ---
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
  md5: '1.2.840.113549.1.1.4',

  // --- Unterschrift ---
  rsa: '1.2.840.113549.1.1.1',
  rsaPss: '1.2.840.113549.1.1.10',
  rsaOaep: '1.2.840.113549.1.1.7',
  sha1MitRsa: '1.2.840.113549.1.1.5',
  sha256MitRsa: '1.2.840.113549.1.1.11',
  sha384MitRsa: '1.2.840.113549.1.1.12',
  sha512MitRsa: '1.2.840.113549.1.1.13',
  ecPublicKey: '1.2.840.10045.2.1',
  ecdsaMitSha256: '1.2.840.10045.4.3.2',
  ecdsaMitSha384: '1.2.840.10045.4.3.3',
  ecdsaMitSha512: '1.2.840.10045.4.3.4',
  ed25519: '1.3.101.112',
  mgf1: '1.2.840.113549.1.1.8',

  // --- Inhaltsverschlüsselung ---
  aes128Cbc: '2.16.840.1.101.3.4.1.2',
  aes192Cbc: '2.16.840.1.101.3.4.1.22',
  aes256Cbc: '2.16.840.1.101.3.4.1.42',
  aes128Gcm: '2.16.840.1.101.3.4.1.6',
  aes192Gcm: '2.16.840.1.101.3.4.1.26',
  aes256Gcm: '2.16.840.1.101.3.4.1.46',
  desEde3Cbc: '1.2.840.113549.3.7',
  rc2Cbc: '1.2.840.113549.3.2',

  // --- PKCS#12 (RFC 7292) und PKCS#5 ---
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
  hmacSha1: '1.2.840.113549.2.7',
  hmacSha224: '1.2.840.113549.2.8',
  hmacSha256: '1.2.840.113549.2.9',
  hmacSha384: '1.2.840.113549.2.10',
  hmacSha512: '1.2.840.113549.2.11',
  pbeSha1Und3Des: '1.2.840.113549.1.12.1.3',
  pbeSha1Und2Des: '1.2.840.113549.1.12.1.4',
  pbeSha1UndRc2_128: '1.2.840.113549.1.12.1.5',
  pbeSha1UndRc2_40: '1.2.840.113549.1.12.1.6',
  beutelSchluessel: '1.2.840.113549.1.12.10.1.1',
  beutelSchluesselVerhuellt: '1.2.840.113549.1.12.10.1.2',
  beutelZertifikat: '1.2.840.113549.1.12.10.1.3',
  zertifikatX509: '1.2.840.113549.1.9.22.1',
  beutelName: '1.2.840.113549.1.9.20',
  beutelSchluesselKennung: '1.2.840.113549.1.9.21',

  // --- Verwendungszweck eines Zertifikats ---
  zweckMailschutz: '1.3.6.1.5.5.7.3.4',
  zweckAlle: '2.5.29.37.0',
} as const;

/** Namen für den Befund - damit "geht nicht" sagen kann, was nicht geht. */
export const NAMEN: Record<string, string> = {
  [B.sha1]: 'SHA-1',
  [B.sha256]: 'SHA-256',
  [B.sha384]: 'SHA-384',
  [B.sha512]: 'SHA-512',
  [B.md5]: 'MD5',
  [B.aes128Cbc]: 'AES-128-CBC',
  [B.aes192Cbc]: 'AES-192-CBC',
  [B.aes256Cbc]: 'AES-256-CBC',
  [B.aes128Gcm]: 'AES-128-GCM',
  [B.aes192Gcm]: 'AES-192-GCM',
  [B.aes256Gcm]: 'AES-256-GCM',
  [B.desEde3Cbc]: '3DES',
  [B.rc2Cbc]: 'RC2',
  [B.pbeSha1Und3Des]: 'PKCS#12 mit SHA-1 und 3DES',
  [B.pbeSha1Und2Des]: 'PKCS#12 mit SHA-1 und 2-Schlüssel-3DES',
  [B.pbeSha1UndRc2_128]: 'PKCS#12 mit SHA-1 und RC2-128',
  [B.pbeSha1UndRc2_40]: 'PKCS#12 mit SHA-1 und RC2-40',
  [B.pbes2]: 'PBES2',
  [B.rsa]: 'RSA',
  [B.rsaPss]: 'RSA-PSS',
  [B.rsaOaep]: 'RSA-OAEP',
  [B.ed25519]: 'Ed25519',
};

export const benenne = (bezeichner: string): string => NAMEN[bezeichner] ?? bezeichner;

/**
 * Der Name, unter dem Node ein Streuverfahren kennt.
 *
 * MD5 und SHA-1 stehen bewusst nicht dabei. Für beide gibt es praktisch durchführbare
 * Kollisionen, und eine Unterschrift über einen kollidierenden Abdruck ist keine
 * Unterschrift mehr, sondern ein Anschein davon. Eine Nachricht mit SHA-1 als "geprüft
 * und gültig" auszuweisen wäre schlimmer, als sie gar nicht zu prüfen: der Nutzer sähe
 * einen Haken und schlösse daraus etwas, was nicht gilt. Sie werden deshalb erkannt und
 * benannt, aber nicht bestätigt.
 */
export function streuNameVon(bezeichner: string): string | null {
  switch (bezeichner) {
    case B.sha256:
    case B.sha256MitRsa:
    case B.ecdsaMitSha256:
      return 'sha256';
    case B.sha384:
    case B.sha384MitRsa:
    case B.ecdsaMitSha384:
      return 'sha384';
    case B.sha512:
    case B.sha512MitRsa:
    case B.ecdsaMitSha512:
      return 'sha512';
    default:
      return null;
  }
}

/** Der Name eines Inhaltsverfahrens bei Node, samt Schlüssellänge. */
export function inhaltsVerfahren(
  bezeichner: string,
): { name: string; schluesselBytes: number; gcm: boolean } | null {
  switch (bezeichner) {
    case B.aes128Cbc:
      return { name: 'aes-128-cbc', schluesselBytes: 16, gcm: false };
    case B.aes192Cbc:
      return { name: 'aes-192-cbc', schluesselBytes: 24, gcm: false };
    case B.aes256Cbc:
      return { name: 'aes-256-cbc', schluesselBytes: 32, gcm: false };
    case B.aes128Gcm:
      return { name: 'aes-128-gcm', schluesselBytes: 16, gcm: true };
    case B.aes192Gcm:
      return { name: 'aes-192-gcm', schluesselBytes: 24, gcm: true };
    case B.aes256Gcm:
      return { name: 'aes-256-gcm', schluesselBytes: 32, gcm: true };
    case B.desEde3Cbc:
      return { name: 'des-ede3-cbc', schluesselBytes: 24, gcm: false };
    default:
      return null;
  }
}
