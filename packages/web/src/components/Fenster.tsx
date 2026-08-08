import type { ReactNode } from 'react';
import { useFenster } from '../useFenster.js';

/**
 * Der Rahmen für ein Fenster über der Anwendung.
 *
 * Vorher baute jedes der zehn Fenster ihn selbst - und keines vollständig: es gab
 * keine Auszeichnung als Fenster, keinen Namen, und der Fokus blieb draußen auf dem
 * Knopf, der es geöffnet hatte. Eine Vorlesesoftware las daraufhin die Anwendung
 * dahinter weiter vor, und mit der Tabulatortaste landete man in Feldern, die vom
 * Fenster verdeckt waren.
 *
 * Alles, was dazugehört, steckt jetzt an einer Stelle: Auszeichnung, Name, Fokus
 * hinein und beim Schließen zurück, Rundlauf mit der Tabulatortaste, Escape.
 */
export function Fenster({
  titel,
  onClose,
  klasse,
  kopfZusatz,
  rahmenZusatz,
  children,
}: {
  /** Die Überschrift - sie gibt dem Fenster seinen Namen. */
  titel: ReactNode;
  onClose: () => void;
  /** Zusätzliche Klassen für den Rahmen, etwa "modal-wide". */
  klasse?: string;
  /** Kommt neben die Überschrift, etwa ein Knopf. */
  kopfZusatz?: ReactNode;
  /** Weitere Merkmale für den Rahmen - das Verfassen-Fenster nimmt hier Dateien an. */
  rahmenZusatz?: Record<string, unknown>;
  children: ReactNode;
}) {
  const { rahmenMerkmale, titelMerkmale } = useFenster(onClose);

  return (
    // Nur ein Klick auf den Hintergrund selbst schließt - ein Zug, der im Fenster
    // begann und außerhalb endete, tat es vorher auch.
    <div
      className="modal-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        {...rahmenMerkmale}
        {...rahmenZusatz}
        className={`modal${klasse ? ` ${klasse}` : ''}${
          typeof rahmenZusatz?.className === 'string' ? ` ${rahmenZusatz.className}` : ''
        }`}
      >
        {kopfZusatz ? (
          <div className="fenster-kopf">
            <h3 {...titelMerkmale}>{titel}</h3>
            {kopfZusatz}
          </div>
        ) : (
          <h3 {...titelMerkmale}>{titel}</h3>
        )}
        {children}
      </div>
    </div>
  );
}
