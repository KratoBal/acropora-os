import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { UnasApiClient, UnasApiError } from "./unas-api.client.js";
import { UnasConnectionError } from "./unas-connection.types.js";
import {
  UnasCredentialProvider,
  type ResolvedUnasCredential,
} from "./unas-credential.provider.js";
import {
  assertValidUnasLoginExpiry,
  UnasClock,
  UNAS_TOKEN_MIN_REMAINING_MS,
} from "./unas-login-expiry.js";

const REFRESH_MARGIN_MS = UNAS_TOKEN_MIN_REMAINING_MS;

@Injectable()
export class UnasAuthService {
  private cached: {
    token: string;
    expiresAtMs: number;
    credentialRevision: string;
  } | null = null;
  private inFlight: { revision: string; promise: Promise<string> } | null =
    null;
  private latestRequestedRevision: string | null = null;

  constructor(
    private readonly api: UnasApiClient,
    private readonly credentials: UnasCredentialProvider,
    private readonly clock: UnasClock,
  ) {}

  async getToken(): Promise<string> {
    let credential: ResolvedUnasCredential;
    try {
      credential = await this.credentials.resolve();
    } catch (error) {
      const code =
        error instanceof UnasConnectionError
          ? error.code
          : "UNAS_CONNECTION_FAILED";
      throw new ServiceUnavailableException(code);
    }
    if (
      this.cached?.credentialRevision === credential.revision &&
      this.clock.nowMs() < this.cached.expiresAtMs - REFRESH_MARGIN_MS
    )
      return this.cached.token;
    if (this.inFlight?.revision === credential.revision)
      return this.inFlight.promise;
    this.latestRequestedRevision = credential.revision;
    const promise = this.login(credential).finally(() => {
      if (this.inFlight?.promise === promise) this.inFlight = null;
    });
    this.inFlight = { revision: credential.revision, promise };
    return promise;
  }

  private async login(credential: ResolvedUnasCredential): Promise<string> {
    let result: Awaited<ReturnType<UnasApiClient["login"]>>;
    try {
      result = await this.api.login(credential.apiKey);
      assertValidUnasLoginExpiry(result.expireTime, this.clock.nowMs());
    } catch (error) {
      const code =
        error instanceof UnasApiError
          ? `UNAS_AUTH_${error.code}`
          : "UNAS_CONNECTION_FAILED";
      throw new ServiceUnavailableException(code);
    }
    if (this.latestRequestedRevision === credential.revision)
      this.cached = {
        token: result.token,
        expiresAtMs: result.expireTime * 1000,
        credentialRevision: credential.revision,
      };
    return result.token;
  }
}
