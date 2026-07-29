import { useCallback, useEffect, useState } from 'react';

/**
 * Verbindung zum Aktualisierungsablauf der Desktop-Hülle.
 *
 * Die Hülle meldet jeden Schritt (suchen, gefunden, laden, bereit); hier wird daraus der
 * Zustand für die Karte unten rechts und die Beschriftung des Knopfes in der Titelleiste.
 *
 * Im Browser betrieben gibt es keine Hülle - dann bleibt es bei "Ruhe", die Karte
 * erscheint nie, und der Knopf sagt schlicht nichts.
 */
export function useAktualisierung() {
  const [stand, setStand] = useState<Aktualisierungsstand>({ phase: 'ruhe' });
  /**
   * Ob die Karte gezeigt wird. Getrennt vom Stand, weil beides auseinanderfällt: eine
   * weggeklickte Karte soll weggeklickt bleiben, während der Ablauf weiterläuft - und
   * eine fertige Fassung soll sich melden, auch wenn vorher etwas weggeklickt wurde.
   */
  const [sichtbar, setSichtbar] = useState(false);

  useEffect(() => {
    const bruecke = window.energyMail;
    if (!bruecke) return;
    void bruecke.aktualisierungStand().then((s) => {
      setStand(s);
      if (s.phase === 'bereit') setSichtbar(true);
    });
    return bruecke.aufAktualisierung((neu) => {
      setStand(neu);
      // Von allein erscheint die Karte nur, wenn eine Entscheidung ansteht oder etwas
      // schiefging. Beim stillen Laden im Hintergrund wäre sie nur im Weg.
      if (neu.phase === 'bereit' || neu.phase === 'fehler') setSichtbar(true);
    });
  }, []);

  /** Der Knopf in der Titelleiste: nur beschriftet, wenn er etwas zu sagen hat. */
  const knopf = (() => {
    switch (stand.phase) {
      case 'suche':
        return { text: 'Suche…', meldet: false };
      case 'gefunden':
        return { text: 'Lädt…', meldet: false };
      case 'laedt':
        return { text: `${Math.round(stand.prozent)} %`, meldet: false };
      case 'bereit':
        return { text: 'Neustart bereit', meldet: true };
      default:
        return null;
    }
  })();

  /**
   * Klick auf den Knopf: die Karte zeigen, wenn es etwas zu zeigen gibt - sonst eine
   * neue Suche anstoßen. Zwei Bedeutungen für einen Knopf, aber es ist immer die, die
   * gerade sinnvoll ist.
   */
  const anstossen = useCallback(() => {
    if (stand.phase === 'ruhe' || stand.phase === 'aktuell') {
      setSichtbar(true);
      window.energyMail?.aktualisierungSuchen();
    } else {
      setSichtbar((s) => !s);
    }
  }, [stand.phase]);

  return {
    stand,
    sichtbar,
    knopf,
    anstossen,
    verbergen: useCallback(() => setSichtbar(false), []),
    neuStarten: useCallback(() => window.energyMail?.jetztNeuStarten(), []),
  };
}
