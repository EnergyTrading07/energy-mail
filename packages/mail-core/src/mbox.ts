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
