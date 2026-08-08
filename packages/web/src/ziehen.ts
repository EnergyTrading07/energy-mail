import type { FolderInfo } from '@energy-mail/mail-core';

/**
 * Nachrichten mit der Maus in einen Ordner ziehen.
 *
 * Der Teil, der hier steht, ist die Entscheidung: was darf wohin. Sie gehört getrennt vom
 * Zeichnen, weil ein Fehler darin teuer ist - eine Nachricht, die im falschen Postfach
 * landet, ist verschoben, bevor jemand es merkt, und beim Ziehen gibt es kein "Sind Sie
 * sicher?", das noch aufhielte.
 *
 * Drei Fälle müssen abgewiesen werden, und alle drei kommen im Alltag vor:
 *
 *   Der Ordner, in dem die Nachricht schon liegt. Ein Verschieben dorthin ist bestenfalls
 *   wirkungslos - bei manchen Servern aber ein Kopieren mit anschließendem Löschen des
 *   Originals, und das vergibt neue Nummern.
 *
 *   Ordner, die keine Nachrichten aufnehmen. Gmails "[Gmail]" ist reine Gliederung; ein
 *   Verschieben dorthin scheitert erst beim Server.
 *
 *   Ein anderes Konto. Zwischen zwei Postfächern kann IMAP nicht verschieben - das wäre
 *   Herunterladen und neu Hochladen, ein ganz anderer Vorgang mit ganz anderen Folgen.
 */

/** Was am Zeiger hängt, während gezogen wird. */
export interface Fracht {
  accountId: string;
  ordner: string;
  uids: number[];
}

/**
 * Die Art, unter der die Fracht im Ziehvorgang steckt.
 *
 * Ein eigener Name statt "text/plain": nur so lässt sich beim Überfahren erkennen, ob es
 * überhaupt um Nachrichten geht. Zöge jemand Text aus einem anderen Fenster über die
 * Ordnerliste, sähe sie sonst genauso aus, als ließe sich etwas ablegen.
 */
export const FRACHT_ART = 'application/x-energy-mail-nachrichten';

export function alsFracht(fracht: Fracht): string {
  return JSON.stringify(fracht);
}

/** Liest die Fracht zurück. Alles Unbrauchbare ergibt null statt einer Ausnahme. */
export function ausFracht(roh: string | null | undefined): Fracht | null {
  if (!roh) return null;
  try {
    const gelesen = JSON.parse(roh) as Partial<Fracht>;
    if (
      typeof gelesen.accountId !== 'string' ||
      typeof gelesen.ordner !== 'string' ||
      !Array.isArray(gelesen.uids) ||
      gelesen.uids.length === 0 ||
      !gelesen.uids.every((uid) => Number.isInteger(uid) && uid > 0)
    ) {
      return null;
    }
    return { accountId: gelesen.accountId, ordner: gelesen.ordner, uids: gelesen.uids };
  } catch {
    return null;
  }
}

export interface Ablagepruefung {
  /** Ob abgelegt werden darf. */
  erlaubt: boolean;
  /** Warum nicht - für den Hinweis am Zeiger. */
  grund?: string;
}

/**
 * Darf diese Fracht in diesen Ordner?
 *
 * "kontoDesOrdners" ist nötig, weil die Ordnerliste alle Konten zeigt: derselbe Pfad
 * "INBOX" gibt es in jedem, und ohne die Kennung landete eine GMX-Nachricht im
 * Gmail-Posteingang - oder genauer: der Server suchte dort eine UID, die es nicht gibt.
 */
export function darfAblegen(
  fracht: Fracht | null,
  ziel: FolderInfo | undefined,
  kontoDesOrdners: string,
): Ablagepruefung {
  if (!fracht) return { erlaubt: false };
  if (!ziel) return { erlaubt: false };

  if (fracht.accountId !== kontoDesOrdners) {
    return {
      erlaubt: false,
      grund: 'Zwischen zwei Konten lässt sich nicht verschieben.',
    };
  }
  if (!ziel.selectable) {
    return { erlaubt: false, grund: 'Dieser Ordner kann keine Nachrichten aufnehmen.' };
  }
  if (ziel.path === fracht.ordner) {
    return { erlaubt: false, grund: 'Die Nachricht liegt schon hier.' };
  }
  return { erlaubt: true };
}

/**
 * Welche Nachrichten gezogen werden.
 *
 * Zieht man an einer angekreuzten Zeile, gilt die ganze Auswahl - das erwartet jeder, der
 * zuvor mehrere angekreuzt hat. Zieht man an einer nicht angekreuzten, gilt nur diese;
 * die Auswahl bleibt dabei unberührt, denn sonst verlöre ein versehentliches Ziehen die
 * mühsam zusammengeklickte Liste.
 */
export function frachtFuer(
  angefasst: number,
  angekreuzt: ReadonlySet<number>,
): number[] {
  return angekreuzt.has(angefasst) ? [...angekreuzt] : [angefasst];
}

/** Was am Zeiger steht, während gezogen wird. */
export function ziehtext(anzahl: number): string {
  return anzahl === 1 ? '1 Nachricht' : `${anzahl} Nachrichten`;
}

// --- Dateien in das Verfassen-Fenster ziehen ---

/**
 * Ob ein Ziehvorgang Dateien mitbringt.
 *
 * Beim Überfahren ("dragover") sind die Dateien selbst noch nicht lesbar - der Browser
 * gibt nur ihre Art preis. Wer stattdessen auf "files.length" prüft, bekommt dort immer
 * null und zeigt die Ablagefläche nie an.
 */
export function bringtDateien(arten: readonly string[] | undefined): boolean {
  return (arten ?? []).includes('Files');
}
