import { Module } from "@nestjs/common";

import { ViesVatClient } from "./vies-vat.client.js";
import { ViesVatController } from "./vies-vat.controller.js";
import { ViesVatService } from "./vies-vat.service.js";

@Module({
  controllers: [ViesVatController],
  providers: [ViesVatClient, ViesVatService],
})
export class ViesVatModule {}
