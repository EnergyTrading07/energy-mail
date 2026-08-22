import type { Angaben, Erhoben } from './bestandsaufnahme.js';
import type { Befund } from './lage.js';

/**
 * Das Verzeichnis von Verarbeitungstätigkeiten (Art. 30 Abs. 1 DSGVO).
 *
 * ## Warum ausgerechnet dieses Papier fehlt
 *
 * Weil es das langweiligste ist. Es verlangt keine Entscheidung, es kostet nur Zeit, und
 * es fällt niemandem auf, solange nichts passiert. Genau deshalb ist es das erste, wonach
 * eine Aufsichtsbehörde fragt: Wer es hat, hat sich mit der Sache befasst; wer es nicht
 * hat, in aller Regel nicht.
 *
 * Die Ausnahme für kleine Betriebe (Art. 30 Abs. 5) hilft hier übrigens nicht weiter, und
 * das wird oft falsch gelesen: Sie gilt nicht, wenn die Verarbeitung nicht nur gelegentlich
 * erfolgt. Laufende Geschäftskorrespondenz ist so ziemlich der Gegenbegriff zu
 * „gelegentlich".
 *
 * ## Was hier steht
 *
 * Die Verarbeitung, die dieses Programm ausmacht - und nur die. Ein Betrieb hat weitere
 * Tätigkeiten (Lohn, Kundendaten, Bewerbungen), und die gehören in dasselbe Verzeichnis.
 * Das steht auch drin, damit niemand das hier für vollständig hält.
 */

