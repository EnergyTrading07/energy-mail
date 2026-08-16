import type { Angaben, Erhoben } from './bestandsaufnahme.js';

/**
 * Die technischen und organisatorischen Maßnahmen (Art. 32 DSGVO).
 *
 * ## Warum das erzeugt wird und nicht abgeschrieben
 *
 * Weil eine TOM-Liste aus einer Vorlage nichts wert ist. Jeder kennt sie: zwei Seiten mit
 * Überschriften wie „Zutrittskontrolle" und „Weitergabekontrolle", darunter Sätze wie
 * „Der Zugang ist durch geeignete Maßnahmen geschützt". Das steht in tausend Ordnern und
 * beschreibt keinen einzigen Betrieb.
 *
 * Was hier steht, ist abgelesen: welches Verfahren tatsächlich verwendet wird, mit welchen
 * Zahlen, wie viele der Nutzer wirklich einen zweiten Faktor eingerichtet haben. Das ist
 * unbequemer - eine Zeile wie „von 12 Nutzern haben 3 einen zweiten Faktor" liest sich
 * anders als „Zwei-Faktor-Authentifizierung ist verfügbar" -, und genau deshalb ist es
 * etwas wert.
 *
 * ## Die Gliederung
 *
 * Nach Art. 32 Abs. 1 lit. a bis d, nicht nach der alten Anlage zu § 9 BDSG. Die
 * Acht-Punkte-Liste von 1990 steht immer noch in fast jeder Vorlage; die Verordnung kennt
 * sie nicht mehr.
 */

