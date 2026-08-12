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

/**
 * Höchstens so viel wird von einer Autoconfig-Datei gelesen.
 *
 * Sie ist ein paar Kilobyte groß. Ohne Deckel liest antwort.text() ein, was die
 * Gegenseite schickt - und die bestimmt der Inhaber einer beliebigen Mailadresse, die
 * jemand ins Feld tippt. Eine Antwort ohne Ende wäre damit ein Weg, dem Server den
 * Speicher vollzuschreiben.
 */
const MAX_BYTES = 256 * 1024;

/** So vielen Weiterleitungen wird gefolgt - jede davon erneut geprüft. */
const MAX_SPRUENGE = 3;

/**
 * Ein Rechnername, wie er in einer Mailadresse stehen darf.
 *
 * Mindestens zwei Bezeichner, keine Ziffernadresse, kein Doppelpunkt, kein Schrägstrich,
 * kein "@". Genau daran fehlte es: die Domain kam ungeprüft aus dem, was jemand ins
 * Adressfeld tippte, und wurde in eine Adresse eingesetzt. "a@127.0.0.1:9200/x?" ergab
 * damit einen Abruf auf 127.0.0.1:9200 - der Server klopfte im Auftrag des Anfragenden
 * an fremden Türen im eigenen Netz.
 */
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

export function istBrauchbarerHostname(host: string): boolean {
  if (!HOSTNAME.test(host)) return false;
  // Eine Ziffernadresse hat keine Autoconfig-Datei - und wer eine einträgt, meint
  // etwas anderes als eine Anbietersuche.
  if (/^\d+(\.\d+)*$/.test(host)) return false;
  return true;
}

/** Adressbereiche, die nicht ins offene Netz zeigen. */
function istInternesZiel(adresse: string, art: 4 | 6): boolean {
  if (art === 6) {
    const v6 = adresse.toLowerCase();
    // IPv4 in IPv6-Schreibweise ("::ffff:10.0.0.1") nach der v4-Regel beurteilen.
    const eingebettet = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (eingebettet) return istInternesZiel(eingebettet, 4);
    if (v6 === '::1' || v6 === '::') return true;
    // Eindeutig lokal (fc00::/7) und verbindungslokal (fe80::/10).
    return /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }

  const teile = adresse.split('.').map(Number);
  if (teile.length !== 4 || teile.some((t) => !Number.isInteger(t) || t < 0 || t > 255)) return true;
  const [a = 0, b = 0] = teile;
  return (
    a === 0 || // "dieses Netz"
    a === 10 ||
    a === 127 || // Rückschleife
    (a === 100 && b >= 64 && b <= 127) || // Anbieter-internes Netz (auch Tailscale)
    (a === 169 && b === 254) || // verbindungslokal, darunter der Metadatendienst der Wolke
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && b >= 18 && b <= 19) ||
    a >= 224 // Rundruf und reserviert
  );
}

/**
 * Prüft eine Adresse, bevor überhaupt eine Verbindung aufgebaut wird.
 *
 * Zwei Stufen, und beide sind nötig: der Name muss die Form eines Rechnernamens haben,
 * und wohin er zeigt, darf nicht ins eigene Netz führen. Die zweite Stufe fängt den
 * Fall, den die erste nicht sehen kann - "intern.beispiel.de" ist ein tadelloser Name
 * und löst auf 10.0.0.5 auf.
 *
 * Was hier NICHT abgedeckt ist, und das ehrlich gesagt: zwischen dieser Auflösung und
 * dem eigentlichen Verbindungsaufbau liegt ein Augenblick, in dem ein Name auf eine
 * andere Adresse zeigen könnte (DNS-Rebinding). Das dicht zu bekommen hieße, die
 * Verbindung selbst an eine feste Adresse zu binden - ein Aufwand, der zu dem hier
 * geschützten Wert nicht im Verhältnis steht. Die Hürde ist damit hoch, nicht
 * unüberwindlich.
 */