export function verzeichnisText(
  a: Angaben,
  e: Erhoben,
  befund: Befund,
  jetzt = new Date(),
): string {
  const auftrag =
    befund.auftragsverarbeiter.length === 0
      ? '_Keine._'
      : befund.auftragsverarbeiter.map((v) => `- **${v.wer}** — ${v.weil}`).join('\n');

  return `# Verzeichnis von Verarbeitungstätigkeiten

nach Art. 30 Abs. 1 DSGVO — Teil „E-Mail-Verkehr"

**Verantwortlicher:** ${a.betrieb ?? '_(nicht angegeben)_'}
**Anschrift:** ${a.anschrift ?? '_(nicht angegeben)_'}
**Vertreten durch:** ${a.vertreten ?? '_(nicht angegeben)_'}
**Datenschutzbeauftragter:** ${a.datenschutzbeauftragter ?? '_(keiner benannt)_'}
**Stand:** ${jetzt.toISOString().slice(0, 10)}

> Dieses Blatt beschreibt **eine** Verarbeitungstätigkeit: den E-Mail-Verkehr über Energy
> Mail. Ein Betrieb hat weitere — Lohnabrechnung, Kundendaten, Bewerbungen, Zeiterfassung.
> Sie gehören in dasselbe Verzeichnis und stehen hier nicht.

---

## 1. Bezeichnung der Verarbeitung

Führen des geschäftlichen E-Mail-Verkehrs: Abruf, Anzeige, Beantwortung, Ablage und
Versand von Nachrichten${e.archiv ? ', einschließlich der Aufbewahrung nach § 147 AO' : ''}.

## 2. Zwecke der Verarbeitung

- Geschäftliche Korrespondenz mit Kunden, Lieferanten und Behörden
- Anbahnung und Abwicklung von Verträgen
${e.archiv ? '- Erfüllung handels- und steuerrechtlicher Aufbewahrungspflichten (§ 147 AO, § 257 HGB)\n' : ''}${e.verzeichnis ? '- Auffinden interner Ansprechpartner über das Firmenverzeichnis\n' : ''}
## 3. Kategorien betroffener Personen

- Beschäftigte des Betriebs (als Nutzer und als Beteiligte der Korrespondenz)
- Kunden, Interessenten, Lieferanten und deren Beschäftigte
- Behörden und sonstige Dritte, die schreiben oder angeschrieben werden

> Die zweite Gruppe ist die größere und die, an die niemand denkt: Wer einem Betrieb
> schreibt, wird zur betroffenen Person, ohne je gefragt worden zu sein.
${
  e.selbstanmeldung === 'aus'
    ? ''
    : `
> **Achtung, die Nutzer sind hier nicht abschließend die Beschäftigten.** An diesem Dienst
> ist die Selbstanmeldung eingeschaltet (${e.selbstanmeldung === 'offen' ? 'offen, mit Bestätigung über die Mailadresse' : 'Antrag mit Freigabe durch einen Verwalter'}${e.selbstanmeldungDomaenen.length > 0 ? `, begrenzt auf ${e.selbstanmeldungDomaenen.join(', ')}` : ', ohne Begrenzung auf bestimmte Domänen'}). Wer
> dazukommt, entscheidet damit nicht mehr allein die Personalstelle. Prüfen Sie, ob die
> Angabe „unsere Nutzer sind unsere Beschäftigten" oben noch stimmt.
`
}
## 4. Kategorien personenbezogener Daten

- Stammdaten: Name, Mailadresse, Anschrift, Telefonnummer, Funktion, Firma
- Inhaltsdaten: der gesamte Text der Nachrichten und deren Anhänge
- Verkehrsdaten: Absender, Empfänger, Zeitpunkt, Betreff, Kennungen der Nachrichten
- Technische Daten: Zeitpunkte der Anmeldung, Netzadressen im Protokoll
${e.verzeichnis ? '- Aus dem Firmenverzeichnis gelesen: Name, Mailadresse, Telefonnummern, Abteilung\n' : ''}
> **Besondere Kategorien (Art. 9 DSGVO) sind nicht vorgesehen** — aber in Freitext nie
> auszuschließen. Eine Krankmeldung per Mail enthält Gesundheitsdaten, ob das gewollt ist
> oder nicht. Das ist ein Grund für die Zugangsbeschränkungen, nicht gegen sie.

## 5. Kategorien von Empfängern

${auftrag}

${befund.keineAuftragsverarbeitung.length > 0 ? `**Ausdrücklich keine Auftragsverarbeiter:**\n\n${befund.keineAuftragsverarbeitung.map((v) => `- ${v.wer} — ${v.weil}`).join('\n')}\n` : ''}
## 6. Übermittlung in Drittländer

_(Zu prüfen und einzutragen.)_ Maßgeblich ist, wo der Postfachanbieter die Daten
speichert und verarbeitet — nicht, wo er seinen Sitz hat. Bei Microsoft 365 und Google
Workspace ist das eine Einstellung, die man nachsehen kann; Zugriffsmöglichkeiten aus
Drittländern zu Supportzwecken kommen hinzu und stehen in den Unterlagen des Anbieters.

## 7. Löschfristen

| Was | Frist |
|---|---|
| Nachrichten im Postfach | Nach den Regeln des Betriebs; das Programm löscht nichts von selbst. |
${e.archiv ? '| Archivierte Geschäftsbriefe | 6 Jahre ab Schluss des Kalenderjahres (§ 147 Abs. 3 AO) |\n| Archivierte Buchungsbelege | 8 Jahre ab Schluss des Kalenderjahres |\n' : ''}| Nebenbei aufgelesene Adressen im Adressbuch | Ab 2.000 Einträgen fallen die ältesten und seltensten heraus; selbst angelegte nie. |
| Protokoll des Servers | Zwei Dateien im Wechsel, danach überschrieben. |
| Angemeldete Sitzungen | Ruhefrist 14 Tage, Höchstdauer 90 Tage. |
${
  e.selbstanmeldung === 'aus'
    ? ''
    : `| Offene Anmeldeanträge (zurzeit ${e.offeneAntraege}) | Ohne Bestätigung 7 Tage, danach gelöscht; bestätigt und unbeschieden 30 Tage. Gespeichert werden Adresse, Zeitpunkt und die Prüfsumme des Kennworts — keine Netzadresse. |
`
}

## 8. Technische und organisatorische Maßnahmen

Siehe die beiliegende Aufstellung nach Art. 32 DSGVO. Sie ist aus dem laufenden Stand
erhoben und nicht abgeschrieben.

---

## Offene Punkte

Diese Felder kann kein Programm ausfüllen. Sie gehören zum Verzeichnis dazu.

1. **Rechtsgrundlage je Zweck.** Für die Korrespondenz in aller Regel Art. 6 Abs. 1
   lit. b oder f DSGVO, für die Aufbewahrung lit. c. Wer sich auf das berechtigte
   Interesse stützt, sollte die Abwägung einmal aufgeschrieben haben.
2. **Drittlandübermittlung** — siehe Nummer 6.
3. **Wer pflegt dieses Verzeichnis, und wann wurde es zuletzt angesehen?**
4. **Die übrigen Verarbeitungstätigkeiten des Betriebs.**

---

_Erzeugt von Energy Mail. Kein Rechtsrat — die Regelfälle sind abgedeckt, die
Verantwortung bleibt beim Betrieb._
`;
}
