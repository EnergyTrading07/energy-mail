import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { protokolliere } from '../protokollDatei.js';
import { beendeAlleSitzungen, beendeSitzung, eroeffneSitzung, nutzerZurSitzung } from './sitzung.js';
import { oeffentlich, pruefeAnmeldung, setzeKennwort } from './nutzerStore.js';

/**
 * Anmelden, abmelden, und die Frage "wer bin ich".
 *
 * Die drei Wege, die ohne Anmeldung erreichbar sein müssen - alles andere hängt hinter
 * dem Nutzerkontext.
 */

export const KEKS_NAME = 'energy_mail_sitzung';

/** Pfade, die ohne angemeldeten Nutzer durchmüssen. */
export const OFFENE_PFADE = new Set(['/anmelden', '/abmelden', '/ich']);

/**
 * Eine einfache Bremse gegen Durchprobieren.
 *
 * Ohne sie ließe sich ein Kennwort mit genügend Versuchen erraten - bei einem Dienst, der
 * aus dem Netz erreichbar ist, keine theoretische Sorge. scrypt macht jeden Versuch teuer,
 * aber teuer für den Server ist es auch: hundert gleichzeitige Versuche wären zugleich ein
 * wirksamer Angriff auf die Verfügbarkeit.
 *
 * Bewusst schlicht gehalten und im Speicher: bei einem Neustart ist sie weg, und das ist
 * für den Bekanntenkreis vertretbar. Vor dem öffentlichen Betrieb gehört an diese Stelle
 * etwas, das über Prozessgrenzen hinweg zählt.
 */
const versuche = new Map<string, { anzahl: number; bis: number }>();
const MAX_VERSUCHE = 10;
const SPERRE_MS = 15 * 60 * 1000;

function schluesselFuer(request: FastifyRequest, email: string): string {
  return `${request.ip}|${email.trim().toLowerCase()}`;
}

function istGesperrt(schluessel: string): boolean {
  const eintrag = versuche.get(schluessel);
  if (!eintrag) return false;
  if (Date.now() > eintrag.bis) {
    versuche.delete(schluessel);
    return false;
  }
  return eintrag.anzahl >= MAX_VERSUCHE;
}

function merkeFehlversuch(schluessel: string): void {
  const eintrag = versuche.get(schluessel);
  const jetzt = Date.now();
  if (!eintrag || jetzt > eintrag.bis) {
    versuche.set(schluessel, { anzahl: 1, bis: jetzt + SPERRE_MS });
    return;
  }
  eintrag.anzahl += 1;
  eintrag.bis = jetzt + SPERRE_MS;
}

/** Ob die Verbindung verschlüsselt ist - dann darf der Keks als "secure" hinaus. */
function ueberTls(request: FastifyRequest): boolean {
  if (request.protocol === 'https') return true;
  // Hinter einem Reverse Proxy steht die Auskunft in der Kopfzeile.
  const weiter = request.headers['x-forwarded-proto'];
  return typeof weiter === 'string' && weiter.split(',')[0]?.trim() === 'https';
}

function setzeKeks(reply: FastifyReply, request: FastifyRequest, kennung: string): void {
  reply.setCookie(KEKS_NAME, kennung, {
    path: '/',
    // Für Skript unerreichbar: ein Fehler in der Oberfläche soll die Sitzung nicht
    // auslesbar machen.
    httpOnly: true,
    /*
     * Strict und nicht Lax.
     *
     * Damit schickt der Browser den Keks bei keiner Anfrage mit, die von einer fremden
     * Seite ausgeht - und das ist zugleich der Schutz gegen fremde Schreibzugriffe. Der
     * Preis: wer einem Link auf das Postfach folgt, ist beim ersten Aufruf nicht
     * angemeldet und muss einmal neu laden. Für ein Mailprogramm, das man nicht über
     * Links betritt, ist das der richtige Tausch.
     */
    sameSite: 'strict',
    secure: ueberTls(request),
    maxAge: 90 * 24 * 60 * 60,
  });
}

