import type {
  AssetCriticality,
  AssetEventType,
  AssetKind,
  AssetStatus,
} from "@acropora/types";

export const assetKindLabel: Record<AssetKind, string> = {
  SYSTEM: "Rendszer",
  EQUIPMENT: "Berendezés",
  COMPONENT: "Részegység",
  SENSOR: "Szenzor",
  OTHER: "Egyéb",
};

export const assetStatusLabel: Record<AssetStatus, string> = {
  ACTIVE: "Aktív",
  OUT_OF_SERVICE: "Nem üzemel",
  IN_REPAIR: "Javítás alatt",
  RETIRED: "Kivezetett",
};

export const assetCriticalityLabel: Record<AssetCriticality, string> = {
  LOW: "Alacsony",
  NORMAL: "Normál",
  HIGH: "Magas",
  CRITICAL: "Kritikus",
};

export const assetEventLabel: Record<AssetEventType, string> = {
  CREATED: "Eszköz létrehozva",
  UPDATED: "Adatok módosítva",
  PLACEMENT_CHANGED: "Elhelyezés módosítva",
  PARENT_CHANGED: "Hierarchia módosítva",
  STATUS_CHANGED: "Státusz módosítva",
  QR_ROTATED: "QR-kód lecserélve",
};
