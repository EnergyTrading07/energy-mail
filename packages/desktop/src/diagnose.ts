import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BrowserWindow, app, dialog, shell } from 'electron';
import { enthaeltGeheimnisse } from '@energy-mail/mail-core/protokoll';
import { lesProtokoll, protokolliere } from '@energy-mail/server/protokoll';
import { ZUGANG_KOPFZEILE, holeZugangsgeheimnis } from '@energy-mail/server/zugang';

/**
 * Auch die Hülle muss sich beim eigenen Server ausweisen.
 *
 * Sicherung und Einlesen gehen über HTTP, damit sie genau denselben Weg nehmen wie die
 * Oberfläche - dieselbe Prüfung, dieselben Fehlermeldungen. Seit der Server ein
 * Geheimnis verlangt, gehört es hier mit dazu; ohne dieses Zutun brächen die beiden
 * Menüpunkte mit "Kein Zugang".
 */
function zugangskopfzeile(): Record<string, string> {
  const geheimnis = holeZugangsgeheimnis();
  return geheimnis ? { [ZUGANG_KOPFZEILE]: geheimnis } : {};
}

/**
 * Was passiert, wenn etwas schiefgeht - und wie der Nutzer davon berichten kann.
 *
 * Bisher gab es beides nicht. Stürzte der Hauptprozess ab, war das Fenster einfach weg:
 * keine Meldung, keine Spur, und für den Nutzer sah es aus, als hätte er etwas falsch
 * gemacht. Und meldete jemand einen Fehler, gab es nichts, was er hätte mitschicken
 * können.
 */

/**
 * Fängt ab, was sonst niemand fängt.
 *
 * Muss so früh wie möglich aufgerufen werden - ein Fehler vor diesem Aufruf geht
 * weiterhin verloren.
 */
export function richteAbsturzbehandlungEin(): void {
  /**
   * Zählt mit, damit aus einem wiederkehrenden Fehler keine Kette von Meldungsfenstern
   * wird. Tritt die Ausnahme in einem Zeitgeber auf, feuert sie sonst im Takt - und
   * jedes modale Fenster blockiert die Oberfläche aufs Neue.
   */
  let schonGemeldet = false;

  process.on('uncaughtException', (fehler) => {
    protokolliere('fehler', 'hauptprozess', `${fehler.stack ?? fehler.message}`);
    if (schonGemeldet) {
      app.exit(1);
      return;
    }
    schonGemeldet = true;
    zeigeAbsturz(fehler);
    /*
     * Danach wirklich beenden.
     *
     * Ein eigener uncaughtException-Behandler UNTERDRÜCKT Electrons Standardverhalten:
     * der Prozess lief nach der Ausnahme weiter, in unbestimmtem Zustand. Die Box sagte
     * dabei "Energy Mail wurde beendet" und "Beim nächsten Start…" - der Nutzer klickte
     * OK und fand ein Programm vor, das noch da war, halb funktionsfähig, mit womöglich
     * inkonsistenten Schreibvorgängen auf Konten, Adressbuch und Ablage. Eine Meldung,
     * die nicht stimmt, ist schlimmer als keine.
     *
     * exit statt quit: quit liefe über before-quit und würde dort erneut versuchen,
     * ausstehende Post zu senden - ausgerechnet in dem Zustand, dem nicht mehr zu trauen
     * ist.
     */
    app.exit(1);
  });

  /*
   * Ein abgewiesenes Versprechen beendet den Prozess nicht, hinterlässt aber einen
   * halbfertigen Zustand. Deshalb nur ins Protokoll und kein Fenster: sonst stünde bei
   * einer wackligen Verbindung im Minutentakt eine Meldung auf dem Bildschirm.
   */
  process.on('unhandledRejection', (grund) => {
    const text = grund instanceof Error ? (grund.stack ?? grund.message) : String(grund);
    protokolliere('fehler', 'versprechen', text);
  });

  app.on('render-process-gone', (_e, _inhalt, angabe) => {
    protokolliere('fehler', 'fenster', `${angabe.reason} (Code ${angabe.exitCode})`);
    // "clean-exit" ist der geordnete Weg beim Schließen - keine Meldung wert.
    if (angabe.reason === 'clean-exit') return;
    dialog.showMessageBox({
      type: 'error',
      title: 'Energy Mail',
      message: 'Das Fenster ist abgestürzt.',
      detail:
        `Grund: ${angabe.reason}\n\n` +
        'Der Vorgang wurde im Protokoll festgehalten. Über Hilfe → ' +
        '„Fehlerbericht erzeugen" lässt sich daraus eine Datei anlegen.',
      buttons: ['Schließen'],
    });
  });

  app.on('child-process-gone', (_e, angabe) => {
    protokolliere('fehler', 'unterprozess', `${angabe.type}: ${angabe.reason}`);
  });
}

