import { Module } from "@nestjs/common";

import { SimplePaySettlementController } from "./simplepay-settlement.controller.js";
import { SimplePaySettlementRepository } from "./simplepay-settlement.repository.js";
import { SimplePaySettlementService } from "./simplepay-settlement.service.js";

@Module({
  controllers: [SimplePaySettlementController],
  providers: [SimplePaySettlementRepository, SimplePaySettlementService],
})
export class SimplePaySettlementModule {}
