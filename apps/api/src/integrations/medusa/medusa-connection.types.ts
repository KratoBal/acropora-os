/**
 * A Medusa admin kulcs TÁROLÁSÁNAK típusai.
 *
 * Ez a kör a hitelesítő adat HELYÉT építi meg, nem a hívást. A minta az UNAS
 * és a NAV kapcsolat-beállítása, és ez SZÁNDÉKOSAN MÁSOLAT, nem kiemelés: a
 * három integráció titkosítója külön él, amíg valaki külön körben nem dönt a
 * közös szolgáltatásról. Egy kiemelés két élesben futó integrációt írna át.
 */

export const MEDUSA_CONNECTION_ID = "medusa";

/**
 * `ENV_FALLBACK` az induló állapot, mert a vetítés ma a folyamat környezetéből
 * kapja a kulcsot. A tartalék NEM néma: a hívó oldalnak ki kell mondania, ha
 * ezen az úton megy, különben egy átmenetből észrevétlenül állapot lesz.
 */
export type MedusaCredentialMode = "ENV_FALLBACK" | "DATABASE" | "DISABLED";

export type StoredMedusaVerificationStatus =
  "NEVER" | "SUCCESS" | "FAILED" | "INDETERMINATE";

export type MedusaVerificationStatus = StoredMedusaVerificationStatus | "STALE";

export const MEDUSA_VERIFICATION_STALE_MS = 24 * 60 * 60 * 1000;

export const MEDUSA_CONNECTION_ERROR_CODES = [
  "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
  "MEDUSA_CONNECTION_NOT_CONFIGURED",
  "MEDUSA_CONNECTION_DISABLED",
  "MEDUSA_CREDENTIAL_MASTER_KEY_NOT_CONFIGURED",
  "MEDUSA_CREDENTIAL_MASTER_KEY_INVALID",
  "MEDUSA_CREDENTIAL_KEY_VERSION_UNKNOWN",
  "MEDUSA_CREDENTIAL_ENVELOPE_INVALID",
  "MEDUSA_CREDENTIAL_DECRYPT_FAILED",
  "MEDUSA_CREDENTIAL_INPUT_INVALID",
  /**
   * A visszatartás fogta meg a kérést: túl gyakran érkezett. Nem hiba a szó
   * szoros értelmében, de KÜLÖN kód, mert a teendő más: várni kell, nem
   * javítani. Egy általános hibába olvasztva a felhasználó a kulcsot kezdené
   * cserélni, holott az ép.
   */
  "MEDUSA_CONNECTION_COOLDOWN",
  /**
   * A HÍVÁS oldali bukás, EGYETLEN néven a `401`-re és a `403`-ra.
   *
   * A kódban ma megkülönböztethető a kettő, és mégis közös nevet kapnak. Az ok
   * nem kényelem: a megkülönböztethetőség **nem a kód tulajdonsága**, hanem két
   * rajtunk kívül álló beállítás mai állapota, és egyik változásáról sem
   * értesülnénk.
   *
   * A `403` ma csak a Medusa jogosultság-ellenőrzőjéből jöhet, de az egy
   * kapcsoló mögött van, és a Medusa ELŐTT álló fordított proxy is adhatna
   * ilyet (ma csak tömörítés és https átirányítás áll rajta). A `401` pedig
   * egyetlen helyről jön, de ÖT ok áll mögötte, és az ötödik nem a kulcsról
   * szól: az api-key modul kivételét a Medusa elkapja, tehát egy ottani
   * adatbázishiba is `401`-ként érkezik hozzánk, miközben a kulcs ép.
   *
   * Ezért: egyik hibakód sem jelentheti automatikusan, hogy „rossz a kulcs".
   */
  "MEDUSA_AUTH_OR_PERMISSION_FAILURE",
] as const;

export type MedusaConnectionErrorCode =
  (typeof MEDUSA_CONNECTION_ERROR_CODES)[number];

