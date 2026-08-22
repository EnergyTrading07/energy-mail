import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import websocketPlugin from '@fastify/websocket';
import {
  GESUNDHEITS_PFAD,
  ZUGANG_KOPFZEILE,
  geheimnisAusAnfrage,
  holeZugangsgeheimnis,
  registriereZugangspruefung,
} from './zugang.js';
import { getWurzelDir } from './paths.js';
import { registriereAdressbuch } from './routen/adressbuch.js';
import { registriereArchiv } from './routen/archiv.js';
import { requireAccount, uidAus, zahlAus } from './routen/gemeinsam.js';
import { registriereSchluessel } from './routen/schluessel.js';
import { registriereSicherung } from './routen/sicherung.js';
import { registriereEtikettenUndSuchen } from './routen/etikettenUndSuchen.js';
import { HttpError } from './routen/fehler.js';
import {
  alleNutzer,
  findeNutzer,
  istGesperrt,
  istVerwalter,
  stelleVerwalterSicher,
} from './nutzer/nutzerStore.js';
import { KEKS_NAME, registriereAnmeldung, ueberTls } from './nutzer/anmelden.js';
import { nutzerZurSitzung, sitzungsstand } from './nutzer/sitzung.js';
import {
  EINPLATZ_NUTZER,
  aktuellerNutzer,
  alsNutzer,
  handelnderNutzer,
  vertretungFuer,
} from './nutzer/kontext.js';
import { registriereNutzerkontext, type NutzerErmitteln } from './nutzer/haken.js';
import { registriereVerwaltung } from './nutzer/verwaltung.js';
import { registriereSelbstregistrierung } from './nutzer/registrierung.js';
import { wendeNetzzielRegelAn } from './nutzer/registrierungSpeicher.js';
import { registriereKennwortVergessen } from './nutzer/kennwortVergessen.js';
import { registriereDownload, registriereDownloadVerwaltung } from './download.js';
import { registriereZweiFaktor } from './nutzer/zweiFaktor.js';
import {
  FreigabeFehler,
  eigeneFreigaben,
  entferneFreigabe,
  erhalteneFreigaben,
  freigabenZuKonto,
  legeFreigabeAn,
  type Recht,
} from './nutzer/freigaben.js';
import { registriereFreigabeWechsel } from './nutzer/freigabeHaken.js';
import { protokolliere } from './protokollDatei.js';
import {
  entscheidungZu,
  merkeEntscheidung,
  nachrichtenSchluessel as bestaetigungsSchluessel,
  pruefeBestaetigung,
  setzeUmgang,
  umgangFuer,
  umgangVerwerfen,
  verschickeBestaetigung,
} from './lesebestaetigung.js';
import { registriereSprachkontext } from './sprachkontext.js';
import { ladeAlle } from '@energy-mail/mail-core/sprachen';
import { ziehePerBestandUm } from './nutzer/umzug.js';
import { richteUmschlagEin, stelleEinplatznutzerSicher } from './nutzer/einrichten.js';
import { isEncryptionAvailable as istVerschluesselungVerfuegbar } from './secretCrypto.js';
import {
  ATTACHMENT_SEARCH_UNSUPPORTED,
  CATEGORY_UNSUPPORTED,
  GMAIL_CATEGORIES,
  closeAllConnections,
  closeConnection,
  createFolder,
  deleteFolder,
  deleteMessages,
  emptyFolder,
  markFolderSeen,
  renameFolder,
  discardDraft,
  downloadAttachment,
  bestimmeAbmeldung,
  findSpecialFolder,
  getCapabilities,
  getMailScope,
  getMessage,
  getProviderId,
  hasMailScope,
  isReauthRequired,
  leseAbmeldeWege,
  listCategories,
  listFolders,
  listMessages,
  moveMessages,
  sendeEinKlickAbmeldung,
  dateiname,
  exportiereAlsMbox,
  findeEinstellungen,
  getProviderPreset,
  getRawMessage,
  offeneVorgaenge,
  baueAntwort,
  baueSigniertenTeil,
  SmimeBezeichner,
  alsBytes,
  baueSignierteDaten,
  baueSigniertePost,
  baueUmschlag,
  besteVerschluesselung,
  signiereAbgetrennt,
  verschluessle,
  pruefeEtikettenUnterstuetzung,
  senderUebersicht,
  setzeEtiketten,
  verschiebeVonAbsender,
  saveDraft,
  searchFolders,
  searchMessages,
  sendMessage,
  setMessagesSeen,
  verifyImapConnection,
  verifySmtpConnection,
  type AccountConfig,
  type Identitaet,
  type GmailCategory,
  type OAuthProviderId,
  type OutgoingMessage,
  type Regel,
  type RegelBedingung,
  type Antwort,
  type SearchCriteria,
  fuerAnzeige,
  leseProxyadresse,
} from '@energy-mail/mail-core';
import Fastify from 'fastify';
import {
  buildOAuthAccount,
  buildPasswordAccount,
  deleteAccount,
  getAccount,
  listAccounts,
  saveAccount,
  updateAccountAuth,
  updateAccountSettings,
} from './accountStore.js';
import {
  ausSpeicherOderHolen,
  schluessel,
  schreibeAlleSofort as schreibeAlleCachesSofort,
  verwerfe,
  verwerfeKonto,
} from './cache.js';
import {
  WIEDERVORLAGE_ORDNER,
  ladeWiedervorlagen,
  listeWiedervorlagen,
  setWiedervorlageUmgebung,
  sofortZurueck,
  stelleZurueck,
  verwerfeKontoWiedervorlagen,
} from './snooze.js';
import {
  ladeGeplanteSendungen,
  listeGeplanteSendungen,
  planeSendung,
  setAufgabeVerfahren,
  setSendeVerfahren,
  storniereSendung,
  verwerfeKontoSendungen,
  type GeplanteSendung,
} from './sendQueue.js';
import {
  abwesenheitFuer,
  abwesenheitVerwerfen,
  aktiveAbwesenheiten,
  setzeAbwesenheit,
  type Abwesenheit,
} from './abwesenheit.js';
import {
  istBrauchbar,
  passt,
  regelLoeschen,
  regelSpeichern,
  regelnFuer,
  regelnVerwerfen,
  wendeRegelnAn,
} from './rules.js';
import {
  geheimeFuer,
  oeffentlicheFuer,
} from './schluesselbund.js';
import { erfasseVersand } from './archiv/erfassen.js';
import {
  eigeneFuer,
  zertifikateFuer,
} from './smimeStore.js';
import {
  holeGesamtPosteingang,
  markeAlsText,
  markeAusText,
} from './gesamtPosteingang.js';
import {
  merkeAusListe,
  rememberAddresses,
} from './contactStore.js';
import { istVerbindungsfehler } from './verbindungsfehler.js';
import {
  anzahlAbgelegt,
  holeInhalt,
  holeSeite,
  merkeInhalt,
  merkeKopfdaten,
  pruefeUidGueltigkeit,
  schliesseAlleAblagen,
  setzeGelesen as ablageGelesen,
  entferneNachrichten as ablageEntfernen,
  suchbestand,
  sucheLokal,
  sucheVerfuegbar,
  verwerfeKontoAblage,
} from './lokaleAblage.js';
import {
  istVertraut,
  vertrauenEntziehen,
  vertrauenGeben,
  vertrauenVerwerfen,
  vertrauteAbsender,
} from './trustedSenders.js';
import {
  aktualisiereGelesen,
  liesNachricht,
  merkeNachricht,
  nachrichtenSchluessel,
  verwirfNachrichten,
} from './messageCache.js';
import { clearFlow, getFlow, startOAuthFlow } from './oauthFlow.js';
import {
  istVorgegeben,
  listOAuthClients,
  removeOAuthClient,
  setOAuthClient,
} from './oauthStore.js';
import { installTokenRefresh } from './tokenRefresh.js';
import { fastifyProtokollZiel } from './protokollDatei.js';
import {
  meldeAktualisierung,
  meldeFortschritt,
  meldeAnsicht,
  restartWatcher,
  setRegistryLogger,
  stopAllWatchers,
  subscribe,
  syncWatchers,
} from './watcherRegistry.js';
import { t } from '@energy-mail/mail-core/sprache';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Liegt sowohl von src/ (tsx) als auch von dist/ aus eine Ebene unter packages/server.
const webDistDir = path.join(__dirname, '..', '..', 'web', 'dist');

/**
 * Fastify erlaubt standardmäßig nur 1 MB Anfragekörper - damit wäre schon ein kleiner
 * Anhang nicht versendbar. Base64 bläht Dateien um rund ein Drittel auf, 40 MB Limit
 * entsprechen also etwa 30 MB tatsächlicher Anhangsgröße.
 */
const BODY_LIMIT_BYTES = 40 * 1024 * 1024;

/**
 * Wie weit sich ein Versand höchstens vorausplanen lässt.
 *
 * Eine Obergrenze, keine Meinung darüber, was sinnvoll ist: Ein vertipptes Jahr ("2205"
 * statt "2025") ergäbe einen Eintrag, der die Warteschlangendatei für alle Zeit begleitet
 * und bei jedem Start neu eingeplant wird. Fünf Jahre sind großzügig über allem, was
 * jemand ernsthaft vorausplant.
 */
const FUENF_JAHRE_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/**
 * Die Meldung für die verbliebene Grenze beim geschützten Versand.
 *
 * Als Funktion und nicht als Konstante, und das hat zwei Gründe: Die Übersetzung muss zum
 * Zeitpunkt der Anfrage geschehen (die Sprache gehört zur Anfrage, nicht zum Programm),
 * und der Textsammler für die Kataloge verlangt das Literal unmittelbar in `t(` - eine
 * Variable dort hineinzureichen hieße, dass dieser Satz in keinem Katalog landet und
 * überall deutsch stehen bliebe. Dasselbe Muster wie bei VORGEGEBEN weiter unten.
 */
const ANHANG_NUR_SIGNIERT = () =>
  t(
    'Verschlüsselte Nachrichten können noch keine Anhänge tragen. Unterschreiben geht mit Anhang; zum Verschlüsseln bitte ohne senden.',
  );

function publicAccount(account: AccountConfig) {
  // Zugangsdaten bleiben bewusst draußen - nach außen nur, was die Oberfläche braucht.
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    signature: account.signature,
    identitaeten: account.identitaeten ?? [],
    /*
     * Der Proxy OHNE Anmeldung.
     *
     * Er geht in die Oberfläche, damit dort steht, was eingetragen ist - aber ein
     * Proxy-Kennwort ist in Firmen oft das Windows-Kennwort, und die Antwort dieser Route
     * landet im Browserspeicher, in Entwicklerwerkzeugen und womöglich in einem
     * Mitschnitt. Wer den Proxy ändern will, trägt ihn neu ein.
     */
    proxy: fuerAnzeige(account.proxy) === 'direkt' ? undefined : fuerAnzeige(account.proxy),
    // Bestimmt Farbgebung und anbietereigene Aktionen in der Oberfläche.
    provider: getProviderId(
      account.email,
      account.auth.type === 'oauth2' ? account.auth.provider : undefined,
    ),
    // Nur OAuth-Konten lassen sich neu anmelden; bei Passwort-Konten wäre der Knopf
    // sinnlos, dort ändert man das Passwort in den Einstellungen.
    canReauth: account.auth.type === 'oauth2',
    needsReauth: Boolean(account.authExpired),
  };
}

export type ServerOptionen = {
  /**
   * Der Port, unter dem der Server erreichbar sein wird. Der Herkunftsriegel in
   * zugang.ts braucht ihn, um die eigene Origin von einer fremden zu unterscheiden.
   */
  port?: number;
  /**
   * Für welchen Nutzer eine Anfrage arbeitet.
   *
   * Im Desktop-Betrieb immer derselbe ("lokal") - ein Rechner, ein Mensch. Sobald es
   * eine Anmeldung gibt (Stufe 2), liest diese Funktion den Nutzer aus der Sitzung; der
   * übrige Server merkt davon nichts. Ohne Angabe gilt der Einplatzbetrieb.
   */
  nutzerErmitteln?: NutzerErmitteln;
  /**
   * Ob den Kopfzeilen eines vorgelagerten Proxys geglaubt wird (X-Forwarded-For und
   * Verwandte). `false` im Desktop-Betrieb - dort steht nichts davor. Siehe index.ts.
   */
  proxyVertrauen?: boolean | number | string;
  /**
   * Ob der Vite-Entwicklungsserver auf 5173 mitreden darf (CORS).
   *
   * Ausdrücklich vom Aufrufer und nicht mehr hier erraten. Vorher lautete die Bedingung
   * "es gibt kein gebautes Frontend" - damit hing eine Sicherheitseinstellung daran, ob
   * ein Bau geglückt ist. Ein halb durchgelaufenes `npm run build` im Betrieb oder ein
   * falsch eingehängter Ordner im Container, und der Dienst nahm Anfragen mit
   * Zugangsdaten von localhost:5173 entgegen. Die Desktop-Hülle setzt es nie: sie
   * liefert die Oberfläche selbst aus.
   */
  viteErlauben?: boolean;
};

/**
 * Der Nutzer, unter dem der Einplatzbetrieb läuft.
 *
 * Steht seit dem Rollenbegriff in nutzer/kontext.ts und wird hier nur weitergereicht:
 * Auch das Befehlszeilenwerkzeug muss ihn kennen (es darf ihm keine Verwalterrolle
 * geben), und um dafür app.ts einzubinden, müsste es den ganzen Server laden.
 */
export { EINPLATZ_NUTZER } from './nutzer/kontext.js';

/**
 * Der Name des Sitzungskekses - fuer die Huelle.
 *
 * Sie braucht ihn, seit sie ein Fenster auf einen Server ist: Ihre beiden Menuepunkte
 * "Einstellungen sichern" und "Sicherung einlesen" rufen Routen des Servers, und die
 * haengen hinter der Anmeldung. Der Keks steckt in der Sitzung des Fensters; der
 * Hauptprozess holt ihn dort heraus und schickt ihn mit (siehe diagnose.ts).
 *
 * Weitergereicht und nicht abgeschrieben: Ein zweiter Name neben dem ersten geht genau so
 * lange gut, bis einer von beiden geaendert wird.
 */
export { KEKS_NAME } from './nutzer/anmelden.js';

/**
 * Führt etwas im Namen des Einplatznutzers aus - für die Desktop-Hülle.
 *
 * Sie ruft Speicher unmittelbar auf, außerhalb jeder HTTP-Anfrage: beim Beenden
 * (Kontakte schreiben, Wartendes versenden) und nach dem Standby (Überwachung neu
 * aufsetzen). Alle diese Wege gehen durch den Nutzerkontext, und ohne ihn werfen sie -
 * was in der Hülle nicht als Fehlermeldung ankam, sondern als Absturzfenster beim
 * Aufwachen und als stillschweigend übersprungenes Herunterfahren.
 *
 * Bewusst hier und nicht als roher alsNutzer()-Zugang: die Hülle hat genau einen
 * Menschen und soll von der Nutzerverwaltung nichts wissen müssen. Sie sagt "das hier
 * gehört dem Einplatznutzer" und nicht "dieser Ausführungsstrang gehört Kennung X".
 */
export function alsEinplatznutzer<T>(fn: () => T): T {
  return alsNutzer(EINPLATZ_NUTZER, fn);
}

