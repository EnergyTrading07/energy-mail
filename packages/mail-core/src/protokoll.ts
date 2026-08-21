/**
 * Was in ein Protokoll darf - und was nicht.
 *
 * Ein Fehlerbericht ist nur dann brauchbar, wenn man ihn verschicken kann, ohne vorher
 * jede Zeile zu lesen. Hier steht deshalb, was vorher herausgenommen wird: Kennwörter,
 * Zugangsmarken, der Inhalt von Nachrichten und Mailadressen.
 *
 * Bewusst großzügig: lieber einmal zu viel ersetzt als ein Kennwort im Bericht. Ein
 * unkenntlich gemachter Wert sagt immer noch, dass an dieser Stelle einer stand - und
 * das ist beim Suchen fast so hilfreich wie der Wert selbst.
 *
 * Getrennt von allem anderen, weil es sich prüfen lassen muss: dass ein Kennwort im
 * Protokoll steht, fällt keinem auf, der nicht gezielt danach sucht.
 */

/** Steht anstelle dessen, was herausgenommen wurde. */
export const UNKENNTLICH = '[entfernt]';

/**
 * Die Regeln, in der Reihenfolge ihrer Anwendung.
 *
 * Jede beschreibt eine Form, in der ein Geheimnis in einer Protokollzeile auftauchen
 * kann. Die Reihenfolge ist nicht gleichgültig: die spezifischen zuerst, sonst frisst
 * eine allgemeine Regel den Zusammenhang weg, an dem man den Fall erkennt.
 */
