import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { SzamlazzConnectionRepository } from "./szamlazz-connection.repository.js";
import {
  SzamlazzConnectionError,
  type SzamlazzConnectionSettingRecord,
  type SzamlazzCredentialEnvelope,
} from "./szamlazz-connection.types.js";
import { SzamlazzCredentialCryptoService } from "./szamlazz-credential-crypto.service.js";

/**
 * Honnan jön az Agent Key FUTÁSIDŐBEN -- a Medusa `ResolvedMedusaCredential`
 * mintája.
 */
export interface ResolvedSzamlazzCredential {
  agentKey: string;
  /** Melyik úton jött. Az `env` érték átmeneti állapotot jelöl. */
  source: "database" | "env";
  /**
   * A kulcs AZONOSSÁGA, nem a kulcs. Tárolt kulcsnál a revízió, környezetiből
   * származónál a tartalom lenyomata. Naplóba ez mehet, a kulcs nem.
   */
  revision: string;
}

@Injectable()
export class SzamlazzCredentialProvider {
  constructor(
    private readonly repository: SzamlazzConnectionRepository,
    private readonly crypto: SzamlazzCredentialCryptoService,
  ) {}

  async resolve(): Promise<ResolvedSzamlazzCredential> {
    const setting = await this.repository.getSetting();
    if (!setting)
      throw new SzamlazzConnectionError(
        "SZAMLAZZ_CONNECTION_CONFIGURATION_MISSING",
      );
    return this.resolveRecord(setting);
  }

  resolveRecord(
    setting: SzamlazzConnectionSettingRecord,
  ): ResolvedSzamlazzCredential {
    if (setting.credentialMode === "ENV_FALLBACK")
      return this.environmentCredential();
    if (setting.credentialMode === "DISABLED")
      throw new SzamlazzConnectionError("SZAMLAZZ_CONNECTION_DISABLED");
    return this.databaseCredential(setting);
  }

  /**
   * Ellenőrzés írás nélkül: a tárolt boríték visszafejthető-e. Ugyanaz a
   * szerep, mint a Medusa `validateRecord`-jánál: a "még nincs beállítva"
   * eset elindulhat, a "van, de sérült" viszont hangos konfigurációs hiba.
   */
  validateRecord(setting: SzamlazzConnectionSettingRecord): void {
    if (setting.credentialMode === "ENV_FALLBACK") {
      if (!process.env.SZAMLAZZ_AGENT_KEY?.trim())
        throw new SzamlazzConnectionError("SZAMLAZZ_CONNECTION_NOT_CONFIGURED");
      return;
    }
    if (setting.credentialMode === "DISABLED") return;
    const envelope = this.databaseEnvelope(setting);
    this.crypto.validateEnvelope(envelope, setting.credentialRevision);
  }

  private environmentCredential(): ResolvedSzamlazzCredential {
    const agentKey = process.env.SZAMLAZZ_AGENT_KEY?.trim();
    if (!agentKey)
      throw new SzamlazzConnectionError("SZAMLAZZ_CONNECTION_NOT_CONFIGURED");
    const digest = createHash("sha256").update(agentKey).digest("hex");
    return {
      agentKey,
      source: "env",
      revision: `env:${digest.slice(0, 16)}`,
    };
  }

  private databaseCredential(
    setting: SzamlazzConnectionSettingRecord,
  ): ResolvedSzamlazzCredential {
    const envelope = this.databaseEnvelope(setting);
    const agentKey = this.crypto.decrypt(envelope, setting.credentialRevision);
    return {
      agentKey,
      source: "database",
      revision: `db:${setting.credentialRevision}`,
    };
  }

  private databaseEnvelope(
    setting: SzamlazzConnectionSettingRecord,
  ): SzamlazzCredentialEnvelope {
    if (
      !setting.encryptedAgentKey ||
      !setting.agentKeyEncryptionIv ||
      !setting.agentKeyAuthenticationTag ||
      !setting.agentKeyVersion
    )
      throw new SzamlazzConnectionError("SZAMLAZZ_CREDENTIAL_ENVELOPE_INVALID");
    return {
      encryptedAgentKey: Buffer.from(setting.encryptedAgentKey),
      encryptionIv: Buffer.from(setting.agentKeyEncryptionIv),
      authenticationTag: Buffer.from(setting.agentKeyAuthenticationTag),
      keyVersion: setting.agentKeyVersion,
    };
  }
}
