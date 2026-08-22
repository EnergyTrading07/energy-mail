import { net } from 'electron';
import { t } from '@energy-mail/mail-core/sprache';

/**
 * Mit welchem Server dieses Programm arbeitet.
 *
 * ## Was sich hier geändert hat, und warum
 *
 * Bis hierher brachte die Hülle ihren eigenen Server mit: Sie startete ihn auf 127.0.0.1,
 * legte die Daten in den Benutzerordner und meldete niemanden an - ein Rechner, ein
 * Mensch. Das war richtig, solange dieses Programm ein Einzelplatzprogramm war.
 *
 * Es ist keines mehr. Wer im Browser arbeitet und wer das Programm benutzt, sollen
 * dieselben Postfächer sehen, dieselben Regeln, dieselben Etiketten - und dafür gibt es
 * genau einen Weg: Beide reden mit demselben Server. Die Hülle ist damit ein Fenster auf
 * einen Dienst und kein Dienst mehr.
 *
 * Was sie weiterhin selbst tut, ist alles, was ein Browser nicht kann: Benachrichtigungen
 * des Betriebssystems, der Infobereich, Autostart, das Fenster ohne Adressleiste, die
 * Selbstaktualisierung, der Zertifikatsspeicher von Windows und der Weg durch den
 * Firmenproxy.
 *
 * ## Die eine Regel, die hier nicht verhandelbar ist
 *
 * **Unverschlüsselt nur auf dem eigenen Rechner.** Über diese Verbindung geht ein
 * Anmeldekennwort, und danach jede Nachricht. `http://` zu einem Server im Netz wäre ein
 * Kennwort im Klartext auf einer Leitung, die einem nicht gehört - und der Fehler fiele
 * niemandem auf, weil alles funktioniert. Deshalb wird er hier abgewiesen und nicht
 * bloß angemerkt.
 */

/** Was bei einer geprüften Adresse herauskommt. */
export type Serverbefund =
  | { ok: true; adresse: string; fassung: string }
  | { ok: false; fehler: string };

/**
 * Bringt eine Eingabe auf die Form, die gespeichert wird.
 *
 * `mail.firma.de` wird zu `https://mail.firma.de` - ohne Angabe ist im Netzbetrieb nur
 * https gemeint, und die Voreinstellung muss die sichere sein. Ein Pfad fällt weg: Der
 * Dienst antwortet auf der Wurzel, und ein mitkopiertes `/posteingang` machte aus jeder
 * Anfrage einen Fehlgriff.
 */
export function normalisiereServer(eingabe: string): string {
  const roh = eingabe.trim();
  if (!roh) throw new Error(t('Ohne Adresse geht es nicht.'));

  const mitSchema = /^[a-z][a-z0-9+.-]*:\/\//i.test(roh) ? roh : `https://${roh}`;
  let zerlegt: URL;
  try {
    zerlegt = new URL(mitSchema);
  } catch {
    throw new Error(
      t('„{eingabe}“ ist keine brauchbare Adresse. Erwartet wird etwas wie https://mail.firma.de', {
        eingabe,
      }),
    );
  }

  if (zerlegt.protocol !== 'https:' && zerlegt.protocol !== 'http:') {
    throw new Error(t('Nur http und https sind hier vorgesehen.'));
  }

  if (zerlegt.protocol === 'http:' && !istEigenerRechner(zerlegt.hostname)) {
    /*
     * Der Grund steht oben im Kopf. Hier steht der Satz, den ein Mensch liest - und er
     * nennt den Ausweg, statt nur zu verbieten: Wer wirklich unverschlüsselt arbeiten
     * will, kann das auf dem eigenen Rechner, und wer einen Server im Netz betreibt,
     * braucht ohnehin ein Zertifikat.
     */
    throw new Error(
      t('Ohne Verschlüsselung (http://) geht das nur zu einem Server auf diesem Rechner. Über eine Leitung ginge Ihr Kennwort im Klartext – tragen Sie https:// ein.'),
    );
  }

  return zerlegt.origin;
}