/** Der Absturz des Hauptprozesses - danach läuft nichts mehr weiter. */
function zeigeAbsturz(fehler: Error): void {
  try {
    dialog.showErrorBox(
      'Energy Mail wurde beendet',
      `${fehler.message}\n\n` +
        'Der Vorgang steht im Protokoll unter:\n' +
        `${path.join(app.getPath('userData'), 'protokoll')}\n\n` +
        'Beim nächsten Start lässt sich daraus über Hilfe → „Fehlerbericht erzeugen" ' +
        'eine Datei zum Mitschicken anlegen.',
    );
  } catch {
    // Ist Electron schon zu weit heruntergefahren, geht kein Fenster mehr - dann bleibt
    // es beim Protokolleintrag.
  }
}

/** Angaben über die Umgebung, die bei fast jedem Fehler die erste Frage sind. */
function umgebung(): string {
  return [
    `Energy Mail   ${app.getVersion()}`,
    `Electron      ${process.versions.electron}`,
    `Chromium      ${process.versions.chrome}`,
    `Node          ${process.versions.node}`,
    `System        ${os.type()} ${os.release()} (${process.arch})`,
    `Sprache       ${app.getLocale()}`,
    `Speicher      ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
    `Erzeugt am    ${new Date().toISOString()}`,
  ].join('\n');
}

/**
 * Legt einen Fehlerbericht an und zeigt ihn im Dateiverwalter.
 *
 * Bewusst eine Datei und kein Versand: was hinausgeht, entscheidet der Nutzer. Er kann
 * sie vorher öffnen und lesen - und weil alles durch die Reinigung gegangen ist, steht
 * nichts darin, was ihn davon abhalten müsste.
 */
export async function erzeugeFehlerbericht(): Promise<void> {
  const inhalt = [
    '# Fehlerbericht Energy Mail',
    '',
    '## Umgebung',
    umgebung(),
    '',
    '## Protokoll',
    '',
    lesProtokoll() || '(noch nichts aufgezeichnet)',
    '',
  ].join('\n');

  /*
   * Letzte Kontrolle, kurz bevor die Datei entsteht.
   *
   * Die Reinigung läuft schon beim Schreiben jeder Zeile; das hier ist die zweite
   * Instanz. Findet sie doch etwas, wird der Bericht trotzdem angelegt - aber mit einer
   * Warnung obenauf, damit der Nutzer ihn vor dem Verschicken ansieht.
   */
  const beanstandet = enthaeltGeheimnisse(inhalt);
  const fertig =
    beanstandet.length > 0
      ? `> ACHTUNG: Es könnte noch etwas Vertrauliches darin stehen (${beanstandet.join(', ')}).\n` +
        '> Bitte vor dem Verschicken überfliegen.\n\n' +
        inhalt
      : inhalt;

  const marke = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const ziel = path.join(app.getPath('desktop'), `energy-mail-fehlerbericht-${marke}.md`);

  try {
    fs.writeFileSync(ziel, fertig, 'utf8');
  } catch (err) {
    dialog.showErrorBox(
      'Fehlerbericht nicht angelegt',
      `Die Datei ließ sich nicht schreiben:\n${(err as Error).message}`,
    );
    return;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Fehlerbericht angelegt',
    message: 'Der Bericht liegt auf dem Schreibtisch.',
    detail:
      `${path.basename(ziel)}\n\n` +
      'Kennwörter, Zugangsmarken und Mailadressen wurden herausgenommen. ' +
      (beanstandet.length > 0
        ? 'Eine Nachkontrolle hat trotzdem etwas beanstandet – bitte vor dem Verschicken überfliegen.'
        : 'Die Nachkontrolle hat nichts gefunden.'),
    buttons: ['Ordner öffnen', 'Bericht öffnen', 'Schließen'],
    defaultId: 0,
    cancelId: 2,
  });

  if (response === 0) shell.showItemInFolder(ziel);
  if (response === 1) await shell.openPath(ziel);
}

/** Öffnet den Protokollordner - für den Fall, dass jemand selbst nachsehen will. */
export function oeffneProtokollordner(): void {
  const ordner = path.join(app.getPath('userData'), 'protokoll');
  fs.mkdirSync(ordner, { recursive: true });
  void shell.openPath(ordner);
}

/** Hält fest, was im Fenster schiefgeht - die Gegenstücke zu console.error dort. */
export function horcheAufFensterfehler(fenster: BrowserWindow): void {
  /*
   * Die neue Signatur mit einem Ereignisobjekt.
   *
   * Vorher stand hier die alte Reihenfolge (_e, stufe, text, zeile, quelle), und `stufe`
   * war eine Zahl. In den aktuellen Electron-Fassungen sind diese Zusatzangaben als
   * veraltet gekennzeichnet, und `level` ist eine Zeichenkette. Fielen die alten
   * Argumente weg, würde aus `stufe < 3` ein `undefined < 3` - also immer falsch: die
   * Vorfilterung griffe nicht mehr, und JEDE Konsolenausgabe des Fensters landete als
   * "undefined (undefined:undefined)" im Protokoll. Die Rotation bei einer Million
   * Zeichen drängte die eine wichtige Zeile hinaus, und der Fehlerbericht wäre wertlos -
   * ausgerechnet dann, wenn er gebraucht wird.
   */
  fenster.webContents.on('console-message', (details) => {
    // Nur Fehler, nicht jede Warnung: sonst ist das Protokoll voll und die eine Zeile,
    // auf die es ankommt, geht darin unter.
    if (details.level !== 'error') return;
    protokolliere(
      'fehler',
      'anzeige',
      `${details.message} (${details.sourceId ?? '?'}:${details.lineNumber ?? '?'})`,
    );
  });

  fenster.webContents.on('unresponsive', () => {
    protokolliere('warnung', 'anzeige', 'Das Fenster antwortet nicht mehr');
  });

  fenster.webContents.on('responsive', () => {
    protokolliere('info', 'anzeige', 'Das Fenster antwortet wieder');
  });
}

/**
 * Schreibt die Einstellungen in eine Datei zum Mitnehmen.
 *
 * Im Benutzerordner liegen zwölf Dateien, und wer den Rechner wechselt, weiß nicht,
 * welche davon er braucht. Diese eine genügt - was darin steht und was bewusst nicht,
 * entscheidet sicherung.ts auf der Serverseite.
 */
export async function sichereEinstellungen(basis: string): Promise<void> {
  let inhalt: string;
  try {
    const antwort = await fetch(`${basis}/sicherung`, { headers: zugangskopfzeile() });
    if (!antwort.ok) throw new Error(`Der Server antwortete mit ${antwort.status}.`);
    inhalt = JSON.stringify(await antwort.json(), null, 2);
  } catch (err) {
    dialog.showErrorBox('Sicherung nicht möglich', (err as Error).message);
    return;
  }

  const marke = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Einstellungen sichern',
    defaultPath: path.join(app.getPath('documents'), `energy-mail-einstellungen-${marke}.json`),
    filters: [{ name: 'Energy-Mail-Sicherung', extensions: ['json'] }],
  });
  if (canceled || !filePath) return;

  try {
    fs.writeFileSync(filePath, inhalt, 'utf8');
  } catch (err) {
    dialog.showErrorBox('Sicherung nicht geschrieben', (err as Error).message);
    return;
  }

  protokolliere('info', 'sicherung', `Einstellungen gesichert nach ${path.basename(filePath)}`);
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: 'Einstellungen gesichert',
    message: 'Die Datei ist geschrieben.',
    detail:
      `${path.basename(filePath)}\n\n` +
      'Sie enthält Konten, Etiketten, Regeln, das Adressbuch und die gemerkten Suchen – ' +
      'aber keine Kennwörter. Die sind an dieses Windows-Benutzerkonto gebunden und ' +
      'müssen auf einem anderen Rechner einmal neu eingegeben werden.\n\n' +
      'In der Datei stehen alle Mailadressen aus dem Adressbuch. Sie gehört deshalb an ' +
      'einen Ort, den nur Sie erreichen.',
    buttons: ['Ordner öffnen', 'Schließen'],
    defaultId: 1,
    cancelId: 1,
  });
  if (response === 0) shell.showItemInFolder(filePath);
}

/** Liest eine Sicherung ein - was schon da ist, bleibt unangetastet. */
export async function leseEinstellungen(basis: string): Promise<void> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Sicherung einlesen',
    filters: [{ name: 'Energy-Mail-Sicherung', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || filePaths.length === 0) return;

  let roh: unknown;
  try {
    roh = JSON.parse(fs.readFileSync(filePaths[0]!, 'utf8'));
  } catch (err) {
    dialog.showErrorBox('Datei nicht lesbar', (err as Error).message);
    return;
  }

  /*
   * Vorher fragen, was geschieht.
   *
   * Einlesen fügt hinzu und überschreibt nichts - aber das weiß der Nutzer nicht, und
   * "Einstellungen einlesen" klingt nach Ersetzen. Wer sich unsicher ist, bricht hier ab.
   */
  const { response: weiter } = await dialog.showMessageBox({
    type: 'question',
    title: 'Sicherung einlesen',
    message: 'Soll die Sicherung eingelesen werden?',
    detail:
      'Was auf diesem Rechner schon eingerichtet ist, bleibt unverändert – es kommt nur ' +
      'hinzu, was hier noch fehlt. Konten aus der Sicherung müssen danach einmal ' +
      'angemeldet werden, weil Kennwörter nicht mitgesichert werden.',
    buttons: ['Einlesen', 'Abbrechen'],
    defaultId: 0,
    cancelId: 1,
  });
  if (weiter !== 0) return;

  try {
    const antwort = await fetch(`${basis}/sicherung`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...zugangskopfzeile() },
      body: JSON.stringify(roh),
    });
    const ergebnis = (await antwort.json()) as
      | { error: string }
      | Record<string, { uebernommen: number; schonDa?: number }>;

    if (!antwort.ok) {
      dialog.showErrorBox('Sicherung nicht eingelesen', (ergebnis as { error: string }).error);
      return;
    }

    const b = ergebnis as Record<string, { uebernommen: number; schonDa?: number }>;
    const zeile = (name: string, feld: string) =>
      `${name}: ${b[feld]?.uebernommen ?? 0} übernommen` +
      (b[feld]?.schonDa ? `, ${b[feld]!.schonDa} waren schon da` : '');

    protokolliere('info', 'sicherung', `Sicherung eingelesen: ${JSON.stringify(b)}`);
    await dialog.showMessageBox({
      type: 'info',
      title: 'Sicherung eingelesen',
      message: 'Fertig.',
      detail:
        [
          zeile('Konten', 'konten'),
          zeile('Etiketten', 'etiketten'),
          zeile('Adressbuch', 'kontakte'),
          zeile('Gemerkte Suchen', 'suchen'),
          zeile('Regeln', 'regeln'),
        ].join('\n') +
        ((b.konten?.uebernommen ?? 0) > 0
          ? '\n\nDie neuen Konten sind noch nicht angemeldet – in der Seitenleiste steht ' +
            'bei ihnen ein Knopf dafür.'
          : ''),
      buttons: ['Schließen'],
    });
  } catch (err) {
    dialog.showErrorBox('Sicherung nicht eingelesen', (err as Error).message);
  }
}
