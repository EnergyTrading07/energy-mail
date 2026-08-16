import type { CategoryInfo, GmailCategory } from '@energy-mail/mail-core';
import { t } from './sprache.js';

/**
 * Anzeige von Gmails Einordnung des Posteingangs.
 *
 * Die Reihenfolge folgt der von Gmails eigener Oberfläche, damit Nutzer sie wiedererkennen.
 * Die Namen sind deutsch und passen zu den vereinheitlichten Ordnernamen der Seitenleiste
 * (siehe folderTree) - so heißt nichts an einer Stelle anders als an der anderen.
 *
 * Die Liste steht hier noch einmal, statt GMAIL_CATEGORIES aus mail-core zu übernehmen:
 * aus mail-core dürfen im Browser nur Typen kommen. Ein Wert von dort zieht dessen
 * index.js mit ins Bündel - und damit imapflow, nodemailer und mailparser, die im
 * Browser nicht laufen. Der Typ GmailCategory sorgt dafür, dass beide Listen
 * zusammenpassen: fehlt ein Eintrag oder ist einer zu viel, schlägt die Typprüfung fehl.
 */
function namen(): Record<GmailCategory, string> {
  return {
    social: t('Soziale Netzwerke'),
    promotions: t('Werbung'),
    updates: t('Benachrichtigungen'),
    forums: t('Foren'),
  };
}

/** Was die Einordnung bedeutet - als Erklärung beim Überfahren mit der Maus. */
function erklaerungen(): Record<GmailCategory, string> {
  return {
    social: t('Nachrichten von sozialen Netzwerken und Portalen'),
    promotions: t('Angebote, Newsletter und Werbung'),
    updates: t('Bestätigungen, Rechnungen und automatische Hinweise'),
    forums: t('Nachrichten aus Mailinglisten und Diskussionsgruppen'),
  };
}

/** Reihenfolge wie in Gmails eigenen Reitern. */
const REIHENFOLGE: GmailCategory[] = ['social', 'promotions', 'updates', 'forums'];

export function categoryLabel(category: GmailCategory): string {
  return namen()[category];
}

export function categoryDescription(category: GmailCategory): string {
  return erklaerungen()[category];
}

/**
 * Anzuzeigende Einordnungen in Gmails Reihenfolge.
 *
 * Leere Einordnungen entfallen: "Foren" ist in vielen Postfächern durchgehend leer, und
 * eine Zeile, hinter der nie etwas liegt, kostet nur Platz. Sobald dort etwas eintrifft,
 * erscheint sie beim nächsten Abgleich von selbst.
 */
export function visibleCategories(categories: CategoryInfo[]): CategoryInfo[] {
  const treffer: CategoryInfo[] = [];
  for (const id of REIHENFOLGE) {
    const info = categories.find((c) => c.id === id);
    if (info && info.total > 0) treffer.push(info);
  }
  return treffer;
}
