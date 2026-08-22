import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setDataDir } from '../paths.js';
import { beurteileLage, type Umstaende } from './lage.js';
import { setzeAngaben, type Erhoben } from './bestandsaufnahme.js';
import { tomText } from './tom.js';
import { verzeichnisText } from './verarbeitungsverzeichnis.js';
import { avvText } from './avv.js';
import { erzeugeUnterlagen } from './unterlagen.js';

/**
 * Datenschutzunterlagen.
 *
 * ## Was hier eigentlich geprueft wird
 *
 * Nicht, ob die Texte schoen sind. Geprueft wird die **Entscheidung davor** - wer hier
 * Verantwortlicher ist, wer Auftragsverarbeiter und wer ausdruecklich keiner. Diese
 * Entscheidung ist der ganze Wert des Punktes: Ein Stapel Vorlagen bekommt man ueberall,
 * die Auskunft "diesen Vertrag brauchen Sie NICHT, dafuer aber jenen" nirgends.
 *
 * Der zweite Teil prueft, dass die erzeugten Papiere vollstaendig sind - insbesondere,
 * dass der AVV alle acht Punkte aus Art. 28 Abs. 3 enthaelt. Fehlt einer, ist der Vertrag
 * unvollstaendig, und die Bussgeldnorm trifft beide Seiten.
 *
 * Und der dritte prueft eine Kleinigkeit, die man leicht uebersieht: dass in den Papieren
 * wirklich die erhobenen Zahlen stehen und keine Platzhalter. Genau daran erkennt man den
 * Unterschied zwischen einer erzeugten Unterlage und einer abgeschriebenen.
 */

let ok = 0;
let gesamt = 0;

function pruefe(name: string, fn: () => void): void {
  gesamt++;
  try {
    fn();
    console.log(`  ok   ${name}`);
    ok++;
  } catch (err) {
    console.log(`  FEHL ${name}\n       ${(err as Error).message}`);
  }
}

const ORDNER = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-mail-datenschutz-'));
setDataDir(ORDNER);

/** Der Regelfall: ein Betrieb, eigener Server, keine Fernwartung. */
const FIRMA: Umstaende = {
  betriebsart: 'server',
  beschaeftigte: true,
  privat: false,
  betreiber: 'selbst',
  fernwartung: false,
  betriebsrat: false,
  postfachanbieter: ['microsoft.com'],
  verzeichnis: false,
  archiv: false,
};

const ERHOBEN: Erhoben = {
  nutzer: 12,
  verwalter: 2,
  mitZweiFaktor: 3,
  freigaben: 4,
  postfachanbieter: ['microsoft.com'],
  konten: 14,
  ueberOAuth: 14,
  verzeichnis: true,
  archiv: true,
  archivKonten: 9,
  verschluesselungBereit: true,
  sperrfristMinuten: 15,
  selbstanmeldung: 'freigabe',
  selbstanmeldungDomaenen: ['firma.de'],
  offeneAntraege: 2,
};

console.log('\nWer ist hier was');

await Promise.resolve();

pruefe('privat am Einzelplatz: die Verordnung gilt gar nicht', () => {
  const befund = beurteileLage({ ...FIRMA, betriebsart: 'einzelplatz', privat: true, beschaeftigte: false });
  assert.deepEqual(befund.unterlagen, ['keine']);
  assert.equal(befund.auftragsverarbeiter.length, 0);
  assert.match(befund.verantwortlicher, /Art\. 2 Abs\. 2 lit\. c/);
  // Und der Hinweis, wo die Ausnahme endet - daran scheitern die meisten.
  assert.ok(befund.hinweise.some((h) => /beruflich/.test(h)));
});

/*
 * Der wichtigste Fall des ganzen Punktes. Reine Softwareueberlassung ist KEINE
 * Auftragsverarbeitung - und ein AVV mit dem Hersteller waere ein Vertrag ueber nichts.
 * Viele Anbieter legen trotzdem einen bei.
 */
pruefe('ohne Fernwartung ist der Hersteller ausdruecklich kein Auftragsverarbeiter', () => {
  const befund = beurteileLage(FIRMA);
  assert.ok(
    befund.keineAuftragsverarbeitung.some((x) => /Hersteller/.test(x.wer)),
    'Der Hersteller fehlt in der Liste derer, die keine sind.',
  );
  assert.ok(!befund.auftragsverarbeiter.some((x) => /Hersteller/.test(x.wer)));
  assert.ok(!befund.unterlagen.includes('avv-fernwartung'));
  const grund = befund.keineAuftragsverarbeitung.find((x) => /Hersteller/.test(x.wer))!.weil;
  assert.match(grund, /Softwareüberlassung/);
});

