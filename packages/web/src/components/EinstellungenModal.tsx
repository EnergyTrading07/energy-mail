import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { SPRACHWAHL } from '@energy-mail/mail-core/sprache';
import type { FolderInfo } from '@energy-mail/mail-core';
import type { Account, Identitaet } from '../api.js';
import type { Ansicht, Themawahl } from '../design/thema.js';
import { gewaehlteSprache, t, waehleSpracheUndLadeNeu } from '../sprache.js';
import { AlsTafel, Fenster } from './Fenster.js';
import { AccountSettingsModal } from './AccountSettingsModal.js';
import { RulesModal } from './RulesModal.js';
import { AbwesenheitModal } from './AbwesenheitModal.js';
import { SchluesselModal } from './SchluesselModal.js';
import { ZertifikatModal } from './ZertifikatModal.js';
import { ArchivModal } from './ArchivModal.js';
import { AblageModal } from './AblageModal.js';
import { VerwaltungModal } from './VerwaltungModal.js';
import { KontoModal } from './KontoModal.js';
import {
  Abwesend,
  Archivkasten,
  Bildschirm,
  Kontrast,
  Mond,
  Person,
  Personen,
  Schluessel,
  Siegel,
  Sonne,
  Speicher,
  Trichter,
  Umschlag,
} from './Symbole.js';

/**
 * Das Einstellungsfenster.
 *
 * ## Was hier vorher stand: nichts
 *
 * Es gab keinen Ort namens „Einstellungen". Was eine Einstellung ist, lag an vier
 * Stellen: in der Titelleiste (Ansicht, und die Sprache nur im Browserbetrieb), an einem
 * Zahnrad neben jedem Konto, als Wand aus elf gleich aussehenden Textknöpfen im Fuß der
 * Seitenleiste, und im Anwendungsmenü der Hülle (Sprache, Autostart, Infobereich,
 * Meldungsvorschau, Rechtschreibung). Wer eine Einstellung suchte, musste wissen, in
 * welcher dieser vier Welten sie wohnt - und in der Hülle stand sie woanders als im
 * Browser, obwohl es dieselbe Anwendung ist.
 *
 * Elf gleich lange Wörter untereinander sind keine Liste, sondern eine Wand. Man liest
 * sie jedes Mal von oben durch, weil nichts darin eine Ordnung behauptet: „Abwesenheit"
 * stand zwischen „Adressbuch" und „Schlüssel", „Abmelden" neben „Archiv".
 *
 * ## Was es jetzt ist
 *
 * Ein Fenster, links die Bereiche in vier benannten Gruppen, rechts der gewählte. Die
 * Gruppen sind die vier Fragen, die man an ein Mailprogramm hat: Wie sieht es aus? Wie
 * verhält sich mein Postfach? Wer kann mitlesen? Was bleibt liegen? Alles, was das
 * Programm selbst betrifft, kommt danach.
 *
 * ## Warum die Tafeln dieselben Bausteine sind wie vorher die Fenster
 *
 * Neun der Bereiche gab es schon - als eigene Fenster. Sie sind nicht nachgebaut,
 * sondern stehen hier als Tafel: `AlsTafel` sagt dem gemeinsamen Rahmen (Fenster.tsx),
 * dass er diesmal kein Fenster ist, und derselbe Baustein zeichnet sich als Abschnitt.
 * Der Gewinn ist nicht die eingesparte Zeile, sondern dass es weiterhin je eine Fassung
 * gibt: Wer am Archiv etwas ändert, ändert es an beiden Orten - denn es ist einer.
 */

export type Einstellungsbereich =
  | 'darstellung'
  | 'konten'
  | 'regeln'
  | 'abwesenheit'
  | 'schluessel'
  | 'zertifikate'
  | 'archiv'
  | 'bestand'
  | 'programm'
  | 'nutzer'
  | 'zugang';

interface Eintrag {
  bereich: Einstellungsbereich;
  name: string;
  zeichen: ComponentType<{ groesse?: number }>;
  /** Ein Wort neben dem Namen, wenn der Bereich etwas meldet - etwa „an". */
  vermerk?: string;
}