const REGELN: { was: string; muster: RegExp; ersatz: string }[] = [
  // "password": "geheim" / pass=geheim / passwort: geheim - in JSON wie in Text.
  {
    was: 'Kennwort',
    muster: /("?(?:password|passwort|pass|pw|secret|geheim|kennwort)"?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    ersatz: `$1${UNKENNTLICH}`,
  },
  // Authorization: Bearer xxx / Basic xxx
  {
    was: 'Anmeldekopfzeile',
    muster: /(authorization"?\s*[:=]\s*"?)(bearer|basic)\s+\S+/gi,
    ersatz: `$1$2 ${UNKENNTLICH}`,
  },
  // "access_token": "ya29...." und die Verwandten.
  {
    was: 'Zugangsmarke',
    muster:
      /("?(?:access_token|refresh_token|id_token|client_secret|token|apikey|api_key)"?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    ersatz: `$1${UNKENNTLICH}`,
  },
  // Marken von Google und Microsoft, auch wenn sie ohne Feldnamen dastehen.
  { was: 'Google-Marke', muster: /\bya29\.[\w.-]{10,}/g, ersatz: UNKENNTLICH },
  { was: 'JSON Web Token', muster: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, ersatz: UNKENNTLICH },
  // Die IMAP-Anmeldung im Klartext, wie sie in einem Mitschnitt stünde.
  {
    was: 'IMAP-Anmeldung',
    muster: /\b(LOGIN|AUTHENTICATE)\s+\S+(\s+\S+)?/gi,
    ersatz: `$1 ${UNKENNTLICH}`,
  },
  /*
   * Das Zugangsgeheimnis des lokalen Servers - in beiden Formen, in denen es vorkommt.
   *
   * Es stand vorher ungeschützt im Protokoll, und zwar auf dem Weg, den niemand vermutet:
   * die Oberfläche kann bei einem WebSocket keine Kopfzeile setzen und hängt es deshalb
   * als "?zugang=..." an die Adresse (useMailEvents.ts). Fastify protokolliert von jeder
   * Anfrage die Adresse mitsamt Abfrageteil - also landete das Geheimnis bei jedem
   * Verbindungsaufbau im Klartext in der Datei.
   *
   * Schwerer als die Datei selbst wiegt der Fehlerbericht: diagnose.ts fragt vor dem
   * Schreiben enthaeltGeheimnisse() und gibt den Bericht frei, wenn nichts gefunden wird.
   * Ohne diese Regel lautete die Antwort "nichts gefunden" - und der Nutzer verschickte
   * den Schlüssel zu seinem eigenen Postfachdienst im guten Glauben mit.
   *
   * Muss VOR der Mailadressen-Regel stehen, damit der Name der Kopfzeile erhalten
   * bleibt: an "x-energy-mail-zugang: [entfernt]" sieht man beim Suchen noch, worum es
   * ging.
   */
  {
    was: 'Zugangsgeheimnis',
    muster: /([?&]zugang=)[^&\s"'&]+/gi,
    ersatz: `$1${UNKENNTLICH}`,
  },
  {
    was: 'Zugangsgeheimnis',
    muster: /("?x-energy-mail-zugang"?\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi,
    ersatz: `$1${UNKENNTLICH}`,
  },
  /*
   * Die Anmeldung in einer Adresse: "http://anna:geheim@proxy.firma.de:3128".
   *
   * So wird ein Proxy angegeben, und in einem Unternehmen ist das Proxy-Kennwort oft
   * dasselbe wie das Windows-Kennwort. Die Regeln oben greifen hier nicht - es steht
   * kein "password=" davor, sondern ein Doppelpunkt mitten in einer Adresse.
   *
   * Der Rechnername bleibt stehen: "es klemmt an proxy.firma.de" ist die Auskunft, um
   * die es im Fehlerbericht geht.
   */
  {
    was: 'Anmeldung in einer Adresse',
    muster: /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    ersatz: `$1${UNKENNTLICH}@`,
  },
  // Ein privater Schlüssel darf unter keinen Umständen mitgehen.
  {
    was: 'privater Schlüssel',
    muster: /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----/g,
    ersatz: UNKENNTLICH,
  },
  /*
   * Was jemand in seinem eigenen Postfach sucht.
   *
   * Der lauteste Fund bei der Durchsicht, und der unauffälligste: Fastify protokolliert
   * von jeder Anfrage die Adresse SAMT Abfrageteil, und die Suche des Nutzers steht dort
   * als "GET /search?q=...". Damit lag in der Datei, die "Fehlerbericht erzeugen" zum
   * Verschicken anbietet, eine Liste dessen, wonach jemand in seiner eigenen Post gesucht
   * hat - "Kündigung", "Befund", "Anwalt". Das ist keine Randnotiz: ein Suchbegriff sagt
   * oft mehr über einen Menschen aus als die Nachricht, die er findet.
   *
   * Der Name des Feldes bleibt stehen. "q=[entfernt]" sagt beim Suchen alles, was
   * gebraucht wird - nämlich dass gesucht wurde und die Anfrage bis hierher kam.
   *
   * Die Aufzählung deckt jeden Abfrageteil ab, über den in dieser Anwendung Inhalt
   * geht (siehe die Routen in server/src/app.ts). Beim Ergänzen einer Route mit einem
   * neuen inhaltstragenden Feld gehört es hier dazu.
   */
  {
    was: 'Suchbegriff',
    muster:
      /([?&](?:q|suche|search|query|filter|betreff|subject|text|von|an|email|adresse|address|name)=)[^&\s"'`]*/gi,
    ersatz: `$1${UNKENNTLICH}`,
  },
  /*
   * Eine Mailadresse, wie sie in einer Adresse steht: prozentkodiert.
   *
   * Muss VOR der gewöhnlichen Regel stehen und ist keine Doppelung von ihr - die kennt
   * nur das wörtliche "@" und ging deshalb an "/adressbuch/max%40beispiel.de" vorbei. Und
   * genau so steht es im Protokoll: die Adresse ist Teil des Pfades bei
   * /adressbuch/:adresse und /accounts/:id/vertraute-absender/:adresse, also bei jedem
   * Löschen eines Kontakts und jedem Entziehen des Vertrauens. Gemessen an der
   * gewöhnlichen Regel eine Kleinigkeit; für die Zusicherung "Mailadressen wurden
   * herausgenommen" der Unterschied zwischen wahr und unwahr.
   */
  {
    was: 'Mailadresse',
    muster: /\b[A-Za-z0-9._+-]+(%40[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    ersatz: `${UNKENNTLICH}$1`,
  },
  /*
   * Mailadressen zuletzt, und nur der Teil vor dem @.
   *
   * Der Anbieter bleibt stehen, weil er beim Suchen zählt: "es klemmt bei gmx" ist eine
   * Auskunft, "es klemmt bei [entfernt]" ist keine.
   */
  {
    was: 'Mailadresse',
    muster: /\b[A-Za-z0-9._%+-]+(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    ersatz: `${UNKENNTLICH}$1`,
  },
];

/**
 * Nimmt aus einem Text heraus, was nicht in einen Fehlerbericht gehört.
 *
 * Arbeitet auf beliebigem Text, nicht nur auf einzelnen Zeilen - ein privater Schlüssel
 * geht über viele Zeilen, und ein abgebrochener Aufruf bringt seine Angaben oft in einem
 * Stück mit.
 */
export function saeubere(text: string): string {
  let rein = text;
  for (const regel of REGELN) rein = rein.replace(regel.muster, regel.ersatz);
  return rein;
}

/**
 * Ob in einem Text noch etwas steht, das nach einem Geheimnis aussieht.
 *
 * Für die Prüfung des fertigen Berichts, kurz bevor er auf der Platte landet. Findet
 * naturgemäß nicht alles - aber was die Regeln oben kennen, darf hinterher nicht mehr
 * drinstehen.
 */
export function enthaeltGeheimnisse(text: string): string[] {
  const gefunden: string[] = [];
  for (const regel of REGELN) {
    // Eigene Instanz: die Regeln tragen /g und damit einen Suchzeiger, der sonst
    // zwischen den Aufrufen stehen bliebe.
    const muster = new RegExp(regel.muster.source, regel.muster.flags);
    const treffer = muster.exec(text);
    if (!treffer) continue;
    // Was die Regel selbst schon ersetzt hat, zählt nicht als Fund.
    if (treffer[0].includes(UNKENNTLICH)) continue;
    gefunden.push(regel.was);
  }
  return gefunden;
}

/**
 * Kürzt eine IP-Adresse auf das, was zum Nachvollziehen genügt.
 *
 * Eine IP-Adresse benennt einen Anschluss, und damit im Zweifel einen Menschen. Ins
 * Protokoll gehört sie trotzdem: ohne sie lässt sich nicht unterscheiden, ob zehn
 * Fehlversuche von einem vergesslichen Nutzer stammen oder von zehn Rechnern, die ein
 * Kennwort durchprobieren. Genau diese Unterscheidung überlebt das Kürzen - das Netz
 * bleibt stehen, der einzelne Anschluss verschwindet.
 *
 * Dasselbe Maß, das auch Web-Statistiken verwenden: bei IPv4 fällt das letzte Achtel weg,
 * bei IPv6 alles ab dem fünften Block.
 *
 * Nicht in REGELN, sondern hier zum Aufrufen: eine allgemeine Regel über alle
 * Protokollzeilen träfe auch die Adressen von Postfachservern in Verbindungsfehlern - und
 * "verbunden mit [entfernt]" hilft bei der Fehlersuche niemandem.
 */
export function kuerzeIpAdresse(adresse: string): string {
  const roh = adresse.trim();
  // "::ffff:203.0.113.7" - IPv4 in IPv6-Schreibweise, wie sie ein doppelt lauschender
  // Server liefert. Nach der IPv4-Regel behandeln, sonst bliebe sie ungekürzt stehen.
  const eingebettet = roh.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  const v4 = (eingebettet ?? roh).match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
  if (v4) return `${v4[1]}.x`;
  if (roh.includes(':')) {
    const bloecke = roh.split(':').slice(0, 4).join(':');
    return `${bloecke}::x`;
  }
  // Weder das eine noch das andere - dann lieber gar nichts als etwas Unbekanntes.
  return UNKENNTLICH;
}

// --- Aufbau einer Protokollzeile -------------------------------------------------

export type Stufe = 'info' | 'warnung' | 'fehler';

/**
 * Eine Zeile im Protokoll.
 *
 * Feste Form, damit sich die Datei überfliegen lässt: Zeitpunkt, Stufe, Herkunft, Text.
 * Der Zeitpunkt in ISO-Form und nicht in deutscher Schreibweise - beim Vergleich mit
 * dem, was ein Nutzer berichtet ("gegen halb drei"), zählt die Eindeutigkeit mehr als
 * die Lesbarkeit.
 */
export function baueZeile(
  zeitpunkt: Date,
  stufe: Stufe,
  herkunft: string,
  text: string,
): string {
  // Alle drei gleich lang, damit die Spalten untereinander stehen.
  const marke = { info: 'INFO', warnung: 'WARN', fehler: 'FEHL' }[stufe];
  // Zeilenumbrüche im Text einrücken, damit eine mehrzeilige Meldung als eine Einheit
  // erkennbar bleibt und nicht wie mehrere Einträge aussieht.
  const eingerueckt = saeubere(text).replace(/\r?\n/g, '\n        ');
  return `${zeitpunkt.toISOString()} ${marke} [${herkunft}] ${eingerueckt}`;
}
