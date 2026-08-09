import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import * as api from './api.js';
import { Anmeldung } from './components/Anmeldung.js';
import { Auffangnetz } from './components/Auffangnetz.js';
import { Dialoge } from './dialoge.js';
import { Meldungen } from './meldungen.js';
import { wendeGespeichertesThemaAn } from './design/thema.js';
import './index.css';

// Vor dem ersten Zeichnen: die Anweisung in index.html hat die Ansicht bereits gesetzt,
// damit nichts aufblitzt - hier wird sie zusätzlich der Desktop-Hülle gemeldet, die
// daraufhin ihre Fensterkanten umfärbt.
wendeGespeichertesThemaAn();

/**
 * Was zu sehen ist, wenn die Anwendung als Ganzes stolpert.
 *
 * Das Auffangnetz gab es schon, es hing aber nur um zwei kleine Teile in der
 * Nachrichtenansicht. Eine Ausnahme beim Zeichnen der Liste, der Seitenleiste oder des
 * Kopfteils nahm weiterhin das gesamte Fenster vom Bildschirm: leere Fläche, kein
 * Hinweis, kein Weg zurück außer Neustart - und ein offenes Verfassen-Fenster war mit
 * dem Text darin verloren. Für ein rahmenloses Fenster ohne Adressleiste ist das eine
 * Sackgasse.
 *
 * Bewusst ohne Rückgriff auf die Gestaltung der Anwendung: wenn dort etwas kaputt ist,
 * soll wenigstens diese Seite stehen. Deshalb Farben und Maße unmittelbar am Element.
 */
function Absturzseite(fehler: Error, nochmal: () => void) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '16px',
        height: '100vh',
        padding: '32px',
        textAlign: 'center',
        font: '15px/1.5 system-ui, sans-serif',
        color: 'var(--text, #1a1a1a)',
        background: 'var(--grund, #ffffff)',
      }}
    >
      <h1 style={{ font: '600 20px/1.3 system-ui, sans-serif', margin: 0 }}>
        Hier ist etwas schiefgegangen
      </h1>
      <p style={{ margin: 0, maxWidth: '46ch' }}>
        Die Anwendung konnte diese Ansicht nicht zeichnen. Ihre Nachrichten und Konten sind
        davon nicht betroffen – sie liegen auf dem Mailserver und in Ihrem Benutzerordner.
      </p>
      <pre
        style={{
          margin: 0,
          maxWidth: '60ch',
          overflowX: 'auto',
          padding: '10px 14px',
          borderRadius: '8px',
          font: '13px/1.5 ui-monospace, monospace',
          textAlign: 'left',
          background: 'rgba(127,127,127,0.14)',
        }}
      >
        {fehler.message}
      </pre>
      <div style={{ display: 'flex', gap: '10px' }}>
        <button type="button" onClick={nochmal} style={knopf}>
          Nochmal versuchen
        </button>
        <button type="button" onClick={() => window.location.reload()} style={knopf}>
          Neu laden
        </button>
      </div>
      <p style={{ margin: 0, fontSize: '13px', opacity: 0.75, maxWidth: '52ch' }}>
        Bleibt es dabei, erzeugt „Hilfe → Fehlerbericht erzeugen“ eine Datei mit dem
        Protokoll – Kennwörter und Adressen sind darin bereits unkenntlich gemacht.
      </p>
    </div>
  );
}

const knopf: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: '8px',
  border: '1px solid rgba(127,127,127,0.4)',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
};

/**
 * Die Weiche: Anwendung oder Anmeldung.
 *
 * Gefragt wird, bevor irgendetwas anderes losläuft. Ohne das würde die Anwendung starten,
 * ein Dutzend Abrufe absetzen, alle mit 401 zurückbekommen und dem Nutzer ein Postfach
 * zeigen, das leer aussieht - obwohl er nur nicht angemeldet ist.
 *
 * In der Desktop-Hülle antwortet der Server immer mit "angemeldet": dort weist sich das
 * Fenster über das Zugangsgeheimnis des Prozesses aus. Das Anmeldefenster bekommt dort
 * niemand zu sehen, und genau deshalb entscheidet DER SERVER darüber und nicht die
 * Oberfläche anhand von window.energyMail - eine Abfrage, zwei Betriebsarten.
 */
function Weiche() {
  const [stand, setStand] = React.useState<'faellt' | 'angemeldet' | 'offen' | 'fehler'>('faellt');
  const [grund, setGrund] = React.useState('');
  const [ich, setIch] = React.useState<api.IchAuskunft>();

  const nachsehen = React.useCallback(() => {
    setStand('faellt');
    api
      .frageIch()
      .then((auskunft) => {
        setIch(auskunft);
        setStand(auskunft.angemeldet ? 'angemeldet' : 'offen');
      })
      .catch((err: Error) => {
        /*
         * Der Server antwortet gar nicht. Das ist etwas anderes als "nicht angemeldet",
         * und es als Anmeldefenster darzustellen wäre irreführend: der Nutzer tippte sein
         * Kennwort in ein Formular, das nirgendwohin führt.
         */
        setGrund(err.message);
        setStand('fehler');
      });
  }, []);

  React.useEffect(nachsehen, [nachsehen]);

  if (stand === 'faellt') {
    /*
     * Bewusst leer statt eines Ladebalkens: die Abfrage geht an den eigenen Rechner und
     * ist in Millisekunden zurück. Ein Balken, der aufblitzt, wirkt unruhiger als nichts.
     */
    return null;
  }
  if (stand === 'fehler') return Absturzseite(new Error(grund), nachsehen);
  if (stand === 'offen') return <Anmeldung onAngemeldet={nachsehen} />;
  return <App ich={ich} onAbgemeldet={nachsehen} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Auffangnetz ersatz={Absturzseite}>
      <Weiche />
    </Auffangnetz>
    {/* Beide gehören genau einmal in den Baum und stehen bewusst neben der Anwendung:
        so liegen Meldungen und Rückfragen über allem, auch über einem offenen
        Verfassen-Fenster, und keiner ihrer Aufrufer muss etwas durchreichen.
        Außerhalb des Auffangnetzes, damit eine Fehlermeldung auch dann noch erscheinen
        kann, wenn die Anwendung selbst schon ersetzt wurde. */}
    <Meldungen />
    <Dialoge />
  </React.StrictMode>,
);
