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
… nutzerWerkzeug.js entfernen anna              # endgültig - siehe unten
```

`entfernen` löscht den Eintrag und damit den Schlüssel dieses Nutzers. Seine Geheimnisse
sind ab diesem Augenblick unlesbar — auch in jeder Sicherung, die es von ihnen gibt. Der
Ordner bleibt liegen, bis Sie `--mit-daten` dazuschreiben.

> **Ein neuer Nutzer bekommt seine Hintergrundarbeit erst beim nächsten Start** des
> Dienstes (Überwachung, geplante Sendungen, Wiedervorlagen). Bis dahin funktioniert
> alles, was er selbst auslöst. Nach dem Anlegen mehrerer Nutzer also einmal
> `docker compose restart dienst`.

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

## 10. Was hier noch nicht steht

Ehrlich benannt, damit niemand es für erledigt hält:

- **Die Anmeldebremse zählt im Arbeitsspeicher.** Bei einem Neustart ist sie weg, und
  über mehrere Prozesse hinweg zählt sie nicht. Für einen Bekanntenkreis reicht das; vor
  einem öffentlichen Betrieb gehört an diese Stelle etwas Dauerhaftes.
- **Keine Zwei-Faktor-Anmeldung.** Ein Kennwort ist die einzige Schranke vor sämtlicher
  Post eines Menschen.
- **Die Sicherung liegt auf demselben Rechner.** Gegen ein defektes Laufwerk hilft das
  nicht. `betrieb/sicherungen/` gehört regelmäßig woandershin kopiert.
- **Der Rechner selbst.** Unbeaufsichtigte Sicherheitsaktualisierungen, eine Firewall und
  Festplattenverschlüsselung sind Sache des Betriebssystems, nicht dieses Programms.
