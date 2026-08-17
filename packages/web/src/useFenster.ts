import { useEffect, useId, useRef } from 'react';
import { ansteuerbare, ersterFokus, naechstesZiel } from './barrierefrei.js';

/**
 * Was ein Fenster über der Anwendung tun muss, damit es auch ohne Maus und ohne Blick
 * auf den Bildschirm benutzbar ist.
 *
 * Die zehn Fenster im Programm hatten das jedes für sich gar nicht: kein role, kein
 * Name, und der Fokus blieb draußen auf dem Knopf, der sie geöffnet hatte. Eine
 * Vorlesesoftware las daraufhin weiter die Anwendung dahinter vor, und mit der
 * Tabulatortaste landete man in Feldern, die vom Fenster verdeckt waren.
 *
 * Rückgabe sind die Merkmale für den Rahmen und für die Überschrift - beide müssen
 * gesetzt werden, sonst hat das Fenster keinen Namen.
 *
 * `aktiv` ist der eine Fall, in dem nichts davon gelten darf: Steht derselbe Baustein als
 * Tafel im Einstellungsfenster (siehe Fenster.tsx), ist er kein Fenster mehr, sondern ein
 * Abschnitt darin. Zwei ineinanderliegende Fokusfallen stritten sonst um die
 * Tabulatortaste, und Escape schlösse die Tafel statt des Fensters, in dem sie steht.
 * Bewusst ein Schalter am Haken statt eines Aufrufs, den man weglässt: Haken lassen sich
 * nicht bedingt aufrufen, und ein zweiter, fast gleicher Haken daneben liefe auseinander.
 */
export function useFenster(schliessen: () => void, aktiv = true) {
  const rahmen = useRef<HTMLDivElement>(null);
  const titelId = useId();
  // Über eine Referenz, damit ein neu gebautes Schließen den Zuhörer nicht ersetzt -
  // sonst ginge beim Tippen in einem Feld der Fokus jedes Mal neu an den Anfang.
  const zu = useRef(schliessen);
  useEffect(() => {
    zu.current = schliessen;
  });

  useEffect(() => {
    if (!aktiv) return;
    const rueckkehr = document.activeElement as HTMLElement | null;
    const bereich = rahmen.current;
    if (bereich) ersterFokus(bereich).focus();

    const taste = (e: KeyboardEvent) => {
      if (!rahmen.current) return;
      /*
       * Nur das oberste Fenster reagiert.
       *
       * Steht eine Rückfrage über einem Fenster, hörten sonst beide dieselbe Taste:
       * Escape hätte die Rückfrage beantwortet und das Fenster darunter gleich mit
       * geschlossen, und die Tabulatortaste wäre in beiden Rundläufen zugleich
       * gelaufen. Rückfragen und Meldungen hängen neben der Anwendung im Baum (siehe
       * main.tsx) und stehen deshalb immer hinter ihr.
       */
      const fenster = document.querySelectorAll('[role="dialog"]');
      if (fenster.length > 1 && fenster[fenster.length - 1] !== rahmen.current) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        // In der Erfassungsphase und angehalten: sonst behandelt die Anwendung darunter
        // dieselbe Taste und schließt gleich noch das Fenster dahinter mit.
        e.stopPropagation();
        zu.current();
        return;
      }

      if (e.key !== 'Tab') return;
      const ziel = naechstesZiel(ansteuerbare(rahmen.current), document.activeElement, e.shiftKey);
      if (!ziel) return;
      e.preventDefault();
      ziel.focus();
    };

    window.addEventListener('keydown', taste, true);
    return () => {
      window.removeEventListener('keydown', taste, true);
      // Zurück auf den Knopf, von dem man kam - sonst steht der Fokus nach dem
      // Schließen wieder ganz am Anfang der Seite.
      if (rueckkehr?.isConnected) rueckkehr.focus();
    };
  }, [aktiv]);

  return {
    /** Auf den Rahmen des Fensters. */
    rahmenMerkmale: {
      ref: rahmen,
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': titelId,
      // Damit der Fokus auf dem Fenster selbst liegen kann, wenn es kein Feld gibt.
      tabIndex: -1,
    },
    /** Auf die Überschrift des Fensters - sie gibt ihm seinen Namen. */
    titelMerkmale: { id: titelId },
  };
}
