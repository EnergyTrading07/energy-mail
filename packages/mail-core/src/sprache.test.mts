import assert from 'node:assert/strict';
import {
  alsSprache,
  ausAcceptLanguage,
  gebietsschema,
  vergleiche,
  zahl,
  fehlendeUebersetzungen,
  lerneKatalog,
  setzeSprache,
  sprache,
  t,
  tp,
  waehleSprache,
} from './sprache.js';

/*
 * Die Sprache der Oberflaeche.
 *
 * Der deutsche Text IST der Schluessel - `t('Neue Nachricht')` statt `t('nachricht.neu')`.
 * Diese Entscheidung ist gegen die uebliche Lehre getroffen, und der Grund steht hier als
 * Pruefung: Fehlt eine Uebersetzung, steht der deutsche Text da. Also genau das, was heute
 * schon dort steht - es kann nichts kaputtgehen, nur unuebersetzt bleiben.
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

lerneKatalog('pl', {
  // Polnisch braucht DREI Formen: 1 / 2-4 / 5+. Genau daran scheitert "=== 1".
  '{anzahl} neue Nachrichten': {
    one: '{anzahl} nowa wiadomość',
    few: '{anzahl} nowe wiadomości',
    many: '{anzahl} nowych wiadomości',
    other: '{anzahl} nowych wiadomości',
  },
  'Neue Nachricht': 'Nowa wiadomość',
});

lerneKatalog('en', {
  'Neue Nachricht': 'New message',
  '{anzahl} neue Nachrichten': '{anzahl} new messages',
  'Eine neue Nachricht': 'One new message',
  'Es liegen {anzahl} Nachrichten von {wer} vor': '{wer} sent you {anzahl} messages',
});

console.log('\nWelche Sprache gilt:');

pruefe('die Richtlinie schlaegt alles', () => {
  /*
   * In einem Unternehmen mit englischer Arbeitssprache soll nicht jeder Arbeitsplatz eine
   * andere Oberflaeche zeigen, nur weil Windows verschieden eingestellt ist.
   */
  assert.equal(waehleSprache({ richtlinie: 'en', nutzer: 'de', system: 'de-DE' }), 'en');
});

pruefe('dann die Wahl des Nutzers, dann das System', () => {
  assert.equal(waehleSprache({ nutzer: 'en', system: 'de-DE' }), 'en');
  assert.equal(waehleSprache({ system: 'en-GB' }), 'en');
  assert.equal(waehleSprache({ system: 'de-AT' }), 'de');
});

pruefe('"automatisch" ist keine Sprache, sondern eine Weiterreichung', () => {
  // So heisst die Einstellung "nimm das Betriebssystem" - sie MUSS durchfallen, sonst
  // kaeme die naechste Quelle nie dran.
  assert.equal(waehleSprache({ nutzer: 'automatisch', system: 'en-US' }), 'en');
  assert.equal(alsSprache('automatisch'), null);
});

pruefe('was niemand kennt, ergibt Deutsch', () => {
  /*
   * Die Quelle, fuer die es garantiert einen vollstaendigen Text gibt.
   *
   * Hier stand einmal 'fr-FR' als Beispiel fuer "kennt niemand" - und genau das hat sich
   * mit den weiteren Sprachen geaendert. Die Pruefung schlug an, und das war ihre
   * Aufgabe: Sie hielt eine Annahme fest, die inzwischen nicht mehr gilt.
   */
  assert.equal(waehleSprache({ system: 'ja-JP' }), 'de');
  assert.equal(waehleSprache({}), 'de');
  assert.equal(waehleSprache({ richtlinie: 'klingonisch' }), 'de');
  // Franzoesisch dagegen wird jetzt erkannt.
  assert.equal(waehleSprache({ system: 'fr-FR' }), 'fr');
});

pruefe('Schreibweisen, wie sie wirklich vorkommen', () => {
  // Betriebssysteme und Browser liefern "de-DE", "en_GB", "EN", " de ".
  for (const wert of ['de-DE', 'de_AT', 'DE', ' de ', 'de-DE-u-co-phonebk']) {
    assert.equal(alsSprache(wert), 'de', wert);
  }
  assert.equal(alsSprache('en-GB'), 'en');
  assert.equal(alsSprache(''), null);
  assert.equal(alsSprache(undefined), null);
});

console.log('\nUebersetzen:');

pruefe('auf Deutsch kommt der Text unveraendert zurueck', () => {
  // Deutsch ist die Quelle und braucht keinen Katalog - dieser Weg muss ohne Nachschlagen
  // auskommen, sonst waere jede deutsche Beschriftung von einer Datei abhaengig.
  setzeSprache('de');
  assert.equal(t('Neue Nachricht'), 'Neue Nachricht');
  assert.equal(t('Etwas, das nirgends steht'), 'Etwas, das nirgends steht');
});

