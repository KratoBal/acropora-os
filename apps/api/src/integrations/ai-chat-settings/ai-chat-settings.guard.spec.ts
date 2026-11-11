import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { AI_PRODUCT_SEARCH_TOKEN_ID_ENV } from "../ai-product-search/ai-product-search.config.js";
import { WEBSHOP_MAIL_TOKEN_ID_ENV } from "../webshop-mail/webshop-mail.config.js";
import { AI_CHAT_SETTINGS_TOKEN_ID_ENV } from "./ai-chat-settings.config.js";
import { AiChatSettingsGuard } from "./ai-chat-settings.guard.js";

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
  [AI_CHAT_SETTINGS_TOKEN_ID_ENV]: "token-ai-settings",
  [AI_PRODUCT_SEARCH_TOKEN_ID_ENV]: "token-ai-search",
  [WEBSHOP_MAIL_TOKEN_ID_ENV]: "token-webshop-mail",
};

describe("AiChatSettingsGuard (S16: the token that reads the settings opens no other door, and no other token opens this one)", () => {
  it("accepts its own token", async () => {
    const guard = new AiChatSettingsGuard(
      repository(token("token-ai-settings")),
      configured,
    );
    assert.equal(await guard.canActivate(context("Bearer raw")), true);
  });

  it("refuses the other live service tokens, as if they were unknown", async () => {
    for (const other of [
      "token-ai-search",
      "token-webshop-mail",
      "token-ai-contact",
      "token-something-else",
    ]) {
      const guard = new AiChatSettingsGuard(
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

  it("refuses an unknown or revoked token (the repository finds nothing)", async () => {
    const guard = new AiChatSettingsGuard(repository(null), configured);
    await assert.rejects(
      guard.canActivate(context("Bearer raw")),
      UnauthorizedException,
    );
  });

  it("refuses everything when its token is not configured, even the token that WOULD match", async () => {
    for (const env of [
      {},
      { [AI_CHAT_SETTINGS_TOKEN_ID_ENV]: "" },
      { [AI_CHAT_SETTINGS_TOKEN_ID_ENV]: "   " },
    ]) {
      const guard = new AiChatSettingsGuard(
        repository(token("token-ai-settings")),
        env,
      );
      await assert.rejects(
        guard.canActivate(context("Bearer raw")),
        UnauthorizedException,
      );
    }
  });

  it("refuses a missing or non-Bearer header without a lookup", async () => {
    let lookups = 0;
    const guard = new AiChatSettingsGuard(
      {
        findActive: async () => {
          lookups += 1;
          return token("token-ai-settings");
        },
      } as unknown as ServiceTokenRepository,
      configured,
    );
    for (const header of [undefined, "", "Basic raw", "Bearer"])
      await assert.rejects(
        guard.canActivate(context(header)),
        UnauthorizedException,
        String(header),
      );
    assert.equal(lookups, 0);
  });
});
