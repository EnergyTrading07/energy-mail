import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Was der Prüfer beanstandet - und was ausdrücklich nicht.
 *
 * ## Warum es ihn gibt
 *
 * Typprüfung und Bau sagen, ob der Quelltext übersetzt. Sie sagen nichts über die Sorte
 * Fehler, die übersetzt und trotzdem falsch ist: eine vergessene Abhängigkeit in einem
 * useEffect, eine Zuweisung an eine Variable, die niemand mehr liest, ein Vergleich mit
 * stillschweigender Umwandlung. Bei 89.000 Zeilen findet man die nicht beim Durchsehen.
 *
 * Der Anlass ist react-hooks. In App.tsx stehen Dutzende Effekte; wer dort eine
 * Abhängigkeit vergisst, bekommt kein Fehlerbild, sondern eine Oberfläche, die manchmal
 * einen alten Stand zeigt - und zwar nur unter Umständen, die sich schlecht nachstellen
 * lassen. Genau dafür ist die Regel gemacht, und sie hat beim ersten Lauf auch prompt
 * vier Stellen genannt.
 *
 * ## Warum die Auswahl so klein ist
 *
 * Ein Prüfer, der beim ersten Lauf sechshundert Beanstandungen ausgibt, wird abgeschaltet
 * oder auf "Warnung" gestellt, und dann ist er Zierde. Hier steht deshalb nur, was
 * entweder einen echten Fehler benennt oder sich in einem Zug beheben lässt. Alles, was
 * Geschmack ist - Anführungszeichen, Semikola, Zeilenlänge -, gehört nicht hierher: Der
 * Quelltext ist einheitlich geschrieben, und ein Streit darüber kostet mehr, als er
 * einbringt.
 *
 * ## Keine typgestützten Regeln
 *
 * typescript-eslint kann mit Typinformationen prüfen und findet damit deutlich mehr. Es
 * braucht dafür aber einen vollständigen Programmaufbau je Lauf, und der dauert bei
 * diesem Bestand länger als die gesamte übrige Prüfung. Der Prüflauf soll benutzbar
 * bleiben; wer die schweren Regeln braucht, schaltet sie für einen einzelnen Lauf dazu.
 */
