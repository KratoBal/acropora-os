import { Module } from "@nestjs/common";

import { GlsSettlementController } from "./gls-settlement.controller.js";
import { GlsSettlementRepository } from "./gls-settlement.repository.js";
import { GlsSettlementService } from "./gls-settlement.service.js";

@Module({
  controllers: [GlsSettlementController],
  providers: [GlsSettlementRepository, GlsSettlementService],
})
export class GlsSettlementModule {}
