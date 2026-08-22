import dns from 'node:dns/promises';
import net from 'node:net';
import { t } from './sprache.js';

/**
 * Wohin dieses Programm eine Verbindung aufbauen darf.
 *
 * ## Warum es das braucht, seit sich Menschen selbst anmelden können
 *
 * Ein Postfach einzurichten heißt: Der Nutzer sagt dem Server, zu welchem Rechner er sich
 * verbinden soll. Solange ein Verwalter jedes Konto anlegte, war das unbedenklich - er
 * gehört zum Betrieb, und wenn er den Server auf eine interne Adresse zeigen lässt, tut er
 * das absichtlich.
 *
 * Bei offener Selbstanmeldung ist es das Gegenteil. Dann darf **jeder Fremde** bestimmen,
 * wohin dieser Server Verbindungen aufbaut - und der Server steht typischerweise in einem
 * Netz, in das der Fremde selbst nicht hineinkommt. Er trägt `192.168.2.1:80` als
 * IMAP-Server ein und liest an der Fehlermeldung ab, ob dort etwas horcht; er probiert
 * `127.0.0.1:8000` und findet den Dienst, der nur lokal gebunden ist; er arbeitet sich
 * durch `169.254.169.254`, wo bei manchen Anbietern die Zugangsdaten der Maschine liegen.
 * Das ist eine Portabtastung des fremden Netzes, ausgeführt vom Server selbst - und aus
 * dessen Sicht kommt sie von innen.
 *
 * Deshalb dieser Riegel. Er ist **standardmäßig aus**: Ein Betrieb mit eigenem Exchange
 * im Haus muss weiterhin auf `mail.firma.local` zeigen dürfen, und dort legt ein Verwalter
 * die Konten an. Eingeschaltet wird er, wo die Nutzer nicht bekannt sind - siehe
 * `nurOeffentlicheMailserver` in registrierungSpeicher.ts.
 *
 * ## Warum die IP geprüft wird und nicht der Name
 *
 * Weil ein Name alles bedeuten kann. `mail.angreifer.example` mit einem A-Eintrag auf
 * `192.168.2.1` sähe in jeder Namensprüfung harmlos aus. Geprüft wird deshalb, was bei der
 * Auflösung herauskommt - und zwar JEDE Adresse, die dabei zurückkommt: Ein Name mit zwei
 * A-Einträgen, einem öffentlichen und einem internen, käme sonst durch.
 */

/** Ob der Riegel gilt. Wird vom Server gesetzt - siehe setzeNetzzielRegel(). */
let nurOeffentlich = false;

export function setzeNetzzielRegel(an: boolean): void {
  nurOeffentlich = an;
}

export function netzzielRegelGilt(): boolean {
  return nurOeffentlich;
}

/**
 * Ob eine IP-Adresse in einem Bereich liegt, der niemandem von außen gehört.
 *
 * Die Liste ist bewusst großzügig. Was hier fehlt, ist ein Weg hinein; was zu viel
 * dasteht, ist höchstens ein Postfachanbieter, den es nicht gibt.
 */
export function istInternesZiel(adresse: string): boolean {
  if (net.isIPv4(adresse)) {
    const teile = adresse.split('.').map(Number);
    const [a, b] = teile as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8 - privat
    if (a === 127) return true; // Loopback
    if (a === 0) return true; // "dieses Netz"
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 - privat
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 - privat
    if (a === 169 && b === 254) return true; // Link-local, dazu der Metadatendienst der Wolke
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 - CGNAT, auch Tailscale
    if (a >= 224) return true; // Multicast und darüber
    return false;
  }

  if (net.isIPv6(adresse)) {
    const k = adresse.toLowerCase();
    if (k === '::1' || k === '::') return true;
    if (k.startsWith('fe80')) return true; // Link-local
    if (k.startsWith('fc') || k.startsWith('fd')) return true; // Unique local
    if (k.startsWith('ff')) return true; // Multicast
    /*
     * Eine IPv4-Adresse in IPv6-Kleidung (::ffff:192.168.2.1) ist derselbe Weg mit
     * anderer Schreibweise - ohne diese Zeile wäre der ganze Riegel mit einem Präfix zu
     * umgehen.
     */
    const eingebettet = k.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (eingebettet) return istInternesZiel(eingebettet[1]!);
    return false;
  }

  // Keine IP-Adresse - dann hat der Aufrufer etwas falsch gemacht, und im Zweifel: nein.
  return true;
}

export class NetzzielFehler extends Error {}

/**
 * Prüft, ob eine Verbindung zu diesem Rechner erlaubt ist - und wirft, wenn nicht.
 *
 * Aufzurufen VOR jedem Verbindungsaufbau zu einem Postfachserver. Ist der Riegel aus,
 * kostet die Funktion einen Vergleich und sonst nichts.
 *
 * Zwischen dieser Prüfung und dem Verbindungsaufbau liegt ein Augenblick, in dem sich der
 * Name auf eine andere Adresse umbiegen ließe (DNS-Rebinding). Das bleibt so und ist hier
 * hinnehmbar: Beide Auflösungen liegen Millisekunden auseinander und gehen durch denselben
 * Zwischenspeicher des Systems. Wer das ausschließen will, müsste die geprüfte IP-Adresse
 * selbst weiterreichen - was bei einem Ziel mit Zertifikatsprüfung eigene Nachteile hat,
 * weil der Name für die Prüfung des Zertifikats gebraucht wird.
 */
export async function pruefeZiel(rechner: string): Promise<void> {
  if (!nurOeffentlich) return;

  const name = rechner.trim().toLowerCase();
  if (!name) throw new NetzzielFehler(t('Ohne Adresse des Servers geht es nicht.'));

  // Eine unmittelbar angegebene IP braucht keine Auflösung.
  if (net.isIP(name)) {
    if (istInternesZiel(name)) throw internesZiel(name);
    return;
  }

  /*
   * `localhost` und alles unter `.local` gehen gar nicht erst in die Auflösung.
   *
   * Nicht aus Misstrauen gegen den Resolver, sondern weil diese Namen je nach Rechner
   * etwas anderes bedeuten - und weil eine Fehlermeldung "localhost ist nicht erlaubt"
   * mehr sagt als "127.0.0.1 ist nicht erlaubt".
   */
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) {
    throw internesZiel(name);
  }

  let adressen: { address: string }[];
  try {
    adressen = await dns.lookup(name, { all: true, verbatim: true });
  } catch (err) {
    throw new NetzzielFehler(
      t('„{rechner}“ ließ sich nicht auflösen: {grund}', {
        rechner,
        grund: (err as Error).message,
      }),
    );
  }

  if (adressen.length === 0) throw internesZiel(name);

  /*
   * JEDE zurückgegebene Adresse muss durchgehen, nicht die erste.
   *
   * Ein Name mit zwei A-Einträgen - einem öffentlichen und einem internen - käme sonst
   * durch, und welchen der beiden die Verbindung dann nimmt, entscheidet der Zufall.
   */
  for (const { address } of adressen) {
    if (istInternesZiel(address)) throw internesZiel(name, address);
  }
}

function internesZiel(rechner: string, adresse?: string): NetzzielFehler {
  return new NetzzielFehler(
    adresse
      ? t('„{rechner}“ zeigt auf {adresse} - eine Adresse im internen Netz. Dieser Dienst verbindet sich nur zu Postfachservern im offenen Netz.', {
          rechner,
          adresse,
        })
      : t('„{rechner}“ ist keine Adresse im offenen Netz. Dieser Dienst verbindet sich nur zu Postfachservern im offenen Netz.', {
          rechner,
        }),
  );
}
