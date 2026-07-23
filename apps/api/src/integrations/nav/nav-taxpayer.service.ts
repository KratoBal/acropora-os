import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { NavTaxpayerLookupResult } from "@acropora/types";

import {
  NavOnlineInvoiceClient,
  type NavSoftwareData,
  type NavTechnicalUser,
} from "./nav-online-invoice.client.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException("NAV_NOT_CONFIGURED");
  return value;
}

@Injectable()
export class NavTaxpayerService {
  constructor(private readonly client: NavOnlineInvoiceClient) {}

  async lookup(taxNumber: string): Promise<NavTaxpayerLookupResult> {
    const coreTaxNumber = taxNumber.replace(/[^0-9]/g, "").slice(0, 8);
    if (coreTaxNumber.length !== 8)
      throw new ServiceUnavailableException("NAV_TAX_NUMBER_INVALID");
    return this.client.queryTaxpayer(coreTaxNumber, this.technicalUser(), this.software());
  }

  private technicalUser(): NavTechnicalUser {
    return {
      login: requiredEnv("NAV_TECHNICAL_USER_LOGIN"),
      password: requiredEnv("NAV_TECHNICAL_USER_PASSWORD"),
      taxNumber: requiredEnv("NAV_TECHNICAL_USER_TAX_NUMBER"),
      signKey: requiredEnv("NAV_TECHNICAL_USER_SIGN_KEY"),
    };
  }

  private software(): NavSoftwareData {
    return {
      softwareId: requiredEnv("NAV_SOFTWARE_ID"),
      softwareName: process.env.NAV_SOFTWARE_NAME?.trim() || "Acropora OS",
      softwareOperation: "ONLINE_SERVICE",
      softwareMainVersion: process.env.NAV_SOFTWARE_VERSION?.trim() || "1.0",
      softwareDevName: requiredEnv("NAV_SOFTWARE_DEV_NAME"),
      softwareDevContact: requiredEnv("NAV_SOFTWARE_DEV_CONTACT"),
      softwareDevCountryCode: process.env.NAV_SOFTWARE_DEV_COUNTRY_CODE?.trim() || "HU",
      softwareDevTaxNumber: requiredEnv("NAV_SOFTWARE_DEV_TAX_NUMBER"),
    };
  }
}
