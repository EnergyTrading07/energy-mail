import type { FastifyInstance, FastifyRequest } from 'fastify';
import { kuerzeIpAdresse } from '@energy-mail/mail-core/protokoll';
import { t } from '@energy-mail/mail-core/sprache';
import { protokolliere } from '../protokollDatei.js';
import { oeffentlicheAdressen } from '../zugang.js';
import {
  SystemmailFehler,
  pruefeSystemmail,
  sendeSystemmail,
  setzeSystemmail,
  systemmailEingerichtet,
  systemmailFuerAnzeige,
  type Systemmail,
} from '../systemmail.js';
import { zaehleVersuch } from './anmeldebremse.js';
import { zuruecksetzenMoeglich } from './kennwortVergessen.js';
import { handelnderNutzer } from './kontext.js';
import {
  KENNWORT_MINDESTLAENGE,
  NutzerFehler,
  legeNutzerAn,
  oeffentlich,
} from './nutzerStore.js';
import { verpackeNutzerschluessel } from './schluesselHuelle.js';
import {
  RegistrierungsFehler,
  betriebsartWirksam,
  entferneAntrag,
  findeAntrag,
  loeseMarkeEin,
  nimmAntragAn,
  offeneAntraege,
  registrierungseinstellungen,
  setzeRegistrierung,
  type Antrag,
  type Registrierungseinstellungen,
} from './registrierungSpeicher.js';

/**
 * Die Wege der Selbstregistrierung.
 *
 * Drei davon sind ohne Anmeldung erreichbar - notwendigerweise, denn wer hier ankommt,
 * hat ja gerade noch kein Konto. Das macht sie zu den am stärksten ausgesetzten Stellen
 * des ganzen Servers: Sie stehen jedem offen, der die Adresse kennt. Was daraus folgt,
 * steht bei den einzelnen Wegen; zusammengefasst ist es dreierlei.
 *
 * **Eine Bremse vor allem.** Ohne sie ist ein Registrierungsformular ein Werkzeug, mit
 * dem sich beliebig viele Konten anlegen und beliebig viele fremde Adressen mit
 * Bestätigungsmails bewerfen lassen. Gezählt wird am Anschluss, nicht an der Adresse -
 * sonst könnte jeder jeden aussperren (die Begründung dafür steht ausführlich in
 * anmeldebremse.ts).
 *
 * **Eine einzige Antwort für alle Ausgänge.** Ob es die Adresse schon gibt, ob ein
 * Antrag läuft, ob gerade eine Mail hinausging - nach außen sieht das gleich aus. Sonst
 * wäre dieses Formular ein Verzeichnisdienst über die Konten dieses Servers.
 *
 * **Ein kleiner Rumpf.** Dieselbe Grenze wie bei der Anmeldung: Wer sich mit nichts
 * ausgewiesen hat, darf keine 40 MB schicken.
 */

/** Adresse, Kennwort und eine kurze Bemerkung - mehr passt hier nicht hinein. */
const REGISTRIERUNG_RUMPF_MAX = 4 * 1024;

/**
 * Wie oft von einem Anschluss aus registriert werden darf: fünfmal in der Stunde.
 *
 * Großzügig für einen Menschen (er braucht einen Versuch, vielleicht zwei) und eng für
 * eine Maschine. Die Zahl ist bewusst niedriger als bei der Anmeldung: Ein Mensch
 * vertippt sich beim Kennwort ständig, aber er legt sich nicht fünfmal am Tag ein Konto
 * an.
 *
 * Zu bedenken ist der geteilte Anschluss - ein Betrieb hinter einer einzigen Adresse, an
 * dem sich am Einführungstag zwanzig Kollegen anmelden. Für genau diesen Fall gibt es die
 * Anlage durch den Verwalter, die davon unberührt bleibt.
 */
const ANTRAEGE_MAX = 5;
const ANTRAEGE_FENSTER_MS = 60 * 60 * 1000;

/**
 * Und wie oft ein Bestätigungslink probiert werden darf: zwanzigmal in der Stunde.
 *
 * Die Marke ist 32 zufällige Bytes; sie zu erraten ist aussichtslos, und diese Bremse
 * ist deshalb keine Verteidigung gegen das Erraten, sondern gegen die Last: Jeder
 * Versuch geht über die Antragsliste. Höher als beim Anlegen, weil ein Mensch einen
 * Link durchaus mehrfach anklickt.
 */
