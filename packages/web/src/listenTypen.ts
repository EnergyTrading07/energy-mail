import type { MessageSummary } from '@energy-mail/mail-core';

/**
 * Eine Zeile der Nachrichtenliste.
 *
 * Bei einer Suche über mehrere Ordner oder Konten steht dabei, wo der Treffer liegt -
 * ohne das wäre eine Trefferliste aus fünf Ordnern nicht deutbar, und eine UID allein
 * genügt nicht zum Öffnen: sie gilt nur innerhalb ihres Ordners.
 *
 * Bewusst in einem eigenen Modul und nicht in der Komponente: die Gruppierung zu
 * Gesprächen braucht den Typ ebenfalls, und ein Modul ohne JSX lässt sich überall
 * einbinden - auch von den Tests, die ohne JSX-Übersetzung laufen.
 */
export type Listeneintrag = MessageSummary & {
  folder?: string;
  accountId?: string;
  email?: string;
};
