# Energy Mail

Ein E-Mail-Programm für Windows, das mit jedem IMAP/SMTP-Anbieter zusammenarbeitet.
Kein Konto beim Hersteller, keine Zwischenstation, keine Telemetrie: die Anwendung
spricht unmittelbar mit dem Postfach.

Deutschsprachig – Oberfläche, Meldungen und Quelltext.

---

## Was es kann

- **Beliebige Anbieter.** Die Serveradressen findet die Anwendung selbst (Autoconfig,
  Mozillas Anbieterdatenbank, DNS). Für Gmail, Outlook, GMX, web.de, Posteo, mailbox.org
  und iCloud sind sie zusätzlich fest hinterlegt.
- **Mehrere Konten**, mit kontenübergreifendem Posteingang und kontenübergreifender Suche.
- **Volltextsuche ohne Server** über eine lokale Ablage (SQLite mit FTS5) – 80- bis
  277-fach schneller als die Suche über IMAP.
- **Offline lesen.** Was einmal geladen war, bleibt stehen, wenn das Netz weg ist.
- **OpenPGP**: unterschreiben, prüfen, verschlüsseln, entschlüsseln – mit einem
  Schlüsselbund, der geheime Schlüssel nur verschlüsselt ablegt.
- **Regeln**, Etiketten, gemerkte Suchen, Wiedervorlage, verzögertes Senden.
- **Adressbuch** mit vCard-Ein- und -Ausfuhr; Ordner als mbox-Datei sichern.
- **Termineinladungen** lesen und zu- oder absagen.
- **Entfernte Inhalte werden zurückgehalten**, bis Sie sie freigeben – Zählpixel melden
  dem Absender also nicht, dass Sie die Nachricht geöffnet haben.
- Bedienbar **mit Tastatur und Vorleseprogramm**.
- **Läuft im Infobereich weiter**, wenn das Fenster geschlossen wird – sonst hörten mit
  dem Fenster auch die Benachrichtigungen auf. Abschaltbar unter Extras; dort lässt sich
  auch der Start mit Windows einschalten (voreingestellt aus).

---

## Installation

