#!/usr/bin/env node
/**
 * Erzeugt das Schlüsselpaar, mit dem Aktualisierungen freigegeben werden.
 *
 * Einmal auszuführen, danach nie wieder. Der öffentliche Teil wandert in den
 * Programmtext (packages/desktop/src/updateSignatur.ts), der geheime bleibt auf diesem
 * Rechner und geht nirgends hin - vor allem nicht in die CI und nicht ins Repository.
 *
 * Genau darin liegt der Sinn: ein Signierschlüssel, der in der CI liegt, fällt mit der
 * CI. Wer den GitHub-Zugang übernimmt, signiert damit seine eigene Fassung, und die
 * Prüfung in der Anwendung geht anstandslos durch. Dieser hier liegt woanders, also
 * hilft ein übernommener Zugang nicht weiter.
 *
 * Ed25519 statt RSA: kurze Schlüssel, kurze Unterschriften, keine Parameter, die man
 * falsch wählen kann, und es steckt in Node selbst.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Wo der geheime Teil liegt.
 *
 * Im Benutzerprofil und ausdrücklich NICHT im Quellbaum: dort wäre er einen unbedachten
 * "git add -A" davon entfernt, im Repository zu landen - und ein Signierschlüssel, der
 * einmal veröffentlicht war, ist für immer verbrannt.
 */
const GEHEIM_ORDNER = path.join(os.homedir(), '.energy-mail');
const GEHEIM_DATEI = path.join(GEHEIM_ORDNER, 'freigabe-schluessel.pem');

if (fs.existsSync(GEHEIM_DATEI)) {
  console.error(
    `Es gibt bereits einen Schlüssel: ${GEHEIM_DATEI}\n\n` +
      'Ihn zu ersetzen bedeutet, dass alle installierten Fassungen keine Aktualisierung\n' +
      'mehr annehmen - sie prüfen gegen den alten öffentlichen Teil. Wenn das wirklich\n' +
      'gewollt ist, die Datei von Hand wegräumen und noch einmal starten.',
  );
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

fs.mkdirSync(GEHEIM_ORDNER, { recursive: true, mode: 0o700 });
fs.writeFileSync(GEHEIM_DATEI, privateKey.export({ type: 'pkcs8', format: 'pem' }), {
  mode: 0o600,
});

const oeffentlich = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

console.log(`
Schlüsselpaar erzeugt.

Der geheime Teil liegt in
  ${GEHEIM_DATEI}

SICHERN. Geht er verloren, lässt sich keine Aktualisierung mehr freigeben, und alle
installierten Fassungen bleiben stehen, wo sie sind - der Weg zurück führt dann über eine
von Hand verteilte Neuinstallation. Eine Kopie an einem zweiten Ort ist keine Kür.

WEITERGEBEN darf man ihn nicht. Nicht in die CI, nicht ins Repository, nicht in eine
Umgebungsvariable auf einem Server. Er ist der einzige Grund, warum ein übernommener
GitHub-Zugang nicht genügt, um Schadcode auszuliefern.

Der öffentliche Teil gehört jetzt in
  packages/desktop/src/updateSignatur.ts

und zwar als Wert von OEFFENTLICHER_SCHLUESSEL:

  export const OEFFENTLICHER_SCHLUESSEL =
    '${oeffentlich}';

Danach einmal bauen und einchecken. Ab der Fassung, die diesen Schlüssel mitbringt,
prüft die Anwendung jede weitere Aktualisierung dagegen.
`);
