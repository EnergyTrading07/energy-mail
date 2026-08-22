import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
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
  /** Die Adresse des Servers, mit dem die Hülle für diese Prüfung arbeitet. */
  serverAdresse: string;
  beenden: () => Promise<void>;
}

/**
 * Ein Server für diese Prüfung - eigener Port, eigener Datenordner.
 *
 * ## Warum die Prüfung jetzt einen braucht
 *
 * Weil die Hülle keinen mehr mitbringt. Sie ist ein Fenster auf einen Server; ohne einen
 * solchen zeigt sie das Einrichtungsfenster und sonst nichts. Eine Prüfung, die das
 * "Anwendung startet" nennt, prüfte danach nur noch, dass ein leeres Formular erscheint.
 *
 * Der Server läuft mit einem eigenen Datenordner - aus demselben Grund, aus dem die
 * Hülle einen bekommt: Er darf die Konten des Menschen, der die Prüfung anstösst, weder
 * sehen noch anfassen.
 */
async function starteServer(ordner: string): Promise<{ adresse: string; prozess: ChildProcess }> {
  const port = await freierPort();
  const prozess = spawn(process.execPath, [path.join(WURZEL, 'packages/server/dist/index.js')], {
    cwd: WURZEL,
    env: {
      ...ohneElectronAlsNode(),
      ENERGY_MAIL_DATEN: ordner,
      PORT: String(port),
      /*
       * ELECTRON_RUN_AS_NODE muss hier GESETZT sein - und nicht, wie bei der Hülle,
       * entfernt. process.execPath ist im Playwright-Lauf die Electron-Binärdatei; ohne
       * die Variable startete sie ein Fenster statt eines Node-Prozesses.
       */
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: 'ignore',
  });

  const adresse = `http://127.0.0.1:${port}`;
  const frist = Date.now() + 30_000;
  while (Date.now() < frist) {
    if (await antwortet(`${adresse}/gesundheit`)) return { adresse, prozess };
    await new Promise((weiter) => setTimeout(weiter, 250));
  }
  prozess.kill();
  throw new Error(`Der Server für die Prüfung war unter ${adresse} nicht erreichbar.`);
}

function freierPort(): Promise<number> {
  return new Promise((fertig, scheitern) => {
    const probe = net.createServer();
    probe.once('error', scheitern);
    probe.listen({ port: 0, host: '127.0.0.1' }, () => {
      const adresse = probe.address();
      const port = typeof adresse === 'object' && adresse ? adresse.port : 0;
      probe.close(() => (port ? fertig(port) : scheitern(new Error('Kein freier Port.'))));
    });
  });
}

async function antwortet(url: string): Promise<boolean> {
  try {
    const antwort = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return antwort.ok;
  } catch {
    return false;
  }
}

/**
 * Die Umgebung ohne ELECTRON_RUN_AS_NODE.
 *
 * VS Code setzt die Variable in den Terminals, die es öffnet, und sie wird vererbt. Ist
 * sie gesetzt, startet Electron als blosses Node: kein Fenster, kein Chromium, und die
 * Prüfung wartet bis zur Zeitüberschreitung auf ein Fenster, das nie kommt. Der Fehler
 * sieht dabei nach einem Fehler im Programm aus und ist keiner.
 */
function ohneElectronAlsNode(): Record<string, string> {
  const umgebung: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ELECTRON_RUN_AS_NODE' || v === undefined) continue;
    umgebung[k] = v;
  }
  return umgebung;
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
  const serverordner = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-e2e-server-'));

  const { adresse: serverAdresse, prozess: serverProzess } = await starteServer(serverordner);

  const anwendung = await electron.launch({
    args: [WURZEL, `--user-data-dir=${datenordner}`],
    env: {
      ...ohneElectronAlsNode(),
      /*
       * Damit umgeht die Prüfung das Einrichtungsfenster.
       *
       * ENERGY_MAIL_WEB_URL geht der gespeicherten Adresse vor - siehe main.ts. Die
       * Alternative wäre, das Fenster auszufüllen; das prüfte dann aber vor allem, ob
       * Playwright tippen kann.
       */
      ENERGY_MAIL_WEB_URL: serverAdresse,
    },
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
    serverAdresse,
    beenden: async () => {
      await anwendung.close().catch(() => {});
      serverProzess.kill();
      fs.rmSync(datenordner, { recursive: true, force: true });
      fs.rmSync(serverordner, { recursive: true, force: true });
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
 * Unterschieden wird an der Adresse: Das Startbild und das Einrichtungsfenster kommen aus
 * data:-Adressen, die Oberfläche über http vom Server dieser Prüfung. Auf welchem Port,
 * steht nicht fest - deshalb wird nur auf das Schema geprüft.
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
