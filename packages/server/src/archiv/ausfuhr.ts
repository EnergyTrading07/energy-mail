import fs from 'node:fs';
import path from 'node:path';
import {
  alleEintraege,
  archivEinstellungen,
  archivOrdner,
  archivPostOrdner,
  pruefeBestand,
  siegel,
} from './archiv.js';
import { verfahrensdokumentation } from './verfahrensdokumentation.js';
import type { Eintrag } from './kette.js';
import { protokolliere } from '../protokollDatei.js';

/**
 * Die Ausfuhr für eine Betriebsprüfung - „Datenträgerüberlassung", Z3.
 *
 * ## Was eine Prüfung verlangt
 *
 * Drei Wege stehen ihr offen (§ 147 Abs. 6 AO): selbst am Rechner sehen (Z1), sich etwas
 * auswerten lassen (Z2) oder die Daten auf einem Datenträger bekommen (Z3). Der dritte
 * ist der übliche, und er ist der einzige, den ein Programm allein bedienen kann.
 *
 * Dafür gibt es seit 2004 ein Format: den **Beschreibungsstandard für die
 * Datenträgerüberlassung**. Es ist unspektakulär - eine Textdatei mit den Daten und eine
 * `index.xml`, die sagt, was in welcher Spalte steht. Die Prüfsoftware liest beides und
 * kann danach sortieren, filtern und summieren, ohne dass jemand erklären müsste, wie
 * unsere Tabelle aufgebaut ist.
 *
 * ## Warum ein Ordner und keine einzelne Datei
 *
 * Weil die Nachrichten im Original mitmüssen, und das sind bei sechs Jahren Geschäftspost
 * schnell einige Gigabyte. Eine Datei dieser Größe durch den Browser zu schieben wäre
 * eine Zumutung für beide Seiten. Was am Ende übergeben wird, ist ohnehin ein Datenträger -
 * und darauf kopiert man einen Ordner.
 *
 * ## Was ehrlich dazugehört
 *
 * Die `index.xml` folgt dem Beschreibungsstandard, so wie er seit 2004 gilt. Die
 * zugehörige DTD liegt NICHT bei: Sie ist Bestandteil des Standards, nicht unseres
 * Programms, und eine aus dem Gedächtnis nachgetippte Fassung wäre schlimmer als keine.
 * Die Prüfprogramme bringen sie mit.
 *
 * Und sollte ein Werkzeug an einer Einzelheit hängen: Die Datei ist Text, sie liegt offen
 * daneben, und die Nachrichten selbst sind auch ohne sie vollständig lesbar. Das ist der
 * Grund, warum die Originale als gewöhnliche `.eml`-Dateien im Ordner liegen und nicht in
 * einem eigenen Behälter.
 */

export interface Ausfuhrbefund {
  /** Wohin geschrieben wurde. */
  ordner: string;
  anzahl: number;
  bytes: number;
  siegel: string;
  /** Ob der Bestand dabei nachgerechnet wurde und was herauskam. */
  bestandHeil: boolean;
  hinweis?: string;
}

/** Ein Wert für die Tabelle - Anführungszeichen werden verdoppelt (RFC 4180). */
const feld = (wert: string) => `"${wert.replace(/"/g, '""')}"`;

