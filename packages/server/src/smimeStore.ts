import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  beschreibeZertifikat,
  leseSchluesseldatei,
  leseZertifikat,
  SchluesseldateiFehler,
  type Zertifikatsangaben,
} from '@energy-mail/mail-core';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secretCrypto.js';
import { getNutzerDir } from './paths.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Der Zertifikatsspeicher: die eigenen Schlüssel und die Zertifikate anderer.
 *
 * ## Wie ein Zertifikat des Gegenübers hierher kommt
 *
 * In den seltensten Fällen, weil es jemand geschickt hat. Der übliche Weg ist der, den
 * S/MIME selbst vorsieht: **Jede unterschriebene Nachricht bringt das Zertifikat ihres
 * Absenders mit.** Wer einmal unterschrieben geschrieben hat, kann ab da verschlüsselte
 * Post bekommen - ohne dass jemand etwas eingerichtet hätte.
 *
 * Aufgenommen wird dabei nur, was sich auch geprüft hat: Unterschrift geht auf, Kette
 * trägt bis zu einer bekannten Wurzel, Adresse passt zum Absender. Alles andere wäre eine
 * Einladung - wer ein Zertifikat auf eine fremde Adresse mitschickt, bekäme sonst die
 * Post, die dieser Adresse gilt.
 *
 * ## Wie der geheime Schlüssel liegt
 *
 * Zwei Schichten, und die zweite ist wählbar. Immer: verschlüsselt über denselben Weg wie
 * die Zugangsdaten der Konten - an das Windows-Benutzerkonto gebunden, eine kopierte Datei
 * nützt auf einem anderen Rechner nichts. Zusätzlich auf Wunsch: das Kennwort, das der
 * Nutzer beim Einlesen vergeben hat, das dann bei jeder Benutzung abgefragt wird.
 *
 * Die zweite Schicht ist die Voreinstellung, und zwar aus einem Grund, den man aussprechen
 * muss: Ohne sie kann jeder, der am angemeldeten Rechner sitzt, in Ihrem Namen
 * unterschreiben. Wer sie abschaltet, tauscht genau das gegen die Bequemlichkeit ein,
 * nicht tippen zu müssen. In einem Büro mit unverschlossenen Bildschirmen ist das ein
 * schlechter Tausch.
 */

const getPfad = () => path.join(getNutzerDir(), 'zertifikate.json');

interface EigenerEintrag {
  fingerabdruck: string;
  /** Das Zertifikat in DER, base64 - unbedenklich, es ist zur Weitergabe gemacht. */
  zertifikat: string;
  /** Der geheime Schlüssel als PKCS#8, verschlüsselt abgelegt. */
  schluessel: string;
  /** Ob dieser Schlüssel zusätzlich mit einem Kennwort verschlossen ist. */
  mitKennwort: boolean;
  /** Die Zwischenstellen der Ausgabestelle - gehen mit jeder Unterschrift hinaus. */
  kette: string[];
  angaben: Zertifikatsangaben;
  fuerKonto?: string;
  hinzugefuegtAm: string;
}

interface FremderEintrag {
  fingerabdruck: string;
  zertifikat: string;
  angaben: Zertifikatsangaben;
  /** Welche Verschlüsselungsverfahren dieser Empfänger angekündigt hat. */
  faehigkeiten: string[];
  /** Woher es kam - das ist eine Auskunft, die der Nutzer sehen darf. */
  quelle: 'nachricht' | 'datei';
  hinzugefuegtAm: string;
}

interface Ablage {
  eigene: EigenerEintrag[];
  fremde: FremderEintrag[];
}

function lesen(): Ablage {
  try {
    const roh = JSON.parse(fs.readFileSync(getPfad(), 'utf-8')) as Ablage;
    if (Array.isArray(roh?.eigene) && Array.isArray(roh?.fremde)) return roh;
  } catch {
    // Keine Datei oder beschädigt - dann eben ein leerer Speicher.
  }
  return { eigene: [], fremde: [] };
}

function schreiben(ablage: Ablage): void {
  fs.mkdirSync(getNutzerDir(), { recursive: true });
  const ziel = getPfad();
  const zwischen = `${ziel}.neu`;
  fs.writeFileSync(zwischen, JSON.stringify(ablage, null, 2), 'utf-8');
  fs.renameSync(zwischen, ziel);
}

