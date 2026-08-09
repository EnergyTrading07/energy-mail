/**
 * Nachrichten als mbox-Datei ausgeben.
 *
 * mbox ist das älteste und verbreitetste Sammelformat für Mail: Thunderbird, Apple Mail,
 * Evolution und praktisch jedes Werkzeug zur Umstellung lesen es. Damit ist es der Weg
 * aus dem Programm heraus - ohne den wäre Energy Mail eine Einbahnstraße, und das ist
 * bei fremden Daten kein guter Ruf.
 *
 * Der Aufbau ist denkbar schlicht: Nachrichten stehen hintereinander, jede eingeleitet
 * von einer Zeile, die mit "From " beginnt. Genau daraus folgt die einzige Tücke des
 * Formats, und sie ist der Grund für dieses Modul.
 */

/**
 * Entschärft Zeilen, die im Nachrichtentext selbst mit "From " beginnen.
 *
 * Ohne das zerfiele eine Nachricht beim Einlesen an dieser Stelle in zwei: das
 * lesende Programm hielte die Zeile für den Anfang der nächsten. Ein Satz wie
 * "From here on we agree" am Zeilenanfang genügt dafür.
 *
 * Die übliche Lösung heißt "mboxrd": ein ">" davor. Damit sich das rückgängig machen
 * lässt, bekommen auch bereits mit ">" beginnende Zeilen ein weiteres - sonst wüsste
 * niemand, ob das ">" zum Text gehörte oder beim Schreiben dazukam.
 */
export function entschaerfeFromZeilen(text: string): string {
  return text.replace(/^(>*From )/gm, '>$1');
}

/** Macht die Entschärfung rückgängig - beim Einlesen einer mbox-Datei. */
export function stelleFromZeilenHer(text: string): string {
  return text.replace(/^>(>*From )/gm, '$1');
}

/**
 * Die Trennzeile vor einer Nachricht.
 *
 * Datum und Absender darin sind nicht Teil der Nachricht, sondern eine Notiz des
 * ablegenden Programms. Das Datumsformat ist das von asctime - kein ISO, sondern
 * "Thu Jan  1 00:00:00 2026", mit zwei Leerzeichen bei einstelligem Tag.
 */
export function mboxTrennzeile(absender: string | undefined, datum: Date | null): string {
  const wochentage = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monate = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = datum ?? new Date(0);

  const zz = (n: number) => String(n).padStart(2, '0');
  const zeitangabe =
    `${wochentage[d.getUTCDay()]} ${monate[d.getUTCMonth()]} ` +
    `${String(d.getUTCDate()).padStart(2, ' ')} ` +
    `${zz(d.getUTCHours())}:${zz(d.getUTCMinutes())}:${zz(d.getUTCSeconds())} ` +
    `${d.getUTCFullYear()}`;

  // Ein Absender mit Leerzeichen zerlegte die Zeile - die Stelle erwartet genau ein Wort.
  const wer = (absender ?? 'unbekannt').replace(/\s+/g, '_') || 'unbekannt';
  return `From ${wer} ${zeitangabe}`;
}

/**
 * Setzt eine Nachricht für die mbox-Datei zusammen: Trennzeile, entschärfter Inhalt,
 * Leerzeile. Die Leerzeile am Ende trennt sie von der nächsten und gehört zum Format.
 */
export function alsMboxEintrag(
  roh: string,
  absender: string | undefined,
  datum: Date | null,
): string {
  const inhalt = entschaerfeFromZeilen(roh.replace(/\r\n/g, '\n')).replace(/\n*$/, '');
  return `${mboxTrennzeile(absender, datum)}\n${inhalt}\n\n`;
}

