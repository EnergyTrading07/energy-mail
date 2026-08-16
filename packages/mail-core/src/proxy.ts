/**
 * Der Weg nach draußen, wenn es keinen direkten gibt.
 *
 * In vielen Firmennetzen ist der Port 993 an der Firewall zu, und alles geht über einen
 * Proxy. Bis hierher baute Energy Mail seine Verbindungen unmittelbar auf und kannte
 * keine Einstellung dafür - in einem solchen Netz war es schlicht nicht zu gebrauchen,
 * und zwar ohne dass jemand etwas hätte tun können.
 *
 * Die Technik dafür ist längst da: imapflow bringt HTTP CONNECT und SOCKS von Haus aus
 * mit, nodemailer benutzt sogar denselben CONNECT-Client. Was fehlte, ist das hier - die
 * Antwort auf "welcher Proxy gilt für diesen Rechner, und woher weiß ich das".
 *
 * ## Die Reihenfolge, und warum sie so herum ist
 *
 * 1. **Richtlinie** (%PROGRAMDATA%, siehe desktop/richtlinien.ts). Was die IT vorgibt,
 *    gilt - auch gegen eine abweichende Angabe am Konto. Sonst genügte ein eigener
 *    Eintrag im Kontodialog, um die Ausgangskontrolle des Unternehmens zu umgehen, und
 *    dann wäre die Richtliniendatei keine Richtlinie, sondern ein Vorschlag.
 * 2. **Das Konto.** Der Weg für alle, die keine zentrale Vorgabe haben - ein einzelnes
 *    Postfach, das anders geroutet werden muss.
 * 3. **Die Umgebung** (`HTTPS_PROXY`, `HTTP_PROXY`). Der eingespielte Weg im
 *    Serverbetrieb; jeder Betreiber kennt ihn aus anderen Programmen.
 * 4. **Der Systemproxy** von Windows, einschließlich PAC-Skript. Der wichtigste Fall
 *    überhaupt, weil er ohne jede Einstellung funktioniert: der Rechner weiß es bereits,
 *    Chromium kann es auflösen, und die Hülle reicht das Ergebnis hier herein.
 * 5. Sonst direkt.
 *
 * ## Was NICHT geht, und das ist wichtig zu wissen
 *
 * Die Anmeldung am Proxy geht mit Basic - Name und Kennwort stehen in der Adresse und
 * werden wie jedes andere Geheimnis verschlüsselt abgelegt. **NTLM und Kerberos gehen
 * nicht.** Dafür bräuchte es Windows' SSPI und damit eine native Erweiterung, die dieses
 * Projekt bewusst vermeidet. Viele Firmenproxys lassen Domänenrechner ohne Anmeldung
 * durch oder arbeiten mit Freigaben nach IP-Adresse; wo das nicht so ist, hilft heute
 * nur eine Ausnahme für die Mailserver.
 */

/** Woher die Angabe stammt - die Oberfläche und der Fehlerbericht sagen es dem Nutzer. */
export type Proxyquelle = 'richtlinie' | 'konto' | 'umgebung' | 'system' | 'keiner';

export interface Proxybefund {
  /** Die vollständige Adresse samt etwaiger Anmeldung, oder nichts für "direkt". */
  adresse?: string;
  quelle: Proxyquelle;
  /**
   * Gesetzt, wenn eine Angabe da war, aber nicht zu gebrauchen. Der Befund lautet dann
   * "direkt" - mit einem Grund, den man melden kann.
   *
   * Bewusst kein stilles Ignorieren: ein Tippfehler in der Richtliniendatei würde sonst
   * dazu führen, dass hundert Arbeitsplätze am Proxy vorbei ins Leere greifen, und
   * niemand wüsste warum.
   */
  beanstandet?: string;
}

/**
 * Schemata, die die verwendeten Bibliotheken tatsächlich beherrschen.
 *
 * Genau diese Liste steht in imapflow/lib/proxy-connection.js; nodemailer kennt dieselben.
 * Was nicht darin steht, wird abgewiesen statt durchgereicht - ein "ftp://" im
 * Proxy-Feld ergäbe sonst eine Verbindung, die erst tief in einer fremden Bibliothek
 * scheitert.
 */
const SCHEMATA = new Set(['http', 'https', 'socks', 'socks4', 'socks4a', 'socks5']);

