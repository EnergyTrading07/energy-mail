/**
 * Wer ist hier eigentlich was - und braucht es überhaupt einen AVV?
 *
 * ## Warum diese Frage vor der Vorlage steht
 *
 * Weil die meisten Anbieter sie überspringen. Sie legen einen
 * Auftragsverarbeitungsvertrag bei, weil er professionell aussieht, der Kunde
 * unterschreibt ihn, heftet ihn ab - und hat damit ein Papier, das nichts regelt.
 * Schlimmer: Er hält die Sache damit für erledigt und besorgt die Verträge nicht, die er
 * wirklich braucht.
 *
 * **Reine Softwareüberlassung ist keine Auftragsverarbeitung.** Wer ein Programm kauft und
 * es auf seinem eigenen Rechner betreibt, lässt niemanden für sich verarbeiten - es gibt
 * keinen Auftrag und keinen Verarbeiter. Ein AVV mit dem Hersteller wäre ein Vertrag über
 * nichts.
 *
 * Ein AVV wird an drei Stellen wirklich gebraucht, und die stehen fast nie im Prospekt:
 *
 *  1. **Beim Postfachanbieter.** Er speichert die gesamte Geschäftspost. Er ist der
 *     wichtigste Auftragsverarbeiter des Betriebs, und bei Microsoft und Google ist der
 *     Vertrag ein Häkchen in der Verwaltung, das niemand je gesetzt hat.
 *  2. **Bei dem, der den Server betreibt**, wenn das nicht der Betrieb selbst ist.
 *  3. **Bei der Fernwartung**, sobald jemand von außen an die Daten kommen KANN - ob er
 *     hineinsieht, spielt keine Rolle. Die Möglichkeit genügt.
 *
 * ## Was das hier nicht ist
 *
 * Rechtsberatung. Was hier gerechnet wird, sind die Regelfälle, und sie decken die
 * allermeisten Betriebe ab. Ein Mensch, der dafür einsteht, muss trotzdem darübersehen -
 * und das steht auch in jedem erzeugten Papier.
 */

export interface Umstaende {
  /**
   * Ein Rechner, ein Mensch - oder ein Server für mehrere.
   *
   * Der Unterschied ist nicht die Zahl, sondern die Rolle: Beim Einzelplatz verarbeitet
   * jemand seine eigene Post; beim Server verarbeitet ein Betrieb die Post seiner
   * Beschäftigten und deren Gegenüber.
   */
  betriebsart: 'einzelplatz' | 'server';
  /** Ob die Nutzer Beschäftigte dessen sind, der den Dienst betreibt. */
  beschaeftigte: boolean;
  /** Ob es rein privat benutzt wird - dann greift die Haushaltsausnahme. */
  privat: boolean;
  /** Wer den Server betreibt. */
  betreiber: 'selbst' | 'dienstleister';
  /** Ob jemand von außen zu Wartungszwecken herankommt - Möglichkeit genügt. */
  fernwartung: boolean;
  /** Ob ein Betriebsrat besteht. */
  betriebsrat: boolean;
  /** Die Anbieter, bei denen die Postfächer liegen - aus den Konten abgeleitet. */
  postfachanbieter: string[];
  /** Ob das Firmenverzeichnis (LDAP) angebunden ist. */
  verzeichnis: boolean;
  /** Ob das GoBD-Archiv läuft. */
  archiv: boolean;
}

export interface Beteiligter {
  /** Wer - Name oder Rolle. */
  wer: string;
  /** Warum diese Einstufung gilt. Der wichtigere Teil. */
  weil: string;
}

export type Unterlage =
  | 'avv-anbieter'
  | 'avv-betreiber'
  | 'avv-fernwartung'
  | 'verarbeitungsverzeichnis'
  | 'tom'
  | 'betriebsvereinbarung'
  | 'datenschutzhinweis-beschaeftigte'
  | 'keine';

export interface Befund {
  /** Wer für die Verarbeitung geradesteht. */
  verantwortlicher: string;
  /** Wer im Auftrag verarbeitet - mit Begründung. */
  auftragsverarbeiter: Beteiligter[];
  /**
   * Wer ausdrücklich KEINER ist.
   *
   * Der praktisch wertvollste Teil dieses Befundes: Er verhindert Papiere, die nichts
   * regeln, und lenkt die Mühe dorthin, wo sie gebraucht wird.
   */
  keineAuftragsverarbeitung: Beteiligter[];
  /** Was zu besorgen ist. */
  unterlagen: Unterlage[];
  /** Was sonst noch bedacht gehört. */
  hinweise: string[];
}

