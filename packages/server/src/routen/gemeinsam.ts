import type { AccountConfig } from '@energy-mail/mail-core';
import { t } from '@energy-mail/mail-core/sprache';
import { getAccount } from '../accountStore.js';
import { HttpError } from './fehler.js';

/**
 * Was mehrere Routengruppen brauchen.
 *
 * Diese drei standen INNERHALB von buildServer, obwohl keine von ihnen etwas aus dessen
 * Umgebung liest - weder den Server noch den Port noch die Aufrufoptionen. Sie standen
 * dort, weil die Wege dort standen; sobald die Wege in eigene Dateien wandern, muessen
 * die Helfer aus mehr als einer Datei erreichbar sein.
 *
 * Was hier NICHT hingehoert: alles, was den Server selbst anfasst. Der Fehlerbehandler,
 * die Sicherheitskopfzeilen, die Reihenfolge der Haken - das bleibt in app.ts, denn es
 * beschreibt den Aufbau und nicht einen einzelnen Weg.
 */

/** Das Konto zu einer Kennung - oder eine 404. */
export function requireAccount(id: string): AccountConfig {
  const account = getAccount(id);
  if (!account) throw new HttpError(404, t('Konto nicht gefunden'));
  return account;
}

/**
 * Eine Zahl aus einer Anfrage - geprüft und nicht geraten.
 *
 * ## Warum es diese Zeilen gibt
 *
 * `Number('abc')` ist NaN, und NaN ist die gefährlichste Zahl in JavaScript: Sie
 * verhält sich in keinem Vergleich wie eine Zahl, wirft aber auch nicht. Sie wandert
 * unbemerkt weiter, bis sie irgendwo unten in `slice(-n)` steckt - und dort bedeutet
 * sie das Gegenteil dessen, was sie sollte: keine Begrenzung.
 *
 * Gefunden wurde das an fünf Wegen. Der schlimmste war `apply-rules`: mit einer
 * unbrauchbaren Seitengröße wurden die Regeln nicht auf die neuesten zweihundert
 * Nachrichten angewandt, sondern auf den gesamten Ordner - und Regeln verschieben und
 * löschen. Ein Tippfehler in einer Adresszeile hätte damit ein Postfach umgeräumt.
 *
 * ## Warum 400 und nicht die Voreinstellung
 *
 * Weil eine stillschweigend eingesetzte Voreinstellung dem Aufrufer etwas anderes tut,
 * als er verlangt hat, ohne es zu sagen. Wer `pageSize=abc` schickt, hat einen Fehler
 * im Programm oder in der Adresse - und den soll er sehen. Die Bibliothek darunter
 * fängt denselben Fall zusätzlich ab (siehe `brauchbareAnzahl` in imapClient.ts); zwei
 * Sicherungen, weil eine davon irgendwann bei einem Umbau wegfällt.
 */
export function zahlAus(
  roh: unknown,
  feld: string,
  grenzen: { von: number; bis: number; standard?: number },
): number {
  if (roh === undefined || roh === null || roh === '') {
    if (grenzen.standard !== undefined) return grenzen.standard;
    throw new HttpError(400, t('Feld „{feld}“ fehlt.', { feld }));
  }
  const wert = Number(roh);
  if (!Number.isInteger(wert) || wert < grenzen.von || wert > grenzen.bis) {
    throw new HttpError(
      400,
      t('„{feld}“ muss eine ganze Zahl zwischen {von} und {bis} sein.', {
        feld,
        von: String(grenzen.von),
        bis: String(grenzen.bis),
      }),
    );
  }
  return wert;
}

/**
 * Die Nummer einer Nachricht.
 *
 * Eigener Weg, weil die Obergrenze hier keine Frage des Geschmacks ist: IMAP-UIDs sind
 * vorzeichenlose 32-Bit-Zahlen (RFC 3501). Was darüber liegt, kann keine Nachricht sein.
 */
const UID_HOECHSTENS = 4_294_967_295;

export function uidAus(roh: unknown, feld = 'uid'): number {
  return zahlAus(roh, feld, { von: 1, bis: UID_HOECHSTENS });
}
