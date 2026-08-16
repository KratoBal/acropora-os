import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import {
  ServiceTokenGuard,
  type ServiceTokenRequest,
} from "./service-token.guard.js";
import type { ServiceTokenRepository } from "./service-token.repository.js";

const liveToken = {
  id: "token-1",
  name: "Flotta",
  slug: "polip",
  tokenHash: "hash",
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-16T10:00:00.000Z"),
};

const contextFor = (request: ServiceTokenRequest) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const repository = (findActive: unknown) =>
  ({ findActive }) as unknown as ServiceTokenRepository;

describe("ServiceTokenGuard", () => {
  it("rejects a request with no Authorization header", async () => {
    const guard = new ServiceTokenGuard(repository(async () => liveToken));
    await assert.rejects(
      () => guard.canActivate(contextFor({ headers: {} })),
      UnauthorizedException,
    );
  });

  it("rejects a non-Bearer scheme", async () => {
    const guard = new ServiceTokenGuard(repository(async () => liveToken));
    await assert.rejects(
      () =>
        guard.canActivate(
          contextFor({ headers: { authorization: "Basic c3ZjOnN2Yw==" } }),
        ),
      UnauthorizedException,
    );
  });

  it("rejects an unknown or revoked token without saying which", async () => {
    const guard = new ServiceTokenGuard(repository(async () => null));
    await assert.rejects(
      () =>
        guard.canActivate(
          contextFor({ headers: { authorization: "Bearer svc_nope" } }),
        ),
      (error: unknown) =>
        error instanceof UnauthorizedException &&
        error.message === "Érvénytelen token.",
    );
  });

  it("never consults a session cookie", async () => {
    let lookedUp: string | undefined;
    const guard = new ServiceTokenGuard(
      repository(async (raw: string) => {
        lookedUp = raw;
        return null;
      }),
    );
    const request = {
      headers: {
        authorization: "Bearer svc_raw",
        cookie: "acropora_session=a-real-user-session",
      },
    } as ServiceTokenRequest & { headers: { cookie: string } };

    await assert.rejects(() => guard.canActivate(contextFor(request)));
    assert.equal(lookedUp, "svc_raw");
  });

  it("attaches the resolved token to the request", async () => {
    const guard = new ServiceTokenGuard(repository(async () => liveToken));
    const request: ServiceTokenRequest = {
      headers: { authorization: "Bearer svc_raw" },
    };

    assert.equal(await guard.canActivate(contextFor(request)), true);
    assert.equal(request.serviceToken?.slug, "polip");
  });
});
