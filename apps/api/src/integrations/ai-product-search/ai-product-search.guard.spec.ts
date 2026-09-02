import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AI_USER_CONTEXT_TOKEN_ID_ENV } from "../ai/ai-user-context.config.js";
import { AI_PRODUCT_SEARCH_TOKEN_ID_ENV } from "./ai-product-search.config.js";
import {
  AiProductSearchGuard,
  type AiProductSearchRequest,
} from "./ai-product-search.guard.js";

const SEARCH_TOKEN_ID = "token-ai-search";
const USER_CONTEXT_TOKEN_ID = "token-ai-user-context";

const searchToken = {
  id: SEARCH_TOKEN_ID,
  name: "Acropora AI product search",
  slug: "ai-product-search",
  tokenHash: "hash",
  userId: null,
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-27T08:00:00.000Z"),
};

/** The OTHER AI token: live, legitimate, and for a different door. */
const userContextToken = {
  ...searchToken,
  id: USER_CONTEXT_TOKEN_ID,
  slug: "ai-user-context",
};

const contextFor = (request: AiProductSearchRequest) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

const repository = (findActive: unknown) =>
  ({ findActive }) as unknown as ServiceTokenRepository;

const bearer = { authorization: "Bearer raw-value" };

const configured: NodeJS.ProcessEnv = {
  [AI_PRODUCT_SEARCH_TOKEN_ID_ENV]: SEARCH_TOKEN_ID,
};

describe("AiProductSearchGuard", () => {
  it("accepts the dedicated token and attaches it", async () => {
    const request: AiProductSearchRequest = { headers: bearer };
    const guard = new AiProductSearchGuard(
      repository(async () => searchToken),
      configured,
    );

    assert.equal(await guard.canActivate(contextFor(request)), true);
    assert.equal(request.aiServiceToken?.id, SEARCH_TOKEN_ID);
  });

  it("REFUSES the user-context token, which is live and for another door", async () => {
    /**
     * The assertion this whole separate mechanism exists for.
     *
     * The user-context token is valid, unrevoked, and belongs to the same AI
     * agent - and it must not open the catalogue. If one token opened both,
     * a leaked credential would carry two systems instead of one, and nothing
     * in either response would show which door it came through.
     */
    const guard = new AiProductSearchGuard(
      repository(async () => userContextToken),
      configured,
    );

    await assert.rejects(
      guard.canActivate(contextFor({ headers: bearer })),
      UnauthorizedException,
    );
  });

  it("refuses everything when the allowlist is unconfigured", async () => {
    /**
     * Written the other way round this would be the most dangerous line in
     * the module: an empty allowlist meaning "no restriction" turns a
     * forgotten environment variable into an open door onto the catalogue.
     */
    const guard = new AiProductSearchGuard(
      repository(async () => searchToken),
      {},
    );

    await assert.rejects(
      guard.canActivate(contextFor({ headers: bearer })),
      UnauthorizedException,
    );
  });

  it("is not satisfied by the OTHER endpoint's configuration", async () => {
    // Setting up the sibling endpoint must not silently configure this one.
    const guard = new AiProductSearchGuard(
      repository(async () => searchToken),
      { [AI_USER_CONTEXT_TOKEN_ID_ENV]: SEARCH_TOKEN_ID },
    );

    await assert.rejects(
      guard.canActivate(contextFor({ headers: bearer })),
      UnauthorizedException,
    );
  });

  it("refuses a missing, malformed or unknown credential", async () => {
    const guard = new AiProductSearchGuard(
      repository(async () => null),
      configured,
    );

    for (const headers of [
      {},
      { authorization: "raw-value" },
      { authorization: "Basic raw-value" },
      { authorization: "Bearer " },
    ]) {
      await assert.rejects(
        guard.canActivate(contextFor({ headers })),
        UnauthorizedException,
      );
    }
  });
});
