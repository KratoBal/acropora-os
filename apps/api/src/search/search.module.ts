import { Module } from "@nestjs/common";

import { AquariumsModule } from "../aquariums/aquariums.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { WebshopOrdersModule } from "../orders/webshop-orders/webshop-orders.module.js";
import { CustomersModule } from "../customers/customers.module.js";
import { ProductModule } from "../products/product.module.js";
import { QuotesModule } from "../quotes/quotes.module.js";
import { ServiceAssetsModule } from "../service-assets/service-assets.module.js";
import { ServiceJobsModule } from "../service-jobs/service-jobs.module.js";
import { SuppliersModule } from "../suppliers/suppliers.module.js";
import { WorksheetsModule } from "../worksheets/worksheets.module.js";
import { SearchController } from "./search.controller.js";
import { SearchService } from "./search.service.js";

@Module({
  imports: [
    AquariumsModule,
    BillingModule,
    CustomersModule,
    QuotesModule,
    WebshopOrdersModule,
    ProductModule,
    ServiceAssetsModule,
    ServiceJobsModule,
    SuppliersModule,
    WorksheetsModule,
  ],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
