import type { ServiceTone } from "@/components/service/service-theme";
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
  LABEL_ASSIGNED: "Matrica hozzárendelve",
  DOCUMENT_UPLOADED: "Dokumentum feltöltve",
  DOCUMENT_DELETED: "Dokumentum törölve",
};

/**
 * AZ ESZKOZALLAPOT SZINE Balazs 2026-09-15-i szerviz-designjaban.
 *
 * EZ AZ EGYETLEN HELY: eddig ugyanez a szabaly KET fuggvenyben allt, beture
 * azonos torzzsel (`asset-list-page.tsx` es `asset-detail-page.tsx`), es a
 * ketto kozul barmelyiket at lehetett volna irni ugy, hogy a masik marad.
 *
 * EGY VALTOZAS A KORABBI ALAKHOZ KEPEST, ES SZANDEKOS: a "Nem uzemel" eddig
 * amber volt (a `RETIRED`-en kivul minden nem-aktiv allapot az volt), a design
 * szerint PIROS. Ez nem szinezes: a javitas alatt allo eszkoz VART allapot, a
 * nem uzemelo pedig egy meg fel nem vett teendo, es a listan ma ugyanugy
 * nezett ki a ketto.
 */
export const assetStatusTone: Record<AssetStatus, ServiceTone> = {
  ACTIVE: "green",
  IN_REPAIR: "amber",
  OUT_OF_SERVICE: "red",
  RETIRED: "neutral",
};
