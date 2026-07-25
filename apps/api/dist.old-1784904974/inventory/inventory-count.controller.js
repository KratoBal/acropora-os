var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, StreamableFile, UploadedFile, UseInterceptors, } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS } from "@acropora/types";
import { memoryStorage } from "multer";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator.js";
import { InventoryCountListQueryDto } from "./dto/inventory-count-list-query.dto.js";
import { UpdateInventoryCountLineDto } from "./dto/update-inventory-count-line.dto.js";
import { InventoryCountService } from "./inventory-count.service.js";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let InventoryCountController = class InventoryCountController {
    counts;
    constructor(counts) {
        this.counts = counts;
    }
    list(query) {
        return this.counts.list(query);
    }
    detail(id) {
        return this.counts.getDetail(id);
    }
    create(user) {
        return this.counts.createCount(user.id);
    }
    async downloadTemplate(id) {
        const { filename, buffer } = await this.counts.exportTemplate(id);
        return new StreamableFile(buffer, {
            type: XLSX_MIME,
            disposition: `attachment; filename="${filename}"`,
            length: buffer.length,
        });
    }
    upload(id, file) {
        if (!file)
            throw new BadRequestException("Az XLSX fájl kötelező.");
        return this.counts.uploadCounts(id, file.buffer);
    }
    updateLine(id, lineId, dto) {
        return this.counts.updateLineCount(id, lineId, dto.countedQty);
    }
    apply(id, user) {
        return this.counts.applyCorrection(id, user.id);
    }
};
__decorate([
    Get(),
    RequirePermissions(PERMISSIONS.INVENTORY_VIEW),
    __param(0, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [InventoryCountListQueryDto]),
    __metadata("design:returntype", void 0)
], InventoryCountController.prototype, "list", null);
__decorate([
    Get(":id"),
    RequirePermissions(PERMISSIONS.INVENTORY_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], InventoryCountController.prototype, "detail", null);
__decorate([
    Post(),
    RequirePermissions(PERMISSIONS.INVENTORY_MANAGE),
    __param(0, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InventoryCountController.prototype, "create", null);
__decorate([
    Get(":id/template.xlsx"),
    RequirePermissions(PERMISSIONS.INVENTORY_VIEW),
    __param(0, Param("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], InventoryCountController.prototype, "downloadTemplate", null);
__decorate([
    Post(":id/upload"),
    RequirePermissions(PERMISSIONS.INVENTORY_MANAGE),
    UseInterceptors(FileInterceptor("file", {
        storage: memoryStorage(),
        limits: { fileSize: 25 * 1024 * 1024, files: 1 },
        fileFilter: (_request, file, callback) => {
            const valid = file.originalname.toLowerCase().endsWith(".xlsx") &&
                file.mimetype === XLSX_MIME;
            callback(valid
                ? null
                : new BadRequestException("Csak XLSX fájl tölthető fel."), valid);
        },
    })),
    __param(0, Param("id")),
    __param(1, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryCountController.prototype, "upload", null);
__decorate([
    Patch(":id/lines/:lineId"),
    RequirePermissions(PERMISSIONS.INVENTORY_MANAGE),
    __param(0, Param("id")),
    __param(1, Param("lineId")),
    __param(2, Body()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, UpdateInventoryCountLineDto]),
    __metadata("design:returntype", void 0)
], InventoryCountController.prototype, "updateLine", null);
__decorate([
    Post(":id/apply"),
    RequirePermissions(PERMISSIONS.INVENTORY_MANAGE),
    __param(0, Param("id")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InventoryCountController.prototype, "apply", null);
InventoryCountController = __decorate([
    Controller("inventory/counts"),
    __metadata("design:paramtypes", [InventoryCountService])
], InventoryCountController);
export { InventoryCountController };
//# sourceMappingURL=inventory-count.controller.js.map