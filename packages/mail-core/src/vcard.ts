/**
 * Visitenkarten (vCard) lesen und schreiben.
 *
 * vCard ist der einzige Weg, ein Adressbuch zwischen Programmen zu bewegen: Thunderbird,
 * Outlook, Apple Kontakte, Google Kontakte und jedes Telefon können es. Ohne dieses Modul
 * wäre das Adressbuch eine Sackgasse - wer seine Kontakte hier einträgt, käme nicht mehr
 * heraus.
 *
 * Die Tücke liegt darin, dass "vCard" drei ziemlich verschiedene Formate meint:
 *
 *   2.1  - alte Telefone und ältere Outlook-Ausgaben. Umlaute stecken in
 *          "quoted-printable", und die Fortsetzungszeilen sind NICHT eingerückt.
 *   3.0  - das mit Abstand verbreitetste. Google und Apple geben es aus.
 *   4.0  - der heutige Standard (RFC 6350). Manches steht darin anders, etwa
 *          Telefonnummern als "tel:"-Adresse.
 *
 * Gelesen werden alle drei. Geschrieben wird 3.0: es ist das einzige, das wirklich überall
 * ankommt - Outlook tut sich mit 4.0 bis heute schwer.
 */

export interface Telefonnummer {
  nummer: string;
  /** "Privat", "Arbeit", "Mobil" ... - schon übersetzt, wie es in der Oberfläche steht. */
  art?: string;
}

/** Eine gelesene Visitenkarte, unabhängig davon, in welcher Fassung sie ankam. */
export interface Visitenkarte {
  /** Anzeigename (FN). Fehlt er, wird er aus dem Namen oder der Adresse gebildet. */
  name?: string;
  vorname?: string;
  nachname?: string;
  /** Alle Mailadressen. Die erste gilt als die übliche. */
  adressen: string[];
  organisation?: string;
  telefone: Telefonnummer[];
  anschrift?: string;
  geburtstag?: string;
  notiz?: string;
}

/** Was in einer Zeile stand, bevor sie gedeutet wurde. */
interface Eigenschaft {
  /** Gruppe bei Apple-Ausgaben: "item1.EMAIL" - nötig, um X-ABLabel zuzuordnen. */
  gruppe?: string;
  name: string;
  parameter: Map<string, string[]>;
  wert: string;
}

const TELEFONARTEN: Record<string, string> = {
  work: 'Arbeit',
  home: 'Privat',
  cell: 'Mobil',
  mobile: 'Mobil',
  fax: 'Fax',
  main: 'Zentrale',
  pager: 'Pager',
  other: 'Sonstige',
};

/** Rückweg für die Ausgabe. Was hier fehlt, wird gar nicht erst als TYPE geschrieben. */
const ARTEN_ZURUECK: Record<string, string> = {
  Arbeit: 'WORK',
  Privat: 'HOME',
  Mobil: 'CELL',
  Fax: 'FAX',
  Zentrale: 'WORK',
  Pager: 'PAGER',
  Sonstige: 'OTHER',
};

/**
 * Setzt umbrochene Zeilen wieder zusammen.
 *
 * Das Format bricht lange Zeilen nach 75 Zeichen um; die Fortsetzung beginnt mit einem
 * Leerzeichen oder Tabulator, der nicht zum Inhalt gehört. In der Fassung 2.1 gilt das
 * aber nicht für quoted-printable: dort endet die Zeile auf "=" und die nächste schließt
 * ohne jede Einrückung an. Beide Fälle müssen hier zusammenkommen, sonst zerfällt jede
 * Outlook-Ausgabe mit Umlauten in unlesbare Bruchstücke.
 */
