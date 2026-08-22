import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';
import { entschluesselMitMaster, verschluesselMitMaster } from '../secretCrypto.js';
import { protokolliere } from '../protokollDatei.js';
import { qrCode } from '../qrCode.js';
import { aktuellerNutzer } from './kontext.js';
import {
  entferneZweiFaktor,
  findeNutzer,
  hatZweiFaktor,
  liesZweiFaktor,
  merkeZweiFaktorSchritt,
  pruefeAnmeldung,
  setzeWiederherstellungscodes,
  setzeZweiFaktor,
  verbraucheWiederherstellungscode,
} from './nutzerStore.js';
import { erzeugeGeheimnis, lesbar, otpauthWeg, pruefeCode } from './totp.js';

/**
 * Der zweite Faktor: einrichten, prüfen, abschalten.
 *
 * ## Was er leistet - und was nicht
 *
 * Er schützt gegen ein abhandengekommenes Kennwort. Das ist der häufigste Weg, auf dem
 * fremde Menschen in ein Postfach kommen: dasselbe Kennwort wie anderswo, und anderswo
 * gab es einen Einbruch. Gegen jemanden, der bereits auf dem Rechner sitzt, hilft er
 * nicht, und gegen einen Betreiber, der den Masterschlüssel hat, auch nicht - dazu steht
 * das Nötige in BETRIEB.md.
 *
 * ## Warum die Anmeldung zweistufig ist und nicht einstufig
 *
 * Der bequeme Weg wäre, Kennwort und Code in einem Formular abzufragen. Er ist schlechter:
 * Wer den Code eintippt, bevor er weiß, ob das Kennwort überhaupt stimmt, tippt ihn im
 * Zweifel dreimal ab - und ein Code gilt dreißig Sekunden. Deshalb zwei Schritte, und
 * zwischen ihnen eine kurzlebige Marke.
 *
 * Diese Marke ist AUSDRÜCKLICH KEINE SITZUNG. Sie steht in einer eigenen Tabelle, hat
 * fünf Minuten Frist, erlaubt fünf Versuche und öffnet genau einen Weg. Der naheliegende
 * Bauweg - eine Sitzung eröffnen und sie als "noch nicht fertig" markieren - wäre eine
 * Sitzung, die überall dort gilt, wo jemand die Markierung abzufragen vergisst. Hier gibt
 * es nichts zu vergessen: Was keine Sitzung ist, kommt an keiner Route vorbei.
 */

// --- Wiederherstellungscodes ---

/** Zehn Codes zu je zehn Zeichen - genug, um einen Umzug auf ein neues Telefon zu überleben. */
const ANZAHL_CODES = 10;

/**
 * Ohne die Zeichen, die man auf Papier verwechselt: kein 0/O, kein 1/I/l.
 *
 * Zweiunddreißig Zeichen, zehn davon, macht fünfzig Bit je Code. Diese Codes umgehen den
 * zweiten Faktor vollständig - sie müssen so gut sein wie er.
 */
const CODE_ZEICHEN = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function frischeCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < ANZAHL_CODES; i++) {
    const bytes = crypto.randomBytes(10);
    const roh = [...bytes].map((b) => CODE_ZEICHEN[b % CODE_ZEICHEN.length]).join('');
    // In zwei Fünferblöcken - so liest man sie von einem Zettel ab, ohne die Stelle zu verlieren.
    codes.push(`${roh.slice(0, 5)}-${roh.slice(5)}`);
  }
  return codes;
}

/**
 * Die Prüfsumme eines Codes.
 *
 * sha256 und nicht scrypt, anders als beim Kennwort. Der Unterschied ist die Eingabe: Ein
 * Kennwort denkt sich ein Mensch aus und ist deshalb zu erraten; ein Wiederherstellungscode
 * sind fünfzig zufällige Bit. Da gibt es nichts durchzuprobieren, und ein langsames
 * Verfahren würde nur die Anmeldung verzögern. Dieselbe Überlegung wie bei den
 * Sitzungskennungen in sitzung.ts.
 */
function pruefsumme(code: string): string {
  const sauber = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return crypto.createHash('sha256').update(sauber).digest('hex');
}