pruefe('auf Englisch kommt die Uebersetzung', () => {
  setzeSprache('en');
  assert.equal(sprache(), 'en');
  assert.equal(t('Neue Nachricht'), 'New message');
});

pruefe('ohne Uebersetzung bleibt der deutsche Text stehen', () => {
  /*
   * DIE Pruefung dieser Datei. Bei symbolischen Schluesseln stuende hier
   * "nachricht.neu" in der Oberflaeche - ein vergessener Eintrag waere ein sichtbarer
   * Fehler. So ist er eine Ruecklage.
   */
  setzeSprache('en');
  assert.equal(t('Postfach aufräumen…'), 'Postfach aufräumen…');
});

pruefe('Platzhalter werden eingesetzt', () => {
  setzeSprache('de');
  assert.equal(t('{anzahl} neue Nachrichten', { anzahl: 3 }), '3 neue Nachrichten');
});

pruefe('die Wortstellung darf sich in der Uebersetzung aendern', () => {
  /*
   * Genau dafuer sind benannte Platzhalter da: im Englischen steht die Zahl oft an anderer
   * Stelle. Mit "%s" waere die Reihenfolge festgenagelt.
   */
  setzeSprache('en');
  assert.equal(
    t('Es liegen {anzahl} Nachrichten von {wer} vor', { anzahl: 2, wer: 'Anna' }),
    'Anna sent you 2 messages',
  );
});

pruefe('ein Platzhalter ohne Wert bleibt stehen', () => {
  // "{anzahl} neue Nachrichten" ist eine Auskunft, "undefined neue Nachrichten" ist keine.
  setzeSprache('de');
  assert.equal(t('{anzahl} neue Nachrichten'), '{anzahl} neue Nachrichten');
  assert.equal(t('{anzahl} neue Nachrichten', { falsch: 1 }), '{anzahl} neue Nachrichten');
});

console.log('\nEinzahl und Mehrzahl:');

pruefe('eins gegen alles andere', () => {
  setzeSprache('de');
  assert.equal(tp(1, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), 'Eine neue Nachricht');
  assert.equal(tp(5, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), '5 neue Nachrichten');
});

pruefe('die Null gehoert zur Mehrzahl', () => {
  // "0 Nachrichten", nicht "Eine neue Nachricht" - im Deutschen wie im Englischen.
  setzeSprache('de');
  assert.equal(tp(0, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), '0 neue Nachrichten');
});

pruefe('auch uebersetzt', () => {
  setzeSprache('en');
  assert.equal(tp(1, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), 'One new message');
  assert.equal(tp(4, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), '4 new messages');
});

console.log('\nWas noch fehlt:');

pruefe('fehlende Uebersetzungen lassen sich benennen', () => {
  // Grundlage fuer "npm run sprachstand": es soll eine Zahl geben, an der sich der Stand
  // ablesen laesst, statt "wird noch gemacht".
  const fehlend = fehlendeUebersetzungen('en', ['Neue Nachricht', 'Gibt es nicht']);
  assert.deepEqual(fehlend, ['Gibt es nicht']);
});

console.log('\nMehr als zwei Formen - Polnisch:');

pruefe('drei Formen, nicht zwei', () => {
  /*
   * Der Grund, warum "anzahl === 1 ? einzahl : mehrzahl" nicht genuegt. Im Polnischen
   * heisst es bei 1 "nowa wiadomość", bei 2-4 "nowe wiadomości" und ab 5 "nowych
   * wiadomości". Mit zwei Formen baut man Saetze, die fast richtig aussehen und es nicht
   * sind - und niemand meldet das, weil die Oberflaeche ja "uebersetzt" ist.
   */
  setzeSprache('pl');
  const p = (n: number) => tp(n, 'Eine neue Nachricht', '{anzahl} neue Nachrichten');
  assert.equal(p(1), '1 nowa wiadomość');
  assert.equal(p(3), '3 nowe wiadomości');
  assert.equal(p(7), '7 nowych wiadomości');
});

pruefe('zwei Formen bleiben trotzdem gueltig', () => {
  // Der Katalog DARF Kategorien angeben, muss aber nicht. Sonst muesste jede Sprache mit
  // zwei Formen zusaetzlichen Aufwand tragen, nur damit eine mit dreien geht.
  setzeSprache('en');
  assert.equal(tp(1, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), 'One new message');
  assert.equal(tp(9, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), '9 new messages');
});

