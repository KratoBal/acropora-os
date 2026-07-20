import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";

import { UnasConnectionRepository } from "./unas-connection.repository.js";
import {
  UnasConnectionError,
  type UnasConnectionSettingRecord,
  type UnasCredentialEnvelope,
} from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";

export interface ResolvedUnasCredential {
  apiKey: string;
  revision: string;
}

@Injectable()
export class UnasCredentialProvider {
  constructor(
    private readonly repository: UnasConnectionRepository,
    private readonly crypto: UnasCredentialCryptoService,
  ) {}

  async resolve(): Promise<ResolvedUnasCredential> {
    const setting = await this.repository.getSetting();
    if (!setting)
      throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
    return this.resolveRecord(setting);
  }

  resolveRecord(setting: UnasConnectionSettingRecord): ResolvedUnasCredential {
    if (setting.credentialMode === "ENV_FALLBACK")
      return this.environmentCredential();
    if (setting.credentialMode === "DISABLED")
      throw new UnasConnectionError("UNAS_CONNECTION_DISABLED");
    return this.databaseCredential(setting);
  }

  validateRecord(setting: UnasConnectionSettingRecord): void {
    if (setting.credentialMode === "ENV_FALLBACK") {
      if (!process.env.UNAS_API_KEY?.trim())
        throw new UnasConnectionError("UNAS_CONNECTION_NOT_CONFIGURED");
      return;
    }
    if (setting.credentialMode === "DISABLED") return;
    const envelope = this.databaseEnvelope(setting);
    this.crypto.validateEnvelope(envelope, setting.credentialRevision);
  }

  private environmentCredential(): ResolvedUnasCredential {
    const apiKey = process.env.UNAS_API_KEY?.trim();
    if (!apiKey)
      throw new UnasConnectionError("UNAS_CONNECTION_NOT_CONFIGURED");
    const digest = createHash("sha256").update(apiKey).digest("hex");
    return { apiKey, revision: `env:${digest}` };
  }

  private databaseCredential(
    setting: UnasConnectionSettingRecord,
  ): ResolvedUnasCredential {
    const envelope = this.databaseEnvelope(setting);
    try {
      return {
        apiKey: this.crypto.decrypt(envelope, setting.credentialRevision),
        revision: `database:${setting.credentialRevision}`,
      };
    } catch (error) {
      if (error instanceof UnasConnectionError) throw error;
      throw new UnasConnectionError("UNAS_CREDENTIAL_DECRYPT_FAILED");
    }
  }

  private databaseEnvelope(
    setting: UnasConnectionSettingRecord,
  ): UnasCredentialEnvelope {
    if (
      !setting.encryptedApiKey ||
      !setting.encryptionIv ||
      !setting.authenticationTag ||
      !setting.keyVersion
    )
      throw new UnasConnectionError("UNAS_CREDENTIAL_ENVELOPE_INVALID");
    const envelope: UnasCredentialEnvelope = {
      encryptedApiKey: Buffer.from(setting.encryptedApiKey),
      encryptionIv: Buffer.from(setting.encryptionIv),
      authenticationTag: Buffer.from(setting.authenticationTag),
      keyVersion: setting.keyVersion,
    };
    return envelope;
  }
}
