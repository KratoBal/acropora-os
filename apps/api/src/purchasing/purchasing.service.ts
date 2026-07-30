import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@acropora/database";
import type {
  ExchangeRateLookupResult,
  PurchaseInvoiceDetail,
  PurchaseInvoiceListResponse,
  PurchaseInvoiceResult,
  PurchaseProductSearchResult,
} from "@acropora/types";

import { generateCode } from "../common/code-generator.util.js";
import { MnbExchangeRateService } from "../integrations/mnb/mnb-exchange-rate.service.js";
import { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import type { CreatePurchaseInvoiceDto } from "./dto/create-purchase-invoice.dto.js";
import type { PurchaseInvoiceListQueryDto } from "./dto/purchase-invoice-list-query.dto.js";
import {
  PurchaseInvoiceRepository,
  type CreatePurchaseInvoiceLine,
} from "./purchase-invoice.repository.js";
import { PurchaseProductSearchService } from "./purchase-product-search.service.js";

@Injectable()
export class PurchasingService {
  // No UnasApiClient/UnasAuthService dependency anymore - the synchronous
  // UNAS stock push that used to happen here has been removed entirely.
  // Local stock is written (via the shared postInventoryMovement primitive,
  // see purchase-invoice.repository.ts) in the same DB transaction as the
  // invoice itself, and a UnasStockSyncOutbox row is created alongside it;
  // the actual UNAS publish happens later, out of band, in
  // unas-stock-sync-outbox.service.ts. This means invoice creation can no
  // longer fail or block because UNAS is slow or unreachable.
  constructor(
    private readonly invoices: PurchaseInvoiceRepository,
    private readonly suppliers: SuppliersRepository,
    private readonly productSearch: PurchaseProductSearchService,
    private readonly mnbRates: MnbExchangeRateService,
  ) {}

  searchProducts(
    query: string | undefined,
  ): Promise<PurchaseProductSearchResult[]> {
    return this.productSearch.search(query);
  }

  async getExchangeRate(
    currency: string,
    date: string,
  ): Promise<ExchangeRateLookupResult> {
    const parsedDate = new Date(date);
    if (Number.isNaN(parsedDate.getTime()))
      throw new BadRequestException("Érvénytelen dátum.");
    try {
      const resolved = await this.mnbRates.getRateForDate(currency, parsedDate);
      return {
        currency: currency.trim().toUpperCase(),
        quotedDate: resolved.quotedDate,
        rate: resolved.rate,
      };
    } catch (error) {
      throw this.mapExchangeRateError(error);
    }
  }

  /// Az MNB weboldala jelenleg bot-védelemmel (F5) blokkolja a programozott
  /// SOAP-hívásokat (lásd docs/CURRENT_STATUS.md) - ez nem az itt írt kód
  /// hibája, és jelenleg nem is javítható belőle. Emiatt a hívó felé csak
  /// egy érthető, a kézi megadásra terelő üzenetet adunk vissza a nyers
  /// hibakód helyett; a részletek szerveroldalon a kliens logjában maradnak.
  private mapExchangeRateError(error: unknown): Error {
    if (error instanceof NotFoundException) return error;
    return new BadGatewayException(
      "Az MNB árfolyam-szolgáltatás jelenleg nem érhető el. Add meg az árfolyamot kézzel.",
    );
  }

  list(
    query: PurchaseInvoiceListQueryDto,
  ): Promise<PurchaseInvoiceListResponse> {
    return this.invoices.list(query);
  }

  async getDetail(id: string): Promise<PurchaseInvoiceDetail> {
    const detail = await this.invoices.findById(id);
    if (!detail)
      throw new NotFoundException("A beszerzési számla nem található.");
    return detail;
  }

  async createInvoice(
    input: CreatePurchaseInvoiceDto,
    actorUserId: string,
  ): Promise<PurchaseInvoiceResult> {
    if (input.lines.length === 0)
      throw new BadRequestException(
        "Legalább egy tétel szükséges a számlához.",
      );

    const supplier = await this.suppliers.detail(input.supplierId);
    if (!supplier) throw new NotFoundException("A beszállító nem található.");

    const currency = input.currency.trim().toUpperCase();
    const invoiceDate = new Date(input.invoiceDate);
    if (Number.isNaN(invoiceDate.getTime()))
      throw new BadRequestException("Érvénytelen számla kelte.");

    let exchangeRate: Prisma.Decimal | null;
    let vatRate: Prisma.Decimal | null;
    if (input.source === "EU") {
      vatRate = null;
      if (currency === "HUF") {
        exchangeRate = null;
      } else if (input.exchangeRate !== undefined) {
        exchangeRate = new Prisma.Decimal(input.exchangeRate);
      } else {
        // Az MNB automatikus lekérdezése jelenleg megbízhatatlan (lásd
        // mapExchangeRateError) - a számla rögzítését emiatt nem szabad
        // hagyni összeomlani, helyette egyértelmű kérést adunk a kézi
        // árfolyam megadására.
        try {
          const resolved = await this.mnbRates.getRateForDate(
            currency,
            invoiceDate,
          );
          exchangeRate = new Prisma.Decimal(resolved.rate);
        } catch {
          throw new BadRequestException(
            "Az árfolyam automatikus lekérdezése nem sikerült. Add meg az árfolyamot kézzel.",
          );
        }
      }
    } else {
      // HU_MANUAL / HU_NAV: belföldi számla, mindig HUF, nincs MNB-lekérdezés
      // (lásd docs/CURRENT_STATUS.md - a séma szándékosan egyetlen,
      // számla-szintű ÁFA-kulcsot tárol, nem soronkéntit).
      if (currency !== "HUF")
        throw new BadRequestException(
          "Belföldi számlánál a pénznem csak HUF lehet.",
        );
      exchangeRate = null;
      if (input.vatRate === undefined)
        throw new BadRequestException(
          "Belföldi számlánál az ÁFA-kulcs megadása kötelező.",
        );
      vatRate = new Prisma.Decimal(input.vatRate);
    }

    const variantIds = input.lines
      .map((line) => line.variantId)
      .filter((variantId): variantId is string => Boolean(variantId));
    for (const line of input.lines) {
      if (line.variantId && line.createLocalProduct)
        throw new BadRequestException(
          "Egy számlasor vagy meglévő termékhez kapcsolható, vagy új helyi terméket hozhat létre; a kettő egyszerre nem adható meg.",
        );
    }
    const { warehouseId, variants } =
      await this.invoices.currentStock(variantIds);

    const documentNumber = generateCode("BESZ");
    const preparedLines: CreatePurchaseInvoiceLine[] = [];
    for (const line of input.lines) {
      // Terméktörzsben nem szereplő tétel is rögzíthető (pl. a számlán van,
      // de a termék még nincs felvéve nálunk) - ilyenkor nincs mit
      // egyeztetni a saját cikkszámmal/mennyiséggel, ezért a számlán
      // szereplő megnevezés és az egység kötelező, a helyi készlethatás és
      // a UNAS-szinkron pedig kimarad rá (lásd repository/create).
      if (!line.variantId && !line.createLocalProduct) {
        const sourceDescription = line.sourceDescription?.trim();
        if (!sourceDescription)
          throw new BadRequestException(
            "A terméktörzsben nem szereplő tételeknél a számlán szereplő megnevezés megadása kötelező.",
          );
        if (!line.unit.trim())
          throw new BadRequestException(
            `Az egység megadása kötelező: ${sourceDescription}.`,
          );
        if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
          throw new BadRequestException(
            `Érvénytelen mennyiség: ${sourceDescription}.`,
          );
        if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
          throw new BadRequestException(
            `Érvénytelen beszerzési ár: ${sourceDescription}.`,
          );
        preparedLines.push({
          variantId: null,
          sku: null,
          createLocalProduct: null,
          sourceDescription,
          orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
          actualQuantity: new Prisma.Decimal(line.actualQuantity),
          unit: line.unit.trim(),
          unitNet: new Prisma.Decimal(line.unitNet),
          discountPercent:
            line.discountPercent !== undefined
              ? new Prisma.Decimal(line.discountPercent)
              : null,
          syncStatus: "NOT_LINKED",
          syncError: null,
          syncToUnas: false,
        });
        continue;
      }

      if (line.createLocalProduct) {
        const name = line.createLocalProduct.name.trim();
        const sourceDescription = line.sourceDescription?.trim() || name;
        if (name.length < 2)
          throw new BadRequestException(
            "Az új helyi termék neve legalább 2 karakter legyen.",
          );
        if (!line.unit.trim())
          throw new BadRequestException(
            `Az egység megadása kötelező: ${name}.`,
          );
        if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
          throw new BadRequestException(`Érvénytelen mennyiség: ${name}.`);
        if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
          throw new BadRequestException(`Érvénytelen beszerzési ár: ${name}.`);
        preparedLines.push({
          variantId: null,
          sku: null,
          createLocalProduct: {
            name,
            primaryCategoryId:
              line.createLocalProduct.primaryCategoryId?.trim() || null,
          },
          sourceDescription,
          orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
          actualQuantity: new Prisma.Decimal(line.actualQuantity),
          unit: line.unit.trim(),
          unitNet: new Prisma.Decimal(line.unitNet),
          discountPercent:
            line.discountPercent !== undefined
              ? new Prisma.Decimal(line.discountPercent)
              : null,
          syncStatus: "NOT_APPLICABLE",
          syncError: null,
          syncToUnas: false,
        });
        continue;
      }

      const variantId = line.variantId;
      if (!variantId)
        throw new BadRequestException("A számlasor termékfeloldása hiányos.");
      const info = variants.get(variantId);
      if (!info)
        throw new BadRequestException(`Ismeretlen termék: ${line.variantId}.`);
      if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
        throw new BadRequestException(`Érvénytelen mennyiség: ${info.sku}.`);
      if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
        throw new BadRequestException(
          `Érvénytelen beszerzési ár: ${info.sku}.`,
        );
      if (
        info.catalogAuthority !== "UNAS" &&
        info.catalogAuthority !== "ACROPORA"
      )
        throw new BadRequestException(
          `A termék Product Master besorolása nem egyértelmű: ${info.sku}.`,
        );
      const syncToUnas = info.catalogAuthority === "UNAS";

      preparedLines.push({
        variantId,
        sku: info.sku,
        createLocalProduct: null,
        sourceDescription: line.sourceDescription?.trim() || null,
        orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
        actualQuantity: new Prisma.Decimal(line.actualQuantity),
        unit: line.unit.trim() || info.unit,
        unitNet: new Prisma.Decimal(line.unitNet),
        discountPercent:
          line.discountPercent !== undefined
            ? new Prisma.Decimal(line.discountPercent)
            : null,
        // "PENDING": the stock effect and its UnasStockSyncOutbox row are
        // posted atomically with the invoice itself (see
        // purchase-invoice.repository.ts); actual UNAS publication is the
        // background worker's job from here on, so this must not claim a
        // synchronous OK it can no longer guarantee.
        syncStatus: syncToUnas ? "PENDING" : "NOT_APPLICABLE",
        syncError: null,
        syncToUnas,
      });
    }

    const now = new Date();
    const detail = await this.invoices.create({
      documentNumber,
      supplierInvoiceNumber: input.supplierInvoiceNumber.trim(),
      source: input.source,
      supplierId: input.supplierId,
      warehouseId,
      currency,
      exchangeRate,
      invoiceDate,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      isPaid: input.isPaid ?? false,
      paidAt: input.isPaid ? new Date(input.paidAt ?? now.toISOString()) : null,
      vatRate,
      note: input.note?.trim() || null,
      navIncomingInvoiceId: input.navIncomingInvoiceId,
      actorUserId,
      lines: preparedLines,
    });

    const linkedLineCount = preparedLines.filter(
      (line) => line.variantId || line.createLocalProduct,
    ).length;
    // Always 0: the invoice + stock movement + outbox are one atomic
    // transaction (see repository.create) - a real failure throws and
    // rolls back the whole thing rather than reporting a partial failure
    // here. "successCount" now means "lines whose stock change was
    // committed locally"; unasQueuedCount separately reports the subset
    // queued for UNAS. Neither value claims an UNAS-side confirmation -
    // see docs/INVENTORY-CONSISTENCY.md.
    return {
      detail,
      successCount: linkedLineCount,
      failedCount: 0,
      unasQueuedCount: preparedLines.filter((line) => line.syncToUnas).length,
      localProductCreatedCount: preparedLines.filter(
        (line) => line.createLocalProduct,
      ).length,
    };
  }
}