const SPALTEN: { name: string; art: 'text' | 'zahl' | 'datum'; beschreibung: string }[] = [
  { name: 'Nr', art: 'zahl', beschreibung: 'Fortlaufende Nummer im Archiv' },
  { name: 'ErfasstAm', art: 'datum', beschreibung: 'Zeitpunkt der Aufnahme ins Archiv' },
  { name: 'EntstandenAm', art: 'datum', beschreibung: 'Zeitpunkt der Nachricht' },
  { name: 'Richtung', art: 'text', beschreibung: 'empfangen oder gesendet' },
  { name: 'Absender', art: 'text', beschreibung: 'Absenderadresse' },
  { name: 'Empfaenger', art: 'text', beschreibung: 'Empfaengeradressen, durch Komma getrennt' },
  { name: 'Betreff', art: 'text', beschreibung: 'Betreff der Nachricht' },
  { name: 'MessageId', art: 'text', beschreibung: 'Kennung der Nachricht laut RFC 5322' },
  { name: 'Aufbewahrungsart', art: 'text', beschreibung: 'Geschaeftsbrief oder Buchungsbeleg' },
  { name: 'AufbewahrenBis', art: 'datum', beschreibung: 'Ende der Aufbewahrungsfrist' },
  { name: 'Groesse', art: 'zahl', beschreibung: 'Groesse der Nachricht in Bytes' },
  { name: 'Abdruck', art: 'text', beschreibung: 'SHA-256 ueber die Originaldatei' },
  { name: 'Datei', art: 'text', beschreibung: 'Originaldatei in diesem Ordner' },
  { name: 'Vermerke', art: 'text', beschreibung: 'Spaetere Vermerke zu diesem Eintrag' },
];

/**
 * Schreibt die Ausfuhr.
 *
 * Vorher wird der Bestand nachgerechnet - jede Datei gegen ihren Abdruck. Das dauert,
 * und es ist die Zeit wert: Eine Ausfuhr, die man einer Prüfung übergibt, ohne zu wissen,
 * ob sie vollständig ist, ist die eine Gelegenheit, bei der man es nicht merken darf. Das
 * Ergebnis steht in `siegel.txt`, auch wenn es schlecht ausfällt.
 */
export function erzeugeAusfuhr(
  ziel?: string,
  bedingung: { von?: string; bis?: string } = {},
): Ausfuhrbefund {
  const marke = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ordner = ziel ?? path.join(archivOrdner(), 'ausfuhr', marke);
  fs.mkdirSync(path.join(ordner, 'post'), { recursive: true, mode: 0o700 });

  const alle = alleEintraege();
  const einstellungen = archivEinstellungen();

  // Vermerke den Nachrichten zuordnen, auf die sie sich beziehen.
  const vermerke = new Map<number, string[]>();
  for (const e of alle) {
    if (e.bezugAuf === undefined || !e.vermerk) continue;
    vermerke.set(e.bezugAuf, [...(vermerke.get(e.bezugAuf) ?? []), `${e.erfasstAm}: ${e.vermerk}`]);
  }
  // Der geltende Stand: eine Umtragung ersetzt den ursprünglichen Eintrag.
  const gueltig = new Map<number, Eintrag>();
  for (const e of alle) {
    if (e.bezugAuf === undefined) gueltig.set(e.nr, e);
    else if (e.abdruck) gueltig.set(e.bezugAuf, { ...e, nr: e.bezugAuf });
  }

  const zeilen: string[] = [SPALTEN.map((s) => feld(s.name)).join(';')];
  let anzahl = 0;
  let bytes = 0;
  let fruehestes = '';
  let spaetestes = '';

  for (const [nr, e] of [...gueltig.entries()].sort((a, b) => a[0] - b[0])) {
    if (!e.datei) continue;
    if (bedingung.von && e.entstandenAm < bedingung.von) continue;
    if (bedingung.bis && e.entstandenAm > bedingung.bis) continue;

    const quelle = path.join(archivPostOrdner(), e.datei);
    const name = `${String(nr).padStart(7, '0')}.eml`;
    try {
      fs.copyFileSync(quelle, path.join(ordner, 'post', name));
    } catch {
      // Fehlt die Datei, wird die Zeile trotzdem geschrieben - mit leerem Dateinamen.
      // Eine Prüfung soll sehen, dass hier etwas war und nicht mehr da ist.
    }

    zeilen.push(
      [
        String(nr),
        e.erfasstAm,
        e.entstandenAm,
        e.richtung,
        e.absender,
        e.empfaenger.join(', '),
        e.betreff,
        e.messageId ?? '',
        e.art,
        e.aufbewahrenBis,
        String(e.groesse),
        e.abdruck,
        fs.existsSync(path.join(ordner, 'post', name)) ? `post/${name}` : '',
        (vermerke.get(nr) ?? []).join(' | '),
      ]
        .map(feld)
        .join(';'),
    );
    anzahl++;
    bytes += e.groesse;
    if (!fruehestes || e.entstandenAm < fruehestes) fruehestes = e.entstandenAm;
    if (!spaetestes || e.entstandenAm > spaetestes) spaetestes = e.entstandenAm;
  }

  // CRLF als Zeilenende - so sagt es die index.xml, und so erwarten es die Werkzeuge.
  fs.writeFileSync(path.join(ordner, 'nachrichten.csv'), zeilen.join('\r\n') + '\r\n', 'utf8');
  fs.writeFileSync(
    path.join(ordner, 'index.xml'),
    baueIndex({
      betrieb: einstellungen.betrieb ?? '(nicht angegeben)',
      verantwortlich: einstellungen.verantwortlich ?? '',
      von: (fruehestes || new Date().toISOString()).slice(0, 10),
      bis: (spaetestes || new Date().toISOString()).slice(0, 10),
      anzahl,
    }),
    'utf8',
  );

  const befund = pruefeBestand();
  const heil = befund.kette.heil && befund.fehlend.length === 0 && befund.verfaelscht.length === 0;
  fs.writeFileSync(path.join(ordner, 'siegel.txt'), baueSiegelblatt(befund, anzahl), 'utf8');
  fs.writeFileSync(
    path.join(ordner, 'Verfahrensdokumentation.md'),
    verfahrensdokumentation(),
    'utf8',
  );
  fs.writeFileSync(path.join(ordner, 'LIESMICH.txt'), LIESMICH, 'utf8');

  protokolliere('info', 'archiv', `Ausfuhr erzeugt: ${anzahl} Nachrichten nach ${ordner}`);
  return {
    ordner,
    anzahl,
    bytes,
    siegel: siegel(),
    bestandHeil: heil,
    hinweis: heil
      ? undefined
      : 'Beim Nachrechnen des Bestandes gab es Beanstandungen - siehe siegel.txt.',
  };
}

