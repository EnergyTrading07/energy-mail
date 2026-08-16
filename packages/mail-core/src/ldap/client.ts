import net from 'node:net';
import tls from 'node:tls';
import {
  KENNUNG,
  alsGanzzahl,
  alsText,
  anwendung,
  aufzaehlung,
  folge,
  ganzzahl,
  kontext,
  liesElement,
  liesTeile,
  tlv,
  wahrheit,
  zeichen,
  type Element,
} from './ber.js';

/**
 * Ein LDAP-Client - so viel davon, wie ein Firmenverzeichnis zum Nachschlagen braucht.
 *
 * ## Zwei Vorgänge, beide lesend
 *
 * Anmelden (bind) und Suchen (search). Kein Ändern, kein Löschen, kein Anlegen. Das ist
 * keine Sparsamkeit, sondern der Zuschnitt: Ein Mailprogramm schlägt in einem
 * Firmenverzeichnis nach; es pflegt es nicht. Was es nicht kann, kann auch niemand
 * missbrauchen, der sich Zugriff auf diesen Dienst verschafft.
 *
 * ## Die drei Wege hinein
 *
 * `ldaps` verschlüsselt von der ersten Sekunde an (Port 636). `starttls` beginnt im
 * Klartext und schaltet um, bevor irgendetwas Wichtiges über die Leitung geht (Port 389) -
 * so machen es die meisten Active Directories. `einfach` ist unverschlüsselt und
 * verschickt das Bind-Kennwort im Klartext; es gibt Aufstellungen, in denen das
 * vertretbar ist (eine Leitung, die den Rechner nie verlässt), und der Betreiber muss es
 * ausdrücklich wählen.
 *
 * ## Warum die Antworten über eine Nachrichtennummer laufen
 *
 * LDAP ist nebenläufig: Auf einer Verbindung dürfen mehrere Anfragen gleichzeitig
 * unterwegs sein, und die Antworten kommen in beliebiger Reihenfolge zurück. Jede trägt
 * die Nummer ihrer Anfrage. Wer stattdessen "die nächste Antwort" nähme, bekäme bei zwei
 * gleichzeitigen Suchen die Treffer der jeweils anderen.
 */

export type Verschluesselung = 'ldaps' | 'starttls' | 'einfach';

export interface Verbindungsangaben {
  host: string;
  port: number;
  verschluesselung: Verschluesselung;
  /**
   * Ob ein Zertifikat geprüft wird.
   *
   * Aus heißt: Jeder, der sich zwischen Dienst und Verzeichnis setzen kann, liest das
   * Bind-Kennwort mit. Es gibt sie trotzdem, weil interne Verzeichnisse regelmäßig ein
   * selbst ausgestelltes Zertifikat tragen - und ein Betreiber, der die Wahl nicht hat,
   * schaltet sonst auf `einfach` um, und dann ist gar nichts mehr verschlüsselt.
   */
  zertifikatPruefen?: boolean;
  /** Wie lange auf eine Antwort gewartet wird. */
  fristMs?: number;
}

export interface Anmeldung {
  /** Der DN, unter dem angemeldet wird. Leer heißt: anonym. */
  bindDn?: string;
  kennwort?: string;
}

export interface Suchauftrag {
  basis: string;
  /** Vorgebauter Filter - siehe filter.ts. */
  filter: Buffer;
  attribute: string[];
  /** Höchstzahl der Treffer. Der Server darf weniger liefern, nie mehr. */
  grenze?: number;
}

export interface Eintrag {
  dn: string;
  /** Attributname (klein) auf seine Werte. Ein Attribut kann mehrere haben. */
  werte: Record<string, string[]>;
}

export class LdapFehler extends Error {
  constructor(
    message: string,
    /** Der Ergebniscode aus der Antwort, sofern es einen gab. */
    public readonly code?: number,
  ) {
    super(message);
  }
}

/** Die Codes, die man erklären können muss - der Rest kommt als Zahl heraus. */
const CODES: Record<number, string> = {
  1: 'Der Verzeichnisdienst meldet einen internen Fehler.',
  32: 'Den Suchbereich (Basis-DN) gibt es dort nicht.',
  34: 'Der Anmelde-DN ist keine gültige Angabe.',
  48: 'Der Verzeichnisdienst nimmt diese Art der Anmeldung nicht an.',
  49: 'Anmelde-DN oder Kennwort stimmen nicht.',
  50: 'Dieses Konto darf im Verzeichnis nicht suchen.',
  53: 'Der Verzeichnisdienst lehnt die Anfrage ab - oft verlangt er eine verschlüsselte Verbindung.',
};

