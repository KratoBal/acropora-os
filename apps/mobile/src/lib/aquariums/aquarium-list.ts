import { OWNERSHIP_LABEL } from "./aquarium-labels";
import type { AquariumOwnershipType } from "./aquarium-create";

/**
 * A LISTA-SOR ALCÍME, a képernyőtől külön -- ugyanazért az okért, mint az
 * `aquarium-create.ts` fejlécében: ebben a csomagban nincs komponens-teszt
 * eszköz, tehát ami tesztelhető kell legyen, azt ide kell tenni.
 *
 * Csak amit ténylegesen használ -- szerkezeti típus, nem `lib/api/aquariums`
 * import (az `apiRequest`-en keresztül `@/`-aliast használ, amit a
 * teszt-fordítás nem old fel, lásd `tsconfig.test.json` fejlécét).
 */
export interface AquariumListRow {
  ownershipType: AquariumOwnershipType;
  customerName?: string;
  systemVolumeLiters?: number;
  equipmentCount: number;
}

function formatLiters(value: number | undefined): string | null {
  if (value === undefined) return null;
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 3 })} l`;
}

/**
 * Hiányzó adat nem üres szövegként jelenik meg: a felsorolás csak azt
 * tartalmazza, amiről tényleg van mit mondani.
 */
export function aquariumListSubtitle(item: AquariumListRow): string {
  const parts: string[] = [];
  parts.push(
    item.ownershipType === "CUSTOMER" && item.customerName
      ? item.customerName
      : OWNERSHIP_LABEL[item.ownershipType],
  );
  const liters = formatLiters(item.systemVolumeLiters);
  if (liters) parts.push(liters);
  parts.push(
    item.equipmentCount === 1 ? "1 eszköz" : `${item.equipmentCount} eszköz`,
  );
  return parts.join(" · ");
}
