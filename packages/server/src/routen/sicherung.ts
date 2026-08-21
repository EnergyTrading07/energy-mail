import type { FastifyInstance } from 'fastify';
import {
  buildPasswordAccount,
  listAccounts,
  saveAccount,
  setAuthExpired,
  updateAccountSettings,
} from '../accountStore.js';
import { listeKontakte, speichereKontakt } from '../contactStore.js';
import { alleEtiketten, speichereEtikett } from '../etikettenStore.js';
import { alleSuchen, speichereSuche } from '../gespeicherteSuchen.js';
import { ablageGroesse, leereAblage } from '../lokaleAblage.js';
import { regelSpeichern, regelnFuer } from '../rules.js';
import {
  SICHERUNG_FASSUNG,
  hinweis as sicherungsHinweis,
  nurNeue,
  ohneGeheimnisse,
  pruefeSicherung,
} from '../sicherung.js';
import { syncWatchers } from '../watcherRegistry.js';
import { HttpError } from './fehler.js';

/**
 * Sicherung der Einstellungen und der zwischengespeicherte Nachrichtenbestand.
 *
 * Beides betrifft nicht das Postfach, sondern das, was auf DIESER Platte liegt: was
 * mitkommt, wenn man den Rechner wechselt, und was sich wegraeumen laesst. Die Antwort
 * darauf, welche Datei wichtig ist, steht in sicherung.ts - mit Begruendung je Datei.
 */
