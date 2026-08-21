import { t } from './sprache.js';
/**
 * Einladungen und Termine (iCalendar, RFC 5545).
 *
 * Eine Besprechungseinladung ist keine gewöhnliche Nachricht: sie trägt einen Anhang vom
 * Typ "text/calendar", und darin steht, was wann wo stattfindet und wer eingeladen ist.
 * Wer das nicht deutet, zeigt seinen Nutzern eine Datei namens "invite.ics" und lässt sie
 * damit allein - genau das tat dieses Programm bisher.
 *
 * Drei Dinge machen das Format tückisch, und alle drei kosten hier Arbeit:
 *
 *   Zeitzonen. "DTSTART;TZID=Europe/Berlin:20260815T140000" ist keine Uhrzeit, sondern
 *   eine Ortsangabe plus Zifferblatt. Wann das wirklich ist, hängt davon ab, ob an dem
 *   Tag Sommerzeit gilt. Falsch gedeutet steht die Besprechung eine Stunde daneben.
 *
 *   Outlook nennt Zeitzonen anders. Nicht "Europe/Berlin", sondern "W. Europe Standard
 *   Time" - ein Name, den sonst niemand kennt und den keine Standardbibliothek auflöst.
 *
 *   Das Ende ist manchmal keine Zeit. Statt DTEND kann DURATION dastehen ("PT1H30M"),
 *   und bei ganztägigen Terminen ist DTEND der Tag DANACH.
 */

/** Wie jemand auf eine Einladung geantwortet hat. */
export type Teilnahme = 'zugesagt' | 'abgesagt' | 'vorbehalten' | 'offen' | 'unbekannt';

export interface Teilnehmer {
  adresse: string;
  name?: string;
  teilnahme: Teilnahme;
  /** Ob die Anwesenheit erbeten oder nur nachrichtlich ist. */
  optional?: boolean;
}

export interface Termin {
  /** Eindeutige Kennung. Antwort und Absage beziehen sich darauf. */
  uid: string;
  /** Zählt die Fassungen mit; eine Änderung erhöht sie. */
  sequenz: number;
  titel: string;
  beginn: Date | null;
  ende: Date | null;
  /** Ganztägig - dann ist die Uhrzeit ohne Bedeutung. */
  ganztaegig: boolean;
  /**
   * Die Zeitzone, wie sie in der Datei stand. Nur zur Anzeige: gerechnet wird in
   * "beginn" und "ende", die bereits den richtigen Zeitpunkt tragen.
   */
  zeitzone?: string;
  ort?: string;
  beschreibung?: string;
  organisator?: { adresse: string; name?: string };
  teilnehmer: Teilnehmer[];
  /** Die Wiederholungsregel im Original - beschreibeWiederholung() macht Text daraus. */
  wiederholung?: string;
}

export interface Einladung {
  /** Was die Nachricht will: einladen, absagen, antworten oder nur mitteilen. */
  methode: 'REQUEST' | 'CANCEL' | 'REPLY' | 'PUBLISH' | 'UNBEKANNT';
  termine: Termin[];
}

// --- Zeitzonen ---------------------------------------------------------------------

/**
 * Windows-Zeitzonennamen, wie Outlook sie schreibt, auf die weltweit üblichen abgebildet.
 *
 * Ohne diese Tabelle landet jede Outlook-Einladung im Rückfall "ohne Zeitzone" und damit
 * womöglich um Stunden daneben. Aufgenommen ist, was in deutschsprachiger Post vorkommt,
 * plus die großen internationalen - eine vollständige Liste hat über hundert Einträge und
 * wäre hier totes Gewicht.
 */
