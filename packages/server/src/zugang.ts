import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';

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
 * Die Adresse, unter der der Dienst von aussen erreichbar ist - im Serverbetrieb.
 *
 * Ohne sie stand hier nur 127.0.0.1: hinter einem Reverse Proxy schickt der Browser
 * `Origin: https://mail.beispiel.de`, und der Riegel wies JEDE Anfrage der eigenen
 * Oberflaeche mit 403 ab - auch das Anmelden. Der Dienst waere nicht bedienbar gewesen.
 *
 * Bewusst kein Rueckfall auf "was der Host-Kopf sagt": den bestimmt der Anfragende, und
 * damit waere die Pruefung wirkungslos. Die erlaubte Adresse muss von aussen gesetzt
 * werden - siehe ENERGY_MAIL_OEFFENTLICHE_ADRESSE in index.ts.
 */
let oeffentlicheHerkuenfte: string[] = [];

/**
 * Bringt eine Angabe auf Origin-Form: Schema, Rechnername, Port. Alles andere faellt weg.
 *
 * "mail.beispiel.de" ergibt "https://mail.beispiel.de" - ohne Schema ist im Netzbetrieb
 * nur https gemeint. Ein Pfad wird abgeschnitten, denn eine Origin hat keinen.
 */
function normalisiereHerkunft(eingabe: string): string {
  const roh = eingabe.trim();
  const mitSchema = /^[a-z][a-z0-9+.-]*:\/\//i.test(roh) ? roh : `https://${roh}`;
  let zerlegt: URL;
  try {
    zerlegt = new URL(mitSchema);
  } catch {
    throw new Error(
      `"${eingabe}" ist keine brauchbare Adresse. Erwartet wird etwas wie ` +
        'https://mail.beispiel.de',
    );
  }
  if (zerlegt.protocol !== 'https:' && zerlegt.protocol !== 'http:') {
    throw new Error(`"${eingabe}": nur http und https sind hier vorgesehen.`);
  }
  return zerlegt.origin;
}

/**
 * Setzt die oeffentliche Adresse (oder mehrere, durch Komma getrennt).
 *
 * Wirft bei einer unbrauchbaren Angabe. Das ist Absicht: ein Tippfehler in der
 * Umgebungsvariablen soll beim Start auffallen und nicht als Regen von 403ern, deren
 * Ursache niemand vermutet.
 */
export function setzeOeffentlicheAdresse(adresse: string | null | undefined): void {
  if (!adresse || !adresse.trim()) {
    oeffentlicheHerkuenfte = [];
    return;
  }
  oeffentlicheHerkuenfte = adresse
    .split(',')
    .map((teil) => teil.trim())
    .filter(Boolean)
    .map(normalisiereHerkunft);
}

/** Was gerade als oeffentliche Adresse gilt - fuer Protokoll und Pruefungen. */
export function oeffentlicheAdressen(): readonly string[] {
  return oeffentlicheHerkuenfte;
}

/**
 * Erlaubte Herkuenfte. Die Oberflaeche wird vom selben Server ausgeliefert, hat also
 * genau diese Origin; im Entwicklungsbetrieb kommt der Vite-Server dazu, im Serverbetrieb
 * die oeffentliche Adresse.
 */
function herkunftErlaubt(origin: string | undefined, port: number): boolean {
  // Keine Origin-Kopfzeile: eine Navigation des Fensters selbst, ein Bildabruf oder ein
  // Programm ohne Browser. Hier entscheidet allein das Geheimnis - und, sofern der
  // Browser sie mitschickt, die Auskunft in Sec-Fetch-Site (siehe unten).
  if (!origin) return true;
  const erlaubt = [
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    // Vite im Entwicklungsbetrieb.
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    ...oeffentlicheHerkuenfte,
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

/**
 * Der Weg, an dem sich ablesen laesst, ob der Dienst noch lebt.
 *
 * Muss ohne Anmeldung und ohne Geheimnis erreichbar sein, sonst kann ihn weder die
 * Container-Pruefung noch eine Ueberwachung benutzen - beide haben keine Sitzung. Er gibt
 * dafuer auch nichts heraus, was niemanden angeht: kein Postfach, kein Nutzername, keine
 * Zahl der Konten. Nach aussen durchgereicht wird er ohnehin nicht (siehe Caddyfile).
 */
export const GESUNDHEITS_PFAD = '/gesundheit';

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
      reply.code(403).send({ error: t('Anfrage aus fremder Herkunft') });
      return;
    }

    /*
     * Der dritte Riegel, dort wo der zweite nichts sieht.
     *
     * Der Herkunftsriegel oben laesst jede Anfrage OHNE Origin-Kopfzeile durch, und das
     * muss er auch: eine Navigation des Fensters, ein Bildabruf, ein Programm ohne
     * Browser - keines davon setzt eine. Nur schickt der Browser bei genau diesen
     * Anfragen etwas anderes mit, naemlich Sec-Fetch-Site. Steht dort "cross-site", kam
     * die Anfrage nachweislich von einer fremden Seite, und dann ist sie abzuweisen -
     * auch wenn keine Origin dabeisteht.
     *
     * Damit ist der haeufigste Rest gedeckt, den der Origin-Riegel nicht sieht: die
     * Navigation von einer fremden Seite auf einen Weg dieses Servers.
     *
     * "same-site" gilt als in Ordnung und nicht nur "same-origin": hinter einem Vorbau
     * kann die Oberflaeche auf mail.beispiel.de und ein Teil davon auf einer
     * Unterdomaene liegen. "none" heisst, dass es keinen Ausloeser gab - eine
     * Adresszeile, ein Lesezeichen -, und das ist ausdruecklich erlaubt.
     *
     * Wer keine Kopfzeile schickt, wird nicht abgewiesen. Sie ist eine Zugabe des
     * Browsers, keine Bedingung: ein Werkzeug wie curl kennt sie nicht, und fuer den
     * gilt weiterhin das Geheimnis als Riegel.
     */
    const auslaeser = request.headers['sec-fetch-site'];
    if (typeof auslaeser === 'string' && auslaeser === 'cross-site') {
      reply.code(403).send({ error: t('Anfrage aus fremder Herkunft') });
      return;
    }

    const erwartet = geheimnis;
    if (!erwartet) {
      fertig();
      return;
    }

    const pfad = request.url.split('?')[0] ?? '/';
    if (istOberflaeche(pfad) || pfad === GESUNDHEITS_PFAD) {
      fertig();
      return;
    }

    const mitgeschickt = geheimnisAusAnfrage(request);
    if (!mitgeschickt || !gleich(mitgeschickt, erwartet)) {
      reply.code(401).send({ error: t('Kein Zugang') });
      return;
    }

    fertig();
  });
}
