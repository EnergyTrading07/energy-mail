# Datenschutz

Energy Mail ist ein Programm, das auf Ihrem Rechner läuft. Es gibt keinen Dienst dahinter,
kein Konto beim Hersteller und keine Stelle, an der Ihre Post durchgereicht würde.

Dieses Dokument sagt, was das im Einzelnen bedeutet – auch dort, wo die Antwort
unbequem ist.

---

## Was gespeichert wird, und wo

Alles unter `%APPDATA%\@energy-mail\desktop\`. Nichts davon verlässt Ihren Rechner,
außer Sie sichern den Ordner selbst.

### Verschlüsselt

| Datei | Inhalt |
|---|---|
| `accounts.json` | Kennwörter und OAuth-Marken Ihrer Konten |
| `oauth-clients.json` | Ihre bei Google/Microsoft erzeugten Client-Zugangsdaten |
| `schluesselbund.json` | die **geheimen** OpenPGP-Schlüssel |
| `contacts.json` | das Adressbuch – Namen und Adressen aller Korrespondenzpartner, also **Daten Dritter** |
| `ablage.db` (teilweise) | der **Wortlaut** der zuletzt gelesenen Nachrichten: Text, HTML und Anhangsangaben |
| `cache.json` | Ordnerlisten und erste Seiten |
| `sendungen.json` | wartende Sendungen samt Text und Anhängen |
| `wiedervorlage.json` | zurückgestellte Nachrichten |
| `regeln.json`, `etiketten.json`, `suchen.json` | Ihre Einstellungen und gemerkten Suchen |
| `vertraute-absender.json` | wessen Bilder ohne Rückfrage laden dürfen |

Verfahren: AES-256-GCM mit einem 32 Byte langen Zufallsschlüssel. Dieser Schlüssel liegt
in `key.enc` und ist über Windows' `safeStorage` (DPAPI) an Ihr Windows-Benutzerkonto
gebunden. Auf einem anderen Rechner oder unter einem anderen Windows-Konto sind die
Dateien nicht zu entschlüsseln – auch nicht mit einer Kopie des ganzen Ordners.

Das Kennwort eines geheimen OpenPGP-Schlüssels wird **nicht** gespeichert. Es ist die
letzte Schranke und wird bei jedem Öffnen neu abgefragt.

### Nicht verschlüsselt

| Datei | Inhalt |
|---|---|
| `ablage.db` (der Rest) | **Betreff, Absender, Empfänger und Datum** aller abgerufenen Nachrichten, dazu der Suchindex darüber |
| `protokoll/*.log` | Protokoll (siehe unten) |

**Das ist der wichtigste Satz dieses Dokuments:** Verschlüsselt ist, *was* in Ihrer Post
steht – nicht, *dass* und *mit wem* Sie sie gewechselt haben. Wer den Ordner kopiert oder
die Platte ausbaut, findet den Wortlaut Ihrer Nachrichten nicht mehr; die Betreffzeilen
und die Absender findet er sehr wohl.

Warum diese Grenze: An Betreff, Absender und Datum hängen die Nachrichtenliste, das
Sortieren und die Suche. Verschlüsselt man auch sie, lässt sich das Postfach ohne
Verbindung gar nicht mehr anzeigen. Das ist der Tausch, und er wird hier benannt statt
verschwiegen. Wem die Betreffzeilen zu viel sind, dem hilft die Laufwerksverschlüsselung
von Windows (BitLocker) – sie deckt ab, was hier offen bleibt.

**Was die Verschlüsselung nicht leistet:** Sie hängt an Ihrem Windows-Benutzerkonto. Wer
an Ihrer *entsperrten* Sitzung sitzt oder ein Programm unter Ihrem Konto laufen lässt,
dem entschlüsselt Windows genauso wie Energy Mail. Geschützt ist der Ordner, nicht der
laufende Rechner.

### Wie lange, und wie Sie es loswerden

Nichts davon wächst unbegrenzt: `ablage.db` hält die Kopfdaten aller abgerufenen
Nachrichten, aber nur die 2.000 zuletzt gelesenen **Texte**; das Adressbuch verdrängt
nebenbei aufgelesene Adressen ab 2.000 Einträgen (selbst angelegte nie); vom Protokoll
liegen höchstens zwei Stände zu je einer Million Zeichen.

Wegwerfen können Sie den ganzen Bestand über **Extras → „Zwischengespeicherte
Nachrichten…“**. Dort steht zuerst, was liegt – wer nur nachsehen will, geht mit
„Behalten“ wieder hinaus. Beim Leeren wird die Datei neu geschrieben, also auch die
freigewordenen Stellen darin. Konten, Kennwörter, Adressbuch, Regeln und Etiketten
bleiben unangetastet, und die Post selbst liegt ohnehin bei Ihrem Anbieter.

Gelöscht heißt hier tatsächlich gelöscht: Wenn Sie eine Nachricht oder ein ganzes Konto
entfernen, wird der Platz in der Ablage überschrieben und nicht bloß freigegeben. Ohne
diese Vorkehrung stünde der Wortlaut einer gelöschten Nachricht weiter in der Datei, bis
zufällig etwas anderes darüberfällt.

### Beim ersten Start nach der Aktualisierung

Eine bestehende Installation wird einmalig umgestellt: Die vorhandenen Nachrichtentexte
werden verschlüsselt, der Suchindex wird ohne sie neu aufgebaut, und die Ablagedatei wird
anschließend neu geschrieben – damit der alte Klartext auch aus den freigewordenen Stellen
verschwindet. Das dauert unter einer Sekunde und passiert genau einmal; im Protokoll steht
danach eine Zeile darüber. Ihr Bestand bleibt dabei erhalten, es wird nichts neu geladen.

### Die Suche im Nachrichtentext

Sie hat diese Umstellung gekostet, und das gehört hierher: Der Volltextindex speicherte
den Nachrichtentext im Klartext mit – eine unverschlüsselte zweite Fassung jeder gelesenen
Nachricht, gleich neben der verschlüsselten. Man kann den Index haben oder die
Verschlüsselung, nicht beides.

Die lokale Suche findet deshalb Betreff, Absender und Empfänger; im Nachrichtentext sucht
der **Anbieter**. Das steht unter jedem Suchergebnis als Knopf und reicht ohnehin weiter –
die Serversuche erreicht auch die Nachrichten, deren Text nie auf Ihrem Rechner lag, und
das sind die allermeisten.

---

## Was ins Netz geht

Und ausschließlich das:

1. **Ihr Postfachanbieter** – IMAP und SMTP. Das ist der Zweck des Programms.
2. **Serveradressen suchen**, wenn Sie ein Konto anlegen: `autoconfig.<ihre-domain>`,
   `autoconfig.thunderbird.net` und ein DNS-Eintrag. Dabei wird Ihre Mail-Domain
   übertragen, nicht die vollständige Adresse. Ausschließlich über HTTPS.
3. **Aktualisierungsprüfung** bei GitHub, alle sechs Stunden und einmal beim Start.
   Übertragen wird, was jeder HTTPS-Abruf überträgt: Ihre IP-Adresse und die
   Programmfassung.
4. **Entfernte Inhalte einer Nachricht** – aber erst, wenn Sie sie ausdrücklich
   freigeben. Bis dahin werden Bilder, Stilvorlagen und Weiterleitungen zurückgehalten.
   Nach der Freigabe erfährt der Absender Ihre IP-Adresse und den Zeitpunkt; genau davor
   schützt die Zurückhaltung.
5. **Ein-Klick-Abmeldung**, wenn Sie in einer Rundmail auf „Abmelden“ klicken. Dabei geht
   eine Anfrage an die Adresse, die der Absender in der Nachricht angegeben hat.
6. **Wörterbücher der Rechtschreibprüfung**, einmalig, von einem Server von Google. Siehe
   den eigenen Abschnitt unten.

**Was nicht passiert:** keine Telemetrie, keine Nutzungsstatistik, keine Absturzberichte
im Hintergrund, keine Werbekennung, kein Konto beim Hersteller. Es gibt keine Adresse, an
die das Programm von sich aus etwas über Sie senden würde.

### Was ein freigegebenes Bild *nicht* erfährt

Geben Sie entfernte Inhalte frei, dann soll das heißen „lade dieses Bild“ – und nicht
„leg eine Kennung an, die mich wiedererkennt“. Deshalb gilt für jeden Abruf an ein
fremdes Ziel:

- **Kein Keks.** Setzt der Server einen, wird er verworfen; mitgeschickt wird ebenfalls
  keiner. Sonst könnte der Zählpixel in einer Rundmail den in der nächsten wiedererkennen –
  genau das, wogegen die Zurückhaltung gedacht ist, nur einen Schritt später.
- **Kein Verweis** auf die Nachricht, aus der geladen wurde.
- **Keine Programmkennung.** Ohne diese Vorkehrung stünde in jedem Abruf „Energy Mail“
  samt Fassungsnummer – ein Versender, der ein einziges Bild unterbringt, wüsste damit,
  welches Programm in welcher Fassung Sie benutzen.

Was der Absender trotzdem erfährt, und daran ändert nichts etwas: Ihre IP-Adresse und den
Zeitpunkt. Deshalb bleibt die Freigabe eine Entscheidung, die Sie treffen.

---

## Die Rechtschreibprüfung

Sie ist die von Chromium – dieselbe wie im Browser –, und die Wörterbücher, die Windows
nicht mitbringt, lädt Chromium beim ersten Bedarf von einem Server von Google
(`redirector.gvt1.com`). Das ist der einzige Abruf des Programms, der weder Ihrem Postfach
noch der Aktualisierungssuche gilt.

Übertragen wird dabei, was jeder Dateiabruf überträgt: Ihre IP-Adresse und die gewünschte
Sprache, einmalig. **Was Sie schreiben, geht nicht hinaus** – die Prüfung selbst läuft
danach vollständig auf Ihrem Rechner, und was Sie ins eigene Wörterbuch aufnehmen, bleibt
dort.

Wem auch das zu viel ist: **Extras → „Rechtschreibprüfung“** abschalten, dann unterbleibt
der Abruf. Die rote Wellenlinie ist damit ebenfalls weg.

---

## Meldungen über neue Post

In einer Meldung des Betriebssystems stehen Absender und Betreff. Das ist praktisch und
beantwortet die Frage, für die es sie gibt – lohnt sich das Hinsehen?

Es hat aber eine Seite, die nichts mit Ihrem Rechner zu tun hat, sondern mit dem Raum, in
dem er steht: Eine Meldung erscheint über allem, was gerade auf dem Bildschirm ist. Im
Vortrag, in der Bildschirmübertragung einer Besprechung, auf dem Sperrbildschirm, wo
Windows sie im Info-Center aufhebt. Wer daneben steht, liest mit, ohne etwas dafür tun zu
müssen.

Unter **Extras → „Absender und Betreff in Meldungen zeigen“** schalten Sie das ab. Dann
steht in der Meldung nur noch das Konto und „Neue Nachricht“ – und statt dreier Meldungen
eine für den ganzen Eingang.

---

## Das Protokoll

Unter `protokoll/` liegt eine Datei, die festhält, was das Programm tut – damit sich ein
Fehler nachvollziehen lässt. Sie wird bei einer Million Zeichen umgebrochen, es liegen
höchstens zwei Stände.

Bevor eine Zeile hineingeht, läuft sie durch eine Reinigung, die Kennwörter,
Bearer-Marken, Basic-Authentifizierung, Google-Zugriffsmarken, JWTs, IMAP-`LOGIN`-Zeilen,
private Schlüsselblöcke und die lokalen Teile von Mailadressen ersetzt – auch dort, wo
eine Adresse in der Schreibweise einer Web-Adresse steht (`max%40beispiel.de`), wie beim
Löschen eines Kontakts. Ebenfalls draußen bleibt, **wonach Sie gesucht haben**: die Suche
läuft über eine Adresse der Form `/search?q=…`, und ein Suchbegriff sagt oft mehr über
einen Menschen aus als die Nachricht, die er findet. Wo ein Server für mehrere Menschen
läuft, werden IP-Adressen gekürzt festgehalten (`203.0.113.x`) – genug, um Durchprobieren
zu erkennen, zu wenig, um einen Anschluss zu benennen.

Beim Erzeugen eines Fehlerberichts läuft dieselbe Prüfung ein zweites Mal, und wenn dabei
doch noch etwas gefunden wird, steht ein Warnhinweis in der Datei.

Der Bericht wird **nirgendwohin gesendet**. Er landet als Datei bei Ihnen; ob und wohin
Sie ihn weitergeben, entscheiden Sie.

---

## Wenn Sie das Programm entfernen

Die Deinstallation lässt den Datenordner absichtlich stehen – damit eine Neuinstallation
oder eine neue Fassung dort weitermacht, statt alle Konten zu vergessen.

Das heißt aber auch: **Adressbuch und zwischengespeicherte Nachrichten bleiben liegen.**
Verschlüsselt zwar, und der Schlüssel hängt an Ihrem Windows-Konto – wer den Rechner
übernimmt und sich als *Sie* anmelden kann, kommt trotzdem heran, und die Betreffzeilen
in `ablage.db` stehen ohnehin offen.

Wer den Rechner weitergibt oder verkauft, sollte deshalb
`%APPDATA%\@energy-mail\desktop\` von Hand löschen. Der Nachrichtenbestand allein lässt
sich vorher über Extras → „Zwischengespeicherte Nachrichten…“ wegräumen; der Ordner
enthält danach immer noch Adressbuch, Konten und Einstellungen.

---

## Wenn mehrere Menschen denselben Server benutzen

Energy Mail lässt sich auch als Dienst für mehrere Personen betreiben (siehe
BETRIEB.md). Dann gilt zusätzlich:

- Jeder Nutzer hat einen **eigenen Ordner** – eigene Konten, eigene Ablage, eigenes
  Adressbuch. Kein Weg führt an den Bestand eines anderen.
- Was der Browser sich merkt, hängt dagegen an der **Adresse und nicht am Nutzer**.
  Deshalb räumt das Abmelden die Textbausteine weg: sonst fände der Nächste am selben
  Rechner die Formulierungen des Vorigen vor. Einstellungen wie Sortierung oder helle und
  dunkle Ansicht bleiben stehen – sie sagen über niemanden etwas aus.
- Der **Betreiber des Servers** kann technisch an die Ordner aller Nutzer. Er ist damit
  für deren Daten verantwortlich, im Rechtssinn wie im praktischen. Wer einen solchen
  Dienst für andere betreibt, sollte das wissen, bevor er anfängt.

---

## Wenn ein Betrieb ihn für seine Beschäftigten betreibt

Dann ist alles anders als in den Abschnitten oben, und zwar von Grund auf: Nicht mehr
jemand verarbeitet seine eigene Post, sondern ein Betrieb verarbeitet die Post seiner
Beschäftigten und aller, die mit ihnen schreiben. Der Betrieb ist damit **Verantwortlicher**
im Sinne der DSGVO und hat die Pflichten, die daran hängen.

Das Programm hilft dabei, statt es zu verschweigen. Unter **Verwaltung → Datenschutz**
steht, was in diesem Betrieb tatsächlich läuft, und daraus abgeleitet:

- **Wer im Auftrag verarbeitet.** An erster Stelle der Postfachanbieter — dort liegt die
  Post, nicht hier. Bei Microsoft 365 und Google Workspace ist der Vertrag ein fertiges
  Papier in deren Verwaltungsoberfläche, das erstaunlich oft niemand angenommen hat.
- **Wer ausdrücklich keiner ist.** Der Hersteller dieses Programms zum Beispiel: Reine
  Softwareüberlassung ist keine Auftragsverarbeitung. Ein AVV mit ihm wäre ein Vertrag
  über nichts. Erst wenn jemand von außen zu Wartungszwecken an die Daten herankommen
  **kann** — ob er hineinsieht, spielt keine Rolle —, ändert sich das.
- **Welche Unterlagen zu erstellen sind**, und die erstellt es gleich mit: das Verzeichnis
  von Verarbeitungstätigkeiten (Art. 30), die Aufstellung der technischen und
  organisatorischen Maßnahmen (Art. 32) und, wo einer gebraucht wird, ein
  Vertragsentwurf nach Art. 28.

Die Aufstellung der Maßnahmen ist dabei **abgelesen und nicht abgeschrieben**: Dort steht,
wie viele Nutzer es gibt, wie viele davon wirklich einen zweiten Faktor eingerichtet haben
und ob die Zugangsdaten verschlüsselt liegen. Das liest sich unbequemer als „Zwei-Faktor-
Authentifizierung ist verfügbar" — und genau deshalb ist es etwas wert.

Zwei Punkte, die dabei regelmäßig übersehen werden und die im Befund deshalb ausdrücklich
stehen:

> **Ein Archiv, das jede Nachricht aufzeichnet, ist mitbestimmungspflichtig.** § 87 Abs. 1
> Nr. 6 BetrVG erfasst technische Einrichtungen, die zur Überwachung von Verhalten oder
> Leistung *geeignet* sind. Ob überwacht werden soll, spielt keine Rolle. Besteht ein
> Betriebsrat, ist er vorher zu beteiligen.

> **Private Nutzung des Geschäftspostfachs** macht die Sache erheblich schwieriger, weil
> dann Fragen des Fernmeldegeheimnisses hinzukommen. Ein klares Verbot oder eine klare
> Erlaubnis ist der Weg; eine ungeregelte Duldung ist der schlechteste Zustand.

Was dort erzeugt wird, ist **kein Rechtsrat.** Es deckt die Regelfälle ab und ersetzt
niemanden, der dafür einsteht.

---

## Ihre Rechte gegenüber wem?

Dieser Abschnitt gilt für den Einzelplatz — für den Betrieb als Dienst siehe oben; dort
ist der Betrieb der Verantwortliche, und Sie wenden sich an ihn.

Es gibt keine Verarbeitung durch einen Dritten, also auch keinen Verantwortlichen im Sinne
der DSGVO, an den Sie sich wenden müssten: Ihre Daten liegen bei Ihnen. Verantwortlich
für die Verarbeitung Ihrer Post ist Ihr **Postfachanbieter** – dessen Datenschutzerklärung
gilt unverändert weiter.

Für das Adressbuch gilt eine Besonderheit, die man wissen sollte: Es enthält die Adressen
von Menschen, die Ihnen geschrieben haben, und wird beim Lesen von Nachrichten von selbst
gefüllt. Das sind personenbezogene Daten Dritter. Solange sie auf Ihrem Rechner zu
persönlichen Zwecken liegen, greift die Haushaltsausnahme (Art. 2 Abs. 2 lit. c DSGVO);
für eine berufliche Nutzung gelten die üblichen Pflichten Ihres Arbeitgebers.

Deshalb liegt gerade diese Datei verschlüsselt und begrenzt: Ab 2.000 nebenbei
aufgelesenen Adressen fliegen die ältesten und seltensten wieder hinaus – selbst angelegte
Einträge nie. Einzelne Einträge lassen sich im Adressbuch löschen. Wer eine Sicherung
seiner Einstellungen anlegt (Extras → „Einstellungen sichern“), nimmt das Adressbuch
allerdings **im Klartext** mit; der Hinweis beim Sichern sagt das, und die Datei gehört an
einen Ort, den nur Sie erreichen.

---

*Stand: August 2026. Fragen und Ungenauigkeiten bitte als
[Issue](https://github.com/EnergyTrading07/energy-mail/issues) melden.*
