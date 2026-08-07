/**
 * Erkennt angekündigte, aber vergessene Anhänge.
 *
 * Ein Alltagsfehler, den jedes große Mailprogramm abfängt. Die Kunst liegt nicht im
 * Finden, sondern im Nichtfinden: eine Rückfrage, die zu oft kommt, klickt man weg, ohne
 * sie zu lesen - und dann fängt sie auch den echten Fall nicht mehr ab.
 *
 * Darum wird bewusst eng gesucht:
 * - nur Wendungen, die eine Datei ankündigen ("im Anhang", "beigefügt", "attached"),
 *   nicht das bloße Wort "Anhang", das auch in "Anhang zum Vertrag" steht;
 * - nicht im zitierten Text einer Antwort - dort steht die Ankündigung des anderen,
 *   nicht die eigene;
 * - nicht in der Signatur.
 */

/**
 * Die Wendungen. Deutsch und Englisch, weil in beiden Sprachen geschrieben wird.
 *
 * "anbei" und "beigefügt" stehen allein, weil sie ohne Datei kaum vorkommen. "Anhang"
 * und "attachment" brauchen eine Präposition davor, sonst träfe schon jeder Satz über
 * einen Vertragsanhang zu.
 */
const WENDUNGEN = [
  /\banbei\b/i,
  /\bbeigef(ü|ue)gt\b/i,
  /\bals\s+anlage\b/i,
  /\b(im|in\s+der|als)\s+anhang\b/i,
  /\banh(ä|ae)ngend\b/i,
  /\bh(ä|ae)nge\s+(ich\s+)?(dir|ihnen|euch)?\s*\S*\s*an\b/i,
  /\bsiehe\s+anlage\b/i,
  /\battached\b/i,
  /\battachment\b/i,
  /\bplease\s+find\s+enclosed\b/i,
  /\benclosed\b/i,
];

/**
 * Zitierter Text einer Antwort. Zwei Formen kommen vor: die eingerückten Zeilen mit ">"
 * bei reinem Text und der Block ab "Am ... schrieb ..." bzw. "-----" bei HTML.
 */
function ohneZitat(text: string): string {
  const zeilen = text.split(/\r?\n/);
  const ergebnis: string[] = [];

  for (const zeile of zeilen) {
    const t = zeile.trim();
    if (t.startsWith('>')) continue;
    // Ab der Einleitung einer Antwort oder Weiterleitung gehört nichts mehr uns.
    if (/^(am\s.+schrieb|on\s.+wrote|-{2,}\s*(urspr|original|weitergeleitet|forwarded))/i.test(t)) {
      break;
    }
    // Signaturtrenner nach RFC 3676.
    if (t === '--') break;
    ergebnis.push(zeile);
  }
  return ergebnis.join('\n');
}

export interface AnhangPruefung {
  /** Ob nachgefragt werden soll. */
  nachfragen: boolean;
  /** Die gefundene Wendung - damit die Rückfrage sagen kann, woran es liegt. */
  fundstelle?: string;
}

/**
 * Prüft vor dem Senden. Der Text kommt als reiner Text herein, nicht als HTML - das
 * Umwandeln erledigt der Aufrufer, der es ohnehin für die Textfassung der Mail braucht.
 */
export function pruefeAnhaenge(
  betreff: string,
  text: string,
  anzahlAnhaenge: number,
): AnhangPruefung {
  if (anzahlAnhaenge > 0) return { nachfragen: false };

  const zuPruefen = `${betreff}\n${ohneZitat(text)}`;
  for (const wendung of WENDUNGEN) {
    const treffer = zuPruefen.match(wendung);
    if (treffer) return { nachfragen: true, fundstelle: treffer[0] };
  }
  return { nachfragen: false };
}