function entfalte(text: string): string[] {
  const zeilen = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const zusammen: string[] = [];

  for (const zeile of zeilen) {
    const vorige = zusammen[zusammen.length - 1];

    if (vorige !== undefined && /^[ \t]/.test(zeile)) {
      zusammen[zusammen.length - 1] = vorige + zeile.slice(1);
      continue;
    }
    // Das "=" am Zeilenende ist bei quoted-printable die Ankündigung, dass es weitergeht.
    if (vorige !== undefined && vorige.endsWith('=') && /quoted-printable/i.test(vorige)) {
      zusammen[zusammen.length - 1] = vorige.slice(0, -1) + zeile;
      continue;
    }
    zusammen.push(zeile);
  }
  return zusammen;
}

/** Trennt an Zeichen, die nicht in Anführungszeichen stehen. */
function teileFrei(text: string, zeichen: string): string[] {
  const teile: string[] = [];
  let laufend = '';
  let inAnfuehrung = false;

  for (const c of text) {
    if (c === '"') {
      inAnfuehrung = !inAnfuehrung;
      laufend += c;
    } else if (c === zeichen && !inAnfuehrung) {
      teile.push(laufend);
      laufend = '';
    } else {
      laufend += c;
    }
  }
  teile.push(laufend);
  return teile;
}

/** Zerlegt eine Zeile in Name, Parameter und Wert. */
function zerlegeZeile(zeile: string): Eigenschaft | null {
  let inAnfuehrung = false;
  let trenner = -1;

  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (c === '"') inAnfuehrung = !inAnfuehrung;
    else if (c === ':' && !inAnfuehrung) {
      trenner = i;
      break;
    }
  }
  if (trenner < 0) return null;

  const stuecke = teileFrei(zeile.slice(0, trenner), ';');
  const kopf = (stuecke.shift() ?? '').trim();
  if (!kopf) return null;

  const punkt = kopf.indexOf('.');
  const gruppe = punkt > 0 ? kopf.slice(0, punkt) : undefined;
  const name = (punkt > 0 ? kopf.slice(punkt + 1) : kopf).toUpperCase();

  const parameter = new Map<string, string[]>();
  for (const stueck of stuecke) {
    const gleich = stueck.indexOf('=');
    // Die Fassung 2.1 schreibt die Art ohne Schlüssel hin: "TEL;WORK;VOICE:..."
    const schluessel = gleich < 0 ? 'TYPE' : stueck.slice(0, gleich).trim().toUpperCase();
    const roh = gleich < 0 ? stueck : stueck.slice(gleich + 1);
    // Die Fassung 4.0 setzt mehrere Arten in Anführungszeichen: TYPE="voice,home".
    // Erst die Zeichen entfernen, dann trennen - sonst bliebe alles ein einziger Wert.
    const werte = roh
      .replace(/"/g, '')
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);
    parameter.set(schluessel, [...(parameter.get(schluessel) ?? []), ...werte]);
  }

  return { gruppe, name, parameter, wert: zeile.slice(trenner + 1) };
}

/**
 * Löst quoted-printable auf. Die Bytes werden erst gesammelt und dann als Ganzes
 * gedeutet - ein Umlaut steht in UTF-8 als zwei Bytes ("=C3=BC"), und einzeln gedeutet
 * käme dabei Buchstabensalat heraus.
 */
function ausQuotedPrintable(wert: string, zeichensatz: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < wert.length; i++) {
    if (wert[i] === '=' && /^[0-9a-f]{2}$/i.test(wert.slice(i + 1, i + 3))) {
      bytes.push(parseInt(wert.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      // Alles Übrige steht schon als Zeichen da und kann mehr als ein Byte lang sein.
      for (const b of Buffer.from(wert[i]!, 'utf8')) bytes.push(b);
    }
  }
  const kodierung = /8859|latin|ansi|windows-125/i.test(zeichensatz) ? 'latin1' : 'utf8';
  return Buffer.from(bytes).toString(kodierung);
}

/** Macht die Maskierung rückgängig: "\n" wird zum Zeilenumbruch, "\," zum Komma. */
function entwerte(text: string): string {
  return text.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/**
 * Liefert den fertigen Wert einer Zeile - entschlüsselt und entmaskiert.
 *
 * Leerzeichen an den Rändern fallen weg. Handgeschriebene und manche erzeugte Dateien
 * setzen eines hinter den Doppelpunkt ("FN: Anna"); das gehört nicht zum Namen. Der Preis
 * ist, dass ein absichtliches Leerzeichen am Ende einer Notiz verlorengeht - ein Verlust,
 * den man nicht sieht, gegen einen, den man in jeder Namensliste sähe.
 */
function wertVon(eig: Eigenschaft): string {
  const kodierung = (eig.parameter.get('ENCODING') ?? []).join(' ');
  const roh = /quoted-printable/i.test(kodierung)
    ? ausQuotedPrintable(eig.wert, (eig.parameter.get('CHARSET') ?? []).join(''))
    : eig.wert;
  return entwerte(roh).trim();
}

/** Zerlegt einen zusammengesetzten Wert wie N oder ADR an den freien Semikola. */
function felderVon(eig: Eigenschaft): string[] {
  const kodierung = (eig.parameter.get('ENCODING') ?? []).join(' ');
  const roh = /quoted-printable/i.test(kodierung)
    ? ausQuotedPrintable(eig.wert, (eig.parameter.get('CHARSET') ?? []).join(''))
    : eig.wert;
  // Nicht teileFrei: hier trennt das Semikolon, und maskierte zählen nicht mit.
  return roh
    .split(/(?<!\\);/)
    .map((f) => entwerte(f).trim());
}

/** Deutet die Art einer Telefonnummer - aus TYPE oder einem Apple-Etikett. */
function telefonArt(eig: Eigenschaft, etiketten: Map<string, string>): string | undefined {
  const eigenes = eig.gruppe ? etiketten.get(eig.gruppe) : undefined;
  if (eigenes) return eigenes;

  for (const typ of eig.parameter.get('TYPE') ?? []) {
    const uebersetzt = TELEFONARTEN[typ.trim().toLowerCase()];
    if (uebersetzt) return uebersetzt;
  }
  return undefined;
}

/** Setzt die Anschrift aus den sieben Feldern von ADR zu etwas Lesbarem zusammen. */
function anschriftVon(felder: string[]): string {
  const [, erweitert, strasse, ort, region, plz, land] = felder;
  const zeilen = [
    [strasse, erweitert].filter(Boolean).join(' '),
    [plz, ort].filter(Boolean).join(' '),
    [region, land].filter(Boolean).join(', '),
  ];
  return zeilen.filter((z) => z.trim()).join('\n');
}

/** Ein Geburtstag als "JJJJ-MM-TT", woher auch immer er kam. */
function geburtstagVon(wert: string): string | undefined {
  const sauber = wert.trim();
  // 4.0 erlaubt "19850403", 3.0 schreibt "1985-04-03", manche hängen eine Uhrzeit an.
  const kompakt = /^(\d{4})(\d{2})(\d{2})/.exec(sauber);
  if (kompakt) return `${kompakt[1]}-${kompakt[2]}-${kompakt[3]}`;
  const getrennt = /^(\d{4})-(\d{2})-(\d{2})/.exec(sauber);
  if (getrennt) return `${getrennt[1]}-${getrennt[2]}-${getrennt[3]}`;
  return undefined;
}

/** Holt die Mailadresse aus dem Wert - 4.0 darf "mailto:" davorschreiben. */
function adresseVon(wert: string): string | undefined {
  const sauber = wert.replace(/^mailto:/i, '').trim();
  return sauber.includes('@') ? sauber : undefined;
}

/**
 * Liest eine Datei mit einer oder vielen Visitenkarten.
 *
 * Was nicht verstanden wird - Bilder, Zeitzonen, anbietereigene Felder - wird übergangen,
 * nicht bemängelt. Eine Datei aus einer fremden Quelle enthält fast immer irgendetwas
 * Unbekanntes; daran soll die Einfuhr nicht scheitern.
 */
export function leseVisitenkarten(inhalt: string): Visitenkarte[] {
  const karten: Visitenkarte[] = [];
  let offen: Visitenkarte | null = null;
  let etiketten = new Map<string, string>();
  let gesammelt: Eigenschaft[] = [];

  const abschliessen = () => {
    if (!offen) return;
    for (const eig of gesammelt) deute(eig, offen, etiketten);
    if (!offen.name) {
      const ausName = [offen.vorname, offen.nachname].filter(Boolean).join(' ').trim();
      offen.name = ausName || offen.organisation || offen.adressen[0];
    }
    // Ohne Adresse und ohne Namen ist nichts da, was man ins Adressbuch stellen könnte.
    if (offen.adressen.length > 0 || offen.name) karten.push(offen);
    offen = null;
  };

  for (const zeile of entfalte(inhalt.replace(/^﻿/, ''))) {
    const getrimmt = zeile.trim();
    if (/^BEGIN:VCARD$/i.test(getrimmt)) {
      offen = { adressen: [], telefone: [] };
      etiketten = new Map();
      gesammelt = [];
      continue;
    }
    if (/^END:VCARD$/i.test(getrimmt)) {
      abschliessen();
      continue;
    }
    if (!offen || !getrimmt) continue;

    const eig = zerlegeZeile(zeile);
    if (!eig) continue;

    // Erst alle Etiketten einsammeln - sie stehen mal vor, mal hinter ihrer Zeile.
    if (eig.name === 'X-ABLABEL' && eig.gruppe) {
      etiketten.set(eig.gruppe, wertVon(eig).replace(/^_\$!<|>!\$_$/g, ''));
      continue;
    }
    gesammelt.push(eig);
  }
  // Eine Datei ohne abschließendes END:VCARD ist beschädigt, aber lesbar.
  abschliessen();

  return karten;
}

function deute(eig: Eigenschaft, karte: Visitenkarte, etiketten: Map<string, string>): void {
  switch (eig.name) {
    case 'FN':
      karte.name ||= wertVon(eig);
      break;
    case 'N': {
      const [nachname, vorname] = felderVon(eig);
      if (nachname) karte.nachname ||= nachname;
      if (vorname) karte.vorname ||= vorname;
      break;
    }
    case 'EMAIL': {
      const adresse = adresseVon(wertVon(eig));
      // Doppelte kommen häufig vor, wenn ein Programm dieselbe Adresse mehrfach ablegt.
      if (adresse && !karte.adressen.some((a) => a.toLowerCase() === adresse.toLowerCase())) {
        // Was als bevorzugt gekennzeichnet ist, gehört nach vorn.
        const bevorzugt = (eig.parameter.get('TYPE') ?? []).some((t) => /^pref$/i.test(t));
        if (bevorzugt) karte.adressen.unshift(adresse);
        else karte.adressen.push(adresse);
      }
      break;
    }
    case 'TEL': {
      const nummer = wertVon(eig).replace(/^tel:/i, '').trim();
      if (nummer) karte.telefone.push({ nummer, art: telefonArt(eig, etiketten) });
      break;
    }
    case 'ORG': {
      // ORG ist zusammengesetzt: Firma;Abteilung. Beides gehört in eine Zeile.
      const teile = felderVon(eig).filter(Boolean);
      if (teile.length > 0) karte.organisation ||= teile.join(', ');
      break;
    }
    case 'ADR':
      karte.anschrift ||= anschriftVon(felderVon(eig)) || undefined;
      break;
    case 'BDAY':
      karte.geburtstag ||= geburtstagVon(wertVon(eig));
      break;
    case 'NOTE':
      karte.notiz ||= wertVon(eig) || undefined;
      break;
    default:
      break;
  }
}

/** Maskiert, was im Wert sonst als Trenner gelesen würde. */
function verwerte(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r/g, '');
}

/**
 * Bricht eine Zeile nach 75 Zeichen um, wie das Format es verlangt.
 *
 * Gezählt wird in Bytes, nicht in Buchstaben, und mitten in einem Umlaut darf nicht
 * getrennt werden - sonst stehen dort beim Einlesen zwei Fragezeichen.
 */
function falte(zeile: string): string {
  const bytes = Buffer.from(zeile, 'utf8');
  if (bytes.length <= 75) return zeile;

  const teile: string[] = [];
  let ab = 0;
  // Ab der zweiten Zeile geht ein Byte für das führende Leerzeichen ab.
  let platz = 75;

  while (ab < bytes.length) {
    let bis = Math.min(ab + platz, bytes.length);
    // Nicht in einer Folgebyte-Kette landen: die tragen alle das Bitmuster 10xxxxxx.
    while (bis > ab && bis < bytes.length && (bytes[bis]! & 0xc0) === 0x80) bis--;
    teile.push(bytes.subarray(ab, bis).toString('utf8'));
    ab = bis;
    platz = 74;
  }
  return teile.join('\r\n ');
}

/** Der Name, wie er in FN stehen soll. */
function anzeigename(karte: Visitenkarte): string {
  const ausTeilen = [karte.vorname, karte.nachname].filter(Boolean).join(' ').trim();
  return karte.name?.trim() || ausTeilen || karte.organisation || karte.adressen[0] || 'Unbenannt';
}

/**
 * Schreibt eine Visitenkarte in der Fassung 3.0.
 *
 * Die Zeilenenden sind CRLF, weil das Format es so verlangt - Outlook nimmt eine Datei
 * mit einfachen Zeilenumbrüchen teilweise gar nicht erst an.
 */
export function alsVisitenkarte(karte: Visitenkarte): string {
  const zeilen: string[] = ['BEGIN:VCARD', 'VERSION:3.0'];

  zeilen.push(`FN:${verwerte(anzeigename(karte))}`);
  zeilen.push(`N:${verwerte(karte.nachname ?? '')};${verwerte(karte.vorname ?? '')};;;`);

  karte.adressen.forEach((adresse, i) => {
    // Die erste ist die übliche - das hält jedes lesende Programm auseinander.
    zeilen.push(`EMAIL;TYPE=INTERNET${i === 0 ? ',PREF' : ''}:${verwerte(adresse)}`);
  });

  for (const telefon of karte.telefone) {
    const typ = telefon.art ? ARTEN_ZURUECK[telefon.art] : undefined;
    zeilen.push(`TEL${typ ? `;TYPE=${typ}` : ''}:${verwerte(telefon.nummer)}`);
  }

  if (karte.organisation) zeilen.push(`ORG:${verwerte(karte.organisation)}`);
  if (karte.anschrift) {
    // Die Anschrift steht bei uns als freier Text und kommt darum vollständig in das
    // Feld für die Straße. Sie in Straße, Ort und Postleitzahl zu zerlegen hieße raten -
    // und geraten wird bei fremden Anschriften erfahrungsgemäß falsch.
    //
    // Der Zeilenumbruch bleibt als "\n" erhalten; das Format erlaubt ihn auch innerhalb
    // eines Feldes. Ersetzte man ihn durch ein Komma, käme die Anschrift beim Einlesen
    // als eine einzige Zeile zurück.
    zeilen.push(`ADR;TYPE=HOME:;;${verwerte(karte.anschrift)};;;;`);
  }
  if (karte.geburtstag) zeilen.push(`BDAY:${karte.geburtstag}`);
  if (karte.notiz) zeilen.push(`NOTE:${verwerte(karte.notiz)}`);

  zeilen.push('END:VCARD');
  return zeilen.map(falte).join('\r\n') + '\r\n';
}

/** Alle Visitenkarten hintereinander - eine Datei, die überall eingelesen werden kann. */
export function alsVisitenkartenDatei(karten: Visitenkarte[]): string {
  return karten.map(alsVisitenkarte).join('');
}
