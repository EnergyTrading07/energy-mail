import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { starteAnwendung, type Gestartet } from './huelle.js';

/**
 * Der erste Start - der Weg, auf dem diese Anwendung bisher am häufigsten gestolpert ist.
 *
 * Jede Zusicherung hier steht für einen Fehler, den es wirklich gegeben hat und den
 * weder Typen noch Bau noch die Prüfungen gesehen haben. Die Begründungen stehen jeweils
 * daneben.
 */

let gestartet: Gestartet;

test.beforeAll(async () => {
  gestartet = await starteAnwendung();
});

test.afterAll(async () => {
  await gestartet?.beenden();
});

test('die Anwendung öffnet ein Fenster mit der Oberfläche', async () => {
  const { fenster } = gestartet;

  /*
   * Dass es das Fenster überhaupt gibt, hat huelle.ts schon festgestellt - es sucht
   * gezielt eines mit einer http-Adresse. Hier steht der Gegenbeweis zum schlimmsten
   * bekannten Fehlbild: Die Hülle bekam vom eigenen Server eine 401 und zeigte dessen
   * JSON-Fehlermeldung statt des Mailprogramms. Das Fenster war da, die Adresse stimmte,
   * und trotzdem war es unbenutzbar.
   */
  await expect(fenster.locator('#root')).toBeVisible();
  const rumpf = (await fenster.locator('body').textContent()) ?? '';
  expect(rumpf, 'Die Seite zeigt eine JSON-Fehlermeldung statt der Oberfläche').not.toMatch(
    /^\s*\{\s*"error"/,
  );
});

test('React zeichnet, das Startbild ist ersetzt', async () => {
  const { fenster } = gestartet;

  /*
   * Das Startbild steht als gewöhnliches Markup in index.html und wird beim ersten
   * Zeichnen von React ersetzt. Bleibt es stehen, ist die Oberfläche gar nicht
   * angelaufen - und genau so sähe ein Bündel aus, das sich nicht ausführen lässt.
   */
  await expect(fenster.locator('.startbild')).toHaveCount(0);

  /*
   * Erwartet wird die ANMELDEKARTE und nicht mehr die Seitenleiste.
   *
   * Seit die Hülle keinen eigenen Server mehr mitbringt, ist der erste Start eines: Sie
   * verbindet sich mit einem Server, an dem sie niemanden kennt. Was dann dasteht, ist
   * das Anmeldefenster - und dass es dasteht, ist genau die Zusicherung, um die es geht:
   * Die Oberfläche kommt vom Server, sie läuft an, und der Anmeldezwang greift.
   */
  await expect(fenster.locator('.anmeldung-karte')).toBeVisible();
});

test('die Absturzseite erscheint nicht', async () => {
  const { fenster } = gestartet;

  /*
   * Das Auffangnetz um die gesamte Anwendung (main.tsx) zeigt bei einer Ausnahme beim
   * Zeichnen eine eigene Seite. Sie ist richtig und soll es geben - beim ersten Start
   * darf sie nur nicht kommen.
   */
  await expect(fenster.getByRole('alert')).toHaveCount(0);
  await expect(fenster.getByText('Hier ist etwas schiefgegangen')).toHaveCount(0);
});

test('ohne Anmeldung kommt niemand an ein Postfach', async () => {
  const { fenster } = gestartet;

  /*
   * Der Kern des Umbaus, und deshalb steht er als eigene Zusicherung da: Die
   * Desktop-Fassung meldet sich an wie jeder andere auch. Vorher wies sich das Fenster
   * mit dem Zugangsgeheimnis des Prozesses aus und war damit immer "der eine Nutzer" -
   * es gab nichts zu prüfen und nichts zu trennen.
   *
   * Geprüft wird beides: dass das Anmeldeformular dasteht UND dass die Anwendung
   * dahinter nicht schon gezeichnet ist.
   */
  await expect(fenster.locator('#anmeldung-email')).toBeVisible();
  await expect(fenster.locator('#anmeldung-kennwort')).toBeVisible();
  await expect(fenster.locator('nav.sidebar')).toHaveCount(0);
});

test('die Sprachwahl steht schon vor der Anmeldung bereit', async () => {
  const { fenster } = gestartet;

  /*
   * Wer vor einem Fenster sitzt, dessen Sprache er nicht liest, kommt an die
   * Einstellungen dahinter nicht heran - dort lag die Wahl bis dahin. Sie muss also
   * hier stehen, und zwar in der Fassung, die der Server ausliefert.
   */
  await expect(fenster.locator('#zugang-sprache')).toBeVisible();
});

test('die Brücke zur Hülle antwortet', async () => {
  const { fenster } = gestartet;

  /*
   * Die Oberfläche spricht über window.energyMail mit der Hülle - Fensterzustand,
   * Einstellungen, Sprache, Zugangsgeheimnis. Ist das Vorschaltskript nicht geladen
   * (falscher Pfad, .cjs statt .js, contextIsolation falsch verdrahtet), fehlt das
   * Objekt, und die Oberfläche läuft trotzdem an - nur ohne Titelleiste, ohne
   * Einstellungen der Hülle und ohne Aktualisierung. Ein Fehlbild, das man nur sieht,
   * wenn man hinsieht.
   */
  const bruecke = await fenster.evaluate(
    // Eigene Zusicherung statt der Typangabe aus packages/web: Diese Datei gehoert nicht
    // zum Bau der Oberflaeche und kennt deren globale Erweiterungen nicht.
    () => typeof (window as unknown as { energyMail?: unknown }).energyMail,
  );
  expect(bruecke, 'window.energyMail fehlt - das Vorschaltskript ist nicht angekommen').toBe(
    'object',
  );
});

test('die eigene Titelleiste ist da', async () => {
  const { fenster } = gestartet;

  // titleBarStyle 'hidden' heisst: die Anwendung zeichnet ihre Leiste selbst. Fehlt sie,
  // hat das Fenster überhaupt keine - kein Verschieben, kein Schliessen.
  await expect(fenster.getByText('Energy', { exact: false }).first()).toBeVisible();
});

test('die Oberfläche kommt vom Server und nicht aus dem Paket', async () => {
  const { fenster, serverAdresse } = gestartet;

  /*
   * Die Zusicherung, die den ganzen Umbau trägt: Was im Fenster steht, wurde vom SERVER
   * geladen. Vorher stand hier "vom eingebetteten Server über http" - dieselbe Prüfung
   * mit einer anderen Bedeutung, denn der Server lief im selben Prozess.
   *
   * Damit ist auch gesagt, warum Desktop und Browser dieselben Postfächer sehen: Es ist
   * dieselbe Oberfläche, aus derselben Quelle, mit derselben Anmeldung.
   */
  expect(fenster.url().startsWith(serverAdresse)).toBe(true);
});

test('der Datenordner der Prüfung wird benutzt - nicht der des Menschen', async () => {
  const { datenordner } = gestartet;

  /*
   * Die Gegenprobe zur wichtigsten Zusicherung dieser Prüfung. Legt die Anwendung ihre
   * Dateien woanders ab, hat --user-data-dir nicht gegriffen - und dann liefe die
   * Prüfung auf den echten Konten des Menschen, der sie angestossen hat.
   */
  const inhalt = fs.readdirSync(datenordner);
  expect(inhalt.length, 'Der Datenordner der Prüfung blieb leer').toBeGreaterThan(0);
  /*
   * Was dort liegt, ist wenig geworden - und das ist das Ergebnis des Umbaus: Konten,
   * Schlüssel und Ablage liegen auf dem Server. Übrig bleibt, was der Hülle gehört: ihr
   * Protokoll und ihre eigenen Einstellungen.
   */
  expect(
    inhalt.includes('protokoll') || inhalt.includes('huelle.json'),
    `Im Datenordner der Prüfung liegt nichts von Energy Mail: ${inhalt.join(', ')}`,
  ).toBe(true);
});

test('nichts wurde von der Sicherheitsrichtlinie abgewiesen', async () => {
  const { konsolenfehler, ausnahmen } = gestartet;

  /*
   * Ein Verstoss gegen die Richtlinie in index.html erscheint als Fehler in der Konsole
   * und sonst nirgends: Die Anwendung läuft weiter, nur lädt etwas nicht. Genau so ist
   * die Sache mit "Einmal laden" einmal wirkungslos gewesen - die Bilder blieben leer,
   * die Leiste verschwand trotzdem, und der Nutzer suchte den Fehler bei sich.
   */
  const richtlinie = konsolenfehler.filter((z) => /content security policy/i.test(z));
  expect(richtlinie, richtlinie.join('\n')).toEqual([]);
  expect(ausnahmen, ausnahmen.join('\n')).toEqual([]);
});
