/**
 * Liest eine mailto:-Adresse, wie sie ein Browser oder der Explorer übergibt.
 *
 * Gebraucht, seit sich Energy Mail als Standard-E-Mail-Programm eintragen lässt: Windows
 * startet die Anwendung dann mit der Adresse als Befehlszeilenargument. Ohne diesen Leser
 * wäre die Eintragung ein leeres Versprechen - der Klick öffnete das Programm und täte
 * sonst nichts, was schlechter ist, als sich gar nicht erst einzutragen.
 *
 * Hier statt in der Hülle, weil es reine Zeichenkettenarbeit ist: so lässt es sich ohne
 * Electron prüfen, und die Fälle, die man leicht falsch macht, stehen als Prüfung fest.
 *
 * Gedeckt ist RFC 6068. Die Feinheiten, die dort zählen:
 *  - Der Pfadteil enthält die Empfänger, mit Komma getrennt, prozentkodiert.
 *  - "subject", "body", "cc" und "bcc" stehen in der Abfrage.
 *  - In der Abfrage ist "+" NICHT als Leerzeichen zu lesen. Das gilt für Formulardaten,
 *    nicht für mailto: - eine Adresse wie "a+werbung@beispiel.de" käme sonst als
 *    "a werbung@beispiel.de" an, und die gibt es nicht.
 *  - Das Kopfzeilenfeld "to" darf zusätzlich zum Pfad vorkommen; beide gelten.
 */

export interface MailtoAngaben {
  an: string[];
  kopie: string[];
  blindkopie: string[];
  betreff?: string;
  text?: string;
}

/** Entschlüsselt einen prozentkodierten Teil, ohne bei Unfug zu werfen. */
function entkodiere(wert: string): string {
  try {
    return decodeURIComponent(wert);
  } catch {
    // Eine fehlerhaft kodierte Adresse ist kein Grund, gar nichts zu öffnen - dann eben
    // roh. Der Nutzer sieht im Entwurf, was ankam, und kann es richtigstellen.
    return wert;
  }
}

/** Zerlegt eine Empfängerliste und wirft Leeres weg. */
function adressen(roh: string): string[] {
  return roh
    .split(',')
    .map((a) => entkodiere(a).trim())
    .filter((a) => a.length > 0);
}

/**
 * Liest die Adresse. Gibt `null` zurück, wenn es gar keine mailto:-Adresse ist.
 *
 * Ein leeres "mailto:" ist ausdrücklich gültig und ergibt einen leeren Entwurf - so
 * verhalten sich die Verweise "Schreiben Sie uns" auf mancher Webseite.
 */
export function leseMailto(roh: string): MailtoAngaben | null {
  if (typeof roh !== 'string') return null;
  const getrimmt = roh.trim();
  if (!/^mailto:/i.test(getrimmt)) return null;

  const ohneSchema = getrimmt.slice('mailto:'.length);
  const fragezeichen = ohneSchema.indexOf('?');
  const pfad = fragezeichen >= 0 ? ohneSchema.slice(0, fragezeichen) : ohneSchema;
  const abfrage = fragezeichen >= 0 ? ohneSchema.slice(fragezeichen + 1) : '';

  const angaben: MailtoAngaben = {
    an: adressen(pfad),
    kopie: [],
    blindkopie: [],
  };

  for (const stueck of abfrage.split('&')) {
    if (!stueck) continue;
    const gleich = stueck.indexOf('=');
    // Ein Feld ohne "=" trägt keinen Wert und ist damit belanglos.
    if (gleich < 0) continue;
    const name = entkodiere(stueck.slice(0, gleich)).toLowerCase();
    const wert = entkodiere(stueck.slice(gleich + 1));

    switch (name) {
      case 'to':
        // Kommt zusätzlich zum Pfad vor - beide gelten, nicht das eine statt des anderen.
        angaben.an.push(...adressen(stueck.slice(gleich + 1)));
        break;
      case 'cc':
        angaben.kopie.push(...adressen(stueck.slice(gleich + 1)));
        break;
      case 'bcc':
        angaben.blindkopie.push(...adressen(stueck.slice(gleich + 1)));
        break;
      case 'subject':
        angaben.betreff = wert;
        break;
      case 'body':
        angaben.text = wert;
        break;
      default:
        /*
         * Andere Kopfzeilen werden bewusst verworfen.
         *
         * RFC 6068 erlaubt weitere, warnt aber selbst davor, sie ungeprüft zu übernehmen:
         * eine Webseite könnte über "from" oder "reply-to" den Absender fälschen oder
         * über eigene Kopfzeilen etwas in die Nachricht schreiben, das der Nutzer nicht
         * sieht. Was hier nicht aufgeführt ist, kommt nicht durch.
         */
        break;
    }
  }

  return angaben;
}

/** Sucht in einer Befehlszeile die erste mailto:-Adresse. */
export function mailtoAusArgumenten(argv: readonly string[]): MailtoAngaben | null {
  for (const arg of argv) {
    const angaben = leseMailto(arg);
    if (angaben) return angaben;
  }
  return null;
}
