import { Module } from "@nestjs/common";

import { documentStoreProvider } from "../service-assets/document-store/document-store.provider.js";
import { MortalityPhotosService } from "./mortality-photos.service.js";
import { MortalityController } from "./mortality.controller.js";
import { MortalityRepository } from "./mortality.repository.js";
import { MortalityService } from "./mortality.service.js";

/** Az elhullási napló (kártya 115c9740). */
@Module({
  controllers: [MortalityController],
  providers: [
    documentStoreProvider,
    MortalityRepository,
    MortalityService,
    MortalityPhotosService,
  ],
})
export class MortalityModule {}
