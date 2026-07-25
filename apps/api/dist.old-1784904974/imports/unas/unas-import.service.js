var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { createHash } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { UnasDiffEngine } from "./unas-diff.engine.js";
import { UnasImportRepository } from "./unas-import.repository.js";
import { UnasImportValidator } from "./unas-import.validator.js";
import { UnasXlsxParser } from "./unas-xlsx.parser.js";
import { BrandResolutionEngine } from "./brand-resolution/brand-resolution.engine.js";
import { summarizeBrandResolution } from "./brand-resolution/brand-resolution.report.js";
import { BRAND_RESOLUTION_VERSIONS } from "./brand-resolution/brand-resolution.config.js";
let UnasImportService = class UnasImportService {
    parser;
    validator;
    diffEngine;
    repository;
    brandResolution;
    constructor(parser, validator, diffEngine, repository, brandResolution) {
        this.parser = parser;
        this.validator = validator;
        this.diffEngine = diffEngine;
        this.repository = repository;
        this.brandResolution = brandResolution;
    }
    async stageAndDryRun(file) {
        const hash = createHash("sha256").update(file.buffer).digest("hex");
        const existing = await this.repository.findReportByHash(hash, BRAND_RESOLUTION_VERSIONS.config);
        if (existing)
            return existing;
        const workbook = await this.parser.parse(file.buffer);
        const validated = this.validator.validate(workbook);
        const resolutions = this.brandResolution.resolveAll(workbook.products);
        const resolutionByRow = new Map(resolutions.map((resolution) => [resolution.sourceRowNumber, resolution]));
        const resolvedForDiff = validated.map((result) => {
            const resolution = resolutionByRow.get(result.sourceRowNumber);
            return resolution?.status === "RESOLVED" && !result.row.brandName
                ? {
                    ...result,
                    row: { ...result.row, brandName: resolution.selectedBrandName },
                }
                : result;
        });
        const [catalog, categories] = await Promise.all([
            this.repository.catalogSnapshot(),
            this.repository.categorySnapshot(),
        ]);
        const products = this.diffEngine.diff(resolvedForDiff, catalog);
        const issues = validated.flatMap((row) => row.issues.map((item) => ({
            ...item,
            sourceRowNumber: row.sourceRowNumber,
            entityType: "PRODUCT",
        })));
        const categoryIds = new Set(workbook.categories
            .map((category) => category.externalId)
            .filter(Boolean));
        for (const category of workbook.categories) {
            if (!category.externalId)
                issues.push({
                    severity: "ERROR",
                    code: "MISSING_CATEGORY_EXTERNAL_ID",
                    message: `Hiányzó kategória external ID a(z) ${category.sourceRowNumber}. sorban.`,
                    field: "externalId",
                    sourceRowNumber: category.sourceRowNumber,
                    entityType: "CATEGORY",
                });
            if (!category.name)
                issues.push({
                    severity: "ERROR",
                    code: "MISSING_CATEGORY_NAME",
                    message: `Hiányzó kategórianév a(z) ${category.sourceRowNumber}. sorban.`,
                    field: "name",
                    sourceRowNumber: category.sourceRowNumber,
                    entityType: "CATEGORY",
                });
            if (category.parentExternalId &&
                !categoryIds.has(category.parentExternalId))
                issues.push({
                    severity: "ERROR",
                    code: "INVALID_PARENT_CATEGORY_REFERENCE",
                    message: `Ismeretlen szülőkategória: ${category.parentExternalId}.`,
                    field: "parentExternalId",
                    sourceRowNumber: category.sourceRowNumber,
                    entityType: "CATEGORY",
                });
        }
        const summary = {
            productsToCreate: products.filter((row) => row.action === "CREATE")
                .length,
            productsToUpdate: products.filter((row) => row.action === "UPDATE")
                .length,
            productsUnchanged: products.filter((row) => row.action === "UNCHANGED")
                .length,
            categoriesToCreate: workbook.categories.filter((category) => category.externalId && !categories.has(category.externalId)).length,
            categoriesToUpdate: workbook.categories.filter((category) => category.externalId &&
                categories.has(category.externalId) &&
                categories.get(category.externalId) !== category.name).length,
            validationErrors: issues.filter((item) => item.severity === "ERROR")
                .length,
            warnings: issues.filter((item) => item.severity === "WARNING").length,
        };
        const batchId = await this.repository.saveStaging(file.originalname, hash, workbook, validated, BRAND_RESOLUTION_VERSIONS.config);
        const report = {
            batchId,
            provider: "UNAS",
            sourceFileName: file.originalname,
            generatedAt: new Date().toISOString(),
            summary,
            products,
            issues,
            schemaVersion: "unas-import-report-v2",
            brandResolution: {
                summary: summarizeBrandResolution(workbook.products, resolutions),
                products: resolutions,
            },
        };
        await this.repository.saveResolutionAndReport(batchId, resolutions, report);
        return report;
    }
    async getReport(batchId) {
        const report = await this.repository.getReport(batchId);
        if (!report)
            throw new NotFoundException("Az import riport nem található.");
        return report;
    }
};
UnasImportService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [UnasXlsxParser,
        UnasImportValidator,
        UnasDiffEngine,
        UnasImportRepository,
        BrandResolutionEngine])
], UnasImportService);
export { UnasImportService };
//# sourceMappingURL=unas-import.service.js.map