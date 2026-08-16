import { t } from './sprache.js';

/**
 * Die Formatierleiste beim Verfassen.
 *
 * Hier steht, was sie kann und was beim Einfügen aus anderen Programmen davon übrig
 * bleibt. Beides gehört getrennt von der Darstellung: das eine ist eine Tabelle, das
 * andere eine Sicherheitsfrage.
 */

export interface Werkzeug {
  /** Der Befehl für document.execCommand. */
  befehl: string;
  wert?: string;
  titel: string;
  /** Was auf dem Knopf steht. */
  aufschrift: string;
  /**
   * Ob sich der Zustand abfragen lässt. Bei "fett" kann man sehen, ob er gerade gilt;
   * bei "Formatierung entfernen" gibt es nichts zu sehen.
   */
  zeigtZustand?: boolean;
}

/**
 * Die Leiste in Gruppen.
 *
 * Gruppiert, weil eine Reihe aus zwanzig Knöpfen niemand mehr überfliegt. Die
 * Reihenfolge folgt dem, was man am häufigsten braucht - Auszeichnung vor Absatz vor
 * Listen; Rückgängig und Farben zuletzt.
 */
export function werkzeuge(): Werkzeug[][] {
  /*
   * Eine Funktion und keine Konstante, und die Aufschriften gehen mit durch t().
   *
   * Auf einem englischen Rechner steht auf dem Fett-Knopf ein B und nicht ein F - das
   * ist keine Spielerei, sondern die Beschriftung, nach der jemand sucht, der aus Word
   * oder Outlook kommt. Deshalb ist auch das eine Übersetzung und keine feste Marke.
   */
  return [
    [
      { befehl: 'bold', titel: t('Fett (Strg+B)'), aufschrift: t('F'), zeigtZustand: true },
      { befehl: 'italic', titel: t('Kursiv (Strg+I)'), aufschrift: t('K'), zeigtZustand: true },
      {
        befehl: 'underline',
        titel: t('Unterstrichen (Strg+U)'),
        aufschrift: t('U'),
        zeigtZustand: true,
      },
      {
        befehl: 'strikeThrough',
        titel: t('Durchgestrichen'),
        aufschrift: t('S'),
        zeigtZustand: true,
      },
    ],
    [
      {
        befehl: 'formatBlock',
        wert: 'h2',
        titel: t('Überschrift'),
        aufschrift: t('H'),
      },
      {
        befehl: 'formatBlock',
        wert: 'blockquote',
        titel: t('Zitat'),
        aufschrift: '❞',
      },
      {
        befehl: 'formatBlock',
        wert: 'pre',
        titel: t('Feste Schrittweite - für Zahlen und Befehle'),
        aufschrift: '</>',
      },
      {
        befehl: 'formatBlock',
        wert: 'p',
        titel: t('Wieder gewöhnlicher Absatz'),
        aufschrift: '¶',
      },
    ],
    [
      {
        befehl: 'insertUnorderedList',
        titel: t('Aufzählung'),
        aufschrift: '•',
        zeigtZustand: true,
      },
      {
        befehl: 'insertOrderedList',
        titel: t('Nummerierung'),
        aufschrift: '1.',
        zeigtZustand: true,
      },
      { befehl: 'outdent', titel: t('Ausrücken'), aufschrift: '⇤' },
      { befehl: 'indent', titel: t('Einrücken'), aufschrift: '⇥' },
    ],
    [
      { befehl: 'undo', titel: t('Rückgängig (Strg+Z)'), aufschrift: '↶' },
      { befehl: 'redo', titel: t('Wiederherstellen (Strg+Y)'), aufschrift: '↷' },
      { befehl: 'removeFormat', titel: t('Formatierung entfernen'), aufschrift: 'A̶' },
    ],
  ];
}

/** Farben für Text. Wenige und kräftige - eine Farbwahl mit 200 Tönen braucht niemand. */
export function textfarben(): { name: string; wert: string }[] {
  return [
    { name: t('Schwarz'), wert: '#1c2430' },
    { name: t('Rot'), wert: '#c1121f' },
    { name: t('Grün'), wert: '#127a3d' },
    { name: t('Blau'), wert: '#1b4fd8' },
    { name: t('Grau'), wert: '#6b7280' },
  ];
}

/**
 * Übersetzt einen Tastendruck in einen Befehl.
 *
 * Fett, kursiv und unterstrichen kann der Browser von selbst; die übrigen nicht. Die
 * Tabelle steht hier, damit sich prüfen lässt, dass sie keine Tastenkürzel belegt, die
 * anderswo gebraucht werden - Strg+Umschalt+7 etwa ist in fast jedem Programm die
 * Nummerierung.
 */
export function befehlFuerTaste(e: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): { befehl: string; wert?: string } | null {
  if (!e.ctrlKey && !e.metaKey) return null;
  const taste = e.key.toLowerCase();

  if (e.shiftKey) {
    switch (taste) {
      case '7':
        return { befehl: 'insertOrderedList' };
      case '8':
        return { befehl: 'insertUnorderedList' };
      case 'x':
        return { befehl: 'strikeThrough' };
      default:
        return null;
    }
  }

  switch (taste) {
    case 'y':
      return { befehl: 'redo' };
    default:
      return null;
  }
}

