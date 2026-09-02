import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AI_USER_CONTEXT_TOKEN_ID_ENV } from "./ai-user-context.config.js";
import {
  AiUserContextGuard,
  type AiUserContextRequest,
} from "./ai-user-context.guard.js";

const DEDICATED_ID = "token-ai";

const dedicatedToken = {
  id: DEDICATED_ID,
  name: "Acropora AI",
  slug: "ai-user-context",
  tokenHash: "hash",
  userId: null,
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-25T10:00:00.000Z"),
};

/** A live token that belongs to somebody else - the fleet's task ingest, say. */
const otherLiveToken = { ...dedicatedToken, id: "token-polip", slug: "polip" };

const contextFor = (request: AiUserContextRequest) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const repository = (findActive: unknown) =>
  ({ findActive }) as unknown as ServiceTokenRepository;

const bearer = { authorization: "Bearer raw-value" };

const configured: NodeJS.ProcessEnv = {
  [AI_USER_CONTEXT_TOKEN_ID_ENV]: DEDICATED_ID,
};

describe("AiUserContextGuard", () => {
  it("accepts the dedicated token and attaches it to the request", async () => {
    const guard = new AiUserContextGuard(
      repository(async () => dedicatedToken),
      configured,
    );
    const request: AiUserContextRequest = { headers: { ...bearer } };

    assert.equal(await guard.canActivate(contextFor(request)), true);
    assert.equal(request.aiServiceToken?.id, DEDICATED_ID);
  });

  it("rejects a live token that is not the dedicated record", async () => {
    // The whole point of the allowlist: every token that exists today keeps
    // exactly the reach it had before this endpoint was written.
    const guard = new AiUserContextGuard(
      repository(async () => otherLiveToken),
      configured,
    );

    await assert.rejects(
      () => guard.canActivate(contextFor({ headers: { ...bearer } })),
      UnauthorizedException,
    );
  });

  it("rejects everything when the allowlist is not configured", async () => {
    // The failure mode this guard exists to prevent: a missing environment
    // variable must not mean "no restriction". Note the repository would have
    // returned the dedicated token - the refusal is the configuration's, not
    // the credential's.
    const guard = new AiUserContextGuard(
      repository(async () => dedicatedToken),
      {},
    );

    await assert.rejects(
      () => guard.canActivate(contextFor({ headers: { ...bearer } })),
      UnauthorizedException,
    );
  });

  it("rejects a blank allowlist value the same way as a missing one", async () => {
    const guard = new AiUserContextGuard(
      repository(async () => dedicatedToken),
      {
        [AI_USER_CONTEXT_TOKEN_ID_ENV]: "   ",
      },
    );

    await assert.rejects(
      () => guard.canActivate(contextFor({ headers: { ...bearer } })),
      UnauthorizedException,
    );
  });

  it("rejects a request with no Authorization header", async () => {
    const guard = new AiUserContextGuard(
      repository(async () => dedicatedToken),
      configured,
    );

    await assert.rejects(
      () => guard.canActivate(contextFor({ headers: {} })),
      UnauthorizedException,
    );
  });

  it("rejects a non-Bearer scheme", async () => {
    const guard = new AiUserContextGuard(
      repository(async () => dedicatedToken),
      configured,
    );

    await assert.rejects(
      () =>
        guard.canActivate(
          contextFor({ headers: { authorization: "Basic c3ZjOnN2Yw==" } }),
        ),
      UnauthorizedException,
    );
  });

  it("rejects an unknown or revoked token without saying which", async () => {
    const guard = new AiUserContextGuard(
      repository(async () => null),
      configured,
    );

    await assert.rejects(
      () => guard.canActivate(contextFor({ headers: { ...bearer } })),
      UnauthorizedException,
    );
  });

  it("does not look the token up before the allowlist is known", async () => {
    // Ordering matters: an unconfigured deployment should not send a raw
    // value to the database at all.
    let lookups = 0;
    const guard = new AiUserContextGuard(
      repository(async () => {
        lookups += 1;
        return dedicatedToken;
      }),
      {},
    );

    await assert.rejects(() =>
      guard.canActivate(contextFor({ headers: { ...bearer } })),
    );
    assert.equal(lookups, 0);
  });
});