Die Installationsdatei liegt unter
[Releases](https://github.com/EnergyTrading07/energy-mail/releases).

### Warum Windows vor dem Programm warnt

Beim ersten Start meldet SmartScreen „Der Computer wurde geschützt“ und nennt einen
unbekannten Herausgeber. Das liegt daran, dass die Datei **nicht signiert** ist – ein
Codesignierungs-Zertifikat kostet Geld und ist bisher nicht angeschafft. Die Warnung sagt
nichts darüber aus, ob mit dem Programm etwas nicht stimmt; sie sagt, dass Windows den
Herausgeber nicht kennt.

Über „Weitere Informationen“ → „Trotzdem ausführen“ lässt es sich starten. Wer das nicht
möchte, baut die Anwendung aus dem Quelltext (siehe unten) – das Ergebnis ist dasselbe.

### Oder als Dienst, im Browser erreichbar

Statt auf jedem Rechner installiert, lässt sich Energy Mail auch auf einem eigenen
Rechner betreiben und von überall im Browser benutzen – mit Anmeldung, mehreren Nutzern
und einem Zertifikat von Let's Encrypt. Zwei Container, eine Zeile zum Starten:

```bash
cp .env.beispiel .env    # Name eintragen
docker compose up -d --build
```

Alles Weitere – Nutzer anlegen, Sicherung, Wiederherstellung, was schiefgehen kann –
steht in **[BETRIEB.md](BETRIEB.md)**.

---

## Erste Schritte

**Mit Kennwort (der einfache Weg).** Konto hinzufügen, Adresse und Kennwort eintragen –
die Serveradressen sucht die Anwendung selbst. Bei Anbietern mit Zwei-Faktor-Anmeldung
(Gmail, Outlook, GMX) brauchen Sie statt des Kontokennworts ein **anwendungsspezifisches
Kennwort**; wie das geht, steht in der Hilfe Ihres Anbieters.

**Mit OAuth (für Google und Microsoft).** Dieser Weg verlangt mehr Vorarbeit, als es
aussieht: Sie müssen bei Google bzw. Microsoft **selbst ein Projekt anlegen** und eine
Client-Kennung samt Geheimnis erzeugen. Der Grund ist, dass eine Anwendung ohne eigenen
Server keine Zugangsdaten geheim halten kann – ein mitgeliefertes Client-Geheimnis stünde
in jeder Installation und wäre damit keines. Die Anwendung fragt die Angaben beim
Einrichten ab und erklärt an Ort und Stelle, welche Werte gebraucht werden.

Wer nicht ausdrücklich OAuth braucht, nimmt den Weg über das anwendungsspezifische
Kennwort.

---

## Wo Ihre Daten liegen

Alles unter `%APPDATA%\@energy-mail\desktop\` – ein Ordner, kein Cloud-Konto.

| Datei | Inhalt | Geschützt? |
|---|---|---|
| `accounts.json` | Konten samt Kennwörtern und OAuth-Marken | ja, AES-256-GCM |
| `oauth-clients.json` | Ihre Client-Zugangsdaten | ja, AES-256-GCM |
| `schluesselbund.json` | OpenPGP-Schlüssel; geheime nur verschlüsselt | geheime ja |
| `key.enc` | der Schlüssel dazu, an Ihr Windows-Konto gebunden (DPAPI) | ja |
| `contacts.json` | Adressbuch **im Klartext** | nein |
| `ablage.db` | Kopfdaten aller und Inhalte zuletzt gelesener Nachrichten | nein |
| `regeln.json`, `etiketten.json`, `suchen.json` | Ihre Einstellungen | nein |
| `sendungen.json`, `wiedervorlage.json` | wartende Vorgänge | nein |
| `protokoll/` | Protokoll; Kennwörter und Marken sind darin unkenntlich | – |

**Verschlüsselt sind die Zugangsdaten, nicht der gesamte Bestand.** Wer Zugriff auf Ihr
Windows-Benutzerkonto hat, kann Adressbuch und zwischengespeicherte Nachrichten lesen.
Für den Ordner gilt derselbe Schutz wie für Ihr Benutzerprofil – nicht mehr.

Beim Deinstallieren bleibt der Ordner absichtlich stehen, damit eine Neuinstallation dort
weitermacht. Wer die Daten wirklich loswerden will, löscht ihn von Hand.

Mehr dazu in [DATENSCHUTZ.md](DATENSCHUTZ.md).

---

## Aus dem Quelltext bauen

Gebraucht wird Node 22 oder neuer (`node:sqlite` gibt es erst ab 22).

```bash
npm ci
npm run pruefe     # Typen, Bau und alle Prüfungen
npm start          # startet die Anwendung
npm run dist       # baut Installationsprogramm und portable Fassung
```

Einzelne Schritte: `npm run typecheck`, `npm run build`, `npm test`,
`npm run test:abdeckung`.

### Eine Fassung veröffentlichen

Gebaut und hochgeladen wird **in der CI**, nicht auf dem Arbeitsplatzrechner. Das ist
Absicht: bei einem Programm, das sich selbst aktualisiert, landet alles, was in den Bau
gerät, auf jedem Rechner, der aktualisiert – der Bauplatz muss deshalb nachvollziehbar
sein. Ein sauberer Checkout mit `npm ci` ist das, ein gewachsener Entwicklerrechner nicht.

Von Hand bleibt ein Schritt:

```bash
# 1. Fassungsnummer in package.json erhöhen
# 2. In CHANGELOG.md "## Unveröffentlicht" in die neue Nummer umbenennen
# 3. Einchecken
npm run veroeffentlichen
```

Das prüft den Arbeitsbaum, die Typen und die Prüfungen, setzt dann die Marke und lädt sie
hoch. Alles Weitere – bauen, prüfen, Veröffentlichung anlegen, Datei hochladen – macht
[veroeffentlichen.yml](.github/workflows/veroeffentlichen.yml), ausgelöst durch die Marke.

Ein **GitHub-Schlüssel wird lokal nicht mehr gebraucht**: gepusht wird über die
gewöhnlichen Git-Zugangsdaten, und den Schlüssel zum Hochladen stellt GitHub in der CI
selbst bereit. Es ist also nichts einzurichten.

Wovor der Ablauf schützt:

- **Eine Marke wandert nie.** Zeigt `v0.3.0` schon auf einen anderen Stand, bricht der
  Lauf ab und verlangt eine neue Nummer. Vorher wurde sie mit `--force` verschoben – die
  Veröffentlichung enthielt danach die Installationsdatei aus dem alten Stand, und zwei
  verschiedene Programme trugen dieselbe Nummer.
- **Marke und `package.json` müssen übereinstimmen.** Die Selbstaktualisierung richtet
  sich nach der Fassung *im Paket*, nicht nach dem Markennamen; eine Abweichung ergäbe
  eine Fassung, die sich nie wieder oder endlos aktualisiert.
- **Ohne CHANGELOG-Abschnitt geht es nicht los.** Sonst meldet die Aktualisierungskarte
  eine neue Fassung, ohne sagen zu können, was sich geändert hat.

### Aufbau

| Paket | Zuständig für |
|---|---|
| `packages/mail-core` | IMAP, SMTP, MIME, OpenPGP, ICS, vCard, mbox – kein Zustand, gut prüfbar |
| `packages/server` | HTTP-Schnittstelle, Ablage, Zwischenspeicher, Warteschlangen, Regeln |
| `packages/web` | Die Oberfläche (React) |
| `packages/desktop` | Die Electron-Hülle: Fenster, Menü, Meldungen, Selbstaktualisierung |

Server und Oberfläche laufen **im selben Prozess** wie die Hülle. Der Server lauscht auf
`127.0.0.1:4000` und verlangt ein Geheimnis, das bei jedem Start neu erzeugt und nur dem
eigenen Fenster mitgegeben wird – ohne das beantwortet er keine Anfrage. Siehe
`packages/server/src/zugang.ts`.

### Eine Fassung veröffentlichen

Drei Schritte, und der letzte läuft **nicht** in der CI:

```bash
npm run veroeffentlichen   # 1. Stand prüfen, Marke setzen  (hier)
                           # 2. die CI baut und lädt als ENTWURF hoch
npm run freigeben          # 3. unterschreiben, sichtbar machen  (hier)
```

Zwischen Schritt 2 und 3 ist die Fassung für niemanden sichtbar – Entwürfe sind für die
Selbstaktualisierung unsichtbar, es zieht sie also keine laufende Anwendung. Erst
`npm run freigeben` legt die Unterschrift bei und schaltet sie frei.

**Warum der Umweg.** `electron-updater` prüft die Signatur einer heruntergeladenen
Fassung nur, wenn in der `app-update.yml` ein `publisherName` steht – sonst steigt es in
der ersten Zeile aus. Es gab kein Zertifikat, also stand er nicht da, also fand *keine*
Prüfung statt. Übrig blieb als einziger Anker HTTPS zu GitHub und die Prüfsumme aus der
`latest.yml` – die aber schreibt dieselbe Partei, die auch die `.exe` hochlädt. Wer den
GitHub-Zugang übernimmt, hat damit Codeausführung auf jedem Rechner mit Energy Mail.

Ein Codesignierzertifikat hilft dagegen **nicht**: es läge als Geheimnis in derselben CI.
Wer sie kontrolliert, signiert seine Fassung einfach mit. Deshalb ein eigener Schlüssel,
der den Arbeitsplatzrechner nie verlässt und den die CI nicht kennt. Beide zusammen sind
die vollständige Antwort – das Zertifikat für die Erstinstallation, dieser Schlüssel für
alles danach.

Einmalig einzurichten:

```bash
npm run schluessel-erzeugen
```

Das legt `~/.energy-mail/freigabe-schluessel.pem` an und nennt den öffentlichen Teil, der
nach `packages/desktop/src/updateSignatur.ts` gehört. **Den geheimen Teil sichern** – geht
er verloren, lässt sich keine Aktualisierung mehr freigeben, und der Weg zurück führt über
eine von Hand verteilte Neuinstallation.

---

## Was noch fehlt

Ehrlich benannt, statt es zwischen den Zeilen zu verstecken:

- **Keine Codesignierung.** Daher die SmartScreen-Warnung bei der Erstinstallation: wer
  die Datei von Hand herunterlädt, bekommt weiterhin „Unbekannter Herausgeber“.

  Was das *nicht* mehr bedeutet: dass die Selbstaktualisierung ungeprüft schluckt, was
  ihr vorgesetzt wird. Sie verlangt inzwischen eine eigene Unterschrift – siehe unten.
  Ein Zertifikat bleibt trotzdem auf der Liste, es löst nur eine andere Aufgabe.
- **Gesendet wird nur, solange die Anwendung läuft.** Eine für Dienstag 8 Uhr geplante
  Nachricht geht beim nächsten Start hinaus, wenn der Rechner zu diesem Zeitpunkt aus
  war. Anders ginge es nur mit einem Dienst, der durchgehend läuft. Das
  Infobereichssymbol entschärft das (die Anwendung bleibt beim Schließen des Fensters
  an), löst es aber nicht.
- **Nur Windows.** Der Code ist nicht plattformgebunden, aber nur dort geprüft.
- **Keine Serienterminauflösung.** Wiederkehrende Termine werden angezeigt, aber nicht
  in ihre Einzeltermine aufgelöst.

---

## Einen Fehler melden

Hilfe → „Fehlerbericht erzeugen“ legt eine Datei an. Kennwörter, Marken und die lokalen
Teile von Mailadressen sind darin bereits unkenntlich gemacht – die Reinigung läuft
zweimal und weist ausdrücklich darauf hin, falls sie beim Nachsehen doch noch etwas
findet. Die Datei gehört an ein
[Issue](https://github.com/EnergyTrading07/energy-mail/issues/new).

## Lizenz

MIT – siehe [LICENSE](LICENSE).
