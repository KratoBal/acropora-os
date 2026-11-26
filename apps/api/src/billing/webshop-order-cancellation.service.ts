import { Injectable, Logger, Optional } from "@nestjs/common";

import {
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "../integrations/medusa/medusa-admin.client.js";
import { MedusaCredentialProvider } from "../integrations/medusa/medusa-credential.provider.js";
import { cancelledOrderOf } from "../orders/webshop-orders/webshop-order-invoice.rules.js";

/**
 * IS THE WEBSHOP ORDER CANCELLED, FOR THE SHARED ISSUE (card ba6b8256; barracuda on #2992). The order page stops a cancelled
 * order's final invoice (`cancelledOrderOf`, N3a), but a final draft made BEFORE the cancel could still be issued from the
 * billing editor, which does not read the shop. This reads the order and its business status, the same rule. The billing
 * module reads the shop directly (as `BillingDocumentLanguageService`), not through the webshop orders module, which imports
 * billing.
 *
 * `unreadable`: the shop did not answer. The caller does not issue then: whether the money is a refund is not known.
 */
@Injectable()
export class WebshopOrderCancellationService {
  private readonly logger = new Logger(WebshopOrderCancellationService.name);

  constructor(
    private readonly credentials: MedusaCredentialProvider,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  async of(
    orderId: string,
  ): Promise<"canceled" | "closed_unsuccessfully" | "unreadable" | null> {
    try {
      const client = this.clientFactory(
        (await this.credentials.resolve()).apiKey,
      );
      const [order, business] = await Promise.all([
        client.order(orderId),
        client.orderBusinessStatus(orderId),
      ]);
      if (!order) return "unreadable";
      return cancelledOrderOf(order, business?.status);
    } catch (error) {
      this.logger.warn(
        `order ${orderId}: the cancel state could not be read (${error instanceof Error ? error.name : "error"})`,
      );
      return "unreadable";
    }
  }
}
