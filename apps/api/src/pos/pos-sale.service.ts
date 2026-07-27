import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type {
  CreatePosSaleInput,
  PosSaleDetail,
  PosSaleListResponse,
  PosSaleResult,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import {
  PosSaleRepository,
  type CreatePosSaleLine,
} from "./pos-sale.repository.js";

@Injectable()
export class PosSaleService {
  // No UnasApiClient/UnasAuthService dependency anymore - the synchronous
  // per-line UNAS push that used to happen here has been removed entirely.
  // Local stock is written (via the shared postInventoryMovement primitive,
  // see pos-sale.repository.ts) in the same DB transaction as the SalesOrder
  // itself, and a UnasStockSyncOutbox row is created alongside it; the
  // actual UNAS publish happens later, out of band, in
  // unas-stock-sync-outbox.service.ts. This means checkout can no longer
  // fail or block because UNAS is slow or unreachable - a UNAS outage never
  // fails an already safely-booked local sale.
  constructor(private readonly sales: PosSaleRepository) {}

  list(query: PosSaleListQueryDto): Promise<PosSaleListResponse> {
    return this.sales.list(query);
  }

  async getDetail(id: string): Promise<PosSaleDetail> {
    const detail = await this.sales.findById(id);
    if (!detail) throw new NotFoundException("Az eladás nem található.");
    return detail;
  }

  async createSale(
    input: CreatePosSaleInput,
    actorUserId: string,
  ): Promise<PosSaleResult> {
    if (input.lines.length === 0) {
      throw new BadRequestException(
        "Legalább egy tétel szükséges az eladáshoz.",
      );
    }

    // Merge duplicate variantId entries defensively; the cart UI shouldn't
    // send the same product as two separate lines, but don't trust the
    // client for something this easy to get right server-side.
    const mergedByVariant = new Map<
      string,
      { quantity: number; unitGross: number }
    >();
    for (const line of input.lines) {
      const existing = mergedByVariant.get(line.variantId);
      if (existing) {
        existing.quantity += line.quantity;
        existing.unitGross = line.unitGross;
      } else {
        mergedByVariant.set(line.variantId, {
          quantity: line.quantity,
          unitGross: line.unitGross,
        });
      }
    }

    const variantIds = [...mergedByVariant.keys()];
    const { warehouseId, variants } = await this.sales.currentStock(variantIds);

    const preparedLines: CreatePosSaleLine[] = [];
    let totalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalGross = new Prisma.Decimal(0);

    for (const [variantId, cartLine] of mergedByVariant) {
      const info = variants.get(variantId);
      if (!info) {
        throw new BadRequestException(`Ismeretlen termék: ${variantId}.`);
      }
      if (info.vatRate === null) {
        throw new BadRequestException(
          `Nincs beállítva ÁFA kulcs ehhez a termékhez: ${info.sku}.`,
        );
      }
      if (!Number.isFinite(cartLine.quantity) || cartLine.quantity <= 0) {
        throw new BadRequestException(`Érvénytelen mennyiség: ${info.sku}.`);
      }
      if (!Number.isFinite(cartLine.unitGross) || cartLine.unitGross < 0) {
        throw new BadRequestException(`Érvénytelen eladási ár: ${info.sku}.`);
      }

      const quantity = new Prisma.Decimal(cartLine.quantity);
      const unitGross = new Prisma.Decimal(cartLine.unitGross);
      const taxRate = info.vatRate;
      const unitNet = unitGross.dividedBy(taxRate.dividedBy(100).plus(1));
      const lineGross = unitGross.times(quantity);
      const lineNet = unitNet.times(quantity);
      const lineTax = lineGross.minus(lineNet);

      totalNet = totalNet.plus(lineNet);
      totalTax = totalTax.plus(lineTax);
      totalGross = totalGross.plus(lineGross);

      // Nincs itt előre kiszámolt resultingQty/negatív-figyelmeztetés
      // többé: az egyetlen hiteles "mennyi marad" érték a
      // postInventoryMovement zár alatti, a tényleges könyveléskor
      // számított eredménye (l. pos-sale.repository.ts createSale) - egy
      // ilyen, tranzakció ELŐTTI becslés két egyidejű eladás esetén
      // elavulttá válhatna (pl. mindkettő 5-nek látja a készletet, holott
      // az egyik lekönyvelése után már csak 2 van).
      preparedLines.push({
        variantId,
        sku: info.sku,
        productName: info.productName,
        unit: info.unit,
        quantity,
        taxRate,
        unitNet,
        lineGross,
      });
    }

    const orderNumber = generateCode("POS");

    const { detail, stockWarnings } = await this.sales.createSale({
      orderNumber,
      warehouseId,
      actorUserId,
      paymentMethod: input.paymentMethod,
      customerId: input.customerId ?? null,
      lines: preparedLines,
      totals: { totalNet, totalTax, totalGross },
    });

    // A SalesOrder és a készletmozgás EGYETLEN tranzakcióban jön létre a
    // repository-ban (postInventoryMovement hívással) - sikeres eladás
    // emiatt sosem létezhet könyvelt készletmozgás nélkül, és fordítva sem.
    // successCount/failedCount innentől mindig a linkelt sorok száma / 0:
    // egy valódi könyvelési hiba a teljes tranzakciót visszagörgeti és
    // kivételt dob, nem egy soronkénti szinkron UNAS-hiba eredménye - lásd
    // docs/INVENTORY-CONSISTENCY.md.
    return {
      detail,
      stockWarnings,
      successCount: preparedLines.length,
      failedCount: 0,
    };
  }
}