export class ZertifikatsspeicherFehler extends Error {}

// --- Was nach außen sichtbar ist ---

export interface ZertifikatEintrag {
  fingerabdruck: string;
  angaben: Zertifikatsangaben;
  eigen: boolean;
  mitKennwort?: boolean;
  fuerKonto?: string;
  quelle?: 'nachricht' | 'datei';
  hinzugefuegtAm: string;
}

export function alleZertifikate(): ZertifikatEintrag[] {
  const ablage = lesen();
  return [
    ...ablage.eigene.map((e) => ({
      fingerabdruck: e.fingerabdruck,
      angaben: e.angaben,
      eigen: true,
      mitKennwort: e.mitKennwort,
      fuerKonto: e.fuerKonto,
      hinzugefuegtAm: e.hinzugefuegtAm,
    })),
    ...ablage.fremde.map((f) => ({
      fingerabdruck: f.fingerabdruck,
      angaben: f.angaben,
      eigen: false,
      quelle: f.quelle,
      hinzugefuegtAm: f.hinzugefuegtAm,
    })),
  ].sort((a, b) => {
    if (a.eigen !== b.eigen) return a.eigen ? -1 : 1;
    return (a.angaben.adressen[0] ?? '').localeCompare(b.angaben.adressen[0] ?? '', 'de');
  });
}

// --- Die eigenen ---

/**
 * Nimmt eine Schlüsseldatei auf.
 *
 * Der geheime Schlüssel wird dabei NEU verpackt, nicht so übernommen, wie er in der Datei
 * lag. Das ist kein Selbstzweck: Was Windows und ältere Ausgabestellen ausliefern, ist mit
 * SHA-1 und 2048 Runden gesichert - ein Maß von 1999. Neu verpackt wird mit AES-256 und
 * einer Ableitung, die heutigen Ansprüchen genügt. Die Datei, die der Nutzer behält,
 * bleibt davon unberührt; sie ist seine Sicherung.
 */
export function fuegeSchluesseldateiHinzu(
  daten: Buffer,
  kennwort: string,
  optionen: { fuerKonto?: string; neuesKennwort?: string },
): ZertifikatEintrag[] {
  if (!isEncryptionAvailable()) {
    throw new ZertifikatsspeicherFehler(
      t(
        'Ohne eingerichtete Verschlüsselung würde der geheime Schlüssel im Klartext liegen - das wird abgelehnt.',
      ),
    );
  }

  let paare;
  try {
    paare = leseSchluesseldatei(daten, kennwort);
  } catch (err) {
    if (err instanceof SchluesseldateiFehler) throw new ZertifikatsspeicherFehler(err.message);
    throw new ZertifikatsspeicherFehler(t('Diese Datei ließ sich nicht lesen.'));
  }

  const ablage = lesen();
  const aufgenommen: ZertifikatEintrag[] = [];

  for (const paar of paare) {
    const angaben = beschreibeZertifikat(paar.zertifikat);
    /*
     * Ein Zertifikat ohne Mailadresse ist hier nutzlos: Es ließe sich nicht zuordnen, und
     * eine Unterschrift damit wäre für jeden Empfänger eine Warnung statt eines Hakens.
     * Lieber jetzt eine klare Auskunft als später eine unerklärliche.
     */
    if (angaben.adressen.length === 0) {
      throw new ZertifikatsspeicherFehler(
        t('In diesem Zertifikat steht keine Mailadresse - damit lässt sich keine Post schützen.'),
      );
    }

    const verpackt = optionen.neuesKennwort
      ? paar.schluessel.export({
          type: 'pkcs8',
          format: 'pem',
          cipher: 'aes-256-cbc',
          passphrase: optionen.neuesKennwort,
        })
      : paar.schluessel.export({ type: 'pkcs8', format: 'pem' });

    const eintrag: EigenerEintrag = {
      fingerabdruck: angaben.fingerabdruck,
      zertifikat: paar.zertifikat.toString('base64'),
      schluessel: encryptSecret(verpackt.toString()),
      mitKennwort: Boolean(optionen.neuesKennwort),
      kette: paar.kette.map((k) => k.toString('base64')),
      angaben,
      fuerKonto: optionen.fuerKonto,
      hinzugefuegtAm: new Date().toISOString(),
    };

    const stelle = ablage.eigene.findIndex((e) => e.fingerabdruck === angaben.fingerabdruck);
    if (stelle >= 0) ablage.eigene[stelle] = eintrag;
    else ablage.eigene.push(eintrag);

    aufgenommen.push({
      fingerabdruck: eintrag.fingerabdruck,
      angaben,
      eigen: true,
      mitKennwort: eintrag.mitKennwort,
      fuerKonto: eintrag.fuerKonto,
      hinzugefuegtAm: eintrag.hinzugefuegtAm,
    });
  }

  schreiben(ablage);
  return aufgenommen;
}