// --- Einfügen aus anderen Programmen ---

/**
 * Was beim Einfügen erhalten bleibt.
 *
 * Vorher wurde alles zu nacktem Text: wer einen Absatz aus einem Schreibprogramm
 * herüberholte, verlor Fettdruck, Listen und Verweise. Alles zu übernehmen ist aber
 * genauso falsch - fremdes HTML bringt Schriftarten, Farben, Größenangaben und ganze
 * Tabellenlayouts mit, und in einer Mail sieht das aus wie ein Unfall.
 *
 * Erhalten bleibt deshalb die Auszeichnung, nicht die Gestaltung.
 */
const ERLAUBTE_ELEMENTE = new Set([
  'A',
  'B',
  'STRONG',
  'I',
  'EM',
  'U',
  'S',
  'STRIKE',
  'P',
  'BR',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'CODE',
  'H1',
  'H2',
  'H3',
  'DIV',
  'SPAN',
]);

/** Nur bei Verweisen bleibt ein Merkmal übrig, und auch das wird geprüft. */
const ERLAUBTE_MERKMALE: Record<string, string[]> = { A: ['href'] };

export interface Reinigungsregeln {
  elemente: ReadonlySet<string>;
  merkmale: Record<string, string[]>;
}

/**
 * Was aus einem anderen Programm eingefügt oder aus einer fremden Nachricht zitiert
 * wird. Auszeichnung bleibt, Gestaltung nicht - siehe oben.
 */
export const REGELN_FREMD: Reinigungsregeln = {
  elemente: ERLAUBTE_ELEMENTE,
  merkmale: ERLAUBTE_MERKMALE,
};

/**
 * Was aus dem eigenen Editor stammt und über den Server zurückkommt - also ein Entwurf.
 *
 * Warum überhaupt gereinigt: Ein Entwurf liegt im Postfach, nicht bei uns. Was von dort
 * zurückkommt, ist Fremdeingabe - auch wenn es der Nutzer selbst geschrieben hat.
 * Vorher ging er ungefiltert in den Editor, während Antwort, Weiterleitung und Einfügen
 * alle durch die Reinigung liefen. Damit standen für einen Entwurf genau die beiden
 * Dinge offen, deretwegen raeumeZitatAuf() geschrieben wurde: Bilder von fremden Servern
 * (also Zählpixel) und <style>-Blöcke, die im ganzen Verfassen-Fenster gelten und sich
 * über Knöpfe legen lassen.
 *
 * Warum eine EIGENE Liste und nicht dieselbe: Der Editor erzeugt für seine Farbknöpfe
 * <font color> (execCommand ohne styleWithCSS). Mit der fremden Liste gereinigt verlöre
 * ein Entwurf beim Öffnen die Farben, die der Nutzer selbst gesetzt hat - eine
 * Verschlechterung, die er zu Recht als Fehler meldete. Erlaubt ist deshalb genau ein
 * Element mehr, mit genau einem Merkmal, und dessen Wert wird geprüft.
 */
export const REGELN_ENTWURF: Reinigungsregeln = {
  elemente: new Set([...ERLAUBTE_ELEMENTE, 'FONT']),
  merkmale: { ...ERLAUBTE_MERKMALE, FONT: ['color'] },
};

/**
 * Eine Farbangabe, wie der Editor sie schreibt: "#1c2430" oder ein Farbwort.
 *
 * Geprüft, weil auch ein color-Merkmal ein Wert ist, der aus dem Postfach kommt. Was
 * nicht wie eine Farbe aussieht, fliegt heraus - ein Merkmal durchzulassen, ohne seinen
 * Inhalt anzusehen, ist die Art Lücke, die man später nicht mehr findet.
 */
const FARBWERT = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;

