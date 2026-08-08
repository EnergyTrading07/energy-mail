import type { AccountConfig } from '@energy-mail/mail-core';

/**
 * Was beim Umzug auf einen neuen Rechner mitkommt - und was nicht.
 *
 * Im Benutzerordner liegen zwölf Dateien. Wer den Rechner wechselt, weiß nicht, welche
 * davon er braucht: die 4,3 MB große ablage.db sieht wichtig aus und ist es nicht, die
 * 48 Byte kleine regeln.json sieht nach nichts aus und enthält Arbeit von Stunden.
 *
 * Deshalb diese Trennung an einer Stelle, mit einer Begründung je Zeile.
 *
 * **Die Zugangsdaten kommen bewusst nicht mit.** Sie sind unter Windows über DPAPI an
 * das Benutzerkonto dieses Rechners gebunden - auf einem anderen ließen sie sich gar
 * nicht entschlüsseln. Das ist kein Mangel, sondern der Zweck der Versiegelung.
 *
 * Kein Geheimnis heißt aber nicht harmlos: in der Datei stehen sämtliche Mailadressen,
 * mit denen je Post gewechselt wurde. Sie gehört auf die eigene Platte oder in den
 * eigenen Speicher in der Wolke - nicht in eine Weitergabe.
 */

/** Fassung des Dateiformats - damit eine spätere Änderung erkennbar bleibt. */
export const SICHERUNG_FASSUNG = 1;

export interface GesichertesKonto {
  email: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** Wie der Empfänger den Absender sieht. */
  displayName?: string;
  signature?: string;
  identitaeten?: unknown[];
  /** Womit sich das Konto anmeldet - ohne das Geheimnis selbst. */
  anmeldung: 'password' | 'oauth2';
}

export interface Sicherung {
  fassung: number;
  erstelltAm: string;
  programm: string;
  konten: GesichertesKonto[];
  etiketten: unknown[];
  regeln: Record<string, unknown[]>;
  kontakte: unknown[];
  suchen: unknown[];
  /**
   * Steht in der Datei, damit klar ist, was fehlt - und zwar bevor jemand sie einliest
   * und sich wundert, warum nach dem Einlesen nichts abgerufen wird.
   */
  hinweis: string;
}

export const HINWEIS =
  'Diese Datei enthält keine Kennwörter und keine Zugangsmarken - sie sind an das ' +
  'Windows-Benutzerkonto des Rechners gebunden, auf dem sie angelegt wurden. Nach dem ' +
  'Einlesen müssen die Konten einmal neu angemeldet werden. Enthalten sind dagegen ' +
  'alle Mailadressen aus dem Adressbuch; die Datei gehört deshalb an einen Ort, den ' +
  'nur Sie erreichen.';

/**
 * Nimmt einem Konto alles, was geheim ist.
 *
 * Getrennt und ausdrücklich, statt beim Zusammenbauen nebenbei: dass hier kein Feld
 * durchrutscht, ist die eine Zusicherung, auf der die ganze Datei beruht. Eine
 * Auswahlliste statt eines Löschens - was neu hinzukommt, ist damit von sich aus
 * draußen, und nicht erst, wenn jemand daran denkt.
 */
export function ohneGeheimnisse(konto: AccountConfig): GesichertesKonto {
  const k = konto as AccountConfig & {
    displayName?: string;
    signature?: string;
    identitaeten?: unknown[];
  };
  return {
    email: k.email,
    imapHost: k.imapHost,
    imapPort: k.imapPort,
    imapSecure: k.imapSecure,
    smtpHost: k.smtpHost,
    smtpPort: k.smtpPort,
    smtpSecure: k.smtpSecure,
    displayName: k.displayName,
    signature: k.signature,
    identitaeten: k.identitaeten,
    anmeldung: k.auth?.type === 'oauth2' ? 'oauth2' : 'password',
  };
}

/**
 * Prüft eine eingelesene Datei, bevor irgendetwas daraus übernommen wird.
 *
 * Eine Sicherung ist eine Datei von der Platte - sie kann von einer älteren Fassung
 * stammen, halb geschrieben sein oder gar keine Sicherung sein. Was hier durchkommt,
 * darf angefasst werden; alles andere wird mit einem Satz abgelehnt, der sagt, woran
 * es liegt.
 */
