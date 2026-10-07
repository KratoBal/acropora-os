/**
 * AZ ELHULLÁSI NAPLÓ (kártya 115c9740; Balázs promptja 2026-10-06, acrobot
 * döntései 27141).
 *
 * Egy rekord egy elhullási esemény: egy élőlény (élő állat kategóriájú termék),
 * egy vagy több példány, a bolt egy saját akváriumában VAGY egy halas rackben
 * (legalább az egyik; a halas rack nem akvárium). A rögzítő és a rögzítés ideje
 * automatikus. Az elhullás NAPJA külön mező (Luca kérése, 2026-10-07): egy
 * bejegyzés utólag is a valódi naphoz köthető, nem csak a begépelés idejéhez. A
 * forrás kötelező, és nem csak beszállító lehet.
 */

export const MORTALITY_SOURCE_TYPES = [
  "SUPPLIER",
  "LOCAL_BREEDER",
  "TRADE",
  "OWN_BREEDING",
  "OTHER",
] as const;
export type MortalitySourceType = (typeof MORTALITY_SOURCE_TYPES)[number];

/** A forrás-típus felirata, egy helyen. */
export const MORTALITY_SOURCE_LABELS: Readonly<
  Record<MortalitySourceType, string>
> = {
  SUPPLIER: "Beszállító",
  LOCAL_BREEDER: "Helyi tenyésztő",
  TRADE: "Csere",
  OWN_BREEDING: "Saját szaporulat",
  OTHER: "Egyéb",
};

/** A lista mérete. */
export const MORTALITY_LIST_PAGE_SIZE = { default: 25, max: 100 } as const;

/** A megnevezés (`sourceNote`) leghosszabb alakja; az adatbázis is ezt tartja. */
export const MORTALITY_SOURCE_NOTE_MAX = 200;

/** A szabad szöveges élőlény-név leghosszabb alakja (az adatbázis is ezt tartja). */
export const MORTALITY_PRODUCT_NAME_MAX = 200;

export interface MortalitySource {
  type: MortalitySourceType;
  /** csak beszállítónál, ha a beszállító a rendszerben van */
  supplier: { id: string; name: string } | null;
  /**
   * a forrás szabad szöveges megnevezése: beszállítónál a rendszerben nem
   * szereplő beszállító neve (Balázs 2026-10-07), máshol pl. a tenyésztő neve
   */
  note: string | null;
}

/**
 * A HALAS RENDSZER, AHOL AZ ELHULLÁS TÖRTÉNT (Luca kérése, 2026-10-07): a halas
 * rackek nem akváriumok, és nem is kerülnek az Akváriumok menübe. A lista
 * adatbázisban áll (`MortalityLocation`), nem a kódban.
 */
export interface MortalityLocationOption {
  id: string;
  name: string;
}

export interface MortalityListItem {
  id: string;
  recordNumber: string;
  /** a rendszerbeli élőlény; `null`, ha szabad szöveggel rögzítették */
  product: {
    id: string;
    name: string;
    /** a termék adatlapjának magyar neve, ha ki van töltve */
    commonName: string | null;
  } | null;
  /** a szabad szöveges élőlény-név (Balázs 2026-10-07), ha nincs `product` */
  productName: string | null;
  quantity: number;
  /** az akvárium; `null`, ha csak halas rack áll (a kettőből legalább egy van) */
  aquarium: { id: string; name: string; aquariumNumber: string } | null;
  /** a halas rack, ha meg van adva */
  location: MortalityLocationOption | null;
  source: MortalitySource;
  recordedBy: { id: string; name: string };
  /** az elhullás napja, ÉÉÉÉ-HH-NN (Budapest naptára szerint) */
  occurredOn: string;
  /** a rögzítés ISO időpontja */
  recordedAt: string;
  photoCount: number;
}

export interface MortalityPhoto {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  createdAt: string;
}

/**
 * MIÉRT NEM VÁLTOZOTT A KÉSZLET egy bejegyzésnél (a többi esetben `null`):
 * szabad szöveges élőlény; nem készletezett (szolgáltatás) termék; a terméknek
 * nincs aktív változata, vagy több is van, és a bejegyzés nem mondja meg,
 * melyik; csomagtermék.
 */
