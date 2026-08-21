import { KENNUNG, kontext, tlv, zeichen } from './ber.js';

/**
 * LDAP-Suchfilter: aus der Schreibweise nach RFC 4515 in Bytes nach RFC 4511.
 *
 * ## Warum ein Zerleger und keine Vorlage mit Platzhaltern
 *
 * Weil jeder, der ein Firmenverzeichnis betreibt, seinen Filter kennt und ihn hinschreiben
 * will - `(&(objectClass=user)(!(objectClass=computer)))` bei einem Active Directory,
 * `(objectClass=inetOrgPerson)` bei einem OpenLDAP. Eine Vorlage mit ein paar Ankreuzfeldern
 * ließe jeden im Stich, dessen Verzeichnis anders gewachsen ist - und das sind die meisten.
 *
 * ## Und warum das Maskieren nicht verhandelbar ist
 *
 * Was der Nutzer in das Suchfeld tippt, geht in einen Filter. Ohne Maskierung baute
 * `*)(objectClass=*` daraus einen anderen Filter, als gemeint war - dieselbe Sorte Lücke
 * wie eine SQL-Einschleusung, nur dass hier ein Verzeichnis mit den Personaldaten eines
 * Unternehmens dahinter steht. `maskiere()` unten ist deshalb keine Höflichkeit gegenüber
 * Sonderzeichen, sondern die Absicherung.
 */

/**
 * Maskiert einen Wert für einen Filter (RFC 4515, Abschnitt 3).
 *
 * Vier Zeichen müssen weg, und zwar als Backslash gefolgt von zwei Hexziffern: der
 * Backslash selbst, die runden Klammern und der Stern. Das Nullbyte kommt dazu.
 */
export function maskiere(wert: string): string {
  return wert.replace(/[\\()*\0]/g, (z) => {
    const hex = z.charCodeAt(0).toString(16).padStart(2, '0');
    return `\\${hex}`;
  });
}

/** Ein zerlegter Filter - der Zwischenschritt zwischen Text und Bytes. */
export type Filter =
  | { art: 'und' | 'oder'; teile: Filter[] }
  | { art: 'nicht'; teil: Filter }
  | { art: 'gleich' | 'groesser' | 'kleiner' | 'aehnlich'; attribut: string; wert: string }
  | { art: 'vorhanden'; attribut: string }
  | { art: 'teile'; attribut: string; anfang?: string; mitte: string[]; ende?: string };

export class FilterFehler extends Error {}

/**
 * Zerlegt einen Filter.
 *
 * Rekursiver Abstieg über eine Grammatik, die auf eine halbe Seite passt: Ein Filter ist
 * immer geklammert, beginnt entweder mit &, | oder ! - dann folgen Unterfilter - oder ist
 * ein Vergleich aus Attribut, Zeichen und Wert.
 */
export function zerlegeFilter(text: string): Filter {
  let stelle = 0;

  function fehler(was: string): never {
    throw new FilterFehler(`${was} (Stelle ${stelle} in "${text}")`);
  }

  function filter(): Filter {
    if (text[stelle] !== '(') fehler('Hier wird eine öffnende Klammer erwartet');
    stelle++;
    const zeichenHier = text[stelle];

    if (zeichenHier === '&' || zeichenHier === '|') {
      stelle++;
      const teile: Filter[] = [];
      while (text[stelle] === '(') teile.push(filter());
      if (teile.length === 0) fehler('Eine Verknüpfung ohne Bedingungen');
      zu();
      return { art: zeichenHier === '&' ? 'und' : 'oder', teile };
    }

    if (zeichenHier === '!') {
      stelle++;
      const teil = filter();
      zu();
      return { art: 'nicht', teil };
    }

    return vergleich();
  }

  function zu(): void {
    if (text[stelle] !== ')') fehler('Hier wird eine schließende Klammer erwartet');
    stelle++;
  }

  function vergleich(): Filter {
    const anfang = stelle;
    while (stelle < text.length && !'=<>~()'.includes(text[stelle]!)) stelle++;
    const attribut = text.slice(anfang, stelle).trim();
    if (!attribut) fehler('Kein Attributname');

    let art: 'gleich' | 'groesser' | 'kleiner' | 'aehnlich' = 'gleich';
    if (text[stelle] === '>' || text[stelle] === '<' || text[stelle] === '~') {
      art = text[stelle] === '>' ? 'groesser' : text[stelle] === '<' ? 'kleiner' : 'aehnlich';
      stelle++;
    }
    if (text[stelle] !== '=') fehler('Hier wird ein Gleichheitszeichen erwartet');
    stelle++;

    const wertAnfang = stelle;
    while (stelle < text.length && text[stelle] !== ')') stelle++;
    const roh = text.slice(wertAnfang, stelle);
    zu();

    if (art === 'gleich' && roh === '*') return { art: 'vorhanden', attribut };

    if (art === 'gleich' && roh.includes('*')) {
      /*
       * Ein Teilstückfilter. `(cn=a*b*c)` heißt: fängt mit a an, enthält b, hört mit c
       * auf. Die Norm behandelt Anfang, Mitte und Ende als drei verschiedene Zweige -
       * ein Stern am Rand ergibt kein Teilstück, sondern lässt den Zweig weg.
       */
      const stuecke = roh.split('*');
      const anfangStueck = stuecke[0] || undefined;
      const endeStueck = stuecke[stuecke.length - 1] || undefined;
      const mitte = stuecke.slice(1, -1).filter(Boolean);
      return { art: 'teile', attribut, anfang: anfangStueck, mitte, ende: endeStueck };
    }

    return { art, attribut, wert: entmaskiere(roh) };
  }

  const ergebnis = filter();
  if (stelle !== text.length) fehler('Nach dem Filter steht noch etwas');
  return ergebnis;
}