interface Gruppe {
  titel: string;
  eintraege: Eintrag[];
}

interface Props {
  /** Welcher Bereich offen ist. Liegt außerhalb, damit ein Menüpunkt gezielt öffnen kann. */
  bereich: Einstellungsbereich;
  onBereich: (bereich: Einstellungsbereich) => void;
  onClose: () => void;

  konten: Account[];
  /** Das gerade benutzte Konto - damit die Tafeln nicht beim ersten anfangen. */
  kontoId: string | null;
  ordnerJeKonto: Record<string, FolderInfo[]>;
  /**
   * Ein Absender, aus dem gleich eine Regel werden soll.
   *
   * Kommt aus dem Aufräumen: Dort steht "von diesem Absender liegen 340 Nachrichten",
   * und der nächste Griff ist immer derselbe. Ohne die Vorgabe müsste die Adresse von
   * Hand abgeschrieben werden - aus einem Fenster, das dafür geschlossen wurde.
   */
  regelVorgabe?: { von: string; name: string };

  // --- Darstellung ---
  themawahl: Themawahl;
  ansicht: Ansicht;
  onThemawahl: (wahl: Themawahl) => void;

  // --- Wer was darf ---
  darfVerwalten: boolean;
  /** Ob die Sitzung an einem Keks hängt - nur dann gibt es eine Anmeldung zu ändern. */
  abmeldbar: boolean;

  // --- Rückläufe in die Anwendung ---
  onKontoSpeichern: (
    kontoId: string,
    einstellungen: {
      displayName?: string;
      signature?: string;
      identitaeten?: Identitaet[];
      proxy?: string;
    },
  ) => Promise<void>;
  onGeaendert: () => void;
  onAbwesenheitGeaendert: () => void;
  onAbgemeldet?: () => void;
  /** Konten, deren Abwesenheitsnotiz gerade wirklich antwortet. */
  abwesenheitAktiv: string[];
}

/**
 * Eine Zeile mit Haken, Beschriftung und Begründung.
 *
 * Die Begründung ist der Grund für den eigenen Baustein. Ein Schalter ohne sie ist eine
 * Frage an den Nutzer, die er nicht beantworten kann - „Rechtschreibprüfung" sagt nicht,
 * dass dafür Wörterbücher von einem Server von Google geholt werden, und genau deshalb
 * gibt es den Schalter überhaupt.
 */
function Schalterzeile({
  an,
  onAn,
  titel,
  erklaerung,
  gesperrt,
}: {
  an: boolean;
  onAn: (an: boolean) => void;
  titel: string;
  erklaerung: ReactNode;
  gesperrt?: boolean;
}) {
  return (
    <label className={`schalterzeile${gesperrt ? ' gesperrt' : ''}`}>
      <input
        type="checkbox"
        checked={an}
        disabled={gesperrt}
        onChange={(e) => onAn(e.target.checked)}
      />
      <span className="schalterzeile-text">
        <strong>{titel}</strong>
        <span className="hint">{erklaerung}</span>
      </span>
    </label>
  );
}

/**
 * Die Ansicht: hell, dunkel oder wie das System.
 *
 * Drei Knöpfe nebeneinander und nicht der Umschalter aus der Titelleiste. Der konnte
 * nämlich nur zwischen hell und dunkel kippen - „folgt dem System" war die Vorgabe, und
 * wer einmal geklickt hatte, kam nie wieder dorthin zurück. Die Einstellung gab es also,
 * aber nur, solange man sie nicht anfasste.
 */