// --- Die halbe Anmeldung ---

interface HalbeAnmeldung {
  nutzerId: string;
  /** Für die Anmeldebremse: sie zählt je Adresse, nicht je Kennung. */
  email: string;
  bis: number;
  versuche: number;
  /**
   * Ob der Mensch im ERSTEN Schritt "angemeldet bleiben" verlangt hat.
   *
   * Er wandert hier mit, statt im Rumpf der zweiten Stufe zu stehen. Dort weist sich der
   * Anfragende allein mit der Marke aus; alles Weitere, was er mitschickt, ist seine
   * Behauptung. Eine Sitzung, die ein Jahr gilt, soll nicht aus einer Behauptung
   * entstehen, sondern aus dem Schritt, in dem das Kennwort gezeigt wurde.
   */
  angemeldetBleiben?: boolean;
}

/**
 * Im Speicher und nicht auf der Platte - anders als die Sitzungen.
 *
 * Eine halbe Anmeldung ist fünf Minuten alt. Startet der Server in dieser Zeit neu, muss
 * der Mensch sein Kennwort noch einmal eingeben, und das ist genau richtig: Ein
 * Zwischenzustand, der einen Neustart überlebt, ist ein Zwischenzustand, der auch eine
 * Woche später noch dasteht.
 */
const halbe = new Map<string, HalbeAnmeldung>();
const MARKE_FRIST_MS = 5 * 60 * 1000;
const MARKE_VERSUCHE = 5;
const MAX_MARKEN = 1000;

function raeumeAuf(): void {
  const jetzt = Date.now();
  for (const [marke, eintrag] of halbe) if (eintrag.bis < jetzt) halbe.delete(marke);
}

/** Beginnt die zweite Stufe und gibt die Marke zurück, mit der sie sich abschließen lässt. */
export function beginneZweiteStufe(
  nutzerId: string,
  email: string,
  angemeldetBleiben = false,
): string {
  raeumeAuf();
  // Ein Deckel gegen den Fall, dass jemand massenhaft richtige Kennwörter durchprobiert -
  // unwahrscheinlich, aber ein unbegrenzt wachsender Speicher ist es nicht wert.
  if (halbe.size >= MAX_MARKEN) halbe.clear();
  const marke = crypto.randomBytes(32).toString('base64url');
  halbe.set(marke, {
    nutzerId,
    email,
    bis: Date.now() + MARKE_FRIST_MS,
    versuche: 0,
    ...(angemeldetBleiben ? { angemeldetBleiben: true } : {}),
  });
  return marke;
}

/** Wer hinter einer Marke steht - oder `null`, wenn sie abgelaufen oder verbraucht ist. */
export function halbeAnmeldung(marke: string): HalbeAnmeldung | null {
  raeumeAuf();
  const eintrag = halbe.get(marke);
  return eintrag && eintrag.bis >= Date.now() ? eintrag : null;
}

/** Zählt einen Fehlversuch auf einer Marke und wirft sie nach dem fünften weg. */
export function markeFehlversuch(marke: string): void {
  const eintrag = halbe.get(marke);
  if (!eintrag) return;
  eintrag.versuche += 1;
  if (eintrag.versuche >= MARKE_VERSUCHE) halbe.delete(marke);
}

export function markeEinloesen(marke: string): void {
  halbe.delete(marke);
}

/** Nur für Prüfungen: alle halben Anmeldungen vergessen. */
export function vergissMarken(): void {
  halbe.clear();
}

// --- Die noch nicht bestätigte Einrichtung ---

/**
 * Ein Geheimnis, das erzeugt, aber noch nicht bestätigt ist.
 *
 * Es darf nicht in nutzer.json landen, bevor der Nutzer einen Code daraus vorgezeigt hat.
 * Sonst richtet jemand den zweiten Faktor ein, scannt den Code nicht richtig, schließt das
 * Fenster - und ist ausgesperrt aus einem Konto, das gerade eben noch ging.
 */
const einrichtungen = new Map<string, { geheimnis: string; bis: number }>();
const EINRICHTUNG_FRIST_MS = 15 * 60 * 1000;

