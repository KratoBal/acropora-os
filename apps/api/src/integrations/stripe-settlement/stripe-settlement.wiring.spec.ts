import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { MedusaCredentialProvider } from "../medusa/medusa-credential.provider.js";
import { StripeSettlementController } from "./stripe-settlement.controller.js";
import { StripeSettlementScheduler } from "./stripe-settlement.scheduler.js";
import { StripeSettlementService } from "./stripe-settlement.service.js";
import { STRIPE_SETTLEMENT_STORE } from "./stripe-settlement.store.js";

// What the unit tests of the service cannot show: that Nest can build it. The service's client factory and environment are
// OPTIONAL tokens with no provider, so a wrong token or a missing @Optional fails here, at start, and not when the first
// request or the first timer tick arrives. The real module also imports the whole Medusa module (a database); this builds the same
// providers with the two outside ones faked.
@Module({
  controllers: [StripeSettlementController],
  providers: [
    { provide: MedusaCredentialProvider, useValue: {} },
    { provide: STRIPE_SETTLEMENT_STORE, useValue: {} },
    StripeSettlementService,
    StripeSettlementScheduler,
  ],
})
class WiringModule {}

describe("Stripe settlement wiring", () => {
  it("Nest builds the controller, the service and the scheduler", async () => {
    const saved = process.env.STRIPE_SETTLEMENT_SYNC_ENABLED;
    delete process.env.STRIPE_SETTLEMENT_SYNC_ENABLED; // the scheduler stays off: no timer is left behind
    const app = await NestFactory.createApplicationContext(WiringModule, {
      logger: false,
    });
    try {
      assert.ok(
        app.get(StripeSettlementService) instanceof StripeSettlementService,
      );
      assert.ok(
        app.get(StripeSettlementScheduler) instanceof StripeSettlementScheduler,
      );
      assert.ok(
        app.get(StripeSettlementController) instanceof
          StripeSettlementController,
      );
    } finally {
      await app.close();
      if (saved !== undefined)
        process.env.STRIPE_SETTLEMENT_SYNC_ENABLED = saved;
    }
  });
});