function erklaere(code: number, text: string): string {
  const bekannt = CODES[code];
  if (bekannt) return text ? `${bekannt} (${text})` : bekannt;
  return text || `Der Verzeichnisdienst antwortet mit Code ${code}.`;
}

const STARTTLS_OID = '1.3.6.1.4.1.1466.20037';

export class LdapVerbindung {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private puffer = Buffer.alloc(0);
  private naechsteNummer = 1;
  /** Wer auf welche Nachrichtennummer wartet. */
  private wartende = new Map<
    number,
    { auf: (element: Element) => void; ab: (fehler: Error) => void; sammeln?: Element[] }
  >();
  private geschlossen = false;

  constructor(private readonly angaben: Verbindungsangaben) {}

  private get frist(): number {
    return this.angaben.fristMs ?? 10_000;
  }

  /** Baut die Verbindung auf - samt StartTLS, wenn es so eingestellt ist. */
  async verbinde(): Promise<void> {
    const { host, port, verschluesselung, zertifikatPruefen } = this.angaben;

    if (verschluesselung === 'ldaps') {
      this.socket = await neueTlsVerbindung({
        host,
        port,
        rejectUnauthorized: zertifikatPruefen !== false,
        servername: host,
      });
    } else {
      this.socket = await neuerSocket(host, port, this.frist);
    }
    this.hoere();

    if (verschluesselung === 'starttls') {
      await this.startTls();
    }
  }

  /**
   * Schaltet eine bestehende Klartextverbindung auf TLS um.
   *
   * Die Reihenfolge ist der Punkt: erst das Umschalten, dann das Anmelden. Andersherum
   * wäre das Kennwort schon durch die Leitung, bevor sie verschlüsselt ist - und ein
   * StartTLS danach macht das nicht ungeschehen.
   */
  private async startTls(): Promise<void> {
    const antwort = await this.sende(
      tlv(anwendung(23), zeichen(STARTTLS_OID, kontext(0, false))),
      anwendung(24),
    );
    const { code, text } = this.leseErgebnis(antwort);
    if (code !== 0) {
      throw new LdapFehler(
        `StartTLS wurde abgelehnt: ${erklaere(code, text)}`,
        code,
      );
    }

    const roh = this.socket as net.Socket;
    /*
     * Vor dem Umschalten die eigenen Behandler abnehmen.
     *
     * Der alte Socket bleibt als Unterlage bestehen, aber ab jetzt fließen die Bytes
     * durch die TLS-Hülle. Bliebe der alte 'data'-Behandler hängen, läse er den
     * verschlüsselten Strom mit und schöbe Unsinn in den Puffer.
     */
    roh.removeAllListeners('data');
    roh.removeAllListeners('error');
    roh.removeAllListeners('close');

    this.socket = await new Promise<tls.TLSSocket>((auf, ab) => {
      const gesichert = tls.connect(
        {
          socket: roh,
          servername: this.angaben.host,
          rejectUnauthorized: this.angaben.zertifikatPruefen !== false,
        },
        () => auf(gesichert),
      );
      gesichert.once('error', ab);
    });
    this.hoere();
  }

  private hoere(): void {
    const socket = this.socket!;
    socket.on('data', (stueck: Buffer) => {
      this.puffer = Buffer.concat([this.puffer, stueck]);
      this.verarbeite();
    });
    socket.on('error', (fehler: Error) => this.brichAlleAb(fehler));
    socket.on('close', () => {
      if (!this.geschlossen) this.brichAlleAb(new LdapFehler('Die Verbindung wurde beendet.'));
    });
  }

