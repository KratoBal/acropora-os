import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AI_PRODUCT_SEARCH_TOKEN_ID_ENV } from "../ai-product-search/ai-product-search.config.js";
import { WEBSHOP_MAIL_TOKEN_ID_ENV } from "./webshop-mail.config.js";
import { WebshopMailGuard } from "./webshop-mail.guard.js";

const token = (id: string) => ({
  id,
  name: id,
  slug: id,
  tokenHash: "hash",
  userId: null,
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-10-05T20:00:00.000Z"),
});

const context = (authorization?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  }) as unknown as ExecutionContext;

const repository = (found: ReturnType<typeof token> | null) =>
  ({ findActive: async () => found }) as unknown as ServiceTokenRepository;

const configured: NodeJS.ProcessEnv = {
  [WEBSHOP_MAIL_TOKEN_ID_ENV]: "token-webshop-mail",
  [AI_PRODUCT_SEARCH_TOKEN_ID_ENV]: "token-ai-search",
};

describe("WebshopMailGuard", () => {
  it("accepts its own token", async () => {
    const guard = new WebshopMailGuard(
      repository(token("token-webshop-mail")),
      configured,
    );
    assert.equal(await guard.canActivate(context("Bearer raw")), true);
  });

  it("refuses another live service token, as if it were unknown", async () => {
    const guard = new WebshopMailGuard(
      repository(token("token-ai-search")),
      configured,
    );
    await assert.rejects(
      guard.canActivate(context("Bearer raw")),
      UnauthorizedException,
    );
  });

  it("refuses everything when its token is not configured", async () => {
    const guard = new WebshopMailGuard(
      repository(token("token-webshop-mail")),
      {},
    );
    await assert.rejects(
      guard.canActivate(context("Bearer raw")),
      UnauthorizedException,
    );
  });

  it("refuses a missing or non-Bearer header without a lookup", async () => {
    let lookups = 0;
    const guard = new WebshopMailGuard(
      {
        findActive: async () => (lookups++, token("token-webshop-mail")),
      } as unknown as ServiceTokenRepository,
      configured,
    );
    await assert.rejects(guard.canActivate(context()), UnauthorizedException);
    await assert.rejects(
      guard.canActivate(context("Basic raw")),
      UnauthorizedException,
    );
    assert.equal(lookups, 0);
  });
});
