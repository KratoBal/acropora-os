/**
 * AZ AKVÁRIUM SZÓKINCSE, a fetch-rétegtől függetlenül -- ugyanaz az elv, mint
 * a `partner-presentation.ts`-nél: ebben a csomagban nincs komponens-teszt
 * eszköz, tehát ami tesztelhető kell legyen, azt ide kell tenni.
 *
 * A TÍPUSOK SZÁNDÉKOSAN NEM A `lib/api/aquariums`-BÓL JÖNNEK, importtal --
 * az onnan importált `apiRequest` a `client.ts`-en keresztül `@/`-aliast
 * használ, amit a teszt-fordítás (`tsconfig.test.json`) nem old fel (lásd
 * annak fejléc-jegyzetét). Az `asset-search.ts` `SearchableAsset`-je ugyanezt
 * a mintát követi: saját, szerkezetileg egyező típus, nem import.
 *
 * A CÍMKÉK EGY HELYEN ÁLLNAK. Ha egy képernyő saját szöveget írna ugyanarra
 * az értékre, két hely mondaná ugyanazt -- és ha egyszer elválnak, az a fajta
 * hiba, aminek a fordító nem szól, mert mindkét string érvényes.
 */

export type AquariumOwnershipType = "OWN" | "CUSTOMER";
export type WaterBodyType = "AKVARIUM" | "TO";
export type WaterType = "EDESVIZI" | "TENGERI";
export type AquariumEquipmentKind =
  | "VILAGITAS"
  | "ARAMOLTATAS"
  | "LEHABZO"
  | "FELNYOMO"
  | "BIO_SZURES"
  | "MEDIA_REAKTOR"
  | "NYOMELEM_ADAGOLO"
  | "FUTES"
  | "HUTES"
  | "EGYEB";

/** Csak amit a `aquariumListSubtitle` ténylegesen használ. */
export interface AquariumListLike {
  ownershipType: AquariumOwnershipType;
  customerName?: string;
  systemVolumeLiters?: number;
  equipmentCount: number;
}

export const OWNERSHIP_LABELS: Record<AquariumOwnershipType, string> = {
  OWN: "Saját",
  CUSTOMER: "Ügyfél",
};

export const OWNERSHIP_OPTIONS: {
  value: AquariumOwnershipType;
  label: string;
}[] = (["OWN", "CUSTOMER"] as const).map((value) => ({
  value,
  label: OWNERSHIP_LABELS[value],
}));

export const WATER_BODY_LABELS: Record<WaterBodyType, string> = {
  AKVARIUM: "Akvárium",
  TO: "Tó",
};

export const WATER_BODY_OPTIONS: {
  value: WaterBodyType;
  label: string;
}[] = (["AKVARIUM", "TO"] as const).map((value) => ({
  value,
  label: WATER_BODY_LABELS[value],
}));

/** A brief 5. döntésének sorrendje (a felvitel ebben a sorrendben kínálja). */
export const EQUIPMENT_KIND_ORDER: AquariumEquipmentKind[] = [
  "VILAGITAS",
  "ARAMOLTATAS",
  "LEHABZO",
  "FELNYOMO",
  "BIO_SZURES",
  "MEDIA_REAKTOR",
  "NYOMELEM_ADAGOLO",
  "FUTES",
  "HUTES",
  "EGYEB",
];

export const EQUIPMENT_KIND_LABELS: Record<AquariumEquipmentKind, string> = {
  VILAGITAS: "Világítás",
  ARAMOLTATAS: "Áramoltatás",
  LEHABZO: "Lehabzó",
  FELNYOMO: "Felnyomó",
  BIO_SZURES: "Biológiai szűrés",
  MEDIA_REAKTOR: "Média reaktor",
  NYOMELEM_ADAGOLO: "Nyomelem adagoló",
  FUTES: "Fűtés",
  HUTES: "Hűtés",
  EGYEB: "Egyéb",
};

export const EQUIPMENT_KIND_OPTIONS: {
  value: AquariumEquipmentKind;
  label: string;
}[] = EQUIPMENT_KIND_ORDER.map((value) => ({
  value,
  label: EQUIPMENT_KIND_LABELS[value],
}));

/**
 * CSAK A NYOMELEM ADAGOLÓNÁL KÖTELEZŐ a csatornaszám (brief 5. döntés). A
 * felvitel ezt kérdezi meg, mielőtt a sort menthetőnek jelöli.
 */
export function equipmentRequiresChannelCount(
  kind: AquariumEquipmentKind,
): boolean {
  return kind === "NYOMELEM_ADAGOLO";
}

function formatLiters(value: number | undefined): string | null {
  if (value === undefined) return null;
  return `${value.toLocaleString("hu-HU", { maximumFractionDigits: 3 })} l`;
}

/**
 * A LISTA-SOR ALCÍME. Hiányzó adat nem üres szövegként jelenik meg: a
 * felsorolás csak azt tartalmazza, amiről tényleg van mit mondani.
 */
export function aquariumListSubtitle(item: AquariumListLike): string {
  const parts: string[] = [];
  parts.push(
    item.ownershipType === "CUSTOMER" && item.customerName
      ? item.customerName
      : OWNERSHIP_LABELS[item.ownershipType],
  );
  const liters = formatLiters(item.systemVolumeLiters);
  if (liters) parts.push(liters);
  parts.push(
    item.equipmentCount === 1 ? "1 eszköz" : `${item.equipmentCount} eszköz`,
  );
  return parts.join(" · ");
}
