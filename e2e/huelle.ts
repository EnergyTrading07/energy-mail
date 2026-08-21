import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Was ein Start zurückgibt: die Anwendung, ihr Fenster und was in der Konsole stand. */
export interface Gestartet {
  anwendung: ElectronApplication;
  fenster: Page;
  /** Meldungen der Stufe "error" aus dem Anzeigeprozess - CSP-Verstösse landen hier. */
  konsolenfehler: string[];
  /** Ausnahmen, die im Anzeigeprozess niemand gefangen hat. */
  ausnahmen: string[];
  /** Der Datenordner dieser Prüfung. */
  datenordner: string;
  beenden: () => Promise<void>;
}

/**
 * Startet die Anwendung mit einem EIGENEN Datenordner.
 *
 * Das ist die wichtigste Zeile dieser Datei. Ohne `--user-data-dir` nähme die Prüfung
 * den Ordner des Menschen, der sie anstösst - mit seinen Konten, seinen Kennwörtern und
 * seiner Ablage. Sie würde dann echte Postfächer anmelden, echte Post abrufen und
 * womöglich echte Nachrichten anfassen. Eine Prüfung, die das tut, darf niemand
 * versehentlich starten.
 *
 * Der eigene Ordner hat als Nebenwirkung genau den Zustand, den man prüfen will: kein
 * Konto, keine Ablage, nichts - also der allererste Start.
 */
export async function starteAnwendung(): Promise<Gestartet> {
  const datenordner = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-e2e-'));

  /*
   * ELECTRON_RUN_AS_NODE muss weg.
   *
   * VS Code setzt die Variable in den Terminals, die es öffnet, und sie wird vererbt.
   * Ist sie gesetzt, startet Electron als blosses Node: kein Fenster, kein Chromium,
   * und die Prüfung wartet bis zur Zeitüberschreitung auf ein Fenster, das nie kommt.
   * Der Fehler sieht dabei nach einem Fehler im Programm aus und ist keiner.
   */
  const umgebung: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ELECTRON_RUN_AS_NODE' || v === undefined) continue;
    umgebung[k] = v;
  }

  const anwendung = await electron.launch({
    args: [WURZEL, `--user-data-dir=${datenordner}`],
    env: umgebung,
    cwd: WURZEL,
  });

  const konsolenfehler: string[] = [];
  const ausnahmen: string[] = [];

  /*
   * Zuhören, BEVOR auf das Fenster gewartet wird - und an jedem Fenster, nicht nur am
   * Hauptfenster.
   *
   * Hier stand das Anhängen zuerst hinter dem Warten auf die Oberfläche, und damit war
   * die Zusicherung über die Sicherheitsrichtlinie wertlos: Ein Verstoss beim LADEN der
   * Seite - also genau der Fall, um den es geht - ist längst gemeldet, wenn die Seite
   * fertig ist. Die Prüfung wäre grün gewesen, weil sie zu spät hinsah.
   */
  const beobachtet = new WeakSet<Page>();
  const beobachte = (f: Page) => {
    if (beobachtet.has(f)) return;
    beobachtet.add(f);
    f.on('console', (m) => {
      if (m.type() === 'error') konsolenfehler.push(m.text());
    });
    f.on('pageerror', (err) => ausnahmen.push(err.message));
  };
  anwendung.on('window', beobachte);
  for (const f of anwendung.windows()) beobachte(f);

  const fenster = await hauptfenster(anwendung, beobachte);

  /*
   * Kurz nachfassen.
   *
   * Die Oberfläche holt nach dem ersten Zeichnen noch Konten, Etiketten und Suchen. Was
   * dabei schiefgeht, erscheint eine Zehntelsekunde nach dem Fertigwerden - ohne diese
   * Ruhepause prüfte man einen Zustand, den es so nur für einen Augenblick gab.
   */
  await fenster.waitForLoadState('domcontentloaded');
  await fenster.waitForTimeout(1500);

  return {
    anwendung,
    fenster,
    konsolenfehler,
    ausnahmen,
    datenordner,
    beenden: async () => {
      await anwendung.close().catch(() => {});
      fs.rmSync(datenordner, { recursive: true, force: true });
    },
  };
}

/**
 * Das Fenster mit der Oberfläche - und nicht das Startbild.
 *
 * Die Hülle zeigt als Erstes ein kleines Fenster mit dem Wortzeichen (kleineFenster.ts),
 * denn der Start dauert ein bis drei Sekunden. `firstWindow()` liefert genau dieses -
 * eine Prüfung, die darauf zugreift, sucht die Nachrichtenliste in einem Startbild.
 *
 * Unterschieden wird an der Adresse: Das Startbild kommt aus einer data:-Adresse, die
 * Oberfläche wird über http vom eingebetteten Server geladen. Auf welchem Port, steht
 * nicht fest (siehe sucheFreienPort) - deshalb wird nur auf das Schema geprüft.
 */
async function hauptfenster(
  anwendung: ElectronApplication,
  beobachte: (f: Page) => void,
): Promise<Page> {
  const frist = Date.now() + 45_000;
  while (Date.now() < frist) {
    for (const f of anwendung.windows()) {
      beobachte(f);
      if (f.url().startsWith('http://')) return f;
    }
    await new Promise((weiter) => setTimeout(weiter, 200));
  }
  const gesehen = anwendung.windows().map((f) => f.url());
  throw new Error(
    `Kein Fenster mit der Oberfläche gefunden. Gesehen wurden: ${gesehen.join(', ') || '(keines)'}`,
  );
}
