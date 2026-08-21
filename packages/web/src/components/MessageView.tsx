import { useEffect, useMemo, useRef, useState } from 'react';
import type { Etikett, FolderInfo, FullMessage } from '@energy-mail/mail-core';
import { entschaerfeExterneInhalte } from '../externeInhalte.js';
import { escapeHtml } from '../htmlText.js';
import { moveTargets } from '../folderTargets.js';
import { Auffangnetz } from './Auffangnetz.js';
import { Einladung } from './Einladung.js';
import { EtikettMarken, EtikettMenue } from './Etiketten.js';
import { Monogramm } from './Monogramm.js';
import { PgpBefund } from './PgpBefund.js';
import { SmimeBefund } from './SmimeBefund.js';
import { LeererKorb } from './Symbole.js';
import { t, tp, zeitpunkt } from '../sprache.js';
import { Lesebestaetigung } from './Lesebestaetigung.js';
import type { Bestaetigungslage } from '../api.js';

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

interface Props {
  message: (FullMessage & { lesebestaetigung?: Bestaetigungslage }) | null;
  loading: boolean;
  folders: FolderInfo[];
  currentFolder: string | null;
  /** Baut die Download-Adresse für einen Anhang der aktuell gezeigten Nachricht. */
  attachmentUrl: (partId: string) => string;
  /** True, wenn die Nachricht bereits im Papierkorb liegt - dann löscht der Knopf endgültig. */
  isInTrash: boolean;
  /** Im Entwürfe-Ordner gehört die Nachricht bearbeitet, nicht beantwortet. */
  isDraft: boolean;
  /** Steuert, ob "Allen antworten" überhaupt sinnvoll ist. */
  canReplyAll: boolean;
  onReply: (message: FullMessage, toAll: boolean) => void;
  onForward: (message: FullMessage) => void;
  onEditDraft: (message: FullMessage) => void;
  /** Nur gesetzt, wenn der Anbieter ein Archiv kennt - sonst entfällt der Knopf. */
  archiveLabel: string | null;
  onArchive: (uid: number) => void;
  onSetSeen: (uid: number, seen: boolean) => void;
  /** Stellt die Nachricht zurueck; null bedeutet abgebrochen. */
  onSnooze: (uid: number) => void;
  onDelete: (uid: number) => void;
  onMove: (uid: number, targetFolder: string) => void;
  /** Gibt die entfernten Inhalte dieses Absenders dauerhaft frei. */
  onVertrauen?: (adresse: string) => void;
  /** Zeigt die Nachricht im Original mit allen Kopfzeilen. */
  onQuelltext?: (message: FullMessage) => void;
  /** Legt den Absender im Adressbuch an - der Ort, an dem man danach greift. */
  onZumAdressbuch?: (adresse: string, name?: string) => void;
  /** Verzeichnis der Etiketten - Namen und Farben zu den Schlüsselwörtern. */
  etiketten: Etikett[];
  /** Ob der Ordner Etiketten dauerhaft behält; null heißt "noch nicht gefragt". */
  etikettenDauerhaft: boolean | null;
  /** Fragt beim Server nach, ob der Ordner Etiketten behält - siehe EtikettMenue. */
  onEtikettenPruefen: () => void;
  onEtikettSetzen: (uid: number, schluessel: string, an: boolean) => void | Promise<void>;
  onEtikettenGeaendert: (etiketten: Etikett[]) => void;
  /** Fuer die Antwort auf eine Einladung: wo die Nachricht liegt und wer man selbst ist. */
  accountId: string | null;
  eigeneAdressen: string[];
}

/**
 * Sieht die Nachricht nach OpenPGP aus?
 *
 * Nur eine schnelle Vorpruefung im Fenster, damit nicht jede geoeffnete Nachricht eine
 * zusaetzliche Anfrage an den Server ausloest. Das Urteil faellt dort - hier wird nur
 * entschieden, ob ueberhaupt gefragt wird.
 */
