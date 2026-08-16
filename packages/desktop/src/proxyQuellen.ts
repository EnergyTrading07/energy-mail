import { session } from 'electron';
import { setzeProxyquellen, type Proxyquellen } from '@energy-mail/mail-core';
import { richtlinien } from './richtlinien.js';

/**
 * Woher die Hülle weiß, welcher Proxy gilt.
 *
 * mail-core entscheidet die Reihenfolge (siehe proxy.ts dort), kennt aber keine der
 * Quellen: die Richtliniendatei liegt unter %PROGRAMDATA%, und den Systemproxy kennt nur
 * Chromium. Beides wird hier eingesammelt und hineingereicht.
 *
 * ## Der Systemproxy ist der wichtigste Fall
 *
 * Nicht, weil er der häufigste wäre, sondern weil er der einzige ist, für den niemand
 * etwas tun muss. Ein Firmenrechner ist längst eingerichtet - der Proxy steht in den
 * Windows-Einstellungen oder wird über ein PAC-Skript zugewiesen, und beides hat die IT
 * per Gruppenrichtlinie ausgerollt. `session.resolveProxy()` fragt genau diese Stelle und
 * wertet dabei auch das PAC-Skript aus. Damit funktioniert Energy Mail im Firmennetz
 * ohne eine einzige Einstellung - und das ist der Unterschied zwischen "geht" und "geht
 * nach einem Anruf bei der IT".
 */

/**
 * Übersetzt Chromiums Antwort in eine Adresse.
 *
 * Die Antwort sieht aus wie die Rückgabe eines PAC-Skripts: `DIRECT`,
 * `PROXY 10.0.0.1:8080` oder eine Kette mit Semikolons, deren erste Angabe gilt. Auch
 * `SOCKS5 …` kommt vor. Die Ketten-Alternativen werden bewusst nicht durchprobiert:
 * fällt der erste Proxy aus, ist das ein Fall für die IT und nicht für ein
 * Mailprogramm, das dann stillschweigend einen anderen Weg nimmt.
 */
export function ausChromiumsAntwort(antwort: string): string | undefined {
  for (const glied of antwort.split(';')) {
    const teile = glied.trim().split(/\s+/);
    const art = (teile[0] ?? '').toUpperCase();
    const ziel = teile[1];
    if (art === 'DIRECT') return undefined;
    if (!ziel) continue;

    if (art === 'PROXY' || art === 'HTTP') return `http://${ziel}`;
    if (art === 'HTTPS') return `https://${ziel}`;
    if (art === 'SOCKS' || art === 'SOCKS4') return `socks4://${ziel}`;
    if (art === 'SOCKS5') return `socks5://${ziel}`;
  }
  return undefined;
}

/**
 * Fragt das Betriebssystem, welcher Proxy für einen Rechner gilt.
 *
 * Gefragt wird mit einer https-Adresse, obwohl es um IMAP geht: Chromium beantwortet die
 * Frage nur für Adressen, die es kennt, und ein PAC-Skript entscheidet ohnehin nach dem
 * Rechnernamen. Die Portangabe bleibt weg - ein PAC-Skript, das nach Port unterscheidet,
 * hilft hier nicht weiter, und die Vermutung "wie für Web-Verkehr" ist die richtige.
 */
async function vomSystem(host: string): Promise<string | undefined> {
  try {
    const antwort = await session.defaultSession.resolveProxy(`https://${host}`);
    return ausChromiumsAntwort(antwort);
  } catch {
    // Kein Chromium bereit, kein Netzdienst - dann eben keine Auskunft von hier.
    return undefined;
  }
}

/** Was die Umgebung sagt - für den Fall, dass jemand die Hülle so startet. */
function ausDerUmgebung(): Pick<Proxyquellen, 'umgebung' | 'ausnahmen'> {
  const env = process.env;
  return {
    umgebung:
      env.ENERGY_MAIL_AUSGANGSPROXY ?? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY,
    ausnahmen: env.ENERGY_MAIL_KEIN_PROXY ?? env.NO_PROXY,
  };
}

/**
 * Sammelt alle Quellen für einen Zielrechner.
 *
 * Getrennt vom Einhängen, damit die Diagnose dieselbe Auskunft bekommt wie der
 * Verbindungsaufbau - zwei Wege zur selben Frage liefen früher oder später auseinander,
 * und dann stünde im Fehlerbericht ein anderer Proxy als der, über den es wirklich geht.
 */
export async function quellenFuer(host: string): Promise<Proxyquellen> {
  const r = richtlinien();
  const umgebung = ausDerUmgebung();
  return {
    richtlinie: r.proxy,
    umgebung: umgebung.umgebung,
    system: await vomSystem(host),
    /*
     * Die Ausnahmen der Richtlinie gehen vor denen der Umgebung - nicht zusammengelegt.
     * Eine Vereinigung hieße, dass ein Nutzer die Liste der Organisation um eigene
     * Einträge erweitern kann, und das ist genau das, was eine Vorgabe nicht sein soll.
     */
    ausnahmen: r.keinProxyFuer ?? umgebung.ausnahmen,
  };
}

/** Hängt die Ermittlung in mail-core ein. Einmal beim Start. */
export function richteProxyEin(): void {
  setzeProxyquellen((host) => quellenFuer(host));
}
