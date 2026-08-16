import { leseGrenze, schneideSigniertenTeil } from '../pgpErkennung.js';

/**
 * Wo in einer Nachricht das S/MIME steckt - und wie man es unversehrt herausbekommt.
 *
 * ## Warum hier roh gearbeitet wird und nicht auf der zerlegten Struktur
 *
 * Bei PGP/MIME wird die Struktur benutzt, die der Mailserver mitliefert, und einzelne
 * Teile werden nachgeladen. Das geht dort, weil der unterschriebene Teil eine
 * abgeschlossene Einheit ist.
 *
 * Bei S/MIME geht es aus zwei Gründen nicht. Erstens ist die verschlüsselte Form eine
 * Nachricht mit genau einem Teil, und die Nummerierung solcher Teile ist zwischen den
 * Mailservern nicht einheitlich - man bekommt bei dem einen Server etwas anderes als bei
 * dem anderen. Zweitens, und das wiegt schwerer: Was unterschrieben wurde, ist eine
 * Bytefolge samt Kopfzeilen, und die bekommt man nur aus der Nachricht selbst. Ein Server,
 * der einen Teil beim Ausliefern umkodiert - manche IMAP-Server tun das -, macht die
 * Unterschrift ungültig, ohne dass jemand die Nachricht angefasst hätte.
 *
 * Also: einmal die ganze Nachricht holen, und alles Weitere hier daraus.
 */

export type SmimeArt =
  | { art: 'keine' }
  /** Der übliche Fall: Inhalt im Klartext, Unterschrift daneben. */
  | { art: 'signiert'; unterschriebeneBytes: Buffer; signatur: Buffer; klartext: Buffer }
  /** Inhalt und Unterschrift in einem Paket - wer es nicht lesen kann, sieht gar nichts. */
  | { art: 'signiert-eingeschlossen'; signatur: Buffer }
  | { art: 'verschluesselt'; umschlag: Buffer }
  /** Jemand schickt nur sein Zertifikat - die Antwort auf "schick mir deins". */
  | { art: 'nur-zertifikate'; daten: Buffer };

/** Trennt Kopf und Rumpf einer Nachricht oder eines Teils. */
export function trenneKopf(roh: Buffer): { kopf: string; koerper: Buffer } {
  let ende = roh.indexOf('\r\n\r\n');
  let laenge = 4;
  if (ende < 0) {
    // Nicht jede Ablage hält sich an CRLF; eine lokal gespeicherte Nachricht kann LF haben.
    ende = roh.indexOf('\n\n');
    laenge = 2;
  }
  if (ende < 0) return { kopf: roh.toString('utf8'), koerper: Buffer.alloc(0) };
  return { kopf: roh.subarray(0, ende).toString('utf8'), koerper: roh.subarray(ende + laenge) };
}

/**
 * Holt eine Kopfzeile - mit ihren Fortsetzungen.
 *
 * Eine lange Kopfzeile darf umbrochen werden, und die Fortsetzung beginnt mit Leerraum.
 * Wer nur die erste Zeile liest, bekommt bei einem umbrochenen Content-Type die Grenze
 * nicht zu sehen - und genau die braucht man hier.
 */
export function kopfWert(kopf: string, name: string): string | undefined {
  const zeilen = kopf.split(/\r?\n/);
  const gesucht = name.toLowerCase() + ':';
  for (let i = 0; i < zeilen.length; i++) {
    if (!zeilen[i]!.toLowerCase().startsWith(gesucht)) continue;
    let wert = zeilen[i]!.slice(gesucht.length).trim();
    while (i + 1 < zeilen.length && /^[ \t]/.test(zeilen[i + 1]!)) {
      wert += ' ' + zeilen[++i]!.trim();
    }
    return wert;
  }
  return undefined;
}

/** Ein Parameter aus einer Kopfzeile, etwa `smime-type` aus dem Content-Type. */
export function kopfParameter(wert: string | undefined, name: string): string | undefined {
  if (!wert) return undefined;
  const treffer = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i').exec(wert);
  return (treffer?.[1] ?? treffer?.[2])?.trim().toLowerCase();
}

/** Der Medientyp ohne seine Parameter. */
const typVon = (wert: string | undefined) => (wert ?? '').split(';')[0]!.trim().toLowerCase();

