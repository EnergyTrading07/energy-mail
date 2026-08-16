import fs from 'node:fs';
import path from 'node:path';
import { getWurzelDir } from '../paths.js';
import { protokolliere } from '../protokollDatei.js';
import { angaben, umstaendeAus, type Angaben, type Erhoben } from './bestandsaufnahme.js';
import { beurteileLage, UNTERLAGEN_NAMEN, type Befund } from './lage.js';
import { tomText } from './tom.js';
import { verzeichnisText } from './verarbeitungsverzeichnis.js';
import { avvText } from './avv.js';

/**
 * Der Stapel Papier - und das Deckblatt, das sagt, was davon wirklich gebraucht wird.
 *
 * ## Warum ein Deckblatt und keine Sammelmappe
 *
 * Weil ein Stapel Vorlagen die bequemste Art ist, jemanden im Stich zu lassen. Er hat
 * danach mehr Papier als vorher und weiß immer noch nicht, was er unterschreiben muss,
 * was er vom Anbieter holen muss und was er getrost weglassen kann.
 *
 * Das Deckblatt beantwortet genau diese drei Fragen, und zwar für den vorliegenden
 * Betrieb - nicht allgemein. Es steht deshalb an erster Stelle und ist das einzige
 * Dokument, das immer entsteht.
 */

export interface Ausfuhrbefund {
  ordner: string;
  dateien: string[];
  befund: Befund;
}

const dateiname = (titel: string) =>
  titel
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function erzeugeUnterlagen(erhoben: Erhoben, ziel?: string, jetzt = new Date()): Ausfuhrbefund {
  const a = angaben();
  const befund = beurteileLage(umstaendeAus(a, erhoben));

  const marke = jetzt.toISOString().slice(0, 10);
  const ordner =
    ziel ?? path.join(getWurzelDir(), 'datenschutz', `unterlagen-${marke}`);
  fs.mkdirSync(ordner, { recursive: true, mode: 0o700 });

  const dateien: string[] = [];
  const schreibe = (name: string, inhalt: string) => {
    fs.writeFileSync(path.join(ordner, name), inhalt, 'utf8');
    dateien.push(name);
  };

  schreibe('00-LIESMICH.md', deckblatt(a, erhoben, befund, jetzt));
  schreibe('10-Verarbeitungsverzeichnis.md', verzeichnisText(a, erhoben, befund, jetzt));
  schreibe('20-Technische-und-organisatorische-Massnahmen.md', tomText(a, erhoben, jetzt));

  /*
   * Ein AVV entsteht nur dort, wo einer gebraucht wird - und ausdrücklich keiner für den
   * Postfachanbieter. Dort ist ein eigener Entwurf nutzlos: Microsoft und Google
   * unterschreiben keine fremden Verträge. Was dort zu tun ist, steht im Deckblatt.
   */
  if (befund.unterlagen.includes('avv-betreiber')) {
    schreibe(
      `30-${dateiname('AVV Serverbetrieb')}.md`,
      avvText(a, erhoben, {
        rolle: 'Betrieb und Betreuung des Servers, auf dem Energy Mail läuft',
        name: a.dienstleister ?? '',
      }, jetzt),
    );
  }
  if (befund.unterlagen.includes('avv-fernwartung')) {
    schreibe(
      `31-${dateiname('AVV Fernwartung')}.md`,
      avvText(a, erhoben, {
        rolle: 'Fernwartung und Störungsbeseitigung mit Zugriffsmöglichkeit auf die Daten',
        name: a.fernwarter ?? '',
      }, jetzt),
    );
  }

  protokolliere('info', 'datenschutz', `Unterlagen erzeugt nach ${ordner} (${dateien.length} Dateien)`);
  return { ordner, dateien, befund };
}

