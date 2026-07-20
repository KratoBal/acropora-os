import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import { UnasApiClient } from "./unas-api.client.js";

const REFRESH_MARGIN_MS = 60_000;

@Injectable()
export class UnasAuthService {
  private cached: { token: string; expiresAtMs: number } | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly api: UnasApiClient) {}

  getToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAtMs - REFRESH_MARGIN_MS)
      return Promise.resolve(this.cached.token);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.login().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async login(): Promise<string> {
    const apiKey = process.env.UNAS_API_KEY?.trim();
    if (!apiKey)
      throw new ServiceUnavailableException("UNAS_API_KEY_NOT_CONFIGURED");
    const result = await this.api.login(apiKey);
    this.cached = {
      token: result.token,
      expiresAtMs: result.expireTime * 1000,
    };
    return result.token;
  }
}
