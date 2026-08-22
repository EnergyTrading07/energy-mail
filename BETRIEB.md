# Energy Mail als Dienst betreiben

Diese Anleitung beschreibt den Betrieb auf einem eigenen Linux-Rechner: mit Anmeldung,
mehreren Nutzern und einem Zertifikat von Let's Encrypt.

Der Dienst selbst veröffentlicht **niemals** einen Port ins Netz. Vor ihm steht immer ein
Vorbau, der die Verschlüsselung übernimmt — und dafür gibt es zwei Aufstellungen:

```
 (a) Es steht schon ein Reverse Proxy im Haus

     Internet ──443──► nginx/Traefik ──► (Tailscale, LAN …) ──► dienst:4000
                       eigener Rechner                          bindet nur an dessen Weg

 (b) Es steht keiner

     Internet ──443──► Caddy ──► dienst:4000
              ──80──►  im selben Compose-Stapel, holt das Zertifikat selbst
```

In beiden Fällen endet die Verschlüsselung auf **Ihrer** Hardware — kein Dienstleister,
kein Netzbetreiber sieht die Post.

---

## 1. Voraussetzungen

```bash
docker --version           # 24 oder neuer
docker compose version     # v2 - "docker-compose" mit Bindestrich ist die alte Fassung
```

Fehlt Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # danach einmal ab- und wieder anmelden
```

**Für Aufstellung (b) zusätzlich im Netz** — das muss vorher stimmen, sonst bekommt Caddy
kein Zertifikat:

| Was | Wie prüfen |
| --- | --- |
| Der Name zeigt auf Ihren Anschluss | `dig +short mail.beispiel.de` gegen `curl -4 ifconfig.me` |
| Port 80 und 443 sind auf den Rechner weitergeleitet | Im Router unter „Portfreigaben" |
| Der Anschluss hat eine öffentliche IPv4 | Weichen die beiden Zahlen oben ab, liegt DS-Lite/CGNAT vor — dann geht keine Portfreigabe |

> **Port 80 wird gebraucht**, auch wenn später alles über 443 läuft: Let's Encrypt prüft
> darüber, dass Ihnen der Name gehört.

Bei Aufstellung (a) entfällt das alles — der vorhandene Vorbau bringt Adresse und
Zertifikat schon mit.

---

## 2. Einrichten

```bash
git clone https://github.com/EnergyTrading07/energy-mail.git
cd energy-mail

cp .env.beispiel .env
nano .env
```

Mindestens `DOMAIN` eintragen. Bei Aufstellung (a) zusätzlich `ENERGY_MAIL_BIND` auf den
Weg setzen, über den der Vorbau herankommt — bei einem Vorbau auf einem anderen Rechner
etwa die Tailscale-Adresse **dieses** Rechners:

```ini
DOMAIN=mail.beispiel.de
ENERGY_MAIL_BIND=100.71.217.53
```

> `.env` muss **neben** der `docker-compose.yml` liegen. Compose füllt die `${…}` in der
> compose-Datei ausschließlich aus seiner eigenen Umgebung und aus `./.env`; ein
> `env_file:` im Dienst reicht Werte nur an den Container durch und lässt die Platzhalter
> leer.

Der Datenordner muss dem Nutzer gehören, unter dem der Dienst läuft — im Container ist
das `node` mit der Nummer 1000. Gehört er root, kann der Dienst nichts speichern, und
zwar erst beim ersten Konto, nicht beim Start:

```bash
mkdir -p betrieb/daten
sudo chown -R 1000:1000 betrieb/daten
chmod 700 betrieb/daten
```

Dann starten:

```bash
# (a) hinter vorhandenem Vorbau
docker compose up -d --build

# (b) mit eigenem Caddy
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

Beim ersten Start steht im Protokoll (`betrieb/daten/protokoll/`):

```
WARN [schluessel] Masterschlüssel neu erzeugt: /daten/master.key. OHNE DIESE DATEI sind
                  alle hinterlegten Zugangsdaten unwiederbringlich verloren …
INFO [nutzer]     Einplatznutzer "lokal" eingerichtet (1 Nutzer insgesamt).
INFO [server]     Frontend wird ausgeliefert aus /app/packages/web/dist
INFO [server]     Server läuft auf 0.0.0.0:4000
```

Alles vier ist richtig so. Der Nutzer `lokal` ist kein Postfach für jemanden: er stammt
aus dem Einzelplatzbetrieb, sein Kennwort ist zufällig und niemandem bekannt, und
anmelden kann sich unter ihm niemand. Er steht in `nutzerWerkzeug.js liste` mit dabei.

Prüfen, ob der Dienst antwortet:

```bash
docker compose exec dienst node -e "fetch('http://127.0.0.1:4000/gesundheit').then(r=>r.text()).then(console.log)"
# {"ok":true,"fassung":"0.2.1","laeuftSeit":12,"verschluesselung":true}
```

---

## 3. Der Vorbau bei Aufstellung (a)

Der Dienst erwartet vom Vorbau drei Dinge. Fehlt eines, fällt es erst im Betrieb auf:

| Nötig | Warum |
| --- | --- |
| `X-Forwarded-Proto: https` | Sonst fehlt dem Sitzungskeks das `Secure`-Kennzeichen und er ginge auch über eine unverschlüsselte Verbindung hinaus. |
| `X-Forwarded-For` | Sonst ist die Absenderadresse jeder Anfrage die des Vorbaus, und zehn Fehlversuche irgendwo sperren alle anderen mit aus. |
| WebSocket auf `/ws` | Ohne das kommt keine neue Post von selbst an — die Oberfläche zeigt erst beim Neuladen etwas. |

Für nginx:

```nginx
server {
    listen 443 ssl;
    http2 on;
    server_name mail.beispiel.de;

    ssl_certificate     /etc/letsencrypt/live/mail.beispiel.de/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.beispiel.de/privkey.pem;

    # Anhänge: der Dienst nimmt bis 40 MB an, Base64 bläht sie um rund ein Drittel auf.
    client_max_body_size 45M;

    # Diese Seite gehört in kein fremdes Fenster. Die Oberfläche sagt das in ihrer
    # eigenen Richtlinie auch - nur steht die als <meta> in der Seite, und dort wird
    # frame-ancestors von jedem Browser ignoriert. Wirksam ist allein die Kopfzeile.
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Der Gesundheitsweg bleibt drinnen: er verlangt bewusst keine Anmeldung.
    location = /gesundheit { return 404; }

    location / {
        proxy_pass http://100.71.217.53:4000;
        proxy_http_version 1.1;

        # Ohne diese beiden Zeilen bleibt der Ereigniskanal stumm.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;

        # Ein Postfach mit 30.000 Nachrichten zu durchsuchen dauert; die
        # WebSocket-Verbindung steht den ganzen Tag.
        proxy_connect_timeout 60s;
        proxy_send_timeout    3600s;
        proxy_read_timeout    3600s;

        proxy_buffering         off;
        proxy_request_buffering off;
    }
}
```

`$connection_upgrade` muss einmal im `http`-Block stehen — in den meisten Aufstellungen
ist das schon der Fall:

```nginx
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
```

**Keine Content-Security-Policy im Vorbau.** Die Oberfläche bringt eine eigene mit
(`packages/web/index.html`), und sie ist dort begründet — sie erlaubt zum Beispiel Bilder
von `https:`, weil sonst „Absender immer erlauben" wirkungslos wäre. Eine zweite
Richtlinie ersetzt jene nicht, sondern schneidet sich mit ihr: es gilt dann die jeweils
strengere Angabe beider. Das Ergebnis wäre eine Oberfläche, an der Dinge fehlen, und eine
Fehlersuche an der falschen Stelle.

---

## 4. Der Masterschlüssel

Beim ersten Start entsteht `betrieb/daten/master.key` — 32 zufällige Bytes.

**Mit ihm sind sämtliche hinterlegten Postfach-Kennwörter zu öffnen. Ohne ihn keines.**

Er wird nicht aus einem Kennwort abgeleitet und liegt nirgendwo sonst. Geht die Datei
verloren, müssen alle Nutzer sämtliche Konten neu einrichten — aus einer Sicherung ist
dann nichts mehr zu holen, auch nicht mit Aufwand.

Deshalb gleich jetzt, nicht später:

```bash
sudo cat betrieb/daten/master.key
```

Den Inhalt in einen Kennwortspeicher legen — **nicht** auf denselben Rechner, nicht in
dieselbe Sicherung wie die Daten. Liegen Schlüssel und Daten am selben Ort, schützt die
Verschlüsselung vor niemandem.

---

## 5. Nutzer anlegen

Es gibt bewusst keine Selbstanmeldung: sonst könnte sich jeder aus dem Netz ein Postfach
auf Ihrer Hardware anlegen. Angelegt wird auf dem Server.

```bash
docker compose exec dienst node packages/server/dist/nutzerWerkzeug.js anlegen anna@beispiel.de
```

```
Angelegt: anna@beispiel.de (Kennung anna)
Kennwort: 3BeVLAa6ejwaaJAce9

Dieses Kennwort steht nirgends sonst - es lässt sich nicht noch einmal anzeigen.
Weitergeben, und den Nutzer bitten, es nach der ersten Anmeldung zu ändern.
```

Weitere Befehle:

```bash
… nutzerWerkzeug.js liste                       # wer hier ein Postfach hat
… nutzerWerkzeug.js kennwort anna@beispiel.de   # neu setzen, meldet überall ab
… nutzerWerkzeug.js sperren anna                # kommt nicht mehr herein, Daten bleiben
… nutzerWerkzeug.js freigeben anna
… nutzerWerkzeug.js verwalter anna              # darf Nutzer verwalten
… nutzerWerkzeug.js entmachten anna             # Rolle nehmen (nie beim letzten)
… nutzerWerkzeug.js zweifaktor-aus anna         # zweiten Faktor entfernen (verlorenes Telefon)
… nutzerWerkzeug.js entfernen anna              # endgültig - siehe unten
```

### Verwalter

Es gibt zwei Rollen: **Verwalter** und gewöhnlicher Nutzer. Ein Verwalter legt Nutzer an,
setzt Kennwörter zurück, sperrt, gibt frei und vergibt die Rolle weiter — über die Wege
unter `/verwaltung`, die ausschließlich er erreicht.

**Der erste angelegte Nutzer wird Verwalter.** Bei einer bestehenden Aufstellung, in deren
`nutzer.json` noch keine Rolle steht, ernennt der Start den zuerst angelegten Nutzer und
schreibt es ins Protokoll. Der Pseudo-Nutzer `lokal` ist davon ausgenommen — über ihn weist
sich das Desktop-Fenster aus, sein Kennwort sind zufällige Bytes, die niemand kennt.

**Den letzten Verwalter kann niemand absetzen, sperren oder entfernen.** Danach käme keiner
mehr an die Verwaltung, und der Dienst wäre nur noch über die Befehlszeile zu retten. Wer
die Rolle abgeben will, ernennt erst jemand anderen.

> **Was ein Verwalter tatsächlich kann — offen gesagt.** Er setzt Kennwörter zurück; damit
> kann er sich als dieser Mensch anmelden und dessen Post lesen. Das ist keine Lücke,
> sondern die Bauart: Die Postfachkennwörter liegen mit dem Masterschlüssel des Servers
> verschlüsselt, und den hat, wer den Server betreibt. Ein Zurücksetzen steht deshalb als
> **Warnung** im Protokoll, mit Namen.

Das Befehlszeilenwerkzeug bleibt — es ist der Weg zurück, wenn im Browser niemand mehr
hereinkommt, und der einzige, der ohne einen funktionierenden Verwalter auskommt.

### Verwalten im Browser

Ein Verwalter findet in der Seitenleiste **Nutzer**. Dort steht dieselbe Liste wie unter
`nutzerWerkzeug.js liste`, dazu die Knöpfe zum Anlegen, Kennwort zurücksetzen, Sperren,
Rolle vergeben, den zweiten Faktor zurückzusetzen und Entfernen.