/** Der Hersteller dieses Programms - er taucht in jedem Befund auf, meist im zweiten Teil. */
const HERSTELLER = 'Der Hersteller von Energy Mail';

export function beurteileLage(u: Umstaende): Befund {
  const befund: Befund = {
    verantwortlicher: '',
    auftragsverarbeiter: [],
    keineAuftragsverarbeitung: [],
    unterlagen: [],
    hinweise: [],
  };

  /*
   * Der Einzelplatz zu privaten Zwecken. Art. 2 Abs. 2 lit. c DSGVO nimmt die
   * ausschließlich persönliche oder familiäre Tätigkeit ganz aus - dann gibt es keinen
   * Verantwortlichen, keinen Verarbeiter und nichts zu unterschreiben.
   *
   * Die Ausnahme ist enger, als viele denken: Sobald jemand beruflich damit arbeitet -
   * auch als Einzelunternehmer von zu Hause aus -, ist sie weg.
   */
  if (u.privat && u.betriebsart === 'einzelplatz') {
    return {
      verantwortlicher:
        'Niemand im Sinne der DSGVO - die Verordnung gilt hier nicht (Art. 2 Abs. 2 lit. c).',
      auftragsverarbeiter: [],
      keineAuftragsverarbeitung: [
        {
          wer: HERSTELLER,
          weil: 'Das Programm läuft auf Ihrem Rechner. Es gibt keinen Auftrag und keine Verarbeitung durch ihn.',
        },
      ],
      unterlagen: ['keine'],
      hinweise: [
        'Die Haushaltsausnahme endet dort, wo beruflich gearbeitet wird - auch bei einem Einzelunternehmen am Küchentisch. Dann gilt alles Weitere.',
        'Ihr Postfachanbieter bleibt davon unberührt: Was dort liegt, verarbeitet er, und seine Datenschutzerklärung gilt weiter.',
      ],
    };
  }

  befund.verantwortlicher = u.beschaeftigte
    ? 'Der Betrieb, der den Dienst betreibt - gegenüber den Beschäftigten und gegenüber allen, die mit ihnen schreiben.'
    : 'Wer den Dienst betreibt und darüber Post bearbeitet.';

  /*
   * Der Postfachanbieter. Er steht immer an erster Stelle, weil dort die Post liegt -
   * nicht in diesem Programm. Das Programm ist ein Fenster darauf.
   */
  for (const anbieter of u.postfachanbieter) {
    befund.auftragsverarbeiter.push({
      wer: anbieter,
      weil: 'Dort liegen die Postfächer. Der Anbieter speichert und verarbeitet die gesamte Korrespondenz im Auftrag - das ist der wichtigste Auftragsverarbeiter überhaupt.',
    });
  }
  if (u.postfachanbieter.length > 0) befund.unterlagen.push('avv-anbieter');

  // Der Hersteller - und die Begründung, warum er in aller Regel keiner ist.
  if (u.fernwartung) {
    befund.auftragsverarbeiter.push({
      wer: `${HERSTELLER} oder wer sonst Fernwartung leistet`,
      weil: 'Wer zu Wartungszwecken an die Daten herankommen KANN, ist Auftragsverarbeiter - ob er hineinsieht, spielt keine Rolle. Die Möglichkeit genügt.',
    });
    befund.unterlagen.push('avv-fernwartung');
  } else {
    befund.keineAuftragsverarbeitung.push({
      wer: HERSTELLER,
      weil: 'Reine Softwareüberlassung ist keine Auftragsverarbeitung. Das Programm läuft auf Ihren Rechnern, der Hersteller hat keinen Zugriff, es gibt keinen Auftrag. Ein AVV mit ihm wäre ein Vertrag über nichts.',
    });
  }

  if (u.betriebsart === 'server' && u.betreiber === 'dienstleister') {
    befund.auftragsverarbeiter.push({
      wer: 'Der Dienstleister, der den Server betreibt',
      weil: 'Auf seinem Rechner liegen Postfachzugänge, Adressbücher und - sofern eingeschaltet - das Archiv. Er verarbeitet damit in Ihrem Auftrag.',
    });
    befund.unterlagen.push('avv-betreiber');
  } else if (u.betriebsart === 'server') {
    befund.keineAuftragsverarbeitung.push({
      wer: 'Der eigene Server',
      weil: 'Sie betreiben ihn selbst. Mit sich selbst schließt niemand einen Vertrag.',
    });
  }

  befund.unterlagen.push('verarbeitungsverzeichnis', 'tom');

  if (u.beschaeftigte) {
    befund.unterlagen.push('datenschutzhinweis-beschaeftigte');
    befund.hinweise.push(
      'Beschäftigtendaten unterliegen zusätzlich § 26 BDSG. Die Beschäftigten sind darüber zu unterrichten, was aufgezeichnet wird und wozu - und zwar bevor es losgeht, nicht danach.',
    );

    /*
     * Die Mitbestimmung. Sie wird bei Software fast immer übersehen, und sie ist der
     * Punkt, an dem eine eingeführte Lösung wieder abgeschaltet werden muss.
     *
     * § 87 Abs. 1 Nr. 6 BetrVG erfasst technische Einrichtungen, die zur Überwachung von
     * Verhalten oder Leistung GEEIGNET sind. Nach ständiger Rechtsprechung des BAG kommt
     * es nicht darauf an, ob überwacht werden SOLL - die Eignung genügt. Ein Archiv, das
     * jede ein- und ausgehende Nachricht aufzeichnet, ist dafür ein Musterbeispiel.
     */
    if (u.betriebsrat && (u.archiv || u.betriebsart === 'server')) {
      befund.unterlagen.push('betriebsvereinbarung');
      befund.hinweise.push(
        u.archiv
          ? 'Das Archiv zeichnet jede ein- und ausgehende Nachricht auf. Damit ist es eine technische Einrichtung, die zur Überwachung von Verhalten und Leistung geeignet ist - § 87 Abs. 1 Nr. 6 BetrVG. Ob überwacht werden soll, spielt keine Rolle; das Bundesarbeitsgericht stellt allein auf die Eignung ab. Der Betriebsrat ist zu beteiligen, und zwar vorher.'
          : 'Ein Mailserver mit Protokollierung ist zur Verhaltens- und Leistungskontrolle geeignet und damit nach § 87 Abs. 1 Nr. 6 BetrVG mitbestimmungspflichtig - unabhängig davon, ob jemand das vorhat.',
      );
    } else if (u.archiv) {
      befund.hinweise.push(
        'Sollte je ein Betriebsrat gebildet werden, ist das Archiv nach § 87 Abs. 1 Nr. 6 BetrVG mitbestimmungspflichtig - es ist zur Verhaltenskontrolle geeignet, gleich ob das gewollt ist.',
      );
    }

    befund.hinweise.push(
      'Private Nutzung des Geschäftspostfachs: Ist sie erlaubt oder geduldet, wird die Sache erheblich schwieriger - dann kommen Fragen des Fernmeldegeheimnisses hinzu. Ein klares Verbot oder eine klare Regelung ist der Weg; eine ungeregelte Duldung ist der schlechteste Zustand.',
    );
  }

  if (u.verzeichnis) {
    befund.hinweise.push(
      'Das Firmenverzeichnis wird nur gelesen. Trotzdem gehört es ins Verarbeitungsverzeichnis: Aus ihm stammen Namen, Adressen und Telefonnummern der Beschäftigten, die in den Vorschlägen erscheinen.',
    );
  }

  if (u.archiv) {
    befund.hinweise.push(
      'Aufbewahrungspflicht und Löschanspruch widersprechen sich nicht: Art. 17 Abs. 3 lit. b DSGVO nimmt aus, was zur Erfüllung einer rechtlichen Verpflichtung nötig ist. Das gilt aber nur für das, was wirklich aufbewahrungspflichtig ist - deshalb wird je Konto eingeschaltet und nicht pauschal.',
    );
  }

  befund.hinweise.push(
    'Diese Einschätzung deckt die Regelfälle ab und ist keine Rechtsberatung. Wer dafür einstehen muss, sollte darübersehen - besonders bei Beschäftigtendaten und bei einem Betriebsrat.',
  );

  return befund;
}

/** Die Papiere mit Namen - für die Anzeige und für das Inhaltsverzeichnis der Ausfuhr. */
export const UNTERLAGEN_NAMEN: Record<Unterlage, string> = {
  'avv-anbieter': 'Auftragsverarbeitungsvertrag mit dem Postfachanbieter',
  'avv-betreiber': 'Auftragsverarbeitungsvertrag mit dem Serverbetreiber',
  'avv-fernwartung': 'Auftragsverarbeitungsvertrag für die Fernwartung',
  verarbeitungsverzeichnis: 'Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)',
  tom: 'Technische und organisatorische Maßnahmen (Art. 32 DSGVO)',
  betriebsvereinbarung: 'Betriebsvereinbarung (§ 87 Abs. 1 Nr. 6 BetrVG)',
  'datenschutzhinweis-beschaeftigte': 'Datenschutzhinweis für die Beschäftigten (Art. 13 DSGVO)',
  keine: 'Keine - die DSGVO gilt hier nicht',
};