// --- Die Prüfung ---

export type Zweitfaktorbefund =
  | { ok: true; art: 'code' }
  | { ok: true; art: 'wiederherstellung'; uebrig: number }
  | { ok: false; grund: 'falsch' | 'wiederholt' };

/**
 * Prüft, was der Nutzer eingetippt hat - ein Einmalkennwort oder einen Wiederherstellungscode.
 *
 * Beide gehen durch dasselbe Feld. Sie sind nicht zu verwechseln: sechs Ziffern gegen zehn
 * Buchstaben. Ein zweites Eingabefeld "oder hier ein Wiederherstellungscode" wäre eine
 * Frage an einen Menschen, der gerade nicht hereinkommt und keine Lust auf Formularkunde hat.
 */
export function pruefeZweitenFaktor(nutzerId: string, eingabe: string): Zweitfaktorbefund {
  const eintrag = liesZweiFaktor(nutzerId);
  if (!eintrag?.seit) return { ok: false, grund: 'falsch' };

  let geheimnis: string;
  try {
    geheimnis = entschluesselMitMaster(eintrag.geheimnis);
  } catch (err) {
    /*
     * Das Geheimnis ist da, lässt sich aber nicht öffnen - ein anderer Masterschlüssel.
     * Laut ins Protokoll: Für den Nutzer sieht es aus, als stimme sein Code nicht, und
     * ohne diese Zeile sucht der Betreiber an der falschen Stelle.
     */
    protokolliere(
      'fehler',
      'anmeldung',
      `Der zweite Faktor von "${nutzerId}" lässt sich nicht entschlüsseln: ${(err as Error).message}`,
    );
    return { ok: false, grund: 'falsch' };
  }

  const schritt = pruefeCode(geheimnis, eingabe);
  if (schritt !== null) {
    if (!merkeZweiFaktorSchritt(nutzerId, schritt)) return { ok: false, grund: 'wiederholt' };
    return { ok: true, art: 'code' };
  }

  const uebrig = verbraucheWiederherstellungscode(nutzerId, pruefsumme(eingabe));
  if (uebrig !== null) return { ok: true, art: 'wiederherstellung', uebrig };

  return { ok: false, grund: 'falsch' };
}

// --- Die Wege ---

