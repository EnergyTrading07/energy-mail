# Änderungen

Was sich von Fassung zu Fassung geändert hat, in Sätzen statt in Commit-Titeln.

Der Abschnitt zur jeweiligen Fassung wird beim Veröffentlichen als Beschreibung der
GitHub-Release übernommen – dort liest ihn die Aktualisierungskarte im Programm vor.
Vorher stand darin nichts: die Karte meldete eine neue Fassung, ohne sagen zu können,
was sich geändert hat.

---

## Unveröffentlicht

### Nutzer können sich selbst anmelden

Bisher gab es genau einen Weg zu einem Konto: Ein Verwalter legt es an. Für einen Server
mit acht Kollegen ist das richtig; sobald es mehr werden, ist es die Stelle, an der ein
Mensch zum Flaschenhals wird.

Jetzt entscheidet der Verwalter unter **Verwaltung → Selbstanmeldung** zwischen drei
Betriebsarten:

- **Aus** – wie bisher, und das bleibt die Vorgabe. Ein Server, der aktualisiert wird,
  öffnet sich nicht von selbst.
- **Antrag mit Freigabe** – wer will, trägt sich ein; hereinkommen tut er erst, wenn ein
  Verwalter zustimmt. Die Bürgschaft bleibt, nur die Tipparbeit wandert.
- **Offen mit Mailbestätigung** – wer seine Adresse über den Bestätigungslink nachweist,
  ist angemeldet.

Dazu ein Domänenfilter: Steht dort `firma.de`, kommt niemand von außen bis zum Antrag.

**Die dritte Betriebsart ist ohne Systemversand nicht zu haben.** Ohne Bestätigungsmail
hieße „offen" schlicht: jeder, der ein Formular ausfüllt – und der könnte sich ein Konto
auf die Adresse eines anderen anlegen. Wird der Sendeserver später abgeschaltet, fällt der
Dienst hörbar auf „Antrag mit Freigabe" zurück statt stillschweigend offen zu bleiben.

### Drei Riegel für die offene Selbstanmeldung

Wer die Registrierung im offenen Netz öffnet, lässt Fremde auf seinen Server — und ein
Konto heißt dort, dass jemand bestimmt, wohin dieser Server Verbindungen aufbaut. Das war
unbedenklich, solange ein Verwalter jedes Konto anlegte; offen ist es das Gegenteil.

**Postfachserver nur im offenen Netz.** Ein Fremder trug bisher `192.168.2.1:80` als
IMAP-Server ein und las an der Fehlermeldung ab, ob dort etwas horcht — eine Abtastung des
fremden Netzes, ausgeführt vom Server selbst und aus dessen Sicht von innen. Geprüft wird
jetzt die aufgelöste IP-Adresse und nicht der Name (sonst genügte ein A-Eintrag auf
`192.168.2.1`), und zwar **jede** zurückgegebene, samt IPv4-in-IPv6-Schreibweise. Bei
Betriebsart „offen" ist der Riegel fest an und nicht abwählbar; sonst bleibt er aus, damit
ein Betrieb mit eigenem Mailserver im Haus nichts verliert.

**Bekannte Wegwerfadressen werden abgewiesen**, samt Unterdomänen — sonst wäre die Liste
mit einem Punkt zu umgehen. Eine Adresse, die zehn Minuten lebt, macht die Mailbestätigung
wertlos. Dazu eine eigene Sperrliste für das, was die eingebaute nicht kennt.

**Eine Höchstzahl für Nutzer** (Vorgabe 50). Jeder Nutzer kostet Speicher und bis zu drei
dauerhafte IMAP-Verbindungen; ohne Grenze entscheidet darüber, wer sich zuerst anmeldet.

### Die Desktop-Fassung arbeitet jetzt mit einem Server

**Das ist die größte Änderung dieser Fassung, und sie ändert etwas Grundsätzliches.** Bis
hierher brachte das Programm seinen eigenen Server mit: Es startete ihn auf 127.0.0.1,
legte Konten, Schlüssel und Ablage in den Benutzerordner und meldete niemanden an – ein
Rechner, ein Mensch. Wer daneben die Browser-Fassung benutzte, hatte einen zweiten,
getrennten Bestand.

Jetzt ist die Hülle ein Fenster auf einen Server. Beim ersten Start fragt sie nach dessen
Adresse, danach meldet man sich an wie im Browser – und sieht dieselben Postfächer,
dieselben Regeln, dieselben Etiketten. Es gibt nur noch einen Bestand, und er liegt dort,
wo der Server liegt.

> **Bestehende Einzelplatz-Installationen erreichen ihre Daten damit nicht mehr aus dem
> Programm heraus.** Sie liegen weiterhin unter `%APPDATA%\@energy-mail\desktop\` und
> lassen sich über „Extras → Einstellungen sichern" aus einer älteren Fassung mitnehmen;
> eingelesen wird die Sicherung anschließend auf dem Server. Wer keinen Server hat, bleibt
> auf der vorigen Fassung.

Was die Hülle weiterhin selbst tut, ist alles, was ein Browser nicht kann:
Benachrichtigungen des Betriebssystems, das Symbol im Infobereich, Autostart, das Fenster
ohne Adressleiste, die Selbstaktualisierung, der Zertifikatsspeicher von Windows und der
Weg durch den Firmenproxy.

**Unverschlüsselt geht nur zum eigenen Rechner.** Über diese Verbindung läuft ein
Anmeldekennwort und danach jede Nachricht; `http://` zu einem Server im Netz wird deshalb
abgewiesen und nicht bloß angemerkt. Die Adresse aus der Einstellungsdatei wird bei jedem
Start neu geprüft – sonst ließe sich das Programm durch das Ändern einer Zeile auf einen
fremden Server umleiten, auf dem dann jemand ein Anmeldefenster zeichnet.

Den Server wechselt man später über **Extras → Server wechseln…**.

### „Angemeldet bleiben"

Neu im Anmeldefenster. **Ohne Haken ist die Anmeldung jetzt an das Fenster gebunden** – der
Keks bekommt kein Verfallsdatum mehr und ist weg, sobald der Browser schließt. Bisher
bekam jede Anmeldung neunzig Tage mit, auch die an einem fremden Rechner.

Mit Haken gilt sie ein Jahr und übersteht Neustarts. Dann entfällt für diese Sitzung
allerdings auch die Bildschirmsperre nach Untätigkeit – sonst wäre es ein halbes
Versprechen: Die Anmeldung überlebte, aber beim ersten Öffnen stünde die Kennwortabfrage
da. Der Hinweis dazu erscheint, sobald der Haken gesetzt ist.

### Die Desktop-Fassung zum Herunterladen – vom eigenen Server

Unter **Einstellungen → Für den Rechner** steht die Installationsdatei bereit, sofern der
Betreiber eine hinterlegt hat. Sie kommt vom eigenen Server und nicht von einer fremden
Seite: Für einen Betrieb ist genau das meist der Grund, selbst zu betreiben.

Bereitgestellt wird über einen Ordner im Datenverzeichnis (`downloads/`), den die
Verwaltung mit Pfad und Inhalt anzeigt. **Einen Weg zum Hochladen gibt es bewusst nicht** –
eine Route, über die sich ausführbare Dateien auf den Server schreiben lassen, wäre aus
einem übernommenen Verwalterkonto heraus die Erlaubnis, an alle Arbeitsplätze ein fremdes
Programm zu verteilen.

### „Kennwort vergessen" – ohne Umweg über einen Menschen

Sobald sich Leute selbst anmelden, vergessen sie ihre Kennwörter auch selbst. Bisher führte
der einzige Weg zurück über einen Verwalter; jetzt fordert man im Anmeldefenster einen Link
an und vergibt selbst ein neues.

**Der zweite Faktor bleibt dabei stehen.** Das ist der wichtigste Satz dazu: Ein zweiter
Faktor deckt gerade den Fall ab, dass jemand an das Kennwort gekommen ist. Ein Weg, der
beides zugleich zurücksetzt, träfe ausgerechnet die Vorsichtigen – es genügte, einmal an ihr
Postfach zu kommen. Wer sein Telefon verloren hat, geht weiterhin zum Verwalter.

Der Link gilt **eine Stunde** (nicht 24 wie bei der Registrierung: Er öffnet ein Konto, das
es schon gibt), lässt sich einmal verwenden und meldet niemanden an. Es gilt immer nur eine
Marke je Konto – wer zehnmal klickt, hat nicht zehn Schlüssel in zehn Mails liegen. Beim
Setzen werden alle offenen Sitzungen beendet.

**Jeder Kennwortwechsel entwertet, was offensteht.** Ohne das überstünde eine Marke, die
vorher angefordert wurde, genau diesen Wechsel: Der Angreifer bestellt sie, der
Kontoinhaber merkt etwas und ändert sein Kennwort – und die alte Marke setzt das frische
wieder außer Kraft. Das gilt für den eigenen Wechsel wie für das Zurücksetzen durch einen
Verwalter.

