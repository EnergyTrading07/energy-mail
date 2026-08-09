import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Wer mit dem lokalen Server sprechen darf.
 *
 * Vorher durfte es jeder. Der Server lauscht zwar nur auf 127.0.0.1, aber das schuetzt
 * gegen den Rechner nebenan, nicht gegen den Browser auf demselben Rechner: eine
 * beliebige Webseite, die der Nutzer offen hat, konnte
 *
 *   fetch('http://127.0.0.1:4000/accounts')
 *
 * aufrufen und die Antwort lesen - denn `cors { origin: true }` spiegelte jede Herkunft
 * zurueck. Damit war das gesamte Postfach lesbar, /sicherung gab das Adressbuch heraus,
 * und POST /accounts/:id/send verschickte Post im Namen des Nutzers. Der Port war fest
 * 4000, also ratbar.
 *
 * Dagegen stehen jetzt drei Riegel, bewusst hintereinander statt nur einer:
 *
 *  1. CORS ist weg (siehe app.ts). Ohne Access-Control-Allow-Origin darf ein fremdes
 *     Skript die Antwort nicht lesen. Das allein wuerde schon das meiste abdecken.
 *  2. Der Herkunftsriegel unten weist jede Anfrage ab, die eine fremde Origin nennt.
 *     Das faengt auch die Faelle, in denen der Angreifer die Antwort gar nicht braucht,
 *     weil ihm die Wirkung genuegt (Ordner leeren, Mail verschicken).
 *  3. Das Geheimnis: die Huelle erzeugt es beim Start neu und gibt es nur dem eigenen
 *     Fenster mit. Wer es nicht kennt, kommt an keine Route.
 *
 * Warum alle drei: Riegel 1 und 2 haengen am Wohlverhalten des Browsers. Riegel 3 nicht -
 * er gilt auch fuer ein Programm auf demselben Rechner, das ueberhaupt keinen Browser
 * benutzt und sich um Herkunftsregeln nicht schert.
 */

/** Kopfzeile, in der die Oberflaeche das Geheimnis mitschickt. */
export const ZUGANG_KOPFZEILE = 'x-energy-mail-zugang';

/** Abfrageparameter fuer den WebSocket - dort laesst sich keine Kopfzeile setzen. */
export const ZUGANG_PARAMETER = 'zugang';

let geheimnis: string | null = null;

/** Erzeugt ein frisches Geheimnis. Bei jedem Start ein neues - es ueberdauert nichts. */
export function erzeugeZugangsgeheimnis(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Setzt das Geheimnis, das ab sofort verlangt wird.
 *
 * `null` schaltet die Pruefung ab - das ist der Entwicklungsbetrieb, in dem die
 * Oberflaeche auf Port 5173 laeuft und der Server von Hand gestartet wird. In der
 * ausgelieferten Anwendung setzt die Huelle immer eines.
 */
export function setzeZugangsgeheimnis(wert: string | null): void {
  geheimnis = wert;
}

export function holeZugangsgeheimnis(): string | null {
  return geheimnis;
}

/**
 * Zeitunabhaengiger Vergleich.
 *
 * Ein gewoehnliches === bricht beim ersten abweichenden Zeichen ab; aus der Dauer laesst
 * sich das Geheimnis zeichenweise erraten. Bei einem lokalen Server ist das theoretisch,
 * aber es kostet nichts, es richtig zu machen.
 */
function gleich(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Erlaubte Herkuenfte. Die Oberflaeche wird vom selben Server ausgeliefert, hat also
 * genau diese Origin; im Entwicklungsbetrieb kommt der Vite-Server dazu.
 */
function herkunftErlaubt(origin: string | undefined, port: number): boolean {
  // Keine Origin-Kopfzeile: eine Navigation des Fensters selbst, ein Bildabruf oder ein
  // Programm ohne Browser. Hier entscheidet allein das Geheimnis.
  if (!origin) return true;
  const erlaubt = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    // Vite im Entwicklungsbetrieb.
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  return erlaubt.includes(origin);
}

/**
 * Anfragen, die ohne Geheimnis durchmuessen.
 *
 * Das Fenster laedt seine eigene Seite ueber eine gewoehnliche Navigation - dabei laesst
 * sich keine Kopfzeile setzen, und dasselbe gilt fuer jedes <script> und <link>, das die
 * Seite nachzieht. Diese Abrufe geben nur aus, was ohnehin im Installationspaket steht;
 * ein Postfach ist darueber nicht erreichbar.
 */
export function istOberflaeche(pfad: string): boolean {
  if (pfad === '/' || pfad === '/index.html') return true;
  if (pfad.startsWith('/assets/')) return true;
  return pfad === '/thema-vorab.js' || pfad === '/favicon.ico' || pfad === '/vite.svg';
}

/** Liest das Geheimnis aus Kopfzeile oder Abfrageparameter. */
export function geheimnisAusAnfrage(request: FastifyRequest): string | null {
  const ausKopf = request.headers[ZUGANG_KOPFZEILE];
  if (typeof ausKopf === 'string' && ausKopf) return ausKopf;
  const ausAbfrage = (request.query as Record<string, unknown> | undefined)?.[ZUGANG_PARAMETER];
  if (typeof ausAbfrage === 'string' && ausAbfrage) return ausAbfrage;
  return null;
}

/**
 * Haengt die Pruefung in den Anfrageweg.
 *
 * onRequest ist der frueheste Punkt - vor dem Einlesen des Rumpfes. Eine abgewiesene
 * Anfrage kostet damit nichts.
 */
export function registriereZugangspruefung(app: FastifyInstance, port: number): void {
  app.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, fertig: () => void) => {
    const origin = request.headers.origin;
    if (!herkunftErlaubt(typeof origin === 'string' ? origin : undefined, port)) {
      reply.code(403).send({ error: 'Anfrage aus fremder Herkunft' });
      return;
    }

    const erwartet = geheimnis;
    if (!erwartet) {
      fertig();
      return;
    }

    const pfad = request.url.split('?')[0] ?? '/';
    if (istOberflaeche(pfad)) {
      fertig();
      return;
    }

    const mitgeschickt = geheimnisAusAnfrage(request);
    if (!mitgeschickt || !gleich(mitgeschickt, erwartet)) {
      reply.code(401).send({ error: 'Kein Zugang' });
      return;
    }

    fertig();
  });
}
