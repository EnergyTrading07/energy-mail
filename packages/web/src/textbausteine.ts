/**
 * Textbausteine für wiederkehrende Formulierungen.
 *
 * Bewusst im Browser gespeichert und nicht auf dem Server: es sind persönliche Notizen
 * ohne Bezug zu einem Konto, sie brauchen keine Verschlüsselung und niemand außer dieser
 * Anwendung liest sie. Ein eigener Ablageort dafür wäre Aufwand ohne Gegenwert.
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

  bausteine.sort((a, b) => a.name.localeCompare(b.name, 'de'));
  speichere(bausteine);
  return bausteine;
}

export function bausteinLoeschen(id: string): Textbaustein[] {
  const uebrig = ladeBausteine().filter((b) => b.id !== id);
  speichere(uebrig);
  return uebrig;
}