Auch hier verrät das Formular nichts: Die Antwort ist immer dieselbe, und es geht in **allen**
Fällen eine Mail hinaus – bei einem gesperrten Konto („wenden Sie sich an den Betreiber"),
bei einer unbekannten Adresse („hier besteht kein Zugang"). Das schließt den Zeitkanal und
hilft nebenbei dem, der sich in der Adresse vertan hat. Der Einplatznutzer der Desktop-Hülle
ist über diesen Weg nicht erreichbar.

### Das Anmeldefenster hat einen Umschalter und eine Sprachwahl

**Anmelden und Konto anlegen stehen nebeneinander**, statt dass das Anlegen als Link unter
der Fußnote steht. Für jemanden, der zum ersten Mal vor diesem Fenster sitzt, ist das
Anlegen der Regelfall. Der Umschalter erscheint nur, wo es tatsächlich zwei Wege gibt.

**Ein Fehler, den erst die längere Karte sichtbar gemacht hat:** Die Zugangsfläche wuchs
mit ihrem Inhalt über den Schirm hinaus, und weil `body` bei einem Programmfenster auf
`overflow: hidden` steht, ließ sich nichts davon scrollen. Auf einem Bildschirm mit 700
Punkten Höhe war der Knopf „Zugang beantragen" damit unerreichbar – mit der Maus wie mit dem
Rad. Die Fläche ist jetzt selbst der Scrollbereich.

**Die Sprache lässt sich jetzt vor der Anmeldung umstellen.** Bisher lag die Wahl in den
Einstellungen – also hinter der Anmeldung. Wer vor einem Fenster sitzt, dessen Sprache er
nicht liest, kommt genau deshalb nicht an die Stelle, an der er sie ändern könnte. Das
trifft nicht den, der hier ein Konto hat, sondern den neuen Kollegen am ersten Tag.
Gespeichert wird das wie bisher im Browser, ohne Kennung und ohne Serverbezug.

### Der Dienst hat einen eigenen Absender

Bisher verschickte Energy Mail ausschließlich im Auftrag eines angemeldeten Menschen, über
dessen Postfach. Eine Bestätigungsmail geht aber an jemanden, der noch kein Konto hat – sie
geht vom Dienst aus, und der war bisher kein Absender. Unter **Verwaltung → Absender des
Dienstes** wird ein eigenes Postfach eingetragen (`noreply@firma.de` oder ähnlich); das
Kennwort liegt verschlüsselt wie jedes andere. Unverschlüsselt versendet dieser Weg nicht:
entweder TLS ab Verbindungsaufbau oder STARTTLS, das erzwungen wird.

### Was daran Sicherheit ist

**Das Formular verrät nicht, wer hier ein Konto hat.** Ob die Adresse schon vergeben ist,
ob ein Antrag läuft – nach außen sieht alles gleich aus. Wer die Adresse wirklich besitzt,
bekommt stattdessen eine Mail; die ist zugleich die Warnung, falls er es nicht selbst war.

**Der Bestätigungslink wird aus der eingerichteten öffentlichen Adresse gebaut, nie aus der
Anfrage.** Den Host-Kopf bestimmt der Anfragende; ein Link daraus wäre eine echte, vom
richtigen Server verschickte Mail, deren Link auf den Rechner eines Angreifers zeigt.

**Der Link meldet niemanden an.** Auch dann nicht, wenn das Konto in diesem Augenblick
entsteht. Er liegt in einem Postfach, und wer darauf Zugriff hat, ist nicht zwangsläufig
der, dem das Konto gehört – das Kennwort bleibt der zweite Nachweis.

**Die Antwortzeit verrät auch nichts.** Die Kennwortprüfsumme wird immer gerechnet, auch
wenn schon feststeht, dass gar kein Antrag entsteht. Sonst wäre die Dauer die Auskunft, die
das Formular gerade nicht geben darf: eine fünftel Sekunde für eine unbekannte Adresse,
nichts für eine bekannte. Dieselbe Vorkehrung hat die Anmeldung seit jeher.

**Der Bestätigungslink steht hinter dem Doppelkreuz** (`…/#bestaetigung=…`) und nicht als
Abfrageparameter. Ein Fragment verlässt den Browser nie: Die Marke landet damit in keinem
Zugriffsprotokoll auf dem Weg – nicht im Vorbau, nicht im Dienst – und geht auch in keiner
Referrer-Kopfzeile mit. Die Oberfläche nimmt sie zusätzlich sofort aus der Adresszeile.

**Eine Bremse am Anschluss:** fünf Anträge je Stunde, zwanzig Einlöseversuche. Gezählt wird
gesalzen und gehasht, wie bei der Anmeldebremse – die Anschlusskennung selbst steht
nirgends.

**Der Datenschutzhinweis ist auf 4.000 Zeichen begrenzt.** Er geht über einen Weg hinaus,
der ohne Anmeldung erreichbar sein muss; ohne Grenze wäre ein versehentlich
hineinkopiertes Dokument ein Abruf, den jeder beliebig oft auslösen kann.

**Kein Kennwort im Klartext, zu keinem Zeitpunkt.** Zwischen Formular und Konto liegen
Stunden bis Tage; der Antrag hält von der ersten Sekunde an nur die Prüfsumme.

### Was daran Datenschutz ist

Ein Antrag speichert Adresse, Zeitpunkt, Kennwortprüfsumme und den Nachweis, dass die
Datenschutzhinweise angezeigt wurden – keine Netzadresse, kein Browserkennzeichen. Alles
davon verfällt von selbst: unbestätigt nach einer Woche, unbeschieden nach dreißig Tagen.
Ein abgelehnter Antrag wird gelöscht und nicht vermerkt; eine Liste abgelehnter Bewerber
führt dieser Dienst bewusst nicht.

Der Hinweis über dem Absendeknopf ist vom Betreiber änderbar und muss angehakt werden – am
Server geprüft, nicht nur im Formular. Und die Datenschutzunterlagen (Verwaltung →
Datenschutz) nennen die Betriebsart jetzt mit: Steht die Selbstanmeldung offen, stimmt die
Angabe „unsere Nutzer sind unsere Beschäftigten" womöglich nicht mehr.

## 0.4.0

### Sicherheit

**Eine gemeldete Lücke in einer Abhängigkeit ist überbrückt.** `deepmerge-ts` unter 8.0.0
läuft beim Zusammenführen rekursiver Objektgraphen den Stapel leer (GHSA-ggr8-5vv4-36mx).
Der Weg dorthin führt über `mailparser` — also über das, was fremde Post verarbeitet.

**Der Anfragerumpf ist an den offenen Wegen begrenzt.** Anmelden, zweite Stufe und
Entsperren nahmen bis zu 40 MB entgegen, obwohl Adresse und Kennwort ein paar hundert Byte
sind. Der Rumpf wird eingelesen, *bevor* die Anmeldebremse greifen kann — die hängt an der
Adresse darin. Jetzt 4 KB.

**Ein dritter Riegel gegen Anfragen von fremden Seiten.** Der Herkunftsriegel muss
Anfragen ohne `Origin` durchlassen, weil das eigene Fenster seine Seite genauso lädt.
Unterscheiden ließ sich beides bisher nicht; jetzt über `Sec-Fetch-Site`.

### Ein belegter Port hält die Anwendung nicht mehr auf

Port 4000 war fest verdrahtet. Hielt ihn ein anderes Programm — und 4000 ist ein
ausgesprochen gebräuchlicher Port für Entwicklungsserver —, zeigte Energy Mail ein
Fehlerfenster und war damit fertig: kein Ausweg, keine Einstellung. Jetzt wird ein freier
Port gesucht. Auf welchem die Anwendung mit sich selbst spricht, geht niemanden etwas an.

### Neunundsiebzig deutsche Reste in den fremdsprachigen Oberflächen

Die Sprachprüfung meldete „kein Befund", und die Kataloge waren vollständig — nur prüfte
sie das Falsche. Sie sieht, was übersetzbar *ist*; was übersetzbar sein *müsste* und es
nicht ist, kann sie nicht sehen.

Am auffälligsten waren 27 Attribute — `aria-label`, `title`, `placeholder` —, also
ausgerechnet das, was ein Vorleseprogramm vorliest: Die Nachrichtenliste kündigte sich auf
Türkisch als „Nachrichtenliste" an. Und ein Satz stand halb übersetzt da: „No connection.
Gezeigt wird der zuletzt geholte Stand von deinem Rechner."

**Die Anrede ist vereinheitlicht.** Es standen 43 siezende Meldungen neben 6 duzenden,
beide im selben Fenster. Jetzt siezt alles.

1218 Texte in neun vollständigen Katalogen, vorher 1131. Damit es nicht nachwächst, bricht
die Sprachprüfung jetzt bei deutschem Text, der gar nicht erst durch den Übersetzer geht.

### Ein Fehler, den die Gesamtansicht verbarg

Der Vorabruf der nächsten Nachricht prüfte auf das eine Postfach und arbeitete mit dem
anderen. In der gewöhnlichen Ansicht ist das dasselbe; in der Gesamtansicht nicht — dort
kommt das Postfach aus der Herkunft der gelesenen Nachricht. Stand die noch nicht, ging
ein Abruf ins Leere.

### Unter der Haube

- **Ein Prüfer** (ESLint) läuft jetzt bei jedem Bau mit. Er hat den Fehler oben gefunden,
  dazu vier unsichtbare Zeichen im Quelltext, fünf tote Einbindungen und zwei Fehler, die
  ihre Ursache fallen ließen.
- **Neun Prüfungen am laufenden Programm.** Sie starten die fertige Anwendung und sehen
  nach, ob ein benutzbares Fenster dasteht — genau die Sorte Fehler, die weder Typen noch
  Bau noch Prüfungen sehen, und an der dieses Programm bisher am häufigsten gestolpert ist.
- **Fünf Routengruppen** sind aus der 4132 Zeilen langen `app.ts` ausgezogen. Beim Archiv
  war die Aufteilung vorher halb: der Inhalt lag längst getrennt, nur die Wege dorthin
  nicht.

---

### Ein Ort für Einstellungen

Es gab keinen. Was eine Einstellung ist, lag an vier Stellen: in der Titelleiste (Ansicht,
und die Sprache nur im Browserbetrieb), an einem Zahnrad neben jedem Konto, als Wand aus
elf gleich aussehenden Textknöpfen im Fuß der Seitenleiste, und im Anwendungsmenü der
Desktop-Hülle (Sprache, Autostart, Infobereich, Meldungsvorschau, Rechtschreibung). Wer
etwas suchte, musste wissen, in welcher dieser vier Welten es wohnt — und in der Hülle
stand es woanders als im Browser, obwohl es dieselbe Anwendung ist.

Jetzt gibt es **ein Einstellungsfenster** (Strg+,) mit zehn Bereichen in fünf benannten
Gruppen: Darstellung · Postfach (Konten, Regeln, Abwesenheit) · Sicherheit (OpenPGP,
S/MIME) · Aufbewahrung (Archiv, Bestand) · Programm (Anwendung, Nutzer, Anmeldung). Die
Bereiche sind dieselben Bausteine, die vorher eigene Fenster waren — sie zeichnen sich nur
als Abschnitt statt als Fenster. Es gibt weiterhin je eine Fassung von ihnen, keine
Nachbauten.

**Zwei Löcher sind dabei zugegangen.** Die Ansicht kannte immer drei Werte — hell, dunkel,
„folgt dem System" —, der Umschalter in der Titelleiste konnte aber nur zwischen den ersten
beiden kippen: Wer einmal geklickt hatte, kam nie wieder zurück. Und die vier Schalter der
Hülle (Infobereich, Autostart, Meldungsvorschau, Rechtschreibung) waren im Browserbetrieb
überhaupt nicht erreichbar. Beides steht jetzt in beiden Betriebsarten an derselben Stelle;
geschrieben werden die Schalter der Hülle weiterhin nur vom Hauptprozess.

Die **Sprache** ebenso: bisher in der Hülle nur im Menü, im Browser nur in der Titelleiste —
und dort wurde die Wahl zwar gelesen, aber von keiner Stelle je geschrieben. Neun gepflegte
Kataloge hingen damit allein an der Spracheinstellung des Browsers.

### Der Fuß der Seitenleiste ist wieder ein Fuß

Elf gleich lange Wörter untereinander sind keine Liste, sondern eine Wand: „Abwesenheit"
stand zwischen „Adressbuch" und „Schlüssel", „Abmelden" neben „Archiv". Weil das Formular
zum Hinzufügen eines Kontos mit darin lag, brauchte der Fuß eine eigene Bildlauffläche über
60 % der Fensterhöhe.

Geblieben sind drei Griffe und eine Auskunft: „Offen" (Arbeit, die aussteht), „Adressbuch"
(ein Nachschlagewerk), „Einstellungen" (der Weg zu allem Übrigen) und eine Zeile, die sagt,
unter welchem Namen man angemeldet ist — mit Anmeldung, Sperren und Abmelden dahinter. Ein
Konto kommt jetzt am Ende der Kontenliste hinzu statt im Fuß zwischen „Nutzer" und „Mein
Konto".

Eine laufende **Abwesenheitsnotiz** bleibt sichtbar: Sie ist der eine Zustand, den man
vergisst und der dann monatelang Fremden erzählt, man sei im Urlaub. Sie meldet sich als
eigene Fläche im Fuß, aber nur solange wirklich geantwortet wird.

### Knöpfe: aus sieben Sorten werden vier

`.btn`, `.secondary`, `.danger`, `.gefahr-schlicht`, `.link-btn`, dazu zwei Regeln, die
Knöpfe je nach Umgebung heimlich umfärbten. Jetzt: **primär** (die eine Sache, die dieses
Fenster tun soll), **sekundär** (eine gleichrangige Wahl daneben), **leise** (Bänke wie die
über einer geöffneten Nachricht) und **Warnung** (Unumkehrbares, als Umriss statt gefüllt).
`gefahr-schlicht` war ein zweites „Warnung" unter anderem Namen und ist es geworden. Dabei
fiel ein stiller Fehler auf: Der Knopf „Alles Freigegebene löschen" im Archiv trug die
Klasse `secondary gefaehrlich`, für die es nie eine Regel gab — er sah aus wie jeder
andere.

### Doppelt Vorhandenes entfernt

„Zwischengespeicherte Nachrichten…" im Menü der Hülle tat dasselbe wie die Tafel „Bestand"
im Einstellungsfenster, über dieselben zwei Aufrufe — nur eben nicht im Browserbetrieb. Der
Menüpunkt und seine neunzig Zeilen sind weg.

---

Ergebnis einer Durchsicht des gesamten Quellbaums auf Lücken und Unvollständigkeit. Der
Baum trug keine einzige TODO-Marke; fast jeder Fund stammt aus dem Abgleich zwischen dem,
was ein Kommentar zusagt, und dem, was der Code tut.

### Eine gescheiterte geplante Nachricht ging ersatzlos verloren

**Behoben.** `setAufgabeVerfahren` war geschrieben, exportiert und dokumentiert („der
Aufrufer legt sie als Entwurf ab") — und wurde nirgends im Programm gesetzt. Der Haken
blieb damit für immer leer, der Aufruf ein Nichts. Nach fünf Fehlschlägen wurde der
Eintrag gelöscht und der Nachrichtenkörper war weg; die einzige Spur war eine Zeile im
Protokoll. Genau diesen Verlust beschreibt der Kommentar in derselben Datei als behoben —
eingebaut war nur die eine Hälfte, der Wiederholungszähler.

Jetzt gilt: Gelöscht wird erst, wenn der Körper **nachweislich woanders liegt**. Die
Rettung legt ihn als Entwurf ins Postfach und meldet zurück, ob das geglückt ist; misslingt
sie, bleibt der Eintrag stehen und wird weiter versucht. Dazu zählt fehlendes Netz jetzt
anders als ein abgewiesener Empfänger — zwanzig statt fünf Versuche, dieselbe Unterscheidung,
die die Wiedervorlage längst trifft. Fünf Versuche waren in anderthalb Stunden aufgebraucht;
wer abends auf „morgen früh" stellte und über Nacht kein Netz hatte, verlor die Nachricht,
obwohl an ihr nichts falsch war.

### Ein verzögerter Versand wurde beim Einstellen nicht geprüft

Der Körper wanderte ungeprüft in die Warteschlange; geprüft wurde erst beim Auslösen, Tage
später, wenn niemand mehr davorsitzt. Wer eine geschützte Nachricht mit Anhang auf morgen
legte, bekam „geplant" bestätigt und erfuhr nie, dass sie nicht hinausging. Beide Wege
teilen sich jetzt dieselbe Vorabprüfung. Ein Zeitpunkt in der Vergangenheit wird abgewiesen
statt stillschweigend zu „sofort" gemacht, einer über fünf Jahre voraus ebenfalls.

### Eingabefehler beim Senden kamen als 502 zurück

Ein fehlender Schlüssel oder ein Anhang bei geschütztem Versand ist eine Sache der Eingabe.
Der umschließende Fang setzte darüber pauschal 502 — „die Gegenstelle hat versagt", eine
Antwort, die zum erneuten Versuch einlädt, der niemals helfen kann. Fehler, die ihren Rang
kennen, behalten ihn jetzt.

### Geschützter Versand trägt Anhänge

Bisher wurde abgewiesen, sobald ein Anhang dabei war. Beim **Unterschreiben** geht er jetzt
mit: Der unterschriebene Teil ist ein mehrteiliger MIME-Umschlag, und die Unterschrift deckt
Text und Dateien zusammen ab — ein Schutz, der nur den Text erfasste und die Dateien offen
danebenlegte, wäre schlimmer als keiner. Gilt für OpenPGP wie für S/MIME.

Beim **Verschlüsseln** bleibt die Grenze, jetzt aber genau benannt: Der Leser dieser
Anwendung gibt entschlüsselten Inhalt unmittelbar als Text aus, statt ihn als MIME zu
zerlegen; verschlüsselte Anhänge kämen heil an, stünden hier aber als Quelltext da.

### Der Schlüssel eines Nutzers lässt sich wechseln

Die Struktur dafür stand von Anfang an — Generationen im Eintrag, Generation im Format jedes
Geheimnisses — nur gab es den Vorgang nicht. Ein abhandengekommener Nutzerschlüssel war
nicht austauschbar. Neu: `nutzerWerkzeug.js schluessel-wechseln <adresse>`. Alte Generationen
bleiben lesbar und wandern mit, sobald ihr Datensatz ohnehin neu geschrieben wird; die
Meldung sagt ausdrücklich, was der Wechsel **nicht** tut.

### Vertraute Absender lassen sich wieder zurücknehmen

„Von diesem Absender immer laden" war eine Einbahnstraße: Server und Schnittstelle konnten
die Liste immer schon herausgeben und Einträge daraus entfernen, nur rief es niemand auf.
Wer einmal freigegeben hatte, sah nie wieder, wen — und konnte es nicht widerrufen. Die
Liste steht jetzt in den Kontoeinstellungen, neben der Lesebestätigung.

### Im Browser gibt es eine Sprachwahl

Die Umschaltung war geschrieben und wurde von keiner Stelle aufgerufen; gelesen wurde ein
Wert, den nichts je schrieb. Damit entschied allein die Browsereinstellung, und neun
gepflegte Kataloge waren anders nicht erreichbar. Die Auswahl steht in der Titelleiste — nur
im Browser: In der Hülle entscheidet das Menü, und eine Richtlinie, die sich örtlich
überstimmen lässt, ist keine.

### Der gespeicherte Nachrichtenbestand ist auch im Browser einzusehen

Von 141 Serverwegen hatten genau zwei kein Gegenstück in der Oberfläche: nachsehen und
leeren. Erreichbar waren sie nur über das Menü der Desktop-Hülle. Jetzt steht „Bestand" in
der Seitenleiste — erst die Zahlen, dann die Frage.

### Kleineres

- Das Löschen eines Kontos räumt jetzt auch dessen Wiedervorlagen und vorgemerkte Sendungen
  ab. Bisher blieben sie liegen: eine Wiedervorlage, die sich nicht öffnen ließ, und eine
  Sendung, die zu ihrem Termin auf „Das Konto gibt es nicht mehr" lief.
- Der Hinweis, dass ein Ordner Etiketten nicht behält, kommt beim Öffnen des Etikettenmenüs
  statt erst nach dem ersten vergebenen Etikett.
- Zwei Wege nahmen die Seitengröße weiterhin ungeprüft entgegen — darunter der, den die
  Oberfläche bei jedem Ordnerwechsel benutzt. `?pageSize=1000000` holte die Kopfdaten einer
  Million Nachrichten.
- Das Protokoll meldete beim Entfernen aller Freigaben eines Nutzers stets „(0)".
- Vorzeitiges Zurückholen einer Wiedervorlage prüft, ob sie zum Konto im Pfad gehört.
- Siebzehn tote Ausfuhren entfernt, die nirgends verwendet wurden.

---

## 0.3.1

### Sicherheit: ein gewöhnlicher Nutzer kam in die Verwaltung

**Behoben.** Wer angemeldet war, erreichte sämtliche Verwaltungswege, indem er einen
einzigen Buchstaben der Adresse in Prozentschreibweise schrieb:

```
GET /verwaltung/nutzer     →  403, richtig abgewiesen
GET /%76erwaltung/nutzer   →  200, vollständige Nutzerliste
```

**Die Ursache** liegt an einer Stelle, an der zwei Sichten auf dieselbe Anfrage
auseinanderfallen: Fastifys Router entschlüsselt den Pfad, bevor er eine Route sucht,
lässt `request.url` dabei aber unverändert. Der Riegel verglich die rohe Adresse, fand
kein „/verwaltung" darin und ließ die Anfrage durch — während die Route dahinter
ordnungsgemäß lief.

**Die Tragweite** reichte weiter als die Nutzerliste. Über denselben Weg standen alle
Verwaltungswege offen: Nutzer anlegen, Kennwörter zurücksetzen, sich selbst zum Verwalter
machen. Und wer ein Kennwort zurücksetzen kann, kann sich als dieser Mensch anmelden —
der Weg führte vom gewöhnlichen Konto bis in fremde Postfächer.

Betroffen war ausschließlich der **Serverbetrieb mit mehreren Nutzern**. Auf dem
Einzelplatz gibt es nur einen Nutzer, und der ist ohnehin Verwalter.

Maßgeblich ist jetzt die getroffene Route und nicht die geschriebene Adresse. Eine Prüfung
hält den Fall fest — sie fällt durch, sobald jemand zur alten Fassung zurückkehrt.

### Eine unbrauchbare Seitengröße hob die Begrenzung auf

`?pageSize=abc` ergab NaN, und `slice(-NaN)` ist in JavaScript nicht „nichts", sondern
**alles**. Aus einer Begrenzung wurde damit ihr Gegenteil, lautlos:

- Die **Suche** holte die Kopfdaten jeder Nachricht in jedem durchsuchten Ordner — und gab
  am Ende null Treffer zurück, weil dieselbe Zahl weiter unten in `slice(0, NaN)` steckte.
- Die **Absenderübersicht** nahm statt einer Stichprobe den ganzen Ordner.
- Am schwersten wog **Regeln anwenden**: Sie liefen nicht über die neuesten zweihundert
  Nachrichten, sondern über den gesamten Ordner. Regeln verschieben und löschen.

Zahlen aus einer Anfrage werden jetzt geprüft und mit einer klaren Meldung abgewiesen; die
Bibliothek darunter fällt zusätzlich auf ihre Voreinstellung zurück, statt „unbegrenzt"
daraus zu machen.

### Eingefügter Text verriet dem Absender, dass er eingefügt wurde

Beim Einfügen aus der Zwischenablage entstand das fremde HTML im angezeigten Dokument —
also holte der Browser jedes Bild darin sofort, bevor die Reinigung es entfernen konnte.
Wer einen Abschnitt aus einer Werbemail in eine Antwort einfügte, bestätigte damit dem
Absender den Empfang. Für Zitate war derselbe Fehler längst behoben; der Weg über die
Zwischenablage war übersehen worden. Aufgeräumt wird jetzt in beiden Fällen abseits.

### Archiv: eine geteilte Datei konnte zu früh verschwinden

Dieselbe Nachricht in zwei archivierten Postfächern ergibt zwei Einträge, die sich eine
Datei teilen. Ihre Aufbewahrungsfristen können auseinanderlaufen — sechs Jahre als
Geschäftsbrief, acht als Buchungsbeleg. Das Aufräumen sah nur den ablaufenden Eintrag und
löschte die gemeinsame Datei; der Beleg, der noch zwei Jahre aufzubewahren war, gab nichts
mehr her. Gelöscht wird jetzt erst, wenn kein Eintrag mehr auf die Datei wartet.

### Kleineres

- Ein Fehler beim Abruf warf nicht mehr die **gemeinsame IMAP-Verbindung** weg. Bisher
  genügte „Nachricht nicht gefunden", um sie zu schließen — das kostete den nächsten
  Abruf einen vollständigen Neuaufbau und riss nebenher laufende Abrufe mit.
- Fehler, die ihren eigenen Rang kennen (etwa die 403 des Dateiauslieferers gegen
  Pfadausbrüche), werden nicht mehr als **500** gemeldet und nicht mehr mit Stapelspur
  protokolliert.
- Der Hinweistext im Fenster „Start gescheitert" wird maskiert wie jeder andere Wert
  daneben.

---

## 0.3.0

Dreierlei: eine neue Gestalt für Programm und Browserfassung, das Ergebnis einer
vollständigen Durchsicht auf Produktionsreife – und der Umbau vom Einzelplatzprogramm zu
einem Dienst, der von überall über den Browser erreichbar ist.

### Datenschutz: die Unterlagen, und wer sie überhaupt braucht

Der Punkt hieß auf der Liste „AVV-Vorlage". Eine Vorlage ist auch dabei — aber sie ist
das Unwichtigste daran.

**Der Grund:** Ein Stapel Vorlagen ist die bequemste Art, jemanden im Stich zu lassen. Er
hat danach mehr Papier als vorher und weiß immer noch nicht, was er unterschreiben muss,
was er beim Anbieter holen muss und was er getrost weglassen kann. Viele Anbieter legen
einen AVV bei, weil er professionell aussieht; der Kunde unterschreibt, heftet ab — und
besorgt die Verträge nicht, die er wirklich braucht.

**Deshalb steht die Entscheidung vor der Vorlage.** Unter *Verwaltung → Datenschutz* steht,
wer hier Verantwortlicher ist, wer im Auftrag verarbeitet — und, das ist die nützlichste
Liste des Fensters, **wer ausdrücklich keiner ist**. Reine Softwareüberlassung ist keine
Auftragsverarbeitung: Wer ein Programm kauft und auf dem eigenen Rechner betreibt, lässt
niemanden für sich verarbeiten. Ein AVV mit dem Hersteller wäre ein Vertrag über nichts.
Erst wenn jemand von außen zu Wartungszwecken an die Daten herankommen **kann** — ob er
hineinsieht, spielt keine Rolle —, ändert sich das.

An erster Stelle steht der **Postfachanbieter**, und für ihn liegt bewusst kein Entwurf
bei: Microsoft und Google unterschreiben keine fremden Verträge. Ihr Vertrag ist fertig
und liegt in deren Verwaltungsoberfläche, wo ihn erstaunlich oft niemand angenommen hat.
Was dort zu tun ist, steht im Deckblatt.

**Erzeugt wird, was sich erzeugen lässt:** das Verzeichnis von Verarbeitungstätigkeiten
(Art. 30), die Aufstellung der technischen und organisatorischen Maßnahmen (Art. 32) und
— nur dort, wo einer gebraucht wird — ein Vertragsentwurf nach Art. 28 mit allen acht
Punkten aus Absatz 3.

Die Maßnahmenliste ist dabei **abgelesen und nicht abgeschrieben**. Jeder kennt die
Vorlagen mit „Der Zugang ist durch geeignete Maßnahmen geschützt"; hier steht „3 von 12
Nutzern haben einen zweiten Faktor eingerichtet". Das liest sich unbequemer, und genau
deshalb ist es etwas wert. Es ist zugleich die Auszahlung der letzten elf Punkte: Was dort
gebaut wurde — Anmeldebremse, Sitzungssperre, Rollen, Nutzertrennung, verschlüsselte
Ablage, Freigaben, Archiv —, steht hier mit den wirklichen Zahlen.

**Zwei Punkte, die fast jeder Betrieb übersieht,** stehen ausdrücklich im Befund: Ein
Archiv, das jede Nachricht aufzeichnet, ist nach § 87 Abs. 1 Nr. 6 BetrVG
mitbestimmungspflichtig — die *Eignung* zur Verhaltenskontrolle genügt, die Absicht ist
gleichgültig. Und private Nutzung des Geschäftspostfachs macht die Sache erheblich
schwieriger; eine ungeregelte Duldung ist der schlechteste Zustand.

**Kein Rechtsrat**, und das steht in jedem erzeugten Papier. Die Regelfälle sind abgedeckt;
wer dafür einstehen muss, sollte darübersehen.

### Das Archiv nach GoBD

Geschäftspost ist aufzubewahren — sechs Jahre für Geschäftsbriefe, acht für
Buchungsbelege. Eine Mail ist ein Geschäftsbrief wie jeder andere, und ein Postfach ist
kein Archiv: Man darf darin löschen und verschieben, und das soll man auch.

**Der Satz, den andere Anbieter weglassen, steht hier im Fenster:** Kein Programm macht
jemanden „GoBD-konform". Die GoBD sagen es in Randziffer 179 selbst — Zertifikate Dritter
entfalten gegenüber der Finanzverwaltung keine Bindungswirkung. Ordnungsmäßig ist ein
Verfahren, nicht ein Programm. Was hier gebaut ist, ist der technische Teil davon.

**Wie es arbeitet.** Je Konto eingeschaltet — ohne diesen Haken geschieht gar nichts. Danach
wird jede ein- und ausgehende Nachricht **im Original** abgelegt: alle Kopfzeilen, alle
Anhänge, keine PDF-Fassung. Eingehend, bevor der Nutzer sie zu Gesicht bekommt; ausgehend
mit genau den Bytes, die hinausgingen.

**Die Fristen rechnen ab dem Schluss des Kalenderjahres** (§ 147 Abs. 4 AO), nicht ab dem
Datum. Eine Rechnung vom 3. Februar und eine vom 28. Dezember desselben Jahres laufen am
selben Tag ab — das ist die Stelle, an der sich fast jeder vertut, und sie steht deshalb
als eigenes, für sich geprüftes Modul da. Umtragen verlängert die Frist, **verkürzen kann
sie niemand**: Sonst ließe sich eine unbequeme Nachricht dadurch loswerden, dass man sie
kurz vor der Prüfung zur Privatpost erklärt.

**Unveränderbarkeit, ehrlich benannt.** Jeder Eintrag trägt den Abdruck des vorigen; wer
einen in der Mitte ändert, müsste alle folgenden neu rechnen, und das **Siegel** am Ende
ändert sich dabei zwangsläufig. Was das nicht leistet, steht überall daneben, wo es
auftaucht: Wer Verwalterrechte hat, kann jede Datei überschreiben. Die Kette macht eine
Änderung **erkennbar, nicht unmöglich** — und dafür muss das Siegel außerhalb des Rechners
notiert werden. Eine Nachricht, die nicht mehr zu ihrem Abdruck passt, wird gar nicht erst
angezeigt.

**Für die Betriebsprüfung** entsteht auf Knopfdruck eine Datenträgerüberlassung (Z3): die
Originale als `.eml`, eine Übersichtstabelle, die Beschreibungsdatei nach dem
Beschreibungsstandard, das Siegel — und die **Verfahrensdokumentation**, die das Programm
aus den tatsächlichen Einstellungen selbst schreibt. Ihr organisatorischer Teil steht als
Liste von sieben Fragen darin, unbeantwortet: Eine Dokumentation mit ehrlichen Lücken ist
mehr wert als eine, die vollständig aussieht und erfunden ist.

**Geprüft wird vor allem, was schiefgehen soll.** Die Fristen gegen von Hand gerechnete
Daten; die Kette, indem sie absichtlich verfälscht wird — geändert, neu gesiegelt,
entnommen; die Beschreibungsdatei mit einem echten XML-Leser, Spalte für Spalte gegen die
Tabelle gehalten. Ein Befund kam dabei heraus: Ein Vermerk über das Archiv selbst zählte
in der Suche als Nachricht mit und verfälschte jede Zählung und jeden Zeitraum.

**Offen benannt:** Erfasst wird nur, was durch dieses Programm läuft — wer nebenher die
Weboberfläche des Anbieters benutzt, hat dort eine Lücke. Und das Archiv liegt auf
demselben Laufwerk wie alles andere; es ist keine Sicherung.

### S/MIME — unterschreiben und verschlüsseln mit Zertifikaten

Das Verfahren, mit dem Unternehmen ihre Post schützen. Es liegt neben OpenPGP und ersetzt
es nicht. Der Unterschied zwischen beiden ist der, an dem in der Praxis alles hängt: Ein
PGP-Schlüssel behauptet selbst, zu wem er gehört, und wer das glauben will, vergleicht
Fingerabdrücke. Bei einem Zertifikat hat eine Ausgabestelle die Behauptung unterschrieben,
und die Unterschrift lässt sich bis zu einer Wurzel zurückverfolgen, der der Rechner
ohnehin traut. **Niemand muss Fingerabdrücke vergleichen** — deshalb läuft S/MIME in
Unternehmen und PGP nicht.

**Was ein Nutzer tut:** seine `.p12`-Datei einlesen, wie er sie von der Ausgabestelle
bekommen hat. Mehr nicht. Beide Bauarten werden gelesen — die heutige mit AES-256 und die
alte mit SHA-1 und 3DES, die Windows und ältere Ausgabestellen bis heute liefern. Die
Zertifikate der anderen kommen von selbst: **jede unterschriebene Nachricht bringt das
Zertifikat ihres Absenders mit**, und wer einmal unterschrieben geschrieben hat, kann ab da
verschlüsselte Post bekommen. Übernommen wird nur, was sich restlos geprüft hat —
Unterschrift, Kette und Adresse.

**Alles selbst gebaut**, aus demselben Grund wie beim LDAP-Client und beim QR-Bild: CMS
(RFC 5652), die Zertifikatsprüfung (RFC 5280), die Schlüsseldatei (RFC 7292) samt der
eigenwilligen Schlüsselableitung aus deren Anhang B.2. Gerechnet wird ausschließlich mit
dem, was Node mitbringt.

**Geprüft wird gegen OpenSSL, nicht gegen uns selbst.** Alle Prüfdaten — Zertifikate,
unterschriebene und verschlüsselte Nachrichten, Schlüsseldateien — hat OpenSSL erzeugt; das
Skript dazu liegt daneben. Und umgekehrt: `openssl cms -verify` nimmt unsere Unterschrift
an, `openssl cms -decrypt` öffnet unseren Umschlag. **Genau diese Gegenprobe hat einen
echten Fehler gefunden**: AES-GCM stand im gewöhnlichen Umschlag statt im dafür
vorgesehenen (RFC 5083). Selbst gelesen ging es auf, OpenSSL wies es ab — und mit ihm jedes
andere Programm.

**Was das Band über einer Nachricht sagt**, folgt einer Regel: Nur der eine Fall, in dem
wirklich alles stimmt, bekommt Grün. Der wichtigste der übrigen ist „Unterschrift ohne
bekannte Herkunft" — die Rechnung geht auf, aber für das Zertifikat steht niemand gerade.
Ein solches Zertifikat stellt sich jeder in einer halben Minute selbst aus, auf jede
beliebige Adresse.

**Zwei Stellen, an denen bewusst streng geworden wird.** Steht eine Mailadresse sowohl im
Namen des Inhabers als auch im alternativen Namen, gilt allein der alternative — so steht
es in RFC 8551, und wer beide zusammenwirft, lässt sich mit einem völlig regulär
ausgestellten Zertifikat eine Unterschrift als die des Chefs ausweisen. Und **SHA-1 gilt
nicht als Nachweis**: Eine damit unterschriebene Nachricht wird als „nicht prüfbar"
ausgewiesen, nicht als gültig.

**Offen benannt:** Rücknahmelisten werden nicht abgefragt, Anhänge nicht mitgeschützt, und
verschlüsselt wird nur an RSA-Zertifikate.

### Das Firmenverzeichnis (LDAP / Active Directory)

Ein Verwalter richtet es einmal ein; danach findet jeder Nutzer beim Tippen eines
Empfängers auch die Kollegen aus dem Verzeichnis. Zwei Vorlagen (Active Directory,
OpenLDAP) belegen Filter und Feldnamen vor — kein Verzeichnis gleicht dem anderen, und ein
Formular mit drei Feldern und der Annahme, es sei schon ein AD, ließe die Hälfte der
Betreiber im Regen.

**Der LDAP-Client ist selbst gebaut**, und zwar aus demselben Grund wie das QR-Bild: Es
kommt nichts herein und geht nichts hinaus außer Bytes, die Regel steht in X.690 und
RFC 4511, und die gängige Bibliothek brächte ein Vielfaches dessen mit, was hier gebraucht
wird — Server, Schema, Änderungsoperationen. Gebraucht werden zwei Vorgänge, **Anmelden und
Suchen, beide lesend**. Was das Programm nicht kann, kann auch niemand missbrauchen, der
sich Zugriff darauf verschafft.

**Geprüft wird auf drei Beinen.** Die Bytes der Suchanfrage werden mit einem eigenen,
unabhängig geschriebenen Leser zerlegt und Feld für Feld gegen RFC 4511 §4.5.1 gehalten:
acht Felder, in genau dieser Reihenfolge — ein Verzeichnisdienst liest sie der Reihe nach,
und wer eines vertauscht, bekommt keine Fehlermeldung, sondern falsche Ergebnisse. Dazu
läuft in der Prüfung ein **kleiner LDAP-Server auf einem echten TCP-Socket**, der
absichtlich in Stücken antwortet: Genau daran fällt ein Client um, der annimmt, eine
Antwort komme in einem Rutsch an. Und drittens der Filter.

**Was der Nutzer eintippt, wird maskiert** (RFC 4515), bevor es in den Filter geht — ohne
das baute `*)(objectClass=*` einen anderen Filter als gemeint, und dahinter stehen die
Personaldaten eines Unternehmens.

Drei Wege hinein: **LDAPS**, **StartTLS** (erst umschalten, dann anmelden — andersherum
wäre das Kennwort schon durch die Leitung) und unverschlüsselt, das der Betreiber
ausdrücklich wählen muss.

**Ein DN ohne Kennwort wird gar nicht erst versucht.** Das ist die berüchtigte
„unauthenticated bind": Manche Verzeichnisse antworten darauf mit Erfolg, ohne irgendetwas
geprüft zu haben — und der Dienst hielte sich danach für angemeldet.

Das Kennwort des Dienstkontos liegt mit dem Masterschlüssel verschlüsselt und geht **nie**
zur Anzeige heraus, auch nicht an einen Verwalter; in der Oberfläche steht nur, ob eines
hinterlegt ist. Und daneben der Satz, der später teuer wird, wenn man ihn überliest: Dort
gehört ein Konto hin, das nur lesen darf.

### Lesebestätigungen

Anfordern über ein Häkchen im Verfassen-Fenster; wie mit angeforderten umgegangen wird,
steht je Konto in den Einstellungen — **nie**, **jedes Mal fragen** (Vorgabe) oder
**immer**.

**Das Verweigern ist wieder der interessante Teil.** Eine Lesebestätigung ist eine Auskunft
über einen Menschen an einen anderen, und sie geht automatisch hinaus. Drei Arten, wie das
schiefgeht: Sie bestätigt einem Werbeversender, dass die Adresse gelesen wird — mehr wert
als ein Klick auf ein Zählpixel, denn hier antwortet ein Programm mit einer echten Mail von
einer echten Adresse. Sie verrät Arbeitszeiten. Und sie lässt sich als Waffe benutzen.

**Der letzte Fall hat die einzige Stelle bekommen, an der die Einstellung des Nutzers
überstimmt wird.** Zeigt `Disposition-Notification-To` auf eine andere Adresse als den
Absender, wird immer gefragt — auch bei „immer". Eine Nachricht an einen Verteiler, deren
Bestätigungen an ein fremdes Postfach gehen, macht aus vierhundert Lesern vierhundert
Absender, und keiner ahnt etwas davon. Verglichen wird dabei mit dem **Rückweg des
Umschlags**, nicht nur mit dem Kopf: Der Kopf lässt sich frei beschriften.

**Verschickt wird, wenn die Nachricht wirklich vor jemandem steht**, nicht wenn der Server
sie abgerufen hat — der Abruf geschieht auch für eine Vorschau oder eine Suche. Deshalb
löst die Oberfläche das aus, und der Server prüft trotzdem noch einmal alles nach: Sie
entscheidet, WANN gefragt wird; ob überhaupt gesendet werden darf, entscheidet der Server.

**Ein „Nein" hält so lange wie ein „Ja".** Ein Nein, das nicht hält, ist eine Frage, die so
lange wiederkehrt, bis jemand aus Versehen zustimmt.

Gebaut wird ein richtiges `multipart/report` nach RFC 8098 — eine gewöhnliche Mail stünde
beim Absender als unerklärter Zweizeiler im Posteingang, und der Haken in seinem Programm
bliebe aus. Sie trägt `Auto-Submitted: auto-replied`, fordert selbst keine an, und ihr Text
sagt ausdrücklich, dass „angezeigt" nicht „gelesen" heißt.

**Dabei ein eigenes Loch gefunden und geschlossen:** Das `kopfzeilen`-Feld, das mit der
Abwesenheitsnotiz hinzukam, wurde vom Sendeweg unbesehen aus dem Anfragekörper übernommen —
eine Oberfläche hätte damit beliebige Kopfzeilen einschleusen können: ein gefälschtes
`Sender:`, ein `Disposition-Notification-To` auf ein fremdes Postfach. Kopfzeilen setzt
jetzt ausschließlich der Server.

### Geteilte Postfächer und Stellvertretung

Anna gibt eines ihrer Postfächer für Bernd frei — **nur lesen** oder **voller Zugriff** —,
und Bernd findet es in seiner eigenen Seitenleiste, gekennzeichnet. Zwei Fälle, ein
Verfahren: das Sammelpostfach `info@`, das drei Leute lesen, und die Vertretung während
einer Krankheit.

**Der Entwurf in einem Satz: Der Datenkontext wechselt, die Person nicht.** Ruft Bernd
einen Weg unter Annas Konto auf, läuft die ganze Anfrage in Annas Datenkontext — dort
liegen die Zugangsdaten, der Zwischenspeicher, die Regeln dieses Postfachs. Ein zweiter Weg
daneben hieße, all das ein zweites Mal zu bauen, und die zweite Fassung wäre die, in der
die Trennung eines Tages nicht mehr stimmt. Was dabei nicht wechselt, ist die Person:
Protokoll und Rechteprüfung sehen weiterhin Bernd.

**Gewechselt wird nur, wenn die Kennung des freigegebenen Kontos im Pfad steht.** Alles
andere — Kontenliste, Adressbuch, Etiketten, Einstellungen, die eigenen Freigaben — bleibt
in Bernds Kontext. Ein Weg, der eine Kontokennung woanders führte, fiele auf die sichere
Seite: Bernd hat dieses Konto nicht, und der Server antwortet mit 404. Deshalb tut der
Haken so wenig; jede Zeile mehr wäre eine, in der der Wechsel eines Tages greift, wo er
nicht hingehört.

**Die unangenehmste Falle des Entwurfs** hat einen eigenen Prüfpunkt bekommen: Der Riegel
der Nutzerverwaltung fragt, wer da ist — und während einer Freigabe hat das zwei Antworten.
Fragte er den Eigentümer der gerade geöffneten Daten, käme ein gewöhnlicher Nutzer über ein
freigegebenes **Verwalterpostfach** in die Verwaltung.

**Was ein Vertreter nie darf**, auch mit vollem Zugriff: das Konto entfernen, seine
Einstellungen oder Zugangsdaten ändern, es weiterverschenken. Wer ein Postfach zum
Bearbeiten bekommt, bekommt nicht das Recht, es abzuschaffen.

**Gesendetes trägt einen Vermerk.** `From` bleibt die Adresse des Postfachs, daneben steht
`Sender:` mit der Adresse dessen, der wirklich getippt hat — Outlook und Thunderbird zeigen
„Bernd im Auftrag von Anna". Ohne diese Zeile verschickte ein Vertreter Post im Namen eines
Menschen, der nichts davon weiß.

Neunzehn Prüfungen, und die meisten davon prüfen, was **nicht** geht: dass Bernd Annas
zweites Postfach nicht sieht, ihre Etiketten nicht, mit Leserecht auf acht verschiedenen
Wegen nicht schreibend durchkommt und ihr Postfach nicht weiterverschenken kann.

Offen benannt in BETRIEB.md: Ein Vertreter bekommt **keine Sofortmeldung** über neue Post —
die Überwachung läuft im Konto des Eigentümers.

### Abwesenheitsnotiz

Unter **Abwesenheit** in der Seitenleiste, je Konto getrennt — wer geschäftlich und privat
dasselbe Programm benutzt, will im Urlaub der Firma antworten und dem Fußballverein nicht.

**Das Verschicken war der leichte Teil.** Der schwere ist zu wissen, wann man den Mund
hält, und deshalb besteht dieses Modul fast nur aus Verboten. Eine Abwesenheitsnotiz, die
zu viel antwortet, ist kein Schönheitsfehler: Sie antwortet einem Zustellbericht, der
kommt zurück, sie antwortet wieder — und über Nacht laufen zwei Postfächer über. Sie
antwortet einem Verteiler, und vierhundert Fremde erfahren von der Urlaubsplanung. Sie
antwortet einer anderen Abwesenheitsnotiz, und die beiden schreiben sich das Wochenende
über.

Nie geantwortet wird deshalb auf Zustellberichte (`Return-Path: <>`), maschinelle Post
(`Auto-Submitted`, `Precedence: bulk`), Verteiler (`List-Id`, `List-Unsubscribe`),
Absender wie `noreply@` oder `mailer-daemon@`, auf Post, in deren An oder Kopie keine
eigene Adresse steht — Blindkopie oder Weiterleitung —, und auf nichts außerhalb des
Posteingangs. Maßgeblich ist RFC 3834; die Notiz trägt selbst `Auto-Submitted:
auto-replied`, damit die Gegenseite dasselbe tun kann.

**Diese Regeln sind nicht abschaltbar**, und das ist Absicht. Ein Kästchen dafür wäre eine
Einladung, das Falsche anzukreuzen.

**Geantwortet wird von der Adresse, an die geschrieben wurde**, und an den Rückweg des
Umschlags statt an den Kopf. Wer an „info@" schreibt, soll nicht erfahren, dass dahinter
„anna@" sitzt.

**Wem geantwortet wurde, steht auf Platte und nicht im Speicher.** Der Unterschied zwischen
einer Bremse, die greift, und einer, die es bis zum nächsten Neustart tut — und ein
Neustart kommt bei jedem Einspielen einer Fassung.

Der Knopf in der Seitenleiste ist hervorgehoben, solange wirklich geantwortet wird. Eine
Abwesenheitsnotiz, die man nicht sieht, bleibt drei Monate nach dem Urlaub an.

Offen benannt in BETRIEB.md: **Sie antwortet nur, solange der Dienst läuft.** Sie hängt an
der Postfachüberwachung, nicht am Server des Anbieters.

### Zwei-Faktor-Anmeldung

Ein Kennwort war bis hierher die einzige Schranke vor sämtlicher Post eines Menschen. Jetzt
kann sich jeder unter **Mein Konto** einen zweiten Faktor einrichten: ein Einmalcode aus
einer Authenticator-App, nach RFC 6238 — dasselbe Verfahren, das Google Authenticator,
Aegis, 1Password und Bitwarden beherrschen.

**Ohne fremden Dienst.** Kein SMS-Versender (das schwächste der gängigen Verfahren — eine
umgemeldete Rufnummer hebelt es aus), kein Code per Mail (der schützt ein Mailprogramm
nicht: wer das Postfach hat, hat den Code), kein Konto bei irgendwem. Es ist Rechnerei: ein
gemeinsames Geheimnis, die Uhrzeit, ein HMAC.

**Die Anmeldung läuft in zwei Schritten, und der erste eröffnet keine Sitzung.** Auf das
richtige Kennwort hin kommt eine Marke zurück: fünf Minuten gültig, fünf Versuche, und sie
öffnet ausschließlich die Codeabfrage. Der naheliegende Bauweg wäre gewesen, die Sitzung zu
eröffnen und sie als „noch nicht fertig“ zu markieren — das wäre eine Sitzung, die überall
dort gilt, wo jemand die Markierung abzufragen vergisst. Was keine Sitzung ist, kommt an
keiner Route vorbei.

**Ein Code lässt sich nicht zweimal einlösen.** Der zuletzt benutzte Zeitschritt wird
mitgeschrieben; ohne diese Buchführung wäre TOTP ein Kennwort mit dreißig Sekunden
Haltbarkeit, das jeder Mitleser noch einmal benutzen kann.

**Zehn Wiederherstellungscodes, einmal angezeigt.** Fünfzig Bit je Code, aus einem Alphabet
ohne 0/O und 1/I/l — sie werden von Papier abgetippt. Sie gehen durch dasselbe Eingabefeld
wie der Zahlencode; sechs Ziffern gegen zehn Buchstaben sind nicht zu verwechseln, und ein
zweites Feld „oder hier ein Wiederherstellungscode“ wäre eine Frage an einen Menschen, der
gerade nicht hereinkommt.

**Das QR-Bild ist selbst gerechnet**, ohne zusätzliche Abhängigkeit. Ein QR-Code ist reine
Mathematik — Bits, ein Reed-Solomon-Code über GF(256) und ein Muster aus Quadraten —, und
dem stünde als Kosten gegenüber, dass eine fremde Bibliothek in einer Anwendung landet, die
sich selbst aktualisiert und dabei ihre eigene Unterschrift prüft. Geprüft wird gegen die
Norm: die Zahl der Datenmodule gegen die Codewort-Tabelle, die BCH-Codes über ihren
Mindestabstand, das Reed-Solomon-Erzeugerpolynom gegen die abgedruckte Zahlenreihe, und
zuletzt eine Rücklese des fertigen Bildes durch einen zweiten, unabhängig geschriebenen
Leser. Dabei fiel auf, dass mein Erzeugerpolynom in umgekehrter Reihenfolge herauskam — das
Bild hätte lesbare Nutzdaten getragen und wäre trotzdem von jedem Leser als beschädigt
verworfen worden.

**Beim Entsperren wird der Code nicht verlangt.** Er beantwortet „ist das wirklich dieses
Konto“; die Sperre beantwortet „sitzt noch derselbe Mensch davor“. Wer bei jedem Entsperren
das Telefon hervorholen müsste, stellte die Sperre nach dem dritten Mal ab.

**Zwei Wege zurück bei einem verlorenen Telefon**: ein Verwalter räumt den Faktor ab, oder
`nutzerWerkzeug.js zweifaktor-aus` auf dem Server. Den zweiten braucht es wirklich — wenn
der einzige Verwalter sein Telefon verliert, kommt niemand mehr in die Verwaltung.

**Was er leistet und was nicht, steht in BETRIEB.md.** Er schützt gegen ein
abhandengekommenes Kennwort. Nicht gegen jemanden, der bereits am angemeldeten Rechner
sitzt, und nicht gegen den Betreiber des Servers.

Nebenbei hat der **Kennwortwechsel endlich eine Oberfläche**. Den Weg dafür gab es im
Server seit Langem, nur konnte ihn niemand erreichen, ohne einen Abruf von Hand zu bauen.

### Rollen: es gibt jetzt einen Verwalter

Nutzer wurden von der Befehlszeile verwaltet, und der Kommentar dort nannte den Grund: „Ein
Verwaltungsweg im Server bräuchte einen Verwalterbegriff, eine zweite Rechteebene und deren
Prüfungen. Beides ist verfrüht.“ Verfrüht war es, solange der Dienst im Bekanntenkreis lief.
Wer ihn einem Betrieb hinstellt, kann nicht verlangen, dass für jedes neue Postfach jemand
eine SSH-Sitzung öffnet.

**Zwei Rollen und keine Rechtematrix.** Es gibt genau zwei Sorten Mensch an diesem Dienst:
den, der sein Postfach liest, und den, der die Nutzer verwaltet. Eine Matrix aus einzeln
vergebbaren Rechten wäre die Antwort auf eine Frage, die niemand gestellt hat — und jede
Zeile darin ein weiterer Weg, sie falsch einzustellen.

**Die Rechteprüfung steht an genau einer Stelle**, am Präfix `/verwaltung`. Nicht in jeder
Route ein `if (istVerwalter(…))`: Bei sieben Routen wäre die achte die, bei der es jemand
vergisst — und eine vergessene Rechteprüfung sieht im Quelltext genauso aus wie eine Route,
die keine braucht.

**Zwei Fallen, die beim Bauen sichtbar wurden.**

*Der Pseudo-Nutzer hätte die Verwaltung bekommen.* Auch im Serverbetrieb legt der Start
einen Eintrag `lokal` an — über ihn weist sich das Desktop-Fenster aus. Er ist zugleich der
**zuerst** angelegte, und die Regel „der Erste wird Verwalter“ hätte damit ausgerechnet dem
Konto die Rechte gegeben, dessen Kennwort vierundzwanzig zufällige Bytes sind, die nie
jemand zu sehen bekommt. Der Mensch, der den Dienst betreibt, hätte ohne Rechte dagestanden.

*Der letzte Verwalter ließ sich abräumen* — über drei verschiedene Wege: absetzen, sperren,
entfernen. Jeder davon hätte einen Dienst hinterlassen, in dem niemand mehr Nutzer anlegen
oder Rollen vergeben kann; zu retten nur noch über die Befehlszeile auf dem Server. Alle
drei sind jetzt gebremst, im Speicher und nicht in der Route: Sonst wäre die Bremse über
den nächsten Weg zu umgehen.

**Was ein Verwalter wirklich kann, steht in BETRIEB.md, und es ist unbequem.** Er setzt
Kennwörter zurück — und kann sich damit als dieser Mensch anmelden und dessen Post lesen.
Das ist keine Lücke, sondern die Bauart: Die Postfachkennwörter liegen mit dem
Masterschlüssel des Servers verschlüsselt, und den hat, wer den Server betreibt. Ein
Verwalter, der behauptete, nicht an die Post zu können, sagte die Unwahrheit. Ein
Zurücksetzen steht deshalb als **Warnung** im Protokoll, mit Namen.

Dreizehn Prüfungen, darunter die beiden, auf die es ankommt: dass ein gewöhnlicher Nutzer
auf **jedem** Verb abgewiesen wird — nicht nur beim Lesen, denn die Wirkung genügt dem
Angreifer —, und dass der letzte Verwalter stehen bleibt.

Ein Nebenbefund: Das Löschen eines Nutzerordners stand als eigenes `rmSync` im
Befehlszeilenwerkzeug. Die Verwaltung hätte ein zweites gebraucht, und zwei Fassungen
desselben Löschvorgangs laufen auseinander — bei einem Löschvorgang heißt das, dass die eine
etwas stehen lässt, was die andere mitnimmt. Jetzt gibt es eine.

**Und die Oberfläche dazu.** Ein Verwalter findet in der Seitenleiste „Nutzer“: dieselbe
Liste wie auf der Befehlszeile, dazu Anlegen, Kennwort zurücksetzen, Sperren, Rolle vergeben
und Entfernen. Das erzeugte Kennwort steht in einem eigenen Kasten mit einem Knopf zum
Kopieren — es erscheint genau einmal, und eine beiläufige Zeile wäre dafür der falsche Ort.
An der eigenen Zeile fehlen Sperren, Rolle und Entfernen: Der Server weist das ohnehin ab,
aber ein Knopf, der immer eine Fehlermeldung bringt, ist eine Falle.

Dafür gibt es jetzt eine **Prüfung, die eine Oberfläche wirklich zeichnet** — die erste im
Projekt. Ein Fenster übersetzt fehlerfrei und erscheint trotzdem nicht; genau das ist zweimal
passiert, beim Kennwortfenster der Hülle und hier. Gefälscht wird dabei `fetch` und nicht die
api-Funktionen: So läuft api.ts mit, und die Adressen der Wege sind mitgeprüft. Ein Fenster,
das die richtigen Daten an den falschen Weg schickt, fiele sonst niemandem auf.

Damit das ging, musste `api.ts` einen Fragezeichenpunkt bekommen: `import.meta.env` setzt
Vite beim Bauen ein, unter reinem Node gibt es das Objekt nicht, und der Zugriff darauf warf
schon beim Einbinden. Das Modul war für Prüfungen unerreichbar — und mit ihm alles, was es
benutzt, also fast jedes Fenster.

### Der Bildschirm sperrt sich

Eine Sitzung starb bisher erst nach **vierzehn Tagen** Untätigkeit. Auf einem Bürorechner
heißt das: Wer aufsteht, lässt sein Postfach offen stehen, und wer sich davorsetzt, liest
mit. Jetzt fällt sie nach einer Stunde zu — einstellbar über
`ENERGY_MAIL_SPERRE_MINUTEN`, eine 0 schaltet es ab — und daneben gibt es einen Knopf für
den, der den Platz bewusst verlässt.

**Gesperrt heißt am Server gesperrt.** Jede Anfrage einer zugefallenen Sitzung wird mit
**423** beantwortet. Eine Fläche über der Oberfläche allein wäre wirkungslos: Der Keks gilt
weiter, ein zweiter Tab bekäme die Post ungehindert, und ein Abruf von Hand erst recht. Die
Prüfung geht deshalb genau dieser Frage nach — sie sperrt und ruft danach `/accounts`,
`/etiketten` und `/sicherung` mit demselben Keks noch einmal auf.

**423 und nicht 401, und daran hängt mehr als eine Zahl.** 401 hieße „melde dich an“, und
die Weiche in der Oberfläche räumte die ganze Anwendung ab — mitsamt dem halb geschriebenen
Brief. 423 heißt „du bist es noch, gib dein Kennwort ein“: Die Anwendung bleibt eingehängt,
der Sperrschirm liegt *darüber*, und danach steht der Entwurf noch da. Wer zwanzig Minuten
telefoniert hat, soll dafür nicht bestraft werden.

Gesperrt wird an **zwei** Stellen, und beide werden gebraucht. Der Server sieht Untätigkeit
erst bei der nächsten Anfrage — vor einem Bildschirm, vor dem niemand sitzt, kommt aber
keine; ohne die Oberfläche bliebe die Post sichtbar stehen, bis jemand vorbeikommt. Die
Oberfläche wiederum misst **echte Betätigung** (Taste, Zeiger, Rad, Berührung) und nicht
Netzverkehr: Der läuft auch dann weiter, wenn niemand da ist.

Eine Sperre allein auf die Adresse gibt es auch hier nicht, und das Entsperren zählt bei der
Anmeldebremse mit — eine Sperre, die sich unbegrenzt durchprobieren lässt, ist keine.

Beim Nachziehen fiel nebenbei auf, dass die Auffrischung der letzten Nutzung höchstens
stündlich schrieb. Bei einer Sperrfrist von einer Stunde hieße das: Wer um 9:00 und um 9:59
arbeitet, hat einen Zeitstempel von 9:00 und wird um 10:00 gesperrt, obwohl er gerade eben
getippt hat. Aufgefrischt wird jetzt nach einem Viertel der Frist.

**Im Desktop-Betrieb gibt es bewusst keine Sperre**: Dort weist sich das Fenster über das
Zugangsgeheimnis des Prozesses aus — keine Sitzung, kein Kennwort, also auch nichts, was
eine Sperre wieder aufmachen könnte. Dafür ist die Sperre des Betriebssystems da.

### Die Einstellungssicherung ist verschlüsselt

Sie enthält keine Kennwörter — das stand immer schon so im Kommentar, und es stimmt. Nur
stand daneben auch der zweite Satz: darin liegen **sämtliche Mailadressen, mit denen je
Post gewechselt wurde**, dazu das ganze Adressbuch mit Namen, Telefonnummern, Firmen und
Geburtstagen. Als lesbares JSON, voreingestellt im Dokumentenordner — also in dem Ordner,
den die meisten Rechner in die Wolke spiegeln. Für ein Programm mit einer DATENSCHUTZ.md
ist das kein Schönheitsfehler.

Beim Sichern fragt das Programm jetzt nach einem Kennwort (mindestens acht Zeichen, einmal
zu wiederholen) und verschlüsselt die Datei mit AES-256-GCM; der Schlüssel kommt über
scrypt mit N = 2¹⁷ aus dem Kennwort — rund eine Sekunde, die ein Durchprobieren der Datei
um den Faktor Hunderttausend teurer macht.

**Warum ein Kennwort und nicht der Schlüssel des Rechners**, der ohne Nachfrage auskäme:
Der hängt an safeStorage/DPAPI und damit am Benutzerkonto *dieses* Rechners. Eine so
verschlüsselte Sicherung ließe sich auf dem neuen Rechner nicht öffnen — also genau dort
nicht, wofür sie gemacht ist. Der Preis steht offen im Fenster: ohne das Kennwort gibt es
keinen Weg zurück.

Der lesbare Teil bleibt lesbar — Programmname, Fassung, Zeitpunkt. Sonst hielte man eine
Datei in der Hand, der man nicht ansieht, was sie ist, und „Sicherung einlesen“ könnte
nicht zwischen *falsches Kennwort* und *falsche Datei* unterscheiden. Er ist mitgezeichnet
(AAD): lesen ja, unbemerkt ändern nein. **Ältere, unverschlüsselte Sicherungen werden
weiter angenommen** — sie enthalten dieselbe Arbeit.

Electron bringt kein Eingabefeld mit: `dialog` kann melden und fragen, aber nichts
entgegennehmen. Das Kennwortfenster ist deshalb eine eigene kleine Seite mit **eigenem
Vorschaltskript** — bewusst nicht dem der Oberfläche, denn über das geht unter anderem das
Zugangsgeheimnis des Prozesses hinaus. Ein Fenster, das eine Zeile Text entgegennimmt, hat
darauf nichts zu suchen. Und es sitzt in der Hülle statt in der Oberfläche, weil das
Einlesen ein **Notweg** ist: Genau deshalb steht es im Menü und funktioniert auch dann
noch, wenn die Oberfläche nicht mehr lädt.

Dreizehn Prüfungen für das Dateiformat, darunter die, auf die es ankommt: dass in der
Datei keine Adresse, kein Name und keine Telefonnummer mehr zu finden ist. Dazu ein
Durchlauf an der laufenden Hülle für das Fenster selbst — ein neues Fenster mit einem neuen
Vorschaltskript übersetzt fehlerfrei und erscheint trotzdem nicht.

### Die Anmeldebremse vergisst nicht mehr

Sie zählte in einer `Map` im Arbeitsspeicher, mit einem ehrlichen Kommentar daneben: „bei
einem Neustart ist sie weg […] vor dem öffentlichen Betrieb gehört an diese Stelle etwas,
das über Prozessgrenzen hinweg zählt“. Der öffentliche Betrieb ist da.

Das Loch war dabei nicht der Angreifer, der neu startet — das kann er nicht. Es war jedes
Einspielen einer Fassung, jedes `docker compose up -d`, jeder Absturz. Wer davon eine
Handvoll am Tag hat, hatte eine Bremse, die praktisch nie griff, und niemand konnte es
sehen: Im gelungenen Fall tut sie ohnehin nichts.

Jetzt liegt sie in `anmeldebremse.json` und zählt auf **zwei Ebenen**. Anschluss und
Adresse zusammen: zehn Fehlversuche, eine Viertelstunde. Der Anschluss allein: fünfzig,
eine Stunde — das fängt, was die genaue Frage durchlässt, nämlich ein einziges Kennwort
gegen fünfzig verschiedene Adressen. Je Adresse ist das ein Versuch und käme nie an die
Zehn.

**Eine Sperre allein auf die Adresse gibt es weiterhin nicht, und das ist eine Entscheidung
und kein Vergessen.** Sie wäre von jedem gegen jeden auslösbar: Adresse kennen, zehnmal
etwas Falsches schicken, und der Betroffene kommt eine Viertelstunde lang von keinem
Anschluss mehr an seine Post. Das ist keine Bremse mehr, sondern eine Waffe, und sie läge
für jeden bereit.

In der Datei stehen **keine Adressen und keine Anschlusskennungen**, nur salzige
Prüfsummen. Die Bremse muss vergleichen, nie zurücklesen — und dann soll auch nichts
dastehen, was sich zurücklesen ließe. Dieselbe Überlegung steht schon zweimal im Programm:
Das Protokoll kürzt Anschlusskennungen, die Sitzungsdatei speichert nur die Prüfsumme der
Kennung. Wer weniger hinschreibt, muss weniger schützen.

Fünfzehn Minuten bleiben dabei fünfzehn Minuten, auch beim zwanzigsten Mal. Gerechnet:
vierzig Versuche in der Stunde, rund 350.000 im Jahr — gegen ein Kennwort hinter scrypt ist
das nichts. Eine wachsende Sperrzeit träfe also nicht den Angreifer, für den es ohnehin
aussichtslos ist, sondern den Menschen, der sein Kennwort gerade nicht zusammenbekommt.

Fünfzehn Prüfungen decken das ab, darunter die beiden, auf die es ankommt: dass eine Sperre
den Neustart übersteht, und dass in der Datei weder Adresse noch Anschlusskennung stehen.

### Neue Gestalt: Papier & Strom

Die Oberfläche sah aus wie jedes andere Mailprogramm: drei graublaue Spalten, durch
Striche getrennt, ein blaues Kästchen als Symbol. Sie war ordentlich und austauschbar.
Jetzt folgt sie einem Bild und einer Regel.

- **Das Bild: Schreibtisch und Blatt.** Links liegt die Seitenleiste unmittelbar auf dem
  Grund – sie ist Möbel. Rechts bilden Nachrichtenliste und Leseansicht *ein* Blatt mit
  runden Ecken und einem Schatten darunter. Zwei verschiedene Dinge sehen jetzt auch
  verschieden aus, statt als drei gleichwertige Kästen nebeneinanderzustehen.
- **Warmes Papier statt Blaugrau.** Der helle Grund ist ein warmes Papierweiß, der dunkle
  ein tiefes Tintenblau mit elfenbeinfarbener Schrift. Eine Mail ist ein Brief, und man
  liest sie stundenlang; das kühle Weiß, das Bildschirme von sich aus abgeben, ermüdet
  dabei nachweislich schneller. Über allem liegt eine kaum sichtbare Kornscheibe, die den
  Flächen die Plastikglätte nimmt – und im Dunkeln die Streifenbildung aufbricht.
- **Die Regel: Blau bedient, Bernstein meldet.** Blau heißt „hier kannst du etwas tun“ –
  Knöpfe, Verweise, die ausgewählte Zeile. Bernstein heißt „hier ist Energie“ –
  Ungelesenes, neue Post, Fortschritt. Ungelesene Zählungen und Marken sind deshalb nicht
  mehr blau; sie verschwanden bisher in der blau hinterlegten Auswahl.
- **Monogramme in der Nachrichtenliste.** Jeder Absender bekommt ein farbiges Kürzel,
  Farbton und Buchstaben aus seiner Adresse abgeleitet – immer dieselben, ohne dass etwas
  gespeichert würde. Eine Liste ist damit ein Muster statt einer Kolonne aus grauem Text:
  Post von derselben Person findet das Auge, bevor es den Namen gelesen hat. Gerechnet
  wird in OKLCH, damit alle vierzehn Töne gleich gut lesbar sind. In der engen Anzeige
  bleiben sie weg – dort zählt jede Zeile mehr als die Farbe.
- **Die Leseansicht liest sich wie ein Artikel.** Betreff groß und eng gesetzt, darunter
  Absender mit Monogramm und Zeitpunkt. Die Werkzeugleiste ist eine Bank, auf der nur
  „Antworten“ Farbe trägt – vorher waren zwölf gleich laute Kästen nebeneinander. Die
  Textspalte ist auf 860 Pixel begrenzt: auf einem breiten Bildschirm lief eine Zeile
  vorher über 180 Zeichen, und dabei findet das Auge den Anfang der nächsten nicht mehr.
- **Ein eigenes Programmsymbol.** Eine Briefmarke, durch die ein Blitz schlägt. Den
  gezackten Rand hat sonst nichts auf einem Bildschirm; er ist noch als Umriss zu
  erkennen und sagt „Post“, ohne einen Umschlag zeichnen zu müssen. Das Wortzeichen steht
  in gesperrten Versalien in der DIN-Schrift, die Windows mitbringt.
- Nachgezogen sind alle Stellen außerhalb der Oberfläche: Startbild, Startfehler und
  „Über“, die Rückmeldeseite der OAuth-Anmeldung, das Abzeichen auf der Taskleiste, die
  Bilder des Installationsprogramms und das Anmeldefenster der Browserfassung. Erzeugt
  werden Symbol und Installationsbilder aus demselben Quelltext wie das Zeichen in der
  Anwendung (`node scripts/installer-grafiken.mjs`) – ändert sich die Marke, stimmen alle
  vier Bilder wieder, statt dass eines vergessen wird.

### Vom Programm zum Dienst

Bis hierher war Energy Mail an einen Rechner gebunden: ein Mensch, ein Windows-Konto,
ein Datenordner. Damit dasselbe Postfach vom Laptop, vom Handy und aus dem Browser
erreichbar ist, musste der Server lernen, wessen Post er gerade in der Hand hat.

- **Jede Anfrage gehört einem Nutzer.** Konten, Adressbuch, Regeln, Etiketten, Ablage
  und Zwischenspeicher liegen je Nutzer getrennt. Eine Stelle, die vergisst zu sagen,
  für wen sie arbeitet, bekommt einen lauten Fehler – nicht fremde Post. Es gibt
  bewusst keinen stillen Rückfall auf „irgendeinen“ Nutzer.
- **Anmeldung mit Adresse und Kennwort.** Das Kennwort wird mit scrypt geprüft, die
  Sitzung liegt auf dem Server und lässt sich damit auch wieder zurücknehmen – anders
  als eine signierte Marke im Keks, die bis zum Ablauf gilt, auch wenn sie gestohlen
  wurde. Der Keks ist für Skript unerreichbar und wird bei fremden Anfragen nicht
  mitgeschickt.
- **Ein eigener Schlüssel je Nutzer**, verpackt mit dem des Servers. Wird ein Nutzer
  gelöscht, ist seine Post damit unlesbar – auch in jeder bestehenden Sicherung.
- **Die Ablage wird umgestellt statt geleert.** Vorher wurde bei jeder Änderung am
  Aufbau die gesamte lokale Datenbank verworfen und neu geladen. Bei 31.700 Nachrichten
  sind das Stunden – und bei einem Dienst gleichzeitig für alle.
- **Eine Nachricht zu öffnen lädt nicht mehr ihre Anhänge.** Vorher wurde die
  vollständige Nachricht in den Speicher geholt, nur um Text und HTML herauszulösen; bei
  einer Nachricht mit 500 kB Bild kostete das Bild dabei zweimal Übertragung. Jetzt
  werden gezielt nur die Textteile abgerufen.
- **Betrieb im Container.** `docker compose up -d` startet den Dienst hinter Caddy, das
  sein Zertifikat bei Let's Encrypt selbst holt und erneuert. Die Verschlüsselung endet
  auf dem eigenen Rechner – niemand dazwischen sieht die Post. Beschrieben in
  [BETRIEB.md](BETRIEB.md).
- **Nutzer werden auf dem Server angelegt**, nicht über eine Selbstanmeldung – sonst
  könnte sich jeder aus dem Netz ein Postfach auf fremder Hardware einrichten.
- **Hintergrundarbeit für alle Nutzer.** Beim Start bekam nur der Einplatznutzer seine
  Überwachung, seine geplanten Sendungen und seine Wiedervorlagen zurück. Auf einem
  Server hieß das: nach jedem Neustart kam für alle anderen keine Post mehr von selbst,
  eine für Dienstag geplante Sendung ging nie hinaus, und eine auf morgen gelegte
  Nachricht kam nicht wieder – ohne eine einzige Fehlermeldung.
- **Hinter einem Reverse Proxy zählt die Anmeldebremse wieder je Person.** Ohne das war
  die Absenderadresse jeder Anfrage die des Proxys: zehn Fehlversuche irgendwo hätten
  alle anderen mit ausgesperrt.

### Sicherheit

- **Der lokale Server verlangt jetzt ein Geheimnis.** Vorher konnte jede beliebige
  Webseite, die im Browser offen war, über `http://127.0.0.1:4000` das gesamte Postfach
  mitlesen, das Adressbuch abziehen und in Ihrem Namen Mail versenden – CORS war für
  jede Herkunft geöffnet. Das Geheimnis entsteht bei jedem Start neu und geht nur an das
  eigene Fenster.
- **Der Ereigniskanal (WebSocket) prüft jetzt ebenfalls.** Er unterliegt nicht der
  Same-Origin-Regel; ohne Prüfung bekam jeder Mitlauscher jede eintreffende Nachricht
  mit Absender und Betreff gemeldet.
- **Verschlüsselung wird erzwungen.** IMAP und SMTP fielen bisher still auf eine
  unverschlüsselte Verbindung zurück, wenn der Server kein STARTTLS ankündigte. Ein
  Angreifer im selben Netz musste dafür nur eine Zeile aus der Serverantwort streichen –
  danach ging das Postfachkennwort im Klartext über die Leitung. Betroffen waren die
  Voreinstellungen von Outlook, GMX, web.de und iCloud.
- **Keine Kopfzeilen-Injektion mehr beim Antworten auf fremde Post.** Ein Betreff mit
  einem eingebauten Zeilenumbruch konnte im OpenPGP-Zweig eine zusätzliche Kopfzeile
  erzeugen – etwa ein `Bcc:` an einen Dritten, und das in einer unterschriebenen
  Nachricht.
- **Alle neun bekannten Sicherheitslücken in Abhängigkeiten geschlossen** (Electron,
  nodemailer, @fastify/static, vite und vier weitere).
- Der Standalone-Server lauscht auf `127.0.0.1` statt auf allen Netzwerkschnittstellen.
- Weiterleitungen per `<meta refresh>`, `<base href>` und `@import` werden beim
  Zurückhalten entfernter Inhalte jetzt ebenfalls erfasst – sie funktionieren ohne
  Skript und umgingen den Zählpixelschutz vollständig.
- Electron-Sicherungen („Fuses“) gesetzt: die Anwendung lässt sich nicht mehr als
  beliebiger Node-Interpreter missbrauchen.

### Energy Mail läuft jetzt im Firmennetz

Drei Dinge unterscheiden ein verwaltetes Netz von einem Privatanschluss, und an allen
dreien ist das Programm bisher gescheitert – nicht mit einer Fehlermeldung, sondern
schlicht ohne Verbindung.

- **Der Zertifikatsspeicher von Windows wird mitbenutzt.** Node vertraut nur seiner
  eigenen Liste. Führt ein Netz den Verkehr über eine TLS-Prüfung (Zscaler, Fortinet,
  Sophos), sind die Zertifikate unterwegs neu ausgestellt und mit einer firmeneigenen
  Wurzel unterschrieben, die per Gruppenrichtlinie im Windows-Speicher liegt. Outlook und
  Thunderbird kennen sie; Energy Mail kannte sie nicht und brach **jede** IMAP- und
  SMTP-Verbindung ab, ohne dass jemand etwas hätte einstellen können. Gemessen auf einem
  gewöhnlichen Rechner: 120 mitgelieferte Wurzeln, 106 zusätzliche aus dem System.
- **Ein Proxy wird gefunden und benutzt.** Ist der Weg nach draußen nur über einen Proxy
  offen, findet Energy Mail ihn von selbst – es fragt Windows, und ein PAC-Skript wird
  dabei ausgewertet. Auf einem eingerichteten Firmenrechner ist damit nichts zu tun. Wo
  das nicht genügt, gilt: Richtlinie, dann Konto, dann Umgebung, dann System. Die
  Richtlinie schlägt das Konto, sonst genügte ein Eintrag im Kontodialog, um die
  Ausgangskontrolle zu umgehen. HTTP CONNECT und SOCKS, Ausnahmen in der Schreibweise von
  `NO_PROXY`, Anmeldung mit Basic. NTLM und Kerberos gehen nicht – das steht so auch in
  BETRIEB.md, statt es offenzulassen.
- **Der Proxy gilt auch für die HTTPS-Aufrufe**, also für den Markentausch bei Google und
  Microsoft und für die Serversuche. Ohne diesen Teil liefe die Post, aber kein
  OAuth-Konto könnte sich anmelden – und das sind bei Firmenkunden die meisten.
- **Vorgaben der Organisation** in `%PROGRAMDATA%\Energy Mail\richtlinien.json` – an einem
  Ort, an den ein gewöhnliches Benutzerkonto nicht schreiben darf. Darin: Proxy,
  Ausnahmen, die OAuth-Anwendung, das Abschalten der Selbstaktualisierung und ein
  Ansprechpartner, der im „Über“-Fenster vor der Projektseite steht.
- **Die Oberfläche lässt sich übersetzen — vollständig.** Jede Beschriftung stand fest
  verdrahtet auf Deutsch im Quelltext; für jeden Kunden mit einer nicht deutschsprachigen
  Abteilung ein Ausschlusskriterium. Der Aufwand steckt dabei nicht im Übersetzen, sondern
  darin, die Texte überhaupt herauslösbar zu machen.

  Das ist jetzt getan: **794 Texte** gehen durch den Übersetzer — Menü, Meldungen über
  neue Post, Infobereich, Seitenleiste, Nachrichtenliste, Leseansicht, sämtliche Dialoge,
  die Fehlermeldungen des Servers und die Verbindungsfehler des Kerns. `npm run
  sprachstand` sagt jederzeit, wie weit.

  Deutsch stehen bleiben genau 37 Stellen, und zwar mit Absicht. **Die Grenze verläuft am
  Fensterrand:** Was in einem Fenster steht, liest der Nutzer und gehört in seine Sprache.
  Was ins Protokoll, in den Fehlerbericht oder in die Wanderungstabelle der Ablage
  geschrieben wird, liest derjenige, der das Programm baut — und der liest Deutsch. Ein
  Bericht, dessen eine Hälfte türkisch ist, weil der Absender seine Oberfläche umgestellt
  hat, macht die Fehlersuche schwerer und nicht leichter.

  **Alle neun Kataloge sind vollständig** — Englisch, Französisch, Spanisch, Italienisch,
  Niederländisch, Portugiesisch, Türkisch, Polnisch und Russisch, je 771 von 771. Zehn
  Sprachen, kein offener Posten. Was künftig an Text dazukommt, erscheint zunächst auf
  Englisch und erst dann auf Deutsch — kaputt ist nichts, und `npm run sprachstand` nennt
  die Zahl.

  **Polnisch und Russisch haben drei Mehrzahlformen.** 1 → *nowa wiadomość*,
  2–4 → *nowe wiadomości*, 5 und mehr → *nowych wiadomości* — und das nach der Endziffer,
  weshalb 22 wieder zur mittleren Form gehört und 25 wieder zur letzten. Im Russischen
  greift die Regel noch weiter: Dort wechselt mit der Form auch das Zeitwort — *2 письма
  перемещены*, aber *5 писем перемещено*. Mit zwei Formen wäre in vier von fünf Fällen das
  falsche Wort erschienen; die Prüfung verlangt bei jedem Mehrzahlschlüssel deshalb alle
  drei.

  Die zweite Eigenheit trifft die Sätze ohne `tp()`: „alle 2 Wochen“ heißt *co 2 tygodnie*,
  „alle 5 Wochen“ aber *co 5 tygodni*, und dafür gibt es nur einen Eintrag. Solche Sätze
  sind so gefügt, dass jede Zahl denselben Fall verlangt — im Russischen über die
  Ordnungszahl, deren Endung sich nie ändert (*каждый {abstand}-й день*). Und eine dritte
  gilt nur dort: **kein Zeitwort in der Vergangenheit über den Nutzer**, denn es trägt im
  Russischen das Geschlecht (*ответил* / *ответила*), das kein Programm kennt.

  **Vier Fehler kamen dabei ans Licht, und alle vier waren stumm.**

  *„Abmelden“ war zweierlei.* Dasselbe Wort stand über dem Knopf, der einen Newsletter
  loswird, und über dem, der den Nutzer aus Energy Mail abmeldet — im Deutschen beides
  richtig. Da der deutsche Text der Schlüssel ist, war es aber ein Eintrag für zwei
  Stellen, und alle sieben Kataloge hatten ihn als „vom Programm abmelden“ übersetzt: Der
  Newsletter-Knopf hieß auf Englisch „Sign out“, auf Spanisch „Cerrar sesión“, auf
  Türkisch „Oturumu kapat“. Aufgefallen erst am Polnischen, wo *wypisz się* und
  *wyloguj się* sich nicht einmal ähneln — keine Prüfung kann so etwas sehen, denn beide
  Übersetzungen sind für sich genommen richtig. Der Verteiler hat jetzt seinen eigenen
  Schlüssel („Abbestellen“), und die Regel steht in BETRIEB.md: Wo ein deutsches Wort zwei
  Dinge bedeutet, braucht es zwei Schlüssel.

  *Der Server hatte gar keinen Katalog.* Die Sprache je Anfrage war gebaut, `t()` stand an
  sechsundachtzig Stellen — und `lerneKatalog` rief dort niemand. Jede Meldung fiel auf
  Deutsch zurück, auch für einen Browser, der ausdrücklich Englisch verlangte. Die
  vorhandene Prüfung bestand durchgehend, weil sie ihre Kataloge selbst hinterlegte: Sie
  prüfte das Rohr, nicht ob Wasser hindurchläuft. Jetzt geht eine Prüfung den ganzen Weg
  — echter Server, echte Kataloge, echte Kopfzeile.

  *Die Eingangskontrolle antwortete deutsch.* Fastify ruft die onRequest-Haken in der
  Reihenfolge ihrer Anmeldung, und der Sprachhaken stand zweihundert Zeilen hinter der
  Zugangsprüfung. Die lief damit außerhalb des Sprachkontexts, und ihre beiden Meldungen
  kamen deutsch heraus, obwohl sie längst übersetzt waren. Der Kommentar daneben
  behauptete dabei genau das Richtige — „vor allem anderen“ —, nur stand der Aufruf
  nicht dort, wo er es sagte. Aufgefallen an der laufenden Anwendung und nicht in einer
  Prüfung: Diese Meldung entsteht nur bei einer ABGEWIESENEN Anfrage, und jede Prüfung
  fragt ordnungsgemäß an. Jetzt täuscht eine ausdrücklich eine fremde Herkunft vor.

  *Im Französischen gehört die Null zur Einzahl.* `tp()` entschied über `anzahl === 1`,
  und für Deutsch, Englisch, Niederländisch, Italienisch, Spanisch, Portugiesisch und
  Türkisch ist das richtig. Für Französisch nicht: „0 message“, nicht „0 messages“.
  Aufgefallen beim Vorbereiten des Katalogs, nicht im Betrieb — und dort wäre es nie
  aufgefallen, denn die Prüfung verlangt eine Formentabelle erst ab drei Formen.
  Entschieden wird jetzt auch ohne Tabelle über `Intl.PluralRules`.

  *Alle zehn Kataloge wären in jedem Abruf gelandet.* `import { EN } from …` ist eine feste
  Einbindung; bei einer Sprache gleichgültig, bei zehn lägen neun Zehntel ungenutzt im
  Bündel. Jetzt wird je Sprache nachgeladen: Ein deutscher Nutzer holt 320 KB und sonst
  nichts, ein französischer zusätzlich 64 KB. Der Server dagegen lädt alle — dort ist
  „die eine Sprache“ die falsche Frage.

  **Zwei Werkzeuge halten die Kataloge ehrlich.** `npm run sprachpruefung` läuft als Teil
  von `npm run pruefe` und meldet Waisen, verlorene Platzhalter, fehlende Mehrzahlformen
  und leere Einträge. Es fand sofort eine Waise im englischen Katalog und eine übersehene
  Meldung im Server, die noch nicht durch `t()` ging. Und geschrieben werden die Kataloge
  aus JSON statt von Hand: Bei siebentausend Einträgen über neun Sprachen ist ein
  französisches „l'adresse“ in einer einfach zitierten Zeichenkette keine Frage der
  Sorgfalt mehr, sondern eine Frage der Zeit — und ein durchgerutschter Apostroph macht
  eine ganze Sprache unbrauchbar.

  Dieses Eintragewerkzeug hatte selbst eine stille Falle, und sie ist beim russischen
  Katalog zugeschnappt: Den Bestand liest es aus dem **gebauten** Katalog, geschrieben wird
  der Quelltext. Wer zwei Stapel hintereinander einträgt und dazwischen nicht baut, setzt
  beim zweiten auf einem veralteten Bestand auf — 130 fertige Einträge waren spurlos weg,
  gemeldet nur als beiläufiges „130 offen“ in einer Zeile, die man für normal hält. Jetzt
  vergleicht das Werkzeug die Zeitstempel und bricht ab, statt zu überschreiben.

  **Eine Falle steckte in den Tabellen auf Modulebene.** Die Vorgabe-Etiketten, die
  OpenPGP-Befunde, die Namen der Sonderordner, Gmails Einordnungen, die Formatierleiste,
  die Anleitungen zur OAuth-Einrichtung — alles stand als `const` am Dateianfang. Eine
  solche Tabelle wird beim **Einbinden** gebaut, also bevor die Sprache überhaupt
  feststeht; sie wäre für immer deutsch geblieben, während alles ringsum übersetzt ist.
  Aus jeder wurde eine Funktion. Derselbe Fehler steckte in `dialoge.tsx`, wo
  `new Intl.DateTimeFormat('de-DE', …)` fest verdrahtet war: unter einem englischen
  „Tomorrow morning“ hätte „Do., 16.08., 08:00“ gestanden. Der Fehler meldet sich nicht —
  keine Ausnahme, kein Platzhalter, nur ein deutsches Wort mitten im Englischen. Deshalb
  hält jetzt eine Prüfung die Stelle offen (`spracheZurLaufzeit.test.mts`): Sie stellt
  die Sprache um und sieht nach, ob die Tabellen mitgehen — und ob ein fehlender Eintrag
  wirklich auf den deutschen Text zurückfällt statt leer zu bleiben.

  **Und eine im Messwerkzeug selbst.** Nach der Umstellung bricht der Formatierer lange
  Texte um, aus `t('Satz')` wird ein dreizeiliger Aufruf — und den erkannte der Zähler
  nicht mehr. Er meldete 56 Texte als „noch deutsch", die alle bereits übersetzt waren.
  Die Zahl hätte sich von da an nicht mehr bewegt, egal wie viel Arbeit noch
  hineingegangen wäre. Ein Messwerkzeug, das den Fortschritt nicht mehr abbildet, ist
  schlimmer als keines.

  **Zehn Sprachen sind angemeldet** (de, en, fr, es, it, nl, pl, pt, tr, ru). Für alle
  gelten bereits die richtige Mehrzahlregel, das Datumsformat und die Sortierung.

  **Sechsmal hieß eine örtliche Variable `t`** und verdeckte damit den Übersetzer — in
  ComposeModal, AdressbuchModal, Aktualisierung, zweimal in `ics.ts` und einmal als
  Laufparameter über die Teilnehmer einer Einladung. Fünf davon waren stumm: In jenen
  Blöcken wurde kein Text übersetzt, und wer dort einmal einen einfügt, bekäme
  „t is not a function" und suchte an der falschen Stelle. Der sechste fiel auf, weil der
  Typprüfer ihn fing. Alle sind umbenannt, mit einem Satz daneben, warum.

  Wobei die erste Zahl, die dieses Werkzeug nannte, selbst falsch war: Sein Muster für
  Zeichenketten lief über Zeilenenden hinweg und verschmolz ganze Codeblöcke zu einem
  vermeintlichen Text. Gemeldet wurden dadurch zu wenige. Behoben — und die Lehre steht
  im Quelltext: Eine Messung, die zu gut aussieht, ist so wertlos wie eine, die zu
  schlecht aussieht.

  **Der deutsche Text ist der Schlüssel**, nicht ein erfundener Bezeichner: `t('Neue
  Nachricht')` statt `t('nachricht.neu')`. Damit kann nichts kaputtgehen — fehlt eine
  Übersetzung, steht der deutsche Text da, also genau das, was heute schon dort steht. Bei
  symbolischen Schlüsseln stünde stattdessen „nachricht.neu" in der Oberfläche.

  Die Sprache bestimmt die Richtlinie, sonst die Wahl des Nutzers (Extras → Sprache),
  sonst Windows. Gibt die Organisation eine vor, steht der Menüpunkt ausgegraut da statt zu
  fehlen: Wer die Einstellung sucht und nichts findet, hält es für ein fehlendes Merkmal
  statt für eine Entscheidung seines Hauses.
- **Ein MSI für die Verteilung auf die Arbeitsplätze.** Gebaut wurde bisher nur ein
  NSIS-Setup, das ins Profil eines Nutzers installiert. Intune, SCCM und die
  Softwareverteilung per Gruppenrichtlinie verteilen aber maschinenweit, und die
  Gruppenrichtlinie kennt ausschließlich MSI – ohne dieses Paket müsste jemand an jeden
  einzelnen Arbeitsplatz. Das neue Paket installiert nach „Programme", lässt sich still
  einspielen (`msiexec /qn`) und aktualisiert sich bewusst **nicht** selbst: In einer
  verwalteten Aufstellung entscheidet die IT, welche Fassung wann kommt. Nebenbei liegt die
  Anwendung damit an der sichereren Stelle – unter „Programme" kann ein Prozess im
  Nutzerkontext nicht schreiben, und der Austausch von `app.asar`, vor dem die
  Electron-Fuses schützen, wäre schon am Dateisystem gescheitert.

  Der Upgrade-Code ist ausdrücklich festgeschrieben statt aus der appId abgeleitet. Ohne
  das ginge es gut, bis jemand die appId anfasst – und dann still schief: Windows hielte
  die neue Fassung für ein anderes Programm und installierte sie daneben.

  Das MSI steht **nicht** im gewöhnlichen Bau und nicht in der Veröffentlichung; es
  entsteht auf Zuruf über `npm run paket:firma`. Die CI baut unverändert nur das
  NSIS-Setup, die Selbstaktualisierung für Privatnutzer bleibt also unberührt.
- **Die Serversuche findet jetzt auch Firmendomains.** Bei `name@ihre-firma.de` fanden die
  bisherigen vier Quellen nichts – die Anbieterdatenbank kennt gmx und web.de, und eine
  `autoconfig`-Datei legt kaum eine Firma auf ihre Domain. Übrig blieb das Formular für
  Hostname und Port. Jetzt kommen zwei Wege dazu: der Autodiscover-Abruf für einen eigenen
  Exchange im Haus, und die Erkennung an den MX-Einträgen für Microsoft 365 und Google
  Workspace. An echten Domains nachgemessen – microsoft.com, sap.com, siemens.com und
  shopify.com werden mit den richtigen Servern erkannt, gmx.de und posteo.de bleiben
  unverändert bei ihren bisherigen Quellen.

  Dass Autodiscover den Regelfall **nicht** trägt, gehört dazu: Bei Microsoft 365
  antwortet der Abruf ohne Anmeldung mit 401, und die Zugangsdaten liegen zu diesem
  Zeitpunkt noch gar nicht vor. Deshalb steht die MX-Erkennung daneben. Wo der MX-Eintrag
  woandershin zeigt, wird nichts zurückgegeben – lieber das Formular als eine falsche
  Adresse, die erst beim Anmelden auffällt.

  Nebenbei wurde die Suche schneller, wo sie nichts findet: Die letzten drei Quellen laufen
  jetzt nebeneinander statt hintereinander. Eine Domain ohne jede Auskunft ist nach 0,3
  Sekunden erledigt statt nach zehn.
- **Bei Microsoft 365 und Google sagt die Oberfläche, dass ein Kennwort nichts nützt.**
  Microsoft hat die Kennwortanmeldung für Exchange Online abgeschaltet. Ohne den Hinweis
  tippt jemand sein Windows-Kennwort in das Formular, liest „Anmeldung fehlgeschlagen" und
  sucht den Fehler bei sich.
- **Die Anmeldung bei Microsoft 365 und Google Workspace richtet die IT ein, nicht der
  Mitarbeiter.** Bisher schickte die Einrichtung jeden ins Azure-Portal, um dort selbst
  eine Anwendung zu registrieren – für einen Privatnutzer der ehrliche Weg, in einem
  Unternehmen unmöglich: Dort registriert die IT, und die Zustimmung erteilt ein
  Administrator einmal für alle. Steht die Anwendung in der Richtlinie, entfällt die
  Einrichtung für den Nutzer vollständig; er klickt auf „Anmelden“. Der Dialog zeigt dann
  statt der Anleitung, was gilt, und der Server weist ein Speichern ab – sonst liefe die
  Anmeldung an der Anwendung der Organisation vorbei.
- **Der Microsoft-Mandant lässt sich angeben.** Ohne ihn läuft die Anmeldung über
  `/common`; dort greift die Administratorzustimmung nicht zuverlässig, und jeder
  Mitarbeiter bekommt die Zustimmungsseite doch wieder vorgesetzt. Außerdem kann sich sonst
  jemand versehentlich mit seinem privaten Microsoft-Konto anmelden und wundert sich über
  ein leeres Postfach. Der Wert kommt aus einer Datei und wird deshalb kodiert eingesetzt –
  ein Schrägstrich darin zeigte sonst auf eine ganz andere Stelle beim Anbieter.
- **HSTS** geht im Serverbetrieb hinaus, sobald die Anfrage tatsächlich über TLS kam.
- Im Fehlerbericht stehen jetzt Proxy, Zertifikate und Richtlinien. Bei einer Meldung aus
  einem Firmennetz sind das die ersten drei Rückfragen; ohne sie beginnt jede
  Fehlersuche mit einem Briefwechsel.
- Ein Proxy-Kennwort steht in der Adresse (`http://name:kennwort@proxy:3128`). Es wird
  verschlüsselt abgelegt, in der Oberfläche nie angezeigt und im Protokoll unkenntlich
  gemacht – die bisherigen Regeln griffen dort nicht, weil kein „password=“ davorsteht.

Zwei Fehler hat erst der Versuch am laufenden Programm hinter einem echten Proxy zutage
gebracht, und beide waren lautlos: Die **Postfach-Überwachung** baut ihre Verbindungen
bewusst selbst auf und wäre am Proxy vorbeigelaufen – ausgerechnet die Verbindung, die den
ganzen Tag steht. Und eine Richtliniendatei, die Windows PowerShell mit
`Out-File -Encoding utf8` schreibt, beginnt mit drei unsichtbaren Bytes, an denen
`JSON.parse` scheitert: die Datei wurde gefunden, verworfen, und im Protokoll stand eine
Zeile, die aussah, als sei alles in Ordnung. Beides behoben; die Datei meldet jetzt
außerdem, wenn sie nicht lesbar ist.

### Die Post liegt jetzt verschlüsselt auf der Platte

Bis hierher galt eine Trennung, die DATENSCHUTZ.md offen benannte und die trotzdem an der
falschen Stelle lag: Verschlüsselt waren die *Zugangsdaten* – nicht das, wofür man sie
braucht. Wer den Benutzerordner kopierte oder die Platte ausbaute, las den Wortlaut jeder
geöffneten Nachricht, das ganze Adressbuch und jede wartende Sendung, ohne ein Kennwort zu
kennen.

Verschlüsselt sind jetzt: der **Text, das HTML und die Anhangsangaben** aller
zwischengespeicherten Nachrichten, das **Adressbuch** (Daten Dritter, und es füllt sich
beim bloßen Lesen von selbst), die **wartenden Sendungen** samt Anhängen, der
**Zwischenspeicher** der Ordnerlisten, die **zurückgestellten Nachrichten**, die
**Regeln**, die **gemerkten Suchen**, die **Etiketten** und die **vertrauten Absender**.
Dasselbe Verfahren wie bei den Kennwörtern: AES-256-GCM, Schlüssel über Windows'
safeStorage an das Benutzerkonto gebunden, je Nutzer verschieden.

Was **nicht** verschlüsselt ist und warum: Betreff, Absender, Empfänger und Datum in
`ablage.db`. An ihnen hängen Nachrichtenliste, Sortierung und Suche – verschlüsselt man
sie, lässt sich das Postfach ohne Verbindung gar nicht mehr anzeigen. Der Tausch wird
benannt statt verschwiegen.

**Was es gekostet hat:** die lokale Suche im Nachrichtentext. Der Volltextindex speicherte
den Text im Klartext mit – eine unverschlüsselte zweite Fassung jeder gelesenen Nachricht,
gleich neben der verschlüsselten. Man kann den Index haben oder die Verschlüsselung. Die
lokale Suche deckt jetzt Betreff, Absender und Empfänger ab; im Nachrichtentext sucht der
Anbieter, und der Hinweis unter dem Suchergebnis sagt das.

Beim ersten Start wird eine bestehende Ablage einmalig umgestellt: Texte verschlüsseln,
Suchindex ohne sie neu aufbauen, Datei neu schreiben. Gemessen an einem gewachsenen
Postfach: 751 Millisekunden, Bestand vollständig erhalten. Die JSON-Speicher werden beim
ersten Lesen ersetzt – nicht erst beim nächsten Schreiben. Auch das zeigte erst der Start
am echten Ordner: Adressbuch und Zwischenspeicher waren sofort verschlüsselt, weil sie
ohnehin dauernd geschrieben werden, `regeln.json` und `etiketten.json` standen weiter
offen da. Die werden nur angefasst, wenn jemand eine Regel ändert – also womöglich nie.

Eine Feinheit, die erst der Probelauf an einem echten Postfach zeigte: Den Suchindex zu
*leeren* genügt nicht. FTS5 führt ihn in Segmentblöcken, und ein `delete` setzt dort nur
Grabsteine – der gesamte Wortschatz der alten Nachrichten blieb lesbar. Der Index wird
deshalb weggeworfen und neu gebaut. Die Prüfung, die das absichert, sieht in die
Segmentblöcke selbst; die naheliegende Prüfung („steht das Wort noch in der Datei“) lief
grün durch, weil Testdaten zu klein sind, um das Problem zu haben.

### Meldungen ohne Absender und Betreff

Eine Benachrichtigung erscheint über allem, was gerade auf dem Bildschirm ist – im
Vortrag, in der Bildschirmübertragung, auf dem Sperrbildschirm, wo Windows sie im
Info-Center aufhebt. „Praxis Dr. Behrens: Ihr Befund liegt vor“ ist eine Auskunft, die man
nicht zurücknehmen kann.

Unter Extras lässt sich die Vorschau abschalten; dann nennt die Meldung nur noch das Konto
und „Neue Nachricht“, und statt dreier Meldungen kommt eine für den ganzen Eingang.
Vorgabe bleibt eingeschaltet – eine Meldung ohne Absender lässt die Frage offen, für die
es sie gibt.

### Datenschutz: die Durchsicht

Eine Runde durch das ganze Programm mit einer einzigen Frage: Wo entsteht, liegt oder geht
etwas hinaus, das über einen Menschen Auskunft gibt – und ist das dort nötig? Sieben
Stellen, an denen die Antwort nein lautete.

- **Suchbegriffe standen im Protokoll.** Jede Anfrage wird mit ihrer Adresse
  festgehalten, und die Suche läuft über `/search?q=…`. Damit lag in der Datei, die
  „Fehlerbericht erzeugen“ ausdrücklich zum Verschicken anbietet, eine Liste dessen, wonach
  jemand in seiner eigenen Post gesucht hat. Ein Suchbegriff sagt oft mehr über einen
  Menschen aus als die Nachricht, die er findet.
- **Mailadressen entgingen der Reinigung, wenn sie in einer Web-Adresse standen.** Die
  Regel kannte nur das wörtliche `@` und ging an `max%40beispiel.de` vorbei – also an jedem
  Löschen eines Kontakts und jedem Entziehen des Vertrauens. Die Zusicherung im
  Fehlerbericht („Mailadressen wurden herausgenommen“) stimmte damit nicht.
- **IP-Adressen werden gekürzt festgehalten** (`203.0.113.x`). Genug, um Durchprobieren
  bei der Anmeldung zu erkennen; zu wenig, um einen Anschluss zu benennen. Betrifft den
  Serverbetrieb: dort schickte der Betreiber mit einem Fehlerbericht bislang die Adressen
  seiner Nutzer mit.
- **Gelöscht heißt jetzt überschrieben.** SQLite hakte eine gelöschte Zeile nur als „Platz
  ist wieder frei“ ab. Der Nutzer löschte eine Nachricht, sie verschwand aus der Liste –
  und ihr vollständiger Wortlaut stand weiter in `ablage.db`, lesbar mit jedem Texteditor.
  Beim Entfernen eines Kontos wird die Datei zusätzlich neu geschrieben.
- **Freigegebene Bilder können keine Kennung mehr hinterlassen.** Klickte man „Einmal
  laden“, ging Chromium mit der Werbeanlage um wie mit jeder Webseite: es nahm ihren Keks
  an und schickte ihn beim nächsten Mal zurück. Der Zählpixel in Rundmail A erkannte damit
  den in Rundmail B wieder – genau die Wiedererkennung, gegen die das Zurückhalten gedacht
  ist, nur einen Schritt später. Kekse, Verweise und Client Hints gehen bei fremden Zielen
  nicht mehr mit, und die Programmkennung nennt nicht länger „Energy Mail“ samt Fassung.
- **Ein Schalter für die Rechtschreibprüfung.** Sie ist die von Chromium, und die
  Wörterbücher holt Chromium von einem Server von Google. Geschriebener Text geht dabei
  nicht hinaus, aber ein Abruf ist es – und er stand in keiner Aufzählung dessen, was das
  Programm tut, weil er eine Ebene tiefer passiert. Jetzt steht er in DATENSCHUTZ.md und
  lässt sich unter Extras abstellen.
- **Extras → „Zwischengespeicherte Nachrichten…“.** Erst die Zahlen – wie viele Kopfdaten,
  wie viele Texte, wie viele Megabyte –, dann die Frage. Bis hierher gab es keinen Weg,
  den Bestand loszuwerden, außer `ablage.db` von Hand im Benutzerordner zu suchen.
- **Das Abmelden räumt die Textbausteine weg.** Der Browserspeicher hängt an der Adresse,
  nicht am Nutzer: im Serverbetrieb fand der Nächste am selben Rechner die Formulierungen
  des Vorigen vor. Die Trennung der Nutzer reichte bis in jede Datei auf dem Server und
  endete ausgerechnet dort, wo keine liegt.
- Ohne Anlass, aber weil die Vorgabe die falsche ist: Standort, Kamera, Mikrofon und
  Bildschirmaufnahme werden im Fenster jetzt ausdrücklich abgelehnt. Electron gewährt sie
  sonst von sich aus, und dieses Fenster zeigt fremdes HTML aus E-Mails an.

### Sicherheit: die Durchsicht nach der Nutzertrennung

Eine vollständige Prüfung von Oberfläche und Programm im Anschluss an den Umbau auf
mehrere Nutzer. Der rote Faden: die Trennung war überall dort durchgezogen, wo Dateien im
Spiel sind – und an den drei Stellen ohne Datei nicht.

- **Fremde Post im eigenen Fenster.** Der Ereigniskanal führte einen einzigen,
  prozessweiten Satz Zuhörer. Im Dienstbetrieb bekam damit der Browser jedes Angemeldeten
  die Eingänge *aller* Nutzer gemeldet – mit Betreff, Absender und Empfänger, in dem
  Augenblick, in dem sie eintrafen. Ereignisse gehen jetzt ausschließlich an den Nutzer,
  dem sie gehören; eine eigene Prüfdatei hält das fest.
- **Ein geöffneter Ordner beendete die Überwachung aller anderen.** Der Abgleich der
  laufenden Postfachüberwachung ging über eine gemeinsame Liste, verglich sie aber immer
  nur mit den Konten des gerade arbeitenden Nutzers – und stoppte alles Übrige. Nach dem
  Serverstart hatte deshalb nur der letzte Nutzer der Reihe überhaupt eine Überwachung,
  und im Betrieb genügte ein Klick auf einen Ordner, um sie den anderen abzudrehen.
- **Das Programm stürzte bei jedem Aufwachen ab.** Nach dem Ruhezustand und nach dem
  Entsperren des Bildschirms baut die Anwendung die Postfachüberwachung neu auf. Dieser
  Weg lief ohne Nutzerzuordnung und brach deshalb mit einem Fehler ab, den niemand
  auffing: es kam das Absturzfenster, und das Programm beendete sich. Dasselbe traf das
  Herunterfahren – wartende Nachrichten gingen dabei nicht mehr hinaus und die Ablage
  wurde nicht mehr geordnet geschlossen.
- **Das Zugangsgeheimnis stand im Protokoll und in der Prozessliste.** Für den
  Ereigniskanal lässt sich keine Kopfzeile setzen, also hing es an der Adresse – und die
  schreibt der Server bei jeder Anfrage mit. Der Fehlerbericht, den das Programm zum
  Verschicken anbietet, prüft vorher auf Geheimnisse und fand dieses nicht. Außerdem
  wurde es dem Fenster als Startparameter mitgegeben, womit es in der Befehlszeile stand
  und jeder andere Prozess desselben Benutzers es auslesen konnte. Beides ist behoben.
- **Die Anbietersuche ließ sich auf das eigene Netz richten.** Aus dem, was jemand ins
  Adressfeld tippte, wurde ohne Prüfung eine Adresse gebaut und abgerufen –
  `wer@127.0.0.1:9200` genügte, um den Server im fremden Auftrag an interne Türen klopfen
  zu lassen. Jetzt muss es ein echter Rechnername sein, der nicht ins eigene Netz zeigt;
  Weiterleitungen werden einzeln nachgeprüft und die Antwort ist der Größe nach begrenzt.
- **Ein Entwurf wird beim Öffnen gereinigt.** Antworten, Weiterleiten und Einfügen liefen
  längst durch die Reinigung, das Öffnen eines Entwurfs nicht. Damit gingen beim
  Weiterschreiben Bilder von fremden Servern hinaus – also Zählpixel –, und ein
  Stilblock aus dem Entwurf galt im ganzen Verfassen-Fenster. Die selbst gesetzten Farben
  bleiben dabei erhalten.
- **Zählpixel in SVG werden erkannt.** `<svg><image href="…">` und `<use href="…">` laden
  wie ein gewöhnliches Bild, wurden aber nicht zurückgehalten – und die Leiste meldete
  dabei sogar, es sei nichts angehalten worden.
- **Die Seite lässt sich nicht mehr in ein fremdes Fenster einbetten.** Die Anweisung
  dafür stand in der Schutzrichtlinie der Seite, wo der Browser sie ausdrücklich
  ignoriert – sie kommt jetzt als Kopfzeile vom Server. Dazu `nosniff` und eine
  Verweisrichtlinie, und zwar aus der Anwendung selbst statt nur aus dem Vorbau.
- Die CORS-Freigabe für den Entwicklungsserver hing daran, ob ein Bau geglückt war; ein
  fehlender Ordner schaltete sie im Betrieb an. Sie wird jetzt ausdrücklich gesetzt.
- Ein OAuth-Anmeldevorgang gehört jetzt dem Nutzer, der ihn begonnen hat, und die
  Fehlerangabe des Anbieters wird nicht mehr ungeprüft in die Rückmeldeseite geschrieben.
- Der Masterschlüssel des Dienstes wird bei neuen Aufstellungen mit deutlich stärkeren
  Parametern abgeleitet. Bestehende behalten ihre – andere Werte ergäben einen anderen
  Schlüssel und damit kein einziges lesbares Postfach mehr.

### Sicherheit: die Aktualisierung wird geprüft

Bisher wurde eine heruntergeladene Fassung **gar nicht** geprüft. Das klingt schärfer als
„keine Codesignierung“ und ist es auch: `electron-updater` sieht sich die Signatur nur an,
wenn im Paket ein Herausgebername steht, und der entsteht aus dem Zertifikat. Es gab
keines, also stand er nicht da, also lief die Prüfung nie an. Der einzige Anker war HTTPS
zu GitHub – und die Prüfsumme daneben schreibt dieselbe Stelle, die auch die Datei
hochlädt.

- **Jede Aktualisierung trägt jetzt eine Unterschrift**, und die Anwendung spielt nichts
  ein, was sie nicht vorlegen kann. Sie deckt Fassung und Prüfsumme zugleich ab: eine
  ausgetauschte Datei fällt auf, und eine gültige Unterschrift von früher lässt sich nicht
  für eine andere Fassung wiederverwenden.
- **Der Schlüssel dafür liegt nicht bei GitHub und nicht in der CI**, sondern auf dem
  Rechner, von dem aus veröffentlicht wird. Das ist der Punkt der Übung: ein
  Codesignierzertifikat läge als Geheimnis in derselben CI, die auch baut – wer den Zugang
  übernimmt, signiert seine Fassung einfach mit. Ein Zertifikat kommt trotzdem noch, es
  nimmt die SmartScreen-Warnung bei der Erstinstallation. Die beiden lösen verschiedene
  Aufgaben, nicht dieselbe unterschiedlich gut.
- **Eine neue Fassung wird erst sichtbar, wenn ein Mensch sie freigibt.** Die CI legt sie
  als Entwurf ab; Entwürfe sind für die Selbstaktualisierung unsichtbar. Damit gibt es
  keinen Zeitraum, in dem eine noch nicht unterschriebene Fassung gezogen und abgewiesen
  wird – was beim Nutzer wie ein Angriff aussähe und nur hieße, dass jemand noch nicht
  dazu gekommen ist.
- Fehlt die Unterschrift, ist das Netz weg oder passt die Prüfsumme nicht, wird **nicht**
  eingespielt. Eine Aktualisierung, die ausbleibt, ist ein Ärgernis; eine, die zu Unrecht
  eingespielt wird, ist der Rechner.

Wirksam wird das ab der übernächsten Fassung: eine bereits installierte kennt den
öffentlichen Schlüssel noch nicht und prüft deshalb den Schritt auf die Fassung, die ihn
mitbringt, noch nicht. Ab da prüft jede.

### Kein Datenverlust mehr

- **Konten können nicht mehr verlorengehen.** `accounts.json` wurde bei jeder
  Token-Erneuerung – also stündlich – direkt überschrieben. Ein Absturz in diesem Moment
  kostete alle Konten samt Kennwörtern, und die Anwendung war danach dauerhaft
  unbrauchbar. Jetzt wird atomar geschrieben, mit Sicherungskopie.
- **Eine beschädigte Einstellungsdatei wird geheilt statt überschrieben.** Vorher fiel
  das Lesen stillschweigend auf die Voreinstellung zurück, und der nächste
  Schreibvorgang machte den Verlust endgültig – eine halb geschriebene `regeln.json`
  genügte, um alle Regeln zu verlieren.
- **Eine Nachricht geht beim Senden nicht mehr verloren.** Sie wurde vor dem Versand aus
  der Warteschlange genommen; schlug er fehl, war sie ersatzlos weg. Jetzt wird erst
  gesendet, dann ausgetragen, und ein vorübergehender Fehler führt zu neuen Versuchen.
- **Eine Wiedervorlage kommt auch dann zurück, wenn beim ersten Versuch das Netz fehlt.**
  Bisher wurde der Eintrag in jedem Fall gelöscht – die Nachricht kam nie zurück und lag
  unsichtbar im Ordner „Wiedervorlage“.
- **„In zwei Monaten erinnern“ tut das jetzt auch.** Wartezeiten über 24,8 Tagen ließen
  den Zeitgeber sofort auslösen (eine Grenze in Node); die Nachricht kam augenblicklich
  zurück, geplante Sendungen gingen sofort hinaus.
- **Endgültiges Löschen trifft nur noch die gewählten Nachrichten.** Auf Servern ohne
  UIDPLUS entfernte es alles, was irgendein Programm zum Löschen vorgemerkt hatte – wer
  parallel Thunderbird nutzt, verlor damit unwiederbringlich fremde Nachrichten.
- **Die mbox-Sicherung zerstört nichts mehr.** Sie deutete die Nachricht als UTF-8;
  ältere Post mit Umlauten und jeder binäre Anhang kamen als Ersatzzeichen heraus – und
  das ausgerechnet in der Funktion, die der einzige Ausweg aus dem Programm ist.
- **„Papierkorb leeren“ scheitert nicht mehr an großen Ordnern.** Die Nachrichtenliste
  wurde ungepackt gesendet und sprengte bei zehntausenden Nachrichten die Zeilengrenze
  des Servers.
- **Eine Sicherung mit fehlerhaften Einträgen wird nicht mehr halb eingelesen.** Vorher
  brach der Vorgang mitten darin ab, mit einer englischen Programmiererfehlermeldung,
  und hinterließ einen Zustand, den niemand überblicken konnte.

### Behobene Funktionsausfälle

- **Die OpenPGP-Prüfung lief nur bei der ersten geöffneten Nachricht.** Ab der zweiten
  sah eine unterschriebene oder verschlüsselte Mail aus wie gewöhnliche Post.
- **Ein Klick auf einen Link in einer E-Mail tat gar nichts.** Bestätigungslinks,
  Rechnungen und Abmeldelinks waren unerreichbar – ohne jede Rückmeldung.
- **„Bilder einmal laden“ hatte keine Wirkung.** Die Sicherheitsrichtlinie blockierte
  entfernte Bilder auch nach der Freigabe.
- **Eine Ausnahme beim Zeichnen nahm das ganze Fenster vom Bildschirm** – leere Fläche,
  kein Hinweis, offener Entwurf verloren. Jetzt erscheint eine Seite mit Meldung und
  einem Knopf zum Weitermachen.
- **Nach dem Aufklappen des Notebooks wird neue Post wieder gemeldet.** Die
  IMAP-Verbindung blieb nach dem Standby „halb offen“, ohne dass es jemand merkte.
- **Die Überwachung bricht nicht mehr halbstündlich ab.** Bei den verbreiteten
  Dovecot-Anbietern lief sie in eine Zeitgrenze des Protokolls.
- Antworten des Servers haben jetzt eine Zeitgrenze – vorher konnte die Nachrichtenliste
  dauerhaft „Lade Nachrichten…“ anzeigen, ohne dass sich etwas tun ließ.

### Betrieb

- **Die Anwendung lässt sich als Standard-E-Mail-Programm einstellen.** Ein Klick auf
  eine `mailto:`-Adresse im Browser oder auf „Senden an → E-Mail-Empfänger" im Explorer
  öffnet ein Verfassen-Fenster mit Empfänger, Betreff und Text. Fremde Kopfzeilen aus
  der Adresse (`from`, `reply-to`) werden dabei verworfen – sonst könnte eine Webseite
  den Absender fälschen.
- **Fenstergröße, Position und Maximiert-Zustand werden gemerkt** – mit Prüfung, ob der
  Bildschirm von damals noch da ist.
- **Beenden hängt nicht mehr.** Ein SMTP-Server, der nicht antwortet, ließ die Anwendung
  als unsichtbaren Prozess weiterlaufen; ein Neustart war danach nicht möglich.
- **Beim Beenden werden Server, Datenbank und IMAP-Verbindungen geordnet geschlossen.**
  Vorher wurden bis zu neun Verbindungen ohne Abmeldung abgerissen, was bei GMX und
  Gmail den nächsten Start scheitern lassen konnte.
- Nach einer unbehandelten Ausnahme beendet sich die Anwendung wirklich, statt in
  unbestimmtem Zustand weiterzulaufen und dabei „wurde beendet“ zu melden.
- Lädt die Oberfläche nicht, erscheint eine deutsche Meldung statt Chromiums englischer
  Fehlerseite in einem Fenster ohne Zurück-Knopf.

### Im Infobereich weiterlaufen

- **Ein Symbol im Infobereich** neben der Uhr: es zeigt, ob ungelesene Post da ist, holt
  das Fenster mit einem Klick zurück und bietet „Neue Nachricht", „Jetzt abrufen" und
  „Beenden" an.
- **Das X schließt das Fenster, nicht mehr die Anwendung.** Vorher hörten damit still
  alle Benachrichtigungen auf – der Nutzer machte eine Geste, die er von jedem anderen
  Fenster kennt, und schaltete unwissentlich den Hauptzweck ab. Beim ersten Mal erscheint
  ein Hinweis, der das erklärt und anbietet, es anders zu halten.
- **Abschaltbar** unter Extras → „Beim Schließen in den Infobereich".
- **Start mit Windows** als Schalter unter Extras, voreingestellt aus.
- Nebenbei behoben: Die Windows-Meldungen zeigten aus dem Quellbaum gestartet immer das
  leere Standardsymbol – der Pfad zum Programmsymbol stimmte dort nicht, und der
  Kommentar daneben behauptete das Gegenteil.

### Veröffentlichen

- **Gebaut und hochgeladen wird jetzt in der CI**, nicht mehr auf dem
  Arbeitsplatzrechner. Die ausgelieferte Datei war vorher das Ergebnis eines Rechners,
  dessen Zustand niemand nachvollziehen kann – bei einer Anwendung mit
  Selbstaktualisierung ist der Bauplatz die empfindlichste Stelle der ganzen Kette.
  Von Hand bleibt `npm run veroeffentlichen`, das nur noch die Marke setzt.
- **Eine Marke wird nie mehr verschoben.** Vorher standen dort `git tag -f` und
  `git push --force`: ein zweiter Lauf mit derselben Fassungsnummer ließ zwei
  verschiedene Programme unter einem Namen entstehen, und die Frage „was steckte in
  0.2.1?" war nicht mehr zu beantworten.
- **Marke und `package.json` müssen übereinstimmen.** Die Selbstaktualisierung richtet
  sich nach der Fassung im Paket, nicht nach dem Markennamen.
- **Die Veröffentlichung bekommt endlich ihre Änderungshinweise** aus dieser Datei.
  Vorher wurde sie ohne Text angelegt, und die Aktualisierungskarte meldete eine neue
  Fassung, ohne sagen zu können, was sich geändert hat.
- **Lokal wird kein GitHub-Schlüssel mehr gebraucht.** Er ging vorher als Argument an
  `git` und stand damit in der Prozessliste, für jeden anderen Prozess desselben Nutzers
  lesbar – ausgerechnet dort, wo das Skript versicherte, er sei gut aufgehoben.
- Die Vorabprüfung prüft jetzt auch die Typen, und ein fehlgeschlagenes `git status`
  gilt nicht mehr als sauberer Arbeitsbaum.

### Entwicklung

- Prüfungen laufen über `node --test`: **5 Sekunden statt 30**, alle Fehler auf einmal
  statt nur der erste, und neue Prüfdateien werden von selbst gefunden.
- Neu abgesichert: Zugangsprüfung, atomares Schreiben, Sicherungsprüfung,
  mbox-Byteerhalt, Entschärfen entfernter Inhalte.
- **Electron stand in zwei Fassungen im Baum** (33 und 38): gestartet wurde 33,
  ausgeliefert 38, und die Typprüfung lief gegen 33. Jetzt eine Fassung – 43.
- Übersetzte Prüfdateien werden nicht mehr mit ausgeliefert (es waren 24).
- README, CHANGELOG und Datenschutzhinweis ergänzt.
- `npm run pruefe` führt Typen, Bau und Prüfungen in einem Aufruf aus.

---

## 0.2.1

- Sicherung und Umzug: eine Datei statt zwölf.
- Lizenz ergänzt; nur noch eine Ausfertigung zur Zeit.
- Prüfnetz für Server und IMAP.
- CI: jeder Push wird geprüft, kein Release ohne grüne Suite.

## 0.2.0

- Diagnose: Protokoll, Absturzbehandlung, Fehlerbericht.
- Barrierefreiheit: mit Tastatur und Vorleseprogramm bedienbar.
- OpenPGP, Termineinladungen, kontenübergreifender Posteingang.
- Etiketten, gemerkte Suchen, Adressbuch mit vCard.
- Volltextsuche ohne Server, lokale Ablage, Offline lesen.
- Ziehen und Ablegen, Sortieren, Anzeigedichte.

## 0.1.x

Erste Fassungen: IMAP/SMTP, mehrere Konten, Verfassen, Regeln.