const WINDOWS_ZONEN: Record<string, string> = {
  'w. europe standard time': 'Europe/Berlin',
  'central europe standard time': 'Europe/Budapest',
  'central european standard time': 'Europe/Warsaw',
  'romance standard time': 'Europe/Paris',
  'gmt standard time': 'Europe/London',
  'greenwich standard time': 'Atlantic/Reykjavik',
  'e. europe standard time': 'Europe/Chisinau',
  'fle standard time': 'Europe/Kiev',
  'russian standard time': 'Europe/Moscow',
  'utc': 'UTC',
  'eastern standard time': 'America/New_York',
  'central standard time': 'America/Chicago',
  'mountain standard time': 'America/Denver',
  'pacific standard time': 'America/Los_Angeles',
  'india standard time': 'Asia/Kolkata',
  'china standard time': 'Asia/Shanghai',
  'tokyo standard time': 'Asia/Tokyo',
  'aus eastern standard time': 'Australia/Sydney',
};

/** Übersetzt einen Zeitzonennamen in einen, den die Standardbibliothek kennt. */
export function normalisiereZeitzone(tzid: string): string | null {
  const roh = tzid.trim().replace(/^"|"$/g, '');
  if (!roh) return null;

  // Manche Programme stellen einen eigenen Vorsatz voran: "/mozilla.org/.../Europe/Berlin"
  const ohneVorsatz = roh.replace(/^\/[^/]*\/[^/]*\//, '');
  const kandidaten = [ohneVorsatz, roh, WINDOWS_ZONEN[roh.toLowerCase()] ?? ''];

  for (const kandidat of kandidaten) {
    if (!kandidat) continue;
    try {
      // Der einzige verlässliche Weg zu prüfen, ob die Zone bekannt ist.
      new Intl.DateTimeFormat('en-US', { timeZone: kandidat });
      return kandidat;
    } catch {
      // Nächster Versuch.
    }
  }
  return null;
}

/** Wie weit die Zone zu diesem Zeitpunkt von UTC abweicht, in Millisekunden. */
function zonenVersatz(zeitpunkt: number, zone: string): number {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(zeitpunkt));

  const hole = (art: string) => Number(teile.find((t) => t.type === art)?.value ?? '0');
  // "24" statt "00" kommt bei manchen Fassungen für Mitternacht vor.
  const alsWaereEsUtc = Date.UTC(
    hole('year'),
    hole('month') - 1,
    hole('day'),
    hole('hour') % 24,
    hole('minute'),
    hole('second'),
  );
  return alsWaereEsUtc - zeitpunkt;
}

/**
 * Rechnet eine Ortszeit in einer benannten Zone in den wirklichen Zeitpunkt um.
 *
 * Zweistufig, und das ist nötig: die erste Schätzung deutet die Ziffern als UTC und fragt
 * nach dem Versatz. An den Tagen der Zeitumstellung liegt dieser Versatz auf der falschen
 * Seite der Grenze, weshalb ein zweiter Durchgang folgt.
 */
export function ortszeitAlsZeitpunkt(
  jahr: number,
  monat: number,
  tag: number,
  stunde: number,
  minute: number,
  sekunde: number,
  zone: string,
): Date {
  const alsUtc = Date.UTC(jahr, monat - 1, tag, stunde, minute, sekunde);
  const ersterVersatz = zonenVersatz(alsUtc, zone);
  const ersterVersuch = alsUtc - ersterVersatz;

  const zweiterVersatz = zonenVersatz(ersterVersuch, zone);
  return new Date(zweiterVersatz === ersterVersatz ? ersterVersuch : alsUtc - zweiterVersatz);
}

// --- Das Format lesen ---------------------------------------------------------------

/** Setzt umbrochene Zeilen zusammen. Fortsetzungen beginnen mit Leerzeichen oder Tabulator. */
function entfalte(text: string): string[] {
  const zeilen = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const zusammen: string[] = [];

  for (const zeile of zeilen) {
    if (zusammen.length > 0 && /^[ \t]/.test(zeile)) {
      zusammen[zusammen.length - 1] += zeile.slice(1);
      continue;
    }
    zusammen.push(zeile);
  }
  return zusammen;
}