async function zielIstUnbedenklich(adresse: URL): Promise<boolean> {
  if (adresse.protocol !== 'https:' && adresse.protocol !== 'http:') return false;
  // Ein Benutzerteil ("https://name@host/") ist in einer Autoconfig-Adresse sinnlos und
  // ein bewährtes Mittel, um die Prüfung eines Rechnernamens zu verwirren.
  if (adresse.username || adresse.password) return false;
  if (!istBrauchbarerHostname(adresse.hostname)) return false;

  try {
    for (const { address, family } of await dns.lookup(adresse.hostname, { all: true })) {
      if (istInternesZiel(address, family === 6 ? 6 : 4)) return false;
    }
  } catch {
    // Nicht auflösbar - dann gibt es dort ohnehin nichts zu holen.
    return false;
  }
  return true;
}

/** Liest höchstens MAX_BYTES aus einer Antwort. */
async function liesBegrenzt(antwort: Response): Promise<string | null> {
  const angekuendigt = Number(antwort.headers.get('content-length') ?? '0');
  if (angekuendigt > MAX_BYTES) return null;

  const leser = antwort.body?.getReader();
  if (!leser) return null;

  const stuecke: Uint8Array[] = [];
  let gesamt = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    gesamt += value.length;
    if (gesamt > MAX_BYTES) {
      await leser.cancel();
      return null;
    }
    stuecke.push(value);
  }
  return Buffer.concat(stuecke).toString('utf-8');
}

/**
 * Holt eine Autoconfig-Datei - geprüft, begrenzt und mit eigener Weiterleitungsführung.
 *
 * Weiterleitungen werden von Hand verfolgt statt von fetch. Der Grund ist derselbe wie
 * bei der Prüfung oben: mit `redirect: 'follow'` genügte es, dass eine fremde Domain mit
 * "302 -> http://169.254.169.254/..." antwortete, und die ganze Prüfung des ersten Ziels
 * war umsonst. Jeder Sprung wird deshalb einzeln geprüft.
 */
async function holeMitFrist(adresse: string): Promise<string | null> {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), FRIST_MS);
  try {
    let ziel: URL;
    try {
      ziel = new URL(adresse);
    } catch {
      return null;
    }

    for (let sprung = 0; sprung <= MAX_SPRUENGE; sprung++) {
      if (!(await zielIstUnbedenklich(ziel))) return null;

      const antwort = await fetch(ziel, {
        signal: abbruch.signal,
        redirect: 'manual',
        headers: { accept: 'text/xml, application/xml, */*' },
      });

      if (antwort.status >= 300 && antwort.status < 400) {
        const weiter = antwort.headers.get('location');
        if (!weiter) return null;
        try {
          ziel = new URL(weiter, ziel);
        } catch {
          return null;
        }
        continue;
      }

      if (!antwort.ok) return null;
      return await liesBegrenzt(antwort);
    }
    // Mehr Sprünge als erlaubt - im Kreis geleitet.
    return null;
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
  // Kodiert: die Domain steht hier im PFAD einer fremden Adresse. Ungefiltert liesse
  // sich mit "../.." ein anderer Weg auf demselben Server ansprechen.
  const xml = await holeMitFrist(
    `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`,
  );
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
  const domain = email.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;

  const vorhanden = eingebaut?.(email);
  if (vorhanden) {
    const { providerId: _unbenutzt, ...rest } = vorhanden;
    return { ...rest, fundort: 'eingebaut', benutzername: 'adresse' };
  }

  /*
   * Ab hier geht es ins Netz - und zwar an eine Adresse, die der Anfragende bestimmt.
   * Was nicht wie ein Rechnername aussieht, kommt gar nicht erst so weit. Die eigenen
   * Voreinstellungen oben brauchen die Prüfung nicht: sie fragen niemanden.
   */
  if (!istBrauchbarerHostname(domain)) return null;

  return (
    (await ausAnbieterdatenbank(domain)) ?? (await vonDerDomain(domain)) ?? (await ausDns(domain))
  );
}
