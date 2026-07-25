import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";

import { UnasConnectionRepository } from "./unas-connection.repository.js";
import { UnasConnectionError } from "./unas-connection.types.js";
import { UnasCredentialCryptoService } from "./unas-credential-crypto.service.js";
import { UnasCredentialProvider } from "./unas-credential.provider.js";

@Injectable()
export class UnasConnectionStartupValidator implements OnModuleInit {
  private readonly logger = new Logger(UnasConnectionStartupValidator.name);

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
      // Not yet having a UNAS credential is an expected, recoverable state
      // (every fresh install starts in ENV_FALLBACK mode with no
      // UNAS_API_KEY set) — not a misconfiguration. Warn and let the app
      // start so the user can set the connection up from the Connection
      // Settings page; every other UnasConnectionError code (a genuinely
      // broken master key, a corrupt stored credential, etc.) still blocks
      // startup exactly as before.
      if (
        error instanceof UnasConnectionError &&
        error.code === "UNAS_CONNECTION_NOT_CONFIGURED"
      ) {
        this.logger.warn(
          "UNAS connection is not configured yet (UNAS_CONNECTION_NOT_CONFIGURED) — " +
            "starting up anyway. Configure it on the Connection Settings page.",
        );
        return;
      }
      const code =
        error instanceof UnasConnectionError
          ? error.code
          : "UNAS_CONNECTION_FAILED";
      throw new Error(code);
    }
  }
}