export interface EigenesZertifikat {
  zertifikat: Buffer;
  kette: Buffer[];
  angaben: Zertifikatsangaben;
  mitKennwort: boolean;
  /** Öffnet den geheimen Schlüssel. Wirft, wenn das Kennwort fehlt oder falsch ist. */
  schluessel(kennwort?: string): crypto.KeyObject;
}

/**
 * Die eigenen Zertifikate eines Kontos.
 *
 * Der geheime Schlüssel wird nicht mitgeliefert, sondern nur eine Funktion, die ihn
 * öffnet. So kommt er wirklich erst dann ins Spiel, wenn er gebraucht wird - und ein
 * Aufrufer, der ihn nur auflisten will, hat ihn nie in der Hand.
 */
export function eigeneFuer(accountId: string, adressen: readonly string[]): EigenesZertifikat[] {
  const gesucht = adressen.map((a) => a.trim().toLowerCase());
  return lesen()
    .eigene.filter(
      (e) => e.fuerKonto === accountId || e.angaben.adressen.some((a) => gesucht.includes(a)),
    )
    .map((e) => ({
      zertifikat: Buffer.from(e.zertifikat, 'base64'),
      kette: e.kette.map((k) => Buffer.from(k, 'base64')),
      angaben: e.angaben,
      mitKennwort: e.mitKennwort,
      schluessel: (kennwort?: string) => {
        const pem = decryptSecret(e.schluessel);
        if (!e.mitKennwort) return crypto.createPrivateKey(pem);
        if (!kennwort) {
          throw new ZertifikatsspeicherFehler(
            t('Für diesen Schlüssel wird das Kennwort gebraucht.'),
          );
        }
        try {
          return crypto.createPrivateKey({ key: pem, passphrase: kennwort });
        } catch {
          throw new ZertifikatsspeicherFehler(t('Das Kennwort des Schlüssels stimmt nicht.'));
        }
      },
    }));
}

/** Prüft ein Kennwort, ohne etwas zu verändern - vor dem Senden gefragt. */
export function kennwortStimmt(
  accountId: string,
  adressen: readonly string[],
  kennwort: string,
): boolean {
  for (const eigenes of eigeneFuer(accountId, adressen)) {
    try {
      eigenes.schluessel(kennwort);
      return true;
    } catch {
      // Weitersuchen: Ein Konto kann mehrere Zertifikate haben.
    }
  }
  return false;
}

// --- Die fremden ---

/**
 * Merkt sich das Zertifikat eines Absenders.
 *
 * Wird beim Prüfen einer Unterschrift gerufen - aber nur dann, wenn die Prüfung restlos
 * aufgegangen ist. Die Entscheidung darüber trifft der Aufrufer und nicht diese Funktion:
 * Sie hat die Nachricht nicht gesehen und könnte sie nicht treffen.
 */
