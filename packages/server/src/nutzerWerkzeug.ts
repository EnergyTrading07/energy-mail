import crypto from 'node:crypto';
import fs from 'node:fs';
import { setDataDir, getNutzerDirFuer, getWurzelDir } from './paths.js';
import { masterSchluesselAusDatei } from './nutzer/einrichten.js';
import { verpackeNutzerschluessel, wechsleNutzerschluessel } from './nutzer/schluesselHuelle.js';
import {
  NutzerFehler,
  alleNutzer,
  entferneNutzer,
  entferneZweiFaktor,
  findeNutzer,
  findeNutzerNachEmail,
  hatZweiFaktor,
  istGesperrt,
  legeNutzerAn,
  setzeKennwort,
  setzeSperre,
  setzeRolle,
  istVerwalter,
  stelleVerwalterSicher,
} from './nutzer/nutzerStore.js';
import { beendeAlleSitzungen, vergissSitzungen } from './nutzer/sitzung.js';
import { entferneNutzerdaten } from './nutzer/umzug.js';
import { freigabenZuNutzer } from './nutzer/freigaben.js';
import { EINPLATZ_NUTZER } from './nutzer/kontext.js';

/**
 * Nutzerverwaltung von der Befehlszeile.
 *
 * Warum kein Weg im Server: Selbstanmeldung hieße, dass sich jeder aus dem Netz ein
 * Postfach auf fremder Hardware anlegen kann - in der Testphase im Bekanntenkreis genau
 * das Falsche. Und ein Verwaltungsweg im Server bräuchte einen Verwalterbegriff, eine
 * zweite Rechteebene und deren Prüfungen. Beides ist verfrüht.
 *
 * Ein Werkzeug, das auf dem Server läuft, hat dagegen die einzige Berechtigung, auf die
 * es ankommt: wer es aufrufen kann, sitzt ohnehin schon am Rechner.
 *
 *   docker compose exec dienst node dist/nutzerWerkzeug.js liste
 *   docker compose exec dienst node dist/nutzerWerkzeug.js anlegen anna@beispiel.de
 *
 * Der Masterschlüssel wird gebraucht: ein Nutzer entsteht mit seinem Schlüssel, und der
 * liegt verpackt (siehe nutzer/schluesselHuelle.ts).
 */

function datenordner(): void {
  const ordner = process.env.ENERGY_MAIL_DATEN?.trim();
  if (ordner) {
    fs.mkdirSync(ordner, { recursive: true, mode: 0o700 });
    setDataDir(ordner);
  }
}

/**
 * Ein Kennwort, das niemand sich ausdenken musste.
 *
 * Vier Wörter aus einer Liste wären für Menschen angenehmer, aber die Liste müsste
 * mitgeliefert und gepflegt werden. 18 Zeichen aus einem Alphabet ohne die Zeichen, die
 * sich beim Abschreiben verwechseln lassen (0/O, 1/l/I), sind der Tausch, der hier passt:
 * Das Kennwort wird einmal weitergegeben und danach vom Nutzer geändert.
 */
