var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadGatewayException, BadRequestException, Injectable, NotFoundException, } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { generateCode } from "../common/code-generator.util.js";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import { MnbExchangeRateService } from "../integrations/mnb/mnb-exchange-rate.service.js";
import { SuppliersRepository } from "../suppliers/suppliers.repository.js";
import { PurchaseInvoiceRepository, } from "./purchase-invoice.repository.js";
import { PurchaseProductSearchService } from "./purchase-product-search.service.js";
let PurchasingService = class PurchasingService {
    invoices;
    suppliers;
    productSearch;
    mnbRates;
    unasApi;
    unasAuth;
    constructor(invoices, suppliers, productSearch, mnbRates, unasApi, unasAuth) {
        this.invoices = invoices;
        this.suppliers = suppliers;
        this.productSearch = productSearch;
        this.mnbRates = mnbRates;
        this.unasApi = unasApi;
        this.unasAuth = unasAuth;
    }
    searchProducts(query) {
        return this.productSearch.search(query);
    }
    async getExchangeRate(currency, date) {
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
        }
        catch (error) {
            throw this.mapExchangeRateError(error);
        }
    }
    mapExchangeRateError(error) {
        if (error instanceof NotFoundException)
            return error;
        return new BadGatewayException("Az MNB árfolyam-szolgáltatás jelenleg nem érhető el. Add meg az árfolyamot kézzel.");
    }
    list(query) {
        return this.invoices.list(query);
    }
    async getDetail(id) {
        const detail = await this.invoices.findById(id);
        if (!detail)
            throw new NotFoundException("A beszerzési számla nem található.");
        return detail;
    }
    async createInvoice(input, actorUserId) {
        if (input.lines.length === 0)
            throw new BadRequestException("Legalább egy tétel szükséges a számlához.");
        const supplier = await this.suppliers.detail(input.supplierId);
        if (!supplier)
            throw new NotFoundException("A beszállító nem található.");
        const currency = input.currency.trim().toUpperCase();
        const invoiceDate = new Date(input.invoiceDate);
        if (Number.isNaN(invoiceDate.getTime()))
            throw new BadRequestException("Érvénytelen számla kelte.");
        let exchangeRate;
        let vatRate;
        if (input.source === "EU") {
            vatRate = null;
            if (currency === "HUF") {
                exchangeRate = null;
            }
            else if (input.exchangeRate !== undefined) {
                exchangeRate = new Prisma.Decimal(input.exchangeRate);
            }
            else {
                try {
                    const resolved = await this.mnbRates.getRateForDate(currency, invoiceDate);
                    exchangeRate = new Prisma.Decimal(resolved.rate);
                }
                catch {
                    throw new BadRequestException("Az árfolyam automatikus lekérdezése nem sikerült. Add meg az árfolyamot kézzel.");
                }
            }
        }
        else {
            if (currency !== "HUF")
                throw new BadRequestException("Belföldi számlánál a pénznem csak HUF lehet.");
            exchangeRate = null;
            if (input.vatRate === undefined)
                throw new BadRequestException("Belföldi számlánál az ÁFA-kulcs megadása kötelező.");
            vatRate = new Prisma.Decimal(input.vatRate);
        }
        const variantIds = input.lines
            .map((line) => line.variantId)
            .filter((variantId) => Boolean(variantId));
        const { warehouseId, variants } = await this.invoices.currentStock(variantIds);
        const runningQtyByVariant = new Map([...variants.entries()].map(([variantId, info]) => [
            variantId,
            info.currentQty,
        ]));
        const documentNumber = generateCode("BESZ");
        const preparedLines = [];
        for (const line of input.lines) {
            if (!line.variantId) {
                const sourceDescription = line.sourceDescription?.trim();
                if (!sourceDescription)
                    throw new BadRequestException("A terméktörzsben nem szereplő tételeknél a számlán szereplő megnevezés megadása kötelező.");
                if (!line.unit.trim())
                    throw new BadRequestException(`Az egység megadása kötelező: ${sourceDescription}.`);
                if (!Number.isFinite(line.actualQuantity) || line.actualQuantity < 0)
                    throw new BadRequestException(`Érvénytelen mennyiség: ${sourceDescription}.`);
                if (!Number.isFinite(line.unitNet) || line.unitNet < 0)
                    throw new BadRequestException(`Érvénytelen beszerzési ár: ${sourceDescription}.`);
                preparedLines.push({
                    variantId: null,
                    sourceDescription,
                    orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
                    actualQuantity: new Prisma.Decimal(line.actualQuantity),
                    unit: line.unit.trim(),
                    unitNet: new Prisma.Decimal(line.unitNet),
                    discountPercent: line.discountPercent !== undefined
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
                throw new BadRequestException(`Érvénytelen beszerzési ár: ${info.sku}.`);
            const actualQuantity = new Prisma.Decimal(line.actualQuantity);
            const before = runningQtyByVariant.get(line.variantId) ?? new Prisma.Decimal(0);
            const resultingQty = before.plus(actualQuantity);
            runningQtyByVariant.set(line.variantId, resultingQty);
            preparedLines.push({
                variantId: line.variantId,
                sourceDescription: line.sourceDescription?.trim() || null,
                orderedQuantity: new Prisma.Decimal(line.orderedQuantity),
                actualQuantity,
                unit: line.unit.trim() || info.unit,
                unitNet: new Prisma.Decimal(line.unitNet),
                discountPercent: line.discountPercent !== undefined
                    ? new Prisma.Decimal(line.discountPercent)
                    : null,
                resultingQty,
                syncStatus: "OK",
                syncError: null,
            });
        }
        let successCount = 0;
        let failedCount = 0;
        const token = await this.unasAuth.getToken();
        for (const line of preparedLines) {
            if (!line.variantId)
                continue;
            const info = variants.get(line.variantId);
            try {
                await this.unasApi.setStock(token, {
                    sku: info.sku,
                    qty: line.resultingQty.toString(),
                    comment: `Beszerzés (${documentNumber})`,
                });
                line.syncStatus = "OK";
                line.syncError = null;
                successCount += 1;
            }
            catch (error) {
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
};
PurchasingService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PurchaseInvoiceRepository,
        SuppliersRepository,
        PurchaseProductSearchService,
        MnbExchangeRateService,
        UnasApiClient,
        UnasAuthService])
], PurchasingService);
export { PurchasingService };
//# sourceMappingURL=purchasing.service.js.map