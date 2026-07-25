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
import { extname } from "node:path";
import { BadRequestException, Body, Controller, Get, Patch, Param, Post, Query, UploadedFile, UseInterceptors, } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PERMISSIONS } from "@acropora/types";
import { memoryStorage } from "multer";
import { CurrentUser } from "../../auth/decorators/current-user.decorator.js";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator.js";
import { ApproveUnasImportDto } from "./dto/approve-unas-import.dto.js";
import { BrandReviewQueryDto, BulkBrandReviewDto, UpdateBrandReviewDto, } from "./dto/brand-review.dto.js";
import { UnasApplyService } from "./unas-apply.service.js";
import { UnasBrandReviewService } from "./unas-brand-review.service.js";
import { UnasImportService } from "./unas-import.service.js";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
let UnasImportController = class UnasImportController {
    service;
    applyService;
    brandReviewService;
    constructor(service, applyService, brandReviewService) {
        this.service = service;
        this.applyService = applyService;
        this.brandReviewService = brandReviewService;
    }
    brandReviews(batchId, query) {
        return this.brandReviewService.list(batchId, query);
    }
    updateBrandReview(batchId, reviewId, input, user) {
        return this.brandReviewService.update(batchId, reviewId, input, user.id);
    }
    bulkBrandReviews(batchId, input, user) {
        return this.brandReviewService.bulk(batchId, input, user.id);
    }
    dryRun(file) {
        if (!file)
            throw new BadRequestException("Az XLSX fájl kötelező.");
        return this.service.stageAndDryRun(file);
    }
    approve(batchId, input, user) {
        return this.applyService.approve(batchId, input, user.id);
    }
    apply(batchId, user) {
        return this.applyService.apply(batchId, user.id);
    }
    report(batchId) {
        return this.service.getReport(batchId);
    }
};
__decorate([
    Get(":batchId/brand-reviews"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Query()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, BrandReviewQueryDto]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "brandReviews", null);
__decorate([
    Patch(":batchId/brand-reviews/:reviewId"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Param("reviewId")),
    __param(2, Body()),
    __param(3, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, UpdateBrandReviewDto, Object]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "updateBrandReview", null);
__decorate([
    Post(":batchId/brand-reviews/bulk"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, BulkBrandReviewDto, Object]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "bulkBrandReviews", null);
__decorate([
    Post("catalog/dry-run"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    UseInterceptors(FileInterceptor("file", {
        storage: memoryStorage(),
        limits: { fileSize: 25 * 1024 * 1024, files: 1 },
        fileFilter: (_request, file, callback) => {
            const valid = extname(file.originalname).toLowerCase() === ".xlsx" &&
                file.mimetype === XLSX_MIME;
            callback(valid
                ? null
                : new BadRequestException("Csak XLSX fájl tölthető fel."), valid);
        },
    })),
    __param(0, UploadedFile()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "dryRun", null);
__decorate([
    Post(":batchId/approve"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, Body()),
    __param(2, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, ApproveUnasImportDto, Object]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "approve", null);
__decorate([
    Post(":batchId/apply"),
    RequirePermissions(PERMISSIONS.PRODUCTS_MANAGE),
    __param(0, Param("batchId")),
    __param(1, CurrentUser()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "apply", null);
__decorate([
    Get(":batchId/report"),
    RequirePermissions(PERMISSIONS.PRODUCTS_VIEW),
    __param(0, Param("batchId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UnasImportController.prototype, "report", null);
UnasImportController = __decorate([
    Controller("imports/unas"),
    __metadata("design:paramtypes", [UnasImportService,
        UnasApplyService,
        UnasBrandReviewService])
], UnasImportController);
export { UnasImportController };
//# sourceMappingURL=unas-import.controller.js.map