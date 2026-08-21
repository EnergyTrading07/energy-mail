import fs from 'node:fs';
import path from 'node:path';
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
  await expect(fenster.locator('nav.sidebar')).toBeVisible();
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

test('ohne Konto steht das Formular zum Einrichten offen', async () => {
  const { fenster } = gestartet;

  /*
   * Beim allerersten Start klappt das Formular von selbst auf (siehe Sidebar.tsx) - ein
   * Knopf "Konto hinzufügen" in einer sonst leeren Anwendung wäre eine Sackgasse mit
   * einem zusätzlichen Klick davor.
   */
  await expect(fenster.locator('.add-account')).toBeVisible();
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

test('der eingebettete Server liefert die Oberfläche über http aus', async () => {
  const { fenster } = gestartet;

  /*
   * Über http und nicht über file:// - der Bau von Vite verweist absolut auf /assets,
   * und über file:// fände der Browser davon nichts. Der Port steht bewusst nicht in
   * dieser Zusicherung: Er wird gesucht (sucheFreienPort), und dass er es tut, ist der
   * Sinn der Sache.
   */
  expect(fenster.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
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
  expect(
    fs.existsSync(path.join(datenordner, 'nutzer')) || inhalt.includes('protokoll'),
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
