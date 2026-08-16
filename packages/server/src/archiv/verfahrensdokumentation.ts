import { alleEintraege, archivEinstellungen, siegel } from './archiv.js';
import { FRISTEN } from './fristen.js';

/**
 * Die Verfahrensdokumentation - erzeugt, nicht geschrieben.
 *
 * ## Warum das Programm sie schreibt
 *
 * Weil die GoBD sie verlangen (Rz. 151 ff.) und weil sie in den meisten Betrieben fehlt.
 * Nicht aus Nachlässigkeit: Sie zu verfassen setzt voraus, dass jemand genau weiß, was
 * die Software tut - und das weiß im Betrieb üblicherweise niemand. Also unterbleibt sie,
 * und in der Prüfung steht man ohne da.
 *
 * Was hier herauskommt, ist der **technische Teil**, und der lässt sich erzeugen: Er
 * steht in diesem Programm und nirgends sonst. Er enthält die tatsächlichen
 * Einstellungen, nicht Beispiele - welche Konten mitgeschrieben werden, welche Fristen
 * gerechnet werden, wie viele Nachrichten darin liegen.
 *
 * ## Was er nicht enthält, und das steht auch darin
 *
 * Den organisatorischen Teil: wer im Betrieb zuständig ist, wie entschieden wird, was
 * aufbewahrungspflichtig ist, was bei einem Personalwechsel geschieht. Das kann kein
 * Programm wissen. Dafür stehen unten die Fragen, die zu beantworten sind - eine
 * Dokumentation mit ehrlichen Lücken ist mehr wert als eine, die vollständig aussieht
 * und erfunden ist.
 */

export function verfahrensdokumentation(jetzt = new Date()): string {
  const e = archivEinstellungen();
  const eintraege = alleEintraege();
  const nachrichten = eintraege.filter((x) => x.bezugAuf === undefined && x.datei);
  const aelteste = nachrichten[0]?.entstandenAm?.slice(0, 10) ?? '—';
  const juengste = nachrichten.at(-1)?.entstandenAm?.slice(0, 10) ?? '—';

  return `# Verfahrensdokumentation — E-Mail-Archivierung

**Betrieb:** ${e.betrieb ?? '_(nicht angegeben)_'}
**Verantwortlich:** ${e.verantwortlich ?? '_(nicht angegeben)_'}
**Erzeugt am:** ${jetzt.toISOString().slice(0, 19).replace('T', ' ')} Uhr
**Programm:** Energy Mail

Dieses Papier ist der **technische Teil** einer Verfahrensdokumentation nach GoBD
(Rz. 151 ff.). Es ist vom Programm selbst erzeugt und gibt den tatsächlichen Zustand
wieder, keine Beispielangaben. Der organisatorische Teil steht am Ende — er ist
auszufüllen und kann nicht erzeugt werden.

---

## 1. Was archiviert wird

Archiviert wird die Post der folgenden Konten:

${e.konten.length === 0 ? '- _keines — die Archivierung ist zurzeit ausgeschaltet_' : e.konten.map((k) => `- \`${k}\``).join('\n')}

Für Konten, die hier nicht stehen, wird **nichts** aufgezeichnet. Das ist ausdrücklich so
gebaut: Die Aufbewahrungspflicht trifft geschäftliche Post; ein privates Postfach
unbemerkt mitzuschreiben wäre gegenüber dem Nutzer und gegenüber jedem, der ihm schreibt,
nicht vertretbar.

Aufgezeichnet wird in beide Richtungen:

- **Eingehend** — sobald die Postfachüberwachung eine neue Nachricht meldet, und zwar
  bevor der Nutzer sie zu Gesicht bekommt. Er kann sie danach lesen, verschieben oder
  löschen; am Archiv ändert das nichts.
- **Ausgehend** — im Augenblick des Versands, mit genau den Bytes, die hinausgegangen
  sind. Nicht mit einer nachgebauten Fassung: Die wäre nicht die, die der Empfänger
  bekommen hat.

Abgelegt wird die **vollständige Nachricht im Original** — alle Kopfzeilen, der Text in
seiner ursprünglichen Kodierung, alle Anhänge. Kein Ausdruck, keine PDF-Fassung, keine
Zusammenfassung.

## 2. Wann aufgezeichnet wird

Zeitgleich mit Empfang und Versand. Es gibt keinen Zwischenschritt, in dem eine Nachricht
darauf wartet, dass jemand sie freigibt — und damit auch keine Gelegenheit, an ihr etwas
zu ändern, bevor sie ins Archiv kommt.

Läuft das Programm nicht, kommt auch keine Nachricht an und geht keine hinaus. Eine
Lücke kann daher nur entstehen, wenn Post über einen **anderen Weg** bearbeitet wird —
über die Weboberfläche des Anbieters etwa oder ein zweites Mailprogramm. Das ist die
wichtigste organisatorische Frage weiter unten.

## 3. Fristen

| Aufbewahrungsart | Frist |
|---|---|
| Handels- und Geschäftsbriefe | ${FRISTEN.geschaeftsbrief} Jahre |
| Buchungsbelege (z. B. Rechnungen) | ${FRISTEN.buchungsbeleg} Jahre |
| Ohne Aufbewahrungspflicht | — |

