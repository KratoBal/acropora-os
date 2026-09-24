import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { AquariumMaintainersRepository } from "./aquarium-maintainers.repository.js";
import { AquariumMaintainersService } from "./aquarium-maintainers.service.js";
import { AquariumMeasurementsRepository } from "./aquarium-measurements.repository.js";
import { AquariumMeasurementsService } from "./aquarium-measurements.service.js";
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
  imports: [CustomersModule, NotificationsModule],
  controllers: [AquariumsController],
  providers: [
    AquariumsRepository,
    AquariumsService,
    AquariumMeasurementsRepository,
    AquariumMeasurementsService,
    AquariumMaintainersRepository,
    AquariumMaintainersService,
  ],
})
export class AquariumsModule {}
