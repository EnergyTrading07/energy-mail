/**
 * Etiketten - farbige Merkmale, die an einer Nachricht hängen.
 *
 * Ordner können eine Nachricht nur an einer Stelle unterbringen. Ein Etikett kann
 * mehrfach hängen: dieselbe Rechnung ist "Steuer" und "Erledigt", ohne dass man sich
 * entscheiden muss. Das ist der Grund, warum jedes größere Mailprogramm so etwas hat.
 *
 * Untergebracht werden sie in IMAP-Schlüsselwörtern, nicht in einer eigenen Datei. Das
 * hat zwei Folgen, die beide zählen: die Etiketten liegen auf dem Server und stehen
 * darum auf jedem Gerät zur Verfügung - und Thunderbird sieht sie ebenfalls, wenn man
 * dessen Namen verwendet.
 *
 * Thunderbird legt seine fünf eingebauten Etiketten unter "$label1" bis "$label5" ab.
 * Wer diese Namen benutzt, dessen Etiketten erscheinen dort ohne weiteres Zutun - und
 * umgekehrt. Deshalb sind unsere fünf ersten genau diese, mit denselben Farben.
 *
 * Zwei Dinge gehen dabei nicht, und beide muss man wissen:
 *
 *   - Nicht jeder Server nimmt eigene Schlüsselwörter an. Ob er es tut, sagt er beim
 *     Öffnen des Ordners in PERMANENTFLAGS; steht dort kein "\*", verschwindet das
 *     Etikett beim nächsten Öffnen wieder. Siehe nimmtEtikettenAn().
 *   - Ein Schlüsselwort ist ein IMAP-"atom" und verträgt weder Leerzeichen noch
 *     Umlaute. Der angezeigte Name darf beides; dafür gibt es den Schlüssel.
 */

export interface Etikett {
  /** Das IMAP-Schlüsselwort. Steht so auf dem Server und in Thunderbird. */
  schluessel: string;
  /** Was der Mensch sieht. Darf Leerzeichen und Umlaute enthalten. */
  name: string;
  /** Farbe als Hexwert. */
  farbe: string;
}

/**
 * Die fünf von Thunderbird. Namen und Farben stimmen mit dessen Voreinstellung überein,
 * damit dieselbe Nachricht dort dasselbe Etikett trägt.
 */
export const STANDARD_ETIKETTEN: Etikett[] = [
  { schluessel: '$label1', name: 'Wichtig', farbe: '#dc2626' },
  { schluessel: '$label2', name: 'Arbeit', farbe: '#ea580c' },
  { schluessel: '$label3', name: 'Persönlich', farbe: '#16a34a' },
  { schluessel: '$label4', name: 'Zu erledigen', farbe: '#2563eb' },
  { schluessel: '$label5', name: 'Später', farbe: '#9333ea' },
];

/**
 * Flags, die das Programm selbst deutet und die darum kein Etikett sind.
 *
 * "$Forwarded", "$MDNSent" und Verwandte setzen andere Programme; sie stehen für einen
 * Vorgang, nicht für eine Einordnung durch den Nutzer. Als Etikett angezeigt wären sie
 * nur Rauschen. "$MailFlagBit..." ist die Farbmarkierung von Apple Mail - die kann man
 * nicht sinnvoll übersetzen, weil sie nur Zahlen und keine Namen kennt.
 */
const KEINE_ETIKETTEN = new Set([
  '$forwarded',
  '$mdnsent',
  '$submitted',
  '$junk',
  '$notjunk',
  'junk',
  'nonjunk',
  '$phishing',
  '$hasattachment',
  '$hasnoattachment',
  '$mailflagbit0',
  '$mailflagbit1',
  '$mailflagbit2',
]);

/** Ob ein Flag ein Etikett sein kann - kein Systemflag, kein Vorgangsvermerk. */
export function istEtikett(flag: string): boolean {
  // Systemflags beginnen mit einem Rückwärtsschrägstrich: \Seen, \Flagged, \Deleted ...
  if (flag.startsWith('\\')) return false;
  return !KEINE_ETIKETTEN.has(flag.toLowerCase());
}

/**
 * Sagt, ob der Ordner eigene Schlüsselwörter dauerhaft behält.
 *
 * IMAP nennt in PERMANENTFLAGS, was beim Schließen erhalten bleibt. Das "\*" darin heißt
 * "auch alles Weitere, was ihr euch ausdenkt". Fehlt es, nimmt der Server das STORE zwar
 * an - beim nächsten Öffnen ist das Etikett aber weg. Ein Fehler wird dabei nicht
 * gemeldet, und genau deshalb muss vorher gefragt werden.
 */
export function nimmtEtikettenAn(permanentFlags: readonly string[] | undefined): boolean {
  if (!permanentFlags) return false;
  return permanentFlags.some((f) => f === '\\*');
}

/** Umlaute so ersetzen, wie man sie im Deutschen ausschreibt. */
const UMSCHRIFT: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  à: 'a',
  á: 'a',
  â: 'a',
  è: 'e',
  é: 'e',
  ê: 'e',
  ì: 'i',
  í: 'i',
  ò: 'o',
  ó: 'o',
  ô: 'o',
  ù: 'u',
  ú: 'u',
  ñ: 'n',
  ç: 'c',
};