export function registriereSicherung(app: FastifyInstance): void {
  /*
   * Der zwischengespeicherte Nachrichtenbestand - nachsehen und wegwerfen.
   *
   * Die beiden Wege gehören zusammen und beantworten eine Frage, auf die die Anwendung
   * bisher keine Antwort hatte: was liegt eigentlich auf dieser Platte, und wie werde ich
   * es wieder los? Verschlüsselt sind die Zugangsdaten, nicht der Nachrichtenbestand -
   * wer an einem entsperrten Rechner sitzt, kann ihn lesen. Solange das so ist, gehört
   * zumindest ein Knopf dazu, der ihn wegräumt.
   */
  app.get('/ablage', async () => ablageGroesse());

  app.delete('/ablage', async () => leereAblage());

  /*
   * Sicherung der Einstellungen.
   *
   * Im Benutzerordner liegen zwoelf Dateien, und wer den Rechner wechselt, weiss nicht,
   * welche davon er braucht: die 4,3 MB grosse ablage.db sieht wichtig aus und ist es
   * nicht, die 48 Byte kleine regeln.json sieht nach nichts aus und enthaelt Arbeit von
   * Stunden. Was mitkommt und was nicht, steht in sicherung.ts - mit Begruendung.
   */
  app.get('/sicherung', async () => {
    const konten = listAccounts();
    const regeln: Record<string, unknown[]> = {};
    for (const k of konten) {
      const eigene = regelnFuer(k.id);
      if (eigene.length > 0) regeln[k.email] = eigene;
    }
    return {
      fassung: SICHERUNG_FASSUNG,
      erstelltAm: new Date().toISOString(),
      programm: 'Energy Mail',
      konten: konten.map(ohneGeheimnisse),
      etiketten: alleEtiketten(),
      // Regeln haengen am Konto, aber dessen Kennung wird auf dem neuen Rechner eine
      // andere sein - deshalb ueber die Adresse zugeordnet.
      regeln,
      /*
       * Auch die nebenbei aufgelesenen Adressen.
       *
       * Zuerst hatte ich nur die gepflegten genommen - mit dem Gedanken, die anderen
       * bauten sich von selbst wieder auf. Gemessen waren das 269 gegen 0: die
       * Vervollstaendigung waere auf dem neuen Rechner leer, und zwar so lange, bis
       * wieder hunderte Nachrichten gelesen sind. Das ist ein spuerbarer Verlust fuer
       * eine Ersparnis von wenigen Kilobyte.
       *
       * Dafuer enthaelt die Datei nun Mailadressen, und der Hinweis beim Sichern sagt
       * das auch - statt Unbedenklichkeit zu versprechen, die nicht mehr gilt.
       */
      kontakte: listeKontakte({ limit: 100_000, auchAufgelesene: true }).eintraege,
      suchen: alleSuchen(),
      hinweis: sicherungsHinweis(),
    };
  });

  app.post<{ Body: unknown }>('/sicherung', async (request) => {
    const gepruef = pruefeSicherung(request.body);
    if (!gepruef.ok) throw new HttpError(400, gepruef.grund);
    const daten = gepruef.daten;

    const bericht = {
      konten: { uebernommen: 0, schonDa: 0, uebergangen: gepruef.uebergangen.konten ?? 0 },
      etiketten: { uebernommen: 0, schonDa: 0, uebergangen: gepruef.uebergangen.etiketten ?? 0 },
      kontakte: { uebernommen: 0, schonDa: 0, uebergangen: gepruef.uebergangen.kontakte ?? 0 },
      suchen: { uebernommen: 0, schonDa: 0, uebergangen: gepruef.uebergangen.suchen ?? 0 },
      regeln: { uebernommen: 0 },
      /** Was im Einzelnen nicht ging - der Nutzer soll es benennen können. */
      hinweise: [] as string[],
    };

    /*
     * Jeder Eintrag für sich.
     *
     * Vorher lief die ganze Schleife ungeschützt: warf ein einziger Eintrag - ein Konto,
     * zu dem sich keine Serveradressen ermitteln ließen, ein Kontakt ohne "@" -, brach
     * die Route mit 500 ab. Der Nutzer hatte danach die halbe Sicherung eingelesen und
     * erfuhr nicht, welche Hälfte. Jetzt wird der einzelne Fehlschlag vermerkt, und der
     * Rest kommt an.
     */
    function versuche(was: string, tue: () => void): boolean {
      try {
        tue();
        return true;
      } catch (err) {
        bericht.hinweise.push(`${was}: ${(err as Error).message}`);
        app.log.warn(`Sicherung einlesen - ${was}: ${(err as Error).message}`);
        return false;
      }
    }

    /*
     * Konten ohne Zugangsdaten: sie stehen danach in der Liste und sind gekennzeichnet,
     * bis sie einmal angemeldet wurden. Das ist besser, als sie wegzulassen - so sieht
     * der Nutzer, was ihn erwartet, statt jedes Konto von Hand nachzubauen.
     */
    const vorhandeneKonten = listAccounts();
    const neueKonten = nurNeue(
      vorhandeneKonten.map((k) => k.email),
      daten.konten,
      (k) => k.email,
    );
    bericht.konten.schonDa = neueKonten.schonDa;
    for (const k of neueKonten.neue) {
      versuche(`Konto ${k.email}`, () => {
        const angelegt = buildPasswordAccount({
          email: k.email,
          password: '',
          overrides: {
            imapHost: k.imapHost,
            imapPort: k.imapPort,
            imapSecure: k.imapSecure,
            smtpHost: k.smtpHost,
            smtpPort: k.smtpPort,
            smtpSecure: k.smtpSecure,
          },
        });
        saveAccount({ ...angelegt, displayName: k.displayName, signature: k.signature } as never);
        if (Array.isArray(k.identitaeten)) {
          updateAccountSettings(angelegt.id, { identitaeten: k.identitaeten } as never);
        }
        // Ohne Zugangsdaten kommt das Konto nirgendwohin - der Nutzer wird zum Anmelden
        // aufgefordert, wie nach einer abgelaufenen Marke.
        setAuthExpired(angelegt.id, true);

        const ausSicherung = daten.regeln?.[k.email];
        if (Array.isArray(ausSicherung)) {
          for (const regel of ausSicherung) {
            if (!regel || typeof regel !== 'object') continue;
            if (versuche(`Regel in ${k.email}`, () => regelSpeichern(angelegt.id, regel as never))) {
              bericht.regeln.uebernommen++;
            }
          }
        }
        bericht.konten.uebernommen++;
      });
    }

    const neueEtiketten = nurNeue(
      alleEtiketten().map((e) => e.name),
      daten.etiketten as { name: string }[],
      (e) => e.name,
    );
    bericht.etiketten.schonDa = neueEtiketten.schonDa;
    for (const e of neueEtiketten.neue) {
      if (versuche(`Etikett "${e.name}"`, () => speichereEtikett(e as never))) {
        bericht.etiketten.uebernommen++;
      }
    }

    const neueKontakte = nurNeue(
      listeKontakte({ limit: 100_000, auchAufgelesene: true }).eintraege.map((k) => k.address),
      daten.kontakte as { address: string }[],
      (k) => k.address,
    );
    bericht.kontakte.schonDa = neueKontakte.schonDa;
    for (const k of neueKontakte.neue) {
      if (versuche(`Kontakt ${k.address}`, () => speichereKontakt(k as never))) {
        bericht.kontakte.uebernommen++;
      }
    }

    const neueSuchen = nurNeue(
      alleSuchen().map((s2) => s2.name),
      daten.suchen as { name: string }[],
      (s2) => s2.name,
    );
    bericht.suchen.schonDa = neueSuchen.schonDa;
    for (const s2 of neueSuchen.neue) {
      if (versuche(`Suche "${s2.name}"`, () => speichereSuche(s2 as never))) {
        bericht.suchen.uebernommen++;
      }
    }

    syncWatchers();
    return bericht;
  });
}
