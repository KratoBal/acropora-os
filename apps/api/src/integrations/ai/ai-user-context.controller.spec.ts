import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";

import { AiUserContextController } from "./ai-user-context.controller.js";
import type { AiUserContextService } from "./ai-user-context.service.js";

const context = {
  subjectType: "customer" as const,
  customerId: "cus_1",
  customerNumber: "V-00123",
  entitlements: {},
  entitlementsStatus: "not-modelled" as const,
  entitlementsNote: "…",
};

const service = (forCustomer: unknown) =>
  ({ forCustomer }) as unknown as AiUserContextService;

describe("AiUserContextController", () => {
  it("refuses a missing subject header", async () => {
    // The global ValidationPipe does not see headers, so this check is the
    // only thing standing between a missing header and a pointless lookup.
    const controller = new AiUserContextController(
      service(async () => context),
    );

    assert.throws(() => controller.userContext(undefined), BadRequestException);
  });

  it("refuses a blank subject header", async () => {
    const controller = new AiUserContextController(
      service(async () => context),
    );

    assert.throws(() => controller.userContext("   "), BadRequestException);
  });

  it("passes the trimmed id through", async () => {
    let asked: string | undefined;
    const controller = new AiUserContextController(
      service(async (id: string) => {
        asked = id;
        return context;
      }),
    );

    assert.equal(await controller.userContext("  cus_1  "), context);
    assert.equal(asked, "cus_1");
  });
});