/** Adressen, die beim Anklicken etwas ausführen könnten, kommen nicht durch. */
export function istUnbedenklicheAdresse(adresse: string): boolean {
  const sauber = adresse.trim().toLowerCase();
  // Auch verschleierte Formen: "java\tscript:" oder "JaVaScRiPt:".
  const ohneLeerraum = sauber.replace(/[\s\u0000-\u001f]/g, '');
  if (/^(javascript|data|vbscript|file):/.test(ohneLeerraum)) return false;
  return /^(https?:|mailto:|#|\/|\.)/.test(ohneLeerraum) || !ohneLeerraum.includes(':');
}

/**
 * Räumt eingefügtes HTML auf.
 *
 * Arbeitet auf einem Baum, den der Aufrufer baut - so lässt sich dieselbe Funktion in
 * der Anwendung wie in den Prüfungen benutzen, ohne dass hier ein Browser nötig wäre.
 */
export function raeumeEingefuegtesAuf(
  wurzel: Element,
  dokument: Document,
  regeln: Reinigungsregeln = REGELN_FREMD,
): void {
  /**
   * Was samt Inhalt verschwindet.
   *
   * Sonst bliebe der Programmtext als sichtbarer Text stehen - "alert(1)" mitten im
   * Brief. Bei allem anderen ist der Inhalt das, was man einfügen wollte, und darf
   * nicht verlorengehen.
   */
  for (const element of [...wurzel.querySelectorAll('script, style, noscript, template')]) {
    element.remove();
  }

  // Rückwärts durchgehen: beim Ersetzen ändert sich die Liste unter den Füßen.
  const alle = [...wurzel.querySelectorAll('*')].reverse();

  for (const element of alle) {
    const name = element.tagName.toUpperCase();

    if (!regeln.elemente.has(name)) {
      // Nicht wegwerfen, sondern auflösen: der Text darin gehört zum Eingefügten.
      // Ein <table> ganz zu entfernen kostete den Inhalt.
      const ersatz = dokument.createDocumentFragment();
      while (element.firstChild) ersatz.appendChild(element.firstChild);
      element.replaceWith(ersatz);
      continue;
    }

    const erlaubt = regeln.merkmale[name] ?? [];
    for (const merkmal of [...element.attributes]) {
      if (!erlaubt.includes(merkmal.name.toLowerCase())) {
        element.removeAttribute(merkmal.name);
      }
    }

    if (name === 'FONT') {
      const farbe = element.getAttribute('color') ?? '';
      if (!FARBWERT.test(farbe.trim())) element.removeAttribute('color');
    }

    if (name === 'A') {
      const ziel = element.getAttribute('href') ?? '';
      if (!istUnbedenklicheAdresse(ziel)) element.removeAttribute('href');
      else {
        // Verweise aus fremdem Text gehen nach draußen - im eigenen Fenster geöffnet
        // ersetzten sie das Verfassen-Fenster samt Entwurf.
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }
}

/**
 * Räumt den zitierten Verlauf einer Antwort oder Weiterleitung auf.
 *
 * Dasselbe wie beim Einfügen aus einem anderen Programm, und aus demselben Grund - nur
 * wiegt es hier schwerer. Gemessen an einer echten Werbenachricht: beim Lesen wurden
 * elf Inhalte von fremden Servern zurückgehalten, beim Druck auf "Antworten" gingen
 * genau diese elf hinaus, darunter ein Zählpixel. Der Absender erfuhr also doch, dass
 * seine Nachricht offen war - obwohl der Schutz beim Lesen gegriffen hatte.
 *
 * Dazu lag im Zitat ein <style>-Block aus der fremden Nachricht. Der gilt im ganzen
 * Fenster, nicht nur im Zitat, und ließe sich benutzen, um Knöpfe zu verdecken.
 *
 * Dass dabei auch Bilder verschwinden, die man gern behalten hätte, ist der Preis. Ein
 * Bild im Zitat lässt sich nicht von einem Zählpixel unterscheiden, solange es an einer
 * fremden Adresse hängt.
 */
export function raeumeZitatAuf(
  html: string,
  dokument: Document,
  regeln: Reinigungsregeln = REGELN_FREMD,
): string {
  /*
   * Das Aufräumen geschieht in einem eigenen, unbeteiligten Dokument.
   *
   * Das ist keine Feinheit, sondern der Kern der Sache: Setzt man den fremden Text per
   * innerHTML in ein Element des laufenden Dokuments, holt der Browser die Bilder
   * sofort - auch wenn das Element nirgends hängt und gleich darauf geleert wird. Genau
   * das ist mir hier zuerst passiert: das Zitat war danach sauber, und die elf Anfragen
   * gingen trotzdem hinaus. Ein Dokument aus createHTMLDocument lädt nichts nach.
   */
  const abseits = dokument.implementation.createHTMLDocument('');
  const behaelter = abseits.createElement('div');
  behaelter.innerHTML = html;
  raeumeEingefuegtesAuf(behaelter, abseits, regeln);
  return behaelter.innerHTML;
}

/**
 * Räumt einen Entwurf auf, der aus dem Postfach zurückkommt.
 *
 * Derselbe Weg wie beim Zitat, nur mit dem etwas weiteren Regelwerk - die Begründung
 * steht bei REGELN_ENTWURF. Eigene Funktion statt eines zweiten Arguments an der
 * Aufrufstelle, damit an der Stelle in App.tsx zu lesen ist, WAS dort gereinigt wird.
 */
export function raeumeEntwurfAuf(html: string, dokument: Document): string {
  return raeumeZitatAuf(html, dokument, REGELN_ENTWURF);
}

/**
 * Ergänzt bei einer Adresse ohne Vorsatz das "https://".
 *
 * Wer "firma.de" eintippt, meint die Webseite und nicht eine Datei namens "firma.de".
 * Bei allem, was schon einen Vorsatz trägt, wird nichts geändert.
 */
export function normalisiereAdresse(eingabe: string): string {
  const text = eingabe.trim();
  if (!text) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  // Sieht es nach einer Mailadresse aus, ist "mailto:" gemeint.
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return `mailto:${text}`;
  return `https://${text}`;
}
