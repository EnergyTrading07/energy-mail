import { monogramm } from '../design/monogramm.js';

/**
 * Das farbige Kürzel eines Absenders.
 *
 * Warum es die Zeile wert ist, die es kostet, steht in design/monogramm.ts. Hier steht
 * nur, warum es für eine Vorlesesoftware nicht existiert: es trägt keine einzige
 * Auskunft, die nicht gleich daneben ausgeschrieben stünde. Vorgelesen wäre es die
 * Wiederholung des Absenders in Buchstabierschrift - und das an jeder Zeile.
 *
 * Weitergegeben wird nur der Farbton als --mono-h; Helligkeit und Sättigung setzt das
 * Regelwerk, damit die helle und die dunkle Ansicht sich unterscheiden können, ohne dass
 * es diese Datei erfährt. Siehe .row-monogramm in index.css.
 */
export function Monogramm({
  name,
  adresse,
  /** 'row-monogramm' in der Liste, 'mail-monogramm' im Kopf der Leseansicht. */
  className = 'row-monogramm',
}: {
  name?: string;
  adresse?: string;
  className?: string;
}) {
  const { kuerzel, farbton } = monogramm(name, adresse);
  return (
    <span className={className} aria-hidden="true" style={{ ['--mono-h' as string]: farbton }}>
      {kuerzel}
    </span>
  );
}
