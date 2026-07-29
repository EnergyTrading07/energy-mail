import { useEffect, useState } from 'react';

/**
 * Helle oder dunkle Ansicht.
 *
 * Drei Einstellungen statt zwei: "System" ist die Vorgabe und folgt dem, was Windows
 * gerade vorgibt - dort schaltet die Nachtansicht bei vielen zeitgesteuert um, und ein
 * Mailprogramm, das dann als einzige helle Fläche stehen bliebe, wäre der Ausreißer.
 * Wer das nicht will, legt sich auf hell oder dunkel fest; die Wahl übersteht Neustarts.
 *
 * Die Umsetzung ist absichtlich schlicht: gesetzt wird nur ein Attribut am Wurzelelement,
 * den Rest erledigen die Wertelisten in tokens.css. Dadurch gibt es keinen Zustand, den
 * einzelne Bausteine kennen müssten - und kein Aufblitzen, weil nichts neu gezeichnet
 * werden muss außer den Farben selbst.
 */

export type Themawahl = 'system' | 'hell' | 'dunkel';
export type Ansicht = 'hell' | 'dunkel';

const SCHLUESSEL = 'energy-mail:thema';

/** Was Windows gerade vorgibt. */
function systemAnsicht(): Ansicht {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dunkel' : 'hell';
}

export function gespeicherteWahl(): Themawahl {
  const wert = localStorage.getItem(SCHLUESSEL);
  return wert === 'hell' || wert === 'dunkel' ? wert : 'system';
}

export function ansichtZu(wahl: Themawahl): Ansicht {
  return wahl === 'system' ? systemAnsicht() : wahl;
}

/**
 * Trägt die Ansicht ins Wurzelelement ein und meldet sie der Desktop-Hülle.
 *
 * Die Meldung ist nötig, weil die Fensterkanten und die Schaltflächen zum Schließen von
 * Windows selbst gezeichnet werden: ohne sie bliebe dort eine helle Leiste über einer
 * dunklen Anwendung stehen. Im Browser betrieben fehlt die Brücke schlicht, dann
 * passiert an dieser Stelle nichts.
 */
export function setzeAnsicht(ansicht: Ansicht): void {
  document.documentElement.dataset.thema = ansicht;
  window.energyMail?.setzeAnsicht?.(ansicht);
}

/**
 * Wird vor dem ersten Zeichnen aufgerufen (aus main.tsx), damit die Anwendung nicht
 * einen Lidschlag lang hell erscheint, bevor React die Einstellung liest.
 */
export function wendeGespeichertesThemaAn(): void {
  setzeAnsicht(ansichtZu(gespeicherteWahl()));
}

export function useThema(): {
  wahl: Themawahl;
  ansicht: Ansicht;
  setzeWahl: (wahl: Themawahl) => void;
  umschalten: () => void;
} {
  const [wahl, setWahlIntern] = useState<Themawahl>(gespeicherteWahl);
  const [ansicht, setAnsicht] = useState<Ansicht>(() => ansichtZu(gespeicherteWahl()));

  // Nur solange "System" gilt: sonst hört hier niemand zu, und eine getroffene
  // Festlegung würde von der Systemeinstellung überschrieben.
  useEffect(() => {
    if (wahl !== 'system') return;
    const abfrage = window.matchMedia('(prefers-color-scheme: dark)');
    const reagiere = () => {
      const neu = systemAnsicht();
      setAnsicht(neu);
      setzeAnsicht(neu);
    };
    abfrage.addEventListener('change', reagiere);
    return () => abfrage.removeEventListener('change', reagiere);
  }, [wahl]);

  const setzeWahl = (neu: Themawahl) => {
    setWahlIntern(neu);
    localStorage.setItem(SCHLUESSEL, neu);
    const wirksam = ansichtZu(neu);
    setAnsicht(wirksam);
    setzeAnsicht(wirksam);
  };

  return {
    wahl,
    ansicht,
    setzeWahl,
    // Der Knopf in der Titelleiste kennt nur "anders herum als jetzt". Aus "System"
    // heraus wird dabei bewusst festgelegt: wer klickt, will eine Entscheidung treffen.
    umschalten: () => setzeWahl(ansicht === 'dunkel' ? 'hell' : 'dunkel'),
  };
}
