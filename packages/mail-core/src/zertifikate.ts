import tls from 'node:tls';

/**
 * Die Zertifikate, denen beim Verbinden geglaubt wird.
 *
 * Node bringt eine eigene Liste von Wurzelzertifikaten mit und benutzt AUSSCHLIESSLICH
 * die - den Zertifikatsspeicher von Windows sieht es nicht an. Für ein Programm auf einem
 * privaten Rechner fällt das nie auf. In einem Firmennetz ist es der Unterschied zwischen
 * "läuft" und "läuft nicht":
 *
 * Nahezu jedes Unternehmen führt seinen Netzverkehr über einen prüfenden Vorbau
 * (Zscaler, Fortinet, Sophos, Palo Alto). Der bricht TLS auf und stellt das Zertifikat
 * selbst aus, unterschrieben mit einer firmeneigenen Wurzel, die per Gruppenrichtlinie in
 * jedem Windows-Zertifikatsspeicher liegt. Outlook und Thunderbird kennen sie darüber und
 * verbinden sich anstandslos - Energy Mail kannte sie nicht und brach jede IMAP- und
 * SMTP-Verbindung mit "self-signed certificate in certificate chain" ab. Für den Nutzer
 * sähe das aus wie ein kaputtes Programm, und für den Administrator gäbe es nichts, was
 * er hätte einstellen können.
 *
 * Gemessen auf diesem Rechner: 120 mitgelieferte Wurzeln gegen 183 im Windows-Speicher.
 *
 * ## Warum die Vereinigung und nicht nur der Systemspeicher
 *
 * Weil nichts aufhören soll zu funktionieren, was heute geht. Ein schmal gehaltener
 * Windows-Speicher - manche Unternehmen räumen ihn per Richtlinie aus - würde sonst
 * Postfachanbieter aussperren, die vorher erreichbar waren.
 *
 * ## Was das kostet, ehrlich gesagt
 *
 * Dem Windows-Speicher zu glauben heißt: wer dort eine Wurzel einträgt, kann mitlesen.
 * Das kann ein Administrator - der darf es, es ist sein Rechner -, und das kann Schadcode
 * mit Administratorrechten. Wer aber so weit ist, kommt ohnehin an die abgelegten
 * Zugangsdaten. Der Zugewinn an Brauchbarkeit steht hier gegen einen Verlust, der auf
 * einem übernommenen Rechner ohnehin schon eingetreten ist. Dieselbe Abwägung treffen
 * Outlook, Chrome und Edge, und zwar seit jeher.
 *
 * Wer sie anders treffen will, setzt `ENERGY_MAIL_SYSTEM_ZERTIFIKATE=nein`.
 */

/** Was beim Einrichten herauskam - für die Zeile im Protokoll. */
export interface Zertifikatsbefund {
  /** Wurzeln, die Node von sich aus mitbringt. */
  mitgeliefert: number;
  /** Wurzeln aus dem Speicher des Betriebssystems. */
  ausDemSystem: number;
  /** Wie viele davon Node noch nicht kannte - die eigentliche Auskunft. */
  hinzugekommen: number;
  /** Ob tatsächlich umgestellt wurde. */
  angewendet: boolean;
  /** Wenn nicht: warum. */
  grund?: string;
}

/**
 * Nimmt den Zertifikatsspeicher des Betriebssystems dazu.
 *
 * Muss laufen, BEVOR die erste Verbindung aufgebaut wird - eine bereits offene
 * TLS-Verbindung stellt sich davon nicht um.
 *
 * Wirft nie. Schlägt es fehl, bleibt es bei Nodes eigener Liste: dann sind manche Netze
 * nicht erreichbar, aber das Programm läuft. Ein Absturz beim Start wäre die schlechtere
 * Antwort.
 */
export function nutzeSystemZertifikate(): Zertifikatsbefund {
  const befund: Zertifikatsbefund = {
    mitgeliefert: 0,
    ausDemSystem: 0,
    hinzugekommen: 0,
    angewendet: false,
  };

  const wunsch = (process.env.ENERGY_MAIL_SYSTEM_ZERTIFIKATE ?? '').trim().toLowerCase();
  if (wunsch === 'nein' || wunsch === 'aus' || wunsch === '0' || wunsch === 'false') {
    befund.grund = 'per ENERGY_MAIL_SYSTEM_ZERTIFIKATE abgeschaltet';
    return (letzter = befund);
  }

  /*
   * Beides gibt es erst ab Node 22.15 bzw. 24. Electron 43 bringt Node 24.18 mit, aber
   * der Server läuft auch als reiner Node-Prozess (Standalone-Betrieb, siehe BETRIEB.md),
   * und dort bestimmt der Betreiber die Fassung.
   */
  if (
    typeof tls.getCACertificates !== 'function' ||
    typeof tls.setDefaultCACertificates !== 'function'
  ) {
    befund.grund = `Node ${process.versions.node} kennt den Systemspeicher noch nicht`;
    return (letzter = befund);
  }

  try {
    const mitgeliefert = tls.getCACertificates('bundled');
    const ausDemSystem = tls.getCACertificates('system');
    befund.mitgeliefert = mitgeliefert.length;
    befund.ausDemSystem = ausDemSystem.length;

    // Doppelte heraus: die großen öffentlichen Wurzeln stehen in beiden Listen, und ein
    // Zertifikat zweimal zu prüfen kostet bei jedem Verbindungsaufbau Zeit.
    const alle = new Set<string>([...mitgeliefert, ...ausDemSystem]);
    befund.hinzugekommen = alle.size - mitgeliefert.length;

    tls.setDefaultCACertificates([...alle]);
    befund.angewendet = true;
  } catch (err) {
    befund.grund = (err as Error).message;
  }
  return (letzter = befund);
}

/**
 * Was beim Start herauskam - für den Fehlerbericht.
 *
 * Aufgehoben statt neu ermittelt: nutzeSystemZertifikate() erneut zu rufen wäre zwar
 * unschädlich, aber es SETZT dabei etwas, und eine Berichtszeile hat nichts zu setzen.
 * Wurde noch nichts eingerichtet, sagt der Befund genau das.
 */
let letzter: Zertifikatsbefund = {
  mitgeliefert: 0,
  ausDemSystem: 0,
  hinzugekommen: 0,
  angewendet: false,
  grund: 'noch nicht eingerichtet',
};

export function letzterZertifikatsbefund(): Zertifikatsbefund {
  return letzter;
}

/** Eine Zeile für das Protokoll - damit im Fehlerbericht steht, was hier gilt. */
export function beschreibeZertifikate(befund: Zertifikatsbefund): string {
  if (!befund.angewendet) {
    return `Zertifikate: nur die mitgelieferten (${befund.grund ?? 'unbekannter Grund'}).`;
  }
  return (
    `Zertifikate: ${befund.mitgeliefert} mitgelieferte + ${befund.hinzugekommen} aus dem ` +
    `Systemspeicher (${befund.ausDemSystem} dort insgesamt).`
  );
}
