import { Injectable, type OnModuleInit } from "@nestjs/common";

import { NavConnectionRepository } from "./nav-connection.repository.js";
import { NavConnectionError } from "./nav-connection.types.js";
import { NavCredentialCryptoService } from "./nav-credential-crypto.service.js";
import { NavCredentialsService } from "./nav-credentials.service.js";

@Injectable()
export class NavConnectionStartupValidator implements OnModuleInit {
  constructor(
    private readonly repository: NavConnectionRepository,
    private readonly crypto: NavCredentialCryptoService,
    private readonly credentials: NavCredentialsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    const setting = await this.repository.getSetting();
    if (!setting) throw new Error("NAV_CONNECTION_CONFIGURATION_MISSING");
    if (setting.credentialMode !== "DATABASE") return;
    try {
      this.crypto.validateActiveKey();
      this.credentials.validateRecord(setting);
    } catch (error) {
      const code =
        error instanceof NavConnectionError
          ? error.code
          : "NAV_CONNECTION_FAILED";
      throw new Error(code);
    }
  }
}
