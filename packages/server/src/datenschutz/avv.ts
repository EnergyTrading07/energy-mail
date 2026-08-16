import type { Angaben, Erhoben } from './bestandsaufnahme.js';

/**
 * Die AVV-Vorlage (Art. 28 Abs. 3 DSGVO).
 *
 * ## Für wen sie gedacht ist - und für wen nicht
 *
 * Nicht für den Postfachanbieter. Microsoft und Google unterschreiben keine fremden
 * Verträge; dort ist der AVV ein fertiges Papier, das man annimmt - meist ein Häkchen in
 * der Verwaltung, das nie jemand gesetzt hat. Was ein Betrieb dort braucht, ist nicht
 * diese Vorlage, sondern zehn Minuten in der Verwaltungsoberfläche des Anbieters. Genau
 * das steht in den Hinweisen der Ausfuhr.
 *
 * Sie ist gedacht für den **Serverbetreiber** und für die **Fernwartung** - also für den
 * IT-Dienstleister um die Ecke, der den Rechner betreut. Dort gibt es keine fertigen
 * Papiere, dort wird tatsächlich verhandelt, und dort fehlt der Vertrag am häufigsten.
 *
 * ## Was in Art. 28 Abs. 3 zwingend steht
 *
 * Acht Punkte, lit. a bis h, und alle acht stehen unten. Das ist kein Formalismus: Fehlt
 * einer, ist der Vertrag unvollständig, und die Bußgeldnorm (Art. 83 Abs. 4 lit. a) trifft
 * beide Seiten - den Verantwortlichen wie den Verarbeiter.
 */

export interface Vertragspartner {
  /** Wofür er verantwortlich ist - „Betrieb des Servers", „Fernwartung". */
  rolle: string;
  name: string;
}

