import path from 'node:path';
import {
  LdapFehler,
  frageVerzeichnis,
  sucheFilter,
  type Verschluesselung,
} from '@energy-mail/mail-core';
import { liesJson, schreibeAtomar } from './atomar.js';
import { getWurzelDir } from './paths.js';
import { protokolliere } from './protokollDatei.js';
import { entschluesselMitMaster, isEncryptionAvailable, verschluesselMitMaster } from './secretCrypto.js';

/**
 * Das Firmenverzeichnis (LDAP / Active Directory).
 *
 * ## Warum es dem Betreiber gehört und nicht dem Nutzer
 *
 * Ein Firmenverzeichnis ist eine Eigenschaft der Aufstellung, nicht des Postfachs. Es
 * einzeln je Nutzer eintragen zu lassen hieße: dieselben Angaben zwanzigmal, zwanzigmal
 * die Gelegenheit, sich zu vertippen, und zwanzig Kennwörter eines Dienstkontos in
 * zwanzig Nutzerordnern. Deshalb steht es in der WURZEL, es richtet ein Verwalter ein, und
 * alle Nutzer schlagen im selben nach.
 *
 * ## Nur lesen
 *
 * Der Client kann nichts anderes (siehe mail-core/ldap/client.ts). Das ist der Zuschnitt:
 * Ein Mailprogramm schlägt in einem Firmenverzeichnis nach; es pflegt es nicht. Was das
 * Programm nicht kann, kann auch niemand missbrauchen, der sich Zugriff darauf verschafft.
 *
 * ## Das Dienstkonto verdient einen eigenen Satz
 *
 * In der Einrichtung steht ein DN mit Kennwort. Es gehört ein Konto dorthin, das im
 * Verzeichnis NUR LESEN darf und sonst nichts - kein Administratorkonto. Das steht in
 * BETRIEB.md, es steht in der Oberfläche daneben, und es ist die eine Angabe, bei der ein
 * bequemer Griff später teuer wird.
 */

export interface Verzeichnis {
  aktiv: boolean;
  host: string;
  port: number;
  verschluesselung: Verschluesselung;
  /** Ob das Zertifikat geprüft wird. Aus nur für interne, selbst ausgestellte. */
  zertifikatPruefen: boolean;
  /** Ab welchem Knoten gesucht wird, z. B. `dc=firma,dc=de`. */
  basis: string;
  /** Der DN des Dienstkontos. Leer heißt: anonym anmelden. */
  bindDn: string;
  /** Der Grundfilter des Betreibers - er gilt zusätzlich zu jeder Suche. */
  filter: string;
  /** Welche Felder durchsucht werden. */
  sucheIn: string[];
  /** Welches Feld welche Angabe trägt. */
  felder: {
    email: string;
    name: string;
    vorname?: string;
    nachname?: string;
    telefon?: string;
    mobil?: string;
    organisation?: string;
    abteilung?: string;
  };
}

/**
 * Vorbelegt für ein Active Directory - das ist der häufigste Fall.
 *
 * `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))`
 * wäre der vollständig richtige Filter für "aktive Personen, keine Rechner". Er steht hier
 * bewusst nicht: Die letzte Bedingung ist eine Microsoft-Erweiterung, die ein OpenLDAP
 * nicht kennt, und ein Filter, der beim ersten Versuch mit einer unverständlichen Meldung
 * scheitert, hilft niemandem. Er steht stattdessen in BETRIEB.md zum Übernehmen.
 */
const VORGABE: Verzeichnis = {
  aktiv: false,
  host: '',
  port: 636,
  verschluesselung: 'ldaps',
  zertifikatPruefen: true,
  basis: '',
  bindDn: '',
  filter: '(&(objectClass=person)(mail=*))',
  sucheIn: ['cn', 'displayName', 'mail', 'sn', 'givenName'],
  felder: {
    email: 'mail',
    name: 'displayName',
    vorname: 'givenName',
    nachname: 'sn',
    telefon: 'telephoneNumber',
    mobil: 'mobile',
    organisation: 'company',
    abteilung: 'department',
  },
};

/** Was gespeichert wird - das Kennwort verschlüsselt. */
type Ablage = Verzeichnis & { kennwortVerschluesselt?: string };

const getPfad = () => path.join(getWurzelDir(), 'verzeichnis.json');

