import path from 'node:path';
import type { OAuthClientCredentials, OAuthProviderId } from '@energy-mail/mail-core';
import { getNutzerDir } from './paths.js';
import { liesJson, schreibeAtomar } from './atomar.js';
import { protokolliere } from './protokollDatei.js';
import { decryptSecret, encryptSecret } from './secretCrypto.js';

const getStorePath = () => path.join(getNutzerDir(), 'oauth-clients.json');

interface StoredClient {
  clientId: string;
  /** Verschlüsselt, wie die Kontozugangsdaten - es ist ein Geheimnis. */
  clientSecretEncrypted?: string;
  /** Der Mandant bei Microsoft. Kein Geheimnis, deshalb im Klartext. */
  mandant?: string;
}

type StoreFile = Partial<Record<OAuthProviderId, StoredClient>>;

function read(): StoreFile {
  const befund = liesJson<StoreFile>(getStorePath(), {});
  if (befund.beschaedigt) {
    protokolliere(
      'fehler',
      'oauth',
      `${befund.beschaedigt.pfad} war unlesbar (${befund.beschaedigt.grund}). ` +
        'Die hinterlegten Anbieter-Zugangsdaten muessen neu eingetragen werden.',
    );
  }
  return befund.wert && typeof befund.wert === 'object' ? befund.wert : {};
}

function write(data: StoreFile): void {
  schreibeAtomar(getStorePath(), JSON.stringify(data, null, 2));
}

export function setOAuthClient(
  provider: OAuthProviderId,
  credentials: OAuthClientCredentials,
): void {
  const data = read();
  data[provider] = {
    clientId: credentials.clientId.trim(),
    clientSecretEncrypted: credentials.clientSecret?.trim()
      ? encryptSecret(credentials.clientSecret.trim())
      : undefined,
    mandant: credentials.mandant?.trim() || undefined,
  };
  write(data);
}

export function removeOAuthClient(provider: OAuthProviderId): void {
  const data = read();
  delete data[provider];
  write(data);
}

/**
 * Was die Organisation vorgibt - falls sie etwas vorgibt.
 *
 * Von außen gesetzt, weil die Richtliniendatei unter %PROGRAMDATA% liegt und der Server
 * davon nichts wissen soll. Dasselbe Muster wie beim Proxy und beim Schlüssel.
 *
 * ## Warum es das braucht
 *
 * Die Einrichtung schickt den Nutzer heute in die Google Cloud Console bzw. ins
 * Azure-Portal, damit er dort selbst eine Anwendung registriert. Für einen Privatnutzer
 * ist das ein bemerkenswert ehrlicher Weg - seine Zugangsdaten gehören ihm, und niemand
 * sonst steht dazwischen. In einem Unternehmen ist es unmöglich: Anwendungen in Entra ID
 * registriert die IT, ein Mitarbeiter hat dort keine Rechte, und die Zustimmung erteilt
 * ein Administrator einmal für alle. Ohne Vorgabe bliebe für hundert Mitarbeiter eine
 * Anleitung übrig, die keiner von ihnen befolgen darf.
 */
export type OAuthVorgabe = (provider: OAuthProviderId) => OAuthClientCredentials | null;

let vorgabe: OAuthVorgabe | null = null;

export function setzeOAuthVorgabe(fn: OAuthVorgabe | null): void {
  vorgabe = fn;
}

/** Ob für diesen Anbieter etwas vorgegeben ist - dann darf der Nutzer nichts eintragen. */
export function istVorgegeben(provider: OAuthProviderId): boolean {
  return Boolean(vorgabe?.(provider));
}

export function getOAuthClient(provider: OAuthProviderId): OAuthClientCredentials | null {
  /*
   * Die Vorgabe zuerst - und sie schlägt, was der Nutzer eingetragen hat.
   *
   * Dieselbe Reihenfolge wie beim Proxy, aus demselben Grund: eine Vorgabe, die sich
   * örtlich überstimmen lässt, ist keine. Hier kommt hinzu, dass eine eigene Registrierung
   * neben der der Organisation praktisch nie gewollt ist - sie führte zu einer zweiten
   * Zustimmungsseite und zu Anmeldungen, die kein Administrator im Blick hat.
   */
  const vorgegeben = vorgabe?.(provider);
  if (vorgegeben) return vorgegeben;

  const entry = read()[provider];
  if (!entry) return null;
  return {
    clientId: entry.clientId,
    clientSecret: entry.clientSecretEncrypted ? decryptSecret(entry.clientSecretEncrypted) : undefined,
    mandant: entry.mandant,
  };
}

/** Woher die Angaben stammen - die Oberfläche sagt es dem Nutzer. */
export interface OAuthAnbieterstand {
  configured: boolean;
  clientId?: string;
  /** Nur bei Microsoft belegt. */
  mandant?: string;
  /** Von der Organisation vorgegeben: dann ist hier nichts einzustellen. */
  vorgegeben?: boolean;
}

/** Für die Oberfläche: welche Anbieter eingerichtet sind - ohne die Geheimnisse. */
export function listOAuthClients(): Record<string, OAuthAnbieterstand> {
  const data = read();
  const result: Record<string, OAuthAnbieterstand> = {};
  for (const provider of ['google', 'microsoft'] as OAuthProviderId[]) {
    const vorgegeben = vorgabe?.(provider);
    if (vorgegeben) {
      result[provider] = {
        configured: true,
        clientId: vorgegeben.clientId,
        mandant: vorgegeben.mandant,
        vorgegeben: true,
      };
      continue;
    }
    const entry = data[provider];
    result[provider] = entry
      ? { configured: true, clientId: entry.clientId, mandant: entry.mandant }
      : { configured: false };
  }
  return result;
}