pruefe('im Franzoesischen gehoert die Null zur EINZAHL', () => {
  /*
   * Der Fall, an dem "anzahl === 1" auch bei zwei Formen scheitert.
   *
   * Franzoesisch kennt genau zwei Formen - die Pruefung verlangt dort also keine
   * Kategorientabelle, und der Eintrag waere formal in Ordnung. Die Null zaehlt aber zur
   * Einzahl: "0 message", nicht "0 messages". Mit der alten Regel stand dort die
   * Mehrzahl, und aufgefallen waere es niemandem ausser einem franzoesischen Leser.
   *
   * Deshalb entscheidet auch ohne Tabelle Intl und nicht ein Vergleich mit 1.
   */
  lerneKatalog('fr', {
    'Eine neue Nachricht': '{anzahl} nouveau message',
    '{anzahl} neue Nachrichten': '{anzahl} nouveaux messages',
  });
  setzeSprache('fr');
  const p = (n: number) => tp(n, 'Eine neue Nachricht', '{anzahl} neue Nachrichten');
  assert.equal(p(0), '0 nouveau message', 'die Null muss die Einzahl bekommen');
  assert.equal(p(1), '1 nouveau message');
  assert.equal(p(2), '2 nouveaux messages');
});

pruefe('im Deutschen und Englischen bleibt die Null bei der Mehrzahl', () => {
  // Die Gegenprobe: Die Umstellung auf Intl darf die Sprachen nicht veraendern, fuer die
  // die alte Regel richtig war.
  setzeSprache('en');
  assert.equal(tp(0, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), '0 new messages');
  setzeSprache('de');
  assert.equal(tp(0, 'Eine neue Nachricht', '{anzahl} neue Nachrichten'), '0 neue Nachrichten');
});

console.log('\nDie Rueckfallkette:');

pruefe('Englisch steht zwischen einer Sprache und dem Deutschen', () => {
  /*
   * Ein polnischer Nutzer, dem ein Eintrag fehlt, versteht "New message" mit einiger
   * Wahrscheinlichkeit - "Neue Nachricht" versteht er nicht.
   */
  setzeSprache('pl');
  assert.equal(t('Neue Nachricht'), 'Nowa wiadomość', 'Polnisch geht vor');
  assert.equal(t('Eine neue Nachricht'), 'One new message', 'sonst Englisch');
  // Nirgends hinterlegt - dann Deutsch, die Quelle.
  assert.equal(t('Postfach aufräumen…'), 'Postfach aufräumen…');
});

console.log('\nDatum, Zahlen und Sortierung:');

pruefe('folgen der Sprache', () => {
  // Sie standen fuenfundzwanzigmal als 'de-DE' im Quelltext. Solange es nur Deutsch gab,
  // war das richtig; bei der ersten weiteren Sprache wird es zu einem stillen Fehler.
  setzeSprache('de');
  assert.equal(gebietsschema(), 'de-DE');
  assert.equal(zahl(31700), '31.700');
  setzeSprache('en');
  assert.equal(gebietsschema(), 'en-GB');
  assert.equal(zahl(31700), '31,700');
});

pruefe('auch die Sortierung', () => {
  // Im Deutschen steht "ä" bei "a" - wer mit fester Vorgabe sortiert, bekommt in einer
  // anderen Sprache eine Reihenfolge, die dort niemand erwartet.
  setzeSprache('de');
  assert.ok(vergleiche('Ärger', 'Beruf') < 0, 'ä gehoert im Deutschen zu a');
});

console.log('\nWas der Browser mitschickt:');

pruefe('Accept-Language wird nach Gewichtung gelesen', () => {
  // "fr-CH, fr;q=0.9, en;q=0.8" - die Zahl dahinter ist die Gewichtung, ohne Angabe gilt 1.
  assert.equal(ausAcceptLanguage('fr-CH,fr;q=0.9,en;q=0.8,de;q=0.7'), 'fr');
  assert.equal(ausAcceptLanguage('en-US,en;q=0.9'), 'en');
});

pruefe('unbekannte Sprachen werden uebersprungen, nicht genommen', () => {
  /*
   * Der Fall, der eine naive Umsetzung verraet: Die erste genannte Sprache ist eine, fuer
   * die es keinen Katalog gibt. Wer einfach die erste nimmt, faellt auf Deutsch zurueck -
   * obwohl der Browser als zweites Englisch gewuenscht hat.
   */
  assert.equal(ausAcceptLanguage('ja,en;q=0.9,de;q=0.5'), 'en');
  assert.equal(ausAcceptLanguage('ja,ko'), null);
  assert.equal(ausAcceptLanguage(''), null);
  assert.equal(ausAcceptLanguage(undefined), null);
});

setzeSprache('de');

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