export type MortalityStockReason =
  "FREE_TEXT" | "NOT_STOCKED" | "NO_VARIANT" | "VARIANT_NOT_CHOSEN" | "PACKAGE";

/** A bejegyzés készlethatása (a mozgásnaplóból összegezve). */
export interface MortalityStockEffect {
  /** a bejegyzés miatt levont darab, a javításokkal együtt, nettóban */
  deducted: number;
  /** a levont változat cikkszáma, ha volt levonás */
  sku: string | null;
  /** miért nem mozgott a készlet, ha nem mozgott */
  reason: MortalityStockReason | null;
}

export interface MortalityDetail extends MortalityListItem {
  note: string | null;
  stock: MortalityStockEffect;
  createdAt: string;
  /**
   * Az utolsó módosítás (az auditnapló legutóbbi `mortality.updated` sora), vagy
   * `null`, ha a bejegyzést létrehozása óta nem módosították („Nem módosították”).
   */
  lastModified: {
    at: string;
    /** `null`, ha a módosító felhasználót azóta törölték */
    by: { id: string; name: string } | null;
  } | null;
  photos: MortalityPhoto[];
}

export interface MortalityListQuery {
  page?: number;
  pageSize?: number;
  /** keresés az élőlény nevében (termék neve vagy magyar neve) */
  q?: string;
  sourceType?: MortalitySourceType;
  supplierId?: string;
  aquariumId?: string;
  recordedById?: string;
  /** ÉÉÉÉ-HH-NN, az elhullás napja ettől (zárt) */
  from?: string;
  /** ÉÉÉÉ-HH-NN, az elhullás napja eddig (zárt) */
  to?: string;
}

export interface MortalityListResponse {
  items: MortalityListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

/** A lista fölötti három összesítő kártya (példányszámban). */
export interface MortalitySummary {
  /** a folyó naptári hónap elhullott példányai */
  thisMonth: number;
  /** hány különböző akváriumban („3 akváriumban”) */
  thisMonthAquariumCount: number;
  /** az elmúlt 7 nap (a mai napot is beleértve) elhullott példányai */
  last7Days: number;
  /** az azt megelőző 7 nap, az összevetéshez („2-vel kevesebb az előző hétnél”) */
  previous7Days: number;
  /** a folyó hónap legtöbb példányt vesztett akváriuma, vagy `null` */
  mostAffectedAquarium: {
    id: string;
    name: string;
    aquariumNumber: string;
    quantity: number;
  } | null;
}

/**
 * Az élőlény a rendszerbeli termék (`productId`) VAGY a szabad szöveges név
 * (`productName`), pontosan az egyik (Balázs 2026-10-07). Beszállítói forrásnál
 * ugyanígy a `supplierId` VAGY a `sourceNote`.
 */
export interface CreateMortalityInput {
  productId?: string | null;
  productName?: string | null;
  quantity: number;
  /**
   * az akvárium VAGY a halas rack (`locationId`) kötelező, legalább az egyik
   * (2026-10-07: a halas rackek nem akváriumok)
   */
  aquariumId?: string | null;
  sourceType: MortalitySourceType;
  supplierId?: string | null;
  sourceNote?: string | null;
  note?: string | null;
  /**
   * az elhullás napja, ÉÉÉÉ-HH-NN; nem lehet a jövőben. Létrehozáskor
   * elhagyható: akkor a mai nap (Budapest szerint).
   */
  occurredOn?: string;
  /** a halas rack (`MortalityLocationOption.id`), vagy `null` */
  locationId?: string | null;
}

/** Minden mező módosítható (acrobot döntése, 27141), auditnaplóval. */
export type UpdateMortalityInput = Partial<CreateMortalityInput>;

/** A választók elemei. */
export interface MortalityProductOption {
  id: string;
  name: string;
  commonName: string | null;
}
export interface MortalityAquariumOption {
  id: string;
  name: string;
  aquariumNumber: string;
}
export interface MortalitySupplierOption {
  id: string;
  name: string;
}
export interface MortalityRecorderOption {
  id: string;
  name: string;
}
