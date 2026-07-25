var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, Injectable, NotFoundException, } from "@nestjs/common";
import { Prisma } from "@acropora/database";
import { generateCode } from "../common/code-generator.util.js";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import { PosSaleRepository, } from "./pos-sale.repository.js";
let PosSaleService = class PosSaleService {
    sales;
    unasApi;
    unasAuth;
    constructor(sales, unasApi, unasAuth) {
        this.sales = sales;
        this.unasApi = unasApi;
        this.unasAuth = unasAuth;
    }
    list(query) {
        return this.sales.list(query);
    }
    async getDetail(id) {
        const detail = await this.sales.findById(id);
        if (!detail)
            throw new NotFoundException("Az eladás nem található.");
        return detail;
    }
    async createSale(input, actorUserId) {
        if (input.lines.length === 0) {
            throw new BadRequestException("Legalább egy tétel szükséges az eladáshoz.");
        }
        const mergedByVariant = new Map();
        for (const line of input.lines) {
            const existing = mergedByVariant.get(line.variantId);
            if (existing) {
                existing.quantity += line.quantity;
                existing.unitGross = line.unitGross;
            }
            else {
                mergedByVariant.set(line.variantId, {
                    quantity: line.quantity,
                    unitGross: line.unitGross,
                });
            }
        }
        const variantIds = [...mergedByVariant.keys()];
        const { warehouseId, variants } = await this.sales.currentStock(variantIds);
        const stockWarnings = [];
        const preparedLines = [];
        let totalNet = new Prisma.Decimal(0);
        let totalTax = new Prisma.Decimal(0);
        let totalGross = new Prisma.Decimal(0);
        for (const [variantId, cartLine] of mergedByVariant) {
            const info = variants.get(variantId);
            if (!info) {
                throw new BadRequestException(`Ismeretlen termék: ${variantId}.`);
            }
            if (info.vatRate === null) {
                throw new BadRequestException(`Nincs beállítva ÁFA kulcs ehhez a termékhez: ${info.sku}.`);
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
            }
            catch (error) {
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
};
PosSaleService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [PosSaleRepository,
        UnasApiClient,
        UnasAuthService])
], PosSaleService);
export { PosSaleService };
//# sourceMappingURL=pos-sale.service.js.map