import { useEffect } from 'react';

/**
 * Kontextmenü einer Ordnerzeile.
 *
 * Rechtsklick ist für Ordner die gewohnte Bedienung, und die Alternativen sind schlechter:
 * Schaltflächen in jeder Zeile würden die Seitenleiste zustellen, ein eigener
 * Verwaltungsdialog verlangt einen Umweg für etwas, das man an Ort und Stelle erledigt.
 */

export interface MenuEintrag {
  label: string;
  /** Fehlt die Behandlung, steht der Eintrag als nicht wählbar da - mit Begründung. */
  onClick?: () => void;
  grund?: string;
  /** Hebt Unumkehrbares hervor. */
  gefaehrlich?: boolean;
}

interface Props {
  x: number;
  y: number;
  eintraege: MenuEintrag[];
  onClose: () => void;
}

export function FolderMenu({ x, y, eintraege, onClose }: Props) {
  // Jeder Klick daneben und jede Taste schließt - ein Kontextmenü, das stehen bleibt,
  // ist schlimmer als keines.
  useEffect(() => {
    const schliessen = () => onClose();
    window.addEventListener('click', schliessen);
    window.addEventListener('contextmenu', schliessen);
    window.addEventListener('keydown', schliessen);
    window.addEventListener('resize', schliessen);
    return () => {
      window.removeEventListener('click', schliessen);
      window.removeEventListener('contextmenu', schliessen);
      window.removeEventListener('keydown', schliessen);
      window.removeEventListener('resize', schliessen);
    };
  }, [onClose]);

  return (
    <div
      className="kontextmenue"
      // Am unteren Rand nach oben klappen, sonst ragt es aus dem Fenster.
      style={{
        left: x,
        top: Math.min(y, window.innerHeight - eintraege.length * 30 - 16),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {eintraege.map((eintrag) => (
        <button
          key={eintrag.label}
          className={`kontextmenue-eintrag${eintrag.gefaehrlich ? ' gefaehrlich' : ''}`}
          disabled={!eintrag.onClick}
          title={eintrag.grund}
          onClick={() => {
            eintrag.onClick?.();
            onClose();
          }}
        >
          {eintrag.label}
        </button>
      ))}
    </div>
  );
}