**Das Kennwort erscheint genau einmal** — beim Anlegen und beim Zurücksetzen. Danach steht
im Eintrag nur noch die Prüfsumme; wer den Kasten wegklickt, ohne es mitzunehmen, muss es
erneut zurücksetzen.

Der Weg dorthin wird gewöhnlichen Nutzern nicht angezeigt. Das ist Höflichkeit und kein
Schutz: Wer die Adresse von Hand aufruft, bekommt **403**, gleich was die Oberfläche zeigt.

`entfernen` löscht den Eintrag und damit den Schlüssel dieses Nutzers. Seine Geheimnisse
sind ab diesem Augenblick unlesbar — auch in jeder Sicherung, die es von ihnen gibt. Der
Ordner bleibt liegen, bis Sie `--mit-daten` dazuschreiben.

> **Ein neuer Nutzer bekommt seine Hintergrundarbeit erst beim nächsten Start** des
> Dienstes (Überwachung, geplante Sendungen, Wiedervorlagen). Bis dahin funktioniert
> alles, was er selbst auslöst. Nach dem Anlegen mehrerer Nutzer also einmal
> `docker compose restart dienst`.

### Die Selbstanmeldung

Damit sich Menschen ihr Konto selbst anlegen können, ohne dass Sie für jedes eine Zeile
tippen. **Sie ist ab Werk aus und bleibt es auch nach einer Aktualisierung** — eine
Fähigkeit, die sich beim Einspielen von selbst einschaltet, wäre eine Lücke mit
Änderungsvermerk.

Einzurichten unter **Nutzer → Selbstanmeldung**. Drei Betriebsarten:

| Betriebsart | Wer kommt herein | Wofür |
|---|---|---|
| **Aus** | Nur wen Sie anlegen | Der Regelfall für einen kleinen Betrieb |
| **Antrag mit Freigabe** | Wer einen Antrag stellt und von Ihnen freigegeben wird | Sie behalten die Entscheidung, sparen aber die Tipparbeit |
| **Offen mit Mailbestätigung** | Wer seine Adresse über den Bestätigungslink nachweist | Größere Aufstellungen, meist zusammen mit dem Domänenfilter |

**Der Domänenfilter ist die wirksamste einzelne Einstellung.** Tragen Sie dort `firma.de`
ein, kommt niemand von außen bis zum Antrag — auch bei offener Betriebsart nicht. Für einen
Betrieb ist das fast immer die richtige Antwort; leer heißt: jede Adresse der Welt.

**„Offen" gibt es nur mit Systemversand** (siehe unten). Ohne Bestätigungsmail hieße
„offen" schlicht: jeder, der ein Formular ausfüllt, und der könnte sich ein Konto auf die
Adresse eines Kollegen anlegen. Schalten Sie den Sendeserver später ab, fällt der Dienst
auf „Antrag mit Freigabe" zurück und sagt Ihnen das im Verwaltungsfenster — er bleibt nicht
stillschweigend offen.

Ein Antrag speichert **Adresse, Zeitpunkt und die Prüfsumme des Kennworts** — keine
Netzadresse. Unbestätigte Anträge verfallen nach sieben Tagen, bestätigte und unbeschiedene
nach dreißig. Was Sie ablehnen, wird gelöscht und nicht vermerkt.

> **Die Zahl am Verwaltungsknopf ist Ihre einzige Benachrichtigung.** Eine Mail an Sie wäre
> der naheliegende Weg — und zugleich ein Werkzeug, mit dem sich Ihr Postfach von außen
> fluten ließe. Sehen Sie also gelegentlich nach, wenn Sie „Antrag mit Freigabe" fahren.

Beim Freigeben gilt das Kennwort, das der Antragsteller selbst gewählt hat. Sie bekommen es
nicht zu sehen und brauchen es nicht — anders als beim Anlegen von Hand gibt es hier kein
Kennwort, das zwei Menschen kennen.

### Der Absender des Dienstes (Systemversand)

Für alles, was der **Dienst selbst** verschickt: den Bestätigungslink vor allem. Bis hierher
verschickte Energy Mail nur im Auftrag eines angemeldeten Menschen über dessen Postfach; eine
Mail an jemanden, der noch kein Konto hat, geht von niemandem aus.

Einzurichten unter **Nutzer → Absender des Dienstes**. Nehmen Sie ein **eigenes Postfach**
(`noreply@firma.de` oder ähnlich) und kein persönliches: Sonst läge dessen Kennwort in der
Servereinrichtung, und mit dem Ausscheiden dieses Menschen hörte die Registrierung auf zu
funktionieren.

- Port **587** mit STARTTLS ist die Vorgabe, **465** die Alternative. Beides ist
  verschlüsselt; unverschlüsselt versendet dieser Weg nicht, auch dann nicht, wenn der
  Server kein STARTTLS ankündigt — dann scheitert er sichtbar.
- Das Kennwort geht nie wieder hinaus, auch nicht an Sie. Danebensteht nur, *ob* eines
  hinterlegt ist.
- **Verbindung prüfen** klopft mit den Angaben aus dem Formular an, bevor Sie sichern.

> **Ohne `ENERGY_MAIL_OEFFENTLICHE_ADRESSE` geht kein Bestätigungslink hinaus.** Der Link
> wird ausschließlich daraus gebaut und niemals aus der Anfrage: Den `Host`-Kopf bestimmt
> der Anfragende, und ein Link daraus wäre eine echte, von Ihrem Server verschickte Mail,
> deren Link auf den Rechner eines Angreifers zeigt. Wer eine Aufstellung nach Abschnitt 3
> betreibt, hat die Variable ohnehin gesetzt.

### Die Desktop-Fassung an Ihren Server hängen

Ab dieser Fassung bringt die Desktop-Anwendung **keinen eigenen Server mehr mit**. Sie ist
ein Fenster auf Ihren – und deshalb sehen Programm und Browser dieselben Postfächer.

Beim ersten Start fragt sie nach der Adresse. Es ist dieselbe, unter der Ihre Leute im
Browser arbeiten (`https://mail.firma.de`), und sie wird beim Eintragen geprüft: Die
Anwendung ruft `/gesundheit` ab und zeigt die Fassung, die dort antwortet. Später zu
wechseln geht über **Extras → Server wechseln…**.

Was Sie dabei wissen sollten:

- **`http://` wird abgewiesen**, außer zu `localhost`. Über diese Verbindung läuft ein
  Anmeldekennwort und danach jede Nachricht — ein Server im Netz braucht ein Zertifikat.
- **Die gespeicherte Adresse wird bei jedem Start neu geprüft.** Sie liegt in
  `huelle.json` im Benutzerordner, und dort kann jedes Programm desselben Benutzers
  hineinschreiben; ungeprüft wäre sie ein Weg, die Anwendung auf einen fremden Server
  umzuleiten.
- **Benachrichtigungen kommen weiterhin vom Betriebssystem.** Die Oberfläche meldet neue
  Post über die Brücke an die Hülle — der Weg über den eingebetteten Server ist entfallen.
- **OAuth-Konten richten Sie am Server ein.** Die Richtliniendatei unter `%PROGRAMDATA%`
  gilt weiterhin für Proxy und Sprache; die Client-Kennungen gehören jetzt in die
  Einrichtung des Servers, weil dort der Markentausch läuft.

> **Für bestehende Einzelplatz-Installationen ist das ein Umzug.** Deren Daten liegen unter
> `%APPDATA%\@energy-mail\desktop\` und sind aus der neuen Fassung heraus nicht mehr
> erreichbar. Der Weg: in der **alten** Fassung „Extras → Einstellungen sichern…", dann die
> neue installieren, mit dem Server verbinden und die Sicherung dort einlesen. Wer keinen
> Server betreibt, bleibt auf der vorigen Fassung.

### Die Desktop-Fassung zum Herunterladen bereitstellen

Ihre Leute holen sich das Programm aus der Weboberfläche (**Einstellungen → Für den
Rechner**) statt aus dem Netz. Dafür legen Sie die Installationsdatei in

    <Datenordner>/downloads/

Den genauen Pfad zeigt **Nutzer → Desktop-Fassung bereitstellen** mit einem Knopf zum
Kopieren, dazu, was gerade darin liegt. Ausgeliefert wird nur, was auf `.exe`, `.msi`,
`.dmg`, `.pkg`, `.AppImage`, `.deb`, `.rpm` oder `.zip` endet — alles andere im Ordner
bleibt unsichtbar. Der Abruf verlangt eine Anmeldung.

> **Hochladen über die Oberfläche gibt es bewusst nicht.** Eine Route, über die sich
> ausführbare Dateien auf den Server schreiben lassen, wäre aus einem übernommenen
> Verwalterkonto heraus die Erlaubnis, an alle Arbeitsplätze Ihres Betriebs ein fremdes
> Programm zu verteilen. Aus einem Mailserver würde eine Softwareverteilung. Legen Sie die
> Datei über den Weg dorthin, den Sie ohnehin haben.

### Kennwort vergessen

Steht ein Systemversand, kann sich jeder Nutzer selbst ein neues Kennwort geben: Im
Anmeldefenster steht dann **„Kennwort vergessen?"**. Er bekommt einen Link, der eine Stunde
gilt und sich einmal verwenden lässt.

Ohne Systemversand gibt es diesen Weg nicht, und das Anmeldefenster zeigt ihn dann auch
nicht an — es bleibt beim Zurücksetzen durch Sie.

> **Der zweite Faktor bleibt dabei stehen.** Wer sein Kennwort über den Link neu setzt,
> wird beim Anmelden weiterhin nach seinem Code gefragt. Für ein verlorenes Telefon ist
> also weiterhin *Sie* zuständig — der Knopf „2FA zurücksetzen" in der Nutzerliste. Das ist
> Absicht: Ein Weg, der beides zugleich zurücksetzt, machte den zweiten Faktor wertlos,
> denn es genügte, einmal an das Postfach zu kommen.

Was Sie darüber wissen sollten:

- **Alle Sitzungen des Nutzers werden beendet**, sobald er das neue Kennwort setzt.
- **Ihr Zurücksetzen entwertet seine Links** und umgekehrt. Wenn Sie also für jemanden ein
  Kennwort setzen, kann eine ältere Mail in seinem Postfach das nicht mehr überschreiben.
- **Gesperrte Nutzer bekommen keinen Link**, sondern die Nachricht, dass sie sich an Sie
  wenden sollen — ein neues Kennwort würde an der Sperre ohnehin nichts ändern.
- Der Einplatznutzer der Desktop-Hülle (`lokal`) ist über diesen Weg nicht erreichbar.
- Auch hier gilt: **ohne `ENERGY_MAIL_OEFFENTLICHE_ADRESSE` kein Link.**

Drei Anfragen je Stunde und Anschluss, zehn Einlöseversuche. Jede Anfrage löst genau eine
Mail aus, auch bei einer unbekannten Adresse — das ist gewollt (siehe unten) und über die
Bremse begrenzt.

### Die Anmeldebremse

Gegen Durchprobieren zählt der Dienst Fehlversuche mit — in `anmeldebremse.json`, also
**über Neustarts hinweg**. Das ist der springende Punkt: Vorher stand die Zählung im
Arbeitsspeicher, und jedes Einspielen einer Fassung setzte sie zurück.

| Ebene | Grenze | Sperre | wogegen |
|---|---|---|---|
| Anschluss + Adresse | 10 Fehlversuche | 15 Minuten | jemand probiert **ein** Postfach durch |
| Anschluss allein | 50 Fehlversuche | 1 Stunde | dasselbe Kennwort gegen **viele** Adressen |

**Eine Sperre allein auf die Adresse gibt es bewusst nicht.** Sie wäre von jedem gegen
jeden auslösbar: Adresse kennen, zehnmal etwas Falsches schicken, und der Betroffene kommt
eine Viertelstunde lang von nirgends mehr an seine Post.

In der Datei stehen **keine Mailadressen und keine Anschlusskennungen** — nur salzige
Prüfsummen. Die Bremse muss vergleichen, nie zurücklesen; für das Vergleichen genügt die
Prüfsumme, und dann entsteht gar nicht erst ein Verzeichnis darüber, wer sich wann von wo
vertippt hat. Die Datei darf jederzeit gelöscht werden — dann zählt es von vorn.

### Die Sitzungssperre

Nach **einer Stunde ohne Betätigung** fällt die Sitzung zu. Sie wird nicht beendet: Der
Nutzer bleibt derselbe, gibt sein Kennwort ein und arbeitet weiter — auch an einem Entwurf,
den er begonnen hatte. Daneben gibt es in der Seitenleiste **Sperren** für den, der den
Platz bewusst verlässt.

```yaml
environment:
  # Minuten bis zur Sperre. 0 schaltet sie ab.
  ENERGY_MAIL_SPERRE_MINUTEN: 15
