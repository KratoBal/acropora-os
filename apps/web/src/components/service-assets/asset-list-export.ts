import { assetKindLabel, type AssetKind } from "@acropora/types";

import { readUnitFilter } from "@/lib/partners/unit-filter";

import { TABS } from "./asset-list-page";
import { assetListQuery } from "./pilot/asset-list-query";

/**
 * AZ ESZKÖZLISTA NYOMTATÁSÁNAK ÉS EXCELJÉNEK KÉRÉSE (kártya 323e9b38): a
 * lista címsorának szűrői, PONTOSAN úgy, ahogy a lista maga kéri (a lista
 * saját `assetListQuery`-je, az alapértelmezett „Beépített” füllel), csak a
 * lapozás nélkül. Ha ez és a
 * lista kérése valaha eltávolodna, a papíron más állna, mint a képernyőn.
 */
export function assetExportQuery(params: URLSearchParams): URLSearchParams {
  const value = assetListQuery(params);
  value.delete("page");
  value.delete("pageSize");
  return value;
}

/**
 * A NYOMTATÁS FEJLÉCE: a szűrők emberi nyelven, hogy a papírról is
 * kiderüljön, MIT nyomtattak ki (Feri: „a lámpák”, „a matrica nélküliek”).
 * Ami nincs beállítva, az nem kerül bele.
 */
export function assetFilterSummary(
  params: URLSearchParams,
  lookups: {
    categoryName?: (id: string) => string | undefined;
    ownerName?: string;
  } = {},
): string[] {
  const lines: string[] = [];
  const status = params.get("status") ?? "IN_PLACE";
  // a lista fülének felirata: az „IN_PLACE” fül, nem állapot (Beépített)
  lines.push(
    `Állapot: ${TABS.find((tab) => tab.key === status)?.label ?? status}`,
  );
  const search = params.get("search")?.trim();
  if (search) lines.push(`Keresés: „${search}”`);
  const kind = params.get("kind");
  if (kind) lines.push(`Típus: ${assetKindLabel[kind as AssetKind] ?? kind}`);
  if (params.get("category") === "without")
    lines.push("Kategória: nincs kategória");
  else {
    const categoryId = params.get("categoryId");
    if (categoryId)
      lines.push(
        `Kategória: ${lookups.categoryName?.(categoryId) ?? "kiválasztott kategória"}`,
      );
  }
  if (params.get("ownerId"))
    lines.push(`Tulajdonos: ${lookups.ownerName ?? "kiválasztott partner"}`);
  const units = readUnitFilter(params);
  if (units.length)
    lines.push(
      `Helyszín: ${units.length === 1 ? "1 kiválasztott egység" : `${units.length} kiválasztott egység`}`,
    );
  if (params.get("label") === "without") lines.push("Matrica: nincs matricája");
  if (params.get("label") === "with") lines.push("Matrica: van matricája");
  return lines;
}
