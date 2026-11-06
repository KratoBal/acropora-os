import { Module } from "@nestjs/common";

import { RentalEquipmentController } from "./rental-equipment.controller.js";
import { RentalEquipmentRepository } from "./rental-equipment.repository.js";
import { RentalEquipmentService } from "./rental-equipment.service.js";

@Module({
  controllers: [RentalEquipmentController],
  providers: [RentalEquipmentRepository, RentalEquipmentService],
  exports: [RentalEquipmentRepository],
})
export class RentalEquipmentModule {}
