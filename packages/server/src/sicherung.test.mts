import assert from 'node:assert/strict';
import {
  HINWEIS,
  SICHERUNG_FASSUNG,
  nurNeue,
  ohneGeheimnisse,
  pruefeSicherung,
} from './sicherung.js';

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

const KONTO = {
  id: 'abc',
  email: 'anna@gmx.de',
  imapHost: 'imap.gmx.net',
  imapPort: 993,
  imapSecure: true,
  smtpHost: 'mail.gmx.net',
  smtpPort: 587,
  smtpSecure: false,
  displayName: 'Anna Bauer',
  signature: 'Viele Grüße',
  auth: { type: 'password', user: 'anna@gmx.de', pass: 'Hunter2!' },
} as never;

console.log('\nWas in die Sicherung darf:');

pruefe('kein Kennwort kommt mit', () => {
  /*
   * Die eine Zusicherung, auf der die ganze Datei beruht: sie soll in einen Ordner in
   * der Wolke gelegt werden können, ohne dass jemand vorher hineinsieht.
   */
  const g = ohneGeheimnisse(KONTO);
  const alsText = JSON.stringify(g);
  assert.ok(!alsText.includes('Hunter2'), alsText);
  assert.equal((g as unknown as Record<string, unknown>).auth, undefined);
  // Nach dem Feld suchen, nicht nach der Zeichenfolge: "anmeldung":"password" enthält
  // ebenfalls "pass", ist aber genau die Angabe, die mitkommen soll.
  assert.ok(!('pass' in g), 'ein pass-Feld ist geblieben');
  assert.ok(!('password' in g), 'ein password-Feld ist geblieben');
});

pruefe('auch keine Zugangsmarke', () => {
  const mitMarke = {
    ...(KONTO as object),
    auth: {
      type: 'oauth2',
      provider: 'google',
      accessToken: 'ya29.geheim',
      refreshToken: '1//geheim',
    },
  } as never;
  const alsText = JSON.stringify(ohneGeheimnisse(mitMarke));
  assert.ok(!alsText.includes('ya29'), alsText);
  assert.ok(!alsText.includes('1//'), alsText);
  // Dass es OAuth war, bleibt aber stehen - sonst wüsste man nach dem Einlesen nicht,
  // wie man sich neu anmelden muss.
  assert.equal(ohneGeheimnisse(mitMarke).anmeldung, 'oauth2');
});

pruefe('ein neues Feld ist von sich aus draußen', () => {
  /*
   * Ausgewählt wird, was mitkommt - nicht gelöscht, was nicht mitsoll. Sonst rutschte
   * jedes künftige Feld durch, bis jemand daran denkt.
   */
  const mitNeuem = { ...(KONTO as object), geheimeNeuigkeit: 'darf nicht mit' } as never;
  assert.ok(!JSON.stringify(ohneGeheimnisse(mitNeuem)).includes('darf nicht mit'));
});

pruefe('was gebraucht wird, ist drin', () => {
  const g = ohneGeheimnisse(KONTO);
  assert.equal(g.email, 'anna@gmx.de');
  assert.equal(g.imapHost, 'imap.gmx.net');
  assert.equal(g.smtpPort, 587);
  assert.equal(g.displayName, 'Anna Bauer');
  assert.equal(g.signature, 'Viele Grüße');
  assert.equal(g.anmeldung, 'password');
});

console.log('\nEine Datei, die keine Sicherung ist:');

pruefe('wird abgelehnt statt angefasst', () => {
  for (const unfug of [null, undefined, 42, 'text', [], {}]) {
    const e = pruefeSicherung(unfug);
    assert.equal(e.ok, false, `${JSON.stringify(unfug)} kam durch`);
  }
});

pruefe('eine neuere Fassung wird abgelehnt, mit Begründung', () => {
  // Sonst würden Felder stillschweigend verschluckt, die dieses Programm nicht kennt.
  const e = pruefeSicherung({ fassung: SICHERUNG_FASSUNG + 1 });
  assert.equal(e.ok, false);
  assert.match((e as { grund: string }).grund, /neueren Fassung/);
});

pruefe('ein beschädigter Abschnitt wird benannt', () => {
  const e = pruefeSicherung({ fassung: 1, etiketten: 'kaputt' });
  assert.equal(e.ok, false);
  assert.match((e as { grund: string }).grund, /etiketten/);
});

pruefe('fehlende Abschnitte sind kein Fehler', () => {
  // Eine Sicherung ohne Regeln ist eine Sicherung ohne Regeln.
  const e = pruefeSicherung({ fassung: 1 });
  assert.equal(e.ok, true);
  const d = (e as { daten: { konten: unknown[]; regeln: object; hinweis: string } }).daten;
  assert.deepEqual(d.konten, []);
  assert.deepEqual(d.regeln, {});
  assert.equal(d.hinweis, HINWEIS);
});

console.log('\nZusammenführen statt Überschreiben:');

const etikett = (name: string, farbe = '#000') => ({ name, farbe });

pruefe('was schon da ist, bleibt unangetastet', () => {
  /*
   * Wer eine Sicherung einliest, hat auf diesem Rechner meist schon etwas eingerichtet.
   * Würde das überschrieben, wäre das Einlesen selbst der Datenverlust, den es
   * verhindern soll.
   */
  const hier = [etikett('Wichtig', '#rot')];
  const dort = [etikett('Wichtig', '#blau'), etikett('Steuern')];
  const { neue, schonDa } = nurNeue(hier.map((e) => e.name), dort, (e) => e.name);
  assert.equal(schonDa, 1);
  assert.deepEqual(
    neue.map((e) => e.name),
    ['Steuern'],
  );
  // Die eigene Farbe gewinnt - sie ist die juengere Entscheidung.
  assert.equal(hier[0]!.farbe, '#rot');
});

pruefe('Groß- und Kleinschreibung trennt nicht', () => {
  // "anna@gmx.de" und "Anna@GMX.de" sind dieselbe Adresse.
  const { neue, schonDa } = nurNeue(
    ['anna@gmx.de'],
    [{ address: 'Anna@GMX.de' }],
    (k) => k.address,
  );
  assert.equal(schonDa, 1);
  assert.equal(neue.length, 0);
});

pruefe('Doppeltes innerhalb der Sicherung selbst', () => {
  // Auch die Datei kann denselben Eintrag zweimal enthalten.
  const { neue } = nurNeue([], [etikett('Steuern'), etikett('Steuern')], (e) => e.name);
  assert.equal(neue.length, 1);
});

pruefe('Einträge ohne Kennung fallen weg', () => {
  // Sie liessen sich nicht unterscheiden und fielen sonst alle zusammen.
  const { neue } = nurNeue([], [etikett(''), etikett('  '.trim()), etikett('Gut')], (e) => e.name);
  assert.deepEqual(
    neue.map((e) => e.name),
    ['Gut'],
  );
});

pruefe('eine leere Sicherung ändert nichts', () => {
  const { neue, schonDa } = nurNeue(['Wichtig'], [], (e: { name: string }) => e.name);
  assert.equal(neue.length, 0);
  assert.equal(schonDa, 0);
});

console.log(`\n${ok} von ${gesamt} Pruefungen bestanden`);
if (ok !== gesamt) process.exit(1);
