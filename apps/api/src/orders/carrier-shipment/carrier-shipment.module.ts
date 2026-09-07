import { Module } from "@nestjs/common";

import { OrderBusinessStatusModule } from "../order-business-status/order-business-status.module.js";
import { CarrierShipmentService } from "./carrier-shipment.service.js";

@Module({
  imports: [OrderBusinessStatusModule],
  providers: [CarrierShipmentService],
  exports: [CarrierShipmentService],
})
export class CarrierShipmentModule {}
