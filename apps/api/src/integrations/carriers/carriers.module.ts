import { Module } from "@nestjs/common";

import { carrierClientFor } from "./carrier-client.factory.js";
import type { CarrierCode } from "./carrier.types.js";
import { WebshopParcelRepository } from "./webshop-parcel.repository.js";
import {
  CARRIER_CLIENTS,
  WebshopParcelService,
} from "./webshop-parcel.service.js";

/**
 * A fuvarozoi kliensek es a webshop csomag-szolgaltatas. Vegpontot nem ad: a
 * Rendelesek oldal modulja (nautilus) importalja es a sajat vegpontjabol hivja.
 */
@Module({
  providers: [
    WebshopParcelRepository,
    WebshopParcelService,
    // a kapcsolot (FOXPOST_API_MODE / GLS_API_MODE) hivaskor olvassa, nem indulaskor
    {
      provide: CARRIER_CLIENTS,
      useValue: (carrier: CarrierCode) => carrierClientFor(carrier),
    },
  ],
  exports: [WebshopParcelService],
})
export class CarriersModule {}