interface Eigenschaft {
  name: string;
  parameter: Map<string, string>;
  wert: string;
}

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

  const kopf = zeile.slice(0, trenner);
  const stuecke: string[] = [];
  let laufend = '';
  inAnfuehrung = false;
  for (const c of kopf) {
    if (c === '"') {
      inAnfuehrung = !inAnfuehrung;
      laufend += c;
    } else if (c === ';' && !inAnfuehrung) {
      stuecke.push(laufend);
      laufend = '';
    } else {
      laufend += c;
    }
  }
  stuecke.push(laufend);

  const name = (stuecke.shift() ?? '').trim().toUpperCase();
  if (!name) return null;

  const parameter = new Map<string, string>();
  for (const stueck of stuecke) {
    const gleich = stueck.indexOf('=');
    if (gleich < 0) continue;
    parameter.set(
      stueck.slice(0, gleich).trim().toUpperCase(),
      stueck.slice(gleich + 1).trim().replace(/^"|"$/g, ''),
    );
  }

  return { name, parameter, wert: zeile.slice(trenner + 1) };
}

/** Macht die Maskierung rückgängig. */
function entwerte(text: string): string {
  return text.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** Deutet DTSTART, DTEND und Verwandte. */
function leseZeitpunkt(eig: Eigenschaft): { zeit: Date | null; ganztaegig: boolean; zone?: string } {
  const roh = eig.wert.trim();

  // Ganztägig: nur ein Datum, keine Uhrzeit.
  const nurDatum = /^(\d{4})(\d{2})(\d{2})$/.exec(roh);
  if (nurDatum || eig.parameter.get('VALUE')?.toUpperCase() === 'DATE') {
    const t = nurDatum ?? /^(\d{4})(\d{2})(\d{2})/.exec(roh);
    if (!t) return { zeit: null, ganztaegig: true };
    return {
      // Als UTC-Mitternacht: ein ganztägiger Termin hat keine Uhrzeit, und jede
      // Umrechnung würde ihn nur auf den falschen Tag schieben.
      zeit: new Date(Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]))),
      ganztaegig: true,
    };
  }

  const mitZeit = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(roh);
  if (!mitZeit) return { zeit: null, ganztaegig: false };

  const [, j, mo, ta, st, mi, se, z] = mitZeit.map((s) => s) as string[];
  const zahlen = [Number(j), Number(mo), Number(ta), Number(st), Number(mi), Number(se)] as const;

  // Mit "Z" am Ende steht die Zeit bereits in UTC.
  if (z === 'Z') {
    return {
      zeit: new Date(Date.UTC(zahlen[0], zahlen[1] - 1, zahlen[2], zahlen[3], zahlen[4], zahlen[5])),
      ganztaegig: false,
    };
  }

  const tzid = eig.parameter.get('TZID');
  const zone = tzid ? normalisiereZeitzone(tzid) : null;
  if (zone) {
    return { zeit: ortszeitAlsZeitpunkt(...zahlen, zone), ganztaegig: false, zone };
  }

  /**
   * Weder "Z" noch eine brauchbare Zone: eine "schwebende" Zeit. Sie meint die Ortszeit
   * dessen, der sie liest - also nehmen wir die des Rechners. Das ist die Auslegung des
   * Standards und in aller Regel auch die gemeinte.
   */
  return {
    zeit: new Date(zahlen[0], zahlen[1] - 1, zahlen[2], zahlen[3], zahlen[4], zahlen[5]),
    ganztaegig: false,
    zone: tzid ?? undefined,
  };
}

