import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { kuerzeIpAdresse } from '@energy-mail/mail-core/protokoll';
import { protokolliere } from '../protokollDatei.js';
import {
  beendeAlleSitzungen,
  beendeSitzung,
  entsperreSitzung,
  eroeffneSitzung,
  nutzerZurSitzung,
  sitzungsstand,
  sperreSitzung,
  sperrfristMinuten,
} from './sitzung.js';
import {
  findeNutzer,
  hatZweiFaktor,
  istVerwalter,
  oeffentlich,
  pruefeAnmeldung,
  setzeKennwort,
} from './nutzerStore.js';
import { istGesperrt, merkeErfolg, merkeFehlversuch } from './anmeldebremse.js';
import {
  beginneZweiteStufe,
  halbeAnmeldung,
  markeEinloesen,
  markeFehlversuch,
  offeneCodes,
  pruefeZweitenFaktor,
} from './zweiFaktor.js';
import { oeffentlicheAdressen } from '../zugang.js';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Anmelden, abmelden, und die Frage "wer bin ich".
 *
 * Die drei Wege, die ohne Anmeldung erreichbar sein müssen - alles andere hängt hinter
 * dem Nutzerkontext.
 */

export const KEKS_NAME = 'energy_mail_sitzung';

/** Pfade, die ohne angemeldeten Nutzer durchmüssen. */
/**
 * Pfade, die ohne angemeldeten Nutzer durchmüssen.
 *
 * `/sperre/oeffnen` gehört dazu, und zwar notwendig: Es ist der einzige Weg aus einer
 * gesperrten Sitzung heraus. Hinge er hinter dem Haken, prüfte der Haken die Sperre, wiese
 * ab - und niemand käme je wieder herein.
 */
export const OFFENE_PFADE = new Set([
  '/anmelden',
  /*
   * Die zweite Stufe der Anmeldung ist notwendigerweise offen: Wer hier ankommt, hat sein
   * Kennwort gezeigt, aber noch keine Sitzung - er weist sich mit der Marke aus, die der
   * erste Schritt zurückgegeben hat, und nicht mit einem Keks.
   */
  '/anmelden/code',
  '/abmelden',
  '/ich',
  '/sperre',
  '/sperre/oeffnen',
]);

/**
 * Ob die Verbindung verschlüsselt ist - dann darf der Keks als "secure" hinaus.
 *
 * Exportiert, weil die Sicherheitskopfzeilen in app.ts dieselbe Frage stellen: HSTS darf
 * nur mitgehen, wo die Anfrage tatsächlich über TLS hereinkam. Zwei Umsetzungen derselben
 * Prüfung liefen früher oder später auseinander, und die eine wäre dann eine Zusage, die
 * nicht gilt.
 */