export function tomText(a: Angaben, e: Erhoben, jetzt = new Date()): string {
  const anteil = (teil: number, ganz: number) =>
    ganz === 0 ? '—' : `${teil} von ${ganz}`;

  return `# Technische und organisatorische Maßnahmen

nach Art. 32 DSGVO

**Betrieb:** ${a.betrieb ?? '_(nicht angegeben)_'}
**Stand:** ${jetzt.toISOString().slice(0, 10)}
**Erhoben:** vom laufenden System, nicht abgeschrieben

Die mit **(erhoben)** gekennzeichneten Angaben stammen aus dem laufenden Stand des
Systems. Die übrigen sind organisatorisch und wurden angegeben.

---

## a) Pseudonymisierung und Verschlüsselung

| Was | Wie |
|---|---|
| Kennwörter und Zugangsmarken der Postfächer | Verschlüsselt abgelegt, gebunden an das Benutzerkonto des Betriebssystems (DPAPI). **(erhoben: ${e.verschluesselungBereit ? 'eingerichtet' : 'NICHT eingerichtet — Zugangsdaten lägen im Klartext'})** |
| Kennwörter der Nutzer | Nicht gespeichert, sondern als scrypt-Ableitung (N = 2¹⁶, r = 8, p = 1) mit eigenem Salz je Nutzer. Aus der Ablage lässt sich kein Kennwort zurückrechnen. |
| Nachrichteninhalte in der lokalen Ablage | Verschlüsselt. Der Schlüssel jedes Nutzers liegt seinerseits mit dem Serverschlüssel verpackt. |
| Adressbuch, Regeln, gemerkte Suchen | Im Ordner des jeweiligen Nutzers, getrennt von allen anderen. |
| Geheime Schlüssel für OpenPGP und S/MIME | Verschlüsselt, auf Wunsch zusätzlich mit einem Kennwort, das bei jeder Benutzung abgefragt wird. |
| Verbindungen zu Postfach und Verzeichnis | TLS. Der Zertifikatsspeicher des Betriebssystems wird mitgelesen, damit firmeneigene Ausgabestellen gelten. |
| Einstellungssicherung | AES-256-GCM, Schlüssel über scrypt (N = 2¹⁷) aus einem Kennwort, das der Nutzer vergibt. |

Pseudonymisierung findet nicht statt und wäre hier auch nicht sinnvoll: Verarbeitet wird
Korrespondenz, und die ist ihrem Wesen nach zugeordnet.

## b) Vertraulichkeit, Integrität, Verfügbarkeit und Belastbarkeit

### Zugang zum Dienst

| Maßnahme | Stand |
|---|---|
| Anmeldung mit Kennwort | Erforderlich für jeden Zugang. |
| Anmeldebremse | Nach 10 Fehlversuchen je Kennung binnen 15 Minuten, nach 50 je Netzadresse binnen einer Stunde wird verzögert und gesperrt. |
| Zweiter Faktor (TOTP) | **(erhoben: ${anteil(e.mitZweiFaktor, e.nutzer)} Nutzern eingerichtet)**${e.mitZweiFaktor < e.nutzer ? ' — freiwillig; ein Verwalter kann ihn nicht vorschreiben.' : ''} |
| Sitzungssperre | Nach ${e.sperrfristMinuten} Minuten ohne Bedienung; das Wiederöffnen verlangt das Kennwort. |
| Sitzungsdauer | Höchstens 90 Tage, Ruhefrist 14 Tage. Danach ist eine neue Anmeldung nötig. |
| Rollen | **(erhoben: ${anteil(e.verwalter, e.nutzer)} Nutzern sind Verwalter)** Verwaltungsaufgaben sind serverseitig auf sie beschränkt, nicht nur in der Oberfläche. |

### Trennung der Nutzer

Jeder Nutzer hat einen eigenen Ordner, eine eigene Ablage und einen eigenen Schlüssel.
Der Zugriff läuft über einen Kontext, der bei jeder Anfrage gesetzt wird; eine Stelle, die
ihn zu setzen vergäße, bekommt einen Fehler statt fremder Daten.

**(erhoben: ${e.nutzer} Nutzer, ${e.freigaben} ausdrückliche Freigaben)**
Eine Freigabe ist die einzige Art, wie jemand an fremde Post kommt. Sie wird vom
Eigentümer erteilt, ist auf ein Postfach beschränkt und kann auf „nur lesen" begrenzt
werden. Wer im Auftrag sendet, erscheint beim Empfänger als „im Auftrag von" — die
Vertretung ist von außen sichtbar und nicht verdeckt.

### Verfügbarkeit

| Maßnahme | Stand |
|---|---|
| Dateien werden unteilbar geschrieben | Erst daneben, dann umbenannt, mit fsync. Ein Stromausfall hinterlässt keine halbe Datei. |
| Sicherungskopie des letzten heilen Standes | Bei jeder wichtigen Datei („.bak“). |
| Serversicherung | ${a.betreiber === 'selbst' ? 'Durch den Betrieb selbst zu regeln — siehe die offenen Fragen unten.' : `Durch ${a.dienstleister ?? 'den Dienstleister'} zu regeln.`} |

> **Ehrlich benannt:** Die Sicherung liegt vorgabegemäß auf demselben Rechner. Gegen ein
> defektes Laufwerk hilft das nicht. Wohin sie zusätzlich kopiert wird und wann zuletzt
> eine Rücksicherung ausprobiert wurde, ist eine organisatorische Frage und steht unten.

### Integrität

${
  e.archiv
    ? `Das Archiv verkettet jeden Eintrag mit dem Abdruck (SHA-256) des vorigen. Eine nachträgliche Änderung ändert das Siegel am Ende der Kette zwangsläufig. **Das verhindert keine Änderung** — wer Verwalterrechte auf dem Rechner hat, kann jede Datei überschreiben —, es macht sie erkennbar. Damit daraus etwas wird, muss das Siegel regelmäßig außerhalb des Rechners notiert werden. **(erhoben: Archiv eingeschaltet für ${e.archivKonten} Konten)**`
    : 'Das GoBD-Archiv ist nicht eingeschaltet. **(erhoben)**'
}

Aktualisierungen des Programms werden vor dem Einspielen gegen einen hinterlegten
Schlüssel geprüft; eine unsignierte oder veränderte Fassung wird abgelehnt.

## c) Wiederherstellbarkeit

Die Postfächer liegen beim Anbieter, nicht in diesem Programm — es ist ein Fenster
darauf. Geht der Rechner verloren, ist die Post nicht verloren; verloren sind
Einstellungen, Adressbuch, Regeln und ein etwaiges Archiv. Dafür gibt es zwei Wege: die
Einstellungssicherung aus dem Programm (verschlüsselt, für den Umzug auf einen neuen
Rechner) und die Sicherung des Serverordners.

## d) Regelmäßige Überprüfung

| Was | Wie oft | Wer |
|---|---|---|
| Bestandsprüfung des Archivs (jede Datei gegen ihren Abdruck) | ${e.archiv ? '_(festzulegen — Vorschlag: jährlich und vor jeder Betriebsprüfung)_' : 'entfällt'} | _(festzulegen)_ |
| Siegel außerhalb des Rechners notieren | ${e.archiv ? '_(festzulegen — Vorschlag: monatlich)_' : 'entfällt'} | _(festzulegen)_ |
| Nutzerliste durchsehen: wer ist ausgeschieden? | _(festzulegen)_ | _(festzulegen)_ |
| Freigaben durchsehen: gilt jede noch? | _(festzulegen)_ | _(festzulegen)_ |
| Rücksicherung ausprobieren | _(festzulegen)_ | _(festzulegen)_ |

Diese Zeilen sind absichtlich leer. Ein Prüfrhythmus, den ein Programm sich selbst
ausdenkt, ist keiner — er muss von jemandem verantwortet werden, der ihn auch einhält.

---

## Was diese Maßnahmen ausdrücklich nicht leisten

- **Gegen den Verwalter des Rechners helfen sie nicht.** Wer dort Administrator ist, kommt
  an alles heran, was auf diesem Rechner liegt. Das ist keine Lücke dieses Programms,
  sondern die Eigenschaft jedes Programms auf jedem Rechner.
- **Die Verschlüsselung der abgelegten Daten hängt am Benutzerkonto des Betriebssystems.**
  Sie schützt eine kopierte Datei auf einem fremden Rechner. Sie schützt nicht vor jemandem,
  der an dem angemeldeten Rechner sitzt.
- **Der zweite Faktor ist freiwillig.** Ein Verwalter kann ihn nicht vorschreiben.
- **Es gibt keine Verschlüsselung der Festplatte durch dieses Programm.** Dafür ist das
  Betriebssystem zuständig (BitLocker o. ä.), und ohne sie ist ein gestohlener Rechner
  ein gestohlener Datenbestand.

---

_Erzeugt von Energy Mail aus dem tatsächlichen Stand. Bei jeder wesentlichen Änderung neu
zu erzeugen; die alten Fassungen sind aufzubewahren, denn sie beschreiben den Zustand, in
dem die damaligen Daten verarbeitet wurden._
`;
}