export function registriereZweiFaktor(app: FastifyInstance): void {
  /**
   * Schritt eins der Einrichtung: ein Geheimnis und ein Bild davon.
   *
   * Gespeichert wird noch nichts. Wer hier abbricht, hat nichts verändert.
   */
  app.post('/ich/zweifaktor/beginnen', async (request, reply) => {
    const ich = aktuellerNutzer();
    const nutzer = findeNutzer(ich);
    if (!nutzer) return reply.code(401).send({ error: t('Nicht angemeldet.') });
    if (hatZweiFaktor(ich)) {
      return reply.code(400).send({ error: t('Der zweite Faktor ist bereits eingerichtet.') });
    }

    const geheimnis = erzeugeGeheimnis();
    einrichtungen.set(ich, { geheimnis, bis: Date.now() + EINRICHTUNG_FRIST_MS });

    const weg = otpauthWeg(nutzer.email, geheimnis);
    return {
      /*
       * Das Geheimnis geht mit hinaus - es steht ja auch im QR-Bild, und wer die Kamera
       * nicht zum Laufen bringt, muss es abtippen können. Ein Bild ohne lesbare Fassung
       * daneben ist eine Einrichtung, die an einem Webcam-Treiber scheitert.
       */
      geheimnis: lesbar(geheimnis),
      weg,
      qr: qrCode(weg),
    };
  });

  /**
   * Schritt zwei: der Nutzer zeigt einen Code vor - und sein Kennwort.
   *
   * Das Kennwort gehört dazu, obwohl die Sitzung längst angemeldet ist. Der Grund ist ein
   * unbeaufsichtigter Bildschirm: Ohne diese Abfrage könnte ein Vorübergehender den zweiten
   * Faktor auf sein eigenes Telefon einrichten und den rechtmäßigen Nutzer damit aussperren -
   * der käme ohne einen Verwalter nicht mehr herein.
   */
  app.post<{ Body: { kennwort?: string; code?: string } }>(
    '/ich/zweifaktor/bestaetigen',
    async (request, reply) => {
      const ich = aktuellerNutzer();
      const nutzer = findeNutzer(ich);
      if (!nutzer) return reply.code(401).send({ error: t('Nicht angemeldet.') });

      const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';
      if (!pruefeAnmeldung(nutzer.email, kennwort)) {
        return reply.code(401).send({ error: t('Das Kennwort stimmt nicht.') });
      }

      const angefangen = einrichtungen.get(ich);
      if (!angefangen || angefangen.bis < Date.now()) {
        einrichtungen.delete(ich);
        return reply.code(400).send({
          error: t('Die Einrichtung ist abgelaufen. Bitte noch einmal von vorn beginnen.'),
        });
      }

      const code = typeof request.body?.code === 'string' ? request.body.code : '';
      if (pruefeCode(angefangen.geheimnis, code) === null) {
        return reply.code(400).send({
          error: t('Der Code stimmt nicht. Prüfen Sie, ob die Uhr des Telefons richtig geht.'),
        });
      }

      const codes = frischeCodes();
      setzeZweiFaktor(
        ich,
        verschluesselMitMaster(angefangen.geheimnis),
        codes.map(pruefsumme),
      );
      einrichtungen.delete(ich);
      protokolliere('info', 'anmeldung', `"${ich}" hat den zweiten Faktor eingeschaltet.`);

      // Die Codes gehen genau einmal hinaus - danach stehen nur noch ihre Prüfsummen da.
      return { codes };
    },
  );

  /**
   * Abschalten - nur mit Kennwort.
   *
   * Hier ist die Abfrage nicht Vorsicht, sondern der Kern der Sache: Ein zweiter Faktor,
   * den man ohne Kennwort ausschalten kann, ist keiner.
   */
  app.post<{ Body: { kennwort?: string } }>('/ich/zweifaktor/aus', async (request, reply) => {
    const ich = aktuellerNutzer();
    const nutzer = findeNutzer(ich);
    if (!nutzer) return reply.code(401).send({ error: t('Nicht angemeldet.') });

    const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';
    if (!pruefeAnmeldung(nutzer.email, kennwort)) {
      return reply.code(401).send({ error: t('Das Kennwort stimmt nicht.') });
    }

    entferneZweiFaktor(ich);
    einrichtungen.delete(ich);
    protokolliere('warnung', 'anmeldung', `"${ich}" hat den zweiten Faktor ausgeschaltet.`);
    return { zweiFaktor: false };
  });

  /**
   * Frische Wiederherstellungscodes.
   *
   * Für den, der seinen Zettel nicht mehr findet oder ihn aufgebraucht hat. Die alten
   * gelten ab diesem Augenblick nicht mehr - ein Satz Codes, der neben einem neuen Satz
   * weitergilt, ist ein vergessener Zettel, der irgendwo herumliegt und funktioniert.
   */
  app.post<{ Body: { kennwort?: string } }>('/ich/zweifaktor/codes', async (request, reply) => {
    const ich = aktuellerNutzer();
    const nutzer = findeNutzer(ich);
    if (!nutzer) return reply.code(401).send({ error: t('Nicht angemeldet.') });
    if (!hatZweiFaktor(ich)) {
      return reply.code(400).send({ error: t('Für Sie ist kein zweiter Faktor eingerichtet.') });
    }

    const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';
    if (!pruefeAnmeldung(nutzer.email, kennwort)) {
      return reply.code(401).send({ error: t('Das Kennwort stimmt nicht.') });
    }

    const codes = frischeCodes();
    setzeWiederherstellungscodes(ich, codes.map(pruefsumme));
    protokolliere('info', 'anmeldung', `"${ich}" hat neue Wiederherstellungscodes erzeugt.`);
    return { codes };
  });
}

/** Wie viele Wiederherstellungscodes noch übrig sind - für die Anzeige im Konto. */
export function offeneCodes(nutzerId: string): number {
  return liesZweiFaktor(nutzerId)?.codes.length ?? 0;
}
