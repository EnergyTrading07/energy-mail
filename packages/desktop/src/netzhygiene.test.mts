import assert from 'node:assert/strict';
import {
  fuehrtNachDraussen,
  fuerFremdeAnfrage,
  ohneKeksVergabe,
  ohneProgrammkennung,
} from './netzhygiene.js';

/*
 * Was ein fremder Server erfaehrt, wenn der Nutzer entfernte Inhalte freigibt.
 *
 * Die Freigabe heisst "lade dieses Bild". Sie heisst nicht "lege eine Kennung an, die
 * mich beim naechsten Rundschreiben wiedererkennt", und sie heisst nicht "sag ihm, welches
 * Programm in welcher Fassung ich benutze". Wo das auseinanderfaellt, faellt es lautlos
 * auseinander - deshalb steht es hier und nicht nur im Kommentar.
 */

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void): void {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

/** Die Kennung, die Electron auf diesem System zusammensetzt. */
const ECHT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Energy Mail/0.2.1 Chrome/140.0.0.0 Electron/43.3.0 Safari/537.36';

console.log('\nWer draussen ist und wer nicht:');

pruefe('der eigene Server zaehlt nicht als draussen', () => {
  // An ihm haengen Sitzung, Zugangsgeheimnis und Anhaenge - wird dort etwas gefiltert,
  // laeuft die Anwendung nicht mehr.
  assert.equal(fuehrtNachDraussen('http://127.0.0.1:4000/accounts'), false);
  assert.equal(fuehrtNachDraussen('http://localhost:4000/ws?zugang=x'), false);
  assert.equal(fuehrtNachDraussen('http://localhost:5173/src/main.tsx'), false);
});

pruefe('alles andere schon', () => {
  assert.equal(fuehrtNachDraussen('https://verfolger.example/pixel.png'), true);
  // Ein Name, der den eigenen enthaelt, ist nicht der eigene.
  assert.equal(fuehrtNachDraussen('https://localhost.verfolger.example/p.png'), true);
});

pruefe('eine unlesbare Adresse gilt als fremd', () => {
  // Im Zweifel ist der Schaden ein fehlender Keks, nicht ein durchgereichter.
  assert.equal(fuehrtNachDraussen('kein:// gueltiges [ding'), true);
});

console.log('\nWas hinausgeht:');

pruefe('kein Keks nach draussen', () => {
  const raus = fuerFremdeAnfrage({ Cookie: 'kennung=abc123', Accept: 'image/*' }, ECHT);
  assert.equal(raus['Cookie'], undefined);
  assert.equal(raus['Accept'], 'image/*', 'die harmlosen Kopfzeilen sollen bleiben');
});

pruefe('kein Verweis auf die Nachricht, aus der geladen wurde', () => {
  const raus = fuerFremdeAnfrage({ Referer: 'http://127.0.0.1:4000/', referer: 'x' }, ECHT);
  assert.deepEqual(Object.keys(raus), []);
});

pruefe('auch die Client Hints tragen die Programmkennung', () => {
  // Dieselbe Auskunft in Einzelteilen - und die uebersieht man, weil sie niemand setzt.
  const raus = fuerFremdeAnfrage(
    { 'sec-ch-ua': '"Chromium";v="140"', 'sec-ch-ua-platform': '"Windows"' },
    ECHT,
  );
  assert.deepEqual(Object.keys(raus), []);
});

pruefe('die Programmkennung wird gekuerzt, nicht entfernt', () => {
  const gekuerzt = ohneProgrammkennung(ECHT);
  assert.ok(!gekuerzt.includes('Energy Mail'), gekuerzt);
  assert.ok(!gekuerzt.includes('Electron'), gekuerzt);
  assert.ok(!gekuerzt.includes('0.2.1'), `die Fassung steht noch drin: ${gekuerzt}`);
  // Was bleibt, stimmt weiterhin: es ist wirklich diese Chromium-Fassung, die abruft.
  assert.ok(gekuerzt.includes('Chrome/140.0.0.0'), gekuerzt);
  assert.ok(gekuerzt.startsWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), gekuerzt);
  // Keine doppelten Leerzeichen an den Nahtstellen.
  assert.ok(!/\s{2,}/.test(gekuerzt), JSON.stringify(gekuerzt));
});

pruefe('eine Anfrage ohne Programmkennung bekommt keine angedichtet', () => {
  // Aufzufallen ist das Gegenteil des Ziels - aber eine erfundene Kopfzeile faellt auf.
  const raus = fuerFremdeAnfrage({ Accept: '*/*' }, ECHT);
  assert.deepEqual(raus, { Accept: '*/*' });
});

pruefe('die Kennung wird in jeder Schreibweise ersetzt', () => {
  const raus = fuerFremdeAnfrage({ 'user-agent': ECHT }, ohneProgrammkennung(ECHT));
  assert.ok(!raus['user-agent']!.includes('Energy Mail'), raus['user-agent']);
});

console.log('\nWas hereinkommt:');

pruefe('ein fremder Server darf keinen Keks setzen', () => {
  /*
   * Der eigentliche Punkt. Der Zaehlpixel in Rundmail A setzt einen Keks, der in Rundmail
   * B bekommt ihn zurueck - und der Versender weiss, dass beide derselbe Mensch gelesen
   * hat. Genau die Wiedererkennung, gegen die das Zurueckhalten gedacht ist.
   */
  const rein = ohneKeksVergabe({
    'Set-Cookie': ['kennung=abc123; Max-Age=31536000'],
    'set-cookie': ['zweiter=x'],
    'SET-COOKIE': ['dritter=y'],
    'Content-Type': ['image/png'],
  });
  assert.deepEqual(Object.keys(rein), ['Content-Type']);
});

pruefe('sonst bleibt die Antwort unangetastet', () => {
  const rein = ohneKeksVergabe({ 'Cache-Control': ['no-store'], ETag: ['"abc"'] });
  assert.deepEqual(Object.keys(rein).sort(), ['Cache-Control', 'ETag']);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