function siehtNachPgpAus(message: FullMessage): boolean {
  const anhaenge = message.attachments.some((a) =>
    /application\/pgp-(signature|encrypted)/i.test(a.contentType ?? ''),
  );
  if (anhaenge) return true;
  const text = typeof message.text === 'string' ? message.text : '';
  return text.includes('-----BEGIN PGP MESSAGE-----') ||
    text.includes('-----BEGIN PGP SIGNED MESSAGE-----');
}

/**
 * Und dasselbe für S/MIME.
 *
 * Hier reicht der Blick auf die Anhänge: Bei S/MIME steckt der Schutz immer in einem
 * eigenen Teil - `smime.p7s` bei einer Unterschrift, `smime.p7m` bei allem anderen. Die
 * alten Schreibweisen mit `x-` sind mitgemeint; Outlook hat sie jahrelang benutzt und
 * manche Server schreiben sie bis heute.
 */
function siehtNachSmimeAus(message: FullMessage): boolean {
  return message.attachments.some((a) =>
    /application\/(x-)?pkcs7-(signature|mime)/i.test(a.contentType ?? ''),
  );
}

function formatAddresses(addresses: { name?: string; address: string }[]): string {
  return addresses.map((a) => a.name || a.address).join(', ');
}

/**
 * Rendert HTML-Mailinhalt in einem sandboxed iframe statt per dangerouslySetInnerHTML,
 * damit eingebettete <script>-Tags aus (potenziell bösartigen) E-Mails nicht ausgeführt
 * werden können. "allow-same-origin" erlaubt nur das Auslesen der Höhe fürs Auto-Resize,
 * nicht aber Skriptausführung (kein "allow-scripts").
 */
/**
 * Grundgestaltung für den Inhalt einer fremden Nachricht.
 *
 * Steht vor dem Mail-HTML, damit alles, was die Nachricht selbst festlegt, gewinnt -
 * hier steht nur, was gilt, wenn sie nichts sagt. Und das ist der häufigste Fall: sehr
 * viele Mails bestehen aus ein paar Absätzen ohne jede Angabe zu Schrift und Farbe. Ohne
 * diese Zeilen erscheinen sie in der Standardschrift des Browsers - einer Serifenschrift
 * in 16 Punkt, die neben dem übrigen Fenster wie ein Fremdkörper aussieht.
 *
 * Der Grund bleibt hell, auch wenn die Anwendung dunkel läuft. Das ist eine bewusste
 * Entscheidung und keine Nachlässigkeit: Mail-HTML ist praktisch ausnahmslos für hellen
 * Grund geschrieben. Eine Nachricht, die nur "color:#000000" mitbringt und den Grund dem
 * Anzeigeprogramm überlässt, wäre auf unserer dunklen Fläche schwarz auf fast schwarz -
 * also unlesbar, und zwar ohne dass man den Grund ansähe. Der helle Bogen ist deshalb
 * abgesetzt gerahmt: er ist erkennbar der Inhalt der Nachricht und nicht ein Stück
 * Oberfläche, das dunkel zu sein vergessen hat.
 */
const GRUNDSTIL = `<style>
  :root { color-scheme: light; }
  html, body { background: #ffffff; color: #1c2430; }
  body {
    margin: 0; padding: 18px 20px;
    font-family: 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
    font-size: 14px; line-height: 1.62; overflow-wrap: break-word;
  }
  /* Breite Bilder und Tabellen sprengen sonst den Rahmen und erzeugen einen
     waagerechten Bildlauf über die ganze Leseansicht. */
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; overflow-wrap: break-word; }
  /* Ausgeschriebene Werte und keine Variablen: dieser Rahmen ist eine eigene Seite und
     erbt nichts aus tokens.css. Es sind die Werte der hellen Ansicht - der Bogen ist
     immer hell, siehe oben. */
  a { color: #2b48d4; }
  blockquote {
    margin: 10px 0 10px 2px; padding-left: 12px;
    border-left: 2px solid #c5cdf7; color: #55504a;
  }
</style>`;

function HtmlMailBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = ref.current;
    if (!iframe) return;

    // Beim Wechsel auf einen Anfangswert: sonst steht bis zum load-Ereignis die Höhe der
    // vorigen Nachricht, und kurze Mails hinterlassen eine große Lücke.
    iframe.style.height = '120px';

    const messen = () => {
      const doc = iframe.contentDocument;
      if (doc?.body) iframe.style.height = `${doc.body.scrollHeight + 4}px`;
    };

    /**
     * Links aus einer Mail in den Systembrowser bringen.
     *
     * Vorher tat ein Klick auf einen Link schlicht NICHTS. Der Rahmen ist ein Sandkasten
     * ohne `allow-popups`, also blockiert der Browser `target="_blank"`, bevor Electrons
     * setWindowOpenHandler überhaupt gefragt wird; und eine Navigation des Rahmens selbst
     * unterbindet `frame-src 'self'` aus der Richtlinie in index.html. Für den Nutzer
     * hieß das: Bestätigungslinks, Rechnungen und Abmeldelinks waren unerreichbar, ohne
     * jede Rückmeldung - nur ein Eintrag in der Entwicklerkonsole.
     *
     * Statt die Sandkastenregeln zu lockern, wird der Klick hier abgefangen: window.open
     * läuft im Zusammenhang des ELTERNdokuments, nicht im Sandkasten, und geht damit
     * durch setWindowOpenHandler nach draußen. Der Sandkasten bleibt so eng wie er war.
     */
    const beiKlick = (e: MouseEvent) => {
      const ziel = (e.target as Element | null)?.closest?.('a');
      const roh = ziel?.getAttribute('href');
      if (!roh) return;
      e.preventDefault();
      let adresse: URL;
      try {
        adresse = new URL(roh, 'about:blank');
      } catch {
        return;
      }
      // Ausdrücklich nur http und https. javascript:, data: und file: bleiben draußen -
      // sie sind hier zwar wirkungslos, aber das soll nicht von der Sandkastenregel
      // allein abhängen.
      if (adresse.protocol === 'http:' || adresse.protocol === 'https:') {
        window.open(adresse.href, '_blank', 'noopener,noreferrer');
      }
    };

    const beiLaden = () => {
      messen();
      iframe.contentDocument?.addEventListener('click', beiKlick);
    };

    iframe.addEventListener('load', beiLaden);
    /*
     * Nachmessen, wenn sich der Inhalt später noch ändert - eine Schrift oder ein
     * freigegebenes Bild lädt nach dem load-Ereignis und macht die Nachricht höher.
     * Ohne das wurde der Text unten abgeschnitten.
     */
    const beobachter = new ResizeObserver(messen);
    const koerper = iframe.contentDocument?.body;
    if (koerper) beobachter.observe(koerper);

    return () => {
      iframe.removeEventListener('load', beiLaden);
      iframe.contentDocument?.removeEventListener('click', beiKlick);
      beobachter.disconnect();
    };
  }, [html]);

  return (
    <iframe
      ref={ref}
      className="mail-bogen"
      title={t('Nachrichteninhalt')}
      /*
       * Mit der Tastatur ansteuerbar. Ohne tabindex kam man in den Rahmen gar nicht
       * hinein - wer nicht mit der Maus scrollen kann, konnte eine lange Nachricht
       * damit nicht zu Ende lesen.
       */
      tabIndex={0}
      srcDoc={GRUNDSTIL + html}
      /*
       * allow-same-origin und sonst NICHTS.
       *
       * Ohne allow-scripts läuft in diesem Rahmen kein Skript - weder ein <script> aus
       * der Mail noch ein onerror-Attribut noch eine javascript:-Adresse. Genau das ist
       * die tragende Zusicherung dieser Ansicht.
       *
       * allow-scripts darf hier NIEMALS hinzukommen. Zusammen mit allow-same-origin
       * (das für das Höhenmessen und den Klick-Abfänger oben gebraucht wird) liefe
       * fremdes Mail-HTML sonst in der Herkunft der Anwendung: mit Zugriff auf den
       * lokalen Server und auf window.energyMail. Wer die Höhenmessung umbaut und dabei
       * über allow-scripts nachdenkt: der Klick-Abfänger und der ResizeObserver oben
       * kommen ohne aus.
       */
      sandbox="allow-same-origin"
      referrerPolicy="no-referrer"
    />
  );
}