/** Die Beschreibungsdatei nach dem Beschreibungsstandard. */
function baueIndex(angaben: {
  betrieb: string;
  verantwortlich: string;
  von: string;
  bis: string;
  anzahl: number;
}): string {
  const x = (wert: string) =>
    wert
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const spalten = SPALTEN.slice(1)
    .map((s) => {
      const typ =
        s.art === 'zahl'
          ? '<Numeric/>'
          : s.art === 'datum'
            ? '<Date><Format>YYYY-MM-DD</Format></Date>'
            : '<AlphaNumeric/>';
      return (
        `        <VariableColumn>\n` +
        `          <Name>${x(s.name)}</Name>\n` +
        `          <Description>${x(s.beschreibung)}</Description>\n` +
        `          ${typ}\n` +
        `        </VariableColumn>`
      );
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<DataSet>
  <Version>1.0</Version>
  <DataSupplier>
    <Name>${x(angaben.betrieb)}</Name>
    <Location>${x(angaben.verantwortlich)}</Location>
    <Comment>E-Mail-Archiv, erzeugt von Energy Mail</Comment>
  </DataSupplier>
  <Media>
    <Name>E-Mail-Archiv ${x(angaben.von)} bis ${x(angaben.bis)}</Name>
    <Table>
      <URL>nachrichten.csv</URL>
      <Name>Nachrichten</Name>
      <Description>Archivierte E-Mails (${angaben.anzahl} Datensaetze). Die Originale liegen als .eml-Dateien im Unterordner "post" und sind ueber die Spalte "Datei" zugeordnet.</Description>
      <Validity>
        <Range>
          <From>${x(angaben.von)}</From>
          <To>${x(angaben.bis)}</To>
        </Range>
        <Format>YYYY-MM-DD</Format>
      </Validity>
      <UTF8/>
      <DecimalSymbol>,</DecimalSymbol>
      <DigitGroupingSymbol>.</DigitGroupingSymbol>
      <VariableLength>
        <ColumnDelimiter>;</ColumnDelimiter>
        <RecordDelimiter>&#13;&#10;</RecordDelimiter>
        <TextEncapsulator>"</TextEncapsulator>
        <VariablePrimaryKey>
          <Name>Nr</Name>
          <Description>Fortlaufende Nummer im Archiv</Description>
          <Numeric/>
        </VariablePrimaryKey>
${spalten}
      </VariableLength>
    </Table>
  </Media>
</DataSet>
`;
}

function baueSiegelblatt(
  befund: ReturnType<typeof pruefeBestand>,
  ausgefuehrt: number,
): string {
  const zeilen = [
    'Siegel und Bestandsprüfung',
    '==========================',
    '',
    `Erzeugt am:            ${new Date().toISOString()}`,
    `Ausgeführte Nachrichten: ${ausgefuehrt}`,
    `Einträge in der Kette: ${alleEintraege().length}`,
    `Nachgerechnete Dateien: ${befund.geprueft}`,
    '',
    `Siegel (SHA-256 des letzten Kettengliedes):`,
    `  ${siegel()}`,
    '',
    'Die Kette: ' + (befund.kette.heil ? 'heil.' : `GEBROCHEN — ${befund.kette.grund}`),
    befund.fehlend.length > 0 ? `Fehlende Dateien: ${befund.fehlend.join(', ')}` : 'Keine Datei fehlt.',
    befund.verfaelscht.length > 0
      ? `NICHT MEHR PASSEND: ${befund.verfaelscht.join(', ')}`
      : 'Alle Dateien stimmen mit ihrem Abdruck überein.',
    '',
    'Wozu das Siegel dient',
    '---------------------',
    'Jeder Eintrag im Archiv enthält den Abdruck seines Vorgängers. Wer einen Eintrag',
    'nachträglich ändert, muss alle folgenden neu rechnen - und dabei ändert sich dieser',
    'Wert zwangsläufig. Wer ihn regelmäßig außerhalb dieses Rechners notiert (im',
    'Übergabeprotokoll, beim Steuerberater), hat einen Vergleichswert, den derselbe',
    'Rechner nicht mehr einholen kann.',
    '',
    'Was das Siegel NICHT ist: ein Schutz gegen Änderungen. Wer Verwalterrechte auf',
    'diesem Rechner hat, kann jede Datei überschreiben. Das Siegel macht das erkennbar,',
    'nicht unmöglich. Alles andere wäre eine Behauptung.',
    '',
  ];
  return zeilen.join('\r\n');
}

const LIESMICH = [
  'E-Mail-Archiv - Datenträgerüberlassung',
  '======================================',
  '',
  'Was in diesem Ordner liegt:',
  '',
  '  nachrichten.csv    Die Übersicht. Semikolon getrennt, UTF-8, mit Kopfzeile.',
  '  index.xml          Die Beschreibung dazu nach dem Beschreibungsstandard für die',
  '                     Datenträgerüberlassung. Prüfsoftware liest sie und weiß danach,',
  '                     was in welcher Spalte steht.',
  '  post/              Die Nachrichten im Original, als .eml-Dateien. Der Dateiname',
  '                     ist die laufende Nummer aus der Übersicht; die Spalte "Datei"',
  '                     nennt ihn ebenfalls. Jede gängige Mailanwendung öffnet sie.',
  '  siegel.txt         Der Abdruck der Kette und das Ergebnis der Bestandsprüfung.',
  '  Verfahrensdokumentation.md',
  '                     Wie das Archiv arbeitet - Herkunft der Daten, Fristen,',
  '                     Unveränderbarkeit, was ausdrücklich nicht geleistet wird.',
  '',
  'Die DTD zur index.xml liegt bewusst nicht bei: Sie gehört zum Standard und nicht zu',
  'diesem Programm. Prüfprogramme bringen sie mit.',
  '',
  'Sollte ein Werkzeug die index.xml nicht annehmen, ist der Bestand darum nicht',
  'unlesbar - nachrichten.csv ist eine gewöhnliche Textdatei, und die Originale im',
  'Ordner "post" sind vollständig und für sich lesbar.',
  '',
].join('\r\n');