export function merkeFremdes(
  der: Buffer,
  faehigkeiten: readonly string[],
  quelle: 'nachricht' | 'datei' = 'nachricht',
): ZertifikatEintrag | null {
  let angaben: Zertifikatsangaben;
  try {
    angaben = beschreibeZertifikat(der);
  } catch {
    return null;
  }
  if (angaben.adressen.length === 0) return null;

  const ablage = lesen();
  // Ein eigenes bleibt eigenes - es hier ein zweites Mal abzulegen brächte nur Verwirrung.
  if (ablage.eigene.some((e) => e.fingerabdruck === angaben.fingerabdruck)) return null;

  const eintrag: FremderEintrag = {
    fingerabdruck: angaben.fingerabdruck,
    zertifikat: der.toString('base64'),
    angaben,
    faehigkeiten: [...faehigkeiten],
    quelle,
    hinzugefuegtAm: new Date().toISOString(),
  };

  const stelle = ablage.fremde.findIndex((f) => f.fingerabdruck === angaben.fingerabdruck);
  if (stelle >= 0) {
    // Schon bekannt: nur die Fähigkeiten auffrischen, den Zeitpunkt stehen lassen.
    ablage.fremde[stelle] = { ...eintrag, hinzugefuegtAm: ablage.fremde[stelle]!.hinzugefuegtAm };
  } else {
    ablage.fremde.push(eintrag);
  }
  schreiben(ablage);
  return {
    fingerabdruck: eintrag.fingerabdruck,
    angaben,
    eigen: false,
    quelle,
    hinzugefuegtAm: eintrag.hinzugefuegtAm,
  };
}

export interface FremdesZertifikat {
  zertifikat: Buffer;
  angaben: Zertifikatsangaben;
  faehigkeiten: string[];
}

/**
 * Die Zertifikate zu einer Adresse - eigene wie fremde.
 *
 * Auch die eigenen, denn an sich selbst wird mit verschlüsselt: Ohne das wäre die Kopie
 * im Gesendet-Ordner für immer unlesbar. Sortiert wird nach Ablaufdatum, das späteste
 * zuerst - wer ein Zertifikat erneuert hat, hat beide im Speicher, und das alte zu nehmen
 * hieße, an ein Schloss zu schreiben, das niemand mehr aufschließt.
 */
export function zertifikateFuer(adresse: string): FremdesZertifikat[] {
  const wer = adresse.trim().toLowerCase();
  const ablage = lesen();
  const treffer: FremdesZertifikat[] = [];
  for (const e of ablage.eigene) {
    if (e.angaben.adressen.includes(wer)) {
      treffer.push({
        zertifikat: Buffer.from(e.zertifikat, 'base64'),
        angaben: e.angaben,
        faehigkeiten: [],
      });
    }
  }
  for (const f of ablage.fremde) {
    if (f.angaben.adressen.includes(wer)) {
      treffer.push({
        zertifikat: Buffer.from(f.zertifikat, 'base64'),
        angaben: f.angaben,
        faehigkeiten: f.faehigkeiten,
      });
    }
  }
  return treffer.sort((a, b) => b.angaben.giltBis.localeCompare(a.angaben.giltBis));
}

/**
 * Nimmt ein einzelnes Zertifikat auf - aus einer Datei, von Hand.
 *
 * Der zweite Weg neben der unterschriebenen Nachricht. Er wird gebraucht, wenn jemand
 * verschlüsselte Post bekommen soll, der selbst noch nie unterschrieben geschrieben hat.
 */
export function fuegeZertifikatHinzu(daten: Buffer): ZertifikatEintrag {
  const der = leseZertifikat(daten);
  const eintrag = merkeFremdes(der, [], 'datei');
  if (!eintrag) {
    throw new ZertifikatsspeicherFehler(
      t('In diesem Zertifikat steht keine Mailadresse - damit lässt sich keine Post schützen.'),
    );
  }
  return eintrag;
}

export function entferneZertifikat(fingerabdruck: string): boolean {
  const ablage = lesen();
  const vorher = ablage.eigene.length + ablage.fremde.length;
  ablage.eigene = ablage.eigene.filter((e) => e.fingerabdruck !== fingerabdruck);
  ablage.fremde = ablage.fremde.filter((f) => f.fingerabdruck !== fingerabdruck);
  if (ablage.eigene.length + ablage.fremde.length === vorher) return false;
  schreiben(ablage);
  return true;
}

/** Das eigene Zertifikat zum Weitergeben - als PEM, so nimmt es jedes Programm an. */
export function alsPem(fingerabdruck: string): string | null {
  const ablage = lesen();
  const eintrag =
    ablage.eigene.find((e) => e.fingerabdruck === fingerabdruck) ??
    ablage.fremde.find((f) => f.fingerabdruck === fingerabdruck);
  if (!eintrag) return null;
  const zeilen = eintrag.zertifikat.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${zeilen.join('\n')}\n-----END CERTIFICATE-----\n`;
}
