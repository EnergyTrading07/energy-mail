import assert from 'node:assert/strict';
import { lerneKatalog, setzeSprache, t } from '@energy-mail/mail-core/sprache';
import { inSprache, spracheFuerAnfrage } from './sprachkontext.js';
import { setzeSprachquelle } from '@energy-mail/mail-core/sprache';
import { aktuelleSprache } from './sprachkontext.js';

/*
 * Die Sprache gehoert zur ANFRAGE, nicht zum Prozess.
 *
 * In der Huelle ist die Sprache eine Einstellung des Programms. Im Serverbetrieb bedient
 * ein Prozess viele Menschen gleichzeitig - und eine Variable im Modul waere dort nicht
 * bloss unsauber, sondern falsch, und zwar auf die unangenehmste Art: Sie funktionierte
 * in jeder Pruefung, in der nur einer arbeitet, und versagte im Betrieb genau dann, wenn
 * zwei gleichzeitig etwas tun.
 *
 * Diese Datei prueft deshalb den Fall, der von Hand nie auffaellt: zwei Anfragen, die
 * einander verschraenken.
 */

let ok = 0;
let gesamt = 0;

async function pruefe(name: string, fn: () => Promise<void> | void): Promise<void> {
  gesamt++;
  try {
    await fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

lerneKatalog('en', { 'Konto nicht gefunden': 'Account not found' });
lerneKatalog('fr', { 'Konto nicht gefunden': 'Compte introuvable' });
setzeSprachquelle(() => aktuelleSprache() ?? 'de');
setzeSprache('de');

console.log('\nWoher die Sprache einer Anfrage kommt:');

await pruefe('der Nutzer geht vor dem Browser', () => {
  // Sie gehoert zu ihm und nicht zu dem Browser, mit dem er gerade hereinkommt.
  assert.equal(spracheFuerAnfrage('fr', 'en-GB,en;q=0.9'), 'fr');
});

await pruefe('sonst entscheidet Accept-Language', () => {
  assert.equal(spracheFuerAnfrage(undefined, 'en-GB,en;q=0.9'), 'en');
  assert.equal(spracheFuerAnfrage('automatisch', 'fr-CH,fr;q=0.9'), 'fr');
});

await pruefe('und sonst Deutsch', () => {
  assert.equal(spracheFuerAnfrage(undefined, undefined), 'de');
  assert.equal(spracheFuerAnfrage(undefined, 'ja,ko'), 'de');
});

console.log('\nZwei Anfragen gleichzeitig:');

await pruefe('sehen einander nicht', async () => {
  /*
   * DIE Pruefung dieser Datei. Nacheinander ginge auch eine Variable im Modul gut - erst
   * verschraenkt faellt sie auf. Deshalb wird hier bewusst gewartet, waehrend die andere
   * Anfrage laeuft.
   */
  const warte = (ms: number) => new Promise((f) => setTimeout(f, ms));

  const franzoesisch = inSprache('fr', async () => {
    await warte(20);
    return t('Konto nicht gefunden');
  });
  const englisch = inSprache('en', async () => {
    await warte(5);
    return t('Konto nicht gefunden');
  });

  const [fr, en] = await Promise.all([franzoesisch, englisch]);
  assert.equal(fr, 'Compte introuvable', 'die franzoesische Anfrage bekam eine fremde Sprache');
  assert.equal(en, 'Account not found', 'die englische Anfrage bekam eine fremde Sprache');
});

await pruefe('ausserhalb einer Anfrage gilt die Vorgabe', () => {
  // Hintergrundarbeit (Wiedervorlage, Warteschlange) laeuft ohne Anfrage - dort darf t()
  // nicht ins Leere greifen.
  assert.equal(aktuelleSprache(), undefined);
  assert.equal(t('Konto nicht gefunden'), 'Konto nicht gefunden');
});

setzeSprachquelle(null);

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