```

**Gesperrt ist am Server, nicht im Fenster.** Jede Anfrage einer gesperrten Sitzung
beantwortet der Dienst mit **423**. Ein Vorhang in der Oberfläche wäre keiner: Der Keks
gilt weiter, und ein zweiter Tab bekäme die Post ungehindert.

Die Oberfläche sperrt **zusätzlich** von sich aus, sobald niemand mehr tippt — und das ist
kein doppelter Boden, sondern nötig: Der Server sieht Untätigkeit erst bei der nächsten
Anfrage, und vor einem Bildschirm, vor dem niemand sitzt, kommt keine. Ohne sie bliebe die
Post sichtbar stehen, bis jemand vorbeikommt.

> **Im Desktop-Betrieb gibt es keine Sperre.** Dort weist sich das Fenster mit dem
> Zugangsgeheimnis des Prozesses aus — es gibt keine Sitzung und kein Kennwort, also auch
> nichts, was eine Sperre wieder aufmachen könnte. Für den unbeaufsichtigten Arbeitsplatz
> ist dort die Sperre des Betriebssystems zuständig (Windows: `Win`+`L`, und eine Zeitsperre
> in den Anmeldeoptionen).

---

### Die Zwei-Faktor-Anmeldung

Jeder Nutzer kann sie sich unter **Mein Konto** in der Seitenleiste selbst einrichten: ein
Einmalcode aus einer Authenticator-App, zusätzlich zum Kennwort. Verwendet wird TOTP nach
RFC 6238 — dasselbe, was Google Authenticator, Aegis, 1Password, Bitwarden und jede andere
App dieser Art beherrschen. Es gibt dafür **keinen fremden Dienst**: kein SMS-Versender,
kein Konto bei irgendwem. Der Server rechnet den Code selbst aus.

Beim Einrichten erscheint ein QR-Bild und darunter derselbe Schlüssel zum Abtippen, falls
die Kamera nicht mitspielt. Bestätigt wird mit einem Code **und** dem eigenen Kennwort —
sonst könnte ein Vorübergehender an einem unbeaufsichtigten Bildschirm den zweiten Faktor
auf sein eigenes Telefon einrichten. Danach erscheinen **zehn Wiederherstellungscodes**,
genau einmal.

> **Die Wiederherstellungscodes sind der Ersatz für das Telefon.** Ausdrucken oder an einen
> sicheren Ort legen. Jeder gilt einmal; sind sie aufgebraucht, meldet das Konto es
> rechtzeitig, und man kann sich einen frischen Satz erzeugen — solange man noch
> hereinkommt.

**Die Anmeldung läuft dann in zwei Schritten.** Auf das richtige Kennwort hin entsteht
**noch keine Sitzung**, sondern eine Marke: fünf Minuten gültig, fünf Versuche, und sie
öffnet ausschließlich die Codeabfrage. Erst der richtige Code setzt den Sitzungskeks. Ein
Code lässt sich **nicht zweimal** einlösen — wer ihn über die Schulter mitliest, kann ihn
nicht in derselben halben Minute noch einmal benutzen. Und die Anmeldebremse zählt mit;
bei sechs Ziffern ist das kein Beiwerk, sondern die halbe Sicherheit des Verfahrens.

**Beim Entsperren einer zugefallenen Sitzung wird der Code nicht verlangt.** Er beantwortet
die Frage „ist das wirklich dieses Konto" — die hat die Sitzung beim Anmelden bereits
beantwortet. Die Sperre beantwortet „sitzt noch derselbe Mensch davor", und dafür genügt
das Kennwort. Wer bei jedem Entsperren das Telefon hervorholen müsste, stellte die Sperre
nach dem dritten Mal ab.

**Wenn das Telefon verloren geht**, gibt es zwei Wege zurück:

1. Ein Verwalter räumt den Faktor im Browser ab (Nutzerverwaltung → **2FA zurücksetzen**).
2. Auf dem Server selbst:

```bash
docker compose exec dienst node packages/server/dist/nutzerWerkzeug.js zweifaktor-aus anna@beispiel.de
```

Der zweite Weg ist der letzte Ausweg und wird gebraucht: Wenn der **einzige** Verwalter
sein Telefon verliert, kommt niemand mehr in die Verwaltung — der Knopf dafür ist ja dort.
Beide Vorgänge stehen als Warnung im Protokoll.

> **Was der zweite Faktor leistet — und was nicht.** Er schützt gegen ein abhandengekommenes
> Kennwort. Das ist der häufigste Weg, auf dem fremde Menschen in ein Postfach kommen:
> dasselbe Kennwort wie anderswo, und anderswo gab es einen Einbruch. Er schützt **nicht**
> gegen jemanden, der bereits an dem angemeldeten Rechner sitzt, und **nicht** gegen den
> Betreiber des Servers — das Geheimnis liegt dort verschlüsselt, aber mit dem
> Masterschlüssel zu öffnen. Wer etwas anderes behauptet, sagt die Unwahrheit.

**Im Desktop-Betrieb gibt es das nicht.** Dort weist sich das Fenster mit dem
Zugangsgeheimnis des Prozesses aus — es gibt keine Anmeldung, vor die sich ein zweiter
Faktor schalten ließe. Der Punkt **Mein Konto** erscheint dort gar nicht erst.

---

### Das Firmenverzeichnis (LDAP / Active Directory)

Ein Verwalter richtet es einmal ein — in der Nutzerverwaltung ganz unten. Danach findet
**jeder** Nutzer beim Tippen eines Empfängers auch die Kollegen aus dem Verzeichnis, unter
dem Namen, der dort steht. Gelesen wird nur; geändert nie. Das Programm kann es nicht —
der Client beherrscht ausschließlich Anmelden und Suchen.

Zwei Vorlagen zum Anklicken (Active Directory, OpenLDAP) belegen Filter und Feldnamen vor;
darunter lässt sich jedes Feld einzeln ändern. Kein Verzeichnis gleicht dem anderen.

**Die Reihenfolge im Formular ist die der Fehlersuche:** erst kommt man überhaupt hin
(Adresse, Verschlüsselung), dann darf man etwas (Anmeldung), dann findet man etwas
(Suchbereich, Filter), dann steht das Richtige da (Feldzuordnung). **Verbindung prüfen**
sagt nach jedem Schritt, ob es bis dahin trägt — und zwar mit den Angaben aus dem Formular,
nicht mit den gespeicherten.

| Verschlüsselung | Port | wann |
|---|---|---|
| **LDAPS** | 636 | verschlüsselt ab dem Verbindungsaufbau — die erste Wahl |
| **StartTLS** | 389 | beginnt im Klartext und schaltet um, bevor das Kennwort geht — so machen es die meisten AD |
| **ohne** | 389 | das Bind-Kennwort geht im Klartext über die Leitung |

> **Das Dienstkonto gehört zu den Angaben, bei denen ein bequemer Griff später teuer wird.**
> Dorthin gehört ein Konto, das im Verzeichnis **nur lesen** darf — kein
> Administratorkonto. Sein Kennwort liegt mit dem Masterschlüssel verschlüsselt auf dem
> Server und geht nie wieder heraus, auch nicht an einen Verwalter: In der Oberfläche steht
> nur, **ob** eines hinterlegt ist.

Ein vollständiger Filter für ein Active Directory, der Rechnerkonten und deaktivierte
Konten heraushält:

```
(&(objectCategory=person)(objectClass=user)(mail=*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))
```

Die letzte Bedingung ist eine Microsoft-Erweiterung; ein OpenLDAP kennt sie nicht. Deshalb
steht sie nicht in der Vorlage, sondern hier zum Übernehmen.

**Der Grundfilter gilt zusätzlich zu jeder Suche.** Wer `(!(objectClass=computer))`
einträgt, sieht keine Rechnernamen — auch nicht, wenn einer zufällig „Müller" heißt.

**Was der Nutzer eintippt, wird maskiert** (RFC 4515), bevor es in den Filter geht. Ohne
das baute eine Eingabe wie `*)(objectClass=*` einen anderen Filter als gemeint — dieselbe
Sorte Lücke wie eine SQL-Einschleusung, nur dass hier die Personaldaten eines Unternehmens
dahinterstehen.

**Höchstens 25 Treffer je Suche**, und die Ergebnisse werden 30 Sekunden lang gemerkt: Wer
einen Namen tippt, löst je Buchstabe eine Suche aus, und der Verzeichnisdienst ist
meistens derselbe Rechner, der auch die Anmeldungen macht.

**Ein Verzeichnis, das gerade nicht erreichbar ist, legt nichts lahm.** Dann fehlen eben
die Kollegen, und das eigene Adressbuch steht weiterhin da. Die Störung geht ins Protokoll,
nicht in die Oberfläche.

---

### Lesebestätigungen

**Anfordern:** im Verfassen-Fenster ein Häkchen. Es fällt bei jedem neuen Fenster auf aus
zurück — wer sie einmal braucht, braucht sie nicht immer.

> **Eine Lesebestätigung sagt, dass die Nachricht auf einem Bildschirm stand.** Nicht, dass
> jemand sie gelesen, verstanden oder zur Kenntnis genommen hat. Das steht so in RFC 8098,
> es steht in der Bestätigung selbst, und es steht hier — denn im Geschäftsleben wird
> regelmäßig das Gegenteil behauptet. Als Nachweis taugt sie nicht: Der Empfänger
> entscheidet, ob er eine schickt, und viele Programme schicken grundsätzlich keine.

**Beantworten:** einstellbar je Konto in den Kontoeinstellungen.

| | |
|---|---|
| **Nie senden** | Niemand erfährt, wann Sie eine Nachricht geöffnet haben. |
| **Jedes Mal fragen** *(Vorgabe)* | Ein Band über der Nachricht, ein Klick. |
| **Immer senden** | Ohne Rückfrage — mit einer Ausnahme, siehe unten. |

Nie beantwortet wird eine Anforderung aus Werbung (`Precedence: bulk`), von einem Verteiler
(`List-Id`), von einem Automaten (`Auto-Submitted`), aus einem Zustellbericht
(`Return-Path: <>`) oder von einer der eigenen Adressen. **Eine Bestätigung an einen
Werbeversender wäre mehr wert als ein Klick auf ein Zählpixel** — hier antwortet ein
Programm mit einer echten Mail von einer echten Adresse.

**Die Ausnahme bei „Immer senden":** Zeigt `Disposition-Notification-To` auf eine andere
Adresse als den Absender, wird trotzdem gefragt — und zwar mit einem deutlichen Hinweis.
Das ist der bekannte Missbrauch: Eine Nachricht an einen Verteiler, deren Bestätigungen an
ein fremdes Postfach gehen, macht aus vierhundert Lesern vierhundert Absender, und keiner
von ihnen ahnt etwas davon. RFC 8098 verlangt an dieser Stelle ausdrücklich, dass ein
Mensch zustimmt.

**Ein „Nein" hält so lange wie ein „Ja".** Beides wird in `lesebestaetigungErledigt.json`
gemerkt, an der Message-ID. Sonst käme die Frage bei jedem Öffnen wieder — so lange, bis
jemand aus Versehen zustimmt.

**Verschickt wird, wenn die Nachricht wirklich vor jemandem steht** — nicht, wenn der
Server sie abgerufen hat. Der Abruf geschieht auch für eine Vorschau, einen
Zwischenspeicher oder eine Suche; eine Bestätigung von dort behauptete „angezeigt", ohne es
zu wissen.

---

### Freigegebene Postfächer und Stellvertretung

Anna gibt eines ihrer Postfächer für Bernd frei: in **Einstellungen des Kontos → Für andere
freigeben**, mit Bernds Anmeldeadresse und der Wahl zwischen **nur lesen** und **voller
Zugriff**. Bernd findet es danach in seiner eigenen Seitenleiste, gekennzeichnet. Zwei
Fälle, ein Verfahren: das Sammelpostfach `info@`, das drei Leute lesen, und die Vertretung
während einer Krankheit.

**Was der Vertreter darf:**

| | nur lesen | voller Zugriff |
|---|---|---|
| Post lesen, suchen, sichern | ✓ | ✓ |
| verschieben, löschen, als gelesen markieren | — | ✓ |
| senden (mit Vermerk, siehe unten) | — | ✓ |
| Regeln und Abwesenheitsnotiz des Postfachs | — | ✓ |
| Name, Signatur, Zugangsdaten, Konto entfernen | — | — |
| das Postfach weiterverschenken | — | — |

**Die letzten beiden Zeilen sind der Punkt.** Wer ein Postfach zum Bearbeiten bekommt,
bekommt nicht das Recht, es abzuschaffen — ein Vertreter, der aus Versehen „Konto
entfernen" trifft, vernichtete sonst die Zugangsdaten eines anderen Menschen.

**Gesendetes trägt einen Vermerk.** `From` bleibt die Adresse des Postfachs — der Empfänger
antwortet dorthin, und das ist gewollt. Daneben steht `Sender:` mit der Adresse dessen, der
wirklich getippt hat; Outlook und Thunderbird zeigen daraufhin „Bernd im Auftrag von Anna".
Ohne diese Zeile verschickte ein Vertreter Post, die aussieht, als hätte sie der Eigentümer
geschrieben. Auf SPF und DMARC wirkt sie nicht.

**Eine Freigabe umfasst genau ein Postfach** — nicht Annas übrige Konten, nicht ihr
Adressbuch, nicht ihre Etiketten, nicht ihre Einstellungen und nicht ihre anderen
Freigaben. Technisch läuft jede Anfrage auf das freigegebene Konto in Annas Datenkontext
(dort liegen Zugangsdaten, Zwischenspeicher und Regeln); alles andere bleibt in Bernds.
Gewechselt wird ausschließlich, wenn die Kennung des freigegebenen Kontos im Pfad steht.

**Zurücknehmen** kann der Eigentümer jederzeit, der Beschenkte kann das Postfach selbst
weglegen, und ein Verwalter kann jede Freigabe beenden. Jedes Anlegen steht als **Warnung**
im Protokoll — es ist der Vorgang, nach dem später jemand fragt.

> **Zurücknehmen beendet den Zugang, nicht das Gelesene.** Wer drei Wochen mitgelesen hat,
> hat drei Wochen mitgelesen. Deshalb steht die Rückfrage vor dem Freigeben und nicht erst
> vor dem Beenden.

Beim Entfernen eines Nutzers gehen seine Freigaben in **beide** Richtungen mit: Was er
verschenkt hat, zeigte sonst auf ein Postfach ohne Schlüssel; was er bekommen hat, wäre ein
Eintrag auf eine Kennung, die eines Tages neu vergeben wird.

**Was noch fehlt:** Der Vertreter bekommt bei neuer Post im freigegebenen Postfach **keine
Sofortmeldung**. Die Postfachüberwachung läuft im Konto des Eigentümers; beim Vertreter
erscheint neue Post beim nächsten Abruf. Für ein Sammelpostfach, das ohnehin regelmäßig
angesehen wird, ist das verschmerzbar — für eine Vertretung, bei der es auf Minuten
ankommt, nicht.

---

### Die Abwesenheitsnotiz

Jeder Nutzer schaltet sie sich in der Seitenleiste unter **Abwesenheit** selbst ein, je
Konto getrennt. Wer geschäftlich und privat dasselbe Programm benutzt, will im Urlaub der
Firma antworten und dem Fußballverein nicht.

> **Sie antwortet nur, solange dieser Dienst läuft.** Sie hängt an der
> Postfachüberwachung, nicht am Server des Anbieters. Für einen Dienst, der ohnehin
> durchläuft, ist das der richtige Tausch — für einen Arbeitsplatzrechner, der abends
> ausgeht, wäre es der falsche. Wer eine Notiz braucht, die auch bei ausgeschaltetem
> Dienst antwortet, muss die des Anbieters nehmen.

**Was sich einstellen lässt:** Zeitraum (beide Felder dürfen leer bleiben — kein Von heißt
„ab sofort", kein Bis heißt „bis auf Widerruf"), Betreff, Text, „nur an Menschen aus
meinem Adressbuch" und nach wie vielen Tagen derselbe Absender wieder eine bekommt
(Vorgabe: vier).

**Was sich ausdrücklich nicht einstellen lässt**, und das ist keine Lücke: ob auf
Zustellberichte, Verteiler, Werbung oder andere Abwesenheitsnotizen geantwortet wird. Nie
wird geantwortet auf

| | warum nicht |
|---|---|
| Zustellberichte (`Return-Path: <>`) | Die Antwort kommt unzustellbar zurück, die Notiz antwortet darauf — zwei Postfächer laufen über Nacht über. |
| andere Abwesenheitsnotizen (`Auto-Submitted`) | Sonst schreiben sich die beiden das Wochenende über. |
| Verteiler (`List-Id`, `List-Unsubscribe`) | Vierhundert Fremde erfahren sonst von Ihrer Urlaubsplanung. |
| Werbung (`Precedence: bulk`) | Eine Antwort bestätigt dem Versender, dass die Adresse gelesen wird. |
| `noreply@`, `mailer-daemon@`, `postmaster@` | Dort sitzt niemand. |
| Post, die nicht an Sie adressiert war | Blindkopie oder Weiterleitung: Der Absender hat Ihnen nicht geschrieben, und die Notiz verriete ihm, wo seine Post landet. |
| alles außerhalb des Posteingangs | Aus dem Spamordner heraus zu antworten bestätigt dem Versender die Adresse. |

Maßgeblich ist RFC 3834. Die Notiz selbst trägt `Auto-Submitted: auto-replied`,
`X-Auto-Response-Suppress: All` und `Precedence: bulk` — daran erkennt die Gegenseite, dass
hier eine Maschine geantwortet hat.

**Wem geantwortet wurde, steht in `abwesenheitGesendet.json`** im Nutzerordner — also über
Neustarts hinweg. Ohne das bekäme ein Kollege, der täglich schreibt, nach jedem Einspielen
einer Fassung erneut dieselbe Notiz. Die Datei darf jederzeit gelöscht werden; dann zählt
es von vorn.

**Höchstens fünfzig Antworten je Konto und Stunde.** Ein Notaus, keine Feineinstellung:
Meldet ein Anbieter nach einer Störung den halben Posteingang noch einmal als „neu", stünde
der Dienst sonst danach auf jeder Sperrliste.

**Keine Kopie im Gesendet-Ordner.** Wer drei Wochen weg ist, hätte sonst hundert Zettel
zwischen seiner wirklichen Post. Was hinausging, steht mit Adresse und Zeitpunkt im
Protokoll.

Der Knopf in der Seitenleiste ist hervorgehoben, solange wirklich geantwortet wird — nicht
schon, wenn der Schalter irgendwann einmal umgelegt wurde. Eine Abwesenheitsnotiz, die man
nicht sieht, bleibt drei Monate nach dem Urlaub an.

---

### S/MIME — unterschreiben und verschlüsseln mit Zertifikaten

Das ist das Verfahren, mit dem Unternehmen ihre Post schützen: Outlook kann es, jede
Ausgabestelle stellt dafür Zertifikate aus, und in vielen Häusern ist es Pflicht. Es liegt
neben OpenPGP und ersetzt es nicht — beides bleibt nebeneinander benutzbar.

**Der Unterschied zu OpenPGP in einem Absatz.** Ein PGP-Schlüssel behauptet selbst, zu wem
er gehört; wer das glauben will, vergleicht Fingerabdrücke. Ein Zertifikat behauptet es
auch — aber eine Ausgabestelle hat die Behauptung unterschrieben, und die Unterschrift
lässt sich bis zu einer Wurzel zurückverfolgen, der der Rechner ohnehin traut. Deshalb
läuft S/MIME in Unternehmen und PGP nicht: **Niemand muss Fingerabdrücke vergleichen.**
Der Preis steht in derselben Zeile — man traut damit der Ausgabestelle.

#### Einrichten

Was ein Nutzer bekommt, ist eine `.p12`- oder `.pfx`-Datei mit einem Kennwort. Genau die
nimmt **Seitenleiste → Zertifikate → Eigene Schlüsseldatei einlesen** entgegen. Beide
gängigen Bauarten werden gelesen: die heutige (PBES2 mit AES-256) und die alte, die
Windows und ältere Ausgabestellen bis heute liefern (SHA-1 mit 3DES).

Beim Einlesen steht eine Frage, die man nicht überlesen sollte:

> **Bei jeder Benutzung nach einem Kennwort fragen** — voreingestellt an.

Der geheime Schlüssel liegt in jedem Fall verschlüsselt, gebunden an das
Windows-Benutzerkonto. Mit dieser zweiten Schranke kommt ein Kennwort dazu, das bei jedem
Unterschreiben und beim Öffnen jeder verschlüsselten Nachricht abgefragt wird. **Ohne sie
kann jeder, der am angemeldeten Rechner sitzt, in Ihrem Namen unterschreiben und Ihre
verschlüsselte Post lesen.** In einem Büro mit unverschlossenen Bildschirmen ist das
Abschalten der schlechtere Tausch.

Der Schlüssel wird beim Einlesen **neu verpackt**, nicht so übernommen, wie er in der Datei
lag: mit AES-256 statt der Absicherung von 1999, die viele Ausgabestellen noch verwenden.
Die Datei selbst bleibt unberührt — sie ist Ihre Sicherung, und sie sollte es bleiben.

#### Die Zertifikate der anderen kommen von selbst

**Jede unterschriebene Nachricht bringt das Zertifikat ihres Absenders mit.** Wer Ihnen
einmal unterschrieben geschrieben hat, steht danach in der Liste — und kann ab da
verschlüsselte Post bekommen, ohne dass jemand etwas eingerichtet hätte. So kommt S/MIME
in der Praxis überhaupt in Gang.

Übernommen wird aber nur, was sich restlos geprüft hat: Unterschrift geht auf, Kette trägt
bis zu einer bekannten Wurzel, **und die Adresse im Zertifikat ist die des Absenders.**
Jede schwächere Stufe hieße, ein Zertifikat aufzunehmen, dessen Zugehörigkeit gerade nicht
feststeht — und danach ginge verschlüsselte Post an den Falschen.

Für jemanden, der noch nie unterschrieben geschrieben hat, gibt es den Knopf **Fremdes
Zertifikat aufnehmen** (`.cer`, `.crt`, `.pem`).

#### Was das Band über einer Nachricht sagt

Nur ein einziger Fall bekommt Grün: Unterschrift geht auf, Kette trägt bis zu einer Wurzel
dieses Rechners, Adresse passt zum Absender. Alles andere ist Gelb oder Rot — **auch dann,
wenn die Rechnung aufgeht.** Der wichtigste dieser Fälle:

> **„Unterschrift ohne bekannte Herkunft"** — die Rechnung geht auf, aber für das
> Zertifikat steht keine Stelle gerade, die dieser Rechner kennt.

Ein solches Zertifikat stellt sich jeder in einer halben Minute selbst aus, auf jede
beliebige Adresse. Ein grüner Haken dafür würde den Sinn des ganzen Verfahrens verkehren.

Woher die Wurzeln kommen: aus **demselben Speicher, mit dem auch die Verbindung zum
Postfach geprüft wird** — dem des Betriebssystems samt Nodes eigener Liste (siehe Abschnitt
10, „Der prüfende Vorbau"). In einem Unternehmen ist das die entscheidende Zeile: Die eigene
Ausgabestelle steht per Gruppenrichtlinie im Windows-Speicher, und nur weil er hier
mitgelesen wird, gilt das firmeneigene Zertifikat auch in diesem Programm.

#### Verschlüsseln

Verschlüsselt wird nur, wenn für **jeden** Empfänger ein Zertifikat vorliegt; sonst bleibt
der Schalter aus und nennt die fehlenden Adressen. Einen zu übergehen hieße, ihm etwas
Unlesbares zu schicken, ohne dass es jemandem auffiele.

Wer „verschlüsseln" wählt, bekommt **immer auch eine Unterschrift**, und zwar innerhalb des
Umschlags. Nur dort beweist sie etwas — eine außerhalb ließe sich austauschen, ohne den
Inhalt zu berühren.

Das Verfahren richtet sich nach dem schwächsten Empfänger. Bevorzugt wird **AES-256-GCM**,
weil es eine nachträgliche Veränderung des Geheimtextes erkennt; AES-256-CBC tut das nicht,
und genau darauf setzten die EFAIL-Angriffe von 2018 auf. GCM wird aber nur gewählt, wenn
**jeder** Empfänger es angekündigt hat — was er in seiner eigenen unterschriebenen Post
getan haben muss. Ist auch nur einer dabei, von dem nichts bekannt ist, gilt CBC. Eine
Nachricht, die der Empfänger nicht öffnen kann, wäre der schlechtere Ausgang.

#### Was ausdrücklich nicht geht

**Anhänge bleiben ungeschützt.** Geschützt wird der Text, und wer einen Anhang anhängt,
bekommt einen Hinweis statt einer halb geschützten Nachricht.

**Beides zugleich gibt es nicht.** Eine Nachricht ist entweder mit OpenPGP oder mit S/MIME
geschützt. Zwei Unterschriften nebeneinander haben kein festes Aussehen — jedes Programm
zeigt etwas anderes an, manche verschlucken eine davon.

**Rücknahmelisten werden nicht abgefragt.** Ein Zertifikat, das die Ausgabestelle
zurückgezogen hat, gilt hier weiter bis zu seinem Ablaufdatum. Das ist die größte offene
Stelle dieses Abschnitts, und sie steht hier, damit niemand etwas anderes annimmt.

**Elliptische Kurven nur beim Prüfen.** Unterschriften mit ECDSA und Ed25519 werden geprüft;
verschlüsselt wird ausschließlich an RSA-Zertifikate. Für Kurven verlangt CMS ein eigenes
Verfahren zur Schlüsseleinigung, das hier nicht gebaut ist. Praktisch stellt heute nahezu
jede Ausgabestelle RSA aus.

**SHA-1 gilt nicht als Nachweis.** Eine damit unterschriebene Nachricht wird als „nicht
prüfbar" ausgewiesen und nicht als gültig. Für SHA-1 gibt es praktisch durchführbare
Kollisionen; ein grüner Haken darauf wäre schlimmer als keine Prüfung.

**Zwei alte Verschlüsselungsverfahren werden benannt, aber nicht gelesen.** Schlüsseldateien
mit RC2 — sehr alte Ausgaben und manche Windows-Exporte — brauchen einen neuen Export. Die
Meldung sagt das Verfahren beim Namen, damit man weiß, was zu tun ist.

---

### Datenschutz: welche Papiere Sie brauchen — und welche nicht

**Verwaltung → Datenschutz.** Vier Fragen, die kein Programm selbst beantworten kann (wer
betreibt den Server, kommt jemand von außen heran, gibt es einen Betriebsrat, sind die
Nutzer Beschäftigte) — alles andere wird abgelesen.

Heraus kommt zuerst ein **Befund**, und der ist der eigentliche Nutzen:

- **Wer verarbeitet im Auftrag.** An erster Stelle der Postfachanbieter — dort liegt die
  Post, nicht hier.
- **Wer ausdrücklich keiner ist.** Reine Softwareüberlassung ist keine
  Auftragsverarbeitung. Ein AVV mit dem Hersteller wäre ein Vertrag über nichts. Erst
  wenn jemand von außen zu Wartungszwecken an die Daten herankommen **kann** — ob er
  hineinsieht, spielt keine Rolle —, wird er einer.

Auf Knopfdruck entsteht daraus ein Ordner:

| Datei | Was es ist |
|---|---|
| `00-LIESMICH.md` | Was zu tun ist, in der Reihenfolge. Das einzige Papier, das immer entsteht. |
| `10-Verarbeitungsverzeichnis.md` | Art. 30 DSGVO, mit den offenen Punkten am Ende |
| `20-Technische-und-organisatorische-Massnahmen.md` | Art. 32 DSGVO, **aus dem laufenden Stand erhoben** |
| `30-AVV-Serverbetrieb.md` | Nur, wenn ein Dienstleister den Server betreibt |
| `31-AVV-Fernwartung.md` | Nur, wenn jemand von außen herankommt |

Für den **Postfachanbieter liegt bewusst kein Entwurf bei**: Microsoft und Google
unterschreiben keine fremden Verträge. Ihr Vertrag ist fertig und liegt in deren
Verwaltungsoberfläche — bei Microsoft 365 unter „Datenschutzbestimmungen", bei Google
Workspace unter „Datenverarbeitungszusatz". Bei einem kleineren Anbieter fragt man danach;
wer keinen hat, ist der falsche Anbieter für Geschäftspost. **Das ist der wichtigste Punkt
der ganzen Liste**, und er steht auch im Deckblatt.

Die Maßnahmenliste ist abgelesen, nicht abgeschrieben: Dort steht, wie viele Nutzer es
gibt, wie viele davon wirklich einen zweiten Faktor eingerichtet haben und ob die
Zugangsdaten verschlüsselt liegen. Sie ist bei jeder wesentlichen Änderung neu zu
erzeugen; die alten Fassungen gehören aufbewahrt.

> **Kein Rechtsrat.** Die Regelfälle sind abgedeckt. Bei Beschäftigtendaten, einem
> Betriebsrat und Übermittlungen in Drittländer gehört ein Mensch darüber, bevor etwas
> unterschrieben wird — und dieser Satz steht in jedem erzeugten Papier.

Zwei Punkte, die der Befund ausdrücklich nennt, weil sie fast immer übersehen werden: Ein
Archiv, das jede Nachricht aufzeichnet, ist nach **§ 87 Abs. 1 Nr. 6 BetrVG
mitbestimmungspflichtig** — die Eignung zur Verhaltenskontrolle genügt, die Absicht ist
gleichgültig. Und **private Nutzung des Geschäftspostfachs**: Ein klares Verbot oder eine
klare Erlaubnis ist der Weg; eine ungeregelte Duldung ist der schlechteste Zustand.

---

### Das Archiv nach GoBD

Geschäftspost ist aufzubewahren — sechs Jahre für Handels- und Geschäftsbriefe, acht für
Buchungsbelege (§ 147 AO). Eine Mail ist ein Geschäftsbrief wie jeder andere; ein Postfach
ist kein Archiv, weil man darin löschen und verschieben darf, und genau das soll man auch.

**Der wichtigste Satz zuerst, und er steht auch im Programm:** Kein Programm macht
jemanden „GoBD-konform". Die GoBD sagen es in Randziffer 179 selbst — Zertifikate und
Testate Dritter entfalten gegenüber der Finanzverwaltung keine Bindungswirkung.
Ordnungsmäßig ist ein *Verfahren*, und dazu gehören die Organisation im Betrieb und die
Frage, was überhaupt aufbewahrungspflichtig ist. Was hier steht, ist der technische Teil.

#### Einschalten

**Seitenleiste → Archiv → Einrichten.** Angehakt wird je Konto, und ohne diesen Haken
geschieht **gar nichts**. Ein privates Postfach unbemerkt mitzuschreiben wäre gegenüber
dem Nutzer falsch und gegenüber jedem, der ihm schreibt, ebenso.

Ab dem Einschalten wird jede ein- und ausgehende Nachricht **im Original** abgelegt —
alle Kopfzeilen, der Text in seiner ursprünglichen Kodierung, alle Anhänge. Eingehend in
dem Moment, in dem die Postfachüberwachung sie meldet, also bevor der Nutzer sie zu
Gesicht bekommt; ausgehend mit genau den Bytes, die hinausgegangen sind.

> **Es gibt kein Nachtragen.** Was vor dem Einschalten lief, ist nicht im Archiv. Das
> fällt sonst erst in der Prüfung auf.

Die Nachrichten liegen damit zweimal — im Postfach und im Archiv. Bei üblicher
Geschäftspost sind das ein paar hundert Megabyte im Jahr.

#### Fristen

Voreingestellt ist „Geschäftsbrief" (6 Jahre). Eine Nachricht lässt sich in der Liste auf
„Buchungsbeleg" (8 Jahre) umtragen; die Frist kann sich dabei **verlängern, aber nie
verkürzen**. Sonst ließe sich eine unbequeme Nachricht dadurch loswerden, dass man sie
kurz vor einer Prüfung zur Privatpost erklärt.

Gerechnet wird ab dem **Schluss des Kalenderjahres** (§ 147 Abs. 4 AO), nicht ab dem
Datum. Eine Rechnung vom 3. Februar 2025 und eine vom 28. Dezember 2025 laufen beide am
31.12.2033 ab. Das ist die Stelle, an der sich fast jeder vertut.

**Gelöscht wird nichts von selbst.** Was seine Frist hinter sich hat, wird gezählt und
angezeigt; entfernt wird es erst, wenn jemand es ausdrücklich anstößt, und dann in zwei
Schritten. Der Eintrag in der Kette bleibt dabei stehen — sonst entstünde eine Lücke, und
niemand könnte sagen, ob dort etwas ablief oder etwas verschwand.

#### Das Siegel

Jeder Eintrag enthält den Abdruck der Nachricht und den Abdruck des vorigen Eintrags. Wer
einen Eintrag in der Mitte ändert, müsste alle folgenden neu rechnen — und dabei ändert
sich der letzte Abdruck, das **Siegel**, zwangsläufig.

> **Was das nicht leistet.** Wer Verwalterrechte auf diesem Rechner hat, kann jede Datei
> überschreiben, auch die Kette. Kein Programm auf einem gewöhnlichen Rechner kann das
> verhindern. Die Kette macht eine Änderung **erkennbar**, nicht unmöglich.

Damit daraus etwas wird, gehört das Siegel regelmäßig **außerhalb dieses Rechners**
notiert — ins Übergabeprotokoll, in eine Mail an den Steuerberater, auf einen Zettel. Ein
Siegel, das nur auf demselben Rechner steht, beweist nichts. Es steht deshalb oben im
Fenster und in jeder Ausfuhr.

**Bestand nachrechnen** liest jede Datei und hält sie gegen ihren Abdruck. Das dauert bei
einem großen Archiv Minuten und läuft nur auf Anstoß. Eine Nachricht, die nicht mehr zu
ihrem Abdruck passt, wird **nicht angezeigt** — eine Datei mit unbekanntem Inhalt als
Original auszugeben wäre schlimmer, als gar nichts auszugeben.

#### Für die Betriebsprüfung

**Ausfuhr erzeugen** legt einen Ordner an:

| Datei | Was darin steht |
|---|---|
| `post/*.eml` | Die Nachrichten im Original. Jedes Mailprogramm öffnet sie. |
| `nachrichten.csv` | Die Übersicht, semikolongetrennt, UTF-8. |
| `index.xml` | Die Beschreibung dazu nach dem Beschreibungsstandard für die Datenträgerüberlassung. |
| `siegel.txt` | Siegel und Ergebnis der Bestandsprüfung — auch wenn es schlecht ausfällt. |
| `Verfahrensdokumentation.md` | Siehe unten. |

Das ist der Weg **Z3** aus § 147 Abs. 6 AO. Den Ordner kopiert man auf den Datenträger,
den die Prüfung bekommt.

Zwei Dinge dazu ehrlich: Die **DTD** zur `index.xml` liegt nicht bei — sie gehört zum
Standard und nicht zu diesem Programm, und eine nachgetippte Fassung wäre schlimmer als
keine; die Prüfprogramme bringen sie mit. Und sollte ein Werkzeug an einer Einzelheit
hängen, ist der Bestand deshalb nicht unlesbar: `nachrichten.csv` ist eine gewöhnliche
Textdatei, und die Originale sind für sich vollständig.

#### Die Verfahrensdokumentation

Die GoBD verlangen sie (Rz. 151 ff.), und in den meisten Betrieben fehlt sie — nicht aus
Nachlässigkeit, sondern weil sie voraussetzt, dass jemand genau weiß, was die Software
tut.

Den **technischen Teil** erzeugt das Programm selbst, aus den tatsächlichen Einstellungen:
welche Konten mitgeschrieben werden, welche Fristen gelten, wie viele Nachrichten darin
liegen, das aktuelle Siegel. Der **organisatorische Teil** steht darin als Liste von sieben
Fragen, die zu beantworten sind — wer zuständig ist, ob es andere Wege für Geschäftspost
gibt, wohin das Siegel notiert wird. Eine Dokumentation mit ehrlichen Lücken ist mehr wert
als eine, die vollständig aussieht und erfunden ist.

Sie ist bei jeder wesentlichen Änderung neu zu erzeugen, und die alten Fassungen sind
aufzubewahren: Sie beschreiben den Zustand, in dem die damaligen Daten entstanden sind.

#### Und der Datenschutz?

Aufbewahrungspflicht und Löschanspruch stehen sich nicht im Weg: Art. 17 Abs. 3 lit. b
DSGVO nimmt aus, was zur Erfüllung einer rechtlichen Verpflichtung nötig ist. Das gilt
aber nur für das, was wirklich aufbewahrungspflichtig ist — und deshalb wird je Konto
eingeschaltet und nicht pauschal. Private Post im Geschäftspostfach ist die bekannte
schwierige Stelle; sie gehört in die Betriebsvereinbarung und nicht in dieses Programm.

---

### Die Einstellungssicherung ist verschlüsselt

Das ist die Datei aus **Extras → Einstellungen sichern…**, nicht die Serversicherung aus
`betrieb/sicherung.sh`. Sie enthält Konten, Etiketten, Regeln, gemerkte Suchen und das
ganze Adressbuch — Namen, Telefonnummern, Firmen, Geburtstage —, aber weiterhin **keine
Kennwörter und keine Zugangsmarken**.

Beim Schreiben fragt das Programm nach einem Kennwort (mindestens acht Zeichen, einmal zu
wiederholen). Verschlüsselt wird mit AES-256-GCM, der Schlüssel kommt über scrypt
(N = 2¹⁷) aus dem Kennwort.

> **Ohne dieses Kennwort gibt es keinen Weg in die Datei.** Keine Hintertür, kein
> Wiederherstellungsschlüssel, keine Kopie irgendwo. Das Kennwort gehört dorthin, wo auch
> die anderen Kennwörter liegen — nicht auf einen Zettel neben der Datei.

Warum nicht der Schlüssel des Rechners (safeStorage/DPAPI), der ohne Kennwort auskäme:
Der hängt am Benutzerkonto **dieses** Rechners. Eine damit verschlüsselte Sicherung ließe
sich auf dem neuen Rechner nicht öffnen — also genau dort nicht, wofür sie gemacht ist.

**Ältere, unverschlüsselte Sicherungen lassen sich weiter einlesen.** Wer eine Datei von
vor dieser Änderung hat, muss sie nicht wegwerfen; sie enthält dieselbe Arbeit.

---

## 6. Sicherung

```bash
./betrieb/sicherung.sh
```

Läuft im laufenden Betrieb — der Dienst muss nicht angehalten werden. Täglich um drei:

```bash
crontab -e
0 3 * * * cd /pfad/zu/energy-mail && ./betrieb/sicherung.sh >> /var/log/em-sicherung.log 2>&1
```

**Was gesichert wird:** Konten, Adressbuch, Regeln, Etiketten, gespeicherte Suchen,
Wiedervorlagen, geplante Sendungen, die Nutzerliste. Zusammen meist unter einem Megabyte
— und darin steckt die eigentliche Arbeit.

**Was nicht:** `ablage.db`, der Offline-Bestand. Das ist eine Abschrift dessen, was beim
Mailanbieter liegt, oft mehrere hundert Megabyte, und sie baut sich von selbst wieder
auf. Nach einem Ausfall wäre der Bestand beim Anbieter ohnehin aktueller.

Der Masterschlüssel wird als eigene Datei danebengelegt. **Die gehört woandershin** —
das Skript sagt es bei jedem Lauf.

### Wiederherstellen

```bash
docker compose down
sudo rm -rf betrieb/daten
tar -xzf betrieb/sicherungen/energy-mail_2026-08-09_0300.tar.gz -C betrieb/
sudo cp /wo/auch/immer/master.key betrieb/daten/master.key
sudo chown -R 1000:1000 betrieb/daten
sudo chmod 600 betrieb/daten/master.key
docker compose up -d
```

Alle müssen sich danach neu anmelden — die Sitzungen werden bewusst nicht mitgesichert.

> Probieren Sie eine Wiederherstellung einmal aus, solange nichts kaputt ist. Eine
> Sicherung, die nie zurückgespielt wurde, ist eine Vermutung.

---

## 7. Aktualisieren

```bash
git pull
docker compose up -d --build
```

Der Datenordner liegt außerhalb des Abbilds und bleibt unberührt. Die Ablage stellt sich
beim Start selbst um, statt geleert zu werden (siehe `lokaleAblage.ts`) — niemand muss
nach einer Aktualisierung sein Postfach neu laden.

Vor größeren Sprüngen: einmal `./betrieb/sicherung.sh`.

### Die Fassungsnummer mitziehen

`FASSUNG` in der `.env` bestimmt zweierlei: die Marke des gebauten Abbilds und das, was
`/gesundheit` als `fassung` meldet. Sie wird **nicht** von selbst nachgezogen — nach einem
`git pull` meldet der Dienst weiterhin die alte Zahl. Bei einer Störung ist die erste
Frage aber immer, welcher Stand dort eigentlich läuft, und dann ist eine Zahl, die nicht
stimmt, schlimmer als keine.

Deshalb aus dem Stand selbst ableiten:

```bash
FASSUNG=$(git describe --tags --always --dirty)   # z. B. v0.4.0-1-gd9c235c
sed -i "s|^FASSUNG=.*|FASSUNG=$FASSUNG|" .env
docker compose up -d --build
```

Die Angabe nennt dann die letzte Marke, wie viele Commits seitdem dazugekommen sind und
welcher es ist — eine Auskunft statt einer Behauptung.

**Ein Nebeneffekt, den man kennen sollte:** Damit bekommt jeder Stand seine eigene Marke,
und die vorige wird nicht mehr überschrieben. Die Abbilder häufen sich also, rund 500 MB
je Auslieferung. Ein `docker image rm energy-mail:<alte-marke>` von Zeit zu Zeit räumt
auf; die letzten zwei sind es wert, aufgehoben zu werden, denn damit ist ein Rückweg ein
Eintrag in der `.env` und ein `docker compose up -d` — ohne neu zu bauen.

> Auf dem Zielrechner erledigt das ein Skript, das die Sicherung vorweg zieht, die Fassung
> setzt, wartet bis der Dienst gesund ist und die alten Abbilder bis auf drei wegräumt.
> Es liegt bewusst außerhalb des Git-Arbeitsbaums, damit ein Zweigwechsel es nicht berührt.

---

## 8. Nachsehen, ob alles läuft

```bash
docker compose ps                      # Spalte STATUS muss "healthy" zeigen
docker compose logs --tail=100 dienst
```

Das eigene Protokoll des Programms liegt zusätzlich in `betrieb/daten/protokoll/`.

Für eine Benachrichtigung bei Ausfall genügt ein Wachdienst (Uptime Kuma o. ä.) auf
`https://mail.beispiel.de/` — der Weg `/gesundheit` ist von außen bewusst nicht
erreichbar.

---

## 9. Wenn etwas nicht geht

| Bild | Ursache |
| --- | --- |
| `variable is not set` beim Start, danach Beschwerde über die fehlende öffentliche Adresse | `.env` liegt nicht neben der `docker-compose.yml` oder `DOMAIN` ist leer. |
| Der Dienst startet nicht, im Protokoll steht `ENERGY_MAIL_OEFFENTLICHE_ADRESSE fehlt` | Dasselbe. Ohne die Angabe würde der Herkunftsriegel die eigene Oberfläche abweisen — deshalb wird der Start verweigert statt später jede Anfrage. |
| Anmeldung antwortet mit `403 Anfrage aus fremder Herkunft` | `DOMAIN` stimmt nicht mit dem Namen überein, unter dem Sie die Seite aufrufen (etwa `www.` davor). |
| Angemeldet, aber neue Post kommt erst beim Neuladen | Der Vorbau reicht die WebSocket-Umschaltung nicht durch — `Upgrade`/`Connection` fehlen. |
| Nach dem Anmelden sofort wieder abgemeldet | Der Vorbau setzt kein `X-Forwarded-Proto: https`; der Keks kommt dann ohne `Secure` und der Browser verwirft ihn. |
| Kein Zertifikat, Caddy meldet `challenge failed` | Port 80 kommt nicht durch, oder der Name zeigt nicht hierher. Erst Abschnitt 1 prüfen. |
| `permission denied` beim Speichern eines Kontos | `betrieb/daten` gehört nicht 1000:1000. |
| Zugangsdaten „konnten nicht entschlüsselt werden" | Es liegt ein anderer `master.key` da als der, mit dem sie geschrieben wurden. |
| Bei einem Nutzer kommt nach einem Neustart nichts von selbst | Er ist gesperrt — gesperrte Nutzer bekommen bewusst keine Hintergrundarbeit. `nutzerWerkzeug.js liste` zeigt es. |

---

## 10. Im Firmennetz

Zwei Dinge unterscheiden ein verwaltetes Netz von einem Privatanschluss, und an beiden ist
Energy Mail früher gescheitert.

### Der prüfende Vorbau

Führt Ihr Netz den Verkehr über eine TLS-Prüfung (Zscaler, Fortinet, Sophos, Palo Alto),
werden Zertifikate unterwegs neu ausgestellt — unterschrieben mit einer firmeneigenen
Wurzel, die per Gruppenrichtlinie im Windows-Zertifikatsspeicher liegt. **Energy Mail nimmt
diesen Speicher seit dieser Fassung mit dazu**; es ist nichts einzustellen. Im Protokoll
steht beim Start, was gilt:

```
INFO [start] Zertifikate: 120 mitgelieferte + 106 aus dem Systemspeicher (183 dort insgesamt).
```

Wer das nicht will: `ENERGY_MAIL_SYSTEM_ZERTIFIKATE=nein`. Dann gelten nur die
mitgelieferten Wurzeln — und in einem prüfenden Netz kommt keine Verbindung mehr zustande.

### Der Proxy

Ist der Weg nach draußen nur über einen Proxy offen, findet Energy Mail ihn **von selbst**:
Es fragt Windows, und ein PAC-Skript wird dabei mit ausgewertet. Auf einem eingerichteten
Firmenrechner ist damit nichts zu tun.

Wo das nicht genügt, gilt diese Reihenfolge — die erste Angabe, die etwas taugt, gewinnt:

| Rang | Quelle | Wo |
| --- | --- | --- |
| 1 | Richtlinie | `%PROGRAMDATA%\Energy Mail\richtlinien.json` |
| 2 | Konto | Kontodialog, Feld „Proxy" |
| 3 | Umgebung | `ENERGY_MAIL_AUSGANGSPROXY`, sonst `HTTPS_PROXY` / `HTTP_PROXY` |
| 4 | System | Windows-Einstellung samt PAC-Skript |
| 5 | — | direkt |

**Die Richtlinie schlägt das Konto**, und das ist Absicht: sonst genügte ein Eintrag im
Kontodialog, um die Ausgangskontrolle zu umgehen.

```json
{
  "proxy": "http://proxy.firma.de:3128",
  "keinProxyFuer": ".firma.de, mail.imhaus.local",
  "aktualisierungAbschalten": true,
  "ansprechpartner": "IT-Hotline: 4711"
}
```

Möglich sind `http://`, `https://` und `socks4/4a/5://`, jeweils mit Portangabe. Eine
Anmeldung steht in der Adresse (`http://name:kennwort@proxy:3128`) und wird verschlüsselt
abgelegt; im Protokoll und in der Oberfläche erscheint sie nie.

`keinProxyFuer` ist die Schreibweise von `NO_PROXY`: durch Komma getrennt, ein führender
Punkt meint die Domain samt allem darunter. Sie gilt **nicht** gegen eine Richtlinie — wer
die Ausnahmen bestimmte, bestimmte sonst auch, was am vorgeschriebenen Weg vorbeiläuft.

Der Proxy gilt für IMAP, SMTP **und** die gewöhnlichen Abrufe: den Markentausch bei Google
und Microsoft und die Serversuche beim Anlegen eines Kontos. Ohne den letzten Teil liefe
die Post, aber kein OAuth-Konto könnte sich anmelden.

> **Was nicht geht: NTLM und Kerberos.** Verlangt Ihr Proxy eine Windows-Anmeldung, hilft
> heute nur eine Ausnahme für die Mailserver. Basic-Anmeldung und offene Proxys gehen.

Was tatsächlich gilt, steht im Fehlerbericht (Hilfe → „Fehlerbericht erzeugen"):

```
Proxy: http://proxy.firma.de:3128 (aus der Richtliniendatei).
Zertifikate: 120 mitgelieferte + 106 aus dem Systemspeicher (183 dort insgesamt).
Richtlinien aus C:\ProgramData\Energy Mail\richtlinien.json: Aktualisierung abgeschaltet, Proxy vorgeschrieben.
```

### Die Sprache der Oberfläche

Energy Mail war durchgehend deutsch — für jeden Kunden mit einer nicht deutschsprachigen
Abteilung ein Ausschlusskriterium. Das **Herauslösen ist abgeschlossen** (771 Texte), und
**alle neun Kataloge sind vollständig**. `npm run sprachstand` sagt jederzeit, wie weit:

| Sprache | Katalog | |
|---|---|---|
| Deutsch | — | die Quelle, braucht keinen |
| **Englisch** | **771/771** | vollständig |
| **Französisch** | **771/771** | vollständig |
| **Spanisch** | **771/771** | vollständig |
| **Italienisch** | **771/771** | vollständig |
| **Niederländisch** | **771/771** | vollständig |
| **Portugiesisch** | **771/771** | vollständig (europäisches Portugiesisch, passend zu `pt-PT`) |
| **Türkisch** | **771/771** | vollständig |
| **Polnisch** | **771/771** | vollständig (drei Mehrzahlformen: 1 / 2–4 / 5+) |
| **Russisch** | **771/771** | vollständig (drei Mehrzahlformen, nach der Endziffer) |

Zehn Sprachen, kein offener Posten. Was künftig an neuem Text dazukommt, erscheint in den
anderen neun zunächst auf Englisch und erst dann auf Deutsch — kaputt ist nichts, und
`npm run sprachstand` nennt die Zahl.

### Was passiert, wenn etwas fehlt

**Die Rückfallkette lautet: gewählte Sprache → Englisch → Deutsch.** Englisch steht
absichtlich dazwischen: Ein französischer Nutzer, dem ein Eintrag fehlt, versteht
„Save search“ mit einiger Wahrscheinlichkeit — „Suche merken“ versteht er nicht. Der
deutsche Text ist zugleich der Schlüssel im Katalog; es kann also nichts kaputtgehen, nur
noch nicht übersetzt sein.

### Zwei Prüfungen, die den Katalog ehrlich halten

`npm run sprachpruefung` läuft als Teil von `npm run pruefe` und meldet:

- **Waisen** — ein Eintrag, dessen deutscher Schlüssel im Quelltext nicht mehr vorkommt.
  Entsteht bei jeder Umformulierung; die Übersetzung bleibt sonst stumm.
- **Platzhalter** — `{anzahl}` muss in der Übersetzung stehen bleiben. Ein verlorener
  Platzhalter ist der teuerste Fehler in einem Katalog: Der Satz liest sich vollkommen
  richtig, er sagt nur nicht mehr, um wie viele Nachrichten es geht.
- **Mehrzahlformen** — Polnisch und Russisch brauchen drei Formen, nicht zwei. Wer nur
  zwei hinterlegt, baut Sätze, die fast richtig aussehen.
- **Leere Einträge** — ein leerer Knopf ist schlimmer als ein deutscher.

### Eine Regel für neue Texte: keine Endung an einen Platzhalter

Im Türkischen richtet sich jede Endung nach dem letzten Vokal des Wortes davor —
„Arşiv**e**“, aber „Faturalar**a**“. An einen Platzhalter darf deshalb **keine** Endung
gehängt werden: Was darin steht, ist ein Ordnername, den niemand kennt. Die Endung gehört
an ein festes Wort daneben:

```
richtig:  “{ordner}” klasörüne taşındı      — die Endung hängt an „klasör“
falsch:   “{ordner}”e taşındı              — die Endung hänge am Ordnernamen
```

Dasselbe gilt sinngemäß für Polnisch und Russisch, wo ein eingesetztes Wort im Satz
gebeugt gehörte. Wer einen neuen Text schreibt, formuliert ihn deshalb am besten so, dass
der Platzhalter frei stehen kann. Im Polnischen ist der Ausweg, das eingesetzte Wort in
Anführungszeichen zu stellen — `Nie udało się: „{was}“ – {grund}`; dann bleibt es
unverändert und der Satz stimmt trotzdem.

Die zweite polnische Falle steht in derselben Ecke: **Zahlen ziehen den Fall des Wortes
hinter sich her.** „alle 2 Wochen“ heißt *co 2 tygodnie*, „alle 5 Wochen“ aber
*co 5 tygodni* — und es gibt nur EINEN Katalogeintrag für beides, weil hier kein `tp()`
steht, sondern ein `t()` mit einer Zahl darin. Der Ausweg ist eine Fügung, die für jede
Zahl denselben Fall verlangt (`w odstępie {abstand} tygodni`); im Russischen tut es die
Ordnungszahl, deren Endung sich nicht ändert (`каждый {abstand}-й день`). Wer einen
zählenden Satz neu schreibt, nimmt deshalb `tp()` — dort gibt es die drei Formen.

Und eine dritte, die nur das Russische hat: **kein Zeitwort in der Vergangenheit über den
Nutzer.** Es trägt dort das Geschlecht — *ответил* für einen Mann, *ответила* für eine
Frau —, und das Programm weiß es nicht. „Sie haben noch nicht geantwortet“ steht deshalb
als *От вас ещё нет ответа* („von Ihnen gibt es noch keine Antwort“).

### Eine Regel für neue Texte: ein Wort, eine Bedeutung

Der deutsche Text ist der Schlüssel. Das heißt auch: **Zwei Stellen mit demselben
deutschen Wort bekommen dieselbe Übersetzung** — ob sie dasselbe meinen oder nicht.

Genau das war passiert. „Abmelden“ stand über dem Knopf, der einen Newsletter loswird,
und über dem, der den Nutzer aus Energy Mail abmeldet. Im Deutschen ist beides richtig und
aus dem Zusammenhang klar. Alle sieben Kataloge hatten das Wort als „vom Programm
abmelden“ übersetzt — in der englischen Oberfläche hieß der Newsletter-Knopf also
„Sign out“, im Spanischen „Cerrar sesión“, im Türkischen „Oturumu kapat“.

Gefunden wurde es beim polnischen Katalog, weil dort *wypisz się* und *wyloguj się* sich
nicht einmal ähneln. Keine Prüfung kann so etwas sehen: Beide Übersetzungen sind für sich
genommen richtig. Wo ein deutsches Wort zwei Dinge bedeutet, braucht es deshalb **zwei
Schlüssel** — hier „Abbestellen“ für den Verteiler und „Abmelden“ für das Programm.

### Was der Nutzer herunterlädt

Nur seine eigene Sprache. Die Kataloge werden je Sprache nachgeladen (`import()`), nicht
fest eingebunden: Ein deutscher Nutzer holt das Programmbündel und sonst nichts, ein
französischer zusätzlich rund 64 KB. Fest eingebunden lägen alle neun in jedem Abruf mit
dabei, und neun Zehntel davon bräuchte niemand.

Im **Serverbetrieb** ist das anders und muss es sein: Dort werden beim Start alle Kataloge
geladen, weil ein Prozess viele Menschen gleichzeitig bedient und die Sprache zur Anfrage
gehört (`Accept-Language`), nicht zum Programm.

Wichtig für die Beurteilung: Was noch nicht übersetzt ist, erscheint auf **Deutsch** — nicht
als Platzhalter und nicht als leeres Feld. Der deutsche Text ist zugleich der Schlüssel im
Katalog; eine fehlende Übersetzung fällt auf ihn zurück. Es kann also nichts kaputtgehen,
nur noch nicht übersetzt sein.

Die Sprache wird bestimmt durch — in dieser Reihenfolge:

1. Die **Richtlinie**: `"sprache": "en"` in `richtlinien.json`. Damit zeigt jeder
   Arbeitsplatz dieselbe Oberfläche, unabhängig davon, wie Windows eingestellt ist. Der
   Menüpunkt steht dann ausgegraut da statt zu fehlen — wer die Einstellung sucht, soll
   sehen, dass sein Haus sie getroffen hat.
2. Die **Wahl des Nutzers** unter Extras → Sprache.
3. **Windows.** Der Regelfall, ohne jede Einstellung.

### Verteilung auf die Arbeitsplätze

Für den Rollout gibt es ein eigenes Paket. Gebaut wird es mit

```bash
npm run paket:firma      # ergibt release/Energy Mail <fassung> x64.msi und arm64.msi
```

Es steht bewusst nicht im gewöhnlichen Bau und nicht in der Veröffentlichung: Was ein
Firmenkunde bekommt, entscheidet ein Mensch.

| | NSIS-Setup (`.exe`) | MSI |
| --- | --- | --- |
| Zielgruppe | Privatnutzer | verwaltete Arbeitsplätze |
| Installiert nach | `%LOCALAPPDATA%\Programs` (ein Nutzer) | `Programme` (alle Nutzer) |
| Rechte | keine besonderen | Administrator bzw. SYSTEM |
| Selbstaktualisierung | ja | **nein** – die IT entscheidet |
| Verteilbar per GPO | nein | ja |

Dass das MSI sich nicht selbst aktualisiert, ist kein Mangel, sondern der Zweck: In einer
verwalteten Aufstellung bestimmt die IT, welche Fassung wann kommt. Nebenbei liegt die
Anwendung damit unter `Programme` statt im Profil – dorthin kann ein Prozess im
Nutzerkontext nicht schreiben, und der Austausch von `app.asar` wäre schon am Dateisystem
gescheitert.

**Still installieren und wieder entfernen**

```powershell
msiexec /i "Energy Mail 0.2.1 x64.msi" /qn /norestart /l*v install.log
msiexec /x "Energy Mail 0.2.1 x64.msi" /qn /norestart
```

**Intune (Win32-App oder Branchen-App)** — Installationsbefehl wie oben; als
Erkennungsregel dient der MSI-Produktcode. **Gruppenrichtlinie** — Computerkonfiguration →
Softwareinstallation → *Zugewiesen*; die Freigabe muss für „Domänencomputer" lesbar sein.

**Beim Ersetzen einer Fassung** genügt das neue MSI: Der Upgrade-Code bleibt über alle
Fassungen gleich, Windows erkennt die Aktualisierung und räumt die alte selbst ab.

> **Was das MSI nicht mitbringt:** die Anmeldung als Standard-E-Mail-Programm. Die
> Dateiendung `.eml` wird registriert (ProgId `EnergyMail.eml`), `mailto:` dagegen meldet
> die Anwendung beim ersten Start selbst an — und damit pro Nutzer, nicht bei der
> Installation. In einem verwalteten Netz ist das ohnehin der falsche Weg: Dort werden
> Standardzuordnungen per Richtlinie gesetzt (`DISM /Online
> /Export-DefaultAppAssociations`), und dafür brauchen Sie genau die ProgId oben.

**Vor dem Rollout** gehört die Richtliniendatei auf die Arbeitsplätze — sonst startet jeder
Arbeitsplatz mit Selbstaktualisierung und ohne Proxy:

```
%PROGRAMDATA%\Energy Mail\richtlinien.json
```

### Die Serversuche bei einer Firmendomain

Tippt ein Mitarbeiter `vorname.name@ihre-firma.de` ein, fanden die bisherigen vier Quellen
nichts: Die Anbieterdatenbank kennt gmx und web.de, und eine `autoconfig`-Datei legt kaum
eine Firma auf ihre Domain. Übrig blieb das Formular für Hostname und Port — bei hundert
Arbeitsplätzen keine Option.

Energy Mail sieht jetzt zusätzlich nach, **wo die Post der Domain tatsächlich liegt**:

| Quelle | Was sie beantwortet |
| --- | --- |
| Autodiscover | Ein eigener Exchange im Haus, der seine Angaben so veröffentlicht |
| `_imaps._tcp` (SRV) | Was der Betreiber ausdrücklich einträgt |
| MX-Einträge | Microsoft 365 oder Google Workspace — daran erkennbar, wohin die Post geht |

An echten Domains nachgemessen:

```
mitarbeiter@microsoft.com   Microsoft 365      outlook.office365.com:993   [mx]
mitarbeiter@sap.com         Microsoft 365      outlook.office365.com:993   [mx]
mitarbeiter@siemens.com     Microsoft 365      outlook.office365.com:993   [mx]
mitarbeiter@shopify.com     Google Workspace   imap.gmail.com:993          [mx]
wer@gmx.de                  (unverändert, eingebaut)
```

Wo der MX-Eintrag woandershin zeigt — auf einen deutschen Mittelständler, auf das eigene
Rechenzentrum —, wird **nichts** zurückgegeben. Lieber das Formular als eine falsche
Adresse, die erst beim Anmelden auffällt.

> **Autodiscover trägt den Regelfall nicht**, und das gehört gesagt: Bei Microsoft 365
> antwortet der Abruf ohne Anmeldung mit 401, und die Zugangsdaten liegen zu diesem
> Zeitpunkt noch gar nicht vor. Deshalb steht die Erkennung über die MX-Einträge daneben —
> sie ist der Weg, der in der Wolke funktioniert. Autodiscover hilft beim eigenen Exchange
> im Haus, sofern dort IMAP überhaupt eingeschaltet ist.

Wird Microsoft 365 oder Google Workspace erkannt, sagt die Oberfläche dem Nutzer auch,
dass ein **Kennwort dort nicht mehr angenommen wird** — Microsoft hat die
Kennwortanmeldung für Exchange Online abgeschaltet. Ohne diesen Hinweis tippt jemand sein
Windows-Kennwort in das Formular und sucht den Fehler bei sich.

### Die Anmeldung bei Microsoft 365 und Google Workspace

Ohne Vorgabe schickt die Einrichtung jeden Mitarbeiter ins Azure-Portal bzw. in die Google
Cloud Console, damit er dort **selbst** eine Anwendung registriert. Für einen Privatnutzer
ist das der ehrliche Weg — seine Zugangsdaten gehören ihm. In einem Unternehmen darf er das
nicht und kann es auch nicht.

Registrieren Sie die Anwendung deshalb einmal und tragen Sie sie in die Richtliniendatei
ein. Für den Mitarbeiter entfällt die Einrichtung dann vollständig: Er klickt auf
„Anmelden", meldet sich bei Microsoft an, fertig.

**Entra ID (Microsoft 365)**

1. Entra ID → App-Registrierungen → **Neue Registrierung**. Kontotypen: *Nur Konten in
   diesem Organisationsverzeichnis*.
2. Authentifizierung → Plattform hinzufügen → **Mobile Anwendungen und
   Desktopanwendungen**, Rückleitung `http://localhost`.
3. **„Als öffentlichen Clientfluss zulassen" aktivieren.** Dann ist kein Client-Schlüssel
   nötig — Energy Mail arbeitet mit PKCE. Vergeben Sie hier bewusst **keinen**: ein
   Geheimnis, das auf hundert Arbeitsplätzen liegt, ist keines.
4. API-Berechtigungen → `IMAP.AccessAsUser.All` und `SMTP.Send` (Office 365 Exchange
   Online), dann **Administratorzustimmung erteilen**. Danach sieht kein Mitarbeiter mehr
   eine Zustimmungsseite.
5. Anwendungs-ID und Verzeichnis-ID (Mandant) übernehmen.

```json
{
  "oauth": {
    "microsoft": {
      "clientId": "11111111-2222-3333-4444-555555555555",
      "mandant": "contoso.onmicrosoft.com"
    }
  }
}
```

> **Der `mandant` gehört dazu.** Ohne ihn läuft die Anmeldung über `/common`, und dann
> greift die Administratorzustimmung nicht zuverlässig — jeder Mitarbeiter bekommt die
> Zustimmungsseite doch wieder vorgesetzt. Außerdem kann sich sonst jemand versehentlich
> mit seinem privaten Microsoft-Konto anmelden und wundert sich über ein leeres Postfach.
> Zulässig sind die Verzeichnis-ID und die Domain.

**Google Workspace**

Wie in der Anleitung im Programm, aber einmal zentral: Anwendungstyp *Desktop-App*, Bereich
`https://mail.google.com/`. Google vergibt dabei ein `clientSecret`, das kein echtes
Geheimnis ist — es steckt in jeder installierten Anwendung, und Google behandelt es auch
so. Es gehört trotzdem in die Richtliniendatei und nicht in die Hände der Mitarbeiter.

```json
{
  "oauth": {
    "google": { "clientId": "1234-abcd.apps.googleusercontent.com", "clientSecret": "…" }
  }
}
```

Steht etwas in der Richtlinie, **schlägt es einen örtlichen Eintrag**, und der Nutzer kann
nichts mehr ändern: Der Dialog zeigt statt der Anleitung, was gilt, und der Server weist
ein Speichern ab. Sonst liefe die Anmeldung an der Anwendung der Organisation vorbei — mit
einer zweiten Zustimmungsseite und Anmeldungen, die niemand im Blick hat.

### Die Selbstaktualisierung

Sie lädt und installiert von sich aus — richtig für einen Privatrechner, falsch für einen
verwalteten Arbeitsplatz. `"aktualisierungAbschalten": true` stellt sie ab, samt Suche und
stillem Einspielen beim Beenden. Der Knopf in der Oberfläche sagt dann, dass die Fassung
von der Organisation vorgegeben wird, und nennt den hinterlegten Ansprechpartner.

---

## 11. Was hier noch nicht steht

Ehrlich benannt, damit niemand es für erledigt hält:

- **OAuth („Anmelden mit Google/Microsoft") geht im Serverbetrieb nicht.** Der Ablauf ist
  darauf gebaut, dass Browser und Dienst auf demselben Rechner laufen: Der Dienst öffnet
  einen kurzlebigen Horcher auf `127.0.0.1` und gibt dem Anbieter genau diese Adresse als
  Rückleitung mit. In der Desktop-Hülle geht das auf. Wird der Dienst dagegen von einem
  anderen Rechner aus bedient — also im Regelfall —, zeigt `127.0.0.1` auf den Rechner des
  **Benutzers**. Dort horcht niemand, und die Anmeldung endet in einer Fehlerseite.

  Die beiden Knöpfe werden deshalb im Serverbetrieb gar nicht erst angeboten (der Server
  entscheidet das, siehe `/ich` → `oauthMoeglich`), und an ihrer Stelle steht der Hinweis
  auf das anwendungsspezifische Kennwort. Gmail und Outlook lassen sich damit
  einrichten — es ist ohnehin der Weg, den die Anleitung empfiehlt.

  Damit OAuth auch hier ginge, müsste die Rückleitung auf die öffentliche Adresse zeigen
  (`https://mail.beispiel.de/oauth/callback`), der Dienst einen dauerhaften Weg dafür
  anbieten, und jeder Betreiber müsste genau diese Adresse bei Google bzw. Microsoft
  eintragen. Das ist ein eigener Umbau und keine Kleinigkeit.

- **Das Firmenverzeichnis wird nur gelesen.** Ein Nutzer, der dort steht, bekommt davon
  kein Postfach — angelegt wird weiterhin von Hand oder in der Verwaltung. Und die
  Anmeldung läuft nicht über LDAP: Wer sich hier anmeldet, tut das mit dem Kennwort
  dieses Dienstes, nicht mit dem des Verzeichnisses.
- **Die Datenschutzunterlagen sind kein Rechtsrat und decken nur diesen einen Bereich ab.**
  Ein Betrieb hat weitere Verarbeitungstätigkeiten — Lohn, Kundendaten, Bewerbungen —, und
  die gehören in dasselbe Verzeichnis. Für eine Betriebsvereinbarung liegt bewusst keine
  Vorlage bei: Die wird verhandelt und nicht ausgefüllt.
- **Das Archiv erfasst nur, was durch dieses Programm läuft.** Wer Geschäftspost auch über
  die Weboberfläche des Anbieters oder ein zweites Mailprogramm bearbeitet, hat dort eine
  Lücke — und das Archiv kann davon nichts wissen. Das ist die erste der sieben Fragen in
  der Verfahrensdokumentation, und sie ist keine Formsache.
- **Das Archiv ist keine Sicherung.** Es liegt auf demselben Laufwerk wie alles andere. Ein
  Defekt nimmt es mit; es gehört in dieselbe Sicherung wie der Rest.
- **S/MIME fragt keine Rücknahmelisten ab.** Ein Zertifikat, das die Ausgabestelle
  zurückgezogen hat — weil der Schlüssel abhandenkam oder jemand das Haus verlassen hat —,
  gilt hier weiter bis zu seinem Ablaufdatum. Das ist der wichtigste offene Punkt an der
  S/MIME-Umsetzung. Wer ein Zertifikat für zurückgezogen hält, entfernt es von Hand.
- **S/MIME schützt keine Anhänge** und verschlüsselt nur an RSA-Zertifikate. Beides steht
  mit Begründung im Abschnitt oben.
- **Lesebestätigungen sind kein Nachweis.** Der Empfänger entscheidet, ob er eine schickt;
  viele Programme schicken grundsätzlich keine. Wer einen Zustellnachweis braucht, braucht
  ein Einschreiben.
- **Ein Vertreter bekommt keine Sofortmeldung** über neue Post im freigegebenen Postfach.
  Die Überwachung läuft im Konto des Eigentümers — siehe oben.
- **Kein Passkey, kein Sicherheitsschlüssel.** Der zweite Faktor ist TOTP; WebAuthn wäre
  das bessere Verfahren, verlangt aber eine sichere Herkunft (https). Für einen Dienst, der
  auch im Hausnetz auf http läuft, ist das keine Grundlage.
- **Die Zwei-Faktor-Anmeldung ist freiwillig.** Ein Verwalter kann sie nicht für alle
  vorschreiben; jeder richtet sie sich selbst ein oder lässt es.
- **Keine Programmsperre in der Hülle.** Dort gibt es kein Kennwort, gegen das sie prüfen
  könnte. Für den unbeaufsichtigten Arbeitsplatz ist die Sperre des Betriebssystems
  zuständig.
- **Die Abwesenheitsnotiz antwortet nur, solange der Dienst läuft.** Sie hängt an der
  Postfachüberwachung, nicht am Server des Anbieters — siehe oben.
- **Die Sicherung des Servers liegt auf demselben Rechner.** Gegen ein defektes Laufwerk
  hilft das nicht. `betrieb/sicherungen/` gehört regelmäßig woandershin kopiert. (Die
  Einstellungssicherung aus dem Programm ist davon unberührt — die ist verschlüsselt,
  siehe unten.)
- **Der Rechner selbst.** Unbeaufsichtigte Sicherheitsaktualisierungen, eine Firewall und
  Festplattenverschlüsselung sind Sache des Betriebssystems, nicht dieses Programms.
