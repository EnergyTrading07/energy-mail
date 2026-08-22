import { SPRACHWAHL } from '@energy-mail/mail-core/sprache';
import { Marke } from './Symbole.js';
import { gewaehlteSprache, t, waehleSpracheUndLadeNeu } from '../sprache.js';

/**
 * Die Bausteine, die sich alle Ansichten vor der Anmeldung teilen.
 *
 * Anmelden, Konto anlegen, Kennwort vergessen und die Bestätigung eines Links sind vier
 * Ansichten derselben Karte. Vorher stand das Wortzeichen in jeder von ihnen einzeln - bei
 * vieren ist das die Stelle, an der eines Tages drei gleich aussehen und das vierte nicht.
 *
 * Zusammengefasst ist deshalb nur, was tatsächlich identisch ist. Die Karte selbst bleibt
 * bei den Ansichten: Drei davon sind ein `<form>` mit eigenem `onSubmit`, eine ist es
 * nicht, und eine Hülle, die beides kann, wäre umständlicher als die zwei Zeilen, die sie
 * spart.
 */

/** Das Wortzeichen über jeder Zugangskarte. */
export function Zugangsmarke() {
  return (
    <div className="anmeldung-marke">
      <Marke groesse={40} />
      {/* Dasselbe Wortzeichen wie in der Titelleiste - siehe .marke-wort. */}
      <h1>
        Energy <span>Mail</span>
      </h1>
    </div>
  );
}

/**
 * Der Umschalter zwischen Anmelden und Konto anlegen.
 *
 * ## Warum ein Umschalter und nicht der Link von vorher
 *
 * Weil beides gleichrangig ist, sobald sich Menschen selbst anmelden dürfen. Ein Link
 * unter der Fußnote sagt: „hier gibt es noch etwas, aber eigentlich sind Sie hier
 * falsch." Für jemanden, der zum ersten Mal vor diesem Fenster sitzt, ist das Anlegen
 * aber der Regelfall und nicht die Ausnahme - er hat ja noch kein Konto.
 *
 * Der Umschalter erscheint nur, wo es tatsächlich zwei Wege gibt: Steht die
 * Selbstanmeldung auf „aus", ist er weg, und die Karte sieht aus wie zuvor. Eine Leiste
 * mit einem einzigen Reiter wäre eine Frage ohne Antwortmöglichkeit.
 */
export function Zugangsumschalter({
  aktiv,
  onWechsel,
}: {
  aktiv: 'anmelden' | 'registrieren';
  onWechsel: (wohin: 'anmelden' | 'registrieren') => void;
}) {
  return (
    <div className="zugang-umschalter" role="tablist" aria-label={t('Anmelden oder Konto anlegen')}>
      {(['anmelden', 'registrieren'] as const).map((wohin) => (
        <button
          key={wohin}
          type="button"
          role="tab"
          /*
           * aria-selected und nicht nur eine Klasse: Eine Vorlesesoftware nennt damit von
           * selbst, welcher der beiden Wege gerade offensteht. Ohne das hört jemand zwei
           * Knöpfe und weiß nicht, auf welchem er steht.
           */
          aria-selected={aktiv === wohin}
          className={aktiv === wohin ? 'zugang-reiter aktiv' : 'zugang-reiter'}
          onClick={() => onWechsel(wohin)}
        >
          {wohin === 'anmelden' ? t('Anmelden') : t('Konto anlegen')}
        </button>
      ))}
    </div>
  );
}

/**
 * Die Sprachwahl am Fuß der Zugangskarte.
 *
 * ## Warum sie hierhin gehört und nicht nur in die Einstellungen
 *
 * Weil die Einstellungen hinter der Anmeldung liegen. Wer vor einem Fenster sitzt, dessen
 * Sprache er nicht liest, kommt genau deshalb nicht an die Stelle, an der er sie umstellen
 * könnte. Das trifft niemanden, der hier ein Konto hat und den Weg kennt - es trifft den
 * neuen Kollegen am ersten Tag, und der ist der Einzige, der wirklich darauf angewiesen
 * ist.
 *
 * Die Namen stehen unübersetzt da („Français", nicht „Französisch"), aus demselben Grund:
 * Wer seine Sprache sucht, erkennt sie in ihrer eigenen Schreibweise.
 *
 * ## Was dabei gespeichert wird
 *
 * Ein Eintrag im Browserspeicher, mehr nicht - keine Kennung, kein Serverbezug, nichts,
 * was jemanden wiedererkennbar macht. Er hält eine Einstellung fest, die der Mensch selbst
 * gerade verlangt hat, und ist damit genau das, was § 25 Abs. 2 TDDDG ohne Einwilligung
 * erlaubt. Eine Abfrage davor wäre eine Rückfrage zu einer Rückfrage.
 *
 * Die Wahl geht bewusst NICHT an den Server: Sie gehört zum Gerät und nicht zum Postfach.
 * Und vor der Anmeldung gibt es ohnehin kein Postfach, an dem sie hängen könnte.
 */
export function Sprachwahl() {
  return (
    <div className="zugang-sprache">
      {/*
        Ohne sichtbare Beschriftung - der Weltkugel-Umriss und die Sprachnamen sagen es -,
        aber mit einer für die Vorlesesoftware. Ein Auswahlfeld ohne Namen wird als
        "Kombinationsfeld" angesagt und sonst nichts.
      */}
      <label htmlFor="zugang-sprache" className="nur-vorlesen">
        {t('Sprache der Oberfläche')}
      </label>
      <Weltkugel />
      <select
        id="zugang-sprache"
        value={gewaehlteSprache()}
        onChange={(e) => void waehleSpracheUndLadeNeu(e.target.value)}
      >
        {SPRACHWAHL.map((s) => (
          <option key={s.wert} value={s.wert}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Ein Globus in der Strichstärke der übrigen Symbole - siehe Symbole.tsx. */
function Weltkugel() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.7 3.7 5.8 3.7 9s-1.2 6.3-3.7 9c-2.5-2.7-3.7-5.8-3.7-9S9.5 5.7 12 3Z" />
    </svg>
  );
}
