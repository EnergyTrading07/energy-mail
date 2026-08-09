import crypto from 'node:crypto';

/**
 * Liefert den 32-Byte-Schlüssel, mit dem Zugangsdaten verschlüsselt werden. Woher der
 * kommt, entscheidet der jeweilige Prozess: die Desktop-App bindet ihn über Electrons
 * safeStorage an das Windows-Benutzerkonto, der Standalone-Server leitet ihn aus einem
 * Master-Passwort ab.
 */
export interface KeyProvider {
  /** Für Log- und Fehlermeldungen, damit erkennbar ist welcher Weg aktiv ist. */
  name: string;
  getKey: () => Buffer;
}

const PREFIX = 'v1';
const IV_BYTES = 12;

let provider: KeyProvider | null = null;
let cachedKey: Buffer | null = null;

export function setKeyProvider(next: KeyProvider): void {
  provider = next;
  cachedKey = null;
}

export function getKeyProviderName(): string | null {
  return provider?.name ?? null;
}

export function isEncryptionAvailable(): boolean {
  return provider !== null;
}

function requireKey(): Buffer {
  if (!provider) {
    throw new Error(
      'Keine Verschlüsselung eingerichtet - Zugangsdaten würden im Klartext liegen. ' +
        'In der Desktop-App passiert das automatisch; beim Standalone-Server muss ' +
        'ENERGY_MAIL_MASTER_KEY gesetzt sein.',
    );
  }
  if (!cachedKey) {
    const key = provider.getKey();
    if (key.length !== 32) {
      throw new Error(`Schlüssel von "${provider.name}" hat ${key.length} statt 32 Bytes.`);
    }
    cachedKey = key;
  }
  return cachedKey;
}

/**
 * Verschlüsselt unmittelbar mit dem Masterschlüssel.
 *
 * Nur für das Verpacken der Nutzerschlüssel gedacht - siehe nutzer/schluesselHuelle.ts.
 * Geheimnisse eines Nutzers (Postfachkennwörter, Marken, PGP) gehen NICHT hierdurch,
 * sondern durch seinen eigenen Schlüssel: sonst hinge alles an einem einzigen Schlüssel,
 * ein Wechsel bedeutete, sämtliche Daten aller Nutzer neu zu verschlüsseln, und das
 * Löschen eines Nutzers ließe seine Daten in jeder Sicherung lesbar zurück.
 */
export function verschluesselMitMaster(plain: string): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', requireKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    PREFIX,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    encrypted.toString('base64'),
  ].join('.');
}

/** Gegenstück zu verschluesselMitMaster - und der Weg für Altbestand (v1). */
export function entschluesselMitMaster(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== PREFIX || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Verschlüsselte Zugangsdaten haben ein unbekanntes Format.');
  }
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      requireKey(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Der häufigste Grund ist ein anderer Schlüssel, nicht ein defekter Datensatz.
    throw new Error(
      'Zugangsdaten konnten nicht entschlüsselt werden. Wurden sie unter einem anderen ' +
        'Windows-Benutzer angelegt oder fehlt die Schlüsseldatei (data/key.enc)?',
    );
  }
}

/**
 * Wie ein Geheimnis eines Nutzers verschlüsselt wird.
 *
 * Von aussen gesetzt, damit dieses Modul nichts über Nutzer wissen muss - sonst zögen
 * sich secretCrypto, nutzerStore und schluesselHuelle gegenseitig im Kreis.
 */
let umschlag: { hinein: (klar: string) => string; heraus: (nutzlast: string) => string } | null =
  null;

export function setzeUmschlag(verfahren: typeof umschlag): void {
  umschlag = verfahren;
}

/**
 * Verschlüsselt ein Geheimnis eines Nutzers.
 *
 * Neue Geheimnisse gehen durch den Umschlag (v2, Schlüssel des Nutzers). Ist keiner
 * eingerichtet - Werkzeuge, Prüfungen, sehr früher Start -, gilt weiter der
 * Masterschlüssel; das Ergebnis ist dann v1 und bleibt lesbar.
 */
export function encryptSecret(plain: string): string {
  return umschlag ? umschlag.hinein(plain) : verschluesselMitMaster(plain);
}

/**
 * Entschlüsselt ein Geheimnis - gleich in welchem Format es vorliegt.
 *
 * Das ist die Stelle, an der bestehende Installationen heil bleiben: alles, was vor der
 * Umstellung angelegt wurde, trägt "v1" und wurde unmittelbar mit dem Masterschlüssel
 * verschlüsselt. Es wird weiterhin so gelesen. Neues trägt "v2" und geht durch den
 * Schlüssel des Nutzers.
 *
 * Umgeschrieben wird nichts von selbst: ein v1-Geheimnis wird zu v2, sobald sein
 * Datensatz ohnehin neu geschrieben wird - beim nächsten Speichern des Kontos etwa. Ein
 * Zwangsdurchlauf über alle Dateien wäre ein Vorgang, bei dem viel schiefgehen kann, für
 * einen Gewinn, der sich auch von selbst einstellt.
 */
export function decryptSecret(payload: string): string {
  if (payload.startsWith('v2.') && umschlag) return umschlag.heraus(payload);
  return entschluesselMitMaster(payload);
}

/** Leitet einen Schlüssel aus einem Master-Passwort ab (nur Standalone-Server). */
export function createPassphraseKeyProvider(passphrase: string, salt: Buffer): KeyProvider {
  return {
    name: 'Master-Passwort (ENERGY_MAIL_MASTER_KEY)',
    getKey: () => crypto.scryptSync(passphrase, salt, 32),
  };
}
