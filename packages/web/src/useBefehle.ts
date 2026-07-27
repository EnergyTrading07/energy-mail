import { useEffect, useRef } from 'react';

/**
 * Befehle der Anwendung - unabhängig davon, ob sie aus dem Menü, per Tastenkürzel oder
 * per Mausklick kommen. Muss zu menu.ts im Desktop-Paket passen.
 */
export type Befehl =
  | 'verfassen'
  | 'antworten'
  | 'allenAntworten'
  | 'weiterleiten'
  | 'gelesenUmschalten'
  | 'archivieren'
  | 'loeschen'
  | 'suchen'
  | 'neuLaden'
  | 'kontoWeiter'
  | 'regeln'
  /** In der Nachrichtenliste eine Zeile nach unten bzw. oben. */
  | 'weiter'
  | 'zurueck'
  /** Schließt, was gerade offen ist - Verfassen-Fenster, Suche, Fehlermeldung. */
  | 'abbrechen';

/**
 * Ob der Fokus in einem Eingabefeld liegt.
 *
 * Entscheidend für die Tastenbehandlung: wer eine Mail schreibt, erwartet von Entf, dass
 * es ein Zeichen löscht, und von den Pfeiltasten, dass sie den Textcursor bewegen - nicht
 * dass im Hintergrund die Nachrichtenliste wandert oder eine Mail verschwindet.
 */
function imEingabefeld(ziel: EventTarget | null): boolean {
  const el = ziel as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable === true
  );
}

/**
 * Ordnet Tastendrücke und Menübefehle einer Behandlung zu.
 *
 * Die Kürzel mit Strg liegen im Anwendungsmenü - dort sind sie sichtbar und gelten auch,
 * wenn der Fokus irgendwo im Fenster steht. Hier stehen nur die Tasten, die vom Fokus
 * abhängen: Pfeiltasten, Eingabe, Entf und Esc.
 */
export function useBefehle(behandle: (befehl: Befehl) => void): void {
  // Über eine Referenz, damit der Zuhörer nicht bei jeder Zustandsänderung neu
  // registriert werden muss - er soll immer die aktuelle Behandlung sehen.
  const ref = useRef(behandle);
  useEffect(() => {
    ref.current = behandle;
  });

  useEffect(() => {
    const ausMenue = (e: Event) => ref.current((e as CustomEvent<Befehl>).detail);
    window.addEventListener('energy-mail:befehl', ausMenue);

    const beiTaste = (e: KeyboardEvent) => {
      // Esc gilt auch im Eingabefeld - es schließt ja gerade das, worin man steht.
      if (e.key === 'Escape') {
        ref.current('abbrechen');
        return;
      }
      if (imEingabefeld(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;

      const zuordnung: Record<string, Befehl> = {
        ArrowDown: 'weiter',
        ArrowUp: 'zurueck',
        Delete: 'loeschen',
      };
      const befehl = zuordnung[e.key];
      if (!befehl) return;
      // Sonst scrollt die Seite zusätzlich zur Auswahl.
      e.preventDefault();
      ref.current(befehl);
    };
    window.addEventListener('keydown', beiTaste);

    return () => {
      window.removeEventListener('energy-mail:befehl', ausMenue);
      window.removeEventListener('keydown', beiTaste);
    };
  }, []);
}
