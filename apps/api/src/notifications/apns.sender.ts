import { Injectable, Logger } from "@nestjs/common";

import {
  ApnsClient,
  type ApnsMessage,
  type ApnsResult,
} from "./apns.client.js";
import { readApnsConfig } from "./apns.config.js";

/**
 * The one place that knows whether this deployment can send at all.
 *
 * It exists as its own service so that everything above it - who to notify,
 * what to say, what to do with a dead token - can be tested without a signing
 * key, a network, or Apple. The configuration is read once, lazily: a
 * development machine has none, and that is a normal state, not a failure.
 */
export interface ApnsSending {
  send(message: ApnsMessage): Promise<ApnsResult>;
  configured(): boolean;
}

@Injectable()
export class ApnsSender implements ApnsSending {
  private readonly logger = new Logger(ApnsSender.name);
  private client: ApnsClient | null = null;
  private resolved = false;

  private resolve(): ApnsClient | null {
    if (this.resolved) return this.client;
    this.resolved = true;

    const result = readApnsConfig();
    if (!result.configured) {
      this.logger.log(
        `Push értesítés kikapcsolva, hiányzó beállítás: ${result.missing.join(", ")}`,
      );
      return null;
    }
    this.client = new ApnsClient(result.config);
    return this.client;
  }

  configured(): boolean {
    return this.resolve() !== null;
  }

  async send(message: ApnsMessage): Promise<ApnsResult> {
    const client = this.resolve();
    if (!client)
      return { ok: false, retired: false, reason: "APNs is not configured" };
    return client.send(message);
  }
}