Gerechnet wird **ab dem Schluss des Kalenderjahres**, in dem die Nachricht entstanden ist
(§ 147 Abs. 4 AO), nicht ab ihrem Datum. Eine Nachricht vom 3. Februar und eine vom
28. Dezember desselben Jahres laufen am selben Tag ab.

Voreingestellt ist \`${e.vorgabe}\`. Eine Nachricht lässt sich nachträglich in eine andere
Art umtragen; die Frist kann sich dabei **verlängern, aber nie verkürzen**. Sonst ließe
sich eine unbequeme Nachricht dadurch loswerden, dass man sie kurz vor einer Prüfung zur
Privatpost erklärt.

Gelöscht wird **nichts von selbst.** Abgelaufene Nachrichten werden angezeigt; entfernt
werden sie erst, wenn jemand es ausdrücklich anstößt. Ihr Eintrag in der Kette bleibt
dabei stehen — sonst entstünde eine Lücke, und niemand könnte sagen, ob dort etwas ablief
oder etwas verschwand.

## 4. Unveränderbarkeit

Jeder Eintrag enthält den Abdruck (SHA-256) der Nachricht und den Abdruck des vorigen
Eintrags. Wer einen Eintrag in der Mitte ändert, müsste alle folgenden neu rechnen — und
dabei ändert sich der letzte Abdruck, das **Siegel**, zwangsläufig.

**Stand zum Zeitpunkt dieses Papiers**

- Einträge in der Kette: ${eintraege.length}
- davon Nachrichten: ${nachrichten.length}
- Zeitraum: ${aelteste} bis ${juengste}
- Siegel: \`${siegel()}\`

Nachträgliche Ergänzungen — ein Vermerk, eine Umtragung — ändern den ursprünglichen
Eintrag nicht, sondern kommen als eigener Eintrag ans Ende und verweisen auf ihn. Beim
Lesen wird zusammengesetzt, was zusammengehört; genau so liest man auch ein Kassenbuch
mit Berichtigungen.

> **Was das nicht leistet.** Wer Verwalterrechte auf diesem Rechner hat, kann jede Datei
> überschreiben — auch die Kette. Kein Programm auf einem gewöhnlichen Rechner kann das
> verhindern. Die Kette macht eine Änderung **erkennbar**, nicht unmöglich. Damit daraus
> etwas wird, muss das Siegel regelmäßig **außerhalb dieses Rechners** notiert werden;
> siehe die organisatorischen Fragen.

## 5. Auffinden und Auswerten

Der Bestand ist über die Oberfläche nach Betreff, Beteiligten, Zeitraum und
Aufbewahrungsart durchsuchbar. Jede Nachricht lässt sich im Original ansehen und
herunterladen; dabei wird ihr Abdruck nachgerechnet und die Anzeige verweigert, wenn er
nicht mehr passt.

Für eine Prüfung erzeugt das Programm eine **Datenträgerüberlassung (Z3)**: ein Ordner mit
den Originalen als \`.eml\`-Dateien, einer Übersichtstabelle, einer Beschreibungsdatei nach
dem Beschreibungsstandard, dem Siegel und diesem Papier.

## 6. Was dieses Programm ausdrücklich NICHT leistet

- **Es macht niemanden „GoBD-konform".** Das gibt es für Software nicht. Die GoBD sagen
  in Rz. 179 ausdrücklich, dass Zertifikate und Testate Dritter gegenüber der
  Finanzverwaltung keine Bindungswirkung entfalten. Ordnungsmäßig ist ein Verfahren, und
  zu dem gehört der Betrieb.
- **Es entscheidet nicht, was aufbewahrungspflichtig ist.** Eine Terminabsprache ist ein
  Geschäftsbrief, eine Mittagsverabredung nicht, und beide sehen gleich aus.
- **Es erfasst nur, was durch dieses Programm läuft.**
- **Es ersetzt keine Sicherung.** Ein defektes Laufwerk nimmt das Archiv mit.

---

## 7. Organisatorischer Teil — auszufüllen

Diese Fragen kann kein Programm beantworten. Sie gehören zur Verfahrensdokumentation
dazu, und ohne sie ist sie unvollständig.

1. **Wer ist zuständig?** Wer richtet die Archivierung ein, wer prüft, dass sie läuft,
   und was geschieht bei einem Personalwechsel?
2. **Gibt es andere Wege für Geschäftspost?** Weboberfläche des Anbieters, Telefon,
   Fax, ein zweites Mailprogramm — was davon wird benutzt, und wie wird die dortige Post
   aufbewahrt?
3. **Wie wird entschieden, was ein Buchungsbeleg ist?** Wer trägt um, und woran erkennt
   er es?
4. **Wie wird mit privater Post im Geschäftspostfach umgegangen?** Ist sie erlaubt? Wenn
   ja: Wie wird sie von der geschäftlichen getrennt?
5. **Wohin wird das Siegel notiert, und wie oft?** Ein Siegel, das nur auf demselben
   Rechner steht, beweist nichts.
6. **Wie wird gesichert?** Wohin, wie oft, und wann wurde zuletzt eine Rücksicherung
   ausprobiert?
7. **Wer darf ins Archiv sehen?** Es enthält die gesamte Geschäftskorrespondenz.

---

_Erzeugt von Energy Mail. Dieses Papier ist bei jeder wesentlichen Änderung neu zu
erzeugen; die alten Fassungen sind aufzubewahren, denn sie beschreiben den Zustand, in
dem die damaligen Daten entstanden sind._
`;
}