export function ueberTls(request: FastifyRequest): boolean {
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

/**
 * Wie gross der Rumpf einer Anfrage hier hoechstens sein darf.
 *
 * Der Server erlaubt sonst 40 MB - richtig fuer einen Anhang, der versendet werden soll,
 * und unsinnig fuer eine Anmeldung. Der Unterschied zaehlt, weil diese Wege die einzigen
 * sind, die OHNE Sitzung erreichbar sein muessen: Wer hier anklopft, hat sich noch mit
 * nichts ausgewiesen. Ohne eigene Grenze darf er trotzdem 40 MB schicken, und zwar so
 * oft er will - der Rumpf wird eingelesen, bevor die Anmeldebremse ueberhaupt gefragt
 * wird, denn die haengt an der Adresse im Rumpf.
 *
 * 4 KB sind grosszuegig: Adresse und Kennwort zusammen sind ein paar hundert Byte, und
 * die laengste Marke der zweiten Stufe ist 64 Zeichen lang. Wer mehr schickt, meint
 * nicht diese Route.
 */
const ANMELDUNG_RUMPF_MAX = 4 * 1024;

/**
 * @param ermittle Derselbe Ermittler, den auch der Nutzerkontext verwendet - siehe /ich.
 */
export function registriereAnmeldung(
  app: FastifyInstance,
  ermittle: (request: FastifyRequest) => string | null,
): void {
  app.post<{ Body: { email?: string; kennwort?: string } }>(
    '/anmelden',
    { bodyLimit: ANMELDUNG_RUMPF_MAX },
    async (request, reply) => {
      const email = typeof request.body?.email === 'string' ? request.body.email : '';
      const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';

      if (!email || !kennwort) {
        return reply.code(400).send({ error: t('Adresse und Kennwort werden gebraucht.') });
      }

      const gesperrt = istGesperrt(request.ip, email);
      if (gesperrt) {
        /*
         * Gekürzt, nicht vollständig.
         *
         * Wozu die Zeile da ist - zu erkennen, dass hier jemand durchprobiert -, leistet
         * das Netz genauso wie der einzelne Anschluss. Was darüber hinausgeht, ist die
         * Anschlusskennung eines Menschen in einer Datei, die "Fehlerbericht erzeugen" zum
         * Verschicken anbietet. Der Betreiber eines Servers für den Bekanntenkreis schickte
         * damit die Adressen seiner Bekannten mit.
         */
        protokolliere(
          'warnung',
          'anmeldung',
          gesperrt === 'netz'
            ? `Zu viele Versuche aus ${kuerzeIpAdresse(request.ip)} gegen mehrere Adressen.`
            : `Zu viele Versuche für ${email} aus ${kuerzeIpAdresse(request.ip)}.`,
        );
        return reply.code(429).send({
          error:
            gesperrt === 'netz'
              ? t('Zu viele Versuche von dieser Verbindung. Bitte in einer Stunde noch einmal probieren.')
              : t('Zu viele Versuche. Bitte in einer Viertelstunde noch einmal probieren.'),
        });
      }

      const nutzer = pruefeAnmeldung(email, kennwort);
      if (!nutzer) {
        merkeFehlversuch(request.ip, email);
        /*
         * Eine Meldung für beide Fälle.
         *
         * "Diese Adresse kennen wir nicht" wäre freundlicher und verriete zugleich, wer
         * hier ein Konto hat. Bei einem Mailprogramm ist das eine Auskunft, die niemanden
         * etwas angeht.
         */
        return reply.code(401).send({ error: t('Adresse oder Kennwort stimmen nicht.') });
      }

      /**
       * Das Kennwort stimmt - und jetzt kommt die Frage, ob das schon reicht.
       *
       * Ist ein zweiter Faktor eingerichtet, wird hier KEINE Sitzung eröffnet. Zurück geht
       * eine Marke, die fünf Minuten gilt und genau einen Weg öffnet: /anmelden/code. Erst
       * dort entsteht der Keks.
       *
       * Auch die Anmeldebremse bleibt bis dahin stehen. Sie erst hier zurückzusetzen wäre
       * bequem und falsch: Wer das Kennwort hat, könnte sonst beliebig viele Codes
       * durchprobieren, indem er zwischendurch immer wieder das Kennwort schickt.
       */
      if (hatZweiFaktor(nutzer.id)) {
        protokolliere('info', 'anmeldung', `${nutzer.id}: Kennwort stimmt, zweiter Faktor fehlt noch.`);
        return { zweiFaktor: true as const, marke: beginneZweiteStufe(nutzer.id, email) };
      }

      merkeErfolg(request.ip, email);
      setzeKeks(reply, request, eroeffneSitzung(nutzer.id));
      protokolliere('info', 'anmeldung', `${nutzer.id} angemeldet.`);
      return { nutzer: oeffentlich(nutzer) };
    },
  );

  /**
   * Die zweite Stufe: das Einmalkennwort.
   *
   * Ausgewiesen wird sich mit der Marke aus dem ersten Schritt - nicht mit der Adresse.
   * Das ist der Unterschied, auf den es ankommt: Wer hier eine Adresse mitschicken dürfte,
   * hätte einen Weg, fremde Konten anzutasten, ohne deren Kennwort zu kennen.
   *
   * Dass die Anmeldebremse mitzählt, ist bei sechs Ziffern keine Feinheit, sondern die
   * halbe Sicherheit des Verfahrens. Zehn Versuche je Viertelstunde gegen eine Million
   * Möglichkeiten - ohne sie wäre ein Code in einer Stunde durchprobiert.
   */
  app.post<{ Body: { marke?: string; code?: string } }>(
    '/anmelden/code',
    { bodyLimit: ANMELDUNG_RUMPF_MAX },
    async (request, reply) => {
      const marke = typeof request.body?.marke === 'string' ? request.body.marke : '';
      const offen = halbeAnmeldung(marke);
      if (!offen) {
        return reply.code(401).send({
          error: t('Die Anmeldung ist abgelaufen. Bitte melden Sie sich noch einmal an.'),
          neuAnmelden: true,
        });
      }

      const gebremst = istGesperrt(request.ip, offen.email);
      if (gebremst) {
        protokolliere(
          'warnung',
          'anmeldung',
          `Zu viele Codeversuche für ${offen.nutzerId} aus ${kuerzeIpAdresse(request.ip)}.`,
        );
        return reply.code(429).send({
          error: t('Zu viele Versuche. Bitte in einer Viertelstunde noch einmal probieren.'),
        });
      }

      const code = typeof request.body?.code === 'string' ? request.body.code : '';
      const befund = pruefeZweitenFaktor(offen.nutzerId, code);

      if (!befund.ok) {
        merkeFehlversuch(request.ip, offen.email);
        markeFehlversuch(marke);
        return reply.code(401).send({
          error:
            befund.grund === 'wiederholt'
              ? /*
                 * Eine eigene Meldung, und zwar eine, die den Menschen nicht in die Irre
                 * führt: Sein Code war richtig. Er war nur schon einmal dran. "Der Code
                 * stimmt nicht" ließe ihn an seiner App zweifeln.
                 */
                t('Dieser Code wurde schon benutzt. Warten Sie auf den nächsten.')
              : t('Der Code stimmt nicht.'),
        });
      }

      merkeErfolg(request.ip, offen.email);
      markeEinloesen(marke);
      const nutzer = findeNutzer(offen.nutzerId);
      if (!nutzer) return reply.code(401).send({ error: t('Nicht angemeldet.') });
      setzeKeks(reply, request, eroeffneSitzung(nutzer.id));
      protokolliere(
        'info',
        'anmeldung',
        befund.art === 'code'
          ? `${nutzer.id} angemeldet - mit zweitem Faktor.`
          : `${nutzer.id} angemeldet - mit einem Wiederherstellungscode.`,
      );

      return {
        nutzer: oeffentlich(nutzer),
        /*
         * Bei einem Wiederherstellungscode geht die Restzahl mit hinaus. Wer den letzten
         * verbraucht hat, soll das im selben Augenblick erfahren und nicht erst dann,
         * wenn er ihn braucht.
         */
        wiederherstellung: befund.art === 'wiederherstellung' ? befund.uebrig : undefined,
      };
    },
  );

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
   *
   * Bewusst über DENSELBEN Ermittler wie der Nutzerkontext und nicht über den Keks
   * allein. Sonst käme im Desktop-Fenster "nicht angemeldet" heraus - dort gibt es
   * keinen Keks, sondern das Zugangsgeheimnis des Prozesses -, und die Hülle zeigte ein
   * Anmeldefenster für eine Anmeldung, die es dort gar nicht gibt.
   */
  app.get('/ich', async (request) => {
    const nutzerId = ermittle(request);
    if (!nutzerId) return { angemeldet: false as const };
    const nutzer = findeNutzer(nutzerId);
    return {
      angemeldet: true as const,
      /*
       * Ob die Sitzung gerade zu ist.
       *
       * Die Oberfläche fragt beim Start danach - sonst zeigte sie nach einem Neuladen im
       * gesperrten Zustand kurz das Postfach, bevor der erste Abruf mit 423 zurückkommt.
       */
      gesperrt: sitzungsstand(request.cookies[KEKS_NAME]).gesperrt,
      /**
       * Nach wie vielen Minuten Untätigkeit gesperrt wird - 0 heißt: gar nicht.
       *
       * Die Oberfläche braucht den Wert, weil sie selbst sperrt, sobald niemand mehr
       * tippt. Der Server sieht Untätigkeit erst bei der nächsten Anfrage, und die kommt
       * vor einem verlassenen Bildschirm nicht.
       */
      sperreNachMinuten: sperrfristMinuten(),
      /**
       * Ob dieser Mensch verwalten darf.
       *
       * Die Oberfläche entscheidet daran nur, ob sie den Weg dorthin ANZEIGT. Der Riegel
       * sitzt am Server (siehe verwaltung.ts) - eine Oberfläche, die einen Knopf versteckt,
       * hat nichts verboten.
       */
      verwalter: istVerwalter(nutzerId),
      /** Ob ein zweiter Faktor eingerichtet ist - das Konto zeigt danach Ein oder Aus. */
      zweiFaktor: hatZweiFaktor(nutzerId),
      /**
       * Wie viele Wiederherstellungscodes noch übrig sind.
       *
       * Steht hier, damit das Konto warnen kann, bevor es zu spät ist. Wer merkt, dass
       * keiner mehr da ist, merkt es sonst an dem Tag, an dem sein Telefon kaputt ist.
       */
      codesUebrig: hatZweiFaktor(nutzerId) ? offeneCodes(nutzerId) : 0,
      nutzer: { id: nutzerId, email: nutzer?.email ?? '' },
      /*
       * Ob die Sitzung an einem Keks hängt - nur dann ist Abmelden sinnvoll. In der
       * Hülle weist sich das Fenster über das Zugangsgeheimnis des Prozesses aus; ein
       * Abmelden-Knopf führte dort ins Leere.
       */
      abmeldbar: Boolean(request.cookies[KEKS_NAME]),
      /**
       * Ob sich ein Konto über OAuth einrichten lässt.
       *
       * Der Ablauf verlangt, dass der BROWSER den Rückweg erreicht: Der Dienst öffnet
       * einen kurzlebigen Horcher auf 127.0.0.1 und gibt Google bzw. Microsoft genau
       * diese Adresse als Rückleitung mit (siehe oauthFlow.ts). Das geht auf, solange
       * Browser und Dienst auf demselben Rechner laufen - in der Desktop-Hülle also
       * immer, und bei einem Server, den man von ebendiesem Rechner aus bedient, auch.
       *
       * Sobald der Dienst aber von woanders benutzt wird, zeigt "127.0.0.1" auf den
       * Rechner des BENUTZERS. Dort horcht niemand, und der Vorgang kann nicht zu Ende
       * gehen - er läuft in eine Fehlerseite oder in die Zeitüberschreitung.
       *
       * Entschieden wird an der öffentlichen Adresse, weil sie genau diese Frage
       * beantwortet: Sie ist gesetzt, wenn der Dienst für andere Rechner erreichbar sein
       * soll (index.ts verlangt sie, sobald nach außen gehorcht wird), und leer, wenn
       * nicht. Und hier entscheidet sie der Server und nicht die Oberfläche anhand von
       * window.energyMail - dasselbe Prinzip wie bei /ich überhaupt: eine Abfrage, zwei
       * Betriebsarten.
       */
      oauthMoeglich: oeffentlicheAdressen().length === 0,
    };
  });

  /**
   * Sperren - sofort, auf Verlangen.
   *
   * Die Frist in sitzung.ts fängt den, der es vergisst. Dieser Weg ist für den, der den
   * Rechner bewusst verlässt und nicht warten will, bis eine Frist abläuft.
   */
  app.post('/sperre', async (request) => {
    const kennung = request.cookies[KEKS_NAME];
    const stand = sitzungsstand(kennung);
    if (!stand.nutzerId) return { gesperrt: false };
    sperreSitzung(kennung);
    protokolliere('info', 'sitzung', `${stand.nutzerId} hat gesperrt.`);
    return { gesperrt: true };
  });

  /**
   * Wieder aufmachen - mit dem Kennwort desselben Nutzers.
   *
   * Geprüft wird gegen den Nutzer DER SITZUNG und nicht gegen eine mitgeschickte Adresse.
   * Sonst wäre dieser Weg eine zweite Anmeldung ohne Bremse: Wer eine gesperrte Sitzung
   * vor sich hat, könnte hier fremde Adressen durchprobieren.
   *
   * Die Anmeldebremse zählt trotzdem mit - eine Sperre, die sich unbegrenzt durchprobieren
   * lässt, ist keine.
   *
   * Der zweite Faktor wird hier ABSICHTLICH NICHT verlangt, auch wenn er eingerichtet ist.
   * Er beantwortet die Frage "ist das wirklich dieses Konto"; die hat diese Sitzung beim
   * Anmelden bereits beantwortet. Die Sperre beantwortet eine andere: "sitzt noch derselbe
   * Mensch davor". Dafür genügt das Kennwort. Wer bei jedem Entsperren das Telefon
   * hervorholen müsste, stellte die Sperre nach dem dritten Mal ab - und dann schützt sie
   * gar nichts mehr.
   */
  app.post<{ Body: { kennwort?: string } }>(
    '/sperre/oeffnen',
    { bodyLimit: ANMELDUNG_RUMPF_MAX },
    async (request, reply) => {
      const kennung = request.cookies[KEKS_NAME];
      const stand = sitzungsstand(kennung);
      if (!stand.nutzerId) return reply.code(401).send({ error: t('Nicht angemeldet.') });

      const nutzer = findeNutzer(stand.nutzerId);
      if (!nutzer) return reply.code(401).send({ error: t('Nicht angemeldet.') });

      const gesperrt = istGesperrt(request.ip, nutzer.email);
      if (gesperrt) {
        protokolliere(
          'warnung',
          'sitzung',
          `Zu viele Versuche beim Entsperren aus ${kuerzeIpAdresse(request.ip)}.`,
        );
        return reply.code(429).send({
          error:
            gesperrt === 'netz'
              ? t('Zu viele Versuche von dieser Verbindung. Bitte in einer Stunde noch einmal probieren.')
              : t('Zu viele Versuche. Bitte in einer Viertelstunde noch einmal probieren.'),
        });
      }

      const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';
      if (!pruefeAnmeldung(nutzer.email, kennwort)) {
        merkeFehlversuch(request.ip, nutzer.email);
        return reply.code(401).send({ error: t('Das Kennwort stimmt nicht.') });
      }

      merkeErfolg(request.ip, nutzer.email);
      entsperreSitzung(kennung);
      protokolliere('info', 'sitzung', `${stand.nutzerId} hat entsperrt.`);
      return { gesperrt: false };
    },
  );

  /**
   * Kennwort ändern - und dabei überall abmelden.
   *
   * Das Abmelden gehört dazu: wer sein Kennwort wechselt, tut das oft, weil er den
   * Verdacht hat, dass es jemand kennt. Bliebe eine fremde Sitzung offen, wäre der
   * Wechsel wirkungslos.
   */
  app.post<{ Body: { alt?: string; neu?: string } }>(
    '/ich/kennwort',
    { bodyLimit: ANMELDUNG_RUMPF_MAX },
    async (request, reply) => {
      const nutzerId = nutzerZurSitzung(request.cookies[KEKS_NAME]);
      if (!nutzerId) return reply.code(401).send({ error: t('Nicht angemeldet.') });

      const alt = typeof request.body?.alt === 'string' ? request.body.alt : '';
      const neu = typeof request.body?.neu === 'string' ? request.body.neu : '';

      const { findeNutzer } = await import('./nutzerStore.js');
      const nutzer = findeNutzer(nutzerId);
      if (!nutzer || !pruefeAnmeldung(nutzer.email, alt)) {
        return reply.code(401).send({ error: t('Das bisherige Kennwort stimmt nicht.') });
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