function Ansichtswahl({
  wahl,
  onWahl,
  ansicht,
}: {
  wahl: Themawahl;
  onWahl: (wahl: Themawahl) => void;
  ansicht: Ansicht;
}) {
  const wahlen: { wert: Themawahl; name: string; zeichen: ReactNode }[] = [
    {
      wert: 'system',
      name: t('Automatisch'),
      zeichen: ansicht === 'dunkel' ? <Mond groesse={15} /> : <Sonne groesse={15} />,
    },
    { wert: 'hell', name: t('Hell'), zeichen: <Sonne groesse={15} /> },
    { wert: 'dunkel', name: t('Dunkel'), zeichen: <Mond groesse={15} /> },
  ];

  return (
    <div className="wahlreihe" role="radiogroup" aria-label={t('Ansicht')}>
      {wahlen.map((w) => (
        <button
          key={w.wert}
          type="button"
          role="radio"
          aria-checked={wahl === w.wert}
          className={`wahlreihe-knopf${wahl === w.wert ? ' gewaehlt' : ''}`}
          onClick={() => onWahl(w.wert)}
        >
          {w.zeichen}
          <span>{w.name}</span>
        </button>
      ))}
    </div>
  );
}

/** Ansicht und Sprache - die beiden Einstellungen, die überall gelten. */
function DarstellungTafel({
  wahl,
  ansicht,
  onWahl,
  sprache,
  spracheVorgegeben,
}: {
  wahl: Themawahl;
  ansicht: Ansicht;
  onWahl: (wahl: Themawahl) => void;
  sprache: string;
  spracheVorgegeben: boolean;
}) {
  return (
    <section className="modal eingebettet">
      <h3>{t('Ansicht und Sprache')}</h3>

      <div className="form-row">
        <span className="feld-titel">{t('Ansicht')}</span>
        <Ansichtswahl wahl={wahl} onWahl={onWahl} ansicht={ansicht} />
        <p className="hint">
          {wahl === 'system'
            ? t(
                'Folgt der Einstellung des Betriebssystems – dort schaltet die Nachtansicht bei vielen zeitgesteuert um, und ein Mailprogramm, das dann als einzige helle Fläche stehen bliebe, wäre der Ausreißer.',
              )
            : t('Bleibt so, gleich was das Betriebssystem gerade vorgibt.')}
        </p>
      </div>

      <div className="form-row">
        <label htmlFor="einstellungen-sprache">{t('Sprache der Oberfläche')}</label>
        <select
          id="einstellungen-sprache"
          value={sprache}
          disabled={spracheVorgegeben}
          onChange={(e) => void waehleSpracheUndLadeNeu(e.target.value)}
        >
          {SPRACHWAHL.map((s) => (
            <option key={s.wert} value={s.wert}>
              {s.name}
            </option>
          ))}
        </select>
        <p className="hint">
          {spracheVorgegeben
            ? t(
                'Ihre Organisation gibt die Sprache vor. Die Wahl steht hier trotzdem – wer sie sucht und gar nichts findet, hält es für ein fehlendes Merkmal statt für eine Entscheidung seines Hauses.',
              )
            : t(
                'Automatisch nimmt die Sprache des Betriebssystems. Nach dem Umstellen lädt die Oberfläche einmal neu.',
              )}
        </p>
      </div>
    </section>
  );
}

/**
 * Die Schalter der Hülle - nur dort, wo es eine Hülle gibt.
 *
 * Der Stand kommt vom Hauptprozess und wird nicht hier gehalten: Er steht in huelle.json,
 * das Anwendungsmenü führt zwei dieser Schalter ebenfalls, und zwei Wahrheiten über
 * denselben Wert laufen auseinander. Jede Änderung geht deshalb hinüber und kommt als
 * neuer Stand zurück.
 */