  /** Zerlegt, was im Puffer liegt, und ordnet jede Antwort ihrer Anfrage zu. */
  private verarbeite(): void {
    for (;;) {
      let nachricht: Element | null;
      try {
        nachricht = liesElement(this.puffer, 0);
      } catch (fehler) {
        this.brichAlleAb(fehler as Error);
        return;
      }
      if (!nachricht) return;
      this.puffer = this.puffer.subarray(nachricht.gesamt);

      try {
        const teile = liesTeile(nachricht.inhalt);
        const nummer = alsGanzzahl(teile[0]!.inhalt);
        const vorgang = teile[1];
        if (!vorgang) continue;
        const wartend = this.wartende.get(nummer);
        if (!wartend) continue;

        /*
         * Eine Suche antwortet mehrfach: je Treffer ein Eintrag, dann ein Abschluss. Nur
         * der Abschluss löst das Warten auf; alles davor wird gesammelt.
         */
        if (wartend.sammeln && vorgang.kennung !== anwendung(5)) {
          wartend.sammeln.push(vorgang);
          continue;
        }
        this.wartende.delete(nummer);
        wartend.auf(vorgang);
      } catch (fehler) {
        this.brichAlleAb(fehler as Error);
        return;
      }
    }
  }

  private brichAlleAb(fehler: Error): void {
    for (const wartend of this.wartende.values()) wartend.ab(fehler);
    this.wartende.clear();
  }

  /** Schickt einen Vorgang und wartet auf die zugehörige Antwort. */
  private sende(vorgang: Buffer, _erwartet: number, sammeln?: Element[]): Promise<Element> {
    const nummer = this.naechsteNummer++;
    const nachricht = folge(ganzzahl(nummer), vorgang);

    return new Promise<Element>((auf, ab) => {
      const uhr = setTimeout(() => {
        this.wartende.delete(nummer);
        ab(new LdapFehler('Der Verzeichnisdienst hat nicht rechtzeitig geantwortet.'));
      }, this.frist);

      this.wartende.set(nummer, {
        auf: (element) => {
          clearTimeout(uhr);
          auf(element);
        },
        ab: (fehler) => {
          clearTimeout(uhr);
          ab(fehler);
        },
        sammeln,
      });
      this.socket!.write(nachricht);
    });
  }

  /** Liest Ergebniscode und Meldung aus einer Antwort, die mit einem LDAPResult beginnt. */
  private leseErgebnis(antwort: Element): { code: number; text: string } {
    const teile = liesTeile(antwort.inhalt);
    return {
      code: alsGanzzahl(teile[0]?.inhalt ?? Buffer.alloc(1)),
      text: alsText(teile[2]?.inhalt ?? Buffer.alloc(0)),
    };
  }

  /**
   * Meldet sich an.
   *
   * Ohne DN wird anonym gebunden - manche Verzeichnisse lassen das zum Lesen zu. Ein DN
   * ohne Kennwort ist dagegen die berüchtigte "unauthenticated bind": Manche Server
   * antworten darauf mit Erfolg, ohne irgendetwas geprüft zu haben. Deshalb wird es hier
   * gar nicht erst angeboten - wer einen DN einträgt, trägt auch ein Kennwort ein.
   */
  async anmelden(anmeldung: Anmeldung): Promise<void> {
    const dn = anmeldung.bindDn?.trim() ?? '';
    const kennwort = anmeldung.kennwort ?? '';
    if (dn && !kennwort) {
      throw new LdapFehler(
        'Zu einem Anmelde-DN gehört ein Kennwort. Ohne eines melden manche Verzeichnisse ' +
          'erfolgreich an, ohne etwas geprüft zu haben.',
      );
    }

    const antwort = await this.sende(
      tlv(anwendung(0), [
        ganzzahl(3),
        zeichen(dn),
        zeichen(kennwort, kontext(0, false)),
      ]),
      anwendung(1),
    );
    const { code, text } = this.leseErgebnis(antwort);
    if (code !== 0) throw new LdapFehler(erklaere(code, text), code);
  }

