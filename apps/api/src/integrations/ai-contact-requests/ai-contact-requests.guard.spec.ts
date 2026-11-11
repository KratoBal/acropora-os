import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AI_CHAT_SETTINGS_TOKEN_ID_ENV } from "../ai-chat-settings/ai-chat-settings.config.js";
import { AI_PRODUCT_SEARCH_TOKEN_ID_ENV } from "../ai-product-search/ai-product-search.config.js";
import { WEBSHOP_MAIL_TOKEN_ID_ENV } from "../webshop-mail/webshop-mail.config.js";
import { AI_CONTACT_TOKEN_ID_ENV } from "./ai-contact-requests.config.js";
import { AiContactRequestsGuard } from "./ai-contact-requests.guard.js";

const token = (id: string) => ({
  id,
  name: id,
  slug: id,
  tokenHash: "hash",
  userId: null,
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-11-11T09:00:00.000Z"),
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
  [AI_CONTACT_TOKEN_ID_ENV]: "token-ai-contact",
  [AI_CHAT_SETTINGS_TOKEN_ID_ENV]: "token-ai-settings",
  [AI_PRODUCT_SEARCH_TOKEN_ID_ENV]: "token-ai-search",
  [WEBSHOP_MAIL_TOKEN_ID_ENV]: "token-webshop-mail",
};

describe("AiContactRequestsGuard (the token that writes a request opens no other door, and no other token opens this one)", () => {
  it("accepts its own token", async () => {
    const guard = new AiContactRequestsGuard(
      repository(token("token-ai-contact")),
      configured,
    );
    assert.equal(await guard.canActivate(context("Bearer raw")), true);
  });

  it("refuses every other live service token, the settings READER included, as if it were unknown", async () => {
    for (const other of [
      "token-ai-settings",
      "token-ai-search",
      "token-webshop-mail",
      "token-something-else",
    ]) {
      const guard = new AiContactRequestsGuard(
        repository(token(other)),
        configured,
      );
      await assert.rejects(
        guard.canActivate(context("Bearer raw")),
        UnauthorizedException,
        other,
      );
    }
  });

  it("refuses an unknown or revoked token, a missing or non-Bearer header", async () => {
    const guard = new AiContactRequestsGuard(repository(null), configured);
    for (const header of [undefined, "", "Bearer", "Basic raw", "Bearer raw"])
      await assert.rejects(
        guard.canActivate(context(header)),
        UnauthorizedException,
        String(header),
      );
  });

  it("accepts NOTHING while the record is not configured, whatever token comes", async () => {
    for (const environment of [
      {},
      { [AI_CONTACT_TOKEN_ID_ENV]: "" },
      { [AI_CONTACT_TOKEN_ID_ENV]: "   " },
    ])
      await assert.rejects(
        new AiContactRequestsGuard(
          repository(token("token-ai-contact")),
          environment,
        ).canActivate(context("Bearer raw")),
        UnauthorizedException,
      );
  });
});
