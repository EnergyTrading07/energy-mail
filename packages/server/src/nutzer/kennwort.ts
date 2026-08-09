import crypto from 'node:crypto';

/**
 * Kennwörter der Nutzer - für die Anmeldung am Server selbst.
 *
 * Nicht zu verwechseln mit den Postfachkennwörtern: die werden verschlüsselt abgelegt,
 * weil der Server sie im Klartext braucht, um Post abzurufen. Ein Anmeldekennwort braucht
 * er nie im Klartext - er muss nur prüfen können, ob eines stimmt. Deshalb hier eine
 * Prüfsumme, aus der sich das Kennwort nicht zurückrechnen lässt.
 *
 * scrypt statt bcrypt oder Argon2: es steckt in Node selbst. Eine native Abhängigkeit für
 * eine so zentrale Stelle wäre ein zusätzlicher Weg, auf dem beim Bauen etwas
 * schiefgehen kann - und scrypt ist für diesen Zweck vollauf tauglich.
 */

/**
 * Die Parameter, mit denen NEUE Kennwörter gerechnet werden.
 *
 * N = 2^16 bedeutet rund 64 MB Arbeitsspeicher und einige zehntel Sekunden je Prüfung.
 * Das ist die Abwägung: hoch genug, dass massenhaftes Durchprobieren teuer wird, niedrig
 * genug, dass gleichzeitige Anmeldungen den Server nicht in die Knie zwingen. Bei
 * N = 2^17 wären es 134 MB je Anmeldung - zwanzig gleichzeitige, und der Server ist voll.
 *
 * Die Parameter werden bei jeder Prüfsumme MITGESPEICHERT. Nur so lassen sie sich später
 * erhöhen, ohne alle bestehenden Kennwörter ungültig zu machen: geprüft wird mit den
 * Werten, die beim Anlegen galten.
 */
const AKTUELL = { N: 2 ** 16, r: 8, p: 1 };

/** scrypt braucht ausdrücklich Erlaubnis für den Speicher, den es anfordert. */
const MAXMEM = 256 * 1024 * 1024;

const SALZ_BYTES = 16;
const LAENGE = 32;

/**
 * Rechnet die Prüfsumme eines Kennworts.
 *
 * Ergebnis sieht so aus:
 *   scrypt$65536$8$1$<salz base64>$<pruefsumme base64>
 */
export function verschluesselKennwort(kennwort: string): string {
  if (typeof kennwort !== 'string' || kennwort.length === 0) {
    throw new Error('Ein leeres Kennwort lässt sich nicht verwenden.');
  }
  const salz = crypto.randomBytes(SALZ_BYTES);
  const summe = crypto.scryptSync(kennwort, salz, LAENGE, { ...AKTUELL, maxmem: MAXMEM });
  return [
    'scrypt',
    AKTUELL.N,
    AKTUELL.r,
    AKTUELL.p,
    salz.toString('base64'),
    summe.toString('base64'),
  ].join('$');
}

/**
 * Prüft ein Kennwort gegen eine gespeicherte Prüfsumme.
 *
 * Wirft nie - ein unbrauchbarer Datensatz ergibt schlicht "stimmt nicht". Eine Ausnahme
 * hier ließe sich von außen unterscheiden und verriete damit, dass es den Nutzer gibt.
 */
export function kennwortStimmt(kennwort: string, gespeichert: string): boolean {
  try {
    const [verfahren, nRoh, rRoh, pRoh, salzB64, summeB64] = gespeichert.split('$');
    if (verfahren !== 'scrypt' || !salzB64 || !summeB64) return false;

    const N = Number(nRoh);
    const r = Number(rRoh);
    const p = Number(pRoh);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    // Ein absurd hoher Wert aus einer manipulierten Datei würde den Server sonst zum
    // Stillstand rechnen.
    if (N > 2 ** 20 || r > 32 || p > 16) return false;

    const erwartet = Buffer.from(summeB64, 'base64');
    const gerechnet = crypto.scryptSync(kennwort, Buffer.from(salzB64, 'base64'), erwartet.length, {
      N,
      r,
      p,
      maxmem: MAXMEM,
    });

    // Zeitunabhängig: ein gewöhnliches === bricht beim ersten abweichenden Byte ab.
    return crypto.timingSafeEqual(erwartet, gerechnet);
  } catch {
    return false;
  }
}

/**
 * Ob eine Prüfsumme mit schwächeren Parametern gerechnet wurde als heute üblich.
 *
 * Damit lässt sich beim nächsten erfolgreichen Anmelden still auf den aktuellen Stand
 * heben - der einzige Zeitpunkt, an dem das Kennwort im Klartext vorliegt.
 */
export function brauchtErneuerung(gespeichert: string): boolean {
  const [verfahren, nRoh, rRoh, pRoh] = gespeichert.split('$');
  if (verfahren !== 'scrypt') return true;
  return Number(nRoh) < AKTUELL.N || Number(rRoh) < AKTUELL.r || Number(pRoh) < AKTUELL.p;
}