export async function buildServer(optionen: ServerOptionen = {}) {
  const port = optionen.port ?? 4000;
  /**
   * Wie der Nutzer einer Anfrage bestimmt wird.
   *
   * Zwei Wege, und sie schließen sich nicht aus:
   *
   *  - Die Desktop-Hülle weist sich mit dem Zugangsgeheimnis des Prozesses aus. Es kennt
   *    nur ihr eigenes Fenster, und es gibt dort genau einen Menschen - eine Anmeldung
   *    wäre eine Hürde ohne Gegenwert.
   *  - Im Serverbetrieb ist kein Zugangsgeheimnis gesetzt; dann entscheidet die Sitzung
   *    aus dem Keks.
   *
   * Der Aufrufer kann beides übergehen (die Prüfungen tun das).
   */
  const nutzerErmitteln: NutzerErmitteln =
    optionen.nutzerErmitteln ??
    ((request) => {
      const geheimnis = holeZugangsgeheimnis();
      if (geheimnis && geheimnisAusAnfrage(request) === geheimnis) return EINPLATZ_NUTZER;
      return nutzerZurSitzung(request.cookies?.[KEKS_NAME]);
    });
  /*
   * Das Protokoll geht zusaetzlich in eine Datei.
   *
   * Nach stdout allein sieht es in der ausgelieferten Anwendung niemand - sagt dort
   * jemand "es geht nicht", gaebe es nichts zum Nachsehen. Das Ziel schreibt weiterhin
   * nach stdout und zusaetzlich in den Benutzerordner; alles geht vorher durch die
   * Reinigung in protokoll.ts.
   */
  const app = Fastify({
    logger: { stream: fastifyProtokollZiel() },
    bodyLimit: BODY_LIMIT_BYTES,
    /*
     * Voreinstellung false: im Desktop-Betrieb steht nichts vor dem Server, und wer den
     * Kopfzeilen dort glaubte, ließe sich von jedem Absender eine beliebige Herkunft
     * vorschreiben. Im Serverbetrieb setzt index.ts den Wert bewusst.
     */
    trustProxy: optionen.proxyVertrauen ?? false,
  });

  /*
   * Sicherheitskopfzeilen - von der Anwendung selbst, nicht vom Vorbau.
   *
   * Bisher gab es sie nur im Caddyfile. Das genügt nicht, und zwar aus zwei Gründen:
   * der Desktop-Betrieb hat gar keinen Vorbau, und wer statt Caddy einen nginx
   * davorstellt (der eingespielte Weg auf dem Zielrechner), muss die Liste von Hand
   * nachbauen - eine vergessene Zeile fällt niemandem auf.
   *
   * frame-ancestors ist der Anlass. Es steht zwar in der Richtlinie in index.html, aber
   * dort ist es WIRKUNGSLOS: der Browser ignoriert frame-ancestors, report-uri und
   * sandbox, wenn die Richtlinie aus einem <meta>-Element stammt - sie müssen über eine
   * Kopfzeile kommen. Die Anwendung glaubte sich also gegen das Einbetten in eine fremde
   * Seite geschützt und war es nicht.
   *
   * Bewusst nur diese eine Richtlinien-Anweisung und nicht die ganze Richtlinie doppelt:
   * mehrere Richtlinien gelten nebeneinander, jede für sich. Eine zweite vollständige
   * Fassung hier hieße, sie bei jeder Änderung an zwei Stellen nachzuziehen - und die
   * strengere von beiden gewänne still.
   *
   * HSTS stand hier lange bewusst NICHT, mit der Begründung: der Server spricht http, die
   * Verschlüsselung endet am Vorbau, und wer sie von hier aus verspräche, verspräche
   * etwas, das er nicht hält. Der erste Teil stimmt, der Schluss war zu kurz gegriffen -
   * die Anwendung kann sehr wohl erkennen, ob die Anfrage über TLS hereinkam (dieselbe
   * Prüfung, mit der der Sitzungskeks sein "secure" bekommt). Nur dann geht die Kopfzeile
   * hinaus, und dann ist sie keine Behauptung, sondern eine Feststellung.
   *
   * Der Anlass ist der Firmenbetrieb: eine Anwendung ohne HSTS fällt in jeder
   * Sicherheitsprüfung auf, und ohne sie genügt ein einziger Aufruf über http, um die
   * Sitzung im Klartext mitlesen zu lassen.
   */
  app.addHook('onSend', async (request, reply) => {
    /*
     * Ein halbes Jahr, ohne Unterdomänen und ohne "preload".
     *
     * Beides bewusst: Unterdomänen gehören womöglich jemand anderem, und "preload" trägt
     * die Adresse in eine Liste ein, aus der sie über Monate nicht wieder herauskommt -
     * eine Entscheidung, die der Betreiber selbst treffen soll und nicht dieses Programm
     * für ihn.
     */
    if (ueberTls(request)) {
      reply.header('strict-transport-security', 'max-age=15552000');
    }
    // Diese Seite gehört in kein fremdes Fenster. X-Frame-Options daneben für alles,
    // was frame-ancestors noch nicht auswertet.
    reply.header('content-security-policy', "frame-ancestors 'none'");
    reply.header('x-frame-options', 'DENY');
    /*
     * Kein Erraten des Inhaltstyps.
     *
     * Wichtig vor allem beim Anhang-Abruf: dessen Content-Type stammt aus der Kopfzeile
     * der Mail, wird also vom Absender bestimmt. Content-Disposition: attachment hält
     * den Browser schon davon ab, ihn anzuzeigen - nosniff nimmt ihm zusätzlich die
     * Möglichkeit, sich den Typ selbst auszudenken.
     */
    reply.header('x-content-type-options', 'nosniff');
    // Adressen dieser Anwendung tragen Kontokennungen und Ordnernamen - die gehen keinen
    // fremden Server etwas an.
    reply.header('referrer-policy', 'no-referrer');
  });

  /*
   * CORS nur fuer den Entwicklungsbetrieb, und dort mit benannter Herkunft.
   *
   * Vorher stand hier `{ origin: true }` - das spiegelt JEDE Origin zurueck und erlaubt
   * damit jeder beliebigen Webseite, die Antworten dieses Servers zu lesen. Paketiert
   * wird die Oberflaeche vom selben Server ausgeliefert; dort ist CORS schlicht
   * ueberfluessig. Gebraucht wird es nur, solange Vite auf 5173 laeuft.
   *
   * Wann das gilt, entscheidet der Aufrufer - siehe ServerOptionen.viteErlauben. Ein
   * fehlender dist-Ordner ist ein Unfall und kein Entwicklungsbetrieb.
   */
  if (optionen.viteErlauben) {
    await app.register(cors, {
      origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
      allowedHeaders: ['content-type', ZUGANG_KOPFZEILE],
    });
  }

  /*
   * Bestandsdaten in den Nutzerordner holen - vor allem anderen.
   *
   * Muss vor dem ersten Speicherzugriff laufen, und das ist beim Aufbau der Watcher der
   * Fall. Ohne den Umzug fände eine bestehende Installation nach der Aktualisierung
   * nichts wieder: keine Konten, kein Adressbuch, keine Regeln.
   */
  const umzug = ziehePerBestandUm(EINPLATZ_NUTZER);
  if (umzug.verschoben.length > 0) {
    app.log.info(
      `Bestandsdaten nach nutzer/${EINPLATZ_NUTZER}/ verschoben: ${umzug.verschoben.join(', ')}`,
    );
  }
  for (const problem of umzug.probleme) app.log.warn(`Umzug: ${problem}`);

  /*
   * Nutzereintrag und Umschlagverschlüsselung - in dieser Reihenfolge.
   *
   * Der Eintrag muss zuerst da sein: dort liegt der Schlüssel des Nutzers, und ihn
   * anzulegen braucht den Masterschlüssel (den die Hülle vor buildServer() gesetzt hat).
   * Erst danach darf der Umschlag eingehängt werden - sonst versuchte schon das Verpacken
   * des Nutzerschlüssels, durch den Umschlag zu gehen, den es noch nicht gibt.
   *
   * Ohne eingerichtete Verschlüsselung wird beides übersprungen. Das ist kein Notbehelf,
   * sondern der bestehende Zustand: der Standalone-Server ohne Masterschlüssel kann
   * ohnehin keine Konten lesen oder anlegen, und secretCrypto sagt das mit einer
   * verständlichen Meldung.
   */
  if (istVerschluesselungVerfuegbar()) {
    stelleEinplatznutzerSicher(EINPLATZ_NUTZER, `${EINPLATZ_NUTZER}@energy-mail.local`);
    /*
     * Es muss einen Verwalter geben - sonst ist die Verwaltung für niemanden erreichbar.
     *
     * Trifft vor allem bestehende Aufstellungen: In deren nutzer.json steht keine Rolle,
     * und ohne diesen Schritt hätte nach der Aktualisierung niemand Rechte. Der Pseudo-
     * Nutzer der Hülle ist ausgenommen - siehe stelleVerwalterSicher.
     */
    stelleVerwalterSicher(EINPLATZ_NUTZER);
    richteUmschlagEin();
  } else {
    app.log.warn(
      'Keine Verschlüsselung eingerichtet - Konten lassen sich weder lesen noch anlegen.',
    );
  }

  // Muss vor allem stehen, was Kekse liest - also vor der Anmeldung und dem Kontext.
  await app.register(cookie);

  /*
   * Die Sprache je Anfrage - VOR der Zugangspruefung, und das ist der Punkt.
   *
   * Hier stand dieser Aufruf zweihundert Zeilen weiter unten, hinter Zugangspruefung und
   * Nutzerkontext. Fastify ruft die onRequest-Haken in der Reihenfolge ihrer Anmeldung -
   * die Eingangskontrolle lief also AUSSERHALB des Sprachkontexts, und ihre beiden
   * Meldungen ("Kein Zugang", "Anfrage aus fremder Herkunft") kamen deutsch heraus, ganz
   * gleich was der Browser verlangte. Uebersetzt waren sie laengst.
   *
   * Aufgefallen an der laufenden Anwendung, nicht in einer Pruefung: Beide Meldungen
   * kommen nur zustande, wenn die Anfrage abgewiesen wird - und die Pruefungen fragen
   * ordnungsgemaess an. Der Kommentar in sprachkontext.ts behauptete dabei genau das
   * Richtige ("vor allem anderen"); nur stand der Aufruf nicht dort, wo der Kommentar es
   * sagte. Eine Beschreibung, die der Anordnung widerspricht, ist schlimmer als keine.
   *
   * Nach `cookie` und nicht davor: Woher die Sprache eines Nutzers kaeme, entscheidet der
   * Nutzerspeicher; heute gibt es dort kein solches Feld, aber sobald es eines gibt, wird
   * es aus einem Keks kommen.
   *
   * Im Serverbetrieb bedient ein Prozess viele Menschen gleichzeitig; die Sprache gehoert
   * damit zur Anfrage und nicht zum Programm. Siehe sprachkontext.ts, dort steht auch,
   * warum eine Variable im Modul hier nicht bloss unsauber, sondern falsch waere.
   */
  registriereSprachkontext(app, () => undefined);

  /*
   * Und die Kataloge dazu - ALLE.
   *
   * Ohne diese Zeile war der ganze Aufbau darueber wirkungslos: Die Sprache je Anfrage
   * wurde ermittelt, t() stand an sechsundachtzig Stellen, und weil nie ein Katalog
   * hinterlegt war, fiel jede Meldung auf Deutsch zurueck - auch fuer einen Browser, der
   * ausdruecklich Englisch verlangte. Ein Fehler ohne Symptom: keine Ausnahme, keine
   * leere Stelle, nur weiterhin Deutsch.
   *
   * Alle statt nur einer, weil "die eine Sprache" hier die falsche Frage ist: Zwischen
   * zwei Anfragen liegt womoeglich ein anderer Mensch. Je Anfrage nachzuladen waere eine
   * Wartezeit mitten in der Antwort; alles beim Start kostet einmalig ein paar hundert
   * Kilobyte.
   *
   * Nicht abgewartet: Der Server soll horchen koennen, bevor die Kataloge da sind. Die
   * erste Anfrage in den ersten Millisekunden bekaeme sonst gar keine Antwort statt einer
   * deutschen.
   */
  void ladeAlle();

  registriereZugangspruefung(app, port);

  /*
   * Lebt der Dienst noch?
   *
   * Docker fragt das im Minutentakt; ohne eine solche Auskunft weiß der Container nur,
   * ob der Prozess läuft - und ein Prozess, der läuft, aber auf keine Anfrage mehr
   * antwortet, ist der häufigere Fall.
   *
   * Geprüft wird deshalb etwas, das tatsächlich schiefgehen kann: ob sich in den
   * Datenordner schreiben lässt. Ein volles Laufwerk oder eine Einbindung mit falschen
   * Rechten ist die Störung, die im Betrieb wirklich auftritt - und eine, bei der ein
   * bloßes "ok" lügen würde, weil der Dienst zwar antwortet, aber nichts mehr sichern
   * kann.
   *
   * Herausgegeben wird nichts, was jemanden angeht: keine Nutzer, keine Konten, keine
   * Zahlen über den Bestand.
   */
  const gestartet = Date.now();
  app.get(GESUNDHEITS_PFAD, async (_request, reply) => {
    const fassung = process.env.ENERGY_MAIL_FASSUNG ?? 'unbekannt';
    const laeuftSeit = Math.round((Date.now() - gestartet) / 1000);
    try {
      fs.accessSync(getWurzelDir(), fs.constants.W_OK);
    } catch (err) {
      app.log.error(`Gesundheitsprüfung: Datenordner nicht beschreibbar - ${(err as Error).message}`);
      return reply.code(503).send({
        ok: false,
        grund: t('Der Datenordner ist nicht beschreibbar.'),
        fassung,
        laeuftSeit,
      });
    }
    return { ok: true, fassung, laeuftSeit, verschluesselung: istVerschluesselungVerfuegbar() };
  });

  registriereAnmeldung(app, nutzerErmitteln);

  /*
   * Jede Anfrage bekommt einen Nutzer, bevor eine Route sie sieht.
   *
   * Ohne diesen Haken wirft jeder Speicherzugriff - siehe nutzer/kontext.ts. Das ist
   * Absicht: eine Stelle, die den Kontext zu setzen vergisst, soll laut scheitern statt
   * stillschweigend in fremden Daten zu landen.
   */
  /*
   * Die Sperre gilt nur dort, wo es eine Sitzung gibt.
   *
   * In der Hülle weist sich das Fenster mit dem Zugangsgeheimnis des Prozesses aus - kein
   * Keks, keine Sitzung, kein Kennwort. Dort etwas zu sperren, hieße etwas zu verschließen,
   * das niemand wieder aufmachen kann.
   */
  registriereNutzerkontext(app, nutzerErmitteln, (request) =>
    sitzungsstand(request.cookies?.[KEKS_NAME]).gesperrt,
  );

  /*
   * Der Wechsel in ein freigegebenes Postfach - unmittelbar nach dem Nutzerkontext.
   *
   * Die Reihenfolge ist auch hier der Kern: Er fragt, wer da ist, und muss den Kontext
   * vorfinden. Und er steht vor der Verwaltung, damit deren Riegel den HANDELNDEN prueft
   * und nicht den Eigentuemer eines gerade geoeffneten fremden Postfachs.
   */
  registriereFreigabeWechsel(app);

  /*
   * Die Verwaltung NACH dem Nutzerkontext - und die Reihenfolge ist der Kern der Sache.
   *
   * Fastify ruft die preHandler in der Reihenfolge ihrer Anmeldung. Der Riegel der
   * Verwaltung fragt, wer da ist; stünde er vor dem Kontext, gäbe es noch keinen, und die
   * Prüfung liefe ins Leere - dieselbe Falle, die schon einmal dafür gesorgt hat, dass die
   * Eingangskontrolle deutsch antwortete.
   */
  registriereVerwaltung(app);

  /*
   * Der zweite Faktor ebenfalls nach dem Kontext.
   *
   * Seine Wege liegen unter /ich/zweifaktor und sind bewusst NICHT in OFFENE_PFADE: Wer
   * ihn einrichtet oder abschaltet, ist bereits angemeldet. Der Weg für die zweite Stufe
   * der Anmeldung selbst steht dagegen in anmelden.ts - der muss ohne Sitzung erreichbar
   * sein, denn genau darum geht es dort.
   */
  registriereZweiFaktor(app);

  /*
   * Die Selbstregistrierung - offene Wege und Verwaltungswege in einer Datei.
   *
   * Hinter registriereVerwaltung, damit deren Riegel auch für die Wege unter
   * /verwaltung/registrierung gilt. Das ist keine Frage der Reihenfolge von Routen,
   * sondern der von preHandler-Haken: Fastify ruft sie in der Reihenfolge ihrer
   * Anmeldung, und der Riegel muss stehen, bevor die erste Anfrage kommt.
   *
   * Die drei offenen Wege darin (/registrierung, /registrierung/bestaetigen) stehen
   * ihrerseits in OFFENE_PFADE - ohne diesen Eintrag käme niemand daran vorbei, der noch
   * kein Konto hat, also genau die Menschen, für die sie da sind.
   */
  /*
   * Die Netzzielregel gilt ab dem Start - nicht erst nach der ersten Aenderung.
   *
   * Sonst haette ein Neustart den Riegel geloest: Die Einstellung staende weiter in der
   * Datei, aber der Kern wuesste nichts davon, und die erste IMAP-Verbindung ginge
   * wieder ueberallhin. Ein Schutz, der einen Neustart nicht ueberlebt, ist bei einem
   * Dienst, der woechentlich aktualisiert wird, keiner.
   */
  wendeNetzzielRegelAn();

  registriereSelbstregistrierung(app);

  /*
   * Der Weg zurueck bei einem vergessenen Kennwort - ebenfalls mit zwei offenen Wegen,
   * die in OFFENE_PFADE stehen muessen. Er setzt Kennwoerter und ruehrt den zweiten
   * Faktor ausdruecklich NICHT an; warum, steht im Kopf von kennwortVergessen.ts.
   */
  registriereKennwortVergessen(app);

  /*
   * Die Desktop-Fassung zum Herunterladen.
   *
   * Hinter der Anmeldung - die Wege stehen nicht in OFFENE_PFADE. Wer das Programm
   * braucht, hat ein Konto, sonst nuetzte es ihm nichts.
   */
  registriereDownload(app);
  registriereDownloadVerwaltung(app);

  /*
   * Geordnet zumachen.
   *
   * stopAllWatchers und schliesseAblage waren beide geschrieben und exportiert - nur
   * rief sie niemand. Die IMAP-Verbindungen der Überwachung (bis zu drei je Konto)
   * wurden beim Beenden ohne LOGOUT abgerissen; Anbieter halten die Sitzung danach noch
   * minutenlang, und GMX wie Gmail begrenzen die Zahl gleichzeitiger Verbindungen. Ein
   * schneller Neustart scheiterte dann an einer Meldung, die nach einem Serverproblem
   * aussah, aber vom eigenen Programm verursacht war. Die SQLite-Ablage blieb
   * ihrerseits mit -wal und -shm liegen.
   *
   * Der Haken hängt am Server statt an der Hülle, damit auch der Standalone-Betrieb und
   * die Prüfungen ihn bekommen - dort schließt app.close() jetzt genauso auf.
   */
  app.addHook('onClose', async () => {
    try {
      stopAllWatchers();
    } catch (err) {
      app.log.warn(`Überwachung ließ sich nicht sauber beenden: ${(err as Error).message}`);
    }
    try {
      closeAllConnections();
    } catch (err) {
      app.log.warn(`IMAP-Verbindungen ließen sich nicht schließen: ${(err as Error).message}`);
    }
    try {
      // Noch nicht geschriebener Zwischenspeicher - sonst kostet es beim nächsten Start
      // einen kalten Anlauf.
      schreibeAlleCachesSofort();
    } catch {
      // Der Zwischenspeicher ist entbehrlich; ein Fehler hier darf das Beenden nicht
      // aufhalten.
    }
    try {
      schliesseAlleAblagen();
    } catch (err) {
      app.log.warn(`Lokale Ablage ließ sich nicht schließen: ${(err as Error).message}`);
    }
  });

  await app.register(websocketPlugin);


  app.setErrorHandler((err: unknown, _request, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    // Eine Einordnung bei einem Anbieter zu verlangen, der sie nicht kennt, ist eine
    // unpassende Anfrage - kein Serverfehler.
    if (
      (err as { code?: string }).code === CATEGORY_UNSUPPORTED ||
      (err as { code?: string }).code === ATTACHMENT_SEARCH_UNSUPPORTED
    ) {
      reply.code(400).send({ error: (err as Error).message });
      return;
    }
    // Abgelaufene Anmeldung: 401 statt 500 - hier ist nichts kaputt, es fehlt die
    // Berechtigung. Das Konto ist zu diesem Zeitpunkt bereits gekennzeichnet, die
    // Oberfläche zeigt daher gleich den Knopf zum Neuanmelden.
    if (isReauthRequired(err)) {
      reply.code(401).send({ error: (err as Error).message });
      return;
    }
    /*
     * Kein Netz ist kein Serverfehler.
     *
     * Vorher kam die Meldung des Betriebssystems durch, wörtlich bis in die Oberfläche:
     * "getaddrinfo ENOTFOUND imap.gmx.net". Das sagt einem Nutzer nichts, und mit 500
     * daneben sieht es aus, als sei das Programm kaputt - dabei fehlt nur die
     * Verbindung. 503 heißt "gerade nicht erreichbar", und genau das ist der Fall.
     *
     * Bis hierher kommt es nur, wenn auch die lokale Ablage nichts hergab; sonst wäre
     * weiter oben schon der letzte Stand geliefert worden.
     */
    if (istVerbindungsfehler(err)) {
      app.log.warn(err);
      reply.code(503).send({
        error: t(
          'Das Postfach ist gerade nicht erreichbar. Prüfen Sie die Netzwerkverbindung – sobald sie wieder steht, lässt sich neu laden.',
        ),
      });
      return;
    }
    /*
     * Ein Fehler, der seinen eigenen Rang schon kennt, behält ihn.
     *
     * Fastify und seine Zusätze werfen Fehler mit `statusCode` daran. Ohne diese Zeilen
     * wurde daraus eine 500 - aus einer Antwort "so nicht" also eine Antwort "hier ist
     * etwas kaputt".
     *
     * Aufgefallen an @fastify/static: Es weist Pfade wie `//verwaltung/nutzer` oder
     * `/x/../verwaltung/nutzer` von sich aus mit 403 ab - genau richtig, das ist sein
     * Schutz gegen Ausbrüche aus dem Ordner. Der Dienst meldete daraufhin 500 und schrieb
     * jedes Mal einen Fehler mit vollständiger Stapelspur ins Protokoll. Wer bei einer
     * Störung ins Protokoll sieht, sucht dann nach einem Serverfehler, den es nicht gibt.
     *
     * Nur der 4xx-Bereich wird übernommen. Ein Zusatz, der 500 sagt, bekommt weiterhin
     * die volle Behandlung samt Protokolleintrag - dort IST etwas kaputt.
     */
    const eigener = (err as { statusCode?: unknown }).statusCode;
    if (typeof eigener === 'number' && eigener >= 400 && eigener < 500) {
      app.log.warn(`${eigener}: ${err instanceof Error ? err.message : String(err)}`);
      reply.code(eigener).send({ error: err instanceof Error ? err.message : t('Interner Fehler') });
      return;
    }

    app.log.error(err);
    // Lokale Einzelplatz-Anwendung: die konkrete Meldung ist hier deutlich hilfreicher
    // als ein generisches "Interner Fehler" - etwa bei Entschlüsselungsproblemen.
    reply.code(500).send({ error: err instanceof Error ? err.message : t('Interner Fehler') });
  });

  /**
   * Sucht die Serveradressen zu einer Adresse, ohne ein Konto anzulegen. Die Oberfläche
   * fragt damit schon beim Tippen nach - dann steht "Posteo erkannt" da, bevor das
   * Passwort überhaupt eingegeben ist.
   */
  app.get<{ Querystring: { email?: string } }>('/autoconfig', async (request) => {
    const email = request.query.email?.trim();
    if (!email?.includes('@')) throw new HttpError(400, t('Feld "email" ist erforderlich'));
    return { gefunden: await findeEinstellungen(email, getProviderPreset) };
  });

  app.post<{
    Body: {
      email?: string;
      password?: string;
      overrides?: {
        imapHost?: string;
        imapPort?: number;
        imapSecure?: boolean;
        smtpHost?: string;
        smtpPort?: number;
        smtpSecure?: boolean;
      };
    };
  }>('/accounts', async (request, reply) => {
    const { email, password, overrides } = request.body ?? {};
    if (!email || !password) {
      reply.code(400);
      return { error: t('E-Mail und Passwort sind erforderlich') };
    }

    // Nur suchen, wenn nicht ohnehin alles von Hand angegeben ist - sonst wartet man
    // auf eine Auskunft, die keine Rolle mehr spielt.
    const vollstaendigVonHand = Boolean(overrides?.imapHost && overrides?.smtpHost);
    const gefunden = vollstaendigVonHand ? null : await findeEinstellungen(email, getProviderPreset);

    let account: AccountConfig;
    try {
      account = buildPasswordAccount({ email, password, overrides, gefunden });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }

    // Erst prüfen, dann speichern - so landen keine unbrauchbaren Konten im Store.
    try {
      await verifyImapConnection(account);
    } catch (err) {
      reply.code(400);
      return { error: `IMAP-Verbindung fehlgeschlagen (${account.imapHost}): ${(err as Error).message}` };
    }
    try {
      await verifySmtpConnection(account);
    } catch (err) {
      reply.code(400);
      return { error: `SMTP-Verbindung fehlgeschlagen (${account.smtpHost}): ${(err as Error).message}` };
    }

    saveAccount(account);
    syncWatchers();
    return publicAccount(account);
  });

  /**
   * Die Konten dieses Menschen - eigene und freigegebene.
   *
   * Die freigegebenen werden einzeln und ausdrücklich aus dem Ordner ihres Eigentümers
   * geholt: `alsNutzer(besitzer, …)` um genau einen Zugriff, auf genau die Kennung, die in
   * der Freigabe steht. Kein Durchsuchen fremder Kontenlisten, kein "alle Konten aller
   * Nutzer und dann filtern" - was hier steht, steht in einer Freigabe, oder es steht
   * nicht hier.
   */
  app.get('/accounts', async () => {
    const eigene = listAccounts().map(publicAccount);
    const ich = handelnderNutzer();

    const geteilt = erhalteneFreigaben(ich).flatMap((freigabe) => {
      const konto = alsNutzer(freigabe.besitzer, () => getAccount(freigabe.kontoId));
      // Ein Konto, das der Eigentümer inzwischen entfernt hat: die Freigabe zeigt ins
      // Leere. Sie verschwindet beim nächsten Aufräumen; hier wird sie schlicht
      // ausgelassen, statt eine Zeile anzuzeigen, die sich nicht öffnen lässt.
      if (!konto) return [];
      return [
        {
          ...publicAccount(konto),
          freigabe: {
            id: freigabe.id,
            von: freigabe.besitzer,
            rechte: freigabe.rechte,
          },
        },
      ];
    });

    return [...eigene, ...geteilt];
  });

  // --- Freigaben ---

  /**
   * Was ich verschenkt habe und was mir andere gegeben haben.
   *
   * Bewusst unter `/freigaben` und nicht unter `/accounts/:id/…`: Was dort liegt, wechselt
   * bei einer Freigabe in den Kontext des Eigentümers (siehe freigabeHaken.ts). Die
   * Verwaltung der Freigaben selbst muss aber im eigenen Kontext bleiben - sonst sähe ein
   * Vertreter die Freigaben des Eigentümers.
   */
  app.get('/freigaben', async () => {
    const ich = handelnderNutzer();
    return { eigene: eigeneFreigaben(ich), erhalten: erhalteneFreigaben(ich) };
  });

  app.post<{ Body: { kontoId?: string; an?: string; rechte?: Recht } }>(
    '/freigaben',
    async (request) => {
      const ich = handelnderNutzer();
      const kontoId = request.body?.kontoId ?? '';
      // requireAccount und nicht getAccount: Freigeben darf nur, wem das Konto gehört, und
      // "gehört mir" heißt hier "steht in meinem eigenen Kontenspeicher".
      const konto = requireAccount(kontoId);

      const an = (request.body?.an ?? '').trim();
      if (!an) throw new HttpError(400, t('An wen soll freigegeben werden?'));
      const rechte: Recht = request.body?.rechte === 'voll' ? 'voll' : 'lesen';

      try {
        return legeFreigabeAn({ besitzer: ich, kontoId, email: konto.email, an, rechte });
      } catch (err) {
        if (err instanceof FreigabeFehler) throw new HttpError(400, err.message);
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/freigaben/:id', async (request) => {
    const ich = handelnderNutzer();
    try {
      const weg = entferneFreigabe(request.params.id, ich, istVerwalter(ich));
      if (!weg) throw new HttpError(404, t('Diese Freigabe gibt es nicht.'));
      return { ok: true };
    } catch (err) {
      if (err instanceof FreigabeFehler) throw new HttpError(403, err.message);
      throw err;
    }
  });

  app.patch<{
    Params: { id: string };
    Body: {
      displayName?: string;
      signature?: string;
      identitaeten?: Identitaet[];
      proxy?: string;
    };
  }>(
    '/accounts/:id',
    async (request) => {
      /*
       * Eine unbrauchbare Proxyangabe wird hier abgewiesen und nicht erst beim naechsten
       * Abruf. Sonst speicherte der Nutzer, saehe eine Bestaetigung und stuende Minuten
       * spaeter vor einem Postfach, das nicht mehr laedt - ohne einen Zusammenhang zu dem,
       * was er zuletzt getan hat.
       */
      const proxy = request.body?.proxy;
      if (proxy !== undefined && proxy.trim()) {
        const gelesen = leseProxyadresse(proxy);
        if ('fehler' in gelesen) {
          throw new HttpError(400, `Der Proxy taugt nicht: ${gelesen.fehler}`);
        }
      }

      const updated = updateAccountSettings(request.params.id, {
        displayName: request.body?.displayName,
        signature: request.body?.signature,
        identitaeten: request.body?.identitaeten,
        proxy: request.body?.proxy,
      });
      if (!updated) throw new HttpError(404, t('Konto nicht gefunden'));
      return publicAccount(updated);
    },
  );

  /*
   * Adressbuch, Vervollstaendigung und Firmenverzeichnis - siehe routen/adressbuch.ts.
   *
   * Sie stehen dort und nicht mehr hier, weil sie mit dem Postfach nichts zu tun haben:
   * zwei Speicher, kein IMAP, keine Konten. In einer Datei mit hundert Wegen findet man
   * sie zwischen den Nachrichtenwegen nicht wieder.
   */
  registriereAdressbuch(app);

  /**
   * Der Posteingang aller Konten in einer Liste.
   *
   * "nach" trägt für jedes Konto die zuletzt ausgegebene UID - daraus lässt sich jede
   * Seite neu herleiten, ohne dass der Server sich etwas merken müsste.
   */
  app.get<{ Querystring: { pageSize?: string; nach?: string } }>(
    '/posteingang',
    async (request) => {
      const konten = listAccounts();
      if (konten.length === 0) {
        return { messages: [], total: 0, nextCursor: null, hasMore: false, fehlende: [] };
      }
      const pageSize = Math.min(Math.max(Number(request.query.pageSize) || 25, 1), 100);
      const seite = await holeGesamtPosteingang(
        konten,
        markeAusText(request.query.nach),
        pageSize,
      );
      return { ...seite, nextCursor: seite.nextCursor ? markeAlsText(seite.nextCursor) : null };
    },
  );

  /*
   * OpenPGP und S/MIME - siehe routen/schluessel.ts.
   *
   * Zwei Schluesselspeicher und die Beurteilung des kryptografischen Befunds einer
   * Nachricht. Standen hier mitten zwischen den Postfachwegen, ohne mit dem Abrufen von
   * Post etwas zu tun zu haben.
   */
  registriereSchluessel(app);

  /*
   * Das GoBD-Archiv - siehe routen/archiv.ts.
   *
   * Der Inhalt lag seit jeher in archiv/; nur die Wege dorthin standen hier. Damit war
   * die Aufteilung halb.
   */
  registriereArchiv(app);

  // --- Etiketten: das Verzeichnis von Namen und Farben ---

  /*
   * Etiketten und gemerkte Suchen - siehe routen/etikettenUndSuchen.ts.
   *
   * Zwei Verzeichnisse derselben Bauart, die hier zwischen S/MIME und OAuth standen.
   */
  registriereEtikettenUndSuchen(app);

  // --- OAuth: Einrichtung der Anbieter-Zugangsdaten ---

  app.get('/oauth/clients', async () => listOAuthClients());

  /*
   * Wo die Organisation etwas vorgibt, hat der Nutzer hier nichts zu ändern.
   *
   * Abgewiesen statt still ignoriert: gespeichert und wirkungslos wäre die schlechteste
   * Antwort - der Nutzer sähe eine Bestätigung, und die Anmeldung liefe trotzdem über die
   * Anwendung der Organisation. Die Oberfläche zeigt das Formular in diesem Fall gar nicht
   * erst an; diese Prüfung ist der Riegel dahinter.
   */
  const VORGEGEBEN = () =>
    t(
      'Die Anmeldung bei diesem Anbieter wird von Ihrer Organisation vorgegeben und lässt sich hier nicht ändern.',
    );

  app.put<{
    Params: { provider: OAuthProviderId };
    Body: { clientId?: string; clientSecret?: string; mandant?: string };
  }>('/oauth/clients/:provider', async (request) => {
    if (istVorgegeben(request.params.provider)) throw new HttpError(409, VORGEGEBEN());
    const { clientId, clientSecret, mandant } = request.body ?? {};
    if (!clientId?.trim()) throw new HttpError(400, t('Client-ID ist erforderlich'));
    setOAuthClient(request.params.provider, { clientId, clientSecret, mandant });
    return listOAuthClients();
  });

  app.delete<{ Params: { provider: OAuthProviderId } }>('/oauth/clients/:provider', async (request) => {
    if (istVorgegeben(request.params.provider)) throw new HttpError(409, VORGEGEBEN());
    removeOAuthClient(request.params.provider);
    return listOAuthClients();
  });

  // --- OAuth: Anmeldung ---

  app.post<{ Params: { provider: OAuthProviderId } }>('/oauth/:provider/start', async (request) => {
    try {
      // Die Oberfläche öffnet die Adresse im Systembrowser; eingebettete Fenster werden
      // von den Anbietern abgewiesen.
      return await startOAuthFlow(request.params.provider);
    } catch (err) {
      // Fehlende oder unbrauchbare Einrichtung ist ein Anwenderfehler, kein Serverfehler.
      throw new HttpError(400, (err as Error).message);
    }
  });

  /**
   * Meldet ein bestehendes Konto neu an. Nötig, wenn der Anbieter die hinterlegte
   * Anmeldung nicht mehr anerkennt - bei Google verfallen Refresh-Token nach sieben
   * Tagen, solange das Cloud-Projekt im Testbetrieb steht.
   *
   * Bewusst kein Löschen-und-neu-Anlegen: das Konto behält Kennung, Anzeigename und
   * Signatur, und in der Oberfläche bleibt die Auswahl stehen.
   */
  app.post<{ Params: { id: string } }>('/accounts/:id/reauth', async (request) => {
    const account = requireAccount(request.params.id);
    if (account.auth.type !== 'oauth2') {
      throw new HttpError(
        400,
        t(
          'Dieses Konto meldet sich mit Passwort an - eine Neuanmeldung über den Anbieter gibt es dafür nicht.',
        ),
      );
    }
    try {
      return await startOAuthFlow(account.auth.provider, account.id);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.get<{ Params: { state: string } }>('/oauth/status/:state', async (request, reply) => {
    const flow = getFlow(request.params.state);
    if (!flow) throw new HttpError(404, t('Unbekannter oder abgelaufener Anmeldevorgang'));
    if (flow.status.status !== 'done') return flow.status;

    const { tokens } = flow.status;
    if (!tokens.email) {
      clearFlow(request.params.state);
      reply.code(400);
      return { status: 'error', error: t('Der Anbieter hat keine Mailadresse mitgeteilt.') };
    }

    // --- Neuanmeldung eines bestehenden Kontos ---
    if (flow.accountId) {
      const vorhanden = getAccount(flow.accountId);
      clearFlow(request.params.state);
      if (!vorhanden) {
        reply.code(404);
        return { status: 'error', error: t('Das Konto gibt es nicht mehr.') };
      }

      // Sonst würde sich das Konto still auf ein anderes Postfach umstellen, während in
      // der Oberfläche weiterhin die alte Adresse steht.
      if (vorhanden.email.toLowerCase() !== tokens.email.toLowerCase()) {
        reply.code(400);
        return {
          status: 'error',
          error: t(
            'Angemeldet wurde {angemeldet}, dieses Konto ist aber {konto}. Bitte mit derselben Adresse anmelden oder das andere Postfach als neues Konto hinzufügen.',
            { angemeldet: tokens.email, konto: vorhanden.email },
          ),
        };
      }

      if (!hasMailScope(flow.provider, tokens.grantedScopes)) {
        reply.code(400);
        return {
          status: 'error',
          error: t(
            'Die Anmeldung war erfolgreich, aber der Zugriff auf E-Mails wurde nicht gewährt (erforderlich: „{bereich}“).',
            { bereich: getMailScope(flow.provider) },
          ),
        };
      }

      const erneuert: AccountConfig = {
        ...vorhanden,
        auth: {
          type: 'oauth2',
          provider: flow.provider,
          user: vorhanden.email,
          accessToken: tokens.accessToken,
          // Liefert der Anbieter kein neues Refresh-Token, gilt das bisherige weiter.
          // Es hier zu überschreiben würde die Anmeldung nach einer Stunde erneut
          // scheitern lassen - und zwar ohne Aussicht auf Erneuerung.
          refreshToken:
            tokens.refreshToken ??
            (vorhanden.auth.type === 'oauth2' ? vorhanden.auth.refreshToken : undefined),
          expiresAt: tokens.expiresAt,
        },
      };

      try {
        await verifyImapConnection(erneuert);
      } catch (err) {
        reply.code(400);
        return {
          status: 'error',
          error: `IMAP-Verbindung fehlgeschlagen (${erneuert.imapHost}): ${(err as Error).message}`,
        };
      }

      // Reihenfolge zählt: erst speichern (hebt zugleich "abgelaufen" auf), dann die
      // gepoolte Verbindung verwerfen - sie hängt noch an der abgelehnten Anmeldung -,
      // dann die Überwachung neu starten.
      updateAccountAuth(erneuert.id, erneuert.auth);
      closeConnection(erneuert.id);
      restartWatcher(erneuert.id);
      app.log.info(`OAuth ${flow.provider}: ${erneuert.email} neu angemeldet`);

      return { status: 'done', account: publicAccount(getAccount(erneuert.id) ?? erneuert) };
    }

    const bereits = listAccounts().find(
      (account) => account.email.toLowerCase() === tokens.email!.toLowerCase(),
    );
    if (bereits) {
      clearFlow(request.params.state);
      reply.code(409);
      // Bei abgelaufener Anmeldung ist "bereits eingerichtet" die falsche Fährte - dann
      // wollte der Nutzer vermutlich genau dieses Konto wieder flottmachen.
      return {
        status: 'error',
        error: bereits.authExpired
          ? t(
              '{adresse} ist bereits eingerichtet, die Anmeldung ist nur abgelaufen. Nutze beim Konto „Neu anmelden“ – dann bleiben Signatur und Einstellungen erhalten.',
              { adresse: tokens.email },
            )
          : t('{adresse} ist bereits eingerichtet.', { adresse: tokens.email }),
      };
    }

    app.log.info(
      `OAuth ${flow.provider}: Anmeldung für ${tokens.email}, gewährte Bereiche: ` +
        `${tokens.grantedScopes?.join(' ') ?? '(nicht mitgeteilt)'}` +
        `, Refresh-Token: ${tokens.refreshToken ? 'ja' : 'nein'}`,
    );

    // Ohne den Mail-Bereich schlägt der IMAP-Login mit "Invalid credentials" fehl - eine
    // Meldung, die auf ein falsches Passwort hindeutet und in die Irre führt.
    if (!hasMailScope(flow.provider, tokens.grantedScopes)) {
      clearFlow(request.params.state);
      reply.code(400);
      return {
        status: 'error',
        error: t(
          'Die Anmeldung war erfolgreich, aber der Zugriff auf E-Mails wurde nicht gewährt. Erforderlich ist der Bereich „{bereich}“. Gewährt wurde: {gewaehrt}. Trage den Bereich beim Anbieter (OAuth-Zustimmungsbildschirm bzw. API-Berechtigungen) nach und melde dich erneut an.',
          {
            bereich: getMailScope(flow.provider),
            gewaehrt: tokens.grantedScopes?.join(', ') || t('nichts'),
          },
        ),
      };
    }

    if (!tokens.refreshToken) {
      app.log.warn(
        `OAuth ${flow.provider}: kein Refresh-Token erhalten - die Anmeldung verfällt in etwa einer Stunde.`,
      );
    }

    const account = buildOAuthAccount({
      email: tokens.email,
      provider: flow.provider,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    // Wie beim Passwort-Konto: erst prüfen, dann speichern.
    try {
      await verifyImapConnection(account);
    } catch (err) {
      clearFlow(request.params.state);
      reply.code(400);
      const meldung = (err as Error).message;
      // Gmail antwortet auf ein Token ohne Mailzugriff mit "Invalid credentials" - was
      // nach falschem Passwort klingt, obwohl die Anmeldung selbst geklappt hat.
      const hinweis = /invalid credentials|authentication failed/i.test(meldung)
        ? ' ' +
          t(
            'Die Anmeldung selbst war erfolgreich, der Server lehnt aber das Token ab. Häufigste Ursachen: der Mail-Bereich fehlt in der Anbieter-Konfiguration, IMAP ist im Postfach abgeschaltet, oder die Berechtigungen wurden nach der letzten Zustimmung geändert (dann erneut anmelden).',
          )
        : '';
      return {
        status: 'error',
        error:
          t('IMAP-Verbindung fehlgeschlagen ({server}): {grund}.', {
            server: account.imapHost,
            grund: meldung,
          }) + hinweis,
      };
    }

    saveAccount(account);
    syncWatchers();
    clearFlow(request.params.state);
    return { status: 'done', account: publicAccount(account) };
  });

  app.delete<{ Params: { id: string } }>('/accounts/:id', async (request, reply) => {
    if (!deleteAccount(request.params.id)) {
      reply.code(404);
      return { error: t('Konto nicht gefunden') };
    }
    // Gepoolte Verbindung schließen, sonst bliebe sie bis zum Leerlauf-Timeout offen.
    closeConnection(request.params.id);
    // Sonst blieben Kopfdaten eines entfernten Kontos auf der Platte liegen.
    verwerfeKonto(request.params.id);
    verwirfNachrichten(`${request.params.id}:`);
    regelnVerwerfen(request.params.id);
    abwesenheitVerwerfen(request.params.id);
    freigabenZuKonto(request.params.id);
    umgangVerwerfen(request.params.id);
    vertrauenVerwerfen(request.params.id);
    verwerfeKontoAblage(request.params.id);
    /*
     * Auch die Hintergrundarbeit dieses Kontos - sie hing bisher als einzige nicht mit
     * daran.
     *
     * Eine Wiedervorlage blieb in der Liste stehen und ließ sich nicht öffnen; eine
     * vorgemerkte Sendung lief zu ihrem Termin auf "Das Konto gibt es nicht mehr",
     * verbrauchte ihre Versuche und wurde dann verworfen. Beides zusammen mit dem Konto
     * abzuräumen ist der Zeitpunkt, an dem es niemandem mehr wehtut.
     */
    const wiedervorlagen = verwerfeKontoWiedervorlagen(request.params.id);
    if (wiedervorlagen > 0) {
      app.log.info(`${wiedervorlagen} Wiedervorlage(n) des entfernten Kontos verworfen.`);
    }
    for (const sendung of verwerfeKontoSendungen(request.params.id)) {
      protokolliere(
        'warnung',
        'senden',
        `Die vorgemerkte Nachricht "${sendung.betreff}" wurde mit ihrem Konto entfernt und ` +
          'geht nicht mehr hinaus.',
      );
    }
    syncWatchers();
    return { ok: true };
  });

  // --- Vertraute Absender ---

  /**
   * Entfernte Inhalte sind grundsätzlich angehalten - sie melden dem Absender, dass
   * gelesen wurde. Diese Liste ist die Ausnahme für Absender, bei denen man das nicht
   * jedes Mal freigeben will.
   */
  app.get<{ Params: { id: string } }>('/accounts/:id/vertraute-absender', async (request) => {
    requireAccount(request.params.id);
    return { absender: vertrauteAbsender(request.params.id) };
  });

  app.post<{ Params: { id: string }; Body: { adresse?: string } }>(
    '/accounts/:id/vertraute-absender',
    async (request) => {
      requireAccount(request.params.id);
      const adresse = request.body?.adresse?.trim();
      if (!adresse) throw new HttpError(400, t('Feld "adresse" ist erforderlich'));
      return { absender: vertrauenGeben(request.params.id, adresse) };
    },
  );

  app.delete<{ Params: { id: string; adresse: string } }>(
    '/accounts/:id/vertraute-absender/:adresse',
    async (request) => {
      requireAccount(request.params.id);
      return { absender: vertrauenEntziehen(request.params.id, decodeURIComponent(request.params.adresse)) };
    },
  );

  /**
   * Wie lange ein zwischengespeicherter Stand ohne Nachfrage gilt. Bewusst kurz: die
   * Fristen bestimmen nicht, wie alt Angezeigtes sein darf, sondern nur, wie oft im
   * Hintergrund nachgesehen wird. Veraltetes wird ohnehin sofort ersetzt, sobald die
   * Auffrischung durch ist - und bei neuer Post verwirft der Watcher die Stände direkt.
   */
  const FRIST_ORDNER_MS = 20_000;
  const FRIST_EINORDNUNG_MS = 120_000;
  const FRIST_NACHRICHTEN_MS = 20_000;

  /** Muss zu mail-core passen; steht hier, damit der Schlüssel des Speichers eindeutig ist. */
  const DEFAULT_SEITENGROESSE = 25;

  /**
   * Verwirft die zwischengespeicherten Stände nach einer Änderung durch die Anwendung
   * selbst.
   *
   * Der Watcher erledigt das für Änderungen von außen, greift aber nur im Posteingang -
   * und eine gerade gelöschte oder verschobene Nachricht darf beim nächsten Abruf nicht
   * wieder auftauchen. Ordnerliste und Einordnung kommen mit, weil sich deren
   * Ungelesen-Zähler mitverschieben.
   */
  function verwerfeStaende(accountId: string, ...ordner: (string | undefined)[]): void {
    for (const eintrag of ordner) {
      if (eintrag) verwerfe(`nachrichten:${accountId}:${eintrag}:`);
    }
    verwerfe(schluessel.ordner(accountId));
    verwerfe(schluessel.einordnung(accountId));
    // Wer gerade geantwortet hat, soll die Nachricht nicht weiter als offen vorfinden.
    verwerfe(`offen:${accountId}:`);
  }

  app.get<{ Params: { id: string } }>('/accounts/:id/folders', async (request) => {
    const account = requireAccount(request.params.id);
    const { wert } = await ausSpeicherOderHolen(
      schluessel.ordner(account.id),
      () => listFolders(account),
      {
        maxAlterMs: FRIST_ORDNER_MS,
        beiAenderung: () => meldeAktualisierung({ type: 'data-updated', accountId: account.id, was: 'folders' }),
      },
    );
    return wert;
  });

  // --- Wiedervorlage ---

  setWiedervorlageUmgebung(
    (accountId) => getAccount(accountId),
    (msg) => app.log.info(msg),
    (accountId, ordner) => {
      // Die Nachricht ist zurück - Zwischenspeicher verwerfen und die Oberfläche
      // nachladen lassen, sonst bliebe sie bis zum nächsten Klick unsichtbar.
      verwerfeStaende(accountId, ordner);
      meldeAktualisierung({ type: 'data-updated', accountId, was: 'messages', folder: ordner });
    },
  );
  // ladeWiedervorlagen() steht bewusst nicht hier, sondern ganz am Ende - siehe dort.

  app.post<{
    Params: { id: string; folder: string };
    Body: { uid?: number; faellig?: string };
  }>('/accounts/:id/folders/:folder/snooze', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const uid = Number(request.body?.uid);
    const faellig = new Date(String(request.body?.faellig)).getTime();

    if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, t('Feld "uid" ist erforderlich'));
    if (!Number.isFinite(faellig)) throw new HttpError(400, t('Unbrauchbarer Zeitpunkt.'));
    if (faellig <= Date.now()) throw new HttpError(400, t('Der Zeitpunkt liegt in der Vergangenheit.'));

    const nachricht = await getMessage(account, ordner, uid);
    const eintrag = await stelleZurueck(account, ordner, uid, nachricht.subject, faellig);

    verwerfeStaende(account.id, ordner, WIEDERVORLAGE_ORDNER);
    verwirfNachrichten(nachrichtenSchluessel(account.id, ordner, uid));
    return { ok: true, ...eintrag };
  });

  app.get<{ Params: { id: string } }>('/accounts/:id/snoozed', async (request) => {
    requireAccount(request.params.id);
    return listeWiedervorlagen(request.params.id);
  });

  app.post<{ Params: { id: string; snoozeId: string } }>(
    '/accounts/:id/snoozed/:snoozeId/return',
    async (request) => {
      requireAccount(request.params.id);
      if (!(await sofortZurueck(request.params.snoozeId, request.params.id))) {
        throw new HttpError(404, t('Diese Wiedervorlage gibt es nicht mehr.'));
      }
      return { ok: true };
    },
  );

  // --- Liegengebliebenes ---

  /**
   * Was noch offen ist: worauf eine Antwort aussteht und wem man selbst eine schuldet.
   *
   * Lange im Zwischenspeicher, weil dafür beide Ordner über Monate abgefragt werden -
   * das dauert. Was sich daran ändert, ändert sich ohnehin im Tages-, nicht im
   * Minutentakt.
   */
  app.get<{
    Params: { id: string };
    Querystring: { minDays?: string; maxDays?: string; all?: string };
  }>('/accounts/:id/offen', async (request) => {
    const account = requireAccount(request.params.id);
    const mindestTage = zahlAus(request.query.minDays, 'minDays', { von: 0, bis: 3650, standard: 3 });
    const hoechstTage = zahlAus(request.query.maxDays, 'maxDays', { von: 1, bis: 365, standard: 90 });
    const auchUnbekannte = request.query.all === '1';

    const { wert } = await ausSpeicherOderHolen(
      `offen:${account.id}:${mindestTage}:${hoechstTage}:${auchUnbekannte ? 'alle' : 'eng'}`,
      () =>
        offeneVorgaenge(account, {
          mindestTage,
          hoechstTage,
          auchUnbekannte,
          melde: (getan, von, text) =>
            meldeFortschritt({ type: 'fortschritt', accountId: account.id, vorgang: 'offen', getan, von, text }),
        }),
      { maxAlterMs: 15 * 60_000 },
    );
    return wert;
  });

  // --- Postfach aufräumen ---

  /**
   * Wer den Ordner vollmacht. Länger im Zwischenspeicher als die übrigen Stände: die
   * Erhebung braucht rund zwei Dutzend Suchläufe, und die Rangfolge der Absender ändert
   * sich nicht im Minutentakt.
   */
  app.get<{ Params: { id: string }; Querystring: { folder?: string; sample?: string } }>(
    '/accounts/:id/senders',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = request.query.folder ? decodeURIComponent(request.query.folder) : 'INBOX';
      const stichprobe = zahlAus(request.query.sample, 'sample', { von: 1, bis: 2000, standard: 500 });

      const { wert } = await ausSpeicherOderHolen(
        `absender:${account.id}:${ordner}:${stichprobe}`,
        () =>
          senderUebersicht(account, ordner, stichprobe, undefined, (getan, von, text) =>
            meldeFortschritt({
              type: 'fortschritt',
              accountId: account.id,
              vorgang: 'absender',
              getan,
              von,
              text,
            }),
          ),
        { maxAlterMs: 10 * 60_000 },
      );
      return wert;
    },
  );

  /**
   * Meldet von einem Verteiler ab.
   *
   * Der Weg richtet sich danach, was der Absender selbst angibt. Die Ein-Klick-Abmeldung
   * schickt der Server; eine Abmelde-Mail geht über das Konto hinaus; bleibt nur eine
   * Webseite, kann die niemand außer dem Nutzer bedienen - dann kommt die Adresse zurück
   * und die Oberfläche öffnet sie.
   */
  app.post<{ Params: { id: string; folder: string }; Body: { uid?: number } }>(
    '/accounts/:id/folders/:folder/unsubscribe',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const uid = Number(request.body?.uid);
      if (!Number.isInteger(uid) || uid <= 0) throw new HttpError(400, t('Feld "uid" ist erforderlich'));

      const nachricht = await getMessage(account, ordner, uid);
      if (!nachricht.listUnsubscribe) {
        throw new HttpError(400, t('Diese Nachricht nennt keinen Abmeldeweg.'));
      }

      const wege = leseAbmeldeWege(nachricht.listUnsubscribe, Boolean(nachricht.einKlickAbmeldung));
      const weg = bestimmeAbmeldung(wege);
      if (!weg) {
        throw new HttpError(
          400,
          t(
            'Der Absender gibt zwar eine Abmeldezeile an, darin steht aber keine brauchbare Adresse.',
          ),
        );
      }

      if (weg.art === 'ein-klick') {
        try {
          const { status } = await sendeEinKlickAbmeldung(weg.ziel);
          return { art: 'ein-klick', ziel: weg.ziel, status, erfolg: status < 400 };
        } catch (err) {
          throw new HttpError(502, `Abmeldung fehlgeschlagen: ${(err as Error).message}`);
        }
      }

      if (weg.art === 'mail') {
        await sendMessage(account, {
          to: [weg.adresse],
          subject: weg.betreff ?? 'unsubscribe',
          text: weg.text ?? 'unsubscribe',
        });
        return { art: 'mail', adresse: weg.adresse, erfolg: true };
      }

      // Nur eine Seite mit Bestätigung - die muss der Nutzer selbst aufrufen.
      return { art: 'im-browser', ziel: weg.ziel, erfolg: false };
    },
  );

  /** Verschiebt alles von einem Absender in den Papierkorb. */
  app.post<{
    Params: { id: string; folder: string };
    Body: { from?: string; targetFolder?: string };
  }>('/accounts/:id/folders/:folder/from-sender/move', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const absender = request.body?.from?.trim();
    if (!absender) throw new HttpError(400, t('Feld "from" ist erforderlich'));

    const ziel =
      request.body?.targetFolder ??
      (await findSpecialFolder(account, '\\Trash', ['trash', 'papierkorb', 'gelöscht', 'deleted']));
    if (!ziel) throw new HttpError(400, t('Für dieses Konto gibt es keinen Papierkorb.'));

    const anzahl = await verschiebeVonAbsender(account, ordner, absender, ziel);
    verwerfeStaende(account.id, ordner, ziel);
    verwirfNachrichten(`${account.id}:${ordner}:`);
    verwerfe(`absender:${account.id}:`);
    return { verschoben: anzahl, ziel };
  });

  // --- Lesebestätigungen ---

  app.get<{ Params: { id: string } }>('/accounts/:id/lesebestaetigung', async (request) => {
    requireAccount(request.params.id);
    return { umgang: umgangFuer(request.params.id) };
  });

  app.put<{ Params: { id: string }; Body: { umgang?: string } }>(
    '/accounts/:id/lesebestaetigung',
    async (request) => {
      requireAccount(request.params.id);
      const wert = request.body?.umgang;
      if (wert !== 'nie' && wert !== 'fragen' && wert !== 'immer') {
        throw new HttpError(400, t('Unbekannte Einstellung.'));
      }
      return { umgang: setzeUmgang(request.params.id, wert) };
    },
  );

  /**
   * Eine Lesebestätigung verschicken - oder ausdrücklich nicht.
   *
   * Gerufen wird das von der Oberfläche, wenn die Nachricht wirklich vor jemandem steht.
   * Das ist der Grund, warum es diesen Weg überhaupt gibt und nicht der Abruf der
   * Nachricht selbst genügt: Der Server sieht nur, dass jemand Daten geholt hat - das tut
   * auch eine Vorschau. "Angezeigt" weiß nur, wer den Bildschirm kennt.
   *
   * `senden: false` ist kein Nichtstun, sondern eine Entscheidung, die gemerkt wird. Ein
   * "Nein", das nicht hält, ist eine Frage, die so lange wiederkehrt, bis jemand aus
   * Versehen zustimmt.
   */
  app.post<{
    Params: { id: string; folder: string; uid: string };
    Body: { senden?: boolean };
  }>('/accounts/:id/folders/:folder/messages/:uid/lesebestaetigung', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const uid = uidAus(request.params.uid);
    const nachricht = await getMessage(account, ordner, uid);
    const schluessel = bestaetigungsSchluessel(nachricht, ordner);

    if (request.body?.senden === false) {
      merkeEntscheidung(account.id, schluessel, 'abgelehnt');
      return { gesendet: false };
    }

    /*
     * Auch hier noch einmal geprüft, obwohl die Oberfläche es schon getan hat.
     *
     * Sie entscheidet, WANN gefragt wird; ob überhaupt gesendet werden darf, entscheidet
     * der Server. Sonst genügte ein Aufruf von Hand, um eine Bestätigung an eine beliebige
     * Adresse zu schicken - und damit wäre genau die Absicherung offen, um die es hier
     * die ganze Zeit geht.
     */
    const befund = pruefeBestaetigung({
      account,
      nachricht,
      umgang: umgangFuer(account.id),
      erledigt: entscheidungZu(account.id, schluessel),
    });
    if (befund.was === 'nein') {
      throw new HttpError(400, t('Für diese Nachricht geht keine Lesebestätigung hinaus.'));
    }

    await verschickeBestaetigung(account, nachricht, befund.an, befund.was === 'fragen');
    merkeEntscheidung(account.id, schluessel, 'gesendet');
    return { gesendet: true, an: befund.an };
  });

  // --- Abwesenheitsnotiz ---

  /**
   * Welche Konten gerade wirklich antworten.
   *
   * Für die Seitenleiste, und das ist kein Beiwerk: Eine Abwesenheitsnotiz, die man nicht
   * sieht, bleibt drei Monate nach dem Urlaub an. Deshalb "wirklich" - nicht nur
   * eingeschaltet, sondern auch innerhalb ihres Zeitraums.
   */
  app.get('/abwesenheit', async () => {
    return { aktiv: aktiveAbwesenheiten(listAccounts().map((a) => a.id)) };
  });

  app.get<{ Params: { id: string } }>('/accounts/:id/abwesenheit', async (request) => {
    requireAccount(request.params.id);
    return abwesenheitFuer(request.params.id);
  });

  app.put<{ Params: { id: string }; Body: Partial<Abwesenheit> }>(
    '/accounts/:id/abwesenheit',
    async (request) => {
      requireAccount(request.params.id);
      const eingabe = request.body ?? {};
      /*
       * Eine eingeschaltete Notiz ohne Text wird gar nicht erst gespeichert.
       *
       * Sie ginge sonst als leere Mail hinaus - und das ist schlimmer als keine Antwort:
       * Der Absender denkt, er sei abgewimmelt worden.
       */
      if (eingabe.aktiv && !eingabe.text?.trim()) {
        throw new HttpError(400, t('Die Abwesenheitsnotiz braucht einen Text.'));
      }
      if (eingabe.von && eingabe.bis && eingabe.von > eingabe.bis) {
        throw new HttpError(400, t('Das Ende liegt vor dem Anfang.'));
      }
      return setzeAbwesenheit(request.params.id, {
        aktiv: Boolean(eingabe.aktiv),
        von: eingabe.von,
        bis: eingabe.bis,
        betreff: eingabe.betreff,
        text: eingabe.text ?? '',
        nurBekannte: eingabe.nurBekannte,
        wiederholungTage: eingabe.wiederholungTage,
      });
    },
  );

  // --- Regeln ---

  app.get<{ Params: { id: string } }>('/accounts/:id/rules', async (request) => {
    requireAccount(request.params.id);
    return regelnFuer(request.params.id);
  });

  app.put<{ Params: { id: string }; Body: Partial<Regel> }>(
    '/accounts/:id/rules',
    async (request) => {
      requireAccount(request.params.id);
      const { name, aktiv, bedingungen, aktionen, id } = request.body ?? {};
      if (!name?.trim()) throw new HttpError(400, t('Die Regel braucht einen Namen.'));

      const regel = {
        id,
        name: name.trim(),
        aktiv: aktiv !== false,
        bedingungen: bedingungen ?? {},
        aktionen: aktionen ?? {},
      };
      // Eine Regel ohne Bedingung träfe auf jede Nachricht zu und würde beim nächsten
      // Eingang das Postfach leerräumen - das darf gar nicht erst gespeichert werden.
      if (!istBrauchbar(regel)) {
        throw new HttpError(
          400,
          t(
            'Die Regel braucht mindestens eine Bedingung und eine Aktion - sonst würde sie auf alles zutreffen.',
          ),
        );
      }
      return regelSpeichern(request.params.id, regel);
    },
  );

  app.delete<{ Params: { id: string; regelId: string } }>(
    '/accounts/:id/rules/:regelId',
    async (request) => {
      requireAccount(request.params.id);
      if (!regelLoeschen(request.params.id, request.params.regelId)) {
        throw new HttpError(404, t('Regel nicht gefunden'));
      }
      return { ok: true };
    },
  );

  /**
   * Zeigt vorab, wie viele Nachrichten eines Ordners eine Regel treffen würde - ohne
   * etwas zu verändern. Wer eine Regel anlegt, die 8.000 Nachrichten verschiebt, soll
   * das vorher wissen und nicht hinterher.
   */
  app.post<{
    Params: { id: string };
    Body: { bedingungen?: RegelBedingung; folder?: string; pageSize?: number };
  }>('/accounts/:id/rules/preview', async (request) => {
    const account = requireAccount(request.params.id);
    const bedingungen = request.body?.bedingungen ?? {};
    const ordner = request.body?.folder ?? 'INBOX';
    if (!istBrauchbar({ bedingungen, aktionen: { alsGelesen: true } })) {
      throw new HttpError(400, t('Ohne Bedingung lässt sich nichts vorführen.'));
    }

    // Über eine begrenzte Menge: die Vorschau soll eine Größenordnung zeigen, nicht den
    // gesamten Ordner durchmustern.
    const stichprobe = zahlAus(request.body?.pageSize, 'pageSize', { von: 1, bis: 500, standard: 200 });
    const seite = await listMessages(account, ordner, { pageSize: stichprobe });
    const probe = { id: 'vorschau', name: 'Vorschau', aktiv: true, bedingungen, aktionen: {} };
    const treffer = seite.messages.filter((m) => passt(probe as Regel, m));

    return {
      geprueft: seite.messages.length,
      treffer: treffer.length,
      imOrdner: seite.total,
      beispiele: treffer.slice(0, 5).map((m) => ({
        subject: m.subject,
        from: m.from[0]?.name || m.from[0]?.address,
      })),
    };
  });

  /** Wendet die Regeln auf einen bestehenden Ordner an - zum Aufräumen. */
  app.post<{ Params: { id: string; folder: string }; Querystring: { pageSize?: string } }>(
    '/accounts/:id/folders/:folder/apply-rules',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const menge = zahlAus(request.query.pageSize, 'pageSize', { von: 1, bis: 500, standard: 200 });

      const seite = await listMessages(account, ordner, { pageSize: menge });
      const ergebnis = await wendeRegelnAn(account, ordner, seite.messages, (m) => app.log.info(m));
      verwerfeStaende(account.id, ordner);
      verwirfNachrichten(`${account.id}:${ordner}:`);
      return { ...ergebnis, geprueft: seite.messages.length };
    },
  );

  /**
   * Sonderordner dürfen weder umbenannt noch gelöscht werden.
   *
   * Die Server lehnen das zwar meist selbst ab, aber mit Meldungen, aus denen niemand
   * schlau wird - und Gmail lässt manches sogar zu, mit Folgen bis in die Weboberfläche
   * hinein. Die Rolle kommt vom Server selbst, es wird also nicht über Namen geraten.
   */
  async function pruefeVeraenderbar(account: AccountConfig, pfad: string): Promise<void> {
    const ordner = (await listFolders(account)).find((f) => f.path === pfad);
    if (!ordner) throw new HttpError(404, `Ordner "${pfad}" gibt es nicht.`);
    if (ordner.specialUse) {
      throw new HttpError(
        400,
        `"${ordner.name}" ist ein Sonderordner des Anbieters und lässt sich nicht ändern.`,
      );
    }
  }

  app.post<{ Params: { id: string }; Body: { path?: string } }>(
    '/accounts/:id/folders',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = request.body?.path?.trim();
      if (!pfad) throw new HttpError(400, t('Feld "path" ist erforderlich'));
      await createFolder(account, pfad);
      verwerfe(schluessel.ordner(account.id));
      return { ok: true, path: pfad };
    },
  );

  app.patch<{ Params: { id: string; folder: string }; Body: { path?: string } }>(
    '/accounts/:id/folders/:folder',
    async (request) => {
      const account = requireAccount(request.params.id);
      const alt = decodeURIComponent(request.params.folder);
      const neu = request.body?.path?.trim();
      if (!neu) throw new HttpError(400, t('Feld "path" ist erforderlich'));
      await pruefeVeraenderbar(account, alt);
      await renameFolder(account, alt, neu);
      // Der alte Pfad ist weg - alles, was darunter zwischengespeichert war, ebenso.
      verwerfeStaende(account.id, alt);
      verwirfNachrichten(`${account.id}:${alt}:`);
      return { ok: true, path: neu };
    },
  );

  app.delete<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = decodeURIComponent(request.params.folder);
      await pruefeVeraenderbar(account, pfad);
      await deleteFolder(account, pfad);
      verwerfeStaende(account.id, pfad);
      verwirfNachrichten(`${account.id}:${pfad}:`);
      return { ok: true };
    },
  );

  /** Leert einen Ordner unwiderruflich - gedacht für Papierkorb und Spam. */
  app.post<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder/empty',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = decodeURIComponent(request.params.folder);
      const anzahl = await emptyFolder(account, pfad);
      verwerfeStaende(account.id, pfad);
      verwirfNachrichten(`${account.id}:${pfad}:`);
      return { ok: true, geloescht: anzahl };
    },
  );

  app.post<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder/mark-read',
    async (request) => {
      const account = requireAccount(request.params.id);
      const pfad = decodeURIComponent(request.params.folder);
      const anzahl = await markFolderSeen(account, pfad);
      verwerfeStaende(account.id, pfad);
      verwirfNachrichten(`${account.id}:${pfad}:`);
      return { ok: true, markiert: anzahl };
    },
  );

  /**
   * Gmails Einordnung des Posteingangs. Für alle anderen Anbieter eine leere Liste - die
   * Entscheidung fällt an der IMAP-Erweiterung des Servers, nicht an der Adresse.
   */
  app.get<{ Params: { id: string } }>('/accounts/:id/categories', async (request) => {
    const account = requireAccount(request.params.id);
    // Der teuerste Abruf überhaupt: vier Suchläufe über den gesamten Posteingang, rund
    // 1,2 Sekunden bei 30.000 Nachrichten. Ohne Zwischenspeicher lief er bei jedem Start
    // und bei jedem Kontowechsel erneut.
    const { wert } = await ausSpeicherOderHolen(
      schluessel.einordnung(account.id),
      () => listCategories(account),
      {
        maxAlterMs: FRIST_EINORDNUNG_MS,
        beiAenderung: () =>
          meldeAktualisierung({ type: 'data-updated', accountId: account.id, was: 'categories' }),
      },
    );
    return wert;
  });

  /**
   * Was der Server des Kontos kann. Lange Frist im Zwischenspeicher: die Fähigkeiten
   * eines Servers ändern sich allenfalls bei einem Umbau beim Anbieter.
   */
  app.get<{ Params: { id: string } }>('/accounts/:id/capabilities', async (request) => {
    const account = requireAccount(request.params.id);
    const { wert } = await ausSpeicherOderHolen(
      `faehigkeiten:${account.id}`,
      () => getCapabilities(account),
      { maxAlterMs: 24 * 60 * 60_000 },
    );
    return wert;
  });

  /** Prüft den Wert aus der Anfrage gegen die bekannten Einordnungen. */
  function parseCategory(value: string | undefined): GmailCategory | undefined {
    if (!value) return undefined;
    const treffer = GMAIL_CATEGORIES.find((category) => category === value);
    if (!treffer) throw new HttpError(400, `Unbekannte Einordnung "${value}"`);
    return treffer;
  }

  app.get<{
    Params: { id: string; folder: string };
    Querystring: {
      beforeUid?: string;
      pageSize?: string;
      category?: string;
      aelteste?: string;
    };
  }>('/accounts/:id/folders/:folder/messages', async (request) => {
    const account = requireAccount(request.params.id);
    const { category } = request.query;
    const aeltesteZuerst = request.query.aelteste === '1';
    const ordner = decodeURIComponent(request.params.folder);
    const einordnung = parseCategory(category);

    /*
     * Geprüft und nicht geraten - siehe zahlAus.
     *
     * Hier stand `Number(pageSize)` unmittelbar. Die zweite Sicherung in mail-core
     * (`brauchbareAnzahl`) fängt zwar NaN ab, aber nur NaN: `?pageSize=1000000` ging
     * ungebremst durch und holte die Kopfdaten einer Million Nachrichten. Ausgerechnet
     * auf dem Weg, den die Oberfläche bei jedem Ordnerwechsel benutzt.
     *
     * Dieselbe Obergrenze wie bei den übrigen Listenwegen. Die Oberfläche fragt stets 25
     * an; die Grenze trifft also nur, wer von Hand etwas anderes einträgt.
     */
    const groesse = zahlAus(request.query.pageSize, 'pageSize', {
      von: 1,
      bis: 500,
      standard: DEFAULT_SEITENGROESSE,
    });
    const vorUid =
      request.query.beforeUid === undefined || request.query.beforeUid === ''
        ? undefined
        : uidAus(request.query.beforeUid, 'beforeUid');

    const holen = async () => {
      const seite = await listMessages(account, ordner, {
        beforeUid: vorUid,
        pageSize: groesse,
        category: einordnung,
        aeltesteZuerst,
      });

      // Nebenbei Adressen einsammeln - daraus entstehen die Vorschläge beim Verfassen,
      // ohne dass jemand ein Adressbuch pflegen muss. Bewusst hier drin: aus dem
      // Zwischenspeicher beantwortete Anfragen sollen die Zähler nicht hochtreiben.
      merkeAusListe(account.id, ordner, seite.messages);

      /**
       * In die lokale Ablage schreiben, was gerade geholt wurde.
       *
       * Erst die UID-Gültigkeit prüfen: hat der Server die Nummerierung neu begonnen,
       * zeigen alle gemerkten UIDs ins Leere und der Ordner muss geräumt werden, bevor
       * das Neue dazukommt. Fehler dabei dürfen den Abruf nicht aufhalten - die Ablage
       * ist ein Abbild, die Anzeige hängt nicht an ihr.
       */
      try {
        pruefeUidGueltigkeit(account.id, ordner, seite.uidValidity);
        merkeKopfdaten(account.id, ordner, seite.messages);
      } catch (err) {
        app.log.warn(`Lokale Ablage nicht beschrieben: ${(err as Error).message}`);
      }

      return seite;
    };

    /**
     * Kommt der Server nicht ans Netz, aus der Ablage antworten.
     *
     * Das ist der Kern des Offline-Betriebs: die Liste bleibt vollständig, weil die
     * Kopfdaten aller je geholten Nachrichten auf der Platte liegen. Bewusst nur bei
     * Verbindungsfehlern - eine abgelaufene Anmeldung oder ein fehlender Ordner soll
     * weiterhin als Fehler ankommen, sonst suchte man den Grund an der falschen Stelle.
     */
    const holenOderAusAblage = async () => {
      try {
        return await holen();
      } catch (err) {
        if (!istVerbindungsfehler(err)) throw err;

        const abgelegt = holeSeite(account.id, ordner, {
          vorUid,
          anzahl: groesse,
        });
        if (abgelegt.length === 0) throw err;

        app.log.warn(`Ohne Verbindung - ${ordner} kommt aus der Ablage`);
        return {
          messages: abgelegt as unknown as Awaited<ReturnType<typeof listMessages>>['messages'],
          total: anzahlAbgelegt(account.id, ordner),
          nextCursor: abgelegt[abgelegt.length - 1]?.uid ?? null,
          hasMore: abgelegt.length === groesse,
          // Sagt der Oberfläche, dass sie einen Stand von der Platte zeigt.
          ausAblage: true as const,
        };
      }
    };

    // Nur die erste Seite kommt in den Zwischenspeicher. Nachgeladene ältere Seiten holt
    // man einmal beim Blättern - dort wartet man ohnehin auf etwas Neues, und sie alle
    // vorzuhalten würde den Speicher bei großen Postfächern vollaufen lassen.
    if (vorUid !== undefined) return holenOderAusAblage();

    // Der Abruf der ersten Seite heißt: dieser Ordner wird gerade angesehen. Er kommt
    // damit in die Überwachung, sodass Änderungen dort ebenso sofort ankommen wie im
    // Posteingang.
    meldeAnsicht(account.id, ordner);

    const { wert } = await ausSpeicherOderHolen(
      schluessel.nachrichten(account.id, ordner, einordnung, groesse, aeltesteZuerst),
      holenOderAusAblage,
      {
        maxAlterMs: FRIST_NACHRICHTEN_MS,
        beiAenderung: () =>
          meldeAktualisierung({
            type: 'data-updated',
            accountId: account.id,
            was: 'messages',
            folder: ordner,
            category: einordnung,
          }),
      },
    );
    return wert;
  });

  /**
   * Ersetzt "cid:"-Verweise auf eingebettete Bilder durch abrufbare Adressen.
   *
   * Ohne das packt der Parser die Bilddaten selbst in den HTML-Text - bei einer
   * Nachricht mit sechs Bildern 197 von 215 KB. So holt der Browser sie einzeln über
   * den vorhandenen Anhang-Abruf, und zwar erst, wenn er sie wirklich anzeigt.
   */
  function mitAbrufbarenBildern(
    nachricht: Awaited<ReturnType<typeof getMessage>>,
    accountId: string,
    ordner: string,
    uid: number,
  ) {
    if (typeof nachricht.html !== 'string') return nachricht;

    let html = nachricht.html;
    for (const anhang of nachricht.attachments) {
      if (!anhang.contentId || !anhang.partId) continue;
      const adresse =
        `/accounts/${accountId}/folders/${encodeURIComponent(ordner)}` +
        `/messages/${uid}/attachments/${encodeURIComponent(anhang.partId)}`;
      // Über split/join statt regulärem Ausdruck: eine Content-ID darf Zeichen
      // enthalten, die dort eine Sonderbedeutung hätten.
      html = html.split(`cid:${anhang.contentId}`).join(adresse);
    }
    return { ...nachricht, html };
  }

  app.get<{ Params: { id: string; folder: string; uid: string } }>(
    '/accounts/:id/folders/:folder/messages/:uid',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const uid = uidAus(request.params.uid);
      const key = nachrichtenSchluessel(account.id, ordner, uid);

      /**
       * Ob der Absender freigegeben ist, wird bei jedem Abruf frisch bestimmt und nicht
       * mitgespeichert: sonst zeigte eine Nachricht, die vor dem Freigeben schon einmal
       * offen war, weiterhin die Rückfrage.
       */
      /**
       * Was zur Lesebestätigung zu sagen ist - aber KEINE wird von hier aus verschickt.
       *
       * Dieser Weg wird auch von einer Vorschau, einem Zwischenspeicher oder einer Suche
       * gerufen. Eine Bestätigung von hier aus behauptete "angezeigt", ohne es zu wissen.
       * Ob die Nachricht wirklich vor jemandem steht, weiß nur die Oberfläche - sie
       * verlangt die Bestätigung deshalb ausdrücklich über den Weg weiter unten.
       */
      const mitBestaetigung = (n: Awaited<ReturnType<typeof getMessage>>) => {
        const umgang = umgangFuer(account.id);
        const schluessel = bestaetigungsSchluessel(n, ordner);
        const befund = pruefeBestaetigung({
          account,
          nachricht: n,
          umgang,
          erledigt: entscheidungZu(account.id, schluessel),
        });
        if (befund.was === 'nein') return undefined;
        return {
          an: befund.an,
          /** Bei "senden" hat der Nutzer es vorab erlaubt; sonst wird gefragt. */
          fragen: befund.was === 'fragen',
          /** Die Bestätigungsadresse weicht vom Absender ab - siehe lesebestaetigung.ts. */
          abweichend: befund.was === 'fragen' ? befund.abweichend : false,
        };
      };

      const mitVertrauen = (n: Awaited<ReturnType<typeof getMessage>>) => ({
        ...n,
        absenderVertraut: istVertraut(account.id, n.from[0]?.address ?? ''),
        lesebestaetigung: mitBestaetigung(n),
      });

      const vorhanden = liesNachricht(key);
      if (vorhanden) return mitVertrauen(vorhanden);

      let geholt: Awaited<ReturnType<typeof getMessage>>;
      try {
        geholt = await getMessage(account, ordner, uid);
      } catch (err) {
        // Ohne Verbindung das nehmen, was beim letzten Lesen abgelegt wurde.
        const ausAblage = istVerbindungsfehler(err) ? holeInhalt(account.id, ordner, uid) : null;
        if (!ausAblage) throw err;

        const kopf = holeSeite(account.id, ordner, { anzahl: 1, vorUid: uid + 1 }).find(
          (m) => m.uid === uid,
        );
        app.log.warn(`Ohne Verbindung - Nachricht ${uid} kommt aus der Ablage`);
        return mitVertrauen({
          uid,
          subject: kopf?.subject ?? t('(kein Betreff)'),
          from: kopf?.from ?? [],
          to: kopf?.to ?? [],
          cc: [],
          date: kopf?.date ?? null,
          flags: kopf?.flags ?? [],
          seen: kopf?.seen ?? true,
          hasAttachments: Boolean(ausAblage.anhaenge?.length),
          html: ausAblage.html,
          text: ausAblage.text,
          attachments: (ausAblage.anhaenge ?? []) as never,
          ausAblage: true,
        } as never);
      }

      const nachricht = mitAbrufbarenBildern(geholt, account.id, ordner, uid);
      merkeNachricht(key, nachricht);

      // Zusätzlich dauerhaft ablegen: der Speicher im Arbeitsspeicher ist nach dem
      // Beenden weg, die Ablage überdauert ihn und trägt später das Lesen ohne Netz.
      try {
        merkeInhalt(account.id, ordner, uid, {
          html: typeof nachricht.html === 'string' ? nachricht.html : undefined,
          text: nachricht.text,
          anhaenge: nachricht.attachments,
        });
      } catch (err) {
        app.log.warn(`Inhalt nicht abgelegt: ${(err as Error).message}`);
      }

      return mitVertrauen(nachricht);
    },
  );

  /**
   * Sichert einen ganzen Ordner als mbox-Datei.
   *
   * Strömend ausgeliefert, nicht am Stück: ein Ordner mit 31.700 Nachrichten wäre als
   * eine Antwort mehrere Gigabyte im Arbeitsspeicher. So beginnt der Browser zu
   * schreiben, während der Server noch holt.
   *
   * mbox, weil Thunderbird, Apple Mail und praktisch jedes Umstellungswerkzeug es
   * lesen - ohne diesen Weg wäre Energy Mail eine Einbahnstraße.
   */
  app.get<{
    Params: { id: string; folder: string };
    Querystring: { max?: string };
  }>('/accounts/:id/folders/:folder/sicherung', async (request, reply) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    /*
     * `max` ist freiwillig: ohne Angabe geht der ganze Ordner hinaus, und das ist der
     * gewollte Regelfall einer Sicherung. Ein leeres `?max=` zählt dabei als "nicht
     * angegeben" - es entsteht von selbst, wenn eine Oberfläche ein leeres Feld anhängt,
     * und wäre als Fehler nur lästig. Steht dagegen etwas da, muss es eine Zahl sein.
     */
    const rohMax = request.query.max;
    const hoechstens =
      rohMax === undefined || rohMax === ''
        ? undefined
        : zahlAus(rohMax, 'max', { von: 1, bis: 1_000_000 });

    reply.raw.setHeader('content-type', 'application/mbox; charset=utf-8');
    reply.raw.setHeader(
      'content-disposition',
      `attachment; filename="${dateiname(ordner, 'mbox')}"`,
    );

    try {
      const ergebnis = await exportiereAlsMbox(
        account,
        ordner,
        (stueck) =>
          new Promise<void>((fertig, schiefgegangen) => {
            // Auf das Abfließen warten: schreibt man schneller, als die Leitung
            // abnimmt, wächst der Puffer bis zum Speicherfehler.
            const platz = reply.raw.write(stueck, (err) => (err ? schiefgegangen(err) : fertig()));
            if (!platz) reply.raw.once('drain', () => undefined);
          }),
        {
          hoechstens,
          melde: (getan, von, text) =>
            meldeFortschritt({
              type: 'fortschritt',
              accountId: account.id,
              vorgang: 'sicherung',
              getan,
              von,
              text,
            }),
        },
      );
      app.log.info(
        `Sicherung ${ordner}: ${ergebnis.ausgegeben} ausgegeben, ${ergebnis.uebersprungen} übersprungen`,
      );
    } catch (err) {
      // Die Kopfzeilen sind längst hinaus - ein Fehlerstatus geht nicht mehr. Dann
      // wenigstens einen sichtbaren Vermerk in die Datei, statt sie still abzuschneiden.
      app.log.error(`Sicherung abgebrochen: ${(err as Error).message}`);
      reply.raw.write(`\n\nX-Energy-Mail-Abbruch: ${(err as Error).message}\n`);
    }

    reply.raw.end();
    return reply;
  });

  /**
   * Die Nachricht im Original. Bewusst nicht zwischengespeichert: sie wird selten
   * geholt, kann groß sein, und wer sie ansieht, will genau den Stand vom Server.
   */
  app.get<{ Params: { id: string; folder: string; uid: string } }>(
    '/accounts/:id/folders/:folder/messages/:uid/quelltext',
    async (request, reply) => {
      const account = requireAccount(request.params.id);
      const roh = await getRawMessage(
        account,
        decodeURIComponent(request.params.folder),
        uidAus(request.params.uid),
      );
      reply.type('text/plain; charset=utf-8');
      return roh;
    },
  );

  /**
   * Sammelaktionen nehmen eine UID-Liste entgegen. Eine einzeln markierte Nachricht ist
   * schlicht eine Liste mit einem Eintrag - dadurch gibt es nur einen Weg im Code, und
   * das Markieren von 20 Mails braucht trotzdem nur eine IMAP-Verbindung.
   */
  function parseUids(value: unknown): number[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new HttpError(400, t('Feld "uids" (nicht leere Liste) ist erforderlich'));
    }
    const uids = value.map(Number);
    if (uids.some((uid) => !Number.isInteger(uid) || uid <= 0)) {
      throw new HttpError(400, t('Feld "uids" enthält ungültige Werte'));
    }
    return uids;
  }

  app.patch<{ Params: { id: string; folder: string }; Body: { uids?: unknown; seen?: boolean } }>(
    '/accounts/:id/folders/:folder/messages',
    async (request) => {
      const account = requireAccount(request.params.id);
      if (typeof request.body?.seen !== 'boolean') {
        throw new HttpError(400, t('Feld "seen" (true/false) ist erforderlich'));
      }
      const ordner = decodeURIComponent(request.params.folder);
      const uids = parseUids(request.body.uids);
      await setMessagesSeen(account, ordner, uids, request.body.seen);
      verwerfeStaende(account.id, ordner);
      // Nachziehen statt verwerfen: das Öffnen einer Nachricht markiert sie als gelesen,
      // und die vorgehaltene Fassung soll deswegen nicht verlorengehen.
      aktualisiereGelesen(account.id, ordner, uids, request.body.seen);
      // Auch in der dauerhaften Ablage, sonst zeigte die Liste ohne Netz den alten Stand.
      ablageGelesen(account.id, ordner, uids, request.body.seen);
      return { ok: true };
    },
  );

  /**
   * Etiketten an Nachrichten hängen oder abnehmen.
   *
   * Die Antwort trägt "dauerhaft": ob der Ordner eigene Schlüsselwörter über das
   * Schließen hinaus behält. Ein Server, der das nicht tut, nimmt den Befehl trotzdem an
   * und vergisst ihn still - das muss die Oberfläche sagen können.
   */
  app.patch<{
    Params: { id: string; folder: string };
    Body: { uids?: unknown; hinzu?: string[]; weg?: string[] };
  }>('/accounts/:id/folders/:folder/etiketten', async (request) => {
    const account = requireAccount(request.params.id);
    const ordner = decodeURIComponent(request.params.folder);
    const uids = parseUids(request.body?.uids);
    const hinzu = (request.body?.hinzu ?? []).filter((s) => typeof s === 'string' && s.trim());
    const weg = (request.body?.weg ?? []).filter((s) => typeof s === 'string' && s.trim());

    if (hinzu.length === 0 && weg.length === 0) {
      throw new HttpError(400, t('Es wurde weder ein Etikett angehängt noch eines abgenommen'));
    }

    const ergebnis = await setzeEtiketten(account, ordner, uids, hinzu, weg);
    // Die vorgehaltenen Listen tragen die alten Flags - sonst zeigte die Liste das
    // Etikett erst nach dem nächsten Ordnerwechsel.
    verwerfeStaende(account.id, ordner);
    return ergebnis;
  });

  app.get<{ Params: { id: string; folder: string } }>(
    '/accounts/:id/folders/:folder/etiketten-moeglich',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      return { dauerhaft: await pruefeEtikettenUnterstuetzung(account, ordner) };
    },
  );

  app.get<{ Params: { id: string; folder: string; uid: string; partId: string } }>(
    '/accounts/:id/folders/:folder/messages/:uid/attachments/:partId',
    async (request, reply) => {
      const account = requireAccount(request.params.id);
      const attachment = await downloadAttachment(
        account,
        decodeURIComponent(request.params.folder),
        uidAus(request.params.uid),
        request.params.partId,
      );

      // RFC 5987: filename* transportiert Umlaute zuverlässig, filename bleibt als
      // Rückfallweg für ältere Empfänger erhalten.
      const asciiName = attachment.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
      reply
        .header('Content-Type', attachment.contentType)
        .header('Content-Length', attachment.size)
        .header(
          'Content-Disposition',
          `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
        );
      return reply.send(attachment.content);
    },
  );

  app.post<{
    Params: { id: string; folder: string };
    Body: { uids?: unknown; targetFolder?: string };
  }>('/accounts/:id/folders/:folder/messages/move', async (request) => {
    const account = requireAccount(request.params.id);
    if (!request.body?.targetFolder) {
      throw new HttpError(400, t('Feld "targetFolder" ist erforderlich'));
    }
    const ordner = decodeURIComponent(request.params.folder);
    const uids = parseUids(request.body.uids);
    const { neueUids } = await moveMessages(account, ordner, uids, request.body.targetFolder);
    verwerfeStaende(account.id, ordner, request.body.targetFolder);
    // Im Quellordner gibt es diese UIDs nicht mehr; im Zielordner haben sie andere.
    for (const uid of uids) verwirfNachrichten(nachrichtenSchluessel(account.id, ordner, uid));
    ablageEntfernen(account.id, ordner, uids);
    // Die neuen Nummern kommen mit zurück: nur mit ihnen lässt sich das Verschieben
    // wieder rückgängig machen. Ohne UIDPLUS bleibt die Liste leer.
    return { ok: true, neueUids };
  });

  app.post<{ Params: { id: string; folder: string }; Body: { uids?: unknown } }>(
    '/accounts/:id/folders/:folder/messages/delete',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      const uids = parseUids(request.body?.uids);
      await deleteMessages(account, ordner, uids);
      verwerfeStaende(account.id, ordner);
      for (const uid of uids) verwirfNachrichten(nachrichtenSchluessel(account.id, ordner, uid));
      ablageEntfernen(account.id, ordner, uids);
      return { ok: true };
    },
  );

  /** Liest die Sucheinschränkungen aus der Anfrage. */
  function parseKriterien(q: Record<string, string | undefined>): SearchCriteria {
    return {
      text: q.q?.trim() || undefined,
      from: q.from?.trim() || undefined,
      subject: q.subject?.trim() || undefined,
      since: q.since || undefined,
      before: q.before || undefined,
      unreadOnly: q.unread === '1',
      withAttachment: q.attachment === '1',
      etikett: q.etikett?.trim() || undefined,
      category: parseCategory(q.category),
    };
  }

  const hatEinschraenkung = (k: SearchCriteria) =>
    Boolean(
      k.text ||
        k.from ||
        k.subject ||
        k.since ||
        k.before ||
        k.unreadOnly ||
        k.withAttachment ||
        k.etikett,
    );

  app.get<{
    Params: { id: string; folder: string };
    Querystring: Record<string, string | undefined>;
  }>('/accounts/:id/folders/:folder/search', async (request) => {
    const account = requireAccount(request.params.id);
    const kriterien = parseKriterien(request.query);
    if (!hatEinschraenkung(kriterien)) {
      return { messages: [], total: 0, nextCursor: null, hasMore: false };
    }
    // Geprüft wie auf dem Listenweg daneben - eine unbrauchbare Angabe ist ein Fehler des
    // Aufrufers und keine Einladung, den ganzen Ordner durchzumustern.
    return searchMessages(account, decodeURIComponent(request.params.folder), kriterien, {
      beforeUid:
        request.query.beforeUid === undefined || request.query.beforeUid === ''
          ? undefined
          : uidAus(request.query.beforeUid, 'beforeUid'),
      pageSize: zahlAus(request.query.pageSize, 'pageSize', {
        von: 1,
        bis: 500,
        standard: DEFAULT_SEITENGROESSE,
      }),
    });
  });

  /**
   * Die Suche in der lokalen Ablage.
   *
   * Antwortet sofort statt in Hunderten von Millisekunden und funktioniert auch ohne
   * Netz. Sie durchsucht Betreff, Absender und Empfänger aller abgelegten Nachrichten
   * und den Text derer, die schon geöffnet waren - was sie nicht abdeckt, meldet sie
   * mit, damit die Oberfläche daneben die Suche über den Server anbieten kann.
   */
  app.get<{ Params: { id: string }; Querystring: { q?: string; folder?: string } }>(
    '/accounts/:id/suche-lokal',
    async (request) => {
      const account = requireAccount(request.params.id);
      const text = request.query.q ?? '';
      const ordner = request.query.folder ? decodeURIComponent(request.query.folder) : undefined;

      const begonnen = Date.now();
      const treffer = sucheLokal(account.id, text, { ordner });
      return {
        treffer,
        dauerMs: Date.now() - begonnen,
        // Woraus gesucht wurde - Grundlage für den Hinweis in der Oberfläche.
        bestand: suchbestand(account.id),
        verfuegbar: sucheVerfuegbar(),
      };
    },
  );

  /**
   * Welche Ordner eines Kontos durchsucht werden.
   *
   * Gmail führt jede Nachricht zusätzlich in "Alle Nachrichten" - dort genügt ein
   * einziger Suchlauf statt acht. Bei anderen Anbietern wird über die Ordner gegangen,
   * ohne Papierkorb und Spam: wer sucht, meint in aller Regel nicht das Weggeworfene.
   */
  async function suchOrdner(account: AccountConfig): Promise<string[]> {
    const alle = await listFolders(account);
    const alleNachrichten = alle.find((f) => f.isAllMail && f.selectable);
    if (alleNachrichten) return [alleNachrichten.path];
    return alle
      .filter((f) => f.selectable && f.specialUse !== '\\Trash' && f.specialUse !== '\\Junk')
      .map((f) => f.path);
  }

  /** Suche über alle Ordner eines Kontos. */
  app.get<{ Params: { id: string }; Querystring: Record<string, string | undefined> }>(
    '/accounts/:id/search',
    async (request) => {
      const account = requireAccount(request.params.id);
      const kriterien = parseKriterien(request.query);
      if (!hatEinschraenkung(kriterien)) return { hits: [], total: 0, hasMore: false };

      const grenze = zahlAus(request.query.pageSize, 'pageSize', { von: 1, bis: 500, standard: DEFAULT_SEITENGROESSE });
      const ergebnis = await searchFolders(account, await suchOrdner(account), kriterien, grenze);
      return {
        ...ergebnis,
        hits: ergebnis.hits.map((h) => ({ ...h, accountId: account.id, email: account.email })),
      };
    },
  );

  /**
   * Suche über alle Konten. Nacheinander statt gleichzeitig - die Anbieter reagieren
   * empfindlich auf Verbindungssalven, und ein Konto, das gerade nicht erreichbar ist,
   * soll die Treffer der übrigen nicht verhindern.
   */
  app.get<{ Querystring: Record<string, string | undefined> }>('/search', async (request) => {
    const kriterien = parseKriterien(request.query);
    if (!hatEinschraenkung(kriterien)) return { hits: [], total: 0, hasMore: false };

    const grenze = zahlAus(request.query.pageSize, 'pageSize', { von: 1, bis: 500, standard: DEFAULT_SEITENGROESSE });
    const treffer = [];
    let gesamt = 0;

    for (const account of listAccounts()) {
      try {
        const ergebnis = await searchFolders(account, await suchOrdner(account), kriterien, grenze);
        gesamt += ergebnis.total;
        treffer.push(
          ...ergebnis.hits.map((h) => ({ ...h, accountId: account.id, email: account.email })),
        );
      } catch (err) {
        app.log.warn(`Suche in ${account.email} fehlgeschlagen: ${(err as Error).message}`);
      }
    }

    treffer.sort((a, b) => new Date(b.date ?? 0).getTime() - new Date(a.date ?? 0).getTime());
    return { hits: treffer.slice(0, grenze), total: gesamt, hasMore: gesamt > grenze };
  });

  /** Anhänge kommen über JSON, daher base64-kodiert - hier zurück in Rohbytes. */
  interface WireAttachment {
    filename?: string;
    contentType?: string;
    contentBase64?: string;
  }

  /**
   * Beim Weiterleiten sollen die Anhänge der Ursprungsnachricht übernommen werden.
   * Der Server holt sie direkt per IMAP - anders müssten sie erst zum Browser
   * heruntergeladen und base64-kodiert wieder hochgeladen werden.
   */
  interface ForwardSource {
    folder: string;
    uid: number;
    partIds: string[];
  }

  /**
   * Was eine Oberfläche zum Senden schicken darf.
   *
   * `kopfzeilen` ist ausdrücklich AUSGENOMMEN, und das ist keine Aufräumarbeit. Es kam mit
   * der Abwesenheitsnotiz hinzu, damit der Server `Auto-Submitted` setzen kann - und weil
   * der Rest des Körpers unverändert in die Nachricht wandert, hätte ein Client damit
   * beliebige Kopfzeilen einschleusen können: ein gefälschtes `Sender:`, ein
   * `Auto-Submitted`, das die Nachricht bei der Gegenseite unsichtbar macht, ein
   * `Disposition-Notification-To` auf ein fremdes Postfach. Kopfzeilen setzt der Server,
   * nicht die Oberfläche.
   */
  type SendBody = Omit<OutgoingMessage, 'attachments' | 'kopfzeilen'> & {
    attachments?: WireAttachment[];
    attachOriginal?: ForwardSource;
    /** Ob mit OpenPGP geschuetzt versendet wird. */
    pgp?: 'signieren' | 'verschluesseln';
    /** Kennwort des geheimen Schluessels - wird nur benutzt, nie abgelegt. */
    pgpKennwort?: string;
    /** Dasselbe mit S/MIME. Beides zugleich gibt es nicht - siehe baueGeschuetzt(). */
    smime?: 'signieren' | 'verschluesseln';
    smimeKennwort?: string;
    /**
     * Ob der Absender eine Lesebestätigung haben möchte.
     *
     * Ein Schalter und keine Adresse: Wohin sie geht, bestimmt der Server - es ist die
     * Adresse, unter der gesendet wird. Eine mitgeschickte Adresse wäre genau der
     * Missbrauch, gegen den die Bestätigungsseite abgesichert ist.
     */
    lesebestaetigung?: boolean;
  };

  type Attachment = NonNullable<OutgoingMessage['attachments']>[number];

  /**
   * Führt hochgeladene und aus einer bestehenden Nachricht übernommene Anhänge zusammen.
   * Wird beim Senden wie beim Speichern eines Entwurfs gebraucht.
   */
  async function collectAttachments(
    account: AccountConfig,
    wire: WireAttachment[] | undefined,
    source: ForwardSource | undefined,
  ): Promise<Attachment[]> {
    const attachments: Attachment[] = (wire ?? []).map((att, index) => {
      if (!att.contentBase64) {
        throw new HttpError(400, `Anhang ${index + 1} enthält keine Daten.`);
      }
      return {
        filename: att.filename || `anhang-${index + 1}`,
        content: Buffer.from(att.contentBase64, 'base64'),
        contentType: att.contentType || undefined,
      };
    });

    for (const partId of source?.partIds ?? []) {
      const original = await downloadAttachment(
        account,
        decodeURIComponent(source!.folder),
        Number(source!.uid),
        partId,
      );
      attachments.push({
        filename: original.filename,
        content: original.content,
        contentType: original.contentType,
      });
    }

    return attachments;
  }

  /**
   * Der eigentliche Versand - von der Sofort-Route wie von der Warteschlange benutzt.
   *
   * Bewusst eine gemeinsame Stelle: sonst liefen zwei Wege auseinander, und eine
   * verzögert gesendete Nachricht landete etwa nicht im Gesendet-Ordner oder ließe
   * ihren Entwurf stehen.
   */
  /** Aus HTML wird Text - für den Fall, dass nur eine formatierte Fassung vorliegt. */
  const entferneHtml = (html: string) =>
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .trim();

  /**
   * Baut die geschützte Fassung einer Nachricht - oder null, wenn kein Schutz gewünscht ist.
   *
   * Verschlüsselt wird nur, wenn für JEDEN Empfänger ein Schlüssel vorliegt. Einen zu
   * übergehen hieße, ihm etwas Unlesbares zu schicken, ohne dass es jemandem auffiele.
   */
  async function baueGeschuetzt(
    account: AccountConfig,
    message: Omit<SendBody, 'attachments' | 'attachOriginal'>,
    attachments: Attachment[],
    pgp: 'signieren' | 'verschluesseln' | undefined,
    kennwort: string | undefined,
  ): Promise<OutgoingMessage | null> {
    if (!pgp) return null;

    const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
    const eigene = geheimeFuer(account.id, adressen);
    if (eigene.length === 0) {
      throw new HttpError(400, t('Für dieses Konto ist kein geheimer Schlüssel hinterlegt.'));
    }
    const klartext = message.text?.trim() || entferneHtml(message.html ?? '');
    if (!klartext) throw new HttpError(400, t('Eine leere Nachricht lässt sich nicht schützen.'));
    const eigener = { armored: eigene[0]!, kennwort };

    if (pgp === 'verschluesseln') {
      if (attachments.length > 0) {
        throw new HttpError(400, ANHANG_NUR_SIGNIERT());
      }
      const empfaenger = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
      const schluessel: string[] = [];
      const fehlend: string[] = [];
      for (const adresse of empfaenger) {
        const gefunden = oeffentlicheFuer(adresse);
        if (gefunden.length === 0) fehlend.push(adresse);
        else schluessel.push(gefunden[gefunden.length - 1]!.armored);
      }
      if (fehlend.length > 0) {
        throw new HttpError(
          400,
          `Kein Schlüssel vorhanden für: ${fehlend.join(', ')}. Diese Empfänger könnten die Nachricht nicht lesen.`,
        );
      }
      return {
        ...message,
        text: undefined,
        html: undefined,
        pgpGeheimtext: await verschluessle(klartext, schluessel, eigener),
      };
    }

    /*
     * Unterschrieben wird der fertige MIME-Teil, nicht der nackte Text: genau diese
     * Bytes gehen hinaus, und genau sie prueft der Empfaenger.
     *
     * Mit Anhaengen wird daraus ein mehrteiliger Umschlag, und die Unterschrift deckt ihn
     * vollstaendig ab - Text UND Dateien. Ein Schutz, der nur den Text erfasst und die
     * Anhaenge daneben offen mitschickt, waere schlimmer als keiner.
     */
    const teil = baueSigniertenTeil(klartext, attachments);
    return {
      ...message,
      text: klartext,
      html: undefined,
      pgpSignierterTeil: teil,
      pgpSignatur: await signiereAbgetrennt(teil, eigener.armored, eigener.kennwort),
    };
  }

  /**
   * Dasselbe mit S/MIME.
   *
   * Ein eigener Weg und keine Verzweigung im PGP-Weg: Die beiden bauen die Nachricht
   * verschieden, und ein gemeinsamer Weg mit zwei Wenn-Zweigen an jeder Stelle waere
   * genau die Sorte Code, in der sich ein Fehler versteckt, den niemand sieht - weil ihn
   * nur die Haelfte der Nutzer trifft.
   *
   * Ein Unterschied zu PGP steckt im Verschluesseln: Hier wird IMMER zuerst
   * unterschrieben und dann verschlossen. Die Unterschrift steckt damit im Umschlag, und
   * nur so beweist sie etwas - eine ausserhalb liesse sich austauschen, ohne den Inhalt
   * zu beruehren.
   */
  async function baueSmimeGeschuetzt(
    account: AccountConfig,
    message: Omit<SendBody, 'attachments' | 'attachOriginal'>,
    attachments: Attachment[],
    smime: 'signieren' | 'verschluesseln',
    kennwort: string | undefined,
  ): Promise<OutgoingMessage> {
    const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
    const eigene = eigeneFuer(account.id, adressen);
    if (eigene.length === 0) {
      throw new HttpError(400, t('Für dieses Konto ist kein eigenes Zertifikat hinterlegt.'));
    }
    if (smime === 'verschluesseln' && attachments.length > 0) {
      throw new HttpError(400, ANHANG_NUR_SIGNIERT());
    }
    const klartext = message.text?.trim() || entferneHtml(message.html ?? '');
    if (!klartext) throw new HttpError(400, t('Eine leere Nachricht lässt sich nicht schützen.'));

    const eigenes = eigene[0]!;
    let schluessel;
    try {
      schluessel = eigenes.schluessel(kennwort);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }

    // Wie bei PGP: mit Anhaengen wird der unterschriebene Teil mehrteilig, und die
    // Unterschrift deckt Text und Dateien zusammen ab.
    const teil = baueSigniertenTeil(klartext, attachments);
    const signatur = baueSignierteDaten({
      inhalt: Buffer.from(teil, 'utf8'),
      zertifikat: eigenes.zertifikat,
      schluessel,
      kette: eigenes.kette,
    });

    if (smime === 'signieren') {
      return {
        ...message,
        text: klartext,
        html: undefined,
        smimeSignierterTeil: teil,
        smimeSignatur: signatur.toString('base64'),
      };
    }

    const empfaenger = [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])];
    const zertifikate: Buffer[] = [];
    const faehigkeiten: string[][] = [];
    const fehlend: string[] = [];
    for (const adresse of empfaenger) {
      const gefunden = zertifikateFuer(adresse);
      if (gefunden.length === 0) fehlend.push(adresse);
      else {
        zertifikate.push(gefunden[0]!.zertifikat);
        faehigkeiten.push(gefunden[0]!.faehigkeiten);
      }
    }
    if (fehlend.length > 0) {
      throw new HttpError(
        400,
        `Kein Zertifikat vorhanden für: ${fehlend.join(', ')}. Diese Empfänger könnten die Nachricht nicht lesen.`,
      );
    }

    /*
     * Das eigene Zertifikat gehoert mit unter die Empfaenger - sonst waere die Kopie im
     * Gesendet-Ordner fuer immer unlesbar. Und die eigenen Faehigkeiten zaehlen mit: Was
     * wir selbst nicht lesen koennen, darf nicht gewaehlt werden.
     */
    zertifikate.push(eigenes.zertifikat);
    faehigkeiten.push([SmimeBezeichner.aes256Gcm]);

    const innen = baueSigniertePost(teil, signatur, `=_EnergyMail_${randomBytes(18).toString('base64url')}`);
    return {
      ...message,
      text: undefined,
      html: undefined,
      smimeGeheimtext: baueUmschlag({
        inhalt: alsBytes(innen),
        empfaenger: zertifikate,
        verfahren: besteVerschluesselung(faehigkeiten),
      }).toString('base64'),
    };
  }

  /**
   * Was sich vor dem Versand feststellen lässt, ohne etwas zu verschlüsseln.
   *
   * ## Warum es diese Funktion gibt
   *
   * Ein verzögerter Versand wanderte bisher ungeprüft in die Warteschlange. Geprüft wurde
   * erst beim Auslösen - also Stunden oder Tage später, wenn niemand mehr davorsitzt. Wer
   * eine geschützte Nachricht mit Anhang auf morgen früh legte, bekam "geplant" bestätigt
   * und erfuhr nie, dass sie nicht hinausging: Am nächsten Morgen scheiterte sie an einer
   * Prüfung, die schon beim Einstellen gegriffen hätte.
   *
   * Deshalb steht das hier und nicht in `baueGeschuetzt` allein: EINE Stelle, die beide
   * Wege benutzen. Die Prüfungen in den Bauwegen bleiben daneben stehen - sie sind die
   * letzte Sicherung, und die soll nicht davon abhängen, dass jemand vorher gefragt hat.
   *
   * Geprüft wird ausschließlich, was ohne Kennwort und ohne Netz feststeht. Ob der
   * geheime Schlüssel mit dem eingegebenen Kennwort aufgeht, gehört nicht dazu - danach
   * fragt die Oberfläche unmittelbar vor dem Absenden.
   */
  function pruefeVersandVorab(account: AccountConfig, koerper: SendBody): void {
    const empfaenger = [...(koerper.to ?? []), ...(koerper.cc ?? []), ...(koerper.bcc ?? [])];
    if (empfaenger.length === 0) {
      throw new HttpError(400, t('Die Nachricht hat keinen Empfänger.'));
    }

    const { pgp, smime } = koerper;
    if (pgp && smime) {
      throw new HttpError(
        400,
        t('Eine Nachricht lässt sich nur mit einem der beiden Verfahren schützen.'),
      );
    }
    if (!pgp && !smime) return;

    /*
     * Anhänge gehen beim Unterschreiben mit, beim Verschlüsseln (noch) nicht.
     *
     * Unterschrieben wird ein mehrteiliger MIME-Umschlag, der Text und Dateien zusammen
     * enthält - der Empfänger sieht die Anhänge wie bei jeder anderen Nachricht, und die
     * Unterschrift deckt sie mit ab.
     *
     * Beim Verschlüsseln fehlt die Gegenseite: Der Leser dieser Anwendung gibt den
     * entschlüsselten Inhalt unmittelbar als Text aus, statt ihn als MIME zu zerlegen.
     * Verschlüsselte Anhänge kämen damit zwar heil an, würden hier aber als
     * Quelltext angezeigt statt als Dateien. Lieber eine klar benannte Grenze als eine
     * Nachricht, bei der niemand weiß, was er vor sich hat.
     */
    const anhaenge =
      (koerper.attachments?.length ?? 0) + (koerper.attachOriginal?.partIds.length ?? 0);
    if (anhaenge > 0 && (pgp === 'verschluesseln' || smime === 'verschluesseln')) {
      throw new HttpError(400, ANHANG_NUR_SIGNIERT());
    }

    if (!koerper.text?.trim() && !koerper.html?.trim()) {
      throw new HttpError(400, t('Eine leere Nachricht lässt sich nicht schützen.'));
    }

    const adressen = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];

    if (smime) {
      if (eigeneFuer(account.id, adressen).length === 0) {
        throw new HttpError(400, t('Für dieses Konto ist kein eigenes Zertifikat hinterlegt.'));
      }
      if (smime === 'verschluesseln') {
        const fehlend = empfaenger.filter((a) => zertifikateFuer(a).length === 0);
        if (fehlend.length > 0) {
          throw new HttpError(
            400,
            `Kein Zertifikat vorhanden für: ${fehlend.join(', ')}. Diese Empfänger könnten die Nachricht nicht lesen.`,
          );
        }
      }
      return;
    }

    if (geheimeFuer(account.id, adressen).length === 0) {
      throw new HttpError(400, t('Für dieses Konto ist kein geheimer Schlüssel hinterlegt.'));
    }
    if (pgp === 'verschluesseln') {
      const fehlend = empfaenger.filter((a) => oeffentlicheFuer(a).length === 0);
      if (fehlend.length > 0) {
        throw new HttpError(
          400,
          `Kein Schlüssel vorhanden für: ${fehlend.join(', ')}. Diese Empfänger könnten die Nachricht nicht lesen.`,
        );
      }
    }
  }

  async function fuehreVersandAus(
    account: AccountConfig,
    koerper: SendBody & { draftFolder?: string; draftUid?: number },
  ) {
    pruefeVersandVorab(account, koerper);
    const {
      attachOriginal,
      attachments: wire,
      draftFolder,
      draftUid,
      pgp,
      pgpKennwort,
      smime,
      smimeKennwort,
      lesebestaetigung,
      /*
       * Weggeworfen, und zwar ausdrücklich.
       *
       * Der Rest dieses Körpers wandert unverändert in die Nachricht. Käme hier ein
       * `kopfzeilen` einer Oberfläche mit, ließen sich beliebige Kopfzeilen einschleusen -
       * ein gefälschtes `Sender:`, ein `Disposition-Notification-To` auf ein fremdes
       * Postfach. Was der Server setzt, setzt der Server.
       */
      kopfzeilen: _verworfen,
      ...message
    } = koerper as SendBody & {
      draftFolder?: string;
      draftUid?: number;
      pgp?: 'signieren' | 'verschluesseln';
      pgpKennwort?: string;
      smime?: 'signieren' | 'verschluesseln';
      smimeKennwort?: string;
      kopfzeilen?: Record<string, string>;
    };
    const attachments = await collectAttachments(account, wire, attachOriginal);

    /*
     * Beides zugleich gibt es nicht, und zwar mit Absicht. Eine Nachricht, die mit PGP
     * UND mit S/MIME unterschrieben ist, hat kein festes Aussehen - jedes Programm zeigt
     * etwas anderes an, und manche zeigen die eine Unterschrift und verschlucken die
     * andere. Zwei Haken, von denen der Empfaenger nur einen sieht, sind schlechter als
     * einer, den er sicher sieht.
     */
    if (pgp && smime) {
      throw new HttpError(400, t('Eine Nachricht lässt sich nur mit einem der beiden Verfahren schützen.'));
    }

    /**
     * Mit OpenPGP geschützt versenden.
     *
     * Bewusst eng gefasst: geschützt wird der Text, und zwar als Ganzes. Anhänge bleiben
     * außen vor - sie mitzunehmen wäre möglich, ist aber eine eigene Baustelle, und ein
     * klarer Hinweis ist besser als eine Nachricht, bei der niemand weiß, was nun
     * geschützt ist und was nicht.
     */
    const geschuetzt = smime
      ? await baueSmimeGeschuetzt(account, message, attachments, smime, smimeKennwort)
      : await baueGeschuetzt(account, message, attachments, pgp, pgpKennwort);

    /**
     * Wer im Auftrag eines anderen sendet, sagt es in der Kopfzeile.
     *
     * `From` bleibt die Adresse des Postfachs - der Empfänger antwortet dorthin, und
     * genau das ist gewollt. Daneben steht `Sender` mit der Adresse dessen, der wirklich
     * getippt hat; Outlook und Thunderbird zeigen daraufhin "Bernd im Auftrag von Anna".
     *
     * Das ist keine Feinheit, sondern die einzige ehrliche Bauart. Ohne diese Zeile
     * verschickte ein Vertreter Post, die aussieht, als hätte sie der Eigentümer
     * geschrieben - im Namen eines Menschen, der nichts davon weiß. Auf SPF und DMARC
     * wirkt sie nicht: Der Umschlagabsender bleibt unverändert, und DMARC richtet sich
     * nach `From`.
     */
    const vertretung = vertretungFuer();
    const imAuftrag = vertretung ? findeNutzer(vertretung.handelnd)?.email : undefined;

    /**
     * Die eigene Bitte um eine Lesebestätigung.
     *
     * Die Adresse bestimmt der Server: die, unter der gesendet wird. Sie vom Client
     * setzen zu lassen wäre genau der Missbrauch, gegen den die Empfangsseite abgesichert
     * ist - eine Nachricht an einen Verteiler, deren Bestätigungen woandershin gehen.
     */
    const bitteUmBestaetigung: Record<string, string> = lesebestaetigung
      ? { 'Disposition-Notification-To': message.absender?.email ?? account.email }
      : {};
    if (imAuftrag) {
      protokolliere(
        'info',
        'senden',
        `"${vertretung!.handelnd}" sendet im Auftrag von "${vertretung!.besitzer}" über ${account.email}.`,
      );
    }

    const zusatz = { ...bitteUmBestaetigung, ...(imAuftrag ? { Sender: imAuftrag } : {}) };
    const result = await sendMessage(
      account,
      geschuetzt
        ? { ...geschuetzt, kopfzeilen: { ...geschuetzt.kopfzeilen, ...zusatz } }
        : { ...message, attachments, kopfzeilen: zusatz },
    );

    /*
     * Ins Archiv, sofort nach dem Versand und mit den Bytes, die wirklich hinausgingen.
     *
     * Hier und nicht in sendMessage(): Die Frage, ob ein Konto aufgezeichnet wird, ist
     * eine des Servers und nicht des Mailversands - mail-core weiss nichts von Nutzern,
     * Fristen und Archiven, und das soll so bleiben.
     */
    erfasseVersand(account, message, result.raw);

    // Nach erfolgreichem Versand hat der Entwurf ausgedient.
    if (draftFolder && draftUid) {
      try {
        await discardDraft(account, decodeURIComponent(draftFolder), draftUid);
      } catch (err) {
        app.log.warn(`Entwurf konnte nicht entfernt werden: ${(err as Error).message}`);
      }
    }

    rememberAddresses(
      [...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])].map((address) => ({ address })),
    );

    // Im Gesendet-Ordner liegt jetzt eine Nachricht mehr, im Entwürfe-Ordner eine weniger.
    verwerfeStaende(account.id, result.sentFolder, draftFolder && decodeURIComponent(draftFolder));
    return result;
  }

  setSendeVerfahren(async (sendung) => {
    const account = getAccount(sendung.accountId);
    if (!account) throw new Error(t('Das Konto gibt es nicht mehr.'));
    await fuehreVersandAus(account, sendung.koerper as SendBody);
  }, (msg) => app.log.info(msg));

  /**
   * Was mit einer Nachricht geschieht, die endgültig nicht hinausgeht.
   *
   * Sie wird als Entwurf ins Postfach gelegt. Damit steht sie dort, wo ein Mensch sie
   * sucht - im Entwürfe-Ordner, auch am Handy -, statt in einer Datei zu liegen, die keine
   * Oberfläche zeigt.
   *
   * Die Warteschlange löscht den Eintrag erst, wenn diese Funktion `true` sagt. Solange
   * hier etwas schiefgeht, bleibt der Körper dort liegen und wird weiter versucht; ein
   * fehlgeschlagener Versand darf keine Nachricht kosten.
   *
   * Der Nutzerkontext trägt bis hierher: Der Zeitgeber, aus dem der Aufruf kommt, ist
   * innerhalb von `alsNutzer()` entstanden - siehe den Block über den Hintergrundnutzern.
   */
  setAufgabeVerfahren(async (sendung: GeplanteSendung, grund: string) => {
    const account = getAccount(sendung.accountId);
    if (!account) {
      /*
       * Ohne Konto gibt es keinen Entwürfe-Ordner mehr, in den etwas passte. Hier ist
       * `true` richtig: Weiterversuchen könnte an dieser Lage nichts ändern, und ein
       * Eintrag, der ewig kreist, wäre schlechter als ein vermerkter Verlust.
       */
      protokolliere(
        'warnung',
        'senden',
        `Die geplante Nachricht "${sendung.betreff}" gehört zu einem entfernten Konto und ` +
          `ließ sich nicht ablegen: ${grund}`,
      );
      return true;
    }

    const koerper = sendung.koerper as SendBody & { draftFolder?: string; draftUid?: number };
    try {
      const attachments = await collectAttachments(
        account,
        koerper.attachments,
        koerper.attachOriginal,
      );
      const { folder, uid } = await saveDraft(account, {
        ...koerper,
        to: koerper.to ?? [],
        subject: koerper.subject ?? '',
        attachments,
      } as OutgoingMessage);
      verwerfeStaende(account.id, folder);
      meldeAktualisierung({
        type: 'data-updated',
        accountId: account.id,
        was: 'messages',
        folder,
      });
      protokolliere(
        'warnung',
        'senden',
        `"${sendung.betreff}" ging nicht hinaus (${grund}) und liegt jetzt als Entwurf in ` +
          `"${folder}" (Nr. ${uid}).`,
      );
      return true;
    } catch (err) {
      app.log.warn(
        `Entwurf für die aufgegebene Sendung "${sendung.betreff}" ließ sich nicht ablegen: ` +
          `${(err as Error).message}`,
      );
      return false;
    }
  });

  // ladeGeplanteSendungen() steht bewusst nicht hier, sondern ganz am Ende - siehe dort.

  app.post<{
    Params: { id: string };
    Body: SendBody & { draftFolder?: string; draftUid?: number };
  }>('/accounts/:id/send', async (request, reply) => {
    const account = requireAccount(request.params.id);

    /*
     * Hier stand eine Zerlegung des Rumpfes, deren Ergebnis niemand mehr benutzte:
     * `const { attachOriginal, attachments: wire, draftFolder, draftUid, ...message }`.
     * Sie stammte aus einer früheren Fassung, in der die Nachricht daraus zusammengesetzt
     * wurde; heute geht durchweg `request.body` weiter - an pruefeVersandVorab, an
     * planeSendung und an fuehreVersandAus.
     *
     * Weg damit, und zwar nicht nur der Ordnung halber: Die Zeile las sich, als würden
     * draftFolder und draftUid vom Versand ferngehalten. Sie werden es nicht.
     */

    // Mit Verzögerung: nicht senden, sondern vormerken. Der Körper wandert unverändert
    // in die Warteschlange - Anhänge werden erst beim tatsächlichen Versand aus dem
    // Postfach geholt, sonst läge eine 20-MB-Datei in der Warteschlangendatei.
    const verzoegerung = Number((request.body as { sendenIn?: number }).sendenIn ?? 0);
    const zeitpunkt = (request.body as { sendenAm?: string }).sendenAm;
    if (verzoegerung > 0 || zeitpunkt) {
      const faellig = zeitpunkt ? new Date(zeitpunkt).getTime() : Date.now() + verzoegerung * 1000;
      if (!Number.isFinite(faellig)) throw new HttpError(400, t('Unbrauchbarer Zeitpunkt.'));
      /*
       * Ein Zeitpunkt, der schon vorbei ist, wird abgewiesen und nicht stillschweigend zu
       * "sofort" gemacht - dieselbe Haltung wie bei der Wiedervorlage. Wer den 3. auf den
       * 2. legt, hat sich vertippt, und das soll er sehen.
       *
       * Die Bedenkzeit nach dem Absenden geht über `sendenIn` und ist damit immer in der
       * Zukunft; sie ist von dieser Prüfung nicht betroffen.
       */
      if (faellig <= Date.now()) {
        throw new HttpError(400, t('Der Zeitpunkt liegt in der Vergangenheit.'));
      }
      if (faellig > Date.now() + FUENF_JAHRE_MS) {
        throw new HttpError(400, t('Der Zeitpunkt liegt zu weit in der Zukunft.'));
      }
      // Erst prüfen, dann vormerken - siehe pruefeVersandVorab.
      pruefeVersandVorab(account, request.body);
      const sendung = planeSendung(account.id, request.body as Record<string, unknown>, faellig);
      return { ok: true, geplant: true, id: sendung.id, faellig: sendung.faellig };
    }

    try {
      return { ok: true, ...(await fuehreVersandAus(account, request.body)) };
    } catch (err) {
      /*
       * Ein Fehler, der seinen Rang schon kennt, behält ihn.
       *
       * `fuehreVersandAus` weist Eingabefehler mit 400 ab: kein hinterlegter Schlüssel,
       * ein Anhang bei geschütztem Versand, beide Schutzverfahren zugleich. Hier stand
       * pauschal `reply.code(502)` darüber - aus "so nicht" wurde damit "die Gegenstelle
       * hat versagt". Das ist nicht nur der falsche Rang, es ist die falsche Auskunft:
       * 502 lädt zum erneuten Versuch ein, und der kann bei einer Eingabe, die nicht
       * stimmt, niemals helfen.
       *
       * Alles Übrige bleibt 502 - dort ist die Gegenstelle wirklich die Ursache.
       */
      if (err instanceof HttpError) throw err;
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  /**
   * Antwortet auf eine Besprechungseinladung.
   *
   * Die Einladung wird dabei frisch aus der Nachricht gelesen und nicht vom Fenster
   * entgegengenommen: alles, was in die Antwort geht - Kennung, Fassung, Beginn,
   * Organisator - muss mit dem Original übereinstimmen, und was durch die Oberfläche
   * gelaufen ist, muss man erst wieder prüfen.
   */
  app.post<{
    Params: { id: string; folder: string; uid: string };
    Body: { antwort?: Antwort; bemerkung?: string };
  }>('/accounts/:id/folders/:folder/messages/:uid/einladung', async (request, reply) => {
    const account = requireAccount(request.params.id);
    const antwort = request.body?.antwort;
    if (antwort !== 'zusagen' && antwort !== 'absagen' && antwort !== 'vorbehalten') {
      throw new HttpError(400, t('Feld "antwort" muss zusagen, absagen oder vorbehalten sein'));
    }

    const ordner = decodeURIComponent(request.params.folder);
    const nachricht = await getMessage(account, ordner, uidAus(request.params.uid));
    const termin = nachricht.einladung?.termine[0];
    if (!termin) throw new HttpError(400, t('Diese Nachricht enthält keine Einladung'));
    if (!termin.organisator?.adresse) {
      throw new HttpError(400, t('Die Einladung nennt niemanden, an den eine Antwort ginge'));
    }

    /**
     * Unter welcher Adresse geantwortet wird.
     *
     * Die Einladung ging an eine bestimmte Adresse - womöglich an einen Alias und nicht
     * an die des Kontos. Der Organisator ordnet die Antwort über die Adresse zu; kommt
     * sie unter einer anderen, steht der Eingeladene weiterhin auf "offen".
     */
    const eigene = [account.email, ...(account.identitaeten ?? []).map((i) => i.email)];
    const eingeladen = termin.teilnehmer.find((t) =>
      eigene.some((e) => e.toLowerCase() === t.adresse.toLowerCase()),
    );
    const alsWer = eingeladen?.adresse ?? account.email;
    const identitaet = (account.identitaeten ?? []).find(
      (i) => i.email.toLowerCase() === alsWer.toLowerCase(),
    );

    const wort = {
      zusagen: t('Zusage'),
      absagen: t('Absage'),
      vorbehalten: t('Mit Vorbehalt'),
    }[antwort];
    const ics = baueAntwort(
      termin,
      { adresse: alsWer, name: identitaet?.displayName ?? account.displayName },
      antwort,
    );

    try {
      const ergebnis = await sendMessage(account, {
        to: [termin.organisator.adresse],
        subject: `${wort}: ${termin.titel || nachricht.subject}`,
        text:
          `${wort} zu „${termin.titel || nachricht.subject}“.` +
          (request.body?.bemerkung ? `\n\n${request.body.bemerkung}` : ''),
        absender: identitaet
          ? { email: identitaet.email, displayName: identitaet.displayName }
          : undefined,
        kalenderAntwort: ics,
      });
      return { ok: true, an: termin.organisator.adresse, als: alsWer, ...ergebnis };
    } catch (err) {
      reply.code(502);
      return { error: (err as Error).message };
    }
  });

  /** Holt eine vorgemerkte Nachricht zurück und gibt sie zum Weiterbearbeiten heraus. */
  app.delete<{ Params: { id: string; sendungId: string } }>(
    '/accounts/:id/send/:sendungId',
    async (request) => {
      requireAccount(request.params.id);
      const sendung = storniereSendung(request.params.sendungId);
      if (!sendung) throw new HttpError(404, t('Diese Nachricht ist bereits unterwegs.'));
      return { ok: true, koerper: sendung.koerper };
    },
  );

  /** Was noch aussteht - für eine Übersicht der geplanten Nachrichten. */
  app.get<{ Params: { id: string } }>('/accounts/:id/send/pending', async (request) => {
    requireAccount(request.params.id);
    return listeGeplanteSendungen(request.params.id).map((s) => ({
      id: s.id,
      faellig: s.faellig,
      betreff: s.betreff,
      empfaenger: s.empfaenger,
    }));
  });

  app.post<{
    Params: { id: string };
    Body: SendBody & { previousUid?: number };
  }>('/accounts/:id/drafts', async (request) => {
    const account = requireAccount(request.params.id);
    const { attachOriginal, previousUid, attachments: wire, ...message } = request.body;

    const attachments = await collectAttachments(account, wire, attachOriginal);
    const result = await saveDraft(
      account,
      { ...message, to: message.to ?? [], subject: message.subject ?? '', attachments },
      previousUid,
    );
    verwerfeStaende(account.id, result.folder);
    return { ok: true, ...result };
  });

  app.delete<{ Params: { id: string; folder: string; uid: string } }>(
    '/accounts/:id/drafts/:folder/:uid',
    async (request) => {
      const account = requireAccount(request.params.id);
      const ordner = decodeURIComponent(request.params.folder);
      await discardDraft(account, ordner, uidAus(request.params.uid));
      verwerfeStaende(account.id, ordner);
      return { ok: true };
    },
  );

  /*
   * Ein Kanal für alle Konten EINES Nutzers: der Client bekommt jedes Ereignis mitsamt
   * accountId und entscheidet selbst, ob das die gerade sichtbare Ansicht betrifft.
   *
   * Der Nutzer wird beim Verbinden festgehalten und nicht bei jedem Ereignis neu
   * bestimmt - die Ereignisse kommen aus fremden Ausführungssträngen (IMAP-Socket,
   * Zeitgeber), dort gäbe es nichts zu bestimmen. Vorher hing jede Verbindung an einem
   * prozessglobalen Satz Zuhörer: jeder Angemeldete bekam damit die Eingänge aller
   * anderen, samt Betreff und Absender.
   */
  app.get('/ws', { websocket: true }, (socket) => {
    const unsubscribe = subscribe(aktuellerNutzer(), (event) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    });
    socket.on('close', unsubscribe);
    socket.on('error', unsubscribe);
  });

  // Gebautes Frontend mitausliefern, sofern vorhanden. Dadurch laufen UI und API auf
  // derselben Origin (kein CORS nötig) und die Desktop-App kann http:// statt file://
  // laden - file:// würde an den absoluten /assets-Pfaden des Vite-Builds scheitern.
  // Im Web-Dev-Modus (Vite auf Port 5173) existiert der Ordner nicht, dann greift CORS.
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, { root: webDistDir });
    app.log.info(`Frontend wird ausgeliefert aus ${webDistDir}`);
  } else {
    app.log.warn(`Kein gebautes Frontend gefunden (${webDistDir}) - nur API verfügbar.`);
  }

  // Überwachung aller hinterlegten Konten sofort starten, nicht erst wenn sich ein
  // Client verbindet - so ist der erste Verbinder direkt auf aktuellem Stand.
  setRegistryLogger({
    info: (msg) => app.log.info(msg),
    warn: (msg) => app.log.warn(msg),
  });

  // Muss vor den Watchern stehen: OAuth-Konten brauchen beim Verbinden ein gültiges
  // Zugriffstoken, und das wird hier bei Bedarf erneuert und gespeichert.
  installTokenRefresh((msg) => app.log.warn(msg));

  /*
   * Arbeit, die ohne Anfrage läuft - und deshalb ihren Nutzerkontext selbst mitbringen muss.
   *
   * Überwachung, Wiedervorlage und Sendewarteschlange gehören keinem Fenster und keiner
   * HTTP-Anfrage: sie laufen von sich aus, im Hintergrund. Ohne ausdrücklichen Kontext
   * wüssten die Speicher nicht, wessen Daten gemeint sind, und würfen (siehe
   * nutzer/kontext.ts). Genau dieses Werfen macht die Umstellung sicher - was ich hier
   * zu wickeln vergesse, meldet sich beim ersten Durchlauf.
   *
   * AsyncLocalStorage trägt den Kontext über Zeitgeber hinweg. Die Zeitgeber für geplante
   * Sendungen und Wiedervorlagen entstehen INNERHALB dieses Blocks und behalten ihn
   * deshalb bis zu ihrem Auslösen - auch Wochen später.
   *
   * Hier stand einmal `[EINPLATZ_NUTZER]` mit der Notiz, daraus werde später eine
   * Schleife über alle. Der Zeitpunkt ist gekommen, und es war keine Formsache: im
   * Serverbetrieb bekam nach jedem Neustart nur der Nutzer "lokal" seine
   * Hintergrundarbeit zurück - und der hat dort gar keine Konten. Für alle anderen hieß
   * das: keine Überwachung (also keine neue Post, bis jemand von Hand nachlädt), eine
   * für Dienstag geplante Sendung, die nie hinausgeht, und eine auf morgen gelegte
   * Nachricht, die nicht wiederkommt. Alles still, ohne eine einzige Fehlermeldung.
   *
   * Auf dem Einzelplatz ändert sich nichts: dort ist "lokal" der einzige Eintrag.
   */
  const hintergrundNutzer = alleNutzer()
    .map((n) => n.id)
    .filter((id) => !istGesperrt(id));

  if (hintergrundNutzer.length === 0) {
    app.log.warn(
      'Kein Nutzer eingetragen - es läuft keine Überwachung. Bei einem neuen Server ist ' +
        'das normal, bis der erste Nutzer angelegt ist (nutzerWerkzeug.js anlegen).',
    );
  }

  for (const nutzer of hintergrundNutzer) {
    /*
     * Jeder für sich. Ein Nutzer, dessen Konten sich nicht entschlüsseln lassen oder
     * dessen Ablage beschädigt ist, darf nicht die Hintergrundarbeit aller anderen
     * verhindern - beim Einzelplatz war das egal, hier ist es der Unterschied zwischen
     * "einer hat ein Problem" und "der Dienst tut nichts mehr".
     */
    try {
      alsNutzer(nutzer, () => {
        syncWatchers();

        /*
         * Erst hier, ganz am Ende - und das ist eine Behebung, keine Umsortierung.
         *
         * Vorher standen beide weiter oben im Aufbau, VOR installTokenRefresh. Überfällige
         * Einträge werden mit Wartezeit 0 eingeplant, konnten also losfeuern, bevor die
         * Markenerneuerung eingerichtet war. Bei einem OAuth-Konto scheiterte dann genau
         * der überfällige Versand an einer abgelaufenen Marke - und wurde nach fünf
         * Versuchen aufgegeben.
         */
        ladeWiedervorlagen();
        ladeGeplanteSendungen();
      });
    } catch (err) {
      app.log.error(
        `Hintergrundarbeit für "${nutzer}" ließ sich nicht starten: ${(err as Error).message}`,
      );
    }
  }

  if (hintergrundNutzer.length > 1) {
    app.log.info(`Hintergrundarbeit für ${hintergrundNutzer.length} Nutzer gestartet.`);
  }

  /*
   * Sicherung und Ablage - siehe routen/sicherung.ts.
   *
   * Beides betrifft nicht das Postfach, sondern was auf dieser Platte liegt.
   */
  registriereSicherung(app);

  return app;
}
