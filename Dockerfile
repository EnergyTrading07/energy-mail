# syntax=docker/dockerfile:1

#
# Energy Mail als Dienst.
#
# Drei Abschnitte, und die Aufteilung hat einen Grund: was gebaut wird, braucht
# TypeScript, Vite und rund 400 MB Werkzeug - was läuft, braucht davon nichts. Am Ende
# steht nur das Ergebnis im Abbild.
#
# Node 24, und zwar wegen node:sqlite: die Ablage samt Volltextsuche (FTS5) steckt seit
# Electron 38 im Laufzeitsystem selbst. Eine nachgebaute SQLite-Abhängigkeit gibt es
# deshalb nicht - und damit auch keinen Compiler im Abbild. Nachgemessen im amtlichen
# Abbild: SQLite 3.50.4, FTS5 vorhanden.
#

# ---------------------------------------------------------------------------
# 1. Bauen
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS bau
WORKDIR /app

# Erst die Beschreibungen, dann der Quelltext. Docker legt für jeden Schritt eine
# Schicht an: solange sich an den Abhängigkeiten nichts ändert, bleibt das Installieren
# zwischengespeichert - eine Änderung am Programm kostet dann Sekunden statt Minuten.
COPY package.json package-lock.json ./
COPY packages/mail-core/package.json packages/mail-core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/

# --ignore-scripts: sonst lädt der Anhang "electron" beim Installieren rund 100 MB
# Programm herunter, das hier niemand braucht - der Server ist die Hülle nicht.
RUN npm ci --ignore-scripts

COPY . .

# Ausdrücklich nur diese drei. "npm run build" würde auch packages/desktop übersetzen,
# und das prüft gegen die Typen von Electron.
RUN npm run build -w packages/mail-core \
 && npm run build -w packages/server \
 && npm run build -w packages/web

# ---------------------------------------------------------------------------
# 2. Abhängigkeiten für den Betrieb
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS abhaengigkeiten
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/mail-core/package.json packages/mail-core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/

RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# 3. Das Abbild, das läuft
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim

# Die Fassung wandert ins Abbild, damit /gesundheit sagen kann, was läuft. Ohne das
# heißt die Antwort auf "welcher Stand ist da drauf" immer: nachsehen gehen.
ARG FASSUNG=unbekannt
ENV ENERGY_MAIL_FASSUNG=${FASSUNG}

ENV NODE_ENV=production \
    ENERGY_MAIL_DATEN=/daten \
    ENERGY_MAIL_HOST=0.0.0.0 \
    PORT=4000

WORKDIR /app

# Alle drei Abschnitte arbeiten in /app - und das ist kein Schönheitsgrund.
#
# In node_modules/@energy-mail/ stehen keine Ordner, sondern Verknüpfungen auf
# packages/... . Ob npm sie relativ oder absolut anlegt, hängt vom System ab; unter
# Windows waren es absolute Pfade. Hieße die Bauwerkstatt "/bau" und das fertige Abbild
# "/app", zeigten mitgenommene absolute Verknüpfungen auf einen Ordner, den es dort
# nicht mehr gibt - und "import '@energy-mail/mail-core'" fände nichts. Derselbe Pfad
# überall macht die Frage gegenstandslos.
COPY --from=abhaengigkeiten /app/node_modules ./node_modules
COPY --from=bau /app/package.json ./
COPY --from=bau /app/packages/mail-core/package.json ./packages/mail-core/
COPY --from=bau /app/packages/mail-core/dist ./packages/mail-core/dist
COPY --from=bau /app/packages/server/package.json ./packages/server/
COPY --from=bau /app/packages/server/dist ./packages/server/dist
COPY --from=bau /app/packages/web/package.json ./packages/web/
COPY --from=bau /app/packages/web/dist ./packages/web/dist
# Nur die Beschreibung, kein Programm: die Hülle läuft hier nicht. Sie steht trotzdem
# da, damit die Verknüpfung node_modules/@energy-mail/desktop nicht ins Leere zeigt.
COPY --from=bau /app/packages/desktop/package.json ./packages/desktop/

# Der Datenordner gehört dem Nutzer, unter dem der Dienst läuft. Wird von außen ein
# Ordner eingehängt, muss er ihm ebenfalls gehören - siehe BETRIEB.md.
RUN mkdir -p /daten && chown -R node:node /daten /app

# Nicht als root. Ein Programm, das den ganzen Tag mit fremden Mailservern spricht und
# fremde Nachrichten auseinandernimmt, soll im Fall der Fälle so wenig dürfen wie möglich.
USER node

EXPOSE 4000

# Ein laufender Prozess ist nicht dasselbe wie ein antwortender Dienst - und der Fall,
# der im Betrieb wirklich vorkommt, ist der zweite. Der Weg prüft nebenbei, ob sich in
# den Datenordner schreiben lässt.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/gesundheit').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/server/dist/index.js"]
