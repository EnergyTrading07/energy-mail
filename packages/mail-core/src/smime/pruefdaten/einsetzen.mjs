import fs from 'node:fs';
import path from 'node:path';

/**
 * Schreibt die von erzeugen.sh gebauten Dateien nach daten.mts.
 *
 * Zertifikate und Schluessel werden als reiner Base64-Inhalt abgelegt, ohne die
 * PEM-Marken drumherum - siehe den Kopf von daten.mts. Die Nachrichten stehen als Text
 * da, damit man sie lesen kann; ihre CRLF werden dabei aus dem Quelltext zurueckgewonnen
 * (JavaScript vereinheitlicht Zeilenenden in Vorlagenzeichenketten auf LF).
 */

const [, , arbeit, ziel] = process.argv;
if (!arbeit || !ziel) {
  console.error('Aufruf: node einsetzen.mjs <arbeitsverzeichnis> <daten.mts>');
  process.exit(1);
}

const umbruch = (s) => s.match(/.{1,96}/g).join('\n    ');
const w = (d) => path.join(arbeit, d);
const derVon = (d) =>
  umbruch(
    fs
      .readFileSync(w(d), 'utf8')
      .replace(/-----[A-Z ]+-----/g, '')
      .replace(/\s+/g, ''),
  );
const b64Von = (d) => umbruch(fs.readFileSync(w(d)).toString('base64'));
const alsText = (d) =>
  fs
    .readFileSync(w(d), 'utf8')
    .split('\\')
    .join('\\\\')
    .split('`')
    .join('\\`')
    .split('${')
    .join('\\${');

const kopf = fs.readFileSync(ziel, 'utf8').split('\nexport const ')[0];
let out = kopf + '\n';

for (const [name, datei] of [
  ['caZertifikat', 'ca.crt'],
  ['annaZertifikat', 'anna.crt'],
  ['bertZertifikat', 'bert.crt'],
  ['zwiegesichtZertifikat', 'zwiegesicht.crt'],
  ['serverZertifikat', 'server.crt'],
  ['annaSchluessel', 'anna.key'],
  ['bertSchluessel', 'bert.key'],
]) {
  out += `export const ${name} =\n  \`${derVon(datei)}\`;\n\n`;
}
for (const [name, datei] of [
  ['annaP12', 'anna.p12'],
  ['annaP12Alt', 'anna-alt.p12'],
]) {
  out += `export const ${name} =\n  \`${b64Von(datei)}\`;\n\n`;
}
for (const [name, datei] of [
  ['signiertAbgetrennt', 'signiert.eml'],
  ['signiertOpak', 'signiert-opak.eml'],
  ['verschluesselt', 'verschluesselt.eml'],
  ['signiertUndVerschluesselt', 'sig-und-geheim.eml'],
]) {
  out += `export const ${name} =\n  \`${alsText(datei)}\`;\n\n`;
}
out += `export const klartext = \`${alsText('inhalt.txt')}\`;\n`;

fs.writeFileSync(ziel, out);
console.log(`   ${out.length} Bytes`);
