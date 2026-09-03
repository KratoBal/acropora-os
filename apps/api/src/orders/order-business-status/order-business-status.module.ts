import { Module } from "@nestjs/common";

import { OrderBusinessStatusService } from "./order-business-status.service.js";

@Module({
  providers: [OrderBusinessStatusService],
  exports: [OrderBusinessStatusService],
})
export class OrderBusinessStatusModule {}