pruefe('mit Fernwartung wird er einer - die Möglichkeit genügt', () => {
  const befund = beurteileLage({ ...FIRMA, fernwartung: true });
  assert.ok(befund.auftragsverarbeiter.some((x) => /Fernwartung/.test(x.wer)));
  assert.ok(!befund.keineAuftragsverarbeitung.some((x) => /Hersteller/.test(x.wer)));
  assert.ok(befund.unterlagen.includes('avv-fernwartung'));
  const grund = befund.auftragsverarbeiter.find((x) => /Fernwartung/.test(x.wer))!.weil;
  // Der entscheidende Halbsatz: nicht ob er hineinsieht, sondern ob er koennte.
  assert.match(grund, /Möglichkeit genügt/);
});

pruefe('der Postfachanbieter steht immer an erster Stelle', () => {
  const befund = beurteileLage(FIRMA);
  assert.equal(befund.auftragsverarbeiter[0]?.wer, 'microsoft.com');
  assert.ok(befund.unterlagen.includes('avv-anbieter'));
});

pruefe('ein fremder Serverbetreiber braucht einen eigenen Vertrag', () => {
  const selbst = beurteileLage(FIRMA);
  assert.ok(!selbst.unterlagen.includes('avv-betreiber'));
  assert.ok(selbst.keineAuftragsverarbeitung.some((x) => /eigene Server/.test(x.wer)));

  const fremd = beurteileLage({ ...FIRMA, betreiber: 'dienstleister' });
  assert.ok(fremd.unterlagen.includes('avv-betreiber'));
  assert.ok(fremd.auftragsverarbeiter.some((x) => /Dienstleister/.test(x.wer)));
});

/*
 * Die Mitbestimmung. Sie wird bei Software fast immer uebersehen und ist der Punkt, an dem
 * eine eingefuehrte Loesung wieder abgeschaltet werden muss.
 */
pruefe('Archiv und Betriebsrat: § 87 Abs. 1 Nr. 6 BetrVG', () => {
  const befund = beurteileLage({ ...FIRMA, archiv: true, betriebsrat: true });
  assert.ok(befund.unterlagen.includes('betriebsvereinbarung'));
  const hinweis = befund.hinweise.find((h) => /87 Abs\. 1 Nr\. 6/.test(h));
  assert.ok(hinweis, 'Der Hinweis auf die Mitbestimmung fehlt.');
  // Und der Halbsatz, auf den es ankommt: die Eignung genuegt, die Absicht ist gleichgueltig.
  assert.match(hinweis!, /Eignung|spielt keine Rolle/);
});

pruefe('ohne Betriebsrat wird keine Betriebsvereinbarung verlangt - aber vorgemerkt', () => {
  const befund = beurteileLage({ ...FIRMA, archiv: true, betriebsrat: false });
  assert.ok(!befund.unterlagen.includes('betriebsvereinbarung'));
  assert.ok(befund.hinweise.some((h) => /je ein Betriebsrat gebildet/.test(h)));
});

pruefe('bei Beschäftigten kommen § 26 BDSG und die Unterrichtung dazu', () => {
  const mit = beurteileLage(FIRMA);
  assert.ok(mit.unterlagen.includes('datenschutzhinweis-beschaeftigte'));
  assert.ok(mit.hinweise.some((h) => /§ 26 BDSG/.test(h)));
  // Und die unangenehme Frage, die jeder Betrieb ungern beantwortet.
  assert.ok(mit.hinweise.some((h) => /[Pp]rivate Nutzung/.test(h)));

  const ohne = beurteileLage({ ...FIRMA, beschaeftigte: false, betriebsart: 'einzelplatz' });
  assert.ok(!ohne.unterlagen.includes('datenschutzhinweis-beschaeftigte'));
});

pruefe('kein Befund ohne den Satz, dass es kein Rechtsrat ist', () => {
  for (const u of [FIRMA, { ...FIRMA, fernwartung: true }, { ...FIRMA, archiv: true }]) {
    assert.ok(
      beurteileLage(u).hinweise.some((h) => /keine Rechtsberatung/.test(h)),
      'Der Vorbehalt fehlt.',
    );
  }
});

console.log('\nDer Vertrag');