/** Kopf über dem Ausdruck: auf Papier fehlt sonst, von wem, an wen und wann. */
const DRUCKSTIL = `<style>
  @page { margin: 16mm; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; font-size: 11pt; line-height: 1.5;
         color: #000; background: #fff; margin: 0; }
  .druckkopf { border-bottom: 1px solid #999; padding-bottom: 10px; margin-bottom: 16px; }
  .druckkopf h1 { font-size: 14pt; margin: 0 0 7px; }
  .druckkopf div { font-size: 9.5pt; color: #333; line-height: 1.55; }
  img { max-width: 100%; height: auto; }
  table { max-width: 100%; }
  pre { white-space: pre-wrap; overflow-wrap: break-word; font-size: 10pt; }
</style>`;

/**
 * Druckt eine Nachricht über einen eigenen, kurzlebigen Rahmen.
 *
 * Nicht über den angezeigten Rahmen und erst recht nicht über das Fenster selbst: das
 * eine trägt die Bildschirmgestaltung mit auf das Papier, das andere druckte Ordnerliste
 * und Nachrichtenliste gleich mit. Der eigene Rahmen bekommt nur den Inhalt und ein
 * Format für Papier.
 *
 * Er bleibt abgeschottet und ohne Skriptausführung - das Drucken stößt die Anwendung
 * von außen an, dafür genügt "allow-modals".
 */
function druckeNachricht(titel: string, kopf: string, inhalt: string): void {
  const rahmen = document.createElement('iframe');
  rahmen.setAttribute('sandbox', 'allow-same-origin allow-modals');
  rahmen.setAttribute('aria-hidden', 'true');
  rahmen.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  rahmen.srcdoc = `<title>${escapeHtml(titel)}</title>${DRUCKSTIL}${kopf}${inhalt}`;

  rahmen.addEventListener('load', () => {
    rahmen.contentWindow?.focus();
    rahmen.contentWindow?.print();
    // Erst wegräumen, wenn der Druckdialog durch ist - sonst verschwindet die Vorlage
    // unter dem Dialog weg und es kommt ein leeres Blatt.
    window.setTimeout(() => rahmen.remove(), 60_000);
  });
  document.body.appendChild(rahmen);
}

/**
 * Hinweis über einer Nachricht, deren entfernte Inhalte angehalten wurden.
 *
 * Bewusst mit Zahl statt einer allgemeinen Warnung: "6 Bilder" sagt einem, ob man etwas
 * verpasst, "diese Nachricht enthält entfernte Inhalte" sagt gar nichts. Und bewusst
 * nicht in Alarmfarbe - angehalten ist der Normalfall und kein Zwischenfall.
 */
function ExterneLeiste({
  anzahl,
  absender,
  onLaden,
  onVertrauen,
}: {
  anzahl: number;
  absender?: string;
  onLaden: () => void;
  onVertrauen?: () => void;
}) {
  return (
    <div className="externe-leiste">
      <span className="externe-text">
        {tp(
          anzahl,
          'Ein Bild von einem fremden Server wurde nicht geladen',
          '{anzahl} Inhalte von fremden Servern wurden nicht geladen',
          { anzahl },
        )}
        <span className="externe-grund">{t('Geladen melden sie dem Absender, dass Sie die Nachricht gerade lesen.')}</span>
      </span>
      <span className="externe-knoepfe">
        <button className="btn secondary" onClick={onLaden}>{t('Einmal laden')}</button>
        {absender && onVertrauen && (
          <button className="link-btn" onClick={onVertrauen} title={t('Gilt künftig für {absender}', { absender })}>{t('Absender immer erlauben')}</button>
        )}
      </span>
    </div>
  );
}

