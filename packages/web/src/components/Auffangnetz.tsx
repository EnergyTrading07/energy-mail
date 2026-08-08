import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Fängt Fehler beim Zeichnen ab, damit nicht das ganze Fenster verschwindet.
 *
 * React nimmt bei einer Ausnahme im Zeichnen den gesamten Baum vom Bildschirm - nicht
 * nur das fehlerhafte Stück. Genau das ist beim Bau der Einladungskarte passiert: ein
 * Datum, das über die Leitung zur Zeichenkette geworden war, ließ sich nicht formatieren,
 * und statt einer fehlenden Karte stand ein leeres Fenster da. Kein Ordner, keine Liste,
 * kein Hinweis - nur eine leere Fläche.
 *
 * Ein Fehler in einem Teil darf höchstens diesen Teil kosten. Was hier eingefasst ist,
 * wird im Fehlerfall durch eine Meldung ersetzt; der Rest der Anwendung bleibt bedienbar.
 */

interface Props {
  children: ReactNode;
  /** Womit ersetzt wird. Bekommt die Meldung, damit sie sichtbar gemacht werden kann. */
  ersatz: (fehler: Error, nochmal: () => void) => ReactNode;
  /**
   * Ändert sich dieser Wert, wird ein neuer Versuch unternommen. Ohne das bliebe die
   * Fehlermeldung auch dann stehen, wenn längst eine andere Nachricht gewählt wurde.
   */
  schluessel?: string | number | null;
}

interface Zustand {
  fehler: Error | null;
}

export class Auffangnetz extends Component<Props, Zustand> {
  state: Zustand = { fehler: null };

  static getDerivedStateFromError(fehler: Error): Zustand {
    return { fehler };
  }

  componentDidUpdate(vorher: Props): void {
    if (this.state.fehler && vorher.schluessel !== this.props.schluessel) {
      this.setState({ fehler: null });
    }
  }

  componentDidCatch(fehler: Error, info: ErrorInfo): void {
    // In die Entwicklerkonsole, nicht nur auf den Bildschirm: dort steht auch, an
    // welcher Stelle im Baum es geschah.
    console.error('Fehler beim Zeichnen:', fehler, info.componentStack);
  }

  render(): ReactNode {
    const { fehler } = this.state;
    if (fehler) return this.props.ersatz(fehler, () => this.setState({ fehler: null }));
    return this.props.children;
  }
}
