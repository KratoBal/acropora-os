import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { AquariumMaintainersRepository } from "./aquarium-maintainers.repository.js";
import { AquariumMaintainersService } from "./aquarium-maintainers.service.js";
import { AquariumMeasurementXlsx } from "./aquarium-measurement-xlsx.js";
import { AquariumMeasurementsRepository } from "./aquarium-measurements.repository.js";
import { AquariumMeasurementsService } from "./aquarium-measurements.service.js";
import { AquariumsController } from "./aquariums.controller.js";
import { AquariumsRepository } from "./aquariums.repository.js";
import { AquariumsService } from "./aquariums.service.js";
import { HttpMeasurementRecommendationAiClient } from "./recommendation/measurement-recommendation.ai-client.js";
import {
  EmptyRecommendationCandidateSource,
  MEASUREMENT_RECOMMENDATION_AI_CLIENT,
  RECOMMENDATION_CANDIDATE_SOURCE,
} from "./recommendation/measurement-recommendation.contract.js";
import { MeasurementRecommendationService } from "./recommendation/measurement-recommendation.service.js";

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
    AquariumMeasurementXlsx,
    AquariumMaintainersRepository,
    AquariumMaintainersService,
    MeasurementRecommendationService,
    {
      provide: MEASUREMENT_RECOMMENDATION_AI_CLIENT,
      useClass: HttpMeasurementRecommendationAiClient,
    },
    {
      provide: RECOMMENDATION_CANDIDATE_SOURCE,
      useClass: EmptyRecommendationCandidateSource,
    },
  ],
  exports: [AquariumsService],
})
export class AquariumsModule {}