function lesen(): Ablage {
  const befund = liesJson<Ablage | null>(getPfad(), null);
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'verzeichnis',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}).`,
    );
  }
  return { ...VORGABE, ...(befund.wert ?? {}) };
}

/**
 * Die Einrichtung zum Anzeigen - OHNE das Kennwort.
 *
 * Es geht nie hinaus, auch nicht an einen Verwalter. Die Antwort dieser Route landet im
 * Browserspeicher, in den Entwicklerwerkzeugen und womöglich in einem Mitschnitt; ein
 * Kennwort, das man nur einzutragen und nie zu lesen braucht, hat dort nichts zu suchen.
 * Stattdessen steht daneben, OB eines hinterlegt ist.
 */
export function verzeichnisFuerAnzeige(): Verzeichnis & { kennwortHinterlegt: boolean } {
  const { kennwortVerschluesselt, ...rest } = lesen();
  return { ...rest, kennwortHinterlegt: Boolean(kennwortVerschluesselt) };
}

export class VerzeichnisFehler extends Error {}

export function setzeVerzeichnis(
  eingabe: Partial<Verzeichnis>,
  kennwort?: string | null,
): Verzeichnis & { kennwortHinterlegt: boolean } {
  const bisher = lesen();
  const neu: Ablage = {
    ...bisher,
    ...eingabe,
    felder: { ...bisher.felder, ...(eingabe.felder ?? {}) },
    sucheIn: eingabe.sucheIn?.filter(Boolean) ?? bisher.sucheIn,
  };

  if (neu.aktiv) {
    if (!neu.host.trim()) throw new VerzeichnisFehler('Ohne Adresse des Verzeichnisses geht es nicht.');
    if (!neu.basis.trim()) throw new VerzeichnisFehler('Ohne Suchbereich (Basis-DN) geht es nicht.');
    if (!neu.felder.email?.trim()) {
      throw new VerzeichnisFehler('Es muss stehen, in welchem Feld die Mailadresse steht.');
    }
    if (neu.sucheIn.length === 0) {
      throw new VerzeichnisFehler('Es muss mindestens ein Feld durchsucht werden.');
    }
  }

  /*
   * `null` heißt "löschen", `undefined` heißt "unverändert lassen".
   *
   * Der Unterschied ist nötig, weil das Kennwort nie zur Anzeige hinausgeht: Eine
   * Oberfläche, die die Einrichtung zurückschickt, hat es gar nicht - und ohne diese
   * Unterscheidung wäre jedes Speichern eines geänderten Ports zugleich ein Löschen des
   * Kennworts.
   */
  if (kennwort === null) {
    delete neu.kennwortVerschluesselt;
  } else if (typeof kennwort === 'string' && kennwort.length > 0) {
    if (!isEncryptionAvailable()) {
      throw new VerzeichnisFehler(
        'Ohne eingerichtete Verschlüsselung würde das Kennwort im Klartext liegen.',
      );
    }
    neu.kennwortVerschluesselt = verschluesselMitMaster(kennwort);
  }

  schreibeAtomar(getPfad(), JSON.stringify(neu, null, 2));
  protokolliere(
    'info',
    'verzeichnis',
    neu.aktiv
      ? `Firmenverzeichnis eingerichtet: ${neu.host}:${neu.port} (${neu.verschluesselung}).`
      : 'Firmenverzeichnis abgeschaltet.',
  );
  return verzeichnisFuerAnzeige();
}

// --- Suchen ---

export interface Verzeichniseintrag {
  address: string;
  name?: string;
  organisation?: string;
  abteilung?: string;
  telefon?: string;
  mobil?: string;
  /** Damit die Oberfläche sagen kann, woher der Vorschlag stammt. */
  ausVerzeichnis: true;
}

/**
 * Ein kurzlebiger Zwischenspeicher.
 *
 * Wer einen Empfänger tippt, löst je Buchstabe eine Suche aus. Ohne dieses Gedächtnis
 * hämmerte die Oberfläche eines Unternehmens mit vierzig Leuten den Verzeichnisdienst mit
 * hunderten Anfragen je Minute - und der ist meistens derselbe Rechner, der auch die
 * Anmeldungen macht.
 *
 * Dreißig Sekunden: lang genug für das Tippen eines Namens, kurz genug, dass ein neu
 * eingetragener Kollege nicht bis zum nächsten Neustart fehlt.
 */
const gedaechtnis = new Map<string, { bis: number; treffer: Verzeichniseintrag[] }>();
const GEDAECHTNIS_MS = 30_000;
const MAX_GEDAECHTNIS = 200;

function ersterWert(werte: Record<string, string[]>, feld?: string): string | undefined {
  if (!feld) return undefined;
  return werte[feld.trim().toLowerCase()]?.[0];
}

/**
 * Sucht im Firmenverzeichnis.
 *
 * Wirft nicht. Ein Verzeichnis, das gerade nicht erreichbar ist, darf die
 * Empfängervorschläge nicht lahmlegen - dann fehlen eben die Kollegen, und das eigene
 * Adressbuch steht weiterhin da. Die Störung geht ins Protokoll, nicht in die Oberfläche.
 */
export async function sucheImVerzeichnis(
  suchtext: string,
  grenze = 25,
): Promise<Verzeichniseintrag[]> {
  const text = suchtext.trim();
  const einrichtung = lesen();
  if (!einrichtung.aktiv || text.length < 2) return [];

  const schluessel = `${text.toLowerCase()}|${grenze}`;
  const gemerkt = gedaechtnis.get(schluessel);
  if (gemerkt && gemerkt.bis > Date.now()) return gemerkt.treffer;

  let kennwort = '';
  if (einrichtung.kennwortVerschluesselt) {
    try {
      kennwort = entschluesselMitMaster(einrichtung.kennwortVerschluesselt);
    } catch (err) {
      protokolliere(
        'fehler',
        'verzeichnis',
        `Das Kennwort des Dienstkontos lässt sich nicht öffnen: ${(err as Error).message}`,
      );
      return [];
    }
  }

  const felder = einrichtung.felder;
  const gewuenscht = [...new Set(Object.values(felder).filter(Boolean) as string[])];

  try {
    const eintraege = await frageVerzeichnis(
      {
        host: einrichtung.host,
        port: einrichtung.port,
        verschluesselung: einrichtung.verschluesselung,
        zertifikatPruefen: einrichtung.zertifikatPruefen,
      },
      { bindDn: einrichtung.bindDn || undefined, kennwort: kennwort || undefined },
      {
        basis: einrichtung.basis,
        filter: sucheFilter(einrichtung.filter, text, einrichtung.sucheIn),
        attribute: gewuenscht,
        grenze,
      },
    );

    const treffer = eintraege
      .map((e): Verzeichniseintrag | null => {
        const address = ersterWert(e.werte, felder.email);
        // Ein Eintrag ohne Mailadresse nützt einem Mailprogramm nichts. Er kommt vor -
        // Verteiler, Räume, Rechner -, und er soll nicht als leere Zeile erscheinen.
        if (!address) return null;
        const name =
          ersterWert(e.werte, felder.name) ??
          [ersterWert(e.werte, felder.vorname), ersterWert(e.werte, felder.nachname)]
            .filter(Boolean)
            .join(' ')
            .trim();
        return {
          address,
          name: name || undefined,
          organisation: ersterWert(e.werte, felder.organisation),
          abteilung: ersterWert(e.werte, felder.abteilung),
          telefon: ersterWert(e.werte, felder.telefon),
          mobil: ersterWert(e.werte, felder.mobil),
          ausVerzeichnis: true,
        };
      })
      .filter((e): e is Verzeichniseintrag => e !== null);

    if (gedaechtnis.size >= MAX_GEDAECHTNIS) gedaechtnis.clear();
    gedaechtnis.set(schluessel, { bis: Date.now() + GEDAECHTNIS_MS, treffer });
    return treffer;
  } catch (err) {
    protokolliere(
      'warnung',
      'verzeichnis',
      `Suche im Firmenverzeichnis fehlgeschlagen: ${(err as Error).message}`,
    );
    return [];
  }
}

/**
 * Ein Verbindungsversuch mit Rückmeldung - für den Knopf "Verbindung prüfen".
 *
 * Anders als die Suche wirft er nicht nur nicht, sondern gibt den Fehler auch heraus: Wer
 * gerade einrichtet, braucht die Meldung. Wer sucht, braucht sie nicht - er braucht seine
 * Vorschläge.
 */
export async function pruefeVerzeichnis(
  eingabe?: Partial<Verzeichnis>,
  kennwort?: string,
): Promise<{ ok: boolean; treffer?: number; fehler?: string }> {
  const gespeichert = lesen();
  const einrichtung: Ablage = {
    ...gespeichert,
    ...(eingabe ?? {}),
    felder: { ...gespeichert.felder, ...(eingabe?.felder ?? {}) },
  };

  let geheim = kennwort ?? '';
  if (!geheim && einrichtung.kennwortVerschluesselt) {
    try {
      geheim = entschluesselMitMaster(einrichtung.kennwortVerschluesselt);
    } catch {
      return { ok: false, fehler: 'Das hinterlegte Kennwort lässt sich nicht öffnen.' };
    }
  }

  try {
    const eintraege = await frageVerzeichnis(
      {
        host: einrichtung.host,
        port: einrichtung.port,
        verschluesselung: einrichtung.verschluesselung,
        zertifikatPruefen: einrichtung.zertifikatPruefen,
        fristMs: 8000,
      },
      { bindDn: einrichtung.bindDn || undefined, kennwort: geheim || undefined },
      {
        basis: einrichtung.basis,
        filter: sucheFilter(einrichtung.filter, '', einrichtung.sucheIn),
        attribute: [einrichtung.felder.email],
        grenze: 5,
      },
    );
    return { ok: true, treffer: eintraege.length };
  } catch (err) {
    const fehler =
      err instanceof LdapFehler ? err.message : `Keine Verbindung: ${(err as Error).message}`;
    return { ok: false, fehler };
  }
}
