import type { FastifyInstance, FastifyRequest } from 'fastify';
import { t } from '@energy-mail/mail-core/sprache';
import { kuerzeIpAdresse } from '@energy-mail/mail-core/protokoll';
import { getAccount } from '../accountStore.js';
import { protokolliere } from '../protokollDatei.js';
import { aktuellerNutzer, alsVertretung } from './kontext.js';
import { freigabeFuer } from './freigaben.js';

/**
 * Der Wechsel in ein freigegebenes Postfach.
 *
 * ## Was hier geschieht
 *
 * Ruft Bernd einen Weg unter `/accounts/<Annas Konto>/…` auf, läuft von hier an die ganze
 * Anfrage in ANNAS Datenkontext - dort liegen die Zugangsdaten, der Zwischenspeicher, die
 * Regeln, die Etiketten dieses Postfachs. Bernd bleibt daneben als `handelnd` stehen,
 * damit Protokoll und Rechteprüfung den Richtigen nennen.
 *
 * Derselbe Kniff wie im Nutzerkontext selbst: Der Kontext wird im preHandler betreten und
 * NICHT wieder verlassen - `fertig()` wird innerhalb gerufen, und alles, was danach in
 * derselben Ausführungskette folgt, läuft darin weiter. Siehe haken.ts.
 *
 * ## Warum das eng am Pfad hängt
 *
 * Gewechselt wird ausschließlich, wenn die Kennung des freigegebenen Kontos im Pfad steht.
 * Alles andere - die Kontenliste, das Adressbuch, die Einstellungen, die eigenen Freigaben -
 * läuft weiter in Bernds Kontext. Ein Weg, der eine Kontokennung woanders führte, fiele auf
 * die sichere Seite: Bernd hat dieses Konto nicht, `requireAccount` findet nichts, und der
 * Server antwortet mit 404.
 *
 * Das ist der Grund, warum dieser Haken so wenig tut: Jede Zeile mehr wäre eine Zeile, in
 * der der Wechsel eines Tages an einer Stelle greift, an der er nicht hingehört.
 */

/** `/accounts/<kennung>` und alles darunter - und nichts sonst. */
const KONTO_PFAD = /^\/accounts\/([^/]+)(?:\/|$)/;

/**
 * Wege, die immer nur dem Eigentümer gehören - auch bei vollem Zugriff.
 *
 * Sie betreffen nicht die Post, sondern das Konto selbst: es zu entfernen, seine
 * Zugangsdaten zu erneuern, seine Einstellungen zu ändern, ein Schlüsselpaar dafür zu
 * erzeugen. Wer ein Postfach zum Bearbeiten bekommt, bekommt damit nicht das Recht, es
 * abzuschaffen - und der Vertreter, der aus Versehen "Konto entfernen" trifft, vernichtet
 * sonst die Zugangsdaten eines anderen Menschen.
 */
const NUR_BESITZER: { methode: string; muster: RegExp }[] = [
  { methode: 'DELETE', muster: /^\/accounts\/[^/]+$/ },
  { methode: 'PATCH', muster: /^\/accounts\/[^/]+$/ },
  { methode: 'POST', muster: /^\/accounts\/[^/]+\/(reauth|schluesselpaar|pgp-kennwort)$/ },
];

/**
 * Was ein Nutzer mit reinem Leserecht darf.
 *
 * GET ist immer lesend. Dazu genau eine Ausnahme: das Entschlüsseln einer PGP-Nachricht
 * geht über POST, weil dabei ein Kennwort mitgeht, das nicht in eine Adresszeile gehört -
 * und ohne sie könnte ein Leser verschlüsselte Post nicht lesen, was der Sinn des
 * Leserechts wäre.
 *
 * Die Liste ist absichtlich so kurz. Eine Erlaubnisliste, die wächst, ist eine, in die
 * eines Tages jemand einen schreibenden Weg einträgt, weil er "eigentlich auch nur liest".
 */
function istLesend(request: FastifyRequest, pfad: string): boolean {
  if (request.method === 'GET' || request.method === 'HEAD') return true;
  return (
    request.method === 'POST' && /^\/accounts\/[^/]+\/folders\/.+\/messages\/\d+\/pgp$/.test(pfad)
  );
}

export function registriereFreigabeWechsel(app: FastifyInstance): void {
  app.addHook('preHandler', (request, reply, fertig) => {
    const pfad = request.url.split('?')[0] ?? '/';
    const treffer = KONTO_PFAD.exec(pfad);
    if (!treffer) {
      fertig();
      return;
    }

    const kontoId = decodeURIComponent(treffer[1] ?? '');
    const ich = aktuellerNutzer();

    /*
     * Zuerst: Gehört es mir selbst? Dann ist hier nichts zu tun.
     *
     * Diese Reihenfolge ist wesentlich. Andersherum - erst die Freigaben durchsehen -
     * könnte eine fehlerhafte Freigabe auf eine Kennung, die es in beiden Kontenlisten
     * gibt, den eigenen Zugriff in fremde Daten umlenken.
     */
    if (getAccount(kontoId)) {
      fertig();
      return;
    }

    const freigabe = freigabeFuer(ich, kontoId);
    if (!freigabe) {
      /*
       * Keine Freigabe: unverändert weiterlaufen lassen und NICHT hier abweisen.
       *
       * Die Route findet das Konto dann nicht und antwortet mit 404 - dieselbe Antwort
       * wie für eine erfundene Kennung. Ein eigenes 403 an dieser Stelle verriete, dass
       * es das Konto gibt und es nur jemand anderem gehört.
       */
      fertig();
      return;
    }

    const verboten = NUR_BESITZER.some(
      (r) => r.methode === request.method && r.muster.test(pfad),
    );
    if (verboten) {
      return reply.code(403).send({
        error: t('Das Konto selbst kann nur ändern, wem es gehört.'),
      });
    }

    if (freigabe.rechte === 'lesen' && !istLesend(request, pfad)) {
      protokolliere(
        'info',
        'freigabe',
        `"${ich}" wollte in ${freigabe.email} schreiben, hat aber nur Leserecht ` +
          `(${request.method} ${pfad}, ${kuerzeIpAdresse(request.ip)}).`,
      );
      return reply.code(403).send({
        error: t('Dieses Postfach ist Ihnen nur zum Lesen freigegeben.'),
      });
    }

    alsVertretung(freigabe.besitzer, ich, fertig);
  });
}
