/**
 * Abmeldung von Verteilern über die Kopfzeile "List-Unsubscribe".
 *
 * Die Kopfzeile nennt einen oder zwei Wege in spitzen Klammern: eine Web-Adresse und/oder
 * eine Mailadresse. Kommt zusätzlich "List-Unsubscribe-Post" vor, hat der Absender
 * zugesagt, eine schlichte Anfrage an die Web-Adresse als Abmeldung zu werten (RFC 8058)
 * - ohne Bestätigungsseite, ohne Anmeldung. In einer Stichprobe traf das auf alle
 * Nachrichten zu, die überhaupt eine Abmeldezeile trugen.
 *
 * Bewusst nichts geraten: gibt es keinen dieser Wege, wird abgebrochen statt eine
 * "unsubscribe"-Adresse zu erfinden.
 */

export interface AbmeldeWege {
  http?: string;
  mailto?: { adresse: string; betreff?: string; text?: string };
  /** Der Absender akzeptiert die Abmeldung per einfacher Anfrage. */
  einKlick: boolean;
}

/**
 * Zerlegt den Inhalt der Kopfzeile. Sie enthält die Ziele in spitzen Klammern, durch
 * Kommata getrennt - Reihenfolge und Anzahl sind nicht festgelegt.
 */
export function leseAbmeldeWege(kopfzeile: string, einKlick = false): AbmeldeWege {
  const ziele = [...kopfzeile.matchAll(/<([^>]+)>/g)].map((t) => t[1].trim());
  const wege: AbmeldeWege = { einKlick };

  for (const ziel of ziele) {
    if (/^https?:/i.test(ziel) && !wege.http) {
      wege.http = ziel;
      continue;
    }
    if (/^mailto:/i.test(ziel) && !wege.mailto) {
      // Eine mailto-Adresse darf Betreff und Text als Parameter mitbringen; manche
      // Verteiler verlangen einen bestimmten Betreff, sonst wirkt die Abmeldung nicht.
      const [adresse, abfrage] = ziel.slice('mailto:'.length).split('?');
      const parameter = new URLSearchParams(abfrage ?? '');
      wege.mailto = {
        adresse: decodeURIComponent(adresse),
        betreff: parameter.get('subject') ?? undefined,
        text: parameter.get('body') ?? undefined,
      };
    }
  }
  return wege;
}

export type AbmeldeErgebnis =
  | { art: 'ein-klick'; ziel: string }
  | { art: 'mail'; adresse: string; betreff?: string; text?: string }
  | { art: 'im-browser'; ziel: string };

/**
 * Bestimmt, wie abgemeldet wird - führt selbst nichts aus.
 *
 * Getrennt, weil die drei Wege an verschiedenen Stellen enden: die Anfrage schickt der
 * Server, die Mail geht über SMTP, und eine Seite kann nur der Browser öffnen. Diese
 * Entscheidung ist außerdem für sich prüfbar, ohne dass dabei jemand abgemeldet wird.
 */
export function bestimmeAbmeldung(wege: AbmeldeWege): AbmeldeErgebnis | null {
  // Der zugesagte Ein-Klick-Weg zuerst: er wirkt sofort und ohne Zutun.
  if (wege.einKlick && wege.http) return { art: 'ein-klick', ziel: wege.http };
  // Danach die Mail - sie führt ebenfalls ohne weitere Schritte zum Ziel.
  if (wege.mailto) {
    return {
      art: 'mail',
      adresse: wege.mailto.adresse,
      betreff: wege.mailto.betreff,
      text: wege.mailto.text,
    };
  }
  // Bleibt die Seite, auf der man selbst bestätigen muss.
  if (wege.http) return { art: 'im-browser', ziel: wege.http };
  return null;
}

/**
 * Schickt die Ein-Klick-Abmeldung. Inhalt und Kopfzeile sind in RFC 8058 festgelegt;
 * Abweichungen davon erkennen die Verteiler nicht.
 */
export async function sendeEinKlickAbmeldung(ziel: string): Promise<{ status: number }> {
  const antwort = await fetch(ziel, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
    // Weiterleitungen sind üblich; der abschließende Status zählt.
    redirect: 'follow',
  });
  return { status: antwort.status };
}
