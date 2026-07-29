import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';
import { Dialoge } from './dialoge.js';
import { Meldungen } from './meldungen.js';
import { wendeGespeichertesThemaAn } from './design/thema.js';
import './index.css';

// Vor dem ersten Zeichnen: die Anweisung in index.html hat die Ansicht bereits gesetzt,
// damit nichts aufblitzt - hier wird sie zusätzlich der Desktop-Hülle gemeldet, die
// daraufhin ihre Fensterkanten umfärbt.
wendeGespeichertesThemaAn();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    {/* Beide gehören genau einmal in den Baum und stehen bewusst neben der Anwendung:
        so liegen Meldungen und Rückfragen über allem, auch über einem offenen
        Verfassen-Fenster, und keiner ihrer Aufrufer muss etwas durchreichen. */}
    <Meldungen />
    <Dialoge />
  </React.StrictMode>,
);
