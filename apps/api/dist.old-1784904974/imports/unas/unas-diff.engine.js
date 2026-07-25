var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import { Injectable } from "@nestjs/common";
const sorted = (values) => [...values].sort();
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
let UnasDiffEngine = class UnasDiffEngine {
    diff(staged, catalog) {
        return staged.map((result) => {
            if (result.status === "INVALID") {
                return {
                    sourceRowNumber: result.sourceRowNumber,
                    sku: result.row.sku,
                    productName: result.row.name,
                    action: "INVALID",
                    changes: [],
                    issues: result.issues,
                };
            }
            const current = catalog.get(result.row.sku);
            if (!current) {
                return {
                    sourceRowNumber: result.sourceRowNumber,
                    sku: result.row.sku,
                    productName: result.row.name,
                    action: "CREATE",
                    changes: [],
                    issues: result.issues,
                };
            }
            const changes = [];
            const add = (field, before, after) => {
                if (!same(before, after))
                    changes.push({ field, before, after });
            };
            add("title", current.name, result.row.name);
            add("brand", current.brandName, result.row.brandName ?? null);
            add("category", sorted(current.categoryIds), sorted([
                result.row.primaryCategoryExternalId,
                ...(result.row.alternativeCategoryExternalIds ?? []),
            ].filter((value) => Boolean(value))));
            add("images", sorted(current.imageUrls), sorted(result.row.imageUrls ?? []));
            add("channelListing", current.externalStatus, result.row.externalStatus ?? null);
            if (result.row.isActive !== undefined)
                add("activeState", current.isActive, result.row.isActive);
            return {
                sourceRowNumber: result.sourceRowNumber,
                sku: result.row.sku,
                productName: result.row.name,
                action: changes.length ? "UPDATE" : "UNCHANGED",
                changes,
                issues: result.issues,
            };
        });
    }
};
UnasDiffEngine = __decorate([
    Injectable()
], UnasDiffEngine);
export { UnasDiffEngine };
//# sourceMappingURL=unas-diff.engine.js.map