const AVV = avvText(
  { betreiber: 'selbst', fernwartung: true, betriebsrat: false, beschaeftigte: true, privat: false, betrieb: 'Muster GmbH', anschrift: 'Musterweg 1' },
  ERHOBEN,
  { rolle: 'Fernwartung', name: 'IT-Haus Meier' },
  new Date('2026-09-01T10:00:00Z'),
);

/*
 * Art. 28 Abs. 3 zaehlt acht Punkte auf, lit. a bis h. Fehlt einer, ist der Vertrag
 * unvollstaendig - und Art. 83 Abs. 4 lit. a trifft dann beide Seiten, nicht nur eine.
 */
pruefe('der AVV enthält alle acht Punkte aus Art. 28 Abs. 3', () => {
  /*
   * Vor dem Suchen wird der Zeilenumbruch geglaettet. Der Text ist auf 96 Zeichen
   * umbrochen, und wo der Umbruch faellt, entscheidet die Zeilenlaenge - nicht der Inhalt.
   * Eine Pruefung, die daran scheitert, prueft die Formatierung statt der Sache, und beim
   * naechsten Umformulieren steht sie grundlos auf Rot.
   */
  const text = AVV.replace(/\s+/g, ' ');
  const pflicht: [string, RegExp][] = [
    ['a) Weisungsgebundenheit', /dokumentierte Weisung/],
    ['b) Vertraulichkeit', /Vertraulichkeit verpflichtet|Verschwiegenheitspflicht/],
    ['c) Maßnahmen nach Art. 32', /Art\. 32 DSGVO/],
    ['d) Unterauftragsverarbeiter', /Unterauftragsverarbeiter/],
    ['e) Betroffenenrechte', /Anfragen betroffener Personen/],
    ['f) Art. 32 bis 36', /Art\. 32 bis 36/],
    ['g) Löschung und Rückgabe', /gibt der Auftragsverarbeiter alle Daten heraus oder löscht/],
    ['h) Nachweise und Prüfungen', /ermöglicht Überprüfungen/],
  ];
  for (const [was, muster] of pflicht) {
    assert.match(text, muster, `Es fehlt: ${was}`);
  }
});

pruefe('der AVV nennt beide Seiten und den Gegenstand', () => {
  assert.match(AVV, /Muster GmbH/);
  assert.match(AVV, /IT-Haus Meier/);
  assert.match(AVV, /\*\*Gegenstand:\*\* Fernwartung/);
});

pruefe('die Meldefrist ist kürzer als die 72 Stunden - und sagt warum', () => {
  assert.match(AVV, /binnen 24 Stunden/);
  assert.match(AVV, /braucht Zeit, um selbst zu melden/);
});

pruefe('der AVV gibt sich als Entwurf zu erkennen', () => {
  assert.match(AVV, /Entwurf, kein unterschriftsreifer Vertrag/);
  // Und sagt, was er bewusst NICHT regelt - sonst hält ihn jemand für vollständig.
  assert.match(AVV, /Haftung, Vergütung/);
});

console.log('\nDie erhobenen Zahlen');

const TOM = tomText({ betreiber: 'selbst', fernwartung: false, betriebsrat: false, beschaeftigte: true, privat: false, betrieb: 'Muster GmbH' }, ERHOBEN);

