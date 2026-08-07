import { promises as dns } from 'node:dns';
import type { ProviderPreset } from './providerPresets.js';

/**
 * Findet die Serveradressen zu einer Mailadresse selbst.
 *
 * Ohne das kennt das Programm neun Domains auswendig und verlangt bei allem anderen
 * Hostname, Port und Verschlüsselungsart von Hand - die Hürde, an der die meisten
 * aussteigen. Die Wege hierfür sind seit Jahren ausgetreten und alle offen:
 *
 * 1. Die eigenen Voreinstellungen. Sofort da, kein Netz nötig.
 * 2. Die Anbieterdatenbank von Mozilla. Deckt tausende Anbieter ab; dieselbe Quelle,
 *    aus der Thunderbird schöpft.
 * 3. Die Domain selbst: viele Betreiber legen unter "autoconfig.<domain>" oder
 *    "<domain>/.well-known/autoconfig" eine Datei mit genau diesen Angaben ab.
 * 4. Die DNS-Einträge "_imaps._tcp" und "_submission._tcp" (RFC 6186). Die letzte
 *    Zuflucht, aber die einzige, die auch ohne Webserver funktioniert.
 *
 * Erst wenn alles vier ins Leere läuft, bleibt das Formular von Hand.
 */

/** Woher die Angaben stammen - die Oberfläche sagt es dem Nutzer. */
export type Fundort = 'eingebaut' | 'anbieterdatenbank' | 'domain' | 'dns';

export interface GefundeneEinstellungen extends Omit<ProviderPreset, 'providerId'> {
  fundort: Fundort;
  /** Menschenlesbarer Name des Anbieters, sofern die Quelle einen nennt. */
  anbieter?: string;
  /**
   * Was als Benutzername einzutragen ist. Manche Anbieter wollen die ganze Adresse,
   * andere nur den Teil davor - die Quellen sagen das mit "%EMAILADDRESS%" bzw.
   * "%EMAILLOCALPART%".
   */
  benutzername?: 'adresse' | 'ortsteil';
}

/** Länger zu warten hilft niemandem - dann tippt man die Angaben schneller selbst ein. */
const FRIST_MS = 3000;

async function holeMitFrist(adresse: string): Promise<string | null> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    const antwort = await fetch(adresse, {
      signal: abbruch.signal,
      redirect: 'follow',
      headers: { accept: 'text/xml, application/xml, */*' },
    });
    if (!antwort.ok) return null;
    return await antwort.text();
  } catch {
    // Nicht erreichbar, kein Zertifikat, Zeitüberschreitung - alles derselbe Fall:
    // diese Quelle weiß nichts, die nächste ist dran.
    return null;
  } finally {
    clearTimeout(uhr);
  }
}

/** Holt den Inhalt eines Elements aus dem XML - ohne vollen Parser, der hier zu viel wäre. */
function feld(block: string, name: string): string | undefined {
  const treffer = block.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, 'i'));
  return treffer?.[1]?.trim() || undefined;
}

/** Alle Serverblöcke einer Art aus einer Autoconfig-Datei. */
function bloecke(xml: string, art: 'incomingServer' | 'outgoingServer'): string[] {
  return [...xml.matchAll(new RegExp(`<${art}[\\s\\S]*?</${art}>`, 'gi'))].map((m) => m[0]);
}

/**
 * Wertet das Format aus, das sowohl die Anbieterdatenbank als auch die Dateien auf den
 * Domains verwenden (Mozilla "clientConfig", Fassung 1.1).
 */
export function leseAutoconfig(xml: string, fundort: Fundort): GefundeneEinstellungen | null {
  // Nur IMAP - POP3 unterstützt das Programm bewusst nicht.
  const imap = bloecke(xml, 'incomingServer').find((b) => /type\s*=\s*"imap"/i.test(b));
  const smtp = bloecke(xml, 'outgoingServer').find((b) => /type\s*=\s*"smtp"/i.test(b));
  if (!imap || !smtp) return null;

  const imapHost = feld(imap, 'hostname');
  const smtpHost = feld(smtp, 'hostname');
  const imapPort = Number(feld(imap, 'port'));
  const smtpPort = Number(feld(smtp, 'port'));
  if (!imapHost || !smtpHost || !imapPort || !smtpPort) return null;

  /**
   * "SSL" heißt: die Verbindung ist von der ersten Sekunde an verschlüsselt. "STARTTLS"
   * heißt: sie beginnt offen und wird hochgestuft. Für die Verbindungsschicht ist nur
   * der erste Fall "secure"; STARTTLS wird über den Port erkannt.
   */
  const istSSL = (block: string) => /^\s*ssl\s*$/i.test(feld(block, 'socketType') ?? '');

  const rohBenutzer = feld(imap, 'username') ?? '';
  return {
    fundort,
    anbieter: feld(xml, 'displayName'),
    imapHost,
    imapPort,
    imapSecure: istSSL(imap),
    smtpHost,
    smtpPort,
    smtpSecure: istSSL(smtp),
    benutzername: /EMAILLOCALPART/i.test(rohBenutzer) ? 'ortsteil' : 'adresse',
  };
}

