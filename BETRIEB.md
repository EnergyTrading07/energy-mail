# Energy Mail als Dienst betreiben

Diese Anleitung beschreibt den Betrieb auf einem eigenen Linux-Rechner — im Fall dieses
Projekts ein HP EliteDesk im Heimnetz, erreichbar unter einem eigenen Namen, mit einem
Zertifikat von Let's Encrypt.

Der Aufbau besteht aus zwei Containern:

```
        Internet
           │
      443 / 80
           │
    ┌──────▼───────┐   holt und erneuert das Zertifikat selbst
    │    vorbau    │   Caddy
    │              │   TLS endet HIER, auf Ihrem Rechner
    └──────┬───────┘
           │  internes Netz, kein Port nach außen
    ┌──────▼───────┐
    │    dienst    │   Energy Mail (Node 24)
    │              │
    └──────┬───────┘
           │
    betrieb/daten/     Konten, Adressbuch, Regeln, Masterschlüssel
```

Zwischen Browser und Ihrem Rechner sieht niemand die Post — kein Dienstleister, kein
Netzbetreiber. Das ist der Grund für diesen Aufbau und nicht für einen Tunnel-Dienst.

---

## 1. Voraussetzungen

**Auf dem Rechner:**

```bash
docker --version           # 24 oder neuer
docker compose version     # v2 - "docker-compose" mit Bindestrich ist die alte Fassung
```

Fehlt Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # danach einmal ab- und wieder anmelden
```

**Im Netz — das muss vorher stimmen, sonst bekommt Caddy kein Zertifikat:**

| Was | Wie prüfen |
| --- | --- |
| Der Name zeigt auf Ihren Anschluss | `dig +short mail.beispiel.de` muss Ihre öffentliche Adresse liefern (`curl -4 ifconfig.me`) |
| Port 80 und 443 sind auf den Rechner weitergeleitet | Im Router unter „Portfreigaben“, Ziel ist die feste lokale Adresse des EliteDesk |
| Der Anschluss hat eine öffentliche IPv4 | Steht in `dig` etwas anderes als in `curl ifconfig.me`, liegt DS-Lite/CGNAT vor — dann geht keine Portfreigabe |

> **Port 80 wird gebraucht**, auch wenn später alles über 443 läuft: Let's Encrypt prüft
> darüber, dass Ihnen der Name gehört. Ohne ihn schlägt die Ausstellung fehl.

Wechselt Ihre öffentliche Adresse (bei Privatanschlüssen üblich), brauchen Sie zusätzlich
einen DynDNS-Eintrag; die meisten Router bringen das mit.

---

## 2. Einrichten

```bash
git clone https://github.com/EnergyTrading07/energy-mail.git
cd energy-mail

cp betrieb/.env.beispiel betrieb/.env
nano betrieb/.env            # DOMAIN und ADMIN_MAIL eintragen
```

Der Datenordner muss dem Nutzer gehören, unter dem der Dienst läuft — im Container ist
das `node` mit der Nummer 1000. Gehört er root, kann der Dienst nichts speichern, und
zwar erst beim ersten Konto, nicht beim Start:

```bash
mkdir -p betrieb/daten
sudo chown -R 1000:1000 betrieb/daten
chmod 700 betrieb/daten
```

Dann bauen und starten:

```bash
docker compose up -d --build
docker compose logs -f dienst
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

Und von außen, mit dem Zertifikat:

```bash
curl -I https://mail.beispiel.de
```

---

## 3. Der Masterschlüssel

Beim ersten Start entsteht `betrieb/daten/master.key` — 32 zufällige Bytes.

**Mit ihm sind sämtliche hinterlegten Postfach-Kennwörter zu öffnen. Ohne ihn keines.**

Er wird nicht aus einem Kennwort abgeleitet und liegt nirgendwo sonst. Geht die Datei
verloren, müssen alle Nutzer sämtliche Konten neu einrichten — aus einer Sicherung ist
dann nichts mehr zu holen, auch nicht mit Aufwand.

Deshalb, gleich jetzt und nicht später:

```bash
sudo cat betrieb/daten/master.key
```

Den Inhalt in einen Kennwortspeicher legen — **nicht** auf denselben Rechner, nicht in
dieselbe Sicherung wie die Daten. Liegen Schlüssel und Daten am selben Ort, schützt die
Verschlüsselung vor niemandem.

