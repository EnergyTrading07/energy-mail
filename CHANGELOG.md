# Änderungen

Was sich von Fassung zu Fassung geändert hat, in Sätzen statt in Commit-Titeln.

Der Abschnitt zur jeweiligen Fassung wird beim Veröffentlichen als Beschreibung der
GitHub-Release übernommen – dort liest ihn die Aktualisierungskarte im Programm vor.
Vorher stand darin nichts: die Karte meldete eine neue Fassung, ohne sagen zu können,
was sich geändert hat.

---

## Unveröffentlicht

Zweierlei: das Ergebnis einer vollständigen Durchsicht auf Produktionsreife – und der
Umbau vom Einzelplatzprogramm zu einem Dienst, der von überall über den Browser
erreichbar ist.

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