/**
 * Die Anbieterdatenbank von Mozilla. Offen abrufbar und ohne Anmeldung; dieselbe Quelle,
 * die Thunderbird als erstes befragt.
 */
async function ausAnbieterdatenbank(domain: string): Promise<GefundeneEinstellungen | null> {
  const xml = await holeMitFrist(`https://autoconfig.thunderbird.net/v1.1/${domain}`);
  return xml ? leseAutoconfig(xml, 'anbieterdatenbank') : null;
}

/**
 * Die Domain selbst. Zwei übliche Orte, beide über HTTPS - über HTTP wäre die Auskunft
 * unterwegs veränderbar, und darüber liefen dann Zugangsdaten.
 */
async function vonDerDomain(domain: string): Promise<GefundeneEinstellungen | null> {
  // Beide gleichzeitig: nacheinander liefen bei einer Domain ohne beides zwei Fristen
  // hintereinander ab - gemessen 4,5 Sekunden, bis überhaupt der DNS-Weg drankam.
  const [ersteWahl, zweiteWahl] = await Promise.all([
    holeMitFrist(`https://autoconfig.${domain}/mail/config-v1.1.xml`),
    holeMitFrist(`https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`),
  ]);
  for (const xml of [ersteWahl, zweiteWahl]) {
    const gefunden = xml ? leseAutoconfig(xml, 'domain') : null;
    if (gefunden) return gefunden;
  }
  return null;
}

/**
 * Die DNS-Einträge nach RFC 6186. Die letzte Zuflucht: keine Datei, kein Webserver, nur
 * ein Eintrag in der Namensauflösung. Liefert Host und Port, aber keinen Anbieternamen.
 */
async function ausDns(domain: string): Promise<GefundeneEinstellungen | null> {
  /** Der Eintrag mit der höchsten Vorrangstellung (niedrigste "priority"). */
  const beste = async (dienst: string) => {
    try {
      const eintraege = await dns.resolveSrv(`${dienst}.${domain}`);
      const brauchbar = eintraege.filter((e) => e.name && e.name !== '.');
      if (brauchbar.length === 0) return null;
      return brauchbar.sort((a, b) => a.priority - b.priority)[0]!;
    } catch {
      return null;
    }
  };

  const imap = await beste('_imaps._tcp');
  const smtp = (await beste('_submissions._tcp')) ?? (await beste('_submission._tcp'));
  if (!imap || !smtp) return null;

  return {
    fundort: 'dns',
    imapHost: imap.name,
    imapPort: imap.port,
    // _imaps ist per Definition von Anfang an verschlüsselt.
    imapSecure: true,
    smtpHost: smtp.name,
    smtpPort: smtp.port,
    // _submissions (465) ist von Anfang an verschlüsselt, _submission (587) stuft hoch.
    smtpSecure: smtp.port === 465,
    benutzername: 'adresse',
  };
}

/**
 * Sucht die Serveradressen zu einer Mailadresse. Gibt null zurück, wenn keine Quelle
 * etwas weiß - dann bleibt die Eingabe von Hand.
 *
 * Die Reihenfolge ist nicht beliebig: das Eingebaute ist geprüft und sofort da, die
 * Anbieterdatenbank ist gepflegt und deckt am meisten ab, die Domain kennt sich selbst
 * am besten (und schlägt die Datenbank, wenn ein Betreiber umgezogen ist - deshalb steht
 * sie vor DNS, aber nach der Datenbank, die für die großen Anbieter verlässlicher ist).
 */
export async function findeEinstellungen(
  email: string,
  eingebaut?: (email: string) => ProviderPreset | null,
): Promise<GefundeneEinstellungen | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain) return null;

  const vorhanden = eingebaut?.(email);
  if (vorhanden) {
    const { providerId: _unbenutzt, ...rest } = vorhanden;
    return { ...rest, fundort: 'eingebaut', benutzername: 'adresse' };
  }

  return (
    (await ausAnbieterdatenbank(domain)) ?? (await vonDerDomain(domain)) ?? (await ausDns(domain))
  );
}
