import { Injectable } from "@nestjs/common";
import type {
  CatalogFieldDiff,
  ImportRowResult,
  UnasProductDryRunRow,
  UnasProductImportRow,
} from "@acropora/types";

export interface CatalogProductSnapshot {
  sku: string;
  name: string;
  brandName: string | null;
  categoryIds: string[];
  imageUrls: string[];
  externalStatus: string | null;
  isActive: boolean;
}

const sorted = (values: readonly string[]) => [...values].sort();
const same = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right);

@Injectable()
export class UnasDiffEngine {
  diff(
    staged: ImportRowResult<UnasProductImportRow>[],
    catalog: ReadonlyMap<string, CatalogProductSnapshot>,
  ): UnasProductDryRunRow[] {
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
      const changes: CatalogFieldDiff[] = [];
      const add = (
        field: CatalogFieldDiff["field"],
        before: unknown,
        after: unknown,
      ) => {
        if (!same(before, after)) changes.push({ field, before, after });
      };
      add("title", current.name, result.row.name);
      add("brand", current.brandName, result.row.brandName ?? null);
      add(
        "category",
        sorted(current.categoryIds),
        sorted(
          [
            result.row.primaryCategoryExternalId,
            ...(result.row.alternativeCategoryExternalIds ?? []),
          ].filter((value): value is string => Boolean(value)),
        ),
      );
      add(
        "images",
        sorted(current.imageUrls),
        sorted(result.row.imageUrls ?? []),
      );
      add(
        "channelListing",
        current.externalStatus,
        result.row.externalStatus ?? null,
      );
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
}
