import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module.js";
import { AquariumsController } from "./aquariums.controller.js";
import { AquariumsRepository } from "./aquariums.repository.js";
import { AquariumsService } from "./aquariums.service.js";

/**
 * A `CustomersModule` IMPORTÁLVA, NEM ÚJRAÍRVA.
 *
 * Az "ügyfél tulajdon, új ügyféllel" eset a MEGLÉVŐ `CustomersRepository.
 * create()`-et hívja (lásd `aquariums.service.ts`), hogy az akváriumhoz
 * felvitt új ügyfél ugyanazt a számozást, validációt és tábla-alakot kapja,
 * mint bárhol máshol a rendszerben. A `CustomersModule` már exportálja a
 * repository-t, tehát nincs szükség duplikált providerre.
 */
@Module({
  imports: [CustomersModule],
  controllers: [AquariumsController],
  providers: [AquariumsRepository, AquariumsService],
})
export class AquariumsModule {}
