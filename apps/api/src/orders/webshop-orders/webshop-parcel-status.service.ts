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
} from "./webshop-parcel-status-sync.js";

/**
 * The Medusa and carrier side of the GLS status sync (V0.4); the decision is in
 * `webshop-parcel-status-sync.ts`. The customer is NOT mailed by the automatic closing: the
 * delivered codes are new configuration and a mail to customers from a poller is a decision for
 * the owner, not a default (the person can still send the status mail from the order page).
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
  ): Promise<ParcelStatusSyncReport> {
    const client = this.clientFactory(
      (await this.credentials.resolve()).apiKey,
    );
    return syncParcelStatuses(
      {
        parcelOrderIds: (since, limit) =>
          this.parcels.confirmedParcelOrderIds("gls", since, limit),
        tracking: (orderId) => this.parcels.tracking(orderId),
        businessStatus: (orderId) => client.orderBusinessStatus(orderId),
        transition: async (orderId, status) => {
          await client.transitionBusinessStatus(orderId, status, false);
        },
      },
      env,
      now,
    );
  }
}
