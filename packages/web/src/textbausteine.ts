import { vergleiche } from '@energy-mail/mail-core/sprache';
/**
 * Textbausteine für wiederkehrende Formulierungen.
 *
 * Bewusst im Browser gespeichert und nicht auf dem Server: es sind persönliche Notizen
 * ohne Bezug zu einem Konto, sie brauchen keine Verschlüsselung und niemand außer dieser
 * Anwendung liest sie. Ein eigener Ablageort dafür wäre Aufwand ohne Gegenwert.
 *
 * Hier stand "niemand außer dieser Anwendung", und das war die halbe Wahrheit. Der
 * Browserspeicher hängt an der ADRESSE, nicht am angemeldeten Nutzer - im Serverbetrieb
 * teilen sich alle, die dasselbe Postfach über denselben Browser aufrufen, denselben
 * Eintrag. Wer sich abmeldete, ließ seine Bausteine dem Nächsten stehen: Anreden,
 * Formulierungen, Krankmeldungen, ganze Absätze. Die Trennung der Nutzer reichte bis in
 * jede Datei auf dem Server und endete ausgerechnet hier, wo keine liegt.
 *
 * Deshalb räumt raeumeOertlicheDatenAuf() beim Abmelden auf. Der Einplatzbetrieb merkt
 * nichts davon - dort gibt es kein Abmelden.
 */

export interface Textbaustein {
  id: string;
  name: string;
  /** Inhalt als HTML - er wird in den Editor eingefügt, der ebenfalls HTML führt. */
  html: string;
}

const SCHLUESSEL = 'energy-mail:textbausteine';

export function ladeBausteine(): Textbaustein[] {
  try {
    const roh = localStorage.getItem(SCHLUESSEL);
    return roh ? (JSON.parse(roh) as Textbaustein[]) : [];
  } catch {
    // Beschädigter Eintrag darf das Verfassen nicht blockieren.
    return [];
  }
}

function speichere(bausteine: Textbaustein[]): void {
  localStorage.setItem(SCHLUESSEL, JSON.stringify(bausteine));
}

export function bausteinSichern(name: string, html: string): Textbaustein[] {
  const bausteine = ladeBausteine();
  const sauber = name.trim();
  const vorhanden = bausteine.findIndex((b) => b.name.toLowerCase() === sauber.toLowerCase());
  const neu: Textbaustein = {
    id: vorhanden >= 0 ? bausteine[vorhanden].id : `${Date.now()}`,
    name: sauber,
    html,
  };
  // Gleicher Name ersetzt, statt eine zweite Zeile mit derselben Beschriftung anzulegen -
  // sonst wüsste beim Einfügen niemand, welche der beiden gemeint ist.
  if (vorhanden >= 0) bausteine[vorhanden] = neu;
  else bausteine.push(neu);

  bausteine.sort((a, b) => vergleiche(a.name, b.name));
  speichere(bausteine);
  return bausteine;
}

export function bausteinLoeschen(id: string): Textbaustein[] {
  const uebrig = ladeBausteine().filter((b) => b.id !== id);
  speichere(uebrig);
  return uebrig;
}

/**
 * Räumt beim Abmelden weg, was von einem Nutzer im Browser zurückbliebe.
 *
 * Nur der Inhalt, nicht die Einstellungen: dass der Nächste dieselbe Sortierung oder
 * dieselbe Zeilendichte vorfindet, ist keine Auskunft über jemanden. Was er geschrieben
 * hat, schon.
 *
 * Wird das eigentliche Abmelden am Server nicht angenommen, läuft das hier trotzdem -
 * eine halbe Abmeldung ist die schlechteste von allen.
 */
export function raeumeOertlicheDatenAuf(): void {
  try {
    localStorage.removeItem(SCHLUESSEL);
  } catch {
    // Ein Browser, der den Speicher sperrt, hat auch nichts hineingeschrieben.
  }
}
