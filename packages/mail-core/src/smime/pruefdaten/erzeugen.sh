#!/usr/bin/env bash
#
# Erzeugt die Pruefdaten fuer S/MIME - vollstaendig mit OpenSSL.
#
# Warum ueberhaupt ein Skript: Damit nachvollziehbar ist, WOHER die Bytes in daten.mts
# kommen. Eine eigene CMS-Umsetzung gegen selbst erzeugte Daten zu pruefen beweist nichts;
# gegen OpenSSL erzeugte zu pruefen beweist, dass die Norm eingehalten wird. Wer das
# nachrechnen will, fuehrt dieses Skript aus und vergleicht.
#
#   bash erzeugen.sh   (braucht openssl und node)
#
# Die Schluessel hier sind oeffentlich und wertlos - sie gehoeren zu einer Ausgabestelle,
# die es nur in dieser Datei gibt, und zu Adressen unter pruefung.example (RFC 2606).
set -e
export MSYS_NO_PATHCONV=1   # sonst macht Git Bash aus "/C=DE" einen Windows-Pfad

cd "$(dirname "$0")"
# Node bekommt Windows-Pfade, die Shell POSIX-Pfade. Unter Git Bash liefert "pwd -W" die
# Windows-Form; anderswo gibt es das Flag nicht und beides ist ohnehin dasselbe.
HIER=$(pwd -W 2>/dev/null || pwd)
ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT
cd "$ARBEIT"
ARBEIT_WIN=$(pwd -W 2>/dev/null || pwd)

# --------------------------------------------------------------------------------------
# Zeilenenden.
#
# OpenSSL schreibt seine eigenen Zeilen (Grenzen, Kopfzeilen) mit LF, reicht den Inhalt
# aber Byte fuer Byte durch - eine Datei mit gemischten Zeilenenden. So sieht keine
# Nachricht aus, die je durch einen Mailserver gelaufen ist, und eine Pruefung gegen eine
# solche Datei pruefte den falschen Fall. Vereinheitlicht wird deshalb auf CRLF; der
# unterschriebene Inhalt bleibt dabei unveraendert, weil er schon CRLF hat.
# --------------------------------------------------------------------------------------
crlf() { awk 'BEGIN{RS="\n";ORS="\r\n"} {sub(/\r$/,"")} 1' "$1" > "$1.crlf" && mv "$1.crlf" "$1"; }

GUELTIG=7300   # zwanzig Jahre - keine Pruefung soll eines Tages am Ablaufdatum scheitern

echo "== Wurzel =="
openssl req -x509 -newkey rsa:2048 -keyout ca.key -out ca.crt -days $GUELTIG -nodes \
  -subj "/C=DE/O=Energy Mail Pruefung/CN=Energy Mail Pruef-Wurzel" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null

for WER in anna bert; do
  echo "== $WER =="
  openssl req -newkey rsa:2048 -keyout $WER.key -out $WER.csr -nodes \
    -subj "/C=DE/O=Energy Mail Pruefung/CN=$WER/emailAddress=$WER@pruefung.example" 2>/dev/null
  cat > $WER.ext <<EOF
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=emailProtection
subjectAltName=email:$WER@pruefung.example
subjectKeyIdentifier=hash
authorityKeyIdentifier=keyid,issuer
EOF
  openssl x509 -req -in $WER.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
    -out $WER.crt -days $GUELTIG -extfile $WER.ext 2>/dev/null
done

# --------------------------------------------------------------------------------------
# Ein Zertifikat, bei dem die beiden Adressfelder AUSEINANDERGEHEN.
#
# Im Namen des Inhabers steht chef@, im alternativen Namen praktikant@. Beides kommt in
# echten Zertifikaten vor, und RFC 8551 sagt eindeutig, welches gilt: der alternative
# Name. Wer stattdessen beide zusammenwirft, laesst sich mit genau diesem Zertifikat eine
# Unterschrift als die des Chefs ausweisen. Deshalb liegt es hier.
# --------------------------------------------------------------------------------------
echo "== zwiegesicht =="
openssl req -newkey rsa:2048 -keyout zwiegesicht.key -out zwiegesicht.csr -nodes \
  -subj "/C=DE/O=Energy Mail Pruefung/CN=Zwiegesicht/emailAddress=chef@pruefung.example" 2>/dev/null
cat > zwiegesicht.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=emailProtection
subjectAltName=email:praktikant@pruefung.example
subjectKeyIdentifier=hash
EOF
openssl x509 -req -in zwiegesicht.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out zwiegesicht.crt -days $GUELTIG -extfile zwiegesicht.ext 2>/dev/null

# Und eines, das gar nicht fuer Mail ausgestellt ist - ein gewoehnliches Serverzertifikat.
echo "== nurserver =="
openssl req -newkey rsa:2048 -keyout server.key -out server.csr -nodes \
  -subj "/C=DE/O=Energy Mail Pruefung/CN=post.pruefung.example" 2>/dev/null
cat > server.ext <<'EOF'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=email:anna@pruefung.example,DNS:post.pruefung.example
EOF
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days $GUELTIG -extfile server.ext 2>/dev/null

echo "== Schluesseldateien =="
# Der heutige Aufbau: PBES2 mit PBKDF2 und AES-256.
openssl pkcs12 -export -inkey anna.key -in anna.crt -certfile ca.crt \
  -out anna.p12 -passout pass:geheim123 -name "Anna Pruefung"
# Und der alte, wie ihn Windows und aeltere Ausgabestellen bis heute liefern.
openssl pkcs12 -export -inkey anna.key -in anna.crt \
  -out anna-alt.p12 -passout pass:geheim123 -name "Anna alt" \
  -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1

echo "== Nachrichten =="
printf 'Hallo Welt.\r\nZweite Zeile mit Umlaut: \xc3\xa4\xc3\xb6\xc3\xbc\r\n' > inhalt.txt

openssl smime -sign -in inhalt.txt -signer anna.crt -inkey anna.key -certfile ca.crt \
  -from "anna@pruefung.example" -to "bert@pruefung.example" -subject "Probe" \
  -md sha256 -out signiert.eml
crlf signiert.eml

openssl smime -sign -in inhalt.txt -signer anna.crt -inkey anna.key -md sha256 \
  -nodetach -out signiert-opak.eml
crlf signiert-opak.eml

openssl smime -encrypt -aes256 -in inhalt.txt -from anna@pruefung.example \
  -to "anna@pruefung.example,bert@pruefung.example" -subject "Geheim" \
  -out verschluesselt.eml anna.crt bert.crt
crlf verschluesselt.eml

openssl smime -sign -in inhalt.txt -signer anna.crt -inkey anna.key -md sha256 \
  | openssl smime -encrypt -aes256 -out sig-und-geheim.eml anna.crt
crlf sig-und-geheim.eml

echo "== Gegenprobe mit OpenSSL selbst =="
openssl smime -verify -in signiert.eml -CAfile ca.crt > /dev/null
openssl smime -verify -in signiert-opak.eml -CAfile ca.crt > /dev/null
openssl smime -decrypt -in verschluesselt.eml -recip anna.crt -inkey anna.key > /dev/null
echo "   alles angenommen"

node "$HIER/einsetzen.mjs" "$ARBEIT_WIN" "$HIER/daten.mts"
echo "== daten.mts neu geschrieben =="