const BESTAETIGUNG_MAX = 20;
const BESTAETIGUNG_FENSTER_MS = 60 * 60 * 1000;

/**
 * Woher die Adresse für den Bestätigungslink kommt - und woher ausdrücklich NICHT.
 *
 * Sie kommt aus ENERGY_MAIL_OEFFENTLICHE_ADRESSE, also aus der Einrichtung des
 * Betreibers. Sie kommt NICHT aus der Anfrage.
 *
 * Das ist keine Vorsicht, sondern die Abwehr eines bekannten und regelmäßig
 * ausgenutzten Angriffs. Der Host-Kopf einer Anfrage wird vom Anfragenden bestimmt;
 * baute man den Link daraus, genügte
 *
 *     POST /registrierung   Host: angreifer.example
 *
 * mit der Adresse eines fremden Menschen - und der bekäme eine echte, vom richtigen
 * Server verschickte Mail, deren Link auf den Rechner des Angreifers zeigt. Klickt er,
 * hat der Angreifer die Marke und damit das Konto. Dieselbe Lücke hat schon reihenweise
 * Kennwort-Zurücksetzen-Funktionen erwischt.
 *
 * Ist keine öffentliche Adresse eingerichtet, geht gar keine Mail hinaus. Das ist die
 * richtige Richtung: Ohne sie ist der Dienst ohnehin nicht von außen erreichbar, ein
 * Link darauf führte also ins Leere.
 *
 * ## Warum die Marke hinter dem Doppelkreuz steht und nicht als Abfrageparameter
 *
 * Weil ein Fragment den Rechner des Browsers nie verlässt. Ein `?bestaetigung=…` ginge
 * bei jedem Aufruf mit über die Leitung und landete damit in jedem Protokoll auf dem Weg:
 * im Zugriffsprotokoll des Vorbaus, in dem des Dienstes, in dem jeder
 * Zwischenstelle - und stünde dort tage- oder monatelang im Klartext. Eine Marke, die ein
 * Konto eröffnen kann, hat in einer Protokolldatei nichts zu suchen, die andere Leute
 * lesen dürfen als der Empfänger der Mail.
 *
 * Dasselbe gilt für die Referrer-Kopfzeile: Ein Fragment geht dort nie mit, ein
 * Abfrageparameter sehr wohl.
 *
 * Die Oberfläche liest es aus `location.hash` und nimmt es sofort wieder heraus - siehe
 * markeAusAdresse() in main.tsx.
 */
function bestaetigungsLink(marke: string): string | null {
  const basis = oeffentlicheAdressen()[0];
  if (!basis) return null;
  return `${basis}/#bestaetigung=${encodeURIComponent(marke)}`;
}

function ipVersuch(request: FastifyRequest, bereich: string, max: number, fenster: number): boolean {
  return zaehleVersuch(bereich, request.ip, max, fenster);
}

/** Die Mail an jemanden, der seine Adresse noch nachweisen muss. */
async function sendeBestaetigung(antrag: Antrag, marke: string): Promise<void> {
  const link = bestaetigungsLink(marke);
  if (!link) {
    throw new SystemmailFehler(
      'Für diesen Dienst ist keine öffentliche Adresse eingerichtet ' +
        '(ENERGY_MAIL_OEFFENTLICHE_ADRESSE) - ohne sie lässt sich kein Bestätigungslink bauen.',
    );
  }

  await sendeSystemmail({
    an: antrag.email,
    betreff: t('Ihre Anmeldung bei Energy Mail bestätigen'),
    text:
      t('Guten Tag,') +
      '\n\n' +
      t('für diese Adresse wurde ein Zugang zu Energy Mail beantragt. Bestätigen Sie mit diesem Link, dass die Adresse Ihnen gehört:') +
      '\n\n' +
      link +
      '\n\n' +
      t('Der Link gilt 24 Stunden.') +
      '\n\n' +
      t('Waren Sie das nicht? Dann tun Sie bitte nichts. Ohne Bestätigung entsteht kein Zugang, und der Antrag wird nach einer Woche von selbst gelöscht.') +
      '\n',
  });
}