export function avvText(
  a: Angaben,
  e: Erhoben,
  partner: Vertragspartner,
  jetzt = new Date(),
): string {
  return `# Vertrag über die Verarbeitung personenbezogener Daten im Auftrag

nach Art. 28 DSGVO

**zwischen**

${a.betrieb ?? '_(Name des Betriebs)_'}
${a.anschrift ?? '_(Anschrift)_'}
${a.vertreten ? `vertreten durch ${a.vertreten}` : '_(vertreten durch)_'}

— nachstehend **Verantwortlicher** —

**und**

${partner.name || '_(Name des Auftragnehmers)_'}
_(Anschrift)_
_(vertreten durch)_

— nachstehend **Auftragsverarbeiter** —

**Gegenstand:** ${partner.rolle}
**Entwurfsstand:** ${jetzt.toISOString().slice(0, 10)}

---

## § 1 Gegenstand und Dauer

(1) Der Auftragsverarbeiter erbringt für den Verantwortlichen folgende Leistung:
**${partner.rolle}**. Dabei verarbeitet er personenbezogene Daten im Auftrag.

(2) Der Vertrag läuft, solange die Leistung erbracht wird. Er endet mit ihr, ohne dass es
einer Kündigung bedarf; § 8 bleibt davon unberührt.

(3) Der Verantwortliche kann diesen Vertrag jederzeit kündigen, wenn der
Auftragsverarbeiter gegen ihn verstößt.

## § 2 Art, Zweck und Umfang der Verarbeitung

(1) **Art der Verarbeitung:** Speichern, Aufbewahren, Auslesen und - im Rahmen der
Wartung - Ansehen von Daten. Eine Verarbeitung zu eigenen Zwecken des
Auftragsverarbeiters findet nicht statt.

(2) **Zweck:** Ausschließlich die Erbringung der in § 1 genannten Leistung.

(3) **Kategorien betroffener Personen:** Beschäftigte des Verantwortlichen sowie alle
Personen, die mit ihm in Korrespondenz stehen - Kunden, Interessenten, Lieferanten,
Behörden und deren Beschäftigte.

(4) **Kategorien personenbezogener Daten:** Stammdaten (Name, Mailadresse, Anschrift,
Telefonnummer, Funktion), Inhaltsdaten (der vollständige Text der Nachrichten und ihrer
Anhänge), Verkehrsdaten (Absender, Empfänger, Zeitpunkt, Betreff), Zugangsdaten zu
Postfächern sowie technische Protokolldaten.

> **Hinweis zum Umfang.** Wer an einen Mailbestand herankommt, kommt an alles heran:
> Vertragsverhandlungen, Beschwerden, Krankmeldungen, Bewerbungen. Besondere Kategorien
> nach Art. 9 DSGVO sind nicht vorgesehen, in Freitext aber nie auszuschließen. Dieser
> Vertrag ist deshalb kein Formular unter vielen.

## § 3 Weisungsgebundenheit (Art. 28 Abs. 3 lit. a)

(1) Der Auftragsverarbeiter verarbeitet die Daten ausschließlich auf dokumentierte
Weisung des Verantwortlichen. Dieser Vertrag ist die erste Weisung; weitere ergehen in
Textform.

(2) Hält der Auftragsverarbeiter eine Weisung für rechtswidrig, teilt er das unverzüglich
mit und darf sie bis zur Klärung aussetzen.

(3) Eine Übermittlung in ein Drittland erfolgt nur auf Weisung oder aufgrund einer
Rechtspflicht; im letzteren Fall unterrichtet er den Verantwortlichen vorher, sofern das
Recht es nicht verbietet.

## § 4 Vertraulichkeit (Art. 28 Abs. 3 lit. b)

(1) Der Auftragsverarbeiter setzt nur Personen ein, die zur Vertraulichkeit verpflichtet
sind oder einer angemessenen gesetzlichen Verschwiegenheitspflicht unterliegen.

(2) Er verpflichtet sie vor der ersten Tätigkeit und weist sie auf die Besonderheiten
dieses Auftrags hin.

(3) Diese Verpflichtung gilt über das Ende des Vertrages und über das Ende des jeweiligen
Beschäftigungsverhältnisses hinaus.

## § 5 Maßnahmen nach Art. 32 (lit. c)

(1) Der Auftragsverarbeiter trifft die Maßnahmen nach Art. 32 DSGVO und weist sie nach.
Sie sind in **Anlage 1** aufgeführt.

(2) Die Maßnahmen unterliegen dem technischen Fortschritt. Der Auftragsverarbeiter darf
sie ändern, solange das Schutzniveau nicht unterschritten wird; wesentliche Änderungen
teilt er vorher mit.

(3) Der Verantwortliche hat seinerseits Maßnahmen getroffen; sie sind in **Anlage 2**
aufgeführt und aus dem laufenden System erhoben, nicht abgeschrieben.

## § 6 Unterauftragsverarbeiter (lit. d, Abs. 2 und 4)

(1) Der Auftragsverarbeiter darf weitere Verarbeiter nur mit vorheriger Zustimmung in
Textform hinzuziehen.

(2) Bereits genehmigt sind: _(einzutragen — Rechenzentrum, Sicherungsdienst, Fernzugriffslösung)_

(3) Er verpflichtet jeden Unterauftragsverarbeiter auf dieselben Pflichten und haftet für
dessen Verhalten wie für eigenes.

(4) Wechselt oder kommt einer hinzu, teilt er das so rechtzeitig mit, dass der
Verantwortliche widersprechen kann.

## § 7 Unterstützung (lit. e und f)

(1) Der Auftragsverarbeiter unterstützt den Verantwortlichen bei Anfragen betroffener
Personen. Er beantwortet sie nicht selbst, sondern leitet sie unverzüglich weiter.

(2) Er unterstützt ihn bei den Pflichten aus Art. 32 bis 36 - insbesondere bei
Datenschutz-Folgenabschätzung und Meldepflichten.

(3) **Er meldet jede Verletzung des Schutzes personenbezogener Daten unverzüglich, in
jedem Fall binnen 24 Stunden nach Kenntnis.** Die Frist ist kürzer als die 72 Stunden aus
Art. 33 und muss es sein: Der Verantwortliche braucht Zeit, um selbst zu melden.

(4) Die Meldung enthält, was bekannt ist: Art des Vorfalls, betroffene Kategorien und
ungefähre Zahl, wahrscheinliche Folgen, ergriffene Maßnahmen.

## § 8 Löschung und Rückgabe (lit. g)

(1) Nach Ende der Leistung gibt der Auftragsverarbeiter alle Daten heraus oder löscht sie
- nach Wahl des Verantwortlichen.

(2) Er löscht auch alle Kopien, insbesondere in Sicherungen. Bestehen für Sicherungen
technische Aufbewahrungszyklen, teilt er deren Dauer mit; bis zur Löschung bleiben die
Daten gesperrt.

(3) Eine Ausnahme gilt nur, soweit das Recht der Union oder der Mitgliedstaaten eine
Speicherung vorschreibt. In diesem Fall benennt er die Vorschrift.

(4) Die Löschung wird auf Verlangen bestätigt.

## § 9 Nachweise und Prüfungen (lit. h)

(1) Der Auftragsverarbeiter stellt alle Informationen bereit, die zum Nachweis der
Einhaltung erforderlich sind.

(2) Er ermöglicht Überprüfungen - auch vor Ort - und wirkt daran mit. Sie werden mit
angemessener Frist angekündigt und stören den Betrieb nicht unangemessen.

(3) Anerkannte Testate und Zertifizierungen können herangezogen werden. Sie ersetzen eine
Prüfung nicht, wenn ein konkreter Anlass besteht.

## § 10 Schlussbestimmungen

(1) Änderungen bedürfen der Textform. Das gilt auch für die Aufhebung dieser Klausel.

(2) Ist eine Bestimmung unwirksam, bleibt der Vertrag im Übrigen wirksam.

(3) Bei Widersprüchen zwischen diesem Vertrag und anderen Vereinbarungen geht dieser vor,
soweit es um den Datenschutz geht.

---

**Ort, Datum**                                  **Ort, Datum**


_______________________________                 _______________________________
Verantwortlicher                                Auftragsverarbeiter

---

## Anlage 1 — Maßnahmen des Auftragsverarbeiters

_(Vom Auftragnehmer auszufüllen. Ein Verweis auf „übliche Maßnahmen" genügt nicht — nach
Art. 28 Abs. 3 lit. c müssen sie benannt und nachweisbar sein.)_

Mindestens zu beschreiben:

- Wer beim Auftragnehmer kommt an die Daten heran, und wie wird das begrenzt?
- Wie erfolgt der Fernzugriff, und wird er protokolliert?
- Wo liegen Sicherungen, wie lange, und wer kann sie lesen?
- Wie werden ausgeschiedene Mitarbeiter des Auftragnehmers ausgeschlossen?
- Wie wird ein Vorfall erkannt und binnen 24 Stunden gemeldet (§ 7 Abs. 3)?

## Anlage 2 — Maßnahmen des Verantwortlichen

Siehe die beiliegende Aufstellung nach Art. 32 DSGVO. Sie ist aus dem laufenden Stand
erhoben: ${e.nutzer} Nutzer, ${e.konten} Postfächer, Zugangsdaten
${e.verschluesselungBereit ? 'verschlüsselt abgelegt' : '**unverschlüsselt — hier besteht Handlungsbedarf**'}.

---

> **Dies ist ein Entwurf, kein unterschriftsreifer Vertrag.** Er deckt die acht Punkte aus
> Art. 28 Abs. 3 ab und ist so formuliert, dass beide Seiten ihn lesen können. Was er nicht
> kennt, ist Ihr Einzelfall: Haftung, Vergütung, Kündigungsfristen und das Verhältnis zum
> Hauptvertrag stehen bewusst nicht darin. Bevor er unterschrieben wird, gehört er einem
> Menschen vorgelegt, der dafür einsteht.
`;
}