---

## 4. Nutzer anlegen

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

## 5. Sicherung

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

Die Zertifikate liegen in einem eigenen Docker-Bereich (`caddy-daten`) und sind nicht
Teil der Sicherung. Gehen sie verloren, holt Caddy neue — Let's Encrypt lässt dafür fünf
Ausstellungen je Woche und Name zu, das genügt.

---

## 6. Aktualisieren

```bash
git pull
docker compose up -d --build
```

Der Datenordner liegt außerhalb des Abbilds und bleibt unberührt. Die Ablage stellt sich
beim Start selbst um, statt geleert zu werden (siehe `lokaleAblage.ts`) — niemand muss
nach einer Aktualisierung sein Postfach neu laden.

Vor größeren Sprüngen: einmal `./betrieb/sicherung.sh`.

---

## 7. Nachsehen, ob alles läuft

```bash
docker compose ps                      # Spalte STATUS muss "healthy" zeigen
docker compose logs --tail=100 dienst
docker compose logs --tail=50 vorbau   # Zertifikatsfragen stehen hier
```

Das eigene Protokoll des Programms liegt zusätzlich in `betrieb/daten/protokoll/`.

Für eine Benachrichtigung, wenn der Dienst ausfällt, genügt ein Eintrag bei einem
Wachdienst wie Uptime Kuma oder Healthchecks.io auf `https://mail.beispiel.de/` — der
Weg `/gesundheit` ist von außen bewusst nicht erreichbar.

---

## 8. Wenn etwas nicht geht

| Bild | Ursache |
| --- | --- |
| Der Dienst startet nicht, im Protokoll steht `ENERGY_MAIL_OEFFENTLICHE_ADRESSE fehlt` | `DOMAIN` in `betrieb/.env` ist leer. Ohne die Angabe würde der Herkunftsriegel die eigene Oberfläche abweisen — deshalb wird der Start verweigert statt später jede Anfrage. |
| Anmeldung antwortet mit `403 Anfrage aus fremder Herkunft` | `DOMAIN` stimmt nicht mit dem Namen überein, unter dem Sie die Seite aufrufen (etwa `www.` davor). |
| Kein Zertifikat, Caddy meldet `challenge failed` | Port 80 kommt nicht durch, oder der Name zeigt nicht hierher. Erst Abschnitt 1 prüfen. |
| `permission denied` beim Speichern eines Kontos | `betrieb/daten` gehört nicht 1000:1000. |
| Zugangsdaten „konnten nicht entschlüsselt werden“ | Es liegt ein anderer `master.key` da als der, mit dem sie geschrieben wurden. |
| Nach einem Neustart kommen bei einem Nutzer keine neuen Nachrichten von selbst | Er ist gesperrt — gesperrte Nutzer bekommen bewusst keine Hintergrundarbeit. `nutzerWerkzeug.js liste` zeigt es. |

---

## 9. Was hier noch nicht steht

Ehrlich benannt, damit niemand es für erledigt hält:

- **Die Anmeldebremse zählt im Arbeitsspeicher.** Bei einem Neustart ist sie weg, und
  über mehrere Prozesse hinweg zählt sie nicht. Für einen Bekanntenkreis reicht das; vor
  einem öffentlichen Betrieb gehört an diese Stelle etwas Dauerhaftes.
- **Keine Zwei-Faktor-Anmeldung.** Ein Kennwort ist die einzige Schranke vor sämtlicher
  Post eines Menschen.
- **Kein Wachdienst eingerichtet.** Die Container starten sich bei einem Absturz selbst
  neu (`restart: unless-stopped`), aber niemand erfährt davon.
- **Die Sicherung liegt auf demselben Rechner.** Gegen ein defektes Laufwerk hilft das
  nicht. `betrieb/sicherungen/` gehört regelmäßig woandershin kopiert.
- **Der Rechner selbst.** Unbeaufsichtigte Sicherheitsaktualisierungen
  (`unattended-upgrades`), eine Firewall (`ufw`: nur 22, 80, 443) und
  Festplattenverschlüsselung sind Sache des Betriebssystems, nicht dieses Programms.