const MEDUSA_CONNECTION_ERROR_CODE_SET = new Set<string>(
  MEDUSA_CONNECTION_ERROR_CODES,
);

export function isMedusaConnectionErrorCode(
  value: unknown,
): value is MedusaConnectionErrorCode {
  return (
    typeof value === "string" && MEDUSA_CONNECTION_ERROR_CODE_SET.has(value)
  );
}

export class MedusaConnectionError extends Error {
  constructor(readonly code: MedusaConnectionErrorCode) {
    super(code);
    this.name = "MedusaConnectionError";
  }
}

/**
 * Amit a felület KAPHAT. A kulcs maga nincs benne, és nem is lesz: beállítás
 * után felülírni, tesztelni és letiltani lehet, visszaolvasni nem.
 */
export interface MedusaConnectionView {
  configured: boolean;
  masked: "••••••••" | null;
  modifiedAt: string | null;
  verification: {
    status: MedusaVerificationStatus;
    checkedAt: string | null;
    code: MedusaConnectionErrorCode | null;
  };
}

export interface MedusaCredentialEnvelope {
  encryptedApiKey: Buffer;
  encryptionIv: Buffer;
  authenticationTag: Buffer;
  keyVersion: string;
}

/**
 * A NÉGY ÁLLAPOT, egy típusban.
 *
 * Azért egy típus és nem négy logikai mező, mert a négy eset KIZÁRJA egymást, és
 * a legdrágább hiba pontosan az lenne, ha kettő egyszerre látszana igaznak. A
 * második eset a legfontosabb: egy sérült boríték NEM ugyanaz, mint hogy még
 * nincs beállítva, és ha egybefolynának, a hibás állapot csendben úgy nézne ki,
 * mint egy friss telepítés.
 */
export type MedusaIntegrationState =
  /** Van használható hitelesítő adat. A `source` mondja meg, melyik úton. */
  | { kind: "ready"; source: "database" | "env" }
  /** Nincs beállítva. Az API ELINDUL, csak a Medusa nem megy. */
  | { kind: "not-configured" }
  /**
   * Van tárolt adat, de nem fejthető vissza. Ez konfigurációs és integritási
   * HIBA, tehát hangosnak kell lennie: nem szabad „még nincs beállítva"
   * állapotnak látszania.
   */
  | { kind: "credential-corrupt"; code: MedusaConnectionErrorCode }
  /** A Medusa futás közben nem érhető el. Degradált integráció. */
  | { kind: "unreachable"; detail: string }
  /**
   * A Medusa válaszolt, de elutasított. Degradált integráció, és a `status`
   * megmarad, mert az INFORMÁCIÓ, csak nem bizonyíték.
   */
  | {
      kind: "auth-or-permission-failure";
      status: number;
      detail: string;
    };

/**
 * Amit a TÁROLT adatból el lehet dönteni, hálózat nélkül.
 *
 * Ez nem kényelmi szűkítés: a típus mondja ki, hogy az induláskori vizsgálat
 * SOHA nem ad elérhetetlenséget vagy hitelesítési bukást, mert azokhoz hívni
 * kellene a másik oldalt. Ha valaki egyszer mégis hálózatot tenne bele, ez a
 * típus pirosra vált.
 */
export type MedusaStoredState = Extract<
  MedusaIntegrationState,
  | { kind: "ready" }
  | { kind: "not-configured" }
  | { kind: "credential-corrupt" }
>;

export interface MedusaConnectionSettingRecord {
  id: string;
  credentialMode: MedusaCredentialMode;
  encryptedApiKey: Uint8Array | null;
  encryptionIv: Uint8Array | null;
  authenticationTag: Uint8Array | null;
  keyVersion: string | null;
  credentialRevision: number;
  credentialUpdatedAt: Date | null;
  credentialUpdatedByUserId: string | null;
  verificationStatus: StoredMedusaVerificationStatus;
  lastVerifiedAt: Date | null;
  lastVerificationCode: string | null;
  credentialAttemptedAt: Date | null;
  testAttemptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
