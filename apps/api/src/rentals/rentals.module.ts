import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module.js";
import { RentalsController } from "./rentals.controller.js";
import { RentalsRepository } from "./rentals.repository.js";
import { RentalsService } from "./rentals.service.js";

/** A new renter goes into the existing customer register: `CustomersModule` exports the repository that numbers it. */
@Module({
  imports: [CustomersModule],
  controllers: [RentalsController],
  providers: [RentalsRepository, RentalsService],
})
export class RentalsModule {}