/** `\28` zurück zu `(` - beim Bauen der Bytes wird nicht maskiert, sondern roh geschrieben. */
function entmaskiere(wert: string): string {
  return wert.replace(/\\([0-9a-fA-F]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

/**
 * Baut die Bytes zu einem zerlegten Filter.
 *
 * Die Kennungen stehen in RFC 4511, Abschnitt 4.5.1. Zwei Feinheiten, an denen es leicht
 * schiefgeht: `and` und `or` sind eine MENGE und keine Folge, und `present` ist der
 * einzige Zweig, der NICHT zusammengesetzt ist - dort steht der Attributname unmittelbar
 * als Zeichenkette.
 */
export function baueFilter(filter: Filter): Buffer {
  switch (filter.art) {
    case 'und':
      return tlv(kontext(0), filter.teile.map(baueFilter));
    case 'oder':
      return tlv(kontext(1), filter.teile.map(baueFilter));
    case 'nicht':
      return tlv(kontext(2), baueFilter(filter.teil));
    case 'gleich':
      return tlv(kontext(3), [zeichen(filter.attribut), zeichen(filter.wert)]);
    case 'groesser':
      return tlv(kontext(5), [zeichen(filter.attribut), zeichen(filter.wert)]);
    case 'kleiner':
      return tlv(kontext(6), [zeichen(filter.attribut), zeichen(filter.wert)]);
    case 'aehnlich':
      return tlv(kontext(8), [zeichen(filter.attribut), zeichen(filter.wert)]);
    case 'vorhanden':
      // Nicht zusammengesetzt: 0x87, und der Name steht ohne eigene Hülle darin.
      return tlv(kontext(7, false), Buffer.from(filter.attribut, 'utf8'));
    case 'teile': {
      const stuecke: Buffer[] = [];
      if (filter.anfang) stuecke.push(zeichen(entmaskiere(filter.anfang), kontext(0, false)));
      for (const m of filter.mitte) stuecke.push(zeichen(entmaskiere(m), kontext(1, false)));
      if (filter.ende) stuecke.push(zeichen(entmaskiere(filter.ende), kontext(2, false)));
      return tlv(kontext(4), [zeichen(filter.attribut), tlv(KENNUNG.SEQUENCE, stuecke)]);
    }
  }
}

/** Der bequeme Weg: Text hinein, Bytes heraus. */
export function filterAusText(text: string): Buffer {
  return baueFilter(zerlegeFilter(text));
}

/**
 * Baut den Filter für eine Suche im Verzeichnis.
 *
 * Der Filter des Betreibers wird mit UND verknüpft, damit seine Einschränkung in jedem
 * Fall gilt - wer `(!(objectClass=computer))` eingetragen hat, will keine Rechnernamen
 * sehen, auch nicht, wenn einer zufällig "Müller" heißt.
 *
 * Der eingetippte Text wird MASKIERT und dann mit Sternen umgeben, damit `mül` auch
 * `Müller` findet. Das Maskieren geschieht vor dem Umgeben - sonst wären die eigenen
 * Sterne gleich mit maskiert.
 */
export function sucheFilter(
  grundfilter: string,
  suchtext: string,
  attribute: string[],
): Buffer {
  const sicher = maskiere(suchtext.trim());
  const zweige = attribute
    .filter(Boolean)
    .map((attribut) => zerlegeFilter(`(${attribut}=*${sicher}*)`));

  const suche: Filter =
    zweige.length === 1 ? zweige[0]! : { art: 'oder', teile: zweige };

  if (!grundfilter.trim()) return baueFilter(suche);
  return baueFilter({ art: 'und', teile: [zerlegeFilter(grundfilter.trim()), suche] });
}
