/**
 * AZ ELHULLÁSI NAPLÓ (kártya 115c9740; Balázs promptja 2026-10-06, acrobot
 * döntései 27141).
 *
 * Egy rekord egy elhullási esemény: egy élőlény (élő állat kategóriájú termék),
 * egy vagy több példány, a bolt egy saját akváriumában. A rögzítő és a rögzítés
 * ideje automatikus; külön elhullási időpont nincs. A forrás kötelező, és nem
 * csak beszállító lehet.
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

export interface MortalitySource {
  type: MortalitySourceType;
  /** csak beszállítónál */
  supplier: { id: string; name: string } | null;
  /** a nem beszállítói forrás megnevezése (pl. a tenyésztő neve) */
  note: string | null;
}

export interface MortalityListItem {
  id: string;
  recordNumber: string;
  product: {
    id: string;
    name: string;
    /** a termék adatlapjának magyar neve, ha ki van töltve */
    commonName: string | null;
  };
  quantity: number;
  aquarium: { id: string; name: string; aquariumNumber: string };
  source: MortalitySource;
  recordedBy: { id: string; name: string };
  /** ISO időpont */
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

export interface MortalityDetail extends MortalityListItem {
  note: string | null;
  createdAt: string;
  /** az utolsó módosítás ideje, ha a rekordot létrehozása óta módosították */
  updatedAt: string | null;
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
  /** ÉÉÉÉ-HH-NN, a rögzítés napja ettől (helyi idő szerint, a nap elejétől) */
  from?: string;
  /** ÉÉÉÉ-HH-NN, a rögzítés napja eddig (a nap végéig) */
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
  /** az elmúlt 7 nap (a mai napot is beleértve) elhullott példányai */
  last7Days: number;
  /** a folyó hónap legtöbb példányt vesztett akváriuma, vagy `null` */
  mostAffectedAquarium: {
    id: string;
    name: string;
    quantity: number;
  } | null;
}

export interface CreateMortalityInput {
  productId: string;
  quantity: number;
  aquariumId: string;
  sourceType: MortalitySourceType;
  supplierId?: string | null;
  sourceNote?: string | null;
  note?: string | null;
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