function erzeugeKennwort(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(18);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function sucheNutzer(wen: string) {
  return findeNutzerNachEmail(wen) ?? findeNutzer(wen);
}

function liste(): void {
  const nutzer = alleNutzer();
  if (nutzer.length === 0) {
    console.log('Noch kein Nutzer angelegt.');
    return;
  }
  const breite = Math.max(...nutzer.map((n) => n.id.length), 8);
  console.log(`${'Kennung'.padEnd(breite)}  ${'Adresse'.padEnd(32)}  Angelegt`);
  for (const n of nutzer) {
    const zusatz =
      (n.verwalter ? '  [Verwalter]' : '') +
      (hatZweiFaktor(n.id) ? '  [2FA]' : '') +
      (istGesperrt(n.id) ? '  [gesperrt]' : '');
    console.log(
      `${n.id.padEnd(breite)}  ${n.email.padEnd(32)}  ${n.angelegt.slice(0, 10)}${zusatz}`,
    );
  }
  console.log(`\n${nutzer.length} Nutzer.`);
}

function anlegen(email: string, kennwort?: string): void {
  const vergeben = kennwort ?? erzeugeKennwort();
  const nutzer = legeNutzerAn({ email, kennwort: vergeben }, verpackeNutzerschluessel);
  /*
   * Der erste richtige Nutzer wird Verwalter.
   *
   * Sonst gäbe es niemanden, der die Verwaltung im Browser öffnen könnte - und der erste
   * Nutzer ist derjenige, der gerade den Dienst aufsetzt. Der Pseudo-Nutzer der Hülle
   * bleibt ausgenommen; an sein Kennwort kommt niemand.
   */
  stelleVerwalterSicher(EINPLATZ_NUTZER);
  console.log(`Angelegt: ${nutzer.email} (Kennung ${nutzer.id})`);
  if (istVerwalter(nutzer.id)) {
    console.log('Dieser Nutzer ist Verwalter - er darf im Browser Nutzer anlegen.');
  }
  if (!kennwort) {
    console.log(`Kennwort: ${vergeben}`);
    console.log(
      '\nDieses Kennwort steht nirgends sonst - es lässt sich nicht noch einmal anzeigen.\n' +
        'Weitergeben, und den Nutzer bitten, es nach der ersten Anmeldung zu ändern.',
    );
  }
}

function kennwortSetzen(wen: string, kennwort?: string): void {
  const nutzer = sucheNutzer(wen);
  if (!nutzer) throw new NutzerFehler(`"${wen}" ist hier niemand.`);
  const vergeben = kennwort ?? erzeugeKennwort();
  setzeKennwort(nutzer.id, vergeben);

  /*
   * Überall abmelden - sonst wäre das neue Kennwort wirkungslos.
   *
   * Ein Kennwort wird meist dann von Hand gesetzt, wenn der Verdacht besteht, dass es
   * jemand kennt. Eine offene Sitzung überlebte den Wechsel und liefe weiter.
   */
  vergissSitzungen();
  const beendet = beendeAlleSitzungen(nutzer.id);
  console.log(`Kennwort von ${nutzer.email} gesetzt, ${beendet} Sitzung(en) beendet.`);
  if (!kennwort) console.log(`Kennwort: ${vergeben}`);
}

function sperren(wen: string, gesperrt: boolean): void {
  const nutzer = sucheNutzer(wen);
  if (!nutzer) throw new NutzerFehler(`"${wen}" ist hier niemand.`);
  setzeSperre(nutzer.id, gesperrt);
  if (gesperrt) {
    vergissSitzungen();
    const beendet = beendeAlleSitzungen(nutzer.id);
    console.log(`${nutzer.email} gesperrt, ${beendet} Sitzung(en) beendet.`);
  } else {
    console.log(`${nutzer.email} wieder freigegeben.`);
  }
}

/**
 * Verwalterrolle geben oder nehmen.
 *
 * Der Weg zurueck, wenn im Browser niemand mehr hereinkommt: Wer auf dem Server sitzt,
 * kann sich hier jederzeit selbst wieder Rechte verschaffen. Deshalb bleibt dieses
 * Werkzeug bestehen, auch wenn es die Verwaltung im Browser gibt.
 */
function rolleSetzen(wen: string, verwalter: boolean): void {
  const nutzer = sucheNutzer(wen);
  if (!nutzer) throw new NutzerFehler(`"${wen}" ist hier niemand.`);
  setzeRolle(nutzer.id, verwalter);
  console.log(
    verwalter
      ? `${nutzer.email} ist jetzt Verwalter.`
      : `${nutzer.email} ist kein Verwalter mehr.`,
  );
}

/**
 * Den zweiten Faktor abraeumen.
 *
 * Der letzte Ausweg, und er wird gebraucht: Wenn der einzige Verwalter sein Telefon
 * verliert und seine Wiederherstellungscodes nicht findet, kommt niemand mehr in die
 * Verwaltung - dort ist der Knopf dafuer ja. Von hier aus geht es immer, denn wer auf dem
 * Server sitzt, hat ohnehin den Masterschluessel.
 *
 * Genau deshalb steht es auch so in BETRIEB.md: Der zweite Faktor schuetzt gegen ein
 * abhandengekommenes Kennwort, nicht gegen den Betreiber des Servers.
 */
function zweiFaktorAbraeumen(wen: string): void {
  const nutzer = sucheNutzer(wen);
  if (!nutzer) throw new NutzerFehler(`"${wen}" ist hier niemand.`);
  if (!entferneZweiFaktor(nutzer.id)) {
    console.log(`Fuer ${nutzer.email} war kein zweiter Faktor eingerichtet.`);
    return;
  }
  console.log(
    `Der zweite Faktor von ${nutzer.email} ist entfernt.\n` +
      'Die naechste Anmeldung geht wieder mit dem Kennwort allein - und sollte gleich\n' +
      'damit beginnen, einen neuen einzurichten.',
  );
}

/**
 * Den Schluessel eines Nutzers wechseln.
 *
 * Gebraucht, wenn der Verdacht besteht, dass er abhandengekommen ist - etwa nach einer
 * abgegriffenen Sicherung. Bis hierher gab es dafuer keinen Weg: Die Struktur mit den
 * Generationen war vorhanden, der Vorgang nicht.
 *
 * Die Meldung sagt ausdruecklich, was der Wechsel NICHT tut. Alles andere waere ein
 * falsches Versprechen: Wer glaubt, nach diesem Befehl seien die alten Geheimnisse
 * unlesbar, verlaesst sich auf etwas, das nicht eingetreten ist.
 */
function schluesselWechseln(wen: string): void {
  const nutzer = sucheNutzer(wen);
  if (!nutzer) throw new NutzerFehler(`"${wen}" ist hier niemand.`);

  const { generation } = wechsleNutzerschluessel(nutzer.id);
  console.log(
    [
      `Neuer Schluessel fuer ${nutzer.email} - Generation ${generation}.`,
      '',
      'Ab sofort wird alles Neue damit verschluesselt. Die bisherigen Geheimnisse',
      '(Postfachkennwoerter, Marken, PGP-Schluessel) bleiben mit ihrer alten Generation',
      'lesbar und wandern mit, sobald sie ohnehin neu geschrieben werden - beim naechsten',
      'Speichern des Kontos etwa.',
      '',
      'Der alte Schluessel steht deshalb weiterhin im Eintrag. Soll er wirklich weg,',
      'muessen die betroffenen Zugangsdaten einmal neu eingetragen werden; erst dann',
      'zeigt nichts mehr auf ihn.',
    ].join('\n'),
  );
}

function entfernen(wen: string, mitDaten: boolean): void {
  const nutzer = sucheNutzer(wen);
  if (!nutzer) throw new NutzerFehler(`"${wen}" ist hier niemand.`);

  vergissSitzungen();
  beendeAlleSitzungen(nutzer.id);
  // Auch seine Freigaben - in beide Richtungen. Siehe nutzer/freigaben.ts.
  freigabenZuNutzer(nutzer.id);
  entferneNutzer(nutzer.id);

  const ordner = getNutzerDirFuer(nutzer.id);
  if (mitDaten) {
    entferneNutzerdaten(nutzer.id);
    console.log(`${nutzer.email} entfernt, Ordner gelöscht.`);
  } else {
    /*
     * Der Ordner bleibt liegen, und das ist kein Versehen.
     *
     * Mit dem Eintrag ist der Schlüssel des Nutzers weg; was in seinem Ordner steht, ist
     * damit ohnehin nicht mehr zu öffnen - auch nicht aus einer Sicherung. Die Dateien
     * ungefragt zu löschen wäre der unumkehrbare Teil, und den soll ausdrücklich
     * verlangen, wer ihn will.
     */
    console.log(
      `${nutzer.email} entfernt. Seine Geheimnisse sind ab sofort unlesbar - der ` +
        `Schlüssel dazu stand nur im Eintrag.\nDer Ordner liegt noch da:\n  ${ordner}\n` +
        'Mit "--mit-daten" wird er gleich mitgelöscht.',
    );
  }
}

function hilfe(): void {
  console.log(`Energy Mail - Nutzerverwaltung

  liste                                 wer hier ein Postfach hat
  anlegen <adresse> [kennwort]          neuen Nutzer anlegen (ohne Angabe wird eins erzeugt)
  kennwort <adresse|kennung> [kennwort] Kennwort neu setzen, meldet überall ab
  sperren <adresse|kennung>             kommt nicht mehr herein, Daten bleiben
  freigeben <adresse|kennung>           Sperre aufheben
  verwalter <adresse|kennung>           darf im Browser Nutzer verwalten
  entmachten <adresse|kennung>          Verwalterrolle nehmen (nie beim letzten)
  zweifaktor-aus <adresse|kennung>      zweiten Faktor entfernen (verlorenes Telefon)
  schluessel-wechseln <adresse|kennung> neuen Nutzerschluessel anlegen (Altes bleibt lesbar)
  entfernen <adresse|kennung> [--mit-daten]
                                        endgültig: mit dem Eintrag geht sein Schlüssel

Der Datenordner kommt aus ENERGY_MAIL_DATEN, der Masterschlüssel aus
ENERGY_MAIL_MASTER_KEY_FILE (sonst master.key im Datenordner).`);
}

function haupt(): void {
  const [befehl, ...rest] = process.argv.slice(2);

  if (!befehl || befehl === 'hilfe' || befehl === '--help' || befehl === '-h') {
    hilfe();
    return;
  }

  datenordner();
  masterSchluesselAusDatei();

  const argumente = rest.filter((a) => !a.startsWith('--'));
  const schalter = new Set(rest.filter((a) => a.startsWith('--')));

  switch (befehl) {
    case 'liste':
      liste();
      break;
    case 'anlegen':
      if (!argumente[0]) throw new NutzerFehler('Welche Adresse?');
      anlegen(argumente[0], argumente[1]);
      break;
    case 'kennwort':
      if (!argumente[0]) throw new NutzerFehler('Für wen?');
      kennwortSetzen(argumente[0], argumente[1]);
      break;
    case 'sperren':
      if (!argumente[0]) throw new NutzerFehler('Wen?');
      sperren(argumente[0], true);
      break;
    case 'freigeben':
      if (!argumente[0]) throw new NutzerFehler('Wen?');
      sperren(argumente[0], false);
      break;
    case 'verwalter':
      if (!argumente[0]) throw new NutzerFehler('Wen?');
      rolleSetzen(argumente[0], true);
      break;
    case 'entmachten':
      if (!argumente[0]) throw new NutzerFehler('Wen?');
      rolleSetzen(argumente[0], false);
      break;
    case 'zweifaktor-aus':
      if (!argumente[0]) throw new NutzerFehler('Wen?');
      zweiFaktorAbraeumen(argumente[0]);
      break;
    case 'schluessel-wechseln':
      if (!argumente[0]) throw new NutzerFehler('Wessen Schluessel?');
      schluesselWechseln(argumente[0]);
      break;
    case 'entfernen':
      if (!argumente[0]) throw new NutzerFehler('Wen?');
      entfernen(argumente[0], schalter.has('--mit-daten'));
      break;
    default:
      console.error(`Unbekannt: ${befehl}\n`);
      hilfe();
      process.exit(1);
  }
}

try {
  haupt();
} catch (err) {
  /*
   * Eine erwartbare Meldung ("Adresse schon vergeben") ohne Stapelspur - dahinter steckt
   * kein Fehler im Programm, sondern eine Eingabe, die so nicht geht. Alles andere mit,
   * denn dann will man wissen, wo es geknallt hat.
   */
  if (err instanceof NutzerFehler) {
    console.error(`Geht nicht: ${err.message}`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

// Damit sichtbar ist, worauf gearbeitet wurde - bei einem Werkzeug, das Daten anfasst,
// die wichtigste Zeile, wenn hinterher etwas nicht stimmt.
if (process.env.ENERGY_MAIL_LEISE !== '1') {
  console.error(`\n(Datenordner: ${getWurzelDir()})`);
}
