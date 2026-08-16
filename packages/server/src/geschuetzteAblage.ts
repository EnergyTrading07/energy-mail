import { liesJson, schreibeAtomar, type Lesebefund } from './atomar.js';
import { decryptSecret, encryptSecret, isEncryptionAvailable } from './secretCrypto.js';

/**
 * Die Dateien, in denen Post steht - verschlüsselt abgelegt.
 *
 * Bis hierher galt eine Trennung, die DATENSCHUTZ.md offen benannte und die trotzdem an
 * der falschen Stelle lag: verschlüsselt waren die *Zugangsdaten*, nicht das, wofür man
 * sie braucht. `contacts.json` enthält Namen und Adressen aller Korrespondenzpartner -
 * Daten von Menschen, die nie gefragt wurden. In `sendungen.json` liegt der volle Text
 * wartender Nachrichten samt Anhängen. In `cache.json` stehen Betreffzeilen, in
 * `suchen.json` steht, wonach jemand gesucht hat, und `regeln.json` führt die Adressen
 * auf, auf die jemand reagiert. Wer den Benutzerordner kopierte, konnte alles davon
 * lesen; das Kennwort brauchte er dafür nicht.
 *
 * Diese Speicher haben alle dieselbe Eigenschaft, und deshalb ist es hier billig zu
 * haben: sie werden vollständig in den Speicher gelesen und vollständig zurückgeschrieben.
 * Es gibt nichts zu suchen und nichts zu sortieren, was die Verschlüsselung stören
 * könnte - anders als beim Nachrichtenbestand in ablage.db, wo genau das der
 * Streitpunkt ist (siehe lokaleAblage.ts).
 *
 * ## Was das schützt und was nicht
 *
 * Der Schlüssel hängt über safeStorage am Windows-Benutzerkonto. Damit ist geschützt:
 * eine kopierte `%APPDATA%`, eine ausgebaute Platte, eine Sicherung, ein zweiter Zugang
 * auf demselben Rechner. Nicht geschützt: wer an der entsperrten Sitzung sitzt oder ein
 * Programm unter diesem Konto laufen lässt - dem entschlüsselt Windows genauso wie der
 * Anwendung. Das ist derselbe Schutz, den die Zugangsdaten seit jeher haben, und mehr
 * verspricht auch DATENSCHUTZ.md nicht.
 *
 * ## Warum nicht alles
 *
 * `nutzer.json`, `sitzungen.json` und die Schlüsselhüllen bleiben außen vor, und zwar
 * zwingend: aus ihnen wird der Schlüssel erst gewonnen, mit dem hier verschlüsselt wird.
 * `accounts.json` bleibt ebenfalls, weil die Geheimnisse darin bereits einzeln
 * verschlüsselt sind - übrig bliebe die eigene Mailadresse, und dafür ist die Datei zu
 * dicht am Start, um sie anzufassen.
 */

/**
 * Woran eine verschlüsselte Datei zu erkennen ist.
 *
 * Das Format aus secretCrypto.ts: "v1.iv.tag.daten" oder "v2....". JSON fängt nie so an -
 * ein Zusammenstoß ist ausgeschlossen, und darauf beruht der Umstieg unten.
 */
const VERSCHLUESSELT = /^v[12]\./;

/** Ob eine Datei nach einem Geheimnis aussieht und nicht nach JSON. */
export function istVerschluesselt(roh: string): boolean {
  return VERSCHLUESSELT.test(roh.trimStart());
}

/**
 * Liest einen geschützten Speicher.
 *
 * Nimmt beides an: was schon verschlüsselt ist, und was aus einer Installation von vor
 * dieser Umstellung im Klartext dasteht. Ein Zwangsdurchlauf über alle Dateien wäre ein
 * Vorgang, bei dem viel schiefgehen kann - der Umstieg stellt sich von selbst ein, sobald
 * eine Datei ohnehin neu geschrieben wird. Dasselbe Verfahren wie bei den Geheimnissen
 * in secretCrypto.ts, und aus demselben Grund.
 *
 * Der Klartext bleibt bis dahin also lesbar. Das ist keine halbe Sache, sondern der
 * einzige Weg, der ohne Datenverlust auskommt: eine Datei, die sich nicht entschlüsseln
 * lässt, ist sonst eine verlorene Datei.
 */
export function liesGeschuetzt<T>(pfad: string, standard: T): Lesebefund<T> {
  let warKlartext = false;
  const befund = liesJson<T>(pfad, standard, (roh) => {
    if (istVerschluesselt(roh)) return decryptSecret(roh.trim());
    warKlartext = true;
    return roh;
  });

  /*
   * Klartext beim Lesen gleich ersetzen.
   *
   * Hier stand zuerst nur "wird beim nächsten Schreiben verschlüsselt" - und beim ersten
   * Start nach der Umstellung war zu sehen, wie wenig das taugt: contacts.json und
   * cache.json waren sofort verschlüsselt, weil sie ohnehin dauernd geschrieben werden,
   * regeln.json und etiketten.json standen weiter im Klartext da. Die werden nur
   * geschrieben, wenn jemand eine Regel ändert - also womöglich nie. Eine Umstellung, die
   * ausgerechnet die selten angefassten Dateien auslässt, ist keine.
   *
   * Ein Fehlschlag bleibt folgenlos: gelesen ist gelesen, und beim nächsten Mal wird es
   * erneut versucht. Deshalb ohne Meldung - eine Warnung bei jedem Lesevorgang wäre
   * lauter als der Anlass.
   */
  if (warKlartext && isEncryptionAvailable() && !befund.beschaedigt) {
    try {
      schreibeGeschuetzt(pfad, JSON.stringify(befund.wert));
    } catch {
      // Kein Platz, keine Rechte, Datei gerade gesperrt - dann eben beim nächsten Lesen.
    }
  }
  return befund;
}

/**
 * Schreibt einen geschützten Speicher - atomar wie zuvor, nur verschlüsselt.
 *
 * Ist keine Verschlüsselung eingerichtet, wird wie bisher Klartext geschrieben. Das
 * betrifft Werkzeuge, Prüfungen und den Standalone-Server ohne Master-Passwort; für die
 * gilt weiterhin, was vorher für alle galt. Ohne diesen Ausweg brächen sie samt und
 * sonders ab, und zwar an einer Stelle, die mit ihrer eigentlichen Aufgabe nichts zu tun
 * hat.
 */
export function schreibeGeschuetzt(pfad: string, inhalt: string): void {
  schreibeAtomar(pfad, isEncryptionAvailable() ? encryptSecret(inhalt) : inhalt);
}