/**
 * Prüft eine Proxyangabe und bringt sie in eine einheitliche Form.
 *
 * Nimmt auch die verkürzte Schreibweise an, die Administratoren gewohnt sind
 * ("proxy.firma.de:8080" ohne Schema) - dann gilt HTTP, wie überall sonst auch.
 */
export function leseProxyadresse(roh: string): { adresse: string } | { fehler: string } {
  const text = roh.trim();
  if (!text) return { fehler: 'leer' };

  // Ohne Schema: die gewohnte Kurzform. "//" davor, damit der Auswerter den Teil vor dem
  // Doppelpunkt als Rechnernamen liest und nicht als Schema.
  const mitSchema = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;

  let adresse: URL;
  try {
    adresse = new URL(mitSchema);
  } catch {
    return { fehler: `"${roh}" ist keine brauchbare Adresse` };
  }

  const schema = adresse.protocol.replace(/:$/, '').toLowerCase();
  if (!SCHEMATA.has(schema)) {
    return {
      fehler: `"${schema}" wird nicht unterstützt (möglich: ${[...SCHEMATA].join(', ')})`,
    };
  }
  if (!adresse.hostname) return { fehler: 'ohne Rechnernamen' };

  /*
   * Ein Port muss stehen.
   *
   * Für http gäbe es zwar die 80 als Vorgabe, aber ein Proxy auf Port 80 ist die
   * Ausnahme (üblich sind 3128, 8080, 1080). Eine stillschweigend eingesetzte 80 führte
   * zu einer Verbindung, die irgendwo hängt - da ist eine klare Ansage besser.
   */
  if (!adresse.port) return { fehler: 'ohne Portangabe' };

  return { adresse: adresse.href.replace(/\/$/, '') };
}

/**
 * Nimmt die Anmeldung aus einer Proxyadresse heraus.
 *
 * Für alles, was gesehen wird: Protokoll, Fehlerbericht, Oberfläche. Das Kennwort eines
 * Proxys ist ein Geheimnis wie jedes andere, und ein Proxy-Kennwort ist in Firmen oft
 * dasselbe wie das Windows-Kennwort.
 */
