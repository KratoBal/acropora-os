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
  PosSaleStockWarning,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import type { PosSaleListQueryDto } from "./dto/pos-sale-list-query.dto.js";
import {
  PosSaleRepository,
  type CreatePosSaleLine,
} from "./pos-sale.repository.js";

@Injectable()
export class PosSaleService {
  constructor(
    private readonly sales: PosSaleRepository,
    private readonly unasApi: UnasApiClient,
    private readonly unasAuth: UnasAuthService,
  ) {}

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

    const stockWarnings: PosSaleStockWarning[] = [];
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
      const resultingQty = info.currentQty.minus(quantity);

      if (resultingQty.isNegative()) {
        stockWarnings.push({
          sku: info.sku,
          productName: info.productName,
          resultingQty: resultingQty.toString(),
        });
      }

      totalNet = totalNet.plus(lineNet);
      totalTax = totalTax.plus(lineTax);
      totalGross = totalGross.plus(lineGross);

      preparedLines.push({
        variantId,
        sku: info.sku,
        productName: info.productName,
        unit: info.unit,
        quantity,
        taxRate,
        unitNet,
        lineGross,
        resultingQty,
        syncStatus: "OK",
        syncError: null,
      });
    }

    const orderNumber = generateCode("POS");

    // UNAS pushes happen before the local write (same ordering as the
    // leltár korrekció): the DB transaction that actually applies the
    // stock change and creates the sale record only runs once, after every
    // per-line push result is already known, so it can bake the sync
    // status straight into the initial create instead of a second pass.
    let successCount = 0;
    let failedCount = 0;
    const token = await this.unasAuth.getToken();
    for (const line of preparedLines) {
      try {
        await this.unasApi.setStock(token, {
          sku: line.sku,
          qty: line.resultingQty.toString(),
          comment: `POS eladás (${orderNumber})`,
        });
        line.syncStatus = "OK";
        line.syncError = null;
        successCount += 1;
      } catch (error) {
        line.syncStatus = "FAILED";
        line.syncError =
          error instanceof Error ? error.message : "UNAS_PUSH_FAILED";
        failedCount += 1;
      }
    }

    const detail = await this.sales.createSale({
      orderNumber,
      warehouseId,
      actorUserId,
      paymentMethod: input.paymentMethod,
      customerId: input.customerId ?? null,
      lines: preparedLines,
      totals: { totalNet, totalTax, totalGross },
    });

    return { detail, stockWarnings, successCount, failedCount };
  }
}
