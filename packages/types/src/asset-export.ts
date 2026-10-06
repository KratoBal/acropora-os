import { assetStatusLabel, type AssetListItem } from "./asset-management.js";

/**
 * AZ ESZKÖZLISTA NYOMTATÁSA ÉS EXCELJE (kártya 323e9b38; Balázs „mehet”,
 * 2026-10-06 11:58 UTC). Feri (szervizes) a lámpákat, a matrica nélküli
 * eszközöket vagy egy gyártó eszközeit a helyükkel akarja kinyomtatni: a
 * lista a szűrők és a keresés UTÁN, a TELJES szűrt halmaz, nem csak a lap.
 *
 * A sor itt áll, és nem a webben vagy az API-ban: az Excel (API) és a
 * nyomtatás (web) ugyanazt a sort adja, és egyszer publikus felületen is
 * kellhet.
 *
 * Az oszlopok a lista (pilot lista) oszlopai, plusz a hely két része külön
 * (helyszín és egység) és a matricakód saját oszlopban.
 */
export const ASSET_EXPORT_HEADERS = [
  "Név",
  "Eszközszám",
  "Matricakód",
  "Partner belső kódja",
  "Tulajdonos",
  "Helyszín",
  "Egység",
  "Hierarchia",
  "Kategória",
  "Gyártó",
  "Modell",
  "Státusz",
] as const;

/**
 * A TELJES SZŰRT HALMAZ FELSŐ HATÁRA. Egy nyomtatott lista ennél jóval
 * rövidebb; ha a szűrés ennél többet hoz, az export elutasít, és azt kéri,
 * hogy szűkítsenek, ahelyett hogy csendben levágná a végét.
 */
export const ASSET_EXPORT_MAX = 5000;

/** Egy eszköz a nyomtatás és az Excel egy sora, az `ASSET_EXPORT_HEADERS` sorrendjében. */
export function assetExportCells(asset: AssetListItem): string[] {
  return [
    asset.name,
    asset.assetNumber,
    asset.labelCode ?? "",
    asset.partnerInternalCode ?? "",
    asset.owner.displayName,
    asset.address?.formatted ?? "",
    asset.unit ? `${asset.unit.path.join(" / ")} (${asset.unit.code})` : "",
    asset.parent
      ? `Része: ${asset.parent.name}`
      : asset.childCount
        ? `${asset.childCount} részegység`
        : "Önálló eszköz",
    asset.category ?? "",
    asset.manufacturer ?? "",
    asset.model ?? "",
    assetStatusLabel[asset.status],
  ];
}