pruefe('in der Maßnahmenliste stehen die wirklichen Zahlen', () => {
  assert.match(TOM, /3 von 12 Nutzern eingerichtet/, 'Der Anteil mit zweitem Faktor fehlt.');
  assert.match(TOM, /2 von 12 Nutzern sind Verwalter/);
  assert.match(TOM, /12 Nutzer, 4 ausdrückliche Freigaben/);
  assert.match(TOM, /Nach 15 Minuten ohne Bedienung/);
  assert.match(TOM, /Archiv eingeschaltet für 9 Konten/);
  // Und keine Platzhalter, die durchgerutscht sind.
  assert.ok(!/\$\{/.test(TOM), 'Im Text steht eine nicht ersetzte Einsetzung.');
});

pruefe('fehlt die Verschlüsselung, steht es als Befund da und nicht als Nebensatz', () => {
  const ohne = tomText(
    { betreiber: 'selbst', fernwartung: false, betriebsrat: false, beschaeftigte: true, privat: false },
    { ...ERHOBEN, verschluesselungBereit: false },
  );
  assert.match(ohne, /NICHT eingerichtet — Zugangsdaten lägen im Klartext/);
});

pruefe('die Maßnahmenliste benennt, was sie nicht leistet', () => {
  assert.match(TOM, /Gegen den Verwalter des Rechners helfen sie nicht/);
  assert.match(TOM, /zweite Faktor ist freiwillig/);
});

pruefe('die Markdown-Tabellen sind gerade', () => {
  // Eine schiefe Tabelle faellt beim Lesen sofort auf und wirkt wie Schlamperei - in
  // einem Papier, das eine Aufsichtsbehoerde liest, ist das teurer als es aussieht.
  for (const [name, text] of [
    ['TOM', TOM],
    ['Verzeichnis', verzeichnisText({ betreiber: 'selbst', fernwartung: false, betriebsrat: false, beschaeftigte: true, privat: false }, ERHOBEN, beurteileLage({ ...FIRMA, archiv: true }))],
  ] as const) {
    const zeilen = text.split('\n');
    let spalten = 0;
    for (const zeile of zeilen) {
      if (!zeile.trim().startsWith('|')) {
        spalten = 0;
        continue;
      }
      const anzahl = zeile.split('|').length;
      if (spalten === 0) spalten = anzahl;
      else assert.equal(anzahl, spalten, `${name}: schiefe Tabellenzeile "${zeile.slice(0, 50)}"`);
    }
  }
});

console.log('\nDer Stapel');

pruefe('ohne Fernwartung und ohne Dienstleister entsteht KEIN Vertrag', () => {
  setzeAngaben({
    betrieb: 'Muster GmbH',
    betreiber: 'selbst',
    fernwartung: false,
    beschaeftigte: true,
    privat: false,
  });
  const ergebnis = erzeugeUnterlagen(ERHOBEN, path.join(ORDNER, 'stapel-a'));
  assert.deepEqual(ergebnis.dateien, [
    '00-LIESMICH.md',
    '10-Verarbeitungsverzeichnis.md',
    '20-Technische-und-organisatorische-Massnahmen.md',
  ]);
});

pruefe('mit Fernwartung und Dienstleister entstehen zwei', () => {
  setzeAngaben({
    betreiber: 'dienstleister',
    dienstleister: 'IT-Haus Meier',
    fernwartung: true,
    fernwarter: 'IT-Haus Meier',
  });
  const ergebnis = erzeugeUnterlagen(ERHOBEN, path.join(ORDNER, 'stapel-b'));
  assert.equal(ergebnis.dateien.length, 5);
  assert.ok(ergebnis.dateien.some((d) => /AVV-Serverbetrieb/.test(d)));
  assert.ok(ergebnis.dateien.some((d) => /AVV-Fernwartung/.test(d)));
  const vertrag = fs.readFileSync(
    path.join(ergebnis.ordner, ergebnis.dateien.find((d) => /Serverbetrieb/.test(d))!),
    'utf8',
  );
  assert.match(vertrag, /IT-Haus Meier/);
});

/*
 * Und der Punkt, um den es beim Deckblatt eigentlich geht: Fuer den Postfachanbieter liegt
 * KEIN Entwurf bei, und es steht dabei, warum - und was stattdessen zu tun ist.
 */
pruefe('für den Postfachanbieter liegt kein Entwurf bei, sondern eine Anweisung', () => {
  const ergebnis = erzeugeUnterlagen(ERHOBEN, path.join(ORDNER, 'stapel-c'));
  const deckblatt = fs.readFileSync(path.join(ergebnis.ordner, '00-LIESMICH.md'), 'utf8');
  assert.ok(!ergebnis.dateien.some((d) => /AVV-Postfach|AVV-Anbieter/i.test(d)));
  assert.match(deckblatt, /kein Entwurf bei, und das mit Absicht/);
  assert.match(deckblatt, /microsoft\.com/);
  assert.match(deckblatt, /wichtigste Punkt dieser Liste/);
});

pruefe('das Deckblatt sagt, wer ausdrücklich kein Auftragsverarbeiter ist', () => {
  setzeAngaben({ betreiber: 'selbst', fernwartung: false });
  const ergebnis = erzeugeUnterlagen(ERHOBEN, path.join(ORDNER, 'stapel-d'));
  const deckblatt = fs.readFileSync(path.join(ergebnis.ordner, '00-LIESMICH.md'), 'utf8');
  assert.match(deckblatt, /Wer ausdrücklich KEIN Auftragsverarbeiter ist/);
  assert.match(deckblatt, /Vertrag über nichts/);
});

fs.rmSync(ORDNER, { recursive: true, force: true });

console.log(`\n${ok}/${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