/** Deutet eine Dauer wie "PT1H30M" oder "P2DT3H" in Millisekunden. */
export function leseDauer(wert: string): number | null {
  const t = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    wert.trim(),
  );
  if (!t) return null;
  const [, vorzeichen, wochen, tage, stunden, minuten, sekunden] = t;
  const ms =
    (Number(wochen ?? 0) * 7 * 24 * 60 * 60 +
      Number(tage ?? 0) * 24 * 60 * 60 +
      Number(stunden ?? 0) * 60 * 60 +
      Number(minuten ?? 0) * 60 +
      Number(sekunden ?? 0)) *
    1000;
  // Eine Dauer ohne jeden Bestandteil ("P") ist keine.
  if (ms === 0 && !/\d/.test(wert)) return null;
  return vorzeichen === '-' ? -ms : ms;
}

const TEILNAHMEN: Record<string, Teilnahme> = {
  ACCEPTED: 'zugesagt',
  DECLINED: 'abgesagt',
  TENTATIVE: 'vorbehalten',
  'NEEDS-ACTION': 'offen',
  DELEGATED: 'offen',
};

/** Holt die Adresse aus einem "mailto:"-Wert. */
function adresseVon(wert: string): string {
  return wert.trim().replace(/^mailto:/i, '').trim();
}

/**
 * Liest eine iCalendar-Datei.
 *
 * Alles Unbekannte wird übergangen, nicht bemängelt: eine echte Einladung enthält
 * VTIMEZONE-Blöcke, VALARM-Erinnerungen und anbietereigene Felder, und an keinem davon
 * darf das Lesen scheitern.
 */
export function leseEinladung(inhalt: string): Einladung {
  const termine: Termin[] = [];
  let methode: Einladung['methode'] = 'UNBEKANNT';

  let offen: Termin | null = null;
  let dauer: number | null = null;
  let tiefe = 0;

  for (const zeile of entfalte(inhalt.replace(/^\uFEFF/, ''))) {
    const eig = zerlegeZeile(zeile);
    if (!eig) continue;

    if (eig.name === 'BEGIN') {
      const art = eig.wert.trim().toUpperCase();
      if (art === 'VEVENT' && tiefe === 0) {
        offen = {
          uid: '',
          sequenz: 0,
          titel: '',
          beginn: null,
          ende: null,
          ganztaegig: false,
          teilnehmer: [],
        };
        dauer = null;
      } else if (offen) {
        // VALARM und Verwandte innerhalb des Termins - deren Felder gehören nicht ihm.
        tiefe++;
      }
      continue;
    }
    if (eig.name === 'END') {
      const art = eig.wert.trim().toUpperCase();
      if (art === 'VEVENT' && tiefe === 0 && offen) {
        if (!offen.ende && offen.beginn && dauer !== null) {
          offen.ende = new Date(offen.beginn.getTime() + dauer);
        }
        termine.push(offen);
        offen = null;
      } else if (tiefe > 0) {
        tiefe--;
      }
      continue;
    }

    if (eig.name === 'METHOD' && !offen) {
      const wert = eig.wert.trim().toUpperCase();
      if (wert === 'REQUEST' || wert === 'CANCEL' || wert === 'REPLY' || wert === 'PUBLISH') {
        methode = wert;
      }
      continue;
    }

    // Innerhalb eines VALARM oder VTIMEZONE: nichts davon gehört zum Termin.
    if (!offen || tiefe > 0) continue;

    switch (eig.name) {
      case 'UID':
        offen.uid = eig.wert.trim();
        break;
      case 'SEQUENCE':
        offen.sequenz = Number(eig.wert.trim()) || 0;
        break;
      case 'SUMMARY':
        offen.titel = entwerte(eig.wert).trim();
        break;
      case 'LOCATION':
        offen.ort = entwerte(eig.wert).trim() || undefined;
        break;
      case 'DESCRIPTION':
        offen.beschreibung = entwerte(eig.wert).trim() || undefined;
        break;
      case 'RRULE':
        offen.wiederholung = eig.wert.trim();
        break;
      case 'DTSTART': {
        const gelesen = leseZeitpunkt(eig);
        offen.beginn = gelesen.zeit;
        offen.ganztaegig = gelesen.ganztaegig;
        offen.zeitzone = gelesen.zone;
        break;
      }
      case 'DTEND':
        offen.ende = leseZeitpunkt(eig).zeit;
        break;
      case 'DURATION':
        dauer = leseDauer(eig.wert);
        break;
      case 'ORGANIZER': {
        const adresse = adresseVon(eig.wert);
        if (adresse) {
          offen.organisator = { adresse, name: eig.parameter.get('CN') || undefined };
        }
        break;
      }
      case 'ATTENDEE': {
        const adresse = adresseVon(eig.wert);
        if (!adresse) break;
        const rolle = (eig.parameter.get('ROLE') ?? '').toUpperCase();
        offen.teilnehmer.push({
          adresse,
          name: eig.parameter.get('CN') || undefined,
          teilnahme: TEILNAHMEN[(eig.parameter.get('PARTSTAT') ?? '').toUpperCase()] ?? 'unbekannt',
          optional: rolle === 'OPT-PARTICIPANT' || rolle === 'NON-PARTICIPANT',
        });
        break;
      }
      default:
        break;
    }
  }

  return { methode, termine };
}

