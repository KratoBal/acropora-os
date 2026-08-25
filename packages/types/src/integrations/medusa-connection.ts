/**
 * A Medusa kapcsolat MEGOSZTOTT típusai: amit az API kiad, és amit a felület
 * megjeleníthet.
 *
 * Egyetlen dolog nincs és nem is lesz benne: a titkos kulcs. Beállítás után
 * felülírni, tesztelni és letiltani lehet, visszaolvasni nem, és ez a típus is
 * ezt tartja: `masked` van, érték nincs.
 */

export type MedusaConnectionVerificationStatus =
  "NEVER" | "SUCCESS" | "FAILED" | "INDETERMINATE" | "STALE";

/**
 * Melyik úton jön ma a kulcs. Az `env` nem egyenrangú alternatíva, hanem
 * ÁTMENETI tartalék, és a felületnek is így kell mutatnia: egy tartalék, ami
 * működik, észrevétlenül állandósul.
 */
export type MedusaCredentialSource = "database" | "env";

/**
 * Az integráció állapota, ahogy a felület látja. A nevek a szerver oldali
 * állapotokból jönnek, nem a felület kényelméből: ha itt új nevet adnánk,
 * ugyanannak a dolognak két neve lenne, és fél év múlva senki nem tudná, melyik
 * a mérvadó.
 */
export type MedusaIntegrationStateKind =
  | "ready"
  | "not-configured"
  | "credential-corrupt"
  | "unreachable"
  | "auth-or-permission-failure";

export interface MedusaConnectionStateView {
  kind: MedusaIntegrationStateKind;
  /** Csak `ready` állapotban van értelme: melyik úton jött a kulcs. */
  source: MedusaCredentialSource | null;
  /**
   * Ember számára szánt magyarázat. Elutasításnál a VALÓSZÍNŰ okot nevezi meg,
   * és kimondja, hogy más ok is adhatja ugyanazt a választ. Soha nem állítja,
   * hogy a kulcs rossz.
   */
  detail: string | null;
  /** Az elutasítás HTTP kódja, ha volt. Információ, nem bizonyíték. */
  status: number | null;
}

export interface MedusaConnectionCredentialInput {
  apiKey: string;
}

export interface MedusaConnectionView {
  configured: boolean;
  masked: "••••••••" | null;
  modifiedAt: string | null;
  state: MedusaConnectionStateView;
  verification: {
    status: MedusaConnectionVerificationStatus;
    checkedAt: string | null;
    code: string | null;
  };
}