/**
 * Bildet aus einem Namen ein Schlüsselwort, das IMAP annimmt.
 *
 * Ein "atom" verträgt weder Leerzeichen noch Klammern, Anführungszeichen oder
 * Rückwärtsschrägstriche, und bei Zeichen jenseits von ASCII weisen manche Server die
 * Anfrage rundheraus ab. Übrig bleiben Buchstaben, Ziffern und ein paar Satzzeichen.
 *
 * Der angezeigte Name bleibt davon unberührt - "Zu erledigen" heißt weiter so und liegt
 * nur unter "zu_erledigen" auf dem Server.
 */
export function schluesselFuer(name: string, vergeben: readonly string[] = []): string {
  const umgeschrieben = [...name.toLowerCase()]
    .map((z) => UMSCHRIFT[z] ?? z)
    .join('')
    // Zusammengesetzte Zeichen zerlegen und die Zeichen darüber wegnehmen (é -> e).
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  const roh = umgeschrieben
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  // Etwas muss dastehen, und es darf nicht mit einer Ziffer beginnen: manche Server
  // deuten ein Schlüsselwort, das wie eine Zahl aussieht, als Nachrichtennummer.
  const grund = roh && !/^\d/.test(roh) ? roh : `etikett_${roh || 'neu'}`;

  const belegt = new Set(vergeben.map((s) => s.toLowerCase()));
  if (!belegt.has(grund)) return grund;

  for (let i = 2; i < 1000; i++) {
    const versuch = `${grund}_${i}`;
    if (!belegt.has(versuch)) return versuch;
  }
  // Praktisch unerreichbar; ohne diesen Zweig gäbe die Schleife undefined zurück.
  return `${grund}_${Date.now()}`;
}

/**
 * Übersetzt die Flags einer Nachricht in Etiketten.
 *
 * Was das Programm nicht kennt, wird nicht verschwiegen: ein Schlüsselwort, das
 * Thunderbird oder ein Telefon gesetzt hat, erscheint mit seinem eigenen Namen und in
 * Grau. Ausblenden wäre die schlechtere Wahl - dann verlöre man beim Bearbeiten still,
 * was ein anderes Programm angelegt hat.
 */
export function etikettenAusFlags(
  flags: readonly string[],
  bekannte: readonly Etikett[],
): Etikett[] {
  const nachSchluessel = new Map(bekannte.map((e) => [e.schluessel.toLowerCase(), e]));

  return flags
    .filter(istEtikett)
    .map(
      (flag) =>
        nachSchluessel.get(flag.toLowerCase()) ?? {
          schluessel: flag,
          // Der nackte Schlüssel ist als Name besser als gar nichts - er zeigt
          // wenigstens, dass da etwas hängt.
          name: flag.replace(/^\$/, ''),
          farbe: '#6b7280',
        },
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));
}

/**
 * Prüft einen Namen, bevor er angelegt wird. Gibt den Grund zurück, wenn er nicht taugt,
 * sonst null.
 */
export function pruefeEtikettName(
  name: string,
  vorhandene: readonly Etikett[],
  ausser?: string,
): string | null {
  const sauber = name.trim();
  if (!sauber) return 'Das Etikett braucht einen Namen.';
  if (sauber.length > 40) return 'Der Name ist zu lang - höchstens 40 Zeichen.';

  const doppelt = vorhandene.some(
    (e) =>
      e.schluessel !== ausser &&
      e.name.localeCompare(sauber, 'de', { sensitivity: 'base' }) === 0,
  );
  if (doppelt) return `„${sauber}“ gibt es schon.`;

  return null;
}

/**
 * Beschreibt eine Suche in einem Satz - für die Liste der gemerkten Suchen, damit man
 * nicht erst hineinsehen muss, um zu wissen, was eine tut.
 *
 * Hier und nicht in der Oberfläche, weil der Server dieselbe Beschreibung braucht und
 * zwei Fassungen davon unweigerlich auseinanderliefen.
 */
export function beschreibeSuche(
  kriterien: {
    text?: string;
    from?: string;
    subject?: string;
    since?: string;
    before?: string;
    unreadOnly?: boolean;
    withAttachment?: boolean;
    etikett?: string;
    category?: string;
  },
  /** Etiketten, um das Schlüsselwort durch seinen Namen zu ersetzen. */
  bekannte: readonly Etikett[] = [],
): string {
  const etikettName = kriterien.etikett
    ? (bekannte.find((e) => e.schluessel.toLowerCase() === kriterien.etikett!.toLowerCase())
        ?.name ?? kriterien.etikett)
    : undefined;

  const teile = [
    kriterien.text && `„${kriterien.text}“`,
    kriterien.from && `von ${kriterien.from}`,
    kriterien.subject && `Betreff ${kriterien.subject}`,
    etikettName && `Etikett ${etikettName}`,
    kriterien.unreadOnly && 'nur ungelesen',
    kriterien.withAttachment && 'mit Anhang',
    kriterien.category && `Kategorie ${kriterien.category}`,
    kriterien.since && `ab ${kriterien.since}`,
    kriterien.before && `bis ${kriterien.before}`,
  ].filter(Boolean);

  return teile.join(' · ') || 'alles';
}
