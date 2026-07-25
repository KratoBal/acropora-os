var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
const issue = (severity, code, message, field) => ({ severity, code, message, ...(field ? { field } : {}) });
let UnasImportValidator = class UnasImportValidator {
    validate(workbook) {
        const categories = new Set(workbook.categories
            .map((category) => category.externalId)
            .filter(Boolean));
        const brands = new Set(workbook.brands.map((brand) => brand.name.toLocaleLowerCase("hu")));
        const skuCounts = new Map();
        workbook.products.forEach((product) => {
            if (product.sku)
                skuCounts.set(product.sku, (skuCounts.get(product.sku) ?? 0) + 1);
        });
        return workbook.products.map((product) => {
            const issues = [];
            if (!product.sku)
                issues.push(issue("ERROR", "MISSING_SKU", "A SKU kötelező.", "sku"));
            if (!product.name)
                issues.push(issue("ERROR", "MISSING_NAME", "A terméknév kötelező.", "name"));
            if (product.sku && (skuCounts.get(product.sku) ?? 0) > 1)
                issues.push(issue("ERROR", "DUPLICATE_SKU", `Duplikált SKU: ${product.sku}.`, "sku"));
            const references = [
                product.primaryCategoryExternalId,
                ...(product.alternativeCategoryExternalIds ?? []),
            ].filter((value) => Boolean(value));
            references
                .filter((reference) => !categories.has(reference))
                .forEach((reference) => issues.push(issue("ERROR", "INVALID_CATEGORY_REFERENCE", `Ismeretlen kategóriahivatkozás: ${reference}.`, "categories")));
            if (!product.brandName)
                issues.push(issue("WARNING", "MISSING_BRAND", "A termékhez nincs brand megadva.", "brandName"));
            else if (brands.size &&
                !brands.has(product.brandName.toLocaleLowerCase("hu")))
                issues.push(issue("WARNING", "MISSING_BRAND", `A brand nem található a Brands lapon: ${product.brandName}.`, "brandName"));
            for (const url of product.imageUrls ?? []) {
                try {
                    const parsed = new URL(url);
                    if (!["http:", "https:"].includes(parsed.protocol))
                        throw new Error();
                }
                catch {
                    issues.push(issue("WARNING", "INVALID_IMAGE", `Érvénytelen kép URL: ${url}.`, "imageUrls"));
                }
            }
            if (product.externalStatus &&
                !["0", "1", "2", "3"].includes(product.externalStatus))
                issues.push(issue("WARNING", "UNEXPECTED_STATUS", `Nem várt UNAS státusz: ${product.externalStatus}.`, "externalStatus"));
            return {
                sourceRowNumber: product.sourceRowNumber,
                row: product,
                issues,
                transformedEntityIds: {},
                status: issues.some((item) => item.severity === "ERROR")
                    ? "INVALID"
                    : "VALID",
            };
        });
    }
};
UnasImportValidator = __decorate([
    Injectable()
], UnasImportValidator);
export { UnasImportValidator };
//# sourceMappingURL=unas-import.validator.js.map