/**
 * Entpackt einen Teil nach seiner Übertragungskodierung.
 *
 * Nur base64 wird wirklich gebraucht - so wird jede S/MIME-Anlage übertragen. Der Rest
 * steht der Vollständigkeit halber da; quoted-printable kommt an dieser Stelle nicht vor,
 * weil binäre Bytes darin unsinnig wären.
 */
export function entkodiere(kopf: string, koerper: Buffer): Buffer {
  const wie = (kopfWert(kopf, 'content-transfer-encoding') ?? '').trim().toLowerCase();
  if (wie === 'base64') {
    return Buffer.from(koerper.toString('ascii').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  }
  return koerper;
}

/**
 * Zerlegt einen mehrteiligen Rumpf an seiner Grenze.
 *
 * Zurück kommen die Teile mit ihren eigenen Kopfzeilen und ohne die Grenzzeilen. Das CRLF
 * unmittelbar vor einer Grenze gehört zur Grenze und nicht zum Inhalt - dieselbe Regel
 * wie bei der Unterschrift, und derselbe klassische Fehler, wenn man sie übersieht.
 */
export function teileAnGrenze(koerper: Buffer, grenze: string): Buffer[] {
  const marke = Buffer.from(`--${grenze}`, 'utf8');
  const teile: Buffer[] = [];
  let stelle = koerper.indexOf(marke);
  while (stelle >= 0) {
    const zeilenende = koerper.indexOf('\r\n', stelle);
    if (zeilenende < 0) break;
    // "--grenze--" schließt ab; danach kommt nichts mehr.
    if (koerper.subarray(stelle + marke.length, stelle + marke.length + 2).toString() === '--') break;

    const ab = zeilenende + 2;
    const naechste = koerper.indexOf(Buffer.from(`\r\n--${grenze}`, 'utf8'), ab);
    if (naechste < 0) break;
    teile.push(koerper.subarray(ab, naechste));
    stelle = naechste + 2;
  }
  return teile;
}

const IST_SIGNATUR = (typ: string) =>
  typ === 'application/pkcs7-signature' || typ === 'application/x-pkcs7-signature';
const IST_PAKET = (typ: string) =>
  typ === 'application/pkcs7-mime' || typ === 'application/x-pkcs7-mime';

/**
 * Erkennt, ob und wie eine Nachricht mit S/MIME geschützt ist.
 *
 * `roh` ist die vollständige Nachricht - oder, bei einer verschlüsselten, ihr geöffneter
 * Inhalt: Der ist selbst wieder eine MIME-Einheit und darf unterschrieben sein. Genau so
 * verschickt man beides zugleich, und genau so wird es hier auch gelesen.
 */
export function erkenneSmime(roh: Buffer): SmimeArt {
  const { kopf, koerper } = trenneKopf(roh);
  const contentType = kopfWert(kopf, 'content-type');
  const typ = typVon(contentType);

  if (typ === 'multipart/signed') {
    /*
     * Das angekündigte Protokoll wird geprüft, aber es entscheidet nichts allein: Manche
     * Absender schreiben "application/x-pkcs7-signature", manche lassen den Parameter
     * ganz weg. Maßgeblich ist der zweite Teil - was dort wirklich steht.
     */
    const grenze = leseGrenze(contentType);
    if (!grenze) return { art: 'keine' };

    const unterschrieben = schneideSigniertenTeil(roh, grenze);
    const teile = teileAnGrenze(koerper, grenze);
    if (!unterschrieben || teile.length < 2) return { art: 'keine' };

    const zweiter = trenneKopf(teile[1]!);
    if (!IST_SIGNATUR(typVon(kopfWert(zweiter.kopf, 'content-type')))) return { art: 'keine' };

    const erster = trenneKopf(teile[0]!);
    return {
      art: 'signiert',
      unterschriebeneBytes: unterschrieben,
      signatur: entkodiere(zweiter.kopf, zweiter.koerper),
      klartext: entkodiere(erster.kopf, erster.koerper),
    };
  }

  if (IST_PAKET(typ)) {
    const daten = entkodiere(kopf, koerper);
    const art = kopfParameter(contentType, 'smime-type');
    if (art === 'enveloped-data' || art === 'authenveloped-data') {
      return { art: 'verschluesselt', umschlag: daten };
    }
    if (art === 'signed-data') return { art: 'signiert-eingeschlossen', signatur: daten };
    if (art === 'certs-only') return { art: 'nur-zertifikate', daten };
    /*
     * Ohne den Parameter - ältere Absender lassen ihn weg - entscheidet der Inhalt. Der
     * erste Objektbezeichner im Paket sagt, was es ist; ihn hier grob zu erkennen ist
     * billiger, als das ganze Paket zweimal zu zerlegen.
     */
    const kopfbytes = daten.subarray(0, 32).toString('hex');
    if (
      kopfbytes.includes('2a864886f70d010703') ||
      kopfbytes.includes('2a864886f70d0109100117')
    ) {
      return { art: 'verschluesselt', umschlag: daten };
    }
    if (kopfbytes.includes('2a864886f70d010702')) {
      return { art: 'signiert-eingeschlossen', signatur: daten };
    }
    return { art: 'keine' };
  }

  return { art: 'keine' };
}

// --- Zusammensetzen ---

/** Base64 in Zeilen zu 76 Zeichen - so verlangt es RFC 2045. */
export function alsBase64Block(daten: Buffer): string {
  return daten.toString('base64').replace(/(.{76})/g, '$1\r\n');
}

/**
 * Der Teil, der unterschrieben wird - und der später unverändert hinausgehen muss.
 *
 * Genau wie bei PGP: Eine einzige Stelle baut ihn, damit Unterschrift und Versand nicht
 * auseinanderlaufen können. Deshalb wird hier auch dieselbe Funktion benutzt und keine
 * zweite geschrieben.
 */
export { baueSigniertenTeil } from '../pgpErkennung.js';

/** Eine MIME-Einheit: ihre eigenen Kopfzeilen und ihr Rumpf. */
export interface Einheit {
  kopfzeilen: string[];
  koerper: string;
}

export const alsBytes = (einheit: Einheit): Buffer =>
  Buffer.from(`${einheit.kopfzeilen.join('\r\n')}\r\n\r\n${einheit.koerper}`, 'utf8');

/**
 * Setzt die unterschriebene Form zusammen (RFC 8551, Abschnitt 3.5.3).
 *
 * An einer Stelle, weil sie an zwei Stellen gebraucht wird: beim gewöhnlichen Versand
 * einer unterschriebenen Nachricht, und als Inhalt, wenn zusätzlich verschlüsselt wird.
 * Zweimal gebaut liefe früher oder später auseinander, und der Unterschied fiele erst
 * dem Empfänger auf.
 */
export function baueSigniertePost(signierterTeil: string, signatur: Buffer, grenze: string): Einheit {
  return {
    kopfzeilen: [
      `Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; boundary="${grenze}"`,
    ],
    koerper: [
      `--${grenze}`,
      // Ab hier bis zur nächsten Grenze steht, was unterschrieben wurde - Byte für Byte.
      signierterTeil,
      `--${grenze}`,
      'Content-Type: application/pkcs7-signature; name="smime.p7s"',
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="smime.p7s"',
      '',
      alsBase64Block(signatur),
      `--${grenze}--`,
      '',
    ].join('\r\n'),
  };
}

/**
 * Und die verschlüsselte Form - ein einziger Teil, mehr ist da nicht zu sehen.
 *
 * Welche Art es ist, wird an den Bytes abgelesen und nicht mitgereicht. Ein zweites
 * Feld, das dasselbe noch einmal behauptet, könnte falsch stehen - und dann kündigte die
 * Kopfzeile etwas anderes an, als im Anhang steckt.
 */
export function baueVerschluesseltePost(umschlag: Buffer): Einheit {
  // 1.2.840.113549.1.9.16.1.23 - der Umschlag mit Prüfsumme aus RFC 5083.
  const mitPruefsumme = umschlag
    .subarray(0, 32)
    .toString('hex')
    .includes('2a864886f70d0109100117');
  return {
    kopfzeilen: [
      `Content-Type: application/pkcs7-mime; smime-type=${mitPruefsumme ? 'authenveloped-data' : 'enveloped-data'}; name="smime.p7m"`,
      'Content-Transfer-Encoding: base64',
      'Content-Disposition: attachment; filename="smime.p7m"',
    ],
    koerper: `${alsBase64Block(umschlag)}\r\n`,
  };
}
