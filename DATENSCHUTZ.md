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

Verfahren: AES-256-GCM mit einem 32 Byte langen Zufallsschlüssel. Dieser Schlüssel liegt
in `key.enc` und ist über Windows' `safeStorage` (DPAPI) an Ihr Windows-Benutzerkonto
gebunden. Auf einem anderen Rechner oder unter einem anderen Windows-Konto sind die
Dateien nicht zu entschlüsseln – auch nicht mit einer Kopie des ganzen Ordners.

Das Kennwort eines geheimen OpenPGP-Schlüssels wird **nicht** gespeichert. Es ist die
letzte Schranke und wird bei jedem Öffnen neu abgefragt.

### Nicht verschlüsselt

| Datei | Inhalt |
|---|---|
| `contacts.json` | das Adressbuch – Namen und Adressen aller Korrespondenzpartner, also **Daten Dritter** |
| `ablage.db` | Kopfdaten aller abgerufenen und Inhalte der zuletzt gelesenen Nachrichten |
| `cache.json` | Ordnerlisten und erste Seiten |
| `regeln.json`, `etiketten.json`, `suchen.json` | Ihre Einstellungen |
| `sendungen.json` | wartende Sendungen samt Text und Anhängen |
| `wiedervorlage.json` | zurückgestellte Nachrichten |
| `protokoll/*.log` | Protokoll (siehe unten) |

**Das ist der wichtigste Satz dieses Dokuments:** Verschlüsselt sind die *Zugangsdaten*,
nicht Ihr Nachrichtenbestand. Wer an Ihrem entsperrten Windows-Konto sitzt, kann
Adressbuch und zwischengespeicherte Nachrichten lesen. Der Schutz entspricht dem Ihres
Benutzerprofils – nicht mehr und nicht weniger.

Wenn das nicht genügt, hilft die Laufwerksverschlüsselung von Windows (BitLocker) oder
ein verschlüsselter Benutzerordner.

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

**Was nicht passiert:** keine Telemetrie, keine Nutzungsstatistik, keine Absturzberichte
im Hintergrund, keine Werbekennung, kein Konto beim Hersteller. Es gibt keine Adresse, an
die das Programm von sich aus etwas über Sie senden würde.

---

## Das Protokoll

Unter `protokoll/` liegt eine Datei, die festhält, was das Programm tut – damit sich ein
Fehler nachvollziehen lässt. Sie wird bei einer Million Zeichen umgebrochen, es liegen
höchstens zwei Stände.

Bevor eine Zeile hineingeht, läuft sie durch eine Reinigung, die Kennwörter,
Bearer-Marken, Basic-Authentifizierung, Google-Zugriffsmarken, JWTs, IMAP-`LOGIN`-Zeilen,
private Schlüsselblöcke und die lokalen Teile von Mailadressen ersetzt. Beim Erzeugen
eines Fehlerberichts läuft dieselbe Prüfung ein zweites Mal, und wenn dabei doch noch
etwas gefunden wird, steht ein Warnhinweis in der Datei.

Der Bericht wird **nirgendwohin gesendet**. Er landet als Datei bei Ihnen; ob und wohin
Sie ihn weitergeben, entscheiden Sie.

---

## Wenn Sie das Programm entfernen

Die Deinstallation lässt den Datenordner absichtlich stehen – damit eine Neuinstallation
oder eine neue Fassung dort weitermacht, statt alle Konten zu vergessen.

Das heißt aber auch: **Adressbuch und zwischengespeicherte Nachrichten bleiben liegen**,
und beide sind unverschlüsselt. Wer den Rechner weitergibt oder verkauft, sollte
`%APPDATA%\@energy-mail\desktop\` von Hand löschen.

---

## Ihre Rechte gegenüber wem?

Es gibt keine Verarbeitung durch einen Dritten, also auch keinen Verantwortlichen im Sinne
der DSGVO, an den Sie sich wenden müssten: Ihre Daten liegen bei Ihnen. Verantwortlich
für die Verarbeitung Ihrer Post ist Ihr **Postfachanbieter** – dessen Datenschutzerklärung
gilt unverändert weiter.

Für das Adressbuch gilt eine Besonderheit, die man wissen sollte: Es enthält die Adressen
von Menschen, die Ihnen geschrieben haben, und wird beim Lesen von Nachrichten von selbst
gefüllt. Das sind personenbezogene Daten Dritter. Solange sie auf Ihrem Rechner zu
persönlichen Zwecken liegen, greift die Haushaltsausnahme (Art. 2 Abs. 2 lit. c DSGVO);
für eine berufliche Nutzung gelten die üblichen Pflichten Ihres Arbeitgebers.

---

*Stand: August 2026. Fragen und Ungenauigkeiten bitte als
[Issue](https://github.com/EnergyTrading07/energy-mail/issues) melden.*