/**
 * Dasselbe, aber ohne die Bytes anzufassen.
 *
 * Der Weg über eine Zeichenkette war ein stiller Datenverlust: `roh` entstand aus
 * `Buffer.concat(teile).toString('utf-8')`, und damit wurde jedes Byte, das kein
 * gültiges UTF-8 ergibt, durch das Ersatzzeichen U+FFFD ersetzt. Betroffen ist alles
 * mit `Content-Transfer-Encoding: 8bit` und ISO-8859-1-Text - also ein großer Teil
 * älterer Post - und jeder binäre Anhang. Der Verlust ist nicht umkehrbar, und er traf
 * ausgerechnet die Funktion, die als einziger Ausweg aus dem Programm gedacht ist.
 *
 * Die Entschärfung der "From "-Zeilen und die Umstellung der Zeilenenden lassen sich
 * byteweise ebenso erledigen: beide betreffen nur ASCII-Zeichen, die in UTF-8 wie in
 * jeder ISO-8859-Kodierung dieselben Bytes haben.
 */
export function alsMboxEintragBytes(
  roh: Buffer,
  absender: string | undefined,
  datum: Date | null,
): Buffer {
  const zeilen: Buffer[] = [];
  let ab = 0;
  for (let i = 0; i <= roh.length; i++) {
    if (i === roh.length || roh[i] === 0x0a) {
      let zeile = roh.subarray(ab, i);
      // CR am Zeilenende abschneiden - mbox schreibt LF.
      if (zeile.length > 0 && zeile[zeile.length - 1] === 0x0d) {
        zeile = zeile.subarray(0, zeile.length - 1);
      }
      zeilen.push(zeile);
      ab = i + 1;
    }
  }
  // Leerzeilen am Ende weg, damit die Trennung zur nächsten Nachricht eindeutig bleibt.
  while (zeilen.length > 0 && zeilen[zeilen.length - 1]!.length === 0) zeilen.pop();

  const teile: Buffer[] = [Buffer.from(`${mboxTrennzeile(absender, datum)}\n`, 'utf-8')];
  const VON = Buffer.from('From ', 'ascii');
  for (const zeile of zeilen) {
    // mboxrd: jedem "From " am Zeilenanfang wird ein ">" vorangestellt, auch wenn dort
    // schon welche stehen. Umkehrbar - siehe stelleFromZeilenHer.
    let kopf = 0;
    while (kopf < zeile.length && zeile[kopf] === 0x3e) kopf++;
    if (zeile.subarray(kopf, kopf + VON.length).equals(VON)) {
      teile.push(Buffer.from('>', 'ascii'));
    }
    teile.push(zeile, Buffer.from('\n', 'ascii'));
  }
  teile.push(Buffer.from('\n', 'ascii'));
  return Buffer.concat(teile);
}

/**
 * Zerlegt eine mbox-Datei wieder in einzelne Nachrichten - für das Einlesen einer
 * Sicherung. Gegenstück zu alsMboxEintrag.
 */
export function leseMbox(inhalt: string): string[] {
  const text = inhalt.replace(/\r\n/g, '\n');
  const nachrichten: string[] = [];
  let aktuell: string[] | null = null;

  for (const zeile of text.split('\n')) {
    // Nur eine Zeile, die wirklich am Anfang "From " trägt, beginnt eine Nachricht -
    // die entschärften ">From " gehören zum Text.
    if (/^From \S/.test(zeile)) {
      if (aktuell) nachrichten.push(stelleFromZeilenHer(aktuell.join('\n')).replace(/\n*$/, ''));
      aktuell = [];
      continue;
    }
    aktuell?.push(zeile);
  }
  if (aktuell) nachrichten.push(stelleFromZeilenHer(aktuell.join('\n')).replace(/\n*$/, ''));

  return nachrichten.filter((n) => n.trim().length > 0);
}

/** Ein Dateiname, den Windows annimmt - aus Ordnername und Datum. */
export function dateiname(ordner: string, endung: 'mbox' | 'eml'): string {
  const sauber = ordner.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '-').slice(0, 60);
  const heute = new Date().toISOString().slice(0, 10);
  return `${sauber || 'Ordner'}-${heute}.${endung}`;
}
