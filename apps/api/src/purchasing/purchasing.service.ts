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
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
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
  constructor(
    private readonly invoices: PurchaseInvoiceRepository,
    private readonly suppliers: SuppliersRepository,
    private readonly productSearch: PurchaseProductSearchService,
    private readonly mnbRates: MnbExchangeRateService,
    private readonly unasApi: UnasApiClient,
    private readonly unasAuth: UnasAuthService,
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
    const { warehouseId, variants } =
      await this.invoices.currentStock(variantIds);

    // Több sor is hivatkozhat ugyanarra a termékre egy számlán belül
    // (pl. eltérő beszerzési áron/kedvezménnyel); a készlethatásukat
    // sorrendben, egymásra épülve kell számolni, különben az utolsó ilyen
    // sor felülírná a korábbiak hatását ahelyett, hogy hozzáadódna.
    const runningQtyByVariant = new Map(
      [...variants.entries()].map(([variantId, info]) => [
        variantId,
        info.currentQty,
      ]),
    );

    const documentNumber = generateCode("BESZ");
    const preparedLines: CreatePurchaseInvoiceLine[] = [];
    for (const line of input.lines) {
      // Terméktörzsben nem szereplő tétel is rögzíthető (pl. a számlán van,
      // de a termék még nincs felvéve nálunk) - ilyenkor nincs mit
      // egyeztetni a saját cikkszámmal/mennyiséggel, ezért a számlán
      // szereplő megnevezés és az egység kötelező, a helyi készlethatás és
      // a UNAS-szinkron pedig kimarad rá (lásd repository/create).
      if (!line.variantId) {
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
          sourceDescription,
          orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
          actualQuantity: new Prisma.Decimal(line.actualQuantity),
          unit: line.unit.trim(),
          unitNet: new Prisma.Decimal(line.unitNet),
          discountPercent:
            line.discountPercent !== undefined
              ? new Prisma.Decimal(line.discountPercent)
              : null,
          resultingQty: null,
          syncStatus: "NOT_LINKED",
          syncError: null,
        });
        continue;
      }

      const info = variants.get(line.variantId);
      if (!info)
        throw new BadRequestException(`Ismeretlen termék: ${line.variantId}.`);
      if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
        throw new BadRequestException(`Érvénytelen mennyiség: ${info.sku}.`);
      if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
        throw new BadRequestException(
          `Érvénytelen beszerzési ár: ${info.sku}.`,
        );

      const actualQuantity = new Prisma.Decimal(line.actualQuantity);
      const before =
        runningQtyByVariant.get(line.variantId) ?? new Prisma.Decimal(0);
      const resultingQty = before.plus(actualQuantity);
      runningQtyByVariant.set(line.variantId, resultingQty);

      preparedLines.push({
        variantId: line.variantId,
        sourceDescription: line.sourceDescription?.trim() || null,
        orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
        actualQuantity,
        unit: line.unit.trim() || info.unit,
        unitNet: new Prisma.Decimal(line.unitNet),
        discountPercent:
          line.discountPercent !== undefined
            ? new Prisma.Decimal(line.discountPercent)
            : null,
        resultingQty,
        syncStatus: "OK",
        syncError: null,
      });
    }

    // A UNAS-push a helyi írás előtt történik (ugyanaz a sorrend, mint a
    // POS eladásnál és a leltár korrekciónál): mire a tranzakció lefut, már
    // minden sor szinkron-eredménye ismert, és rögtön az első íráskor
    // rögzíthető.
    let successCount = 0;
    let failedCount = 0;
    const token = await this.unasAuth.getToken();
    for (const line of preparedLines) {
      // Terméktörzs nélküli tételnél (syncStatus már "NOT_LINKED") nincs
      // cikkszám, amit a UNAS-nak push-olni lehetne - kihagyjuk, és nem
      // számít bele a sikeres/sikertelen szinkron összesítésbe sem.
      if (!line.variantId) continue;
      const info = variants.get(line.variantId)!;
      try {
        await this.unasApi.setStock(token, {
          sku: info.sku,
          // A fenti "continue" miatt ide csak variantId-vel rendelkező sorok
          // jutnak el, azoknál pedig a resultingQty mindig ki van töltve.
          qty: line.resultingQty!.toString(),
          comment: `Beszerzés (${documentNumber})`,
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

    return { detail, successCount, failedCount };
  }
}