/** Das Deckblatt: was gebraucht wird, was nicht, und was als Nächstes zu tun ist. */
function deckblatt(a: Angaben, e: Erhoben, befund: Befund, jetzt: Date): string {
  const liste = (eintraege: { wer: string; weil: string }[]) =>
    eintraege.length === 0
      ? '_(keine)_'
      : eintraege.map((x) => `- **${x.wer}**\n  ${x.weil}`).join('\n');

  const zuTun: string[] = [];
  if (befund.unterlagen.includes('avv-anbieter')) {
    zuTun.push(
      `**Den Auftragsverarbeitungsvertrag beim Postfachanbieter annehmen** ` +
        `(${e.postfachanbieter.join(', ')}).\n` +
        `   Hier liegt kein Entwurf bei, und das mit Absicht: Große Anbieter unterschreiben\n` +
        `   keine fremden Verträge. Ihr Vertrag ist fertig und liegt in deren\n` +
        `   Verwaltungsoberfläche — bei Microsoft 365 unter „Datenschutzbestimmungen“, bei\n` +
        `   Google Workspace unter „Datenverarbeitungszusatz“. Bei einem kleineren Anbieter\n` +
        `   fragt man danach; wer keinen hat, ist der falsche Anbieter für Geschäftspost.\n` +
        `   **Das ist der wichtigste Punkt dieser Liste** — dort liegt die Post, nicht hier.`,
    );
  }
  if (befund.unterlagen.includes('avv-betreiber')) {
    zuTun.push(
      `**Den beiliegenden AVV mit ${a.dienstleister ?? 'dem Serverbetreiber'} schließen** ` +
        `(Datei 30). Anlage 1 füllt der Auftragnehmer aus.`,
    );
  }
  if (befund.unterlagen.includes('avv-fernwartung')) {
    zuTun.push(
      `**Den beiliegenden AVV für die Fernwartung schließen** (Datei 31). Er wird gebraucht,\n` +
        `   weil jemand von außen an die Daten herankommen KANN — ob er hineinsieht, spielt\n` +
        `   keine Rolle.`,
    );
  }
  zuTun.push(
    '**Das Verarbeitungsverzeichnis (Datei 10) vervollständigen.** Die offenen Punkte am\n' +
      '   Ende sind kurz, und sie sind das, wonach eine Aufsichtsbehörde zuerst fragt.',
  );
  if (befund.unterlagen.includes('betriebsvereinbarung')) {
    zuTun.push(
      '**Den Betriebsrat beteiligen, bevor es losgeht.** Hierzu liegt keine Vorlage bei:\n' +
        '   Eine Betriebsvereinbarung wird verhandelt und nicht ausgefüllt. Was hineingehört,\n' +
        '   steht in der Aufstellung der Maßnahmen (Datei 20).',
    );
  }
  if (befund.unterlagen.includes('datenschutzhinweis-beschaeftigte')) {
    zuTun.push(
      '**Die Beschäftigten unterrichten** (Art. 13 DSGVO, § 26 BDSG) — was aufgezeichnet\n' +
        '   wird, wozu, wie lange, und wer hineinsehen kann.',
    );
  }

  return `# Was Sie brauchen — und was nicht

**Betrieb:** ${a.betrieb ?? '_(nicht angegeben)_'}
**Stand:** ${jetzt.toISOString().slice(0, 10)}

Dieses Blatt ist kein Vertrag. Es sagt, welche Papiere dieser Betrieb wirklich braucht,
welche er sich sparen kann und wo sie herkommen. Es steht an erster Stelle, weil ein
Stapel Vorlagen ohne diese Auskunft mehr schadet als nützt: Man heftet ihn ab und hält
die Sache für erledigt.

---

## Verantwortlich

${befund.verantwortlicher}

## Wer im Auftrag verarbeitet

${liste(befund.auftragsverarbeiter)}

## Wer ausdrücklich KEIN Auftragsverarbeiter ist

${liste(befund.keineAuftragsverarbeitung)}

> Diese Liste ist die nützlichste des ganzen Stapels. **Reine Softwareüberlassung ist
> keine Auftragsverarbeitung** — wer ein Programm kauft und auf dem eigenen Rechner
> betreibt, lässt niemanden für sich verarbeiten. Ein AVV mit dem Hersteller wäre ein
> Vertrag über nichts. Viele Anbieter legen trotzdem einen bei, weil er professionell
> aussieht; der Kunde unterschreibt, heftet ab — und besorgt die Verträge nicht, die er
> wirklich braucht.

## Was zu tun ist

${zuTun.map((z, i) => `${i + 1}. ${z}`).join('\n\n')}

## Was Sie sonst noch wissen sollten

${befund.hinweise.map((h) => `- ${h}`).join('\n')}

---

## Was hier liegt

| Datei | Was es ist | Woher |
|---|---|---|
| \`10-Verarbeitungsverzeichnis.md\` | ${UNTERLAGEN_NAMEN.verarbeitungsverzeichnis} | Erzeugt, mit offenen Punkten am Ende |
| \`20-Technische-und-organisatorische-Massnahmen.md\` | ${UNTERLAGEN_NAMEN.tom} | **Aus dem laufenden System erhoben**, nicht abgeschrieben |
${befund.unterlagen.includes('avv-betreiber') ? '| `30-AVV-Serverbetrieb.md` | Vertragsentwurf | Vorlage, zu verhandeln |\n' : ''}${befund.unterlagen.includes('avv-fernwartung') ? '| `31-AVV-Fernwartung.md` | Vertragsentwurf | Vorlage, zu verhandeln |\n' : ''}
Der erhobene Teil ist der Grund, warum sich diese Unterlagen von einer Vorlage
unterscheiden: Dort steht, wie viele Nutzer es gibt, wie viele davon einen zweiten Faktor
eingerichtet haben und ob die Zugangsdaten verschlüsselt liegen — Zahlen aus diesem
Betrieb, nicht aus einem Beispiel. Sie sind bei jeder wesentlichen Änderung neu zu
erzeugen.

---

> **Kein Rechtsrat.** Was hier gerechnet und geschrieben wird, deckt die Regelfälle ab und
> ersetzt niemanden, der dafür einsteht. Bei Beschäftigtendaten, bei einem Betriebsrat und
> bei Übermittlungen in Drittländer gehört ein Mensch darüber, bevor etwas unterschrieben
> wird.
`;
}
