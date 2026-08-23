import { createPrivateKey, sign } from "node:crypto";
import { connect, constants, type ClientHttp2Session } from "node:http2";

import type { ApnsConfig } from "./apns.config.js";

/**
 * A minimal APNs sender: one signed token, one HTTP/2 POST per device.
 *
 * Written here rather than pulled in as a dependency, deliberately. The whole
 * protocol is a JWT and a POST, and this is the path a real notification takes
 * to a technician's phone: a library in the middle would be one more thing to
 * keep current, and its behaviour is what the tests would end up describing
 * instead of ours.
 */

/** Apple accepts a token for an hour; it is refreshed well before that. */
const TOKEN_LIFETIME_MS = 45 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ApnsMessage {
  /** The raw device token, as the phone reported it. */
  deviceToken: string;
  /** The app variant the token belongs to (`apns-topic`). */
  bundleId: string;
  title: string;
  body: string;
  /** Travels with the notification so a tap can open the right screen. */
  data?: Record<string, string>;
}

export type ApnsResult =
  | { ok: true }
  /**
   * The device is gone: uninstalled, or the token belongs to another app
   * variant. These two answers are the only ones that mean "stop keeping this
   * token", and they are named so the caller does not have to know the
   * protocol to act on them.
   */
  | { ok: false; retired: true; reason: string }
  | { ok: false; retired: false; reason: string };

function signedToken(config: ApnsConfig, issuedAt: number): string {
  const header = { alg: "ES256", kid: config.keyId };
  const payload = { iss: config.teamId, iat: Math.floor(issuedAt / 1000) };
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode(header)}.${encode(payload)}`;

  // `ieee-p1363` is the r||s form JWT requires. Node's default for ECDSA is
  // DER, which Apple rejects as a malformed token - and the error it answers
  // with says nothing about encoding.
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: createPrivateKey(config.signingKey),
    dsaEncoding: "ieee-p1363",
  });

  return `${unsigned}.${signature.toString("base64url")}`;
}

export class ApnsClient {
  private session: ClientHttp2Session | null = null;
  private token: { value: string; issuedAt: number } | null = null;

  constructor(
    private readonly config: ApnsConfig,
    private readonly now: () => number = Date.now,
  ) {}

  private authorization(): string {
    const now = this.now();
    if (!this.token || now - this.token.issuedAt > TOKEN_LIFETIME_MS)
      this.token = { value: signedToken(this.config, now), issuedAt: now };
    return `bearer ${this.token.value}`;
  }

  private connection(): ClientHttp2Session {
    if (this.session && !this.session.closed && !this.session.destroyed)
      return this.session;
    const session = connect(`https://${this.config.host}`);
    // A dropped connection is normal: Apple closes idle sessions, and the next
    // send opens a new one. Without a listener the error would reach the
    // process as an unhandled event and take the API down with it.
    session.on("error", () => {
      if (this.session === session) this.session = null;
    });
    this.session = session;
    return session;
  }

  async send(message: ApnsMessage): Promise<ApnsResult> {
    const payload = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: "default",
      },
      ...message.data,
    });

    return new Promise<ApnsResult>((resolve) => {
      let settled = false;
      const settle = (result: ApnsResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let request;
      try {
        request = this.connection().request({
          [constants.HTTP2_HEADER_METHOD]: "POST",
          [constants.HTTP2_HEADER_PATH]: `/3/device/${message.deviceToken}`,
          [constants.HTTP2_HEADER_AUTHORIZATION]: this.authorization(),
          "apns-topic": message.bundleId,
          "apns-push-type": "alert",
          [constants.HTTP2_HEADER_CONTENT_TYPE]: "application/json",
        });
      } catch (cause) {
        settle({
          ok: false,
          retired: false,
          reason: cause instanceof Error ? cause.message : "connection failed",
        });
        return;
      }

      request.setTimeout(REQUEST_TIMEOUT_MS, () => {
        request.close();
        settle({ ok: false, retired: false, reason: "timeout" });
      });

      let status = 0;
      let body = "";
      request.on("response", (headers) => {
        status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
      });
      request.on("data", (chunk: Buffer | string) => {
        body += chunk.toString();
      });
      request.on("error", (cause: Error) => {
        settle({ ok: false, retired: false, reason: cause.message });
      });
      request.on("end", () => {
        if (status === 200) {
          settle({ ok: true });
          return;
        }
        const reason = readReason(body) ?? `HTTP ${status}`;
        // 410 is Apple saying the device is gone for good. 400 with these two
        // reasons means the token was never ours to use. Everything else may
        // be transient, and a transient failure must not throw away a token
        // that will work again in a minute.
        const retired =
          status === 410 ||
          reason === "BadDeviceToken" ||
          reason === "DeviceTokenNotForTopic";
        settle({ ok: false, retired, reason });
      });

      request.end(payload);
    });
  }

  close(): void {
    this.session?.close();
    this.session = null;
  }
}

function readReason(body: string): string | null {
  if (!body) return null;
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "reason" in parsed) {
      const reason = (parsed as { reason: unknown }).reason;
      return typeof reason === "string" ? reason : null;
    }
  } catch {
    return null;
  }
  return null;
}
