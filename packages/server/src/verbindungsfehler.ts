/**
 * Unterscheidet "kein Netz" von allem anderen.
 *
 * Diese Unterscheidung trägt den ganzen Offline-Betrieb: nur bei einem echten
 * Verbindungsproblem darf aus der Ablage geantwortet werden. Bei einer abgelaufenen
 * Anmeldung, einem gelöschten Ordner oder einem Fehler des Anbieters muss der Fehler
 * durchkommen - sonst zeigte das Programm einen alten Stand und verschwiege, dass
 * etwas nicht stimmt. Man suchte den Grund an der falschen Stelle.
 */

/** Fehlercodes des Betriebssystems, die "die Gegenstelle ist nicht erreichbar" heißen. */
const NETZCODES = new Set([
  'ENOTFOUND', // Name nicht auflösbar - typisch ohne Netz
  'EAI_AGAIN', // Namensauflösung vorübergehend gescheitert
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ETIMEDOUT',
  'EPIPE',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

/**
 * Meldungen, an denen sich ein Verbindungsproblem erkennen lässt, wenn kein Code
 * mitkommt. Bewusst eng gehalten: was hier zu Unrecht zutrifft, verwandelt einen
 * echten Fehler in einen stillen alten Stand.
 */
const NETZTEXTE =
  /(timed?\s?out|timeout|socket\s+closed|connection\s+(closed|lost|reset|refused)|network|getaddrinfo|nicht erreichbar|zeitüberschreitung)/i;

export function istVerbindungsfehler(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; errno?: string; message?: string; authenticationFailed?: boolean };

  // Eine abgelehnte Anmeldung ist kein Netzproblem, auch wenn sie beim Verbinden auffällt.
  if (e.authenticationFailed) return false;

  if (e.code && NETZCODES.has(e.code)) return true;
  if (e.errno && NETZCODES.has(e.errno)) return true;

  return Boolean(e.message && NETZTEXTE.test(e.message));
}