export default tseslint.config(
  {
    /*
     * Was nicht geprüft wird.
     *
     * dist und release sind Erzeugnisse - dort etwas zu beanstanden hieße, den Übersetzer
     * zu beanstanden. Die Sprachkataloge sind maschinell geschrieben (siehe
     * scripts/katalog-einfuegen.mjs); was dort steht, entscheidet nicht der Mensch.
     */
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'release/**',
      'build/**',
      'packages/mail-core/src/sprachen/*.ts',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx,mts,cts,mjs}'],
    rules: {
      /*
       * Ungenutztes: ein Befund, aber mit einem Ausweg.
       *
       * Ein Parameter, den eine Schnittstelle vorschreibt und die Umsetzung nicht
       * braucht, ist kein Fehler - er muss nur dastehen. Das Projekt schreibt ihn seit
       * jeher mit führendem Unterstrich (`_request`), und genau das gilt hier als
       * Einverständnis.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          /*
           * Der Rest-Operator, mit dem Felder weggelassen werden.
           *
           * `const { attachOriginal, draftUid, ...message } = request.body` nennt die
           * beiden nur, um sie aus `message` HERAUSZUHALTEN - benutzt werden sie
           * absichtlich nicht. Ohne diese Zeile beanstandet der Pruefer jedes einzelne
           * und draengt dazu, sie mit Unterstrichen zu verunstalten.
           */
          ignoreRestSiblings: true,
        },
      ],

      /*
       * Zuweisungen, die spaeter nicht mehr gelesen werden - ausdruecklich AUS.
       *
       * Getroffen hat die Regel vier Stellen, und keine davon war ein Fehler: `let
       * groesse = 0` vor einem try, das den Wert setzt und dessen catch frueh
       * zurueckkehrt; `let liste = []` mit derselben Bauart; und zweimal ein `i++` als
       * letzter Zugriff in einem Zerleger, der sich Stueck fuer Stueck vorarbeitet.
       *
       * Alle vier sind vorsorgliche Schreibweisen: Der Anfangswert haelt die Variable
       * auch dann brauchbar, wenn spaeter jemand einen Zweig ergaenzt, und das
       * fortgezaehlte `i` stimmt fuer das naechste Feld, das dazukommt. Sie zu entfernen
       * spart nichts und schafft eine Falle.
       */
      'no-useless-assignment': 'off',

      /*
       * `any` bleibt erlaubt - als Befund wäre es Lärm.
       *
       * An den Rändern zu fremden Bibliotheken (imapflow, mailparser, Electron) ist es
       * stellenweise die ehrlichste Angabe. Die Stellen sind gezählt und kommentiert.
       */
      '@typescript-eslint/no-explicit-any': 'off',

      /*
       * `==` nur dort, wo es gemeint ist.
       *
       * `x == null` fängt null UND undefined in einem Ausdruck und ist die eingeführte
       * Schreibweise dafür; alles andere ist ein Vergleich mit stillschweigender
       * Umwandlung, und der überrascht früher oder später.
       */
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    /*
     * Alles, was unter Node läuft: Server, Hülle, Kern, Werkzeuge.
     *
     * Ohne diese Angabe hält der Prüfer `process`, `Buffer`, `URL` und `fetch` für
     * unbekannte Namen und meldet neunundzwanzig Fehler, die keine sind.
     */
    files: [
      'packages/{server,desktop,mail-core}/**/*.{ts,mts,cts,mjs}',
      'scripts/**/*.mjs',
      'eslint.config.js',
    ],
    languageOptions: { globals: globals.node },
  },

  {
    /*
     * Die Oberfläche läuft im Browser - dort gibt es `document`, `window` und `fetch`,
     * aber kein `process` und kein `Buffer`.
     *
     * public/ gehört dazu: thema-vorab.js ist kein Baustein, sondern eine Anweisung, die
     * vor dem ersten Zeichnen läuft (siehe index.html). Sie wird nicht übersetzt und
     * landet unverändert im Paket - geprüft gehört sie trotzdem.
     */
    files: ['packages/web/src/**/*.{ts,tsx,mts}', 'packages/web/public/*.js'],
    languageOptions: { globals: globals.browser },
  },

  {
    /*
     * Die Oberfläche - hier liegt der eigentliche Gewinn.
     *
     * rules-of-hooks findet Aufrufe an Stellen, an denen sie nicht stehen dürfen; das
     * sind immer Fehler. exhaustive-deps findet die vergessene Abhängigkeit, und die ist
     * die häufigste Ursache für "manchmal steht ein alter Stand da".
     */
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },

  {
    /*
     * Kein `console` im ausgelieferten Quelltext.
     *
     * Es gibt protokolliere() - das geht in die Datei, wird gereinigt (Kennwörter und
     * Marken unkenntlich) und steht damit im Fehlerbericht. Ein console.log sieht in der
     * ausgelieferten Anwendung niemand, und einem console.error sieht man nicht an, ob
     * es ein Kennwort mitnimmt.
     *
     * warn und error bleiben zu: Der Serverstart meldet damit Dinge, bevor das Protokoll
     * überhaupt eingerichtet ist (siehe server/src/index.ts), und dort ist stdout das
     * einzige, was es gibt.
     */
    files: ['packages/*/src/**/*.{ts,tsx,cts}'],
    rules: { 'no-console': ['error', { allow: ['warn', 'error'] }] },
  },

  {
    /*
     * Prüfdateien und Werkzeuge schreiben nach stdout - das ist dort nicht
     * Nachlässigkeit, sondern ihre Ausgabe. Eine Pruefung, die ihr Ergebnis nicht
     * hinschreiben darf, ist keine.
     */
    files: [
      '**/*.test.mts',
      'scripts/**/*.mjs',
      'packages/server/src/nutzerWerkzeug.ts',
      'packages/mail-core/src/smime/pruefdaten/*.{mts,mjs}',
    ],
    rules: { 'no-console': 'off' },
  },
);
