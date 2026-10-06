import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

import type { ServiceTokenRepository } from "../../tasks/service-token.repository.js";
import { WEBSHOP_MAIL_TOKEN_ID_ENV } from "../../integrations/webshop-mail/webshop-mail.config.js";
import { SUTYERAK_HANDOFF_TOKEN_ID_ENV } from "./sutyerak-handoff.config.js";
import { SutyerakHandoffGuard } from "./sutyerak-handoff.guard.js";

/*
  ACROBOT VISSZAÍRÁSÁNAK TOKENJE (4. pont B, 5. tétel). MI PIROSÍT: beállítás
  nélkül bármit enged; egy MÁSIK élő szolgáltatás-token (a webshop-levélé)
  is beenged; fejléc nélkül is keres.
*/
const token = (id: string) => ({
  id,
  name: id,
  slug: id,
  tokenHash: "hash",
  userId: null,
  dailyLimit: 200,
  lastUsedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-10-06T10:00:00.000Z"),
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
  [SUTYERAK_HANDOFF_TOKEN_ID_ENV]: "token-sutyerak-handoff",
  [WEBSHOP_MAIL_TOKEN_ID_ENV]: "token-webshop-mail",
};

describe("SutyerakHandoffGuard", () => {
  it("accepts its own token", async () => {
    const guard = new SutyerakHandoffGuard(
      repository(token("token-sutyerak-handoff")),
      configured,
    );
    assert.equal(await guard.canActivate(context("Bearer raw")), true);
  });

  it("refuses another live service token, as if it were unknown", async () => {
    const guard = new SutyerakHandoffGuard(
      repository(token("token-webshop-mail")),
      configured,
    );
    await assert.rejects(
      guard.canActivate(context("Bearer raw")),
      UnauthorizedException,
    );
  });

  it("refuses everything when its token is not configured", async () => {
    const guard = new SutyerakHandoffGuard(
      repository(token("token-sutyerak-handoff")),
      {},
    );
    await assert.rejects(
      guard.canActivate(context("Bearer raw")),
      UnauthorizedException,
    );
  });

  it("refuses a missing or non-Bearer header without a lookup", async () => {
    let lookups = 0;
    const guard = new SutyerakHandoffGuard(
      {
        findActive: async () => (lookups++, token("token-sutyerak-handoff")),
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
