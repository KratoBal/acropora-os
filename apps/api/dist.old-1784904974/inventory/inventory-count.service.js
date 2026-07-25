var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ConflictException, Injectable, NotFoundException, } from "@nestjs/common";
import { UnasApiClient } from "../imports/unas/unas-api.client.js";
import { UnasAuthService } from "../imports/unas/unas-auth.service.js";
import { InventoryCountXlsx } from "./inventory-count-xlsx.js";
import { InventoryCountRepository, } from "./inventory-count.repository.js";
let InventoryCountService = class InventoryCountService {
    counts;
    xlsx;
    unasApi;
    unasAuth;
    constructor(counts, xlsx, unasApi, unasAuth) {
        this.counts = counts;
        this.xlsx = xlsx;
        this.unasApi = unasApi;
        this.unasAuth = unasAuth;
    }
    list(query) {
        return this.counts.list(query);
    }
    async getDetail(id) {
        return this.requireCount(id);
    }
    createCount(actorUserId) {
        return this.counts.create(actorUserId);
    }
    async exportTemplate(id) {
        const detail = await this.requireCount(id);
        const buffer = await this.xlsx.buildTemplate(detail);
        return { filename: `${detail.countNumber}.xlsx`, buffer };
    }
    async uploadCounts(id, file) {
        const current = await this.requireCount(id);
        if (current.status === "CORRECTED") {
            throw new ConflictException("A leltár már le lett zárva, nem tölthető fel újra.");
        }
        const { rows } = await this.xlsx.parseUpload(file);
        const { detail, unmatchedSkus } = await this.counts.markUploaded(id, rows.map((row) => ({ sku: row.sku, countedQty: row.countedQty })));
        const rowBySku = new Map(rows.map((row) => [row.sku, row.sourceRowNumber]));
        return {
            detail,
            unmatchedRows: unmatchedSkus.map((sku) => ({
                sku,
                row: rowBySku.get(sku) ?? 0,
            })),
        };
    }
    async updateLineCount(id, lineId, countedQty) {
        const current = await this.requireCount(id);
        if (current.status === "CORRECTED") {
            throw new ConflictException("A leltár már le lett zárva, a mennyiségek nem módosíthatók.");
        }
        const line = current.lines.find((candidate) => candidate.id === lineId);
        if (!line) {
            throw new NotFoundException("A leltár tétel nem található.");
        }
        if (!Number.isFinite(countedQty) || countedQty < 0) {
            throw new BadRequestException("A leltározott mennyiség érvénytelen.");
        }
        return this.counts.updateLineCount(id, lineId, String(countedQty));
    }
    async applyCorrection(id, actorUserId) {
        const current = await this.requireCount(id);
        if (current.status === "DRAFT") {
            throw new ConflictException("A leltár még nincs feltöltve, korrekció nem indítható.");
        }
        if (current.status === "CORRECTED") {
            throw new ConflictException("A leltár korrekciója már megtörtént.");
        }
        if (current.lines.some((line) => line.countedQty === null)) {
            throw new BadRequestException("Minden termékhez meg kell adni a leltározott mennyiséget a korrekció indítása előtt.");
        }
        const changedLines = current.lines.filter((line) => line.differenceQty !== null && Number(line.differenceQty) !== 0);
        const pushResults = new Map();
        if (changedLines.length > 0) {
            const token = await this.unasAuth.getToken();
            for (const line of changedLines) {
                try {
                    await this.unasApi.setStock(token, {
                        sku: line.sku,
                        qty: line.countedQty,
                        comment: `Leltár korrekció (${current.countNumber})`,
                    });
                    pushResults.set(line.id, {
                        lineId: line.id,
                        status: "OK",
                        errorMessage: null,
                    });
                }
                catch (error) {
                    pushResults.set(line.id, {
                        lineId: line.id,
                        status: "FAILED",
                        errorMessage: error instanceof Error ? error.message : "UNAS_PUSH_FAILED",
                    });
                }
            }
        }
        const result = await this.counts.applyCorrection(id, actorUserId, pushResults);
        return result;
    }
    async requireCount(id) {
        const count = await this.counts.findById(id);
        if (!count)
            throw new NotFoundException("A leltár nem található.");
        return count;
    }
};
InventoryCountService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [InventoryCountRepository,
        InventoryCountXlsx,
        UnasApiClient,
        UnasAuthService])
], InventoryCountService);
export { InventoryCountService };
//# sourceMappingURL=inventory-count.service.js.map