// --- Antworten ------------------------------------------------------------------------

/** Zeitstempel im Format des Standards: "20260815T140000Z". */
function alsIcsZeit(zeitpunkt: Date): string {
  return `${zeitpunkt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

function verwerte(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
    .replace(/\r/g, '');
}

/** Bricht eine Zeile nach 75 Bytes um, ohne einen Umlaut zu zerschneiden. */
function falte(zeile: string): string {
  const bytes = Buffer.from(zeile, 'utf8');
  if (bytes.length <= 75) return zeile;

  const teile: string[] = [];
  let ab = 0;
  let platz = 75;
  while (ab < bytes.length) {
    let bis = Math.min(ab + platz, bytes.length);
    while (bis > ab && bis < bytes.length && (bytes[bis]! & 0xc0) === 0x80) bis--;
    teile.push(bytes.subarray(ab, bis).toString('utf8'));
    ab = bis;
    platz = 74;
  }
  return teile.join('\r\n ');
}

const ANTWORT_STATUS: Record<'zusagen' | 'absagen' | 'vorbehalten', string> = {
  zusagen: 'ACCEPTED',
  absagen: 'DECLINED',
  vorbehalten: 'TENTATIVE',
};

export type Antwort = keyof typeof ANTWORT_STATUS;

/**
 * Baut die Antwort auf eine Einladung (RFC 6047, "iMIP").
 *
 * Der Organisator erkennt sie an drei Dingen: derselben UID, derselben oder höheren
 * SEQUENCE und genau einem ATTENDEE - dem Antwortenden. Weitere Teilnehmer aufzuführen
 * wäre falsch; niemand antwortet für andere mit.
 *
 * DTSTART muss mit hinein, obwohl es die Antwort nichts angeht: Outlook weist eine
 * Antwort ohne diese Zeile ab.
 */
export function baueAntwort(
  termin: Termin,
  antwortender: { adresse: string; name?: string },
  antwort: Antwort,
  jetzt: Date = new Date(),
): string {
  const zeilen = [
    'BEGIN:VCALENDAR',
    'PRODID:-//Energy Mail//DE',
    'VERSION:2.0',
    'METHOD:REPLY',
    'BEGIN:VEVENT',
    `UID:${verwerte(termin.uid)}`,
    `SEQUENCE:${termin.sequenz}`,
    `DTSTAMP:${alsIcsZeit(jetzt)}`,
  ];

  if (termin.beginn) {
    zeilen.push(
      termin.ganztaegig
        ? `DTSTART;VALUE=DATE:${alsIcsZeit(termin.beginn).slice(0, 8)}`
        : `DTSTART:${alsIcsZeit(termin.beginn)}`,
    );
  }
  if (termin.titel) zeilen.push(`SUMMARY:${verwerte(termin.titel)}`);

  if (termin.organisator) {
    const name = termin.organisator.name ? `;CN=${verwerte(termin.organisator.name)}` : '';
    zeilen.push(`ORGANIZER${name}:mailto:${termin.organisator.adresse}`);
  }

  const name = antwortender.name ? `;CN=${verwerte(antwortender.name)}` : '';
  zeilen.push(
    `ATTENDEE${name};PARTSTAT=${ANTWORT_STATUS[antwort]}:mailto:${antwortender.adresse}`,
  );

  zeilen.push('END:VEVENT', 'END:VCALENDAR');
  return zeilen.map(falte).join('\r\n') + '\r\n';
}

// --- In Worte fassen --------------------------------------------------------------------

const WOCHENTAGE: Record<string, string> = {
  MO: 'Montag',
  TU: 'Dienstag',
  WE: 'Mittwoch',
  TH: 'Donnerstag',
  FR: 'Freitag',
  SA: 'Samstag',
  SU: 'Sonntag',
};

/**
 * Beschreibt eine Wiederholungsregel auf Deutsch.
 *
 * Bewusst nicht vollständig - RRULE kann Dinge ausdrücken, für die es keinen kurzen Satz
 * gibt ("jeden dritten Dienstag außer im August"). Was hier nicht abgedeckt ist, wird
 * ehrlich als "wiederholt sich regelmäßig" ausgegeben, statt etwas Falsches zu behaupten.
 */
export function beschreibeWiederholung(rrule: string): string {
  const teile = new Map<string, string>();
  for (const stueck of rrule.split(';')) {
    const gleich = stueck.indexOf('=');
    if (gleich > 0) {
      teile.set(stueck.slice(0, gleich).trim().toUpperCase(), stueck.slice(gleich + 1).trim());
    }
  }

  const abstand = Number(teile.get('INTERVAL') ?? '1') || 1;
  const tage = (teile.get('BYDAY') ?? '')
    .split(',')
    // Der Laufparameter hiess "t" und verdeckte damit den Uebersetzer, der seit dieser
    // Fassung hier gebraucht wird. Der Uebersetzer faengt das zwar (er wird als Funktion
    // gerufen und der Parameter ist eine Zeichenkette), aber nur, weil er zufaellig im
    // selben Block steht.
    .map((tag) => WOCHENTAGE[tag.trim().slice(-2).toUpperCase()])
    .filter(Boolean);

  const grund = (() => {
    switch ((teile.get('FREQ') ?? '').toUpperCase()) {
      case 'DAILY':
        return abstand === 1 ? t('täglich') : t('alle {abstand} Tage', { abstand });
      case 'WEEKLY':
        if (tage.length > 0) {
          const wann = tage.join(', ');
          return abstand === 1 ? `jeden ${wann}` : `alle ${abstand} Wochen ${wann}`;
        }
        return abstand === 1 ? t('wöchentlich') : t('alle {abstand} Wochen', { abstand });
      case 'MONTHLY':
        return abstand === 1 ? 'monatlich' : `alle ${abstand} Monate`;
      case 'YEARLY':
        return abstand === 1 ? t('jährlich') : t('alle {abstand} Jahre', { abstand });
      default:
        return t('wiederholt sich regelmäßig');
    }
  })();

  const anzahl = teile.get('COUNT');
  if (anzahl) return `${grund}, ${anzahl} mal`;

  const bis = teile.get('UNTIL');
  /*
   * Nicht "t" - so hiess diese Variable, und sie steht im selben Bereich wie die
   * Uebersetzungen weiter oben. Der Uebersetzer heisst ebenfalls t; das Ergebnis war ein
   * "used before its declaration", also ein Fehler an einer Stelle, die mit dem Datum
   * nichts zu tun hat.
   */
  const treffer = bis ? /^(\d{4})(\d{2})(\d{2})/.exec(bis) : null;
  if (treffer) return `${grund} bis ${treffer[3]}.${treffer[2]}.${treffer[1]}`;

  return grund;
}