export function registriereAnmeldung(app: FastifyInstance): void {
  app.post<{ Body: { email?: string; kennwort?: string } }>('/anmelden', async (request, reply) => {
    const email = typeof request.body?.email === 'string' ? request.body.email : '';
    const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';

    if (!email || !kennwort) {
      return reply.code(400).send({ error: 'Adresse und Kennwort werden gebraucht.' });
    }

    const schluessel = schluesselFuer(request, email);
    if (istGesperrt(schluessel)) {
      protokolliere('warnung', 'anmeldung', `Zu viele Versuche für ${email} von ${request.ip}.`);
      return reply.code(429).send({
        error: 'Zu viele Versuche. Bitte in einer Viertelstunde noch einmal probieren.',
      });
    }

    const nutzer = pruefeAnmeldung(email, kennwort);
    if (!nutzer) {
      merkeFehlversuch(schluessel);
      /*
       * Eine Meldung für beide Fälle.
       *
       * "Diese Adresse kennen wir nicht" wäre freundlicher und verriete zugleich, wer
       * hier ein Konto hat. Bei einem Mailprogramm ist das eine Auskunft, die niemanden
       * etwas angeht.
       */
      return reply.code(401).send({ error: 'Adresse oder Kennwort stimmen nicht.' });
    }

    versuche.delete(schluessel);
    setzeKeks(reply, request, eroeffneSitzung(nutzer.id));
    protokolliere('info', 'anmeldung', `${nutzer.id} angemeldet.`);
    return { nutzer: oeffentlich(nutzer) };
  });

  app.post('/abmelden', async (request, reply) => {
    beendeSitzung(request.cookies[KEKS_NAME]);
    reply.clearCookie(KEKS_NAME, { path: '/' });
    return { ok: true };
  });

  /**
   * Wer gerade angemeldet ist.
   *
   * Die Oberfläche fragt beim Start danach: steht hier niemand, zeigt sie das
   * Anmeldefenster statt eines leeren Posteingangs.
   */
  app.get('/ich', async (request) => {
    const nutzerId = nutzerZurSitzung(request.cookies[KEKS_NAME]);
    if (!nutzerId) return { angemeldet: false as const };
    return { angemeldet: true as const, nutzer: { id: nutzerId } };
  });

  /**
   * Kennwort ändern - und dabei überall abmelden.
   *
   * Das Abmelden gehört dazu: wer sein Kennwort wechselt, tut das oft, weil er den
   * Verdacht hat, dass es jemand kennt. Bliebe eine fremde Sitzung offen, wäre der
   * Wechsel wirkungslos.
   */
  app.post<{ Body: { alt?: string; neu?: string } }>(
    '/ich/kennwort',
    async (request, reply) => {
      const nutzerId = nutzerZurSitzung(request.cookies[KEKS_NAME]);
      if (!nutzerId) return reply.code(401).send({ error: 'Nicht angemeldet.' });

      const alt = typeof request.body?.alt === 'string' ? request.body.alt : '';
      const neu = typeof request.body?.neu === 'string' ? request.body.neu : '';

      const { findeNutzer } = await import('./nutzerStore.js');
      const nutzer = findeNutzer(nutzerId);
      if (!nutzer || !pruefeAnmeldung(nutzer.email, alt)) {
        return reply.code(401).send({ error: 'Das bisherige Kennwort stimmt nicht.' });
      }

      try {
        setzeKennwort(nutzerId, neu);
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }

      const abgemeldet = beendeAlleSitzungen(nutzerId);
      reply.clearCookie(KEKS_NAME, { path: '/' });
      protokolliere(
        'info',
        'anmeldung',
        `Kennwort von ${nutzerId} geändert, ${abgemeldet} Sitzung(en) beendet.`,
      );
      return { ok: true };
    },
  );
}
