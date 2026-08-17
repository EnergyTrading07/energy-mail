import { createContext, useContext, type ReactNode } from 'react';
import { useFenster } from '../useFenster.js';

/**
 * Ob das, was hier gebaut wird, als Tafel in einem anderen Fenster steht.
 *
 * Das Einstellungsfenster setzt es; überall sonst steht nichts davon, und dann gilt der
 * Vorgabewert false - ein Fenster bleibt ein Fenster.
 *
 * ## Warum über den Zusammenhang und nicht über ein Merkmal
 *
 * Neun Bausteine sollen an zwei Orten stehen können: für sich allein als Fenster (so
 * ruft sie das Menü der Hülle auf) und als Abschnitt im Einstellungsfenster. Ein Merkmal
 * dafür müsste durch jeden dieser neun Bausteine hindurchgereicht werden, ohne dass ihn
 * dort irgendetwas anginge - neun Stellen, an denen man es beim nächsten Baustein
 * vergessen kann. Hier weiß nur der Rahmen davon, und das ist genau die Stelle, an der
 * sich der Unterschied auswirkt.
 */
const TafelKontext = createContext(false);

/** Alles darin baut sich als Tafel statt als Fenster. Siehe EinstellungenModal.tsx. */
export function AlsTafel({ children }: { children: ReactNode }) {
  return <TafelKontext.Provider value={true}>{children}</TafelKontext.Provider>;
}

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
 *
 * Als Tafel (siehe AlsTafel darüber) fällt genau das weg - Schleier, Fokusfalle,
 * Escape, Schatten -, und alles andere bleibt: die Klasse `modal` steht weiter am
 * Rahmen, damit die Regeln, die einzelne Fenster für ihr Inneres mitbringen
 * (`.modal .wartend-zeile`, `.modal h4`, …), auch dort greifen. Ohne das müsste jede
 * dieser Regeln verdoppelt werden.
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
  const alsTafel = useContext(TafelKontext);
  const { rahmenMerkmale, titelMerkmale } = useFenster(onClose, !alsTafel);

  const kopf = kopfZusatz ? (
    <div className="fenster-kopf">
      <h3 {...titelMerkmale}>{titel}</h3>
      {kopfZusatz}
    </div>
  ) : (
    <h3 {...titelMerkmale}>{titel}</h3>
  );

  if (alsTafel) {
    return (
      <section
        className={`modal eingebettet${klasse ? ` ${klasse}` : ''}`}
        aria-labelledby={titelMerkmale.id}
      >
        {kopf}
        {children}
      </section>
    );
  }

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
        {kopf}
        {children}
      </div>
    </div>
  );
}