export function MessageView({
  message,
  loading,
  folders,
  currentFolder,
  attachmentUrl,
  isInTrash,
  isDraft,
  canReplyAll,
  onReply,
  onForward,
  onEditDraft,
  archiveLabel,
  onArchive,
  onSetSeen,
  onSnooze,
  onDelete,
  onMove,
  onVertrauen,
  onQuelltext,
  onZumAdressbuch,
  etiketten,
  etikettenDauerhaft,
  onEtikettenPruefen,
  onEtikettSetzen,
  onEtikettenGeaendert,
  accountId,
  eigeneAdressen,
}: Props) {
  /** Ob das Etikettenmenü offen ist. Rein örtlich - es überdauert keinen Wechsel. */
  const [etikettMenue, setEtikettMenue] = useState(false);
  /**
   * Ob die entfernten Inhalte dieser Nachricht freigegeben sind. Beim Wechsel zu einer
   * anderen Nachricht muss das zurückfallen - sonst erbte die nächste die Freigabe der
   * vorigen. Der Schlüssel aus Ordner und Kennung sorgt dafür.
   */
  const schluessel = message ? `${currentFolder}:${message.uid}` : '';
  const [freigegeben, setFreigegeben] = useState('');
  const zeigeExterne = Boolean(message?.absenderVertraut) || freigegeben === schluessel;

  /**
   * Das Entschärfen geht durch das gesamte HTML der Nachricht. Bei einer bebilderten
   * Rundmail ist das nicht umsonst, und ohne Merken liefe es bei jedem Zeichnen erneut.
   */
  const inhalt = useMemo(
    () => (message?.html ? entschaerfeExterneInhalte(message.html) : { html: '', anzahl: 0 }),
    [message?.html],
  );

  if (loading) {
    return <div className="reader empty-state">{t('Lade Nachricht…')}</div>;
  }
  if (!message) {
    return (
      <div className="reader empty-state">
        <LeererKorb />
        <span>{t('Keine Nachricht ausgewählt')}</span>
      </div>
    );
  }

  const absender = message.from[0];
  const setZeigeExterne = (an: boolean) => setFreigegeben(an ? schluessel : '');

  return (
    <div className="reader">
      <div className="mail-head">
        <h2>{message.subject}</h2>
        <div className="mail-meta">
          {/* Dasselbe Kürzel und dieselbe Farbe wie in der Zeile, die man eben
              angeklickt hat - das ist die sichtbare Klammer zwischen Liste und
              Leseansicht. */}
          <Monogramm name={absender?.name} adresse={absender?.address} className="mail-monogramm" />
          <div className="mail-from">
            <span className="mail-from-name">{absender?.name || absender?.address || '(unbekannt)'}</span>
            {absender?.name && <span className="mail-from-address">{absender.address}</span>}
          </div>
          {/* Ausserhalb von .mail-from: das kuerzt lange Absendernamen ab und wuerde den
              Knopf mit abschneiden. */}
          {absender?.address && onZumAdressbuch && (
            <button
              className="link-btn zum-adressbuch"
              onClick={() => onZumAdressbuch(absender.address, absender.name)}
              title={t('{adresse} ins Adressbuch aufnehmen', { adresse: absender.address })}
            >{t('Ins Adressbuch')}</button>
          )}
          <span className="mail-date">
            {message.date ? zeitpunkt(new Date(message.date)) : ''}
          </span>
        </div>
        <div className="mail-to" title={formatAddresses(message.to)}>
          {t('an {empfaenger}', { empfaenger: formatAddresses(message.to) || t('(unbekannt)') })}
          {message.cc.length > 0 && (
            <>{t(' · Kopie: {kopie}', { kopie: formatAddresses(message.cc) })}</>
          )}
        </div>
        <div className="mail-etiketten">
          <EtikettMarken flags={message.flags} bekannte={etiketten} />
          <span className="etikett-anker">
            <button
              className="link-btn"
              onClick={() => setEtikettMenue((v) => !v)}
              aria-expanded={etikettMenue}
              aria-haspopup="menu"
            >{t('Etiketten')}</button>
            {etikettMenue && (
              <EtikettMenue
                bekannte={etiketten}
                flags={message.flags}
                dauerhaft={etikettenDauerhaft}
                onPruefen={onEtikettenPruefen}
                onSetzen={(schluessel, an) => onEtikettSetzen(message.uid, schluessel, an)}
                onVerzeichnisGeaendert={onEtikettenGeaendert}
                onClose={() => setEtikettMenue(false)}
              />
            )}
          </span>
        </div>
      </div>

      {/*
        Noch vor dem PGP-Befund: Hier wird etwas verschickt, sobald die Nachricht offen
        ist. Was der Nutzer entscheiden oder wenigstens sehen soll, gehoert nach oben und
        nicht unter den Text.
      */}
      {message.lesebestaetigung && accountId && currentFolder && (
        <Lesebestaetigung
          accountId={accountId}
          ordner={currentFolder}
          uid={message.uid}
          an={message.lesebestaetigung.an}
          fragen={message.lesebestaetigung.fragen}
          abweichend={message.lesebestaetigung.abweichend}
        />
      )}

      {/* Ganz oben: ob dem Inhalt zu trauen ist, muss man wissen, BEVOR man ihn liest. */}
      {accountId && currentFolder && (
        <Auffangnetz
          schluessel={`pgp:${accountId}:${currentFolder}:${message.uid}`}
          ersatz={(fehler) => (
            <div className="pgp-band warnung">
              <span className="pgp-wort">
                {t('Der OpenPGP-Befund ließ sich nicht darstellen ({grund}).', {
                  grund: fehler.message,
                })}
              </span>
            </div>
          )}
        >
          <PgpBefund
            accountId={accountId}
            ordner={currentFolder}
            uid={message.uid}
            verdacht={siehtNachPgpAus(message)}
          />
        </Auffangnetz>
      )}

      {accountId && currentFolder && (
        <Auffangnetz
          schluessel={`smime:${accountId}:${currentFolder}:${message.uid}`}
          ersatz={(fehler) => (
            <div className="pgp-band warnung">
              <span className="pgp-wort">
                {t('Der S/MIME-Befund ließ sich nicht darstellen ({grund}).', {
                  grund: fehler.message,
                })}
              </span>
            </div>
          )}
        >
          <SmimeBefund
            accountId={accountId}
            ordner={currentFolder}
            uid={message.uid}
            verdacht={siehtNachSmimeAus(message)}
          />
        </Auffangnetz>
      )}

      {/* Ueber der Werkzeugleiste: eine Einladung ist das Wichtigste an so einer
          Nachricht, und die Antwort darauf gehoert nicht unter den Text. */}
      {message.einladung && accountId && currentFolder && (
        <Auffangnetz
          schluessel={`${accountId}:${currentFolder}:${message.uid}`}
          ersatz={(fehler) => (
            <div className="einladung">
              <span className="einladung-art">{t('Einladung')}</span>
              <p className="hint einladung-hinweis">
                {t('Diese Einladung ließ sich nicht darstellen ({grund}). Die Nachricht selbst steht unten; die Kalenderdatei lässt sich als Anhang öffnen.', {
                  grund: fehler.message,
                })}
              </p>
            </div>
          )}
        >
          <Einladung
            einladung={message.einladung}
            accountId={accountId}
            ordner={currentFolder}
            uid={message.uid}
            eigeneAdressen={eigeneAdressen}
          />
        </Auffangnetz>
      )}

      <div className="toolbar">
        {isDraft ? (
          <button className="btn" onClick={() => onEditDraft(message)}>{t('Entwurf bearbeiten')}</button>
        ) : (
          <>
            <button className="btn" onClick={() => onReply(message, false)}>{t('Antworten')}</button>
            {canReplyAll && (
              <button className="btn ghost" onClick={() => onReply(message, true)}>{t('Allen antworten')}</button>
            )}
            <button className="btn ghost" onClick={() => onForward(message)}>{t('Weiterleiten')}</button>
          </>
        )}
        {archiveLabel && (
          <button className="btn ghost" onClick={() => onArchive(message.uid)} title={archiveLabel}>{t('Archivieren')}</button>
        )}
        <button className="btn ghost" onClick={() => onSetSeen(message.uid, !message.seen)}>
          {message.seen ? 'Als ungelesen' : 'Als gelesen'}
        </button>
        <button
          className="btn ghost"
          title={t('Aus dem Posteingang nehmen und spaeter wieder vorlegen')}
          onClick={() => onSnooze(message.uid)}
        >{t('Wiedervorlage')}</button>
        <button
          className="btn ghost"
          title={t('Nachricht drucken oder als PDF sichern')}
          onClick={() =>
            druckeNachricht(
              message.subject,
              `<div class="druckkopf"><h1>${escapeHtml(message.subject)}</h1><div>` +
                `Von: ${escapeHtml(absender?.name ? `${absender.name} <${absender.address}>` : (absender?.address ?? '(unbekannt)'))}<br>` +
                `An: ${escapeHtml(formatAddresses(message.to) || '(unbekannt)')}<br>` +
                (message.cc.length > 0 ? `Kopie: ${escapeHtml(formatAddresses(message.cc))}<br>` : '') +
                `Datum: ${escapeHtml(message.date ? zeitpunkt(new Date(message.date)) : '(unbekannt)')}` +
                `</div></div>`,
              // Gedruckt wird, was auf dem Bildschirm steht: sind die entfernten Bilder
              // angehalten, kommen sie auch nicht aufs Papier.
              message.html
                ? zeigeExterne
                  ? message.html
                  : inhalt.html
                : `<pre>${escapeHtml(message.text ?? '')}</pre>`,
            )
          }
        >{t('Drucken')}</button>
        <button
          className="btn ghost"
          title={t('Die Nachricht im Original mit allen Kopfzeilen')}
          onClick={() => onQuelltext?.(message)}
        >{t('Quelltext')}</button>
        <button className="btn ghost warnend" onClick={() => onDelete(message.uid)}>
          {isInTrash ? t('Endgültig löschen') : t('Löschen')}
        </button>
        <select
          className="move-select"
          value=""
          onChange={(e) => {
            if (e.target.value) onMove(message.uid, e.target.value);
          }}
        >
          <option value="">{t('Verschieben nach…')}</option>
          {moveTargets(folders, currentFolder).map((folder) => (
            <option key={folder.path} value={folder.path}>
              {folder.name}
            </option>
          ))}
        </select>
      </div>
      {message.html ? (
        <>
          {inhalt.anzahl > 0 && !zeigeExterne && (
            <ExterneLeiste
              anzahl={inhalt.anzahl}
              absender={absender?.address}
              onLaden={() => setZeigeExterne(true)}
              onVertrauen={
                absender?.address && onVertrauen
                  ? () => {
                      setZeigeExterne(true);
                      onVertrauen(absender.address);
                    }
                  : undefined
              }
            />
          )}
          <HtmlMailBody html={zeigeExterne ? message.html : inhalt.html} />
        </>
      ) : (
        // Reiner Text stammt nicht aus fremdem Markup und darf deshalb auf der Fläche
        // der Anwendung stehen - er nimmt die gewählte Ansicht ohne Weiteres an.
        <pre className="mail-text">{message.text}</pre>
      )}
      {message.attachments.length > 0 && (
        <div className="attachments">
          <strong>{t('Anhänge ({anzahl})', { anzahl: message.attachments.length })}</strong>
          <ul>
            {message.attachments.map((att, i) => (
              <li key={att.partId ?? i}>
                {att.partId ? (
                  <a href={attachmentUrl(att.partId)} download={att.filename ?? undefined}>
                    {att.filename ?? t('Anhang')}
                  </a>
                ) : (
                  <span>{t('{name} (nicht abrufbar)', { name: att.filename ?? t('Anhang') })}</span>
                )}
                <span className="attachment-size">{formatSize(att.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
