import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { NavTaxpayerLookupResult } from "@acropora/types";

import { NavCredentialsService } from "./nav-credentials.service.js";
import { NavOnlineInvoiceClient } from "./nav-online-invoice.client.js";

@Injectable()
export class NavTaxpayerService {
  constructor(
    private readonly client: NavOnlineInvoiceClient,
    private readonly credentials: NavCredentialsService,
  ) {}

  async lookup(taxNumber: string): Promise<NavTaxpayerLookupResult> {
    const coreTaxNumber = taxNumber.replace(/[^0-9]/g, "").slice(0, 8);
    if (coreTaxNumber.length !== 8)
      throw new ServiceUnavailableException("NAV_TAX_NUMBER_INVALID");
    const credentials = await this.credentials.resolve();
    return this.client.queryTaxpayer(
      coreTaxNumber,
      credentials.technicalUser,
      credentials.software,
    );
  }
}
