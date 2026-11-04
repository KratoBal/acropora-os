import { Module } from "@nestjs/common";

import { CustomersController } from "./customers.controller.js";
import { CustomersRepository } from "./customers.repository.js";
import { CustomersService } from "./customers.service.js";
import {
  CustomerTaxNumberBackfillReporter,
  CustomerTaxNumberBackfillRepository,
} from "./customer-tax-number-backfill.reporter.js";

@Module({
  controllers: [CustomersController],
  providers: [
    CustomersRepository,
    CustomersService,
    CustomerTaxNumberBackfillRepository,
    CustomerTaxNumberBackfillReporter,
  ],
  exports: [CustomersRepository],
})
export class CustomersModule {}
