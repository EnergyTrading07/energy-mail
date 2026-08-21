import { defineConfig } from '@playwright/test';

/**
 * Die Prüfung am laufenden Programm.
 *
 * ## Warum es sie gibt
 *
 * Die 81 Prüfungen daneben prüfen Bausteine: einen Zerleger, einen Speicher, einen
 * Riegel. Was sie nicht prüfen können, ist der Zusammenbau - und genau dort ist in
 * diesem Programm das meiste schiefgegangen. Die Begründungen im Quelltext sagen es
 * selbst, an einem halben Dutzend Stellen: "Aufgefallen an der laufenden Anwendung,
 * nicht in einer Prüfung." Ein fehlendes `type` in der package.json, das den Start mit
 * ERR_REQUIRE_ESM abbrach. Eine Eingangskontrolle, die dem eigenen Fenster eine 401
 * schickte, sodass die Anwendung die JSON-Fehlermeldung ihres eigenen Servers anzeigte.
 * Ein belegter Port, der zu einem Fehlerfenster ohne Ausweg führte.
 *
 * Keiner dieser Fehler ist in Typen, Bau oder Prüfungen sichtbar. Alle drei hätte ein
 * einziger Start mit einem Blick auf das Fenster gefunden.
 *
 * ## Warum nicht im gewöhnlichen Prüflauf
 *
 * Sie braucht die Electron-Binärdatei (rund hundert Megabyte) und startet ein echtes
 * Fenster. Das gehört nicht in einen Lauf, den man zwanzigmal am Tag anstößt - deshalb
 * ein eigener Aufruf (`npm run pruefe:oberflaeche`) und ein eigener Schritt in der CI.
 *
 * ## Was sie NICHT prüft
 *
 * Alles, was einen echten Mailserver braucht. Dafür bräuchte es Greenmail o.ä. in einem
 * Container, und dieselbe Begründung steht schon in routen.test.mts. Geprüft wird der
 * Weg davor - und der ist der, auf dem die Anwendung bisher gestolpert ist.
 */
export default defineConfig({
  testDir: './e2e',

  /*
   * Eine nach der anderen.
   *
   * Jede startet eine echte Anwendung mit eigenem Datenordner und eigenem Server. Zwei
   * gleichzeitig hiesse zwei Fenster, zwei Server und ein Gerangel um Port 4000 - der
   * zwar inzwischen ausweicht (siehe sucheFreienPort), aber die Prüfung soll den
   * Regelfall prüfen und nicht den Ausweichfall.
   */
  workers: 1,
  fullyParallel: false,

  /*
   * Kein Wiederholen bei Fehlschlag.
   *
   * Ein Wiederholungslauf verwandelt eine Prüfung, die manchmal fehlschlägt, in eine,
   * die manchmal grün ist - und das ist schlimmer als rot: Man glaubt ihr dann nicht
   * mehr, aber sie steht noch da. Schlägt hier etwas fehl, gehört es angesehen.
   */
  retries: 0,

  /*
   * Grosszuegig: Der Start fährt einen Server hoch, liest die Konten und baut ein
   * Fenster. Auf einem ausgelasteten Bauknecht dauert das länger als hier.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
});