function ProgrammTafel() {
  const bruecke = window.energyMail;
  const [stand, setStand] = useState<HuellenStand | null>(null);

  useEffect(() => {
    if (!bruecke) return;
    void bruecke.huelle().then(setStand).catch(() => undefined);
  }, [bruecke]);

  const setze = (name: HuellenSchalter, wert: boolean) => {
    if (!bruecke) return;
    // Sofort umlegen, damit der Haken der Maus folgt; die Antwort setzt gleich den
    // wirklichen Stand - falls der Hauptprozess abgewiesen hat, springt er zurück.
    setStand((v) => (v ? { ...v, [name]: wert } : v));
    void bruecke.setzeHuelle(name, wert).then(setStand).catch(() => undefined);
  };

  return (
    <section className="modal eingebettet">
      <h3>{t('Anwendung')}</h3>
      {!stand ? (
        <p className="hint">{t('Wird geladen …')}</p>
      ) : (
        <div className="schalterliste">
          <Schalterzeile
            an={stand.imInfobereich}
            onAn={(v) => setze('imInfobereich', v)}
            titel={t('Beim Schließen im Infobereich weiterlaufen')}
            erklaerung={t(
              'Sonst hören mit dem Fenster auch die Benachrichtigungen auf – und damit der Zweck der Dauerverbindung.',
            )}
          />
          <Schalterzeile
            an={stand.mitWindowsStarten}
            onAn={(v) => setze('mitWindowsStarten', v)}
            titel={t('Mit dem Betriebssystem starten')}
            erklaerung={t('Meldet die Anwendung beim Anmelden von selbst an.')}
          />
          <Schalterzeile
            an={stand.meldungsvorschau}
            onAn={(v) => setze('meldungsvorschau', v)}
            titel={t('Absender und Betreff in Meldungen zeigen')}
            erklaerung={t(
              'Eine Meldung erscheint über allem, was gerade auf dem Bildschirm ist – im Vortrag, in der Bildschirmübertragung, auf dem Sperrbildschirm. Wer daneben steht, liest mit.',
            )}
          />
          <Schalterzeile
            an={stand.rechtschreibung}
            onAn={(v) => setze('rechtschreibung', v)}
            titel={t('Rechtschreibung prüfen')}
            erklaerung={t(
              'Die Prüfung ist die des Browserkerns, und er holt fehlende Wörterbücher von einem Server von Google. Geschriebener Text geht dabei nicht hinaus – ein Abruf ist es trotzdem.',
            )}
          />
        </div>
      )}
    </section>
  );
}