/**
 * Die Mail an jemanden, der auf seiner Adresse bereits ein Konto hat.
 *
 * Sie ist der Ersatz für die Auskunft, die das Formular NICHT geben darf. Und sie ist
 * mehr als Höflichkeit: Wer sie bekommt, ohne sich angemeldet zu haben, weiß in diesem
 * Augenblick, dass jemand anderes seine Adresse an diesem Dienst ausprobiert.
 */
async function sendeSchonKonto(email: string): Promise<void> {
  await sendeSystemmail({
    an: email,
    betreff: t('Zu dieser Adresse besteht bereits ein Zugang'),
    text:
      t('Guten Tag,') +
      '\n\n' +
      t('für diese Adresse wurde eben ein Zugang zu Energy Mail beantragt. Es besteht allerdings schon einer - melden Sie sich einfach wie gewohnt an.') +
      '\n\n' +
      t('Kennwort vergessen? Wenden Sie sich an den Betreiber dieses Dienstes; er kann es zurücksetzen.') +
      '\n\n' +
      t('Waren Sie das nicht, dann hat jemand Ihre Adresse eingetragen. An Ihrem Zugang ändert das nichts - Ihr Kennwort ist davon unberührt.') +
      '\n',
  });
}

export function registriereSelbstregistrierung(app: FastifyInstance): void {
  /**
   * Was hier gilt - die Auskunft, an der die Oberfläche entscheidet, ob sie überhaupt
   * einen Weg zur Registrierung anbietet.
   *
   * Ohne Anmeldung erreichbar und bewusst wortkarg: Betriebsart, erlaubte Domänen, die
   * geforderte Kennwortlänge und der Datenschutzhinweis. Nichts über den Bestand, keine
   * Zahlen, keine Namen. Wer hier anklopft, erfährt genau das, was auf dem Formular
   * ohnehin stehen muss.
   */
  app.get('/registrierung', async () => {
    const einstellungen = registrierungseinstellungen();
    const wirksam = betriebsartWirksam();
    return {
      moeglich: wirksam !== 'aus',
      betriebsart: wirksam,
      domaenen: einstellungen.domaenen,
      hinweis: einstellungen.hinweis,
      kennwortMindestlaenge: KENNWORT_MINDESTLAENGE,
      /** Ob eine Bestätigungsmail kommt - die Oberfläche sagt hinterher das Richtige. */
      mitBestaetigung: systemmailEingerichtet(),
      /**
       * Ob sich ein vergessenes Kennwort selbst zurücksetzen lässt.
       *
       * Steht hier und nicht auf einem eigenen Weg, obwohl es mit der Registrierung
       * nichts zu tun hat: Diese Route beantwortet die Frage "was geht an diesem Dienst,
       * bevor man ein Konto hat", und das Anmeldefenster ruft sie ohnehin genau einmal
       * ab. Ein zweiter Abruf für ein einzelnes `true` wäre eine Anfrage mehr bei jedem
       * Aufruf des Anmeldefensters - und zwar auf einem Weg, der jedem offensteht.
       *
       * Verraten wird damit nichts über einen Menschen, nur etwas über die Einrichtung:
       * ob ein Systemversand hinterlegt ist. Wer den Dienst benutzt, merkt das ohnehin.
       */
      kennwortZuruecksetzbar: zuruecksetzenMoeglich(),
    };
  });

  /**
   * Einen Zugang beantragen.
   *
   * Die Antwort ist für jeden Ausgang dieselbe - siehe nimmAntragAn(). Was sich
   * unterscheidet, ist die Mail, die hinausgeht, und die bekommt nur der zu sehen, dem
   * die Adresse tatsächlich gehört.
   */
  app.post<{ Body: { email?: string; kennwort?: string; bemerkung?: string; hinweisGelesen?: boolean } }>(
    '/registrierung',
    { bodyLimit: REGISTRIERUNG_RUMPF_MAX },
    async (request, reply) => {
      const wirksam = betriebsartWirksam();
      if (wirksam === 'aus') {
        return reply
          .code(403)
          .send({ error: t('An diesem Dienst kann man sich nicht selbst anmelden.') });
      }

      if (!ipVersuch(request, 'registrierung', ANTRAEGE_MAX, ANTRAEGE_FENSTER_MS)) {
        protokolliere(
          'warnung',
          'registrierung',
          `Zu viele Anmeldeversuche aus ${kuerzeIpAdresse(request.ip)}.`,
        );
        return reply.code(429).send({
          error: t('Zu viele Versuche von dieser Verbindung. Bitte in einer Stunde noch einmal probieren.'),
        });
      }

      /*
       * Der Haken unter dem Datenschutzhinweis wird am SERVER geprüft.
       *
       * In der Oberfläche steht er auch, aber das ist eine Bequemlichkeit für den
       * Nutzer und kein Nachweis: Wer das Formular umgeht, umgeht auch den Haken. Und
       * genau der Nachweis ist der Zweck der Übung - er wird mit dem Zeitpunkt im
       * Antrag festgehalten.
       */
      if (request.body?.hinweisGelesen !== true) {
        return reply
          .code(400)
          .send({ error: t('Bitte bestätigen Sie, dass Sie die Datenschutzhinweise gelesen haben.') });
      }

      const email = typeof request.body?.email === 'string' ? request.body.email : '';
      const kennwort = typeof request.body?.kennwort === 'string' ? request.body.kennwort : '';
      const bemerkung = typeof request.body?.bemerkung === 'string' ? request.body.bemerkung : '';

      let aufnahme;
      try {
        aufnahme = nimmAntragAn({ email, kennwort, bemerkung });
      } catch (err) {
        if (err instanceof RegistrierungsFehler) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }

      /*
       * Was der Antragsteller zu lesen bekommt, hängt allein an der EINRICHTUNG dieses
       * Servers - nie am Ausgang seines Antrags. Beides auseinanderzuhalten ist der
       * ganze Schutz gegen das Durchprobieren von Adressen.
       */
      const antwort = systemmailEingerichtet()
        ? { ok: true as const, art: 'bestaetigen' as const }
        : { ok: true as const, art: 'wartet' as const };

      try {
        if (aufnahme.art === 'bestaetigen') {
          await sendeBestaetigung(aufnahme.antrag, aufnahme.marke);
        } else if (aufnahme.art === 'schonKonto' && systemmailEingerichtet()) {
          await sendeSchonKonto(email.trim().toLowerCase());
        }
      } catch (err) {
        /*
         * Der Versand ist misslungen - dann muss der Antrag wieder weg.
         *
         * Sonst stünde ein unbestätigter Antrag im Weg, zu dem es nie eine Mail gab: Der
         * Mensch versuchte es erneut, bekäme wieder keine Post, und niemand käme darauf,
         * dass der Grund ein falsch eingetragener Sendeserver ist. Lieber ehrlich
         * scheitern.
         */
        if (aufnahme.art === 'bestaetigen') entferneAntrag(aufnahme.antrag.id);
        protokolliere(
          'fehler',
          'registrierung',
          `Bestätigungsmail nicht versandt: ${(err as Error).message}`,
        );
        return reply.code(502).send({
          error: t('Die Bestätigungsmail konnte nicht verschickt werden. Bitte wenden Sie sich an den Betreiber dieses Dienstes.'),
        });
      }

      return antwort;
    },
  );

  /**
   * Den Bestätigungslink einlösen.
   *
   * Was danach passiert, hängt an der Betriebsart:
   *
   *  - **offen**: Das Konto entsteht sofort.
   *  - **freigabe**: Der Antrag ist nachgewiesen und liegt jetzt beim Verwalter.
   *
   * Angemeldet wird hier AUSDRÜCKLICH NICHT, auch nicht bei "offen". Das wäre bequem und
   * wäre ein Loch: Der Link liegt in einem Postfach. Wer darauf Zugriff hat - ein
   * geteiltes Funktionspostfach, ein Kollege am unverschlossenen Rechner, eine
   * Sicherung -, käme sonst ohne das Kennwort hinein. Das Kennwort ist der zweite
   * Nachweis, und den soll dieser Weg nicht ersetzen.
   */
  app.post<{ Body: { marke?: string } }>(
    '/registrierung/bestaetigen',
    { bodyLimit: REGISTRIERUNG_RUMPF_MAX },
    async (request, reply) => {
      if (!ipVersuch(request, 'bestaetigung', BESTAETIGUNG_MAX, BESTAETIGUNG_FENSTER_MS)) {
        return reply.code(429).send({
          error: t('Zu viele Versuche von dieser Verbindung. Bitte in einer Stunde noch einmal probieren.'),
        });
      }

      const marke = typeof request.body?.marke === 'string' ? request.body.marke : '';
      const antrag = loeseMarkeEin(marke);
      if (!antrag) {
        return reply.code(400).send({
          error: t('Dieser Link gilt nicht mehr. Bitte melden Sie sich noch einmal an.'),
        });
      }

      if (betriebsartWirksam() !== 'offen') {
        return { bestaetigt: true as const, art: 'wartet' as const, email: antrag.email };
      }

      try {
        const neu = legeNutzerAn(
          { email: antrag.email, kennwortPruefsumme: antrag.kennwortPruefsumme },
          verpackeNutzerschluessel,
        );
        entferneAntrag(antrag.id);
        protokolliere('info', 'registrierung', `"${neu.id}" hat sich selbst angemeldet.`);
        return { bestaetigt: true as const, art: 'fertig' as const, email: antrag.email };
      } catch (err) {
        if (err instanceof NutzerFehler) {
          /*
           * Hierher kommt man vor allem in einem Fall: Zwischen Antrag und Bestätigung
           * hat ein Verwalter dieselbe Adresse von Hand angelegt. Der Antrag ist damit
           * gegenstandslos - er geht weg, und der Mensch soll sich einfach anmelden.
           */
          entferneAntrag(antrag.id);
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // --- Verwaltung ---

  /*
   * Alles Weitere liegt unter /verwaltung und ist damit automatisch geschützt: Der
   * Riegel in verwaltung.ts hängt am Präfix und nicht an der einzelnen Route. Deshalb
   * stehen diese Wege hier und nicht bei den offenen darüber - wo eine Route liegt,
   * entscheidet, welche Prüfung sie bekommt.
   */
  const PRAEFIX = '/verwaltung';

  app.get(`${PRAEFIX}/registrierung`, async () => ({
    einstellungen: registrierungseinstellungen(),
    /** Was tatsächlich gilt - kann von der Einstellung abweichen, siehe betriebsartWirksam. */
    wirksam: betriebsartWirksam(),
    systemmail: systemmailFuerAnzeige(),
    antraege: offeneAntraege(),
  }));

  app.put<{ Body: Partial<Registrierungseinstellungen> }>(
    `${PRAEFIX}/registrierung`,
    async (request, reply) => {
      try {
        const neu = setzeRegistrierung(request.body ?? {});
        protokolliere(
          'warnung',
          'verwaltung',
          `"${handelnderNutzer()}" hat die Selbstregistrierung auf "${neu.betriebsart}" gestellt.`,
        );
        return { einstellungen: neu, wirksam: betriebsartWirksam() };
      } catch (err) {
        if (err instanceof RegistrierungsFehler) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  /**
   * Einen Antrag freigeben - hier entsteht das Konto.
   *
   * Das Kennwort ist das, was der Antragsteller sich selbst gegeben hat; der Verwalter
   * bekommt es nicht zu sehen und braucht es nicht. Das ist der Unterschied zum Anlegen
   * von Hand, wo ein erzeugtes Kennwort weitergereicht werden muss - und er ist ein
   * Vorteil: Es gibt kein Kennwort, das zwei Menschen kennen.
   */
  app.post<{ Params: { id: string } }>(
    `${PRAEFIX}/registrierung/antraege/:id/freigeben`,
    async (request, reply) => {
      const antrag = findeAntrag(request.params.id);
      if (!antrag) return reply.code(404).send({ error: t('Diesen Antrag gibt es nicht.') });

      try {
        const neu = legeNutzerAn(
          { email: antrag.email, kennwortPruefsumme: antrag.kennwortPruefsumme },
          verpackeNutzerschluessel,
        );
        entferneAntrag(antrag.id);
        protokolliere(
          'info',
          'verwaltung',
          `"${handelnderNutzer()}" hat den Antrag von ${antrag.email} freigegeben ("${neu.id}").`,
        );

        if (systemmailEingerichtet()) {
          /*
           * Die Nachricht darf scheitern, ohne die Freigabe mitzunehmen. Das Konto steht
           * bereits; eine geworfene Ausnahme ließe den Verwalter glauben, es sei nichts
           * passiert - und er gäbe ein zweites Mal frei.
           */
          try {
            await sendeSystemmail({
              an: antrag.email,
              betreff: t('Ihr Zugang zu Energy Mail ist eingerichtet'),
              text:
                t('Guten Tag,') +
                '\n\n' +
                t('Ihr Zugang ist jetzt freigeschaltet. Sie können sich mit Ihrer Adresse und dem Kennwort anmelden, das Sie bei der Anmeldung gewählt haben.') +
                '\n\n' +
                (oeffentlicheAdressen()[0] ?? '') +
                '\n',
            });
          } catch (err) {
            protokolliere(
              'warnung',
              'registrierung',
              `Freigabe von ${antrag.email} nicht gemeldet: ${(err as Error).message}`,
            );
          }
        }

        return { nutzer: oeffentlich(neu) };
      } catch (err) {
        if (err instanceof NutzerFehler) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  /**
   * Einen Antrag ablehnen.
   *
   * Der Antrag wird gelöscht, nicht als "abgelehnt" markiert. Eine Liste abgelehnter
   * Bewerber ist genau die Sorte Bestand, die niemand pflegt und die nach zwei Jahren
   * peinlich wird - und der Betroffene hat ein Recht darauf, dass seine Adresse hier
   * nicht bleibt.
   *
   * Ob er eine Nachricht bekommt, entscheidet der Verwalter: Bei einem offensichtlichen
   * Massenantrag wäre sie eine Mail an eine Adresse, die den Antrag nie gestellt hat.
   */
  app.delete<{ Params: { id: string }; Querystring: { melden?: string } }>(
    `${PRAEFIX}/registrierung/antraege/:id`,
    async (request, reply) => {
      const antrag = findeAntrag(request.params.id);
      if (!antrag) return reply.code(404).send({ error: t('Diesen Antrag gibt es nicht.') });

      entferneAntrag(antrag.id);
      protokolliere(
        'info',
        'verwaltung',
        `"${handelnderNutzer()}" hat den Antrag von ${antrag.email} abgelehnt.`,
      );

      if (request.query.melden === 'true' && systemmailEingerichtet()) {
        try {
          await sendeSystemmail({
            an: antrag.email,
            betreff: t('Ihr Antrag auf einen Zugang'),
            text:
              t('Guten Tag,') +
              '\n\n' +
              t('Ihr Antrag auf einen Zugang zu Energy Mail wurde nicht bewilligt. Bei Rückfragen wenden Sie sich bitte an den Betreiber dieses Dienstes.') +
              '\n',
          });
        } catch (err) {
          protokolliere(
            'warnung',
            'registrierung',
            `Ablehnung an ${antrag.email} nicht zugestellt: ${(err as Error).message}`,
          );
        }
      }

      return { entfernt: true };
    },
  );

  // --- Der Systemversand ---

  app.get(`${PRAEFIX}/systemmail`, async () => systemmailFuerAnzeige());

  app.put<{ Body: Partial<Systemmail> & { kennwort?: string | null } }>(
    `${PRAEFIX}/systemmail`,
    async (request, reply) => {
      const { kennwort, ...rest } = request.body ?? {};
      try {
        const neu = setzeSystemmail(rest, kennwort);
        protokolliere(
          'info',
          'verwaltung',
          `"${handelnderNutzer()}" hat den Systemversand geändert.`,
        );
        return neu;
      } catch (err) {
        if (err instanceof SystemmailFehler) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );

  /** Ein Verbindungsversuch mit den Angaben aus dem Formular - vor dem Speichern. */
  app.post<{ Body: Partial<Systemmail> & { kennwort?: string } }>(
    `${PRAEFIX}/systemmail/pruefen`,
    async (request) => {
      const { kennwort, ...rest } = request.body ?? {};
      return pruefeSystemmail(rest, kennwort);
    },
  );
}
