import { Injectable, Optional } from "@nestjs/common";

import { WebshopParcelService } from "../../integrations/carriers/webshop-parcel.service.js";
import {
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "../../integrations/medusa/medusa-admin.client.js";
import { MedusaCredentialProvider } from "../../integrations/medusa/medusa-credential.provider.js";
import {
  syncParcelStatuses,
  type ParcelStatusSyncReport,
  type ParcelSyncCarrier,
} from "./webshop-parcel-status-sync.js";

/**
 * The Medusa and carrier side of the parcel status sync (GLS V0.4, Foxpost card ef84489d); the decision is in
 * `webshop-parcel-status-sync.ts`. The customer is mailed by the automatic closing only when
 * `PARCEL_STATUS_SYNC_NOTIFY_CUSTOMER` is "true" (the shop's "closed" status mail); otherwise the person can still
 * send it from the order page.
 */
@Injectable()
export class WebshopParcelStatusService {
  constructor(
    private readonly credentials: MedusaCredentialProvider,
    private readonly parcels: WebshopParcelService,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  async run(
    env: NodeJS.ProcessEnv = process.env,
    now: Date = new Date(),
    carrier: ParcelSyncCarrier = "gls",
  ): Promise<ParcelStatusSyncReport> {
    const client = this.clientFactory(
      (await this.credentials.resolve()).apiKey,
    );
    return syncParcelStatuses(
      {
        parcelOrderIds: (since, limit) =>
          this.parcels.confirmedParcelOrderIds(carrier, since, limit),
        tracking: (orderId) => this.parcels.tracking(orderId),
        businessStatus: (orderId) => client.orderBusinessStatus(orderId),
        transition: async (orderId, status, notifyCustomer) => {
          await client.transitionBusinessStatus(
            orderId,
            status,
            notifyCustomer,
          );
        },
      },
      env,
      now,
      carrier,
    );
  }
}
