import { Module } from "@nestjs/common";

import { MedusaModule } from "../medusa/medusa.module.js";
import { StripeSettlementController } from "./stripe-settlement.controller.js";
import { StripeSettlementScheduler } from "./stripe-settlement.scheduler.js";
import { StripeSettlementService } from "./stripe-settlement.service.js";
import {
  PrismaStripeSettlementStore,
  STRIPE_SETTLEMENT_STORE,
} from "./stripe-settlement.store.js";

@Module({
  imports: [MedusaModule],
  controllers: [StripeSettlementController],
  providers: [
    { provide: STRIPE_SETTLEMENT_STORE, useClass: PrismaStripeSettlementStore },
    StripeSettlementService,
    StripeSettlementScheduler,
  ],
})
export class StripeSettlementModule {}