export function pruefeSicherung(roh: unknown): { ok: true; daten: Sicherung } | { ok: false; grund: string } {
  if (!roh || typeof roh !== 'object') {
    return { ok: false, grund: 'Die Datei enthält keine lesbaren Daten.' };
  }
  const d = roh as Partial<Sicherung>;

  if (typeof d.fassung !== 'number') {
    return { ok: false, grund: 'Das ist keine Sicherung von Energy Mail.' };
  }
  if (d.fassung > SICHERUNG_FASSUNG) {
    return {
      ok: false,
      grund:
        `Die Sicherung stammt aus einer neueren Fassung des Programms (${d.fassung} statt ` +
        `${SICHERUNG_FASSUNG}). Bitte erst das Programm aktualisieren.`,
    };
  }

  // Fehlende Listen sind kein Fehler - eine Sicherung ohne Regeln ist eine Sicherung
  // ohne Regeln. Nur was da ist, muss die richtige Form haben.
  for (const [name, wert] of [
    ['konten', d.konten],
    ['etiketten', d.etiketten],
    ['kontakte', d.kontakte],
    ['suchen', d.suchen],
  ] as const) {
    if (wert !== undefined && !Array.isArray(wert)) {
      return { ok: false, grund: `Der Abschnitt "${name}" ist beschädigt.` };
    }
  }

  return {
    ok: true,
    daten: {
      fassung: d.fassung,
      erstelltAm: d.erstelltAm ?? '',
      programm: d.programm ?? '',
      konten: d.konten ?? [],
      etiketten: d.etiketten ?? [],
      regeln: d.regeln ?? {},
      kontakte: d.kontakte ?? [],
      suchen: d.suchen ?? [],
      hinweis: d.hinweis ?? HINWEIS,
    },
  };
}

/** Was beim Einlesen geschehen ist - für die Rückmeldung an den Nutzer. */
export interface Einleseergebnis {
  konten: { uebernommen: number; schonDa: number };
  etiketten: { uebernommen: number; schonDa: number };
  kontakte: { uebernommen: number; schonDa: number };
  suchen: { uebernommen: number; schonDa: number };
  regeln: { uebernommen: number };
}

/**
 * Entscheidet, was von einer Liste übernommen wird.
 *
 * Zusammenführen statt ersetzen: wer eine Sicherung einliest, hat auf diesem Rechner
 * meist schon etwas eingerichtet. Würde das überschrieben, wäre das Einlesen selbst
 * der Datenverlust, den es verhindern soll.
 *
 * Was schon da ist, bleibt unangetastet - auch dann, wenn es sich unterscheidet. Ein
 * Etikett "Wichtig" in Rot hier und in Blau in der Sicherung: die eigene Farbe gewinnt,
 * denn sie ist die jüngere Entscheidung.
 */
export function nurNeue<T>(
  /**
   * Nur die Kennungen des Vorhandenen, nicht die Einträge selbst.
   *
   * Beim Zusammenführen von Konten stehen sich zwei verschiedene Formen gegenüber - das
   * eingerichtete Konto und der Eintrag aus der Datei. Gemeinsam haben sie nur die
   * Adresse, und mehr braucht diese Funktion auch nicht.
   */
  vorhandeneKennungen: readonly string[],
  ausSicherung: readonly T[],
  kennung: (eintrag: T) => string,
): { neue: T[]; schonDa: number } {
  const bekannt = new Set(vorhandeneKennungen.map((k) => k.toLowerCase()));
  const neue: T[] = [];
  let schonDa = 0;

  for (const eintrag of ausSicherung) {
    const k = kennung(eintrag).toLowerCase();
    // Leere Kennungen wären nicht unterscheidbar - sie fielen sonst alle zusammen.
    if (!k) continue;
    if (bekannt.has(k)) {
      schonDa++;
      continue;
    }
    bekannt.add(k);
    neue.push(eintrag);
  }
  return { neue, schonDa };
}
