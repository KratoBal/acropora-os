import { Injectable, Logger, Optional } from "@nestjs/common";

import {
  medusaClientFromEnvironment,
  type MedusaAdminClient,
} from "../integrations/medusa/medusa-admin.client.js";
import { MedusaCredentialProvider } from "../integrations/medusa/medusa-credential.provider.js";
import { orderLanguageOf } from "../orders/webshop-orders/webshop-order-invoice.rules.js";

export type DocumentLanguage = "hu" | "en";

/**
 * THE LANGUAGE OF A BILLING DOCUMENT'S MAIL (card d5c6befd, P4 follow-up). A document made for a webshop order
 * (`sourceType` WEBSHOP_ORDER, `sourceId` the Medusa order id) speaks the language the customer ordered in
 * (`storefront_locale` on the order, written by the shop for an order paid on the English storefront). Every other
 * document, and every doubt, is Hungarian.
 *
 * ONE READ OF THE ORDER, ONLY FOR A WEBSHOP DOCUMENT: no other document touches the shop. When the shop cannot be
 * read the answer is Hungarian and the log names the document and the error kind (no message, no address): a text the
 * staff can still edit before sending, never a failed send.
 */
@Injectable()
export class BillingDocumentLanguageService {
  private readonly logger = new Logger(BillingDocumentLanguageService.name);

  constructor(
    private readonly credentials: MedusaCredentialProvider,
    @Optional()
    private readonly clientFactory: (
      apiKey: string,
    ) => MedusaAdminClient = medusaClientFromEnvironment,
  ) {}

  async of(document: {
    id?: string;
    sourceType?: string | null;
    sourceId?: string | null;
  }): Promise<DocumentLanguage> {
    if (document.sourceType !== "WEBSHOP_ORDER" || !document.sourceId)
      return "hu";
    try {
      const client = this.clientFactory(
        (await this.credentials.resolve()).apiKey,
      );
      const order = await client.order(document.sourceId);
      return orderLanguageOf(order?.metadata);
    } catch (error) {
      this.logger.warn(
        `document ${document.id ?? "?"}: the order's language could not be read, Hungarian is used (${
          error instanceof Error ? error.name : "error"
        })`,
      );
      return "hu";
    }
  }
}
