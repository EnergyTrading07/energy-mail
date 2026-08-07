import { useEffect, useState } from 'react';
import { useMailEvents, type MailEvent } from './useMailEvents.js';

/**
 * Nimmt die Fortschrittsmeldungen eines Vorgangs auf.
 *
 * Der Server meldet über dieselbe Verbindung, die auch neue Post ankündigt. Hier wird
 * nur das herausgefiltert, was zum gefragten Vorgang und Konto gehört - sonst
 * überschriebe eine gleichzeitig laufende Absenderübersicht die Meldung des
 * Liegengebliebenen.
 */
export interface Stand {
  getan: number;
  von: number;
  text?: string;
}

export function useFortschritt(
  accountId: string | null,
  vorgang: 'absender' | 'offen' | 'sicherung',
  laeuft: boolean,
): Stand | null {
  const [stand, setStand] = useState<Stand | null>(null);

  // Solange nichts läuft, gibt es auch nichts zu zeigen - und der alte Stand darf beim
  // nächsten Aufruf nicht kurz aufblitzen.
  useEffect(() => {
    if (!laeuft) setStand(null);
  }, [laeuft]);

  useMailEvents((ereignis: MailEvent) => {
    if (ereignis.type !== 'fortschritt') return;
    if (ereignis.accountId !== accountId || ereignis.vorgang !== vorgang) return;
    setStand({ getan: ereignis.getan, von: ereignis.von, text: ereignis.text });
  });

  return laeuft ? stand : null;
}

/** Ein Satz wie "Gesendet wird durchgesehen (2 von 3)". */
export function fortschrittsText(stand: Stand | null, ersatz: string): string {
  if (!stand) return ersatz;
  const zaehler = stand.von > 1 ? ` (${Math.min(stand.getan + 1, stand.von)} von ${stand.von})` : '';
  return `${stand.text ?? ersatz}${zaehler}`;
}
