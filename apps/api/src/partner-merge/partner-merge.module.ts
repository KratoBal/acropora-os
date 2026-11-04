import { Module } from "@nestjs/common";

import { PartnerMergeController } from "./partner-merge.controller.js";
import {
  PartnerMergeRepository,
  PartnerMergeService,
} from "./partner-merge.service.js";

/** Egy partnertörzs, 4. lépés: két vevő-sor összevonása naplóval és visszavonással. */
@Module({
  controllers: [PartnerMergeController],
  providers: [PartnerMergeRepository, PartnerMergeService],
})
export class PartnerMergeModule {}
