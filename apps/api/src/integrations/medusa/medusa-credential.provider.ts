import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { MedusaConnectionRepository } from "./medusa-connection.repository.js";
import {
  MedusaConnectionError,
  type MedusaConnectionSettingRecord,
  type MedusaCredentialEnvelope,
} from "./medusa-connection.types.js";
import { MedusaCredentialCryptoService } from "./medusa-credential-crypto.service.js";

/**
 * Honnan jön a kulcs FUTÁSIDŐBEN.
 *
 * A `source` mező nem díszítés, hanem a kör egyik állítása: amíg a tartalék úton
 * megyünk, azt ki kell mondani. Egy tartalék attól veszélyes, hogy MŰKÖDIK, és
 * amíg működik, senki nem veszi észre, hogy még mindig azt használjuk. Így lesz
 * egy átmenetből állapot. A hívó ezért megkapja, melyik úton kapta a kulcsot, és
 * a parancssori felület ezt egy sorban ki is írja.
 */
export interface ResolvedMedusaCredential {
  apiKey: string;
  /** Melyik úton jött. A `env` érték átmeneti állapotot jelöl. */
  source: "database" | "env";
  /**
   * A kulcs AZONOSSÁGA, nem a kulcs. Tárolt kulcsnál a revízió, környezetiből
   * származónál a tartalom lenyomata. Naplóba ez mehet, a kulcs nem.
   */
  revision: string;
}

@Injectable()
export class MedusaCredentialProvider {
  constructor(
    private readonly repository: MedusaConnectionRepository,
    private readonly crypto: MedusaCredentialCryptoService,
  ) {}

  async resolve(): Promise<ResolvedMedusaCredential> {
    const setting = await this.repository.getSetting();
    if (!setting)
      throw new MedusaConnectionError(
        "MEDUSA_CONNECTION_CONFIGURATION_MISSING",
      );
    return this.resolveRecord(setting);
  }

  resolveRecord(
    setting: MedusaConnectionSettingRecord,
  ): ResolvedMedusaCredential {
    if (setting.credentialMode === "ENV_FALLBACK")
      return this.environmentCredential();
    if (setting.credentialMode === "DISABLED")
      throw new MedusaConnectionError("MEDUSA_CONNECTION_DISABLED");
    return this.databaseCredential(setting);
  }

  /**
   * Ellenőrzés írás nélkül: a tárolt boríték visszafejthető-e. Ezt hívja majd az
   * induláskori vizsgálat, ahol a KÜLÖNBSÉG számít: a "még nincs beállítva" eset
   * elindulhat, a "van, de sérült" viszont hangos konfigurációs hiba.
   */
  validateRecord(setting: MedusaConnectionSettingRecord): void {
    if (setting.credentialMode === "ENV_FALLBACK") {
      if (!process.env.MEDUSA_ADMIN_API_KEY?.trim())
        throw new MedusaConnectionError("MEDUSA_CONNECTION_NOT_CONFIGURED");
      return;
    }
    if (setting.credentialMode === "DISABLED") return;
    const envelope = this.databaseEnvelope(setting);
    this.crypto.validateEnvelope(envelope, setting.credentialRevision);
  }

  private environmentCredential(): ResolvedMedusaCredential {
    const apiKey = process.env.MEDUSA_ADMIN_API_KEY?.trim();
    if (!apiKey)
      throw new MedusaConnectionError("MEDUSA_CONNECTION_NOT_CONFIGURED");
    const digest = createHash("sha256").update(apiKey).digest("hex");
    return { apiKey, source: "env", revision: `env:${digest.slice(0, 16)}` };
  }

  private databaseCredential(
    setting: MedusaConnectionSettingRecord,
  ): ResolvedMedusaCredential {
    const envelope = this.databaseEnvelope(setting);
    const apiKey = this.crypto.decrypt(envelope, setting.credentialRevision);
    return {
      apiKey,
      source: "database",
      revision: `db:${setting.credentialRevision}`,
    };
  }

  private databaseEnvelope(
    setting: MedusaConnectionSettingRecord,
  ): MedusaCredentialEnvelope {
    if (
      !setting.encryptedApiKey ||
      !setting.encryptionIv ||
      !setting.authenticationTag ||
      !setting.keyVersion
    )
      throw new MedusaConnectionError("MEDUSA_CREDENTIAL_ENVELOPE_INVALID");
    return {
      encryptedApiKey: Buffer.from(setting.encryptedApiKey),
      encryptionIv: Buffer.from(setting.encryptionIv),
      authenticationTag: Buffer.from(setting.authenticationTag),
      keyVersion: setting.keyVersion,
    };
  }
}
