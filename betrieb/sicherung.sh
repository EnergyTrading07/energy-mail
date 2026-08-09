#!/usr/bin/env bash
#
# Sicherung von Energy Mail.
#
# Läuft im laufenden Betrieb - der Dienst muss dafür nicht angehalten werden. Das geht,
# weil alle gesicherten Dateien atomar geschrieben werden (daneben schreiben, dann
# umbenennen): man erwischt entweder den alten oder den neuen Stand, nie einen halben.
#
# Aufruf:
#   ./betrieb/sicherung.sh                     # nach betrieb/sicherungen/
#   ./betrieb/sicherung.sh /mnt/platte/em      # woandershin
#
# Als täglicher Auftrag:
#   0 3 * * *  cd /pfad/zu/energy-mail && ./betrieb/sicherung.sh >> /var/log/em-sicherung.log 2>&1
#

set -euo pipefail

HIER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATEN="${ENERGY_MAIL_DATEN:-$HIER/daten}"
ZIEL="${1:-$HIER/sicherungen}"

# Wie viele Stände aufgehoben werden. Bei einer Sicherung je Tag sind das zwei Wochen -
# lang genug, um zu bemerken, dass vor zehn Tagen etwas kaputtgegangen ist.
BEHALTEN="${ENERGY_MAIL_SICHERUNGEN_BEHALTEN:-14}"

STEMPEL="$(date +%Y-%m-%d_%H%M)"
ARCHIV="$ZIEL/energy-mail_$STEMPEL.tar.gz"

if [ ! -d "$DATEN" ]; then
	echo "Datenordner nicht gefunden: $DATEN" >&2
	echo "Falls er woanders liegt: ENERGY_MAIL_DATEN setzen." >&2
	exit 1
fi

mkdir -p "$ZIEL"

#
# Was NICHT mitkommt.
#
# ablage.db ist der Offline-Bestand: eine Abschrift dessen, was ohnehin beim
# Mailanbieter liegt. Sie ist der mit Abstand größte Teil (bei 30.000 Nachrichten
# schnell mehrere hundert MB) und der einzige, der sich von selbst wieder aufbaut. Sie
# mitzunehmen hieße, jeden Tag ein paar hundert MB für etwas aufzubewahren, das man
# nach einem Ausfall gar nicht zurückspielen will - der Bestand wäre beim Anbieter
# aktueller als in der Sicherung.
#
# Was mitkommt, ist das Gegenteil: kleine Dateien, die nirgendwo sonst existieren.
# Konten, Regeln, Etiketten, Adressbuch, gespeicherte Suchen, Wiedervorlagen und
# geplante Sendungen - zusammen meist unter einem Megabyte, und darin steckt die
# eigentliche Arbeit.
#
AUSGENOMMEN=(
	--exclude='ablage.db'
	--exclude='ablage.db-wal'
	--exclude='ablage.db-shm'
	--exclude='cache.json'
	# Der Schlüssel geht getrennt - siehe unten.
	--exclude='master.key'
	# Sitzungen: alle müssten sich nach einer Wiederherstellung ohnehin neu anmelden,
	# und das ist nach einem Vorfall auch das Richtige.
	--exclude='sitzungen.json'
	--exclude='protokoll'
)

# Erst daneben schreiben, dann umbenennen. Ein abgebrochener Lauf (Platte voll, Strom
# weg) hinterlässt sonst ein halbes Archiv, das aussieht wie eine gültige Sicherung -
# und das merkt man erst, wenn man es braucht.
TEMP="$ARCHIV.unfertig"
tar -czf "$TEMP" "${AUSGENOMMEN[@]}" -C "$(dirname "$DATEN")" "$(basename "$DATEN")"

# Nachsehen, ob das Archiv lesbar ist. Eine ungeprüfte Sicherung ist eine Vermutung.
if ! tar -tzf "$TEMP" >/dev/null 2>&1; then
	echo "Das erzeugte Archiv ist nicht lesbar - abgebrochen." >&2
	rm -f "$TEMP"
	exit 1
fi
mv "$TEMP" "$ARCHIV"

GROESSE="$(du -h "$ARCHIV" | cut -f1)"
ANZAHL="$(tar -tzf "$ARCHIV" | wc -l)"
echo "Gesichert: $ARCHIV ($GROESSE, $ANZAHL Einträge)"

#
# Der Masterschlüssel - getrennt, und mit Absicht.
#
# Mit ihm sind sämtliche Postfach-Kennwörter zu öffnen. Läge er im selben Archiv, wäre
# die Verschlüsselung der Daten eine Zierde: wer das Archiv hat, hat alles. Getrennt
# aufbewahrt hat sie einen Sinn.
#
# Ohne ihn ist das Archiv allerdings nur zur Hälfte brauchbar - Regeln, Etiketten und
# Adressbuch kommen zurück, die Zugangsdaten der Postfächer nicht. Beides muss also da
# sein, nur eben nicht am selben Ort.
#
SCHLUESSEL="$DATEN/master.key"
if [ -f "$SCHLUESSEL" ]; then
	install -m 600 "$SCHLUESSEL" "$ZIEL/master.key"
	echo "Masterschlüssel: $ZIEL/master.key"
	echo
	echo "  Diese eine Datei gehört an einen ANDEREN Ort als die Archive."
	echo "  Ohne sie sind die gesicherten Zugangsdaten nicht mehr zu öffnen;"
	echo "  neben ihnen macht sie deren Verschlüsselung wertlos."
else
	echo "WARNUNG: kein master.key in $DATEN - ohne ihn ist keine Wiederherstellung möglich." >&2
fi

# Alte Stände abräumen. Erst ab hier, damit ein Fehler oben nie dazu führt, dass eine
# alte Sicherung weg ist und keine neue da.
ALT="$(ls -1t "$ZIEL"/energy-mail_*.tar.gz 2>/dev/null | tail -n "+$((BEHALTEN + 1))" || true)"
if [ -n "$ALT" ]; then
	echo "$ALT" | while read -r datei; do
		rm -f "$datei"
		echo "Entfernt (älter als die letzten $BEHALTEN): $(basename "$datei")"
	done
fi