export function fuerAnzeige(adresse: string | undefined): string {
  if (!adresse) return 'direkt';
  try {
    const url = new URL(adresse);
    if (url.username || url.password) {
      url.username = url.username ? '…' : '';
      url.password = '';
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return '(unlesbare Angabe)';
  }
}

/**
 * Hosts, die am Proxy vorbeigehen sollen.
 *
 * Jede Firmenaufstellung hat solche Ausnahmen - der eigene Mailserver im Haus, ein
 * Testsystem. Die Schreibweise ist die von `NO_PROXY`, die jeder Administrator kennt:
 * durch Komma getrennt, ein führender Punkt oder ein Stern meint die Domain samt allem
 * darunter, ein einzelner Stern meint alles.
 *
 * Gross- und Kleinschreibung ist gleichgültig, und ein etwaiger Port wird abgeschnitten -
 * "mail.firma.de:993" trifft auf den Eintrag "firma.de" zu.
 */
export function gehtDirekt(host: string, ausnahmen: string | undefined): boolean {
  if (!ausnahmen) return false;
  const rechner = host.trim().toLowerCase().replace(/:\d+$/, '');
  if (!rechner) return false;

  for (const roh of ausnahmen.split(/[,\s]+/)) {
    const eintrag = roh.trim().toLowerCase().replace(/:\d+$/, '');
    if (!eintrag) continue;
    if (eintrag === '*') return true;

    // ".firma.de" und "*.firma.de" meinen beide: diese Domain und alles darunter.
    const nackt = eintrag.replace(/^\*?\./, '');
    if (rechner === nackt || rechner.endsWith(`.${nackt}`)) return true;
  }
  return false;
}

/** Die Angaben, aus denen sich der Befund ergibt - je Quelle eine. */
export interface Proxyquellen {
  /** Aus der Richtliniendatei. Schlägt alles andere. */
  richtlinie?: string;
  /** Am Konto hinterlegt. */
  konto?: string;
  /** Aus HTTPS_PROXY / HTTP_PROXY bzw. ENERGY_MAIL_AUSGANGSPROXY. */
  umgebung?: string;
  /** Vom Betriebssystem aufgelöst, einschliesslich PAC-Skript. */
  system?: string;
  /** Ausnahmen in der Schreibweise von NO_PROXY, aus welcher Quelle auch immer. */
  ausnahmen?: string;
}

/**
 * Entscheidet, welcher Proxy für einen Host gilt.
 *
 * Rein rechnend und ohne Zugriff auf Umgebung, Dateien oder Netz - deshalb lässt sich
 * jeder Fall dieser Reihenfolge prüfen, und das ist der Punkt: an ihr hängt, ob die
 * Vorgabe eines Unternehmens tatsächlich gilt.
 */
export function waehleProxy(host: string, quellen: Proxyquellen): Proxybefund {
  /*
   * Die Ausnahmen zuerst - aber NICHT gegen die Richtlinie.
   *
   * Andersherum wäre es ein Loch: wer die Ausnahmeliste bestimmt, bestimmte damit auch,
   * was am vorgeschriebenen Proxy vorbeigeht. Deshalb greift die Liste erst, wenn keine
   * Richtlinie im Spiel ist.
   */
  if (!quellen.richtlinie && gehtDirekt(host, quellen.ausnahmen)) {
    return { quelle: 'keiner' };
  }

  const kette: { quelle: Proxyquelle; wert?: string }[] = [
    { quelle: 'richtlinie', wert: quellen.richtlinie },
    { quelle: 'konto', wert: quellen.konto },
    { quelle: 'umgebung', wert: quellen.umgebung },
    { quelle: 'system', wert: quellen.system },
  ];

  const beanstandet: string[] = [];
  for (const glied of kette) {
    if (!glied.wert || !glied.wert.trim()) continue;

    const gelesen = leseProxyadresse(glied.wert);
    if ('fehler' in gelesen) {
      /*
       * Eine unbrauchbare Angabe wird gemeldet und übersprungen, nicht verschwiegen.
       *
       * Übersprungen, weil die nächste Quelle womöglich taugt und der Nutzer dann
       * arbeiten kann. Gemeldet, weil ein Tippfehler in der Richtliniendatei sonst
       * hundert Arbeitsplätze still am Proxy vorbeigreifen ließe.
       */
      beanstandet.push(`${glied.quelle}: ${gelesen.fehler}`);
      continue;
    }
    return {
      adresse: gelesen.adresse,
      quelle: glied.quelle,
      ...(beanstandet.length > 0 ? { beanstandet: beanstandet.join('; ') } : {}),
    };
  }

  return {
    quelle: 'keiner',
    ...(beanstandet.length > 0 ? { beanstandet: beanstandet.join('; ') } : {}),
  };
}

// --- Der Weg von außen herein ------------------------------------------------------

/**
 * Woher die Quellen kommen, die dieses Modul nicht selbst kennen kann.
 *
 * Von außen gesetzt, weil sie an verschiedenen Orten liegen und mail-core keinen davon
 * kennen soll: die Richtlinie liest die Hülle aus %PROGRAMDATA%, den Systemproxy löst
 * Chromium auf (`session.resolveProxy`, das kann auch PAC-Skripte), und im
 * Standalone-Betrieb gibt es weder das eine noch das andere. Dasselbe Muster wie beim
 * Schlüssel in secretCrypto.ts, und aus demselben Grund.
 *
 * Asynchron, weil das Auflösen des Systemproxys es ist - und ein PAC-Skript beantwortet
 * die Frage je Zielrechner verschieden, kann also nicht einmalig beim Start beantwortet
 * werden.
 */
export type Quellenermittler = (host: string) => Proxyquellen | Promise<Proxyquellen>;

let ermittler: Quellenermittler | null = null;

export function setzeProxyquellen(fn: Quellenermittler | null): void {
  ermittler = fn;
}

/**
 * Was gilt, wenn niemand etwas eingehängt hat.
 *
 * Die Umgebungsvariablen, die jeder Administrator aus anderen Programmen kennt. Damit
 * funktioniert der Standalone-Server ohne jedes Zutun, und Prüfungen brauchen keine
 * Vorbereitung.
 */
function ausDerUmgebung(): Proxyquellen {
  const env = process.env;
  return {
    umgebung:
      env.ENERGY_MAIL_AUSGANGSPROXY ??
      env.HTTPS_PROXY ??
      env.https_proxy ??
      env.HTTP_PROXY ??
      env.http_proxy,
    ausnahmen: env.ENERGY_MAIL_KEIN_PROXY ?? env.NO_PROXY ?? env.no_proxy,
  };
}

/**
 * Der Befund für einen Zielrechner - die Frage, die alle Aufrufer stellen.
 *
 * @param host Der Rechner, zu dem verbunden werden soll. Er entscheidet mit: sowohl die
 *   Ausnahmeliste als auch ein PAC-Skript antworten je Ziel verschieden.
 * @param amKonto Was am Konto hinterlegt ist, falls etwas hinterlegt ist.
 */
export async function proxyFuer(host: string, amKonto?: string): Promise<Proxybefund> {
  let quellen: Proxyquellen;
  try {
    quellen = ermittler ? await ermittler(host) : ausDerUmgebung();
  } catch (err) {
    /*
     * Der Ermittler greift auf Datei und Betriebssystem zu - beides kann scheitern. Dann
     * gilt, was die Umgebung sagt, und die Verbindung wird versucht. Ein Fehler beim
     * ERMITTELN des Proxys darf nicht dazu führen, dass gar nicht mehr gemailt wird.
     */
    quellen = { ...ausDerUmgebung(), };
    return {
      ...waehleProxy(host, { ...quellen, konto: amKonto }),
      beanstandet: `Proxy nicht ermittelbar: ${(err as Error).message}`,
    };
  }
  return waehleProxy(host, { ...quellen, konto: amKonto });
}

/**
 * Denselben Weg auch für die HTTPS-Aufrufe.
 *
 * IMAP und SMTP sind nur zwei Drittel. Das dritte sind die gewöhnlichen Abrufe: der
 * Markentausch bei Google und Microsoft (ohne den meldet sich kein OAuth-Konto an) und
 * die Serversuche beim Anlegen eines Kontos. Beide gehen über `fetch`, und `fetch`
 * schert sich von sich aus um keinen Proxy - im Firmennetz liefe also die Post, aber die
 * Anmeldung nicht.
 *
 * Über undicis `EnvHttpProxyAgent` statt über einen selbstgebauten Verteiler: der liest
 * HTTPS_PROXY, HTTP_PROXY und NO_PROXY genau so, wie es jedes andere Programm tut, und
 * bringt die Behandlung der Ausnahmen gleich mit. Deshalb werden die Variablen hier
 * gesetzt, bevor er gebaut wird - er liest sie einmal beim Anlegen.
 *
 * Muss laufen, bevor der erste Abruf hinausgeht; danach gilt er für den ganzen Prozess.
 */
export async function richteHttpProxyEin(quellen: Proxyquellen): Promise<Proxybefund> {
  /*
   * "*" als Rechnername: für die allgemeine Frage "welcher Proxy gilt hier überhaupt".
   * Die Ausnahmen bleiben dabei bewusst außen vor - über sie entscheidet gleich der
   * Agent, und zwar je Abruf, weil er das Ziel kennt und diese Stelle nicht.
   */
  const befund = waehleProxy('*', { ...quellen, ausnahmen: undefined });
  if (!befund.adresse) return befund;

  try {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici');
    process.env.HTTPS_PROXY = befund.adresse;
    process.env.HTTP_PROXY = befund.adresse;
    if (quellen.ausnahmen) process.env.NO_PROXY = quellen.ausnahmen;
    setGlobalDispatcher(new EnvHttpProxyAgent());
  } catch (err) {
    return { ...befund, beanstandet: `HTTPS-Aufrufe ohne Proxy: ${(err as Error).message}` };
  }
  return befund;
}

/** Ein Satz für Protokoll und Fehlerbericht - ohne Kennwort. */
export function beschreibeProxy(befund: Proxybefund): string {
  const woher: Record<Proxyquelle, string> = {
    richtlinie: 'aus der Richtliniendatei',
    konto: 'am Konto hinterlegt',
    umgebung: 'aus der Umgebung',
    system: 'vom Betriebssystem',
    keiner: '',
  };
  const kern =
    befund.quelle === 'keiner'
      ? 'Proxy: keiner, Verbindungen gehen direkt hinaus'
      : `Proxy: ${fuerAnzeige(befund.adresse)} (${woher[befund.quelle]})`;
  return befund.beanstandet ? `${kern}. Übergangen - ${befund.beanstandet}` : `${kern}.`;
}