  /** Sucht - und gibt zurück, was gefunden wurde. */
  async suche(auftrag: Suchauftrag): Promise<Eintrag[]> {
    const gesammelt: Element[] = [];
    const antwort = await this.sende(
      tlv(anwendung(3), [
        zeichen(auftrag.basis),
        // wholeSubtree: der ganze Baum unterhalb der Basis. Alles andere fände in einer
        // nach Abteilungen gegliederten Struktur genau niemanden.
        aufzaehlung(2),
        // neverDerefAliases - Verweise aufzuloesen ist eine Fehlerquelle ohne Gewinn.
        aufzaehlung(0),
        ganzzahl(auftrag.grenze ?? 50),
        ganzzahl(Math.ceil(this.frist / 1000)),
        wahrheit(false),
        auftrag.filter,
        tlv(KENNUNG.SEQUENCE, auftrag.attribute.map((a) => zeichen(a))),
      ]),
      anwendung(5),
      gesammelt,
    );

    const { code, text } = this.leseErgebnis(antwort);
    /*
     * Code 4 heißt "sizeLimitExceeded" - es gab mehr Treffer als erlaubt.
     *
     * Das ist kein Fehler, sondern die Auskunft, dass die Liste unvollständig ist. Wer
     * hier abbräche, zeigte bei einer Suche nach "Müller" in einem großen Unternehmen gar
     * nichts an, statt der ersten fünfzig.
     */
    if (code !== 0 && code !== 4) throw new LdapFehler(erklaere(code, text), code);

    const eintraege: Eintrag[] = [];
    for (const element of gesammelt) {
      // Verweise auf andere Server (searchResRef) werden übergangen - ihnen zu folgen
      // hieße, eine zweite Verbindung zu einem Rechner aufzubauen, den niemand eingetragen hat.
      if (element.kennung !== anwendung(4)) continue;
      const teile = liesTeile(element.inhalt);
      const werte: Record<string, string[]> = {};
      for (const attribut of liesTeile(teile[1]?.inhalt ?? Buffer.alloc(0))) {
        const [name, menge] = liesTeile(attribut.inhalt);
        if (!name) continue;
        werte[alsText(name.inhalt).toLowerCase()] = liesTeile(menge?.inhalt ?? Buffer.alloc(0)).map(
          (w) => alsText(w.inhalt),
        );
      }
      eintraege.push({ dn: alsText(teile[0]?.inhalt ?? Buffer.alloc(0)), werte });
    }
    return eintraege;
  }

  /** Meldet ab und schließt. Auf eine Antwort wartet niemand - es gibt keine. */
  schliesse(): void {
    if (this.geschlossen) return;
    this.geschlossen = true;
    try {
      const nachricht = folge(ganzzahl(this.naechsteNummer++), tlv(anwendung(2, false), Buffer.alloc(0)));
      this.socket?.write(nachricht);
    } catch {
      // Eine Verbindung, die ohnehin weg ist, muss man nicht ordentlich beenden.
    }
    this.socket?.destroy();
    this.brichAlleAb(new LdapFehler('Die Verbindung wurde beendet.'));
  }
}

function neuerSocket(host: string, port: number, frist: number): Promise<net.Socket> {
  return new Promise((auf, ab) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(frist);
    socket.once('connect', () => {
      socket.setTimeout(0);
      auf(socket);
    });
    socket.once('timeout', () => {
      socket.destroy();
      ab(new LdapFehler(`${host}:${port} antwortet nicht.`));
    });
    socket.once('error', ab);
  });
}

function neueTlsVerbindung(optionen: tls.ConnectionOptions): Promise<tls.TLSSocket> {
  return new Promise((auf, ab) => {
    const socket = tls.connect(optionen, () => auf(socket));
    socket.once('error', ab);
  });
}

/**
 * Der ganze Vorgang: verbinden, anmelden, suchen, schließen.
 *
 * Eine Verbindung je Suche und kein Vorrat gepoolter Verbindungen. Das ist die Abwägung:
 * Ein Nachschlagen im Verzeichnis geschieht, während jemand einen Empfänger tippt - ein
 * paar Mal am Tag, nicht ein paar Mal je Sekunde. Ein Vorrat brächte dafür einen Zustand
 * mit, der über Stunden hinweg falsch sein kann (abgelaufene Sitzung, neu gestartetes
 * Verzeichnis), und dessen Fehler man erst bemerkt, wenn man ihn braucht.
 */
export async function frageVerzeichnis(
  angaben: Verbindungsangaben,
  anmeldung: Anmeldung,
  auftrag: Suchauftrag,
): Promise<Eintrag[]> {
  const verbindung = new LdapVerbindung(angaben);
  try {
    await verbindung.verbinde();
    await verbindung.anmelden(anmeldung);
    return await verbindung.suche(auftrag);
  } finally {
    verbindung.schliesse();
  }
}
