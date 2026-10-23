import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type { VariantSupplierPrices } from "@acropora/types";

import { MnbExchangeRateService } from "../../integrations/mnb/mnb-exchange-rate.service.js";
import { PriceListRepository } from "./price-list.repository.js";
import {
  computeSupplierPriceRows,
  type FxQuote,
  type PriceRowSource,
} from "./supplier-price-rows.js";

/**
 * EGY TERMÉKVÁLTOZAT BESZÁLLÍTÓI ÁRAI ÉS A HASZON (task beszallitoi-arlistak-4).
 * Csak olvas. A beszállítónkénti sor az ember által jóváhagyott VAGY az
 * automatikus (vonalkód, ismert cikkszám) kötésből indul, a legfrissebb lista
 * sorával; az elutasított kötés nem jelenik meg. Az árfolyam az MNB-é a MAI
 * napra (a jegyzés napjával), és ha az MNB nem érhető el, az a sor forintár és
 * haszon nélkül marad, nem nullával.
 */
@Injectable()
export class PriceListDisplayService {
  constructor(
    private readonly repository: PriceListRepository,
    private readonly exchangeRates: MnbExchangeRateService,
  ) {}

  async forVariant(
    variantId: string,
    now: Date = new Date(),
  ): Promise<VariantSupplierPrices> {
    const selling = await this.repository.sellingPrice(variantId, now);
    if (!selling) throw new NotFoundException("Nincs ilyen termékváltozat.");
    const matches = await this.repository.matchesForVariant(variantId);
    const entries = await this.repository.latestEntries(matches);
    const sources: PriceRowSource[] = matches.flatMap((match) => {
      const entry = entries.get(
        `${match.supplierId}\u0000${match.supplierSku}`,
      );
      if (!entry) return [];
      return [
        {
          supplierId: match.supplierId,
          supplierName: match.supplier.name,
          supplierSku: match.supplierSku,
          listedName: entry.supplierName,
          unitPrice: entry.unitPrice,
          currency: entry.currency,
          listRetailPrice: entry.listRetailPrice,
          listDate: entry.listDate,
          matchStatus: match.status as "AUTO" | "APPROVED",
          matchMethod: match.method,
        },
      ];
    });
    const fx = new Map<string, FxQuote | null>();
    for (const currency of new Set(sources.map((source) => source.currency))) {
      if (currency === "HUF") continue;
      fx.set(currency, await this.quote(currency, now));
    }
    return {
      variantId,
      sellingNetHuf: selling.unitNet
        ? selling.unitNet
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
            .toFixed(2)
        : null,
      sellingReason: selling.reason,
      rows: computeSupplierPriceRows({
        rows: sources,
        sellingNet: selling.unitNet,
        fx,
        now,
      }),
    };
  }

  private async quote(currency: string, now: Date): Promise<FxQuote | null> {
    try {
      const resolved = await this.exchangeRates.getRateForDate(currency, now);
      return { rate: resolved.rate, quotedDate: resolved.quotedDate };
    } catch {
      return null;
    }
  }
}
