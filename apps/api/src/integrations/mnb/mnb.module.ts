import { Module } from "@nestjs/common";

import { MnbExchangeRateClient } from "./mnb-exchange-rate.client.js";
import { MnbExchangeRateService } from "./mnb-exchange-rate.service.js";

@Module({
  providers: [MnbExchangeRateClient, MnbExchangeRateService],
  exports: [MnbExchangeRateService],
})
export class MnbModule {}