/** Ein Konto aussuchen, wenn es mehrere gibt - sonst steht die Tafel gleich da. */
function Kontowahl({
  konten,
  gewaehlt,
  onWahl,
}: {
  konten: Account[];
  gewaehlt: string;
  onWahl: (id: string) => void;
}) {
  if (konten.length < 2) return null;
  return (
    <div className="tafel-kontowahl">
      <label htmlFor="tafel-konto">{t('Postfach')}</label>
      <select id="tafel-konto" value={gewaehlt} onChange={(e) => onWahl(e.target.value)}>
        {konten.map((k) => (
          <option key={k.id} value={k.id}>
            {k.displayName ? `${k.displayName} · ${k.email}` : k.email}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EinstellungenModal({
  bereich,
  onBereich,
  onClose,
  konten,
  kontoId,
  ordnerJeKonto,
  regelVorgabe,
  themawahl,
  ansicht,
  onThemawahl,
  darfVerwalten,
  abmeldbar,
  onKontoSpeichern,
  onGeaendert,
  onAbwesenheitGeaendert,
  onAbgemeldet,
  abwesenheitAktiv,
}: Props) {
  const bruecke = window.energyMail;

  /*
   * Das Konto der kontobezogenen Tafeln.
   *
   * Eigener Zustand und nicht das der Anwendung: Wer im Einstellungsfenster die Regeln
   * eines anderen Postfachs ansieht, will nicht, dass darunter die Nachrichtenliste
   * wechselt. Es beginnt beim gerade benutzten - das ist in neun von zehn Fällen das
   * gemeinte.
   */
  const [tafelKonto, setTafelKonto] = useState<string>(
    () => kontoId ?? konten[0]?.id ?? '',
  );
  const konto = konten.find((k) => k.id === tafelKonto) ?? konten[0] ?? null;

  /*
   * Die Sprache steht in der Hülle woanders als im Browser.
   *
   * In der Hülle in huelle.json - das Anwendungsmenü und die Meldungen von Windows
   * brauchen sie, bevor eine Oberfläche geladen ist. Im Browser im Browserspeicher.
   * Beides derselbe Wert für den Nutzer, zwei Quellen für das Programm.
   */
  const [sprachstand, setSprachstand] = useState<{ wert: string; vorgegeben: boolean }>(
    () => ({ wert: bruecke ? 'automatisch' : gewaehlteSprache(), vorgegeben: false }),
  );
  useEffect(() => {
    if (!bruecke) return;
    void bruecke
      .huelle()
      .then((h) => setSprachstand({ wert: h.sprache, vorgegeben: h.spracheVorgegeben }))
      .catch(() => undefined);
  }, [bruecke]);

  /*
   * `satisfies` und nicht bloß eine Angabe des Typs.
   *
   * In den drei Gruppen stehen bedingte Einträge (`...(darfVerwalten ? [...] : [])`).
   * Ohne diese Zeile leitet TypeScript aus ihnen `string` ab statt der Aufzählung, und
   * ein Tippfehler im Bereichsnamen fiele erst beim Anklicken auf - dann steht die
   * rechte Seite leer da.
   */
  const gruppen: Gruppe[] = ([
    {
      titel: t('Darstellung'),
      eintraege: [
        { bereich: 'darstellung', name: t('Ansicht und Sprache'), zeichen: Kontrast },
      ],
    },
    {
      titel: t('Postfach'),
      eintraege: [
        { bereich: 'konten', name: t('Konten'), zeichen: Umschlag },
        { bereich: 'regeln', name: t('Regeln'), zeichen: Trichter },
        {
          bereich: 'abwesenheit',
          name: t('Abwesenheit'),
          zeichen: Abwesend,
          // Der eine Zustand dieses Programms, den man vergisst und der dann monatelang
          // Fremden erzählt, man sei im Urlaub. Er trägt seinen Vermerk in der Leiste.
          vermerk: abwesenheitAktiv.length > 0 ? t('an') : undefined,
        },
      ],
    },
    {
      titel: t('Sicherheit'),
      eintraege: [
        { bereich: 'schluessel', name: t('OpenPGP-Schlüssel'), zeichen: Schluessel },
        { bereich: 'zertifikate', name: t('S/MIME-Zertifikate'), zeichen: Siegel },
      ],
    },
    {
      titel: t('Aufbewahrung'),
      eintraege: [
        { bereich: 'archiv', name: t('Archiv'), zeichen: Archivkasten },
        { bereich: 'bestand', name: t('Bestand'), zeichen: Speicher },
      ],
    },
    {
      titel: t('Programm'),
      eintraege: [
        // Nur in der Hülle: im Browser gibt es kein Fenster, das im Infobereich bliebe,
        // und keinen Autostart.
        ...(bruecke
          ? [{ bereich: 'programm' as const, name: t('Anwendung'), zeichen: Bildschirm }]
          : []),
        // Nur für Verwalter - und das ist Höflichkeit, kein Schutz: Der Riegel steht in
        // nutzer/verwaltung.ts, hier steht nur, wem ein Weg etwas nützt.
        ...(darfVerwalten
          ? [{ bereich: 'nutzer' as const, name: t('Nutzer'), zeichen: Personen }]
          : []),
        // Nur wo es eine Anmeldung gibt: In der Hülle weist sich das Fenster über das
        // Zugangsgeheimnis des Prozesses aus, dort gibt es kein Kennwort zu ändern.
        ...(abmeldbar
          ? [{ bereich: 'zugang' as const, name: t('Anmeldung'), zeichen: Person }]
          : []),
      ],
    },
  ] satisfies Gruppe[]).filter((g) => g.eintraege.length > 0);

  /*
   * Ein Bereich, den es nicht (mehr) gibt, fällt auf den ersten zurück.
   *
   * Möglich ist das mehr als nur theoretisch: „Nutzer" verschwindet, sobald einem das
   * Verwalterrecht entzogen wird, und „Konten" steht leer da, solange kein Postfach
   * eingerichtet ist. Ohne diesen Rückfall bliebe die rechte Seite dann leer, und das
   * sieht wie ein Fehler aus.
   */
  const alleBereiche = gruppen.flatMap((g) => g.eintraege.map((e) => e.bereich));
  const offen = alleBereiche.includes(bereich) ? bereich : alleBereiche[0]!;

  const tafel = (): ReactNode => {
    switch (offen) {
      case 'darstellung':
        return (
          <DarstellungTafel
            wahl={themawahl}
            ansicht={ansicht}
            onWahl={onThemawahl}
            sprache={sprachstand.wert}
            spracheVorgegeben={sprachstand.vorgegeben}
          />
        );

      case 'konten':
        if (!konto) {
          return (
            <section className="modal eingebettet">
              <h3>{t('Konten')}</h3>
              <p className="hint">
                {t('Noch kein Postfach eingerichtet – es kommt über die Seitenleiste hinzu.')}
              </p>
            </section>
          );
        }
        return (
          <>
            <Kontowahl konten={konten} gewaehlt={konto.id} onWahl={setTafelKonto} />
            <AccountSettingsModal
              key={konto.id}
              account={konto}
              onClose={onClose}
              onSave={(werte) => onKontoSpeichern(konto.id, werte)}
            />
          </>
        );

      case 'regeln':
        if (!konto) return null;
        return (
          <>
            <Kontowahl konten={konten} gewaehlt={konto.id} onWahl={setTafelKonto} />
            <RulesModal
              key={konto.id}
              account={konto}
              folders={ordnerJeKonto[konto.id] ?? []}
              vorgabe={regelVorgabe}
              onClose={onClose}
              onGeaendert={onGeaendert}
            />
          </>
        );

      case 'abwesenheit':
        return (
          <AbwesenheitModal
            konten={konten}
            startKonto={konto?.id}
            onClose={onClose}
            onGeaendert={onAbwesenheitGeaendert}
          />
        );

      case 'schluessel':
        return <SchluesselModal accounts={konten} onClose={onClose} />;

      case 'zertifikate':
        return <ZertifikatModal accounts={konten} onClose={onClose} />;

      case 'archiv':
        return <ArchivModal accounts={konten} onClose={onClose} />;

      case 'bestand':
        return <AblageModal onClose={onClose} />;

      case 'programm':
        return <ProgrammTafel />;

      case 'nutzer':
        return <VerwaltungModal onClose={onClose} />;

      case 'zugang':
        return <KontoModal onClose={onClose} onAbgemeldet={onAbgemeldet ?? onClose} />;
    }
  };

  return (
    <Fenster titel={t('Einstellungen')} onClose={onClose} klasse="einstellungen">
      <div className="einstellungen-raster">
        <nav className="einstellungen-leiste" aria-label={t('Bereiche der Einstellungen')}>
          {gruppen.map((gruppe) => (
            <div key={gruppe.titel} className="einstellungen-gruppe">
              <div className="einstellungen-gruppentitel">{gruppe.titel}</div>
              {gruppe.eintraege.map((eintrag) => {
                const Zeichen = eintrag.zeichen;
                return (
                  <button
                    key={eintrag.bereich}
                    type="button"
                    className={`einstellungen-eintrag${offen === eintrag.bereich ? ' aktiv' : ''}`}
                    aria-current={offen === eintrag.bereich ? 'true' : undefined}
                    onClick={() => onBereich(eintrag.bereich)}
                  >
                    <Zeichen groesse={15} />
                    <span>{eintrag.name}</span>
                    {eintrag.vermerk && (
                      <span className="einstellungen-vermerk">{eintrag.vermerk}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/*
          Der Schlüssel für die rechte Seite ist der Bereich.

          Ohne ihn behielte React beim Wechsel die Zustände des vorigen Bausteins, wo
          Form und Reihenfolge zufällig passen - ein halb ausgefülltes Feld aus den
          Regeln stünde dann in den Zertifikaten. Und: Die Tafel beginnt oben, statt die
          Bildlaufhöhe der vorigen zu erben.
        */}
        <div className="einstellungen-tafel" key={offen}>
          <AlsTafel>{tafel()}</AlsTafel>
        </div>
      </div>
    </Fenster>
  );
}
