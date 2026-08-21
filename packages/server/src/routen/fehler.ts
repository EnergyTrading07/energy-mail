/**
 * Ein Fehler, der seinen eigenen Rang schon kennt.
 *
 * Steht hier und nicht mehr in app.ts, weil ihn jede Routengruppe braucht: Sobald die
 * Wege aus der einen grossen Datei herauswandern (siehe routen/), muessen sie ihn
 * einbinden koennen, ohne app.ts einzubinden - das ergaebe einen Ring.
 *
 * Der Behandler in app.ts erkennt ihn und macht daraus die Antwort. Alles andere, was
 * geworfen wird, bekommt eine 500 und einen Protokolleintrag; das ist die Trennung:
 * `HttpError` heisst "die Anfrage taugt nicht", alles andere heisst "hier ist etwas
 * kaputt".
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
