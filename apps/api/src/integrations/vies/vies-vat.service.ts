import { Injectable } from "@nestjs/common";
import type { ViesVatLookupResult } from "@acropora/types";

import { ViesApiError, ViesVatClient } from "./vies-vat.client.js";

// EU-s közösségi adószám formátum: kétbetűs ország-előtag, utána 2-12
// alfanumerikus karakter (néhány tagállam a szám végén "+"/"." jelet is
// használ - lásd a VIES hivatalos formátum-leírását).
const VAT_FORMAT = /^([A-Z]{2})([0-9A-Z+*.]{2,12})$/;

@Injectable()
export class ViesVatService {
  constructor(private readonly client: ViesVatClient) {}

  async check(rawTaxNumber: string): Promise<ViesVatLookupResult> {
    const normalized = rawTaxNumber.trim().replace(/\s+/g, "").toUpperCase();
    const match = VAT_FORMAT.exec(normalized);
    if (!match)
      return {
        message:
          "Az adószám nem felel meg az EU-s közösségi adószám formátumának (pl. DE123456789).",
      };
    // A regex pontosan két csoportot fog be sikeres illeszkedéskor, de a
    // tsconfig `noUncheckedIndexedAccess`-e miatt a tömb-indexelés típusa
    // önmagában `string | undefined` - a nem-null asszerció itt biztonságos.
    const countryCode = match[1]!;
    const vatNumber = match[2]!;
    try {
      const result = await this.client.checkVat(countryCode, vatNumber);
      return {
        valid: result.valid,
        name: result.name,
        address: result.address,
      };
    } catch (error) {
      return { message: this.mapError(error) };
    }
  }

  private mapError(error: unknown): string {
    if (error instanceof ViesApiError) {
      switch (error.code) {
        case "VAT_NUMBER_INVALID":
          return "A VIES szerint az adószám formátuma érvénytelen.";
        case "MS_UNAVAILABLE":
          return "Az adott tagállam VIES-szolgáltatása jelenleg nem érhető el, próbáld később.";
        default:
          return "A VIES adószám-ellenőrző szolgáltatás jelenleg nem érhető el, próbáld később.";
      }
    }
    return "A VIES adószám-ellenőrző szolgáltatás jelenleg nem érhető el, próbáld később.";
  }
}