function istEigenerRechner(rechner: string): boolean {
  const name = rechner.toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

/**
 * Klopft an und sieht nach, ob dort wirklich ein Energy Mail steht.
 *
 * Gefragt wird der Gesundheitsweg - der einzige, der ohne Anmeldung antwortet und dabei
 * nichts über den Bestand verrät. Er nennt die Fassung, und die steht danach im
 * Einrichtungsfenster: Wer sich vertippt hat und bei einem fremden Dienst landet, sieht
 * es daran sofort.
 *
 * `net` von Electron statt `fetch`: Es geht durch die Proxy-Einstellungen des Systems,
 * die in einem Firmennetz über eine Richtlinie gesetzt sind - und es kennt den
 * Zertifikatsspeicher von Windows. Ein `fetch` aus Node sieht beides nicht und
 * scheiterte an genau den Aufstellungen, für die dieses Programm gebaut ist.
 */
export async function pruefeServer(eingabe: string): Promise<Serverbefund> {
  let adresse: string;
  try {
    adresse = normalisiereServer(eingabe);
  } catch (err) {
    return { ok: false, fehler: (err as Error).message };
  }

  return new Promise<Serverbefund>((fertig) => {
    const anfrage = net.request({ method: 'GET', url: `${adresse}/gesundheit` });

    /*
     * Eine Frist, und zwar eine kurze.
     *
     * Ohne sie steht ein Mensch vor einem Fenster, in dem sich nichts tut - bei einer
     * Adresse, die es gar nicht gibt, wartet das Betriebssystem je nach Netz eine halbe
     * Minute. Zehn Sekunden sind reichlich für eine Antwort, die aus einer Zeile besteht.
     */
    const uhr = setTimeout(() => {
      anfrage.abort();
      fertig({
        ok: false,
        fehler: t('Der Server antwortet nicht. Stimmt die Adresse, und ist der Rechner erreichbar?'),
      });
    }, 10_000);

    anfrage.on('response', (antwort) => {
      const teile: Buffer[] = [];
      antwort.on('data', (stueck) => teile.push(Buffer.from(stueck)));
      antwort.on('end', () => {
        clearTimeout(uhr);
        if (antwort.statusCode !== 200) {
          fertig({
            ok: false,
            fehler: t('Dort antwortet etwas, aber kein Energy Mail (Status {status}).', {
              status: String(antwort.statusCode),
            }),
          });
          return;
        }
        try {
          const inhalt = JSON.parse(Buffer.concat(teile).toString('utf-8')) as {
            ok?: boolean;
            fassung?: string;
          };
          /*
           * Auf `ok` geprüft und nicht nur auf "es kam JSON zurück".
           *
           * Der Gesundheitsweg antwortet mit 503, wenn der Datenordner nicht beschreibbar
           * ist - dann läuft dort zwar ein Energy Mail, aber eines, das nichts sichern
           * kann. Sich damit zu verbinden hieße, den Fehler erst beim ersten Speichern zu
           * bemerken.
           */
          if (inhalt?.ok !== true) {
            fertig({ ok: false, fehler: t('Der Server meldet, dass er gerade nicht arbeiten kann.') });
            return;
          }
          fertig({ ok: true, adresse, fassung: inhalt.fassung ?? '' });
        } catch {
          fertig({
            ok: false,
            fehler: t('Dort antwortet etwas, aber kein Energy Mail.'),
          });
        }
      });
    });

    anfrage.on('error', (err) => {
      clearTimeout(uhr);
      fertig({
        ok: false,
        /*
         * Die Meldung des Systems kommt mit. Sie ist unschön, aber sie ist das Einzige,
         * was zwischen "Name nicht auflösbar", "Verbindung verweigert" und "Zertifikat
         * abgelehnt" unterscheidet - und das sind drei ganz verschiedene Ursachen.
         */
        fehler: t('Keine Verbindung: {grund}', { grund: err.message }),
      });
    });

    anfrage.end();
  });
}
