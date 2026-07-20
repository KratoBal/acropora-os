import { Injectable, type OnModuleInit } from "@nestjs/common";

import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionError } from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";

@Injectable()
export class UnasConnectionStartupValidator implements OnModuleInit {
  constructor(
    private readonly repository: UnasConnectionRepository,
    private readonly crypto: UnasCredentialCryptoService,
    private readonly credentials: UnasCredentialProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    try {
      const setting = await this.repository.getSetting();
      if (!setting)
        throw new UnasConnectionError("UNAS_CONNECTION_CONFIGURATION_MISSING");
      this.crypto.validateActiveKey();
      this.credentials.validateRecord(setting);
    } catch (error) {
      const code =
        error instanceof UnasConnectionError
          ? error.code
          : "UNAS_CONNECTION_FAILED";
      throw new Error(code);
    }
  }
}
