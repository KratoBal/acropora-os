import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import type { NavSoftwareData, NavTechnicalUser } from "./nav-xml.util.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ServiceUnavailableException("NAV_NOT_CONFIGURED");
  return value;
}

/// A NAV technikai felhasználó és szoftver adatainak közös betöltője - a
/// queryTaxpayer (NavTaxpayerService) és a queryInvoiceDigest/queryInvoiceData
/// (NavIncomingInvoiceService) operációk ugyanazt a technikai felhasználót és
/// szoftver-azonosítót használják, ezért ez a kis szolgáltatás fogja össze a
/// korábban a NavTaxpayerService-ben duplikált env-betöltést.
@Injectable()
export class NavCredentialsService {
  technicalUser(): NavTechnicalUser {
    return {
      login: requiredEnv("NAV_TECHNICAL_USER_LOGIN"),
      password: requiredEnv("NAV_TECHNICAL_USER_PASSWORD"),
      taxNumber: requiredEnv("NAV_TECHNICAL_USER_TAX_NUMBER"),
      signKey: requiredEnv("NAV_TECHNICAL_USER_SIGN_KEY"),
    };
  }

  software(): NavSoftwareData {
    return {
      softwareId: requiredEnv("NAV_SOFTWARE_ID"),
      softwareName: process.env.NAV_SOFTWARE_NAME?.trim() || "Acropora OS",
      softwareOperation: "ONLINE_SERVICE",
      softwareMainVersion: process.env.NAV_SOFTWARE_VERSION?.trim() || "1.0",
      softwareDevName: requiredEnv("NAV_SOFTWARE_DEV_NAME"),
      softwareDevContact: requiredEnv("NAV_SOFTWARE_DEV_CONTACT"),
      softwareDevCountryCode:
        process.env.NAV_SOFTWARE_DEV_COUNTRY_CODE?.trim() || "HU",
      softwareDevTaxNumber: requiredEnv("NAV_SOFTWARE_DEV_TAX_NUMBER"),
    };
  }
}
