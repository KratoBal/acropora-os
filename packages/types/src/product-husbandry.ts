import type {
  ElhelyezesiIgeny,
  ProductLivestockKind,
} from "./product-catalog.js";

/**
 * THE HUSBANDRY BLOCK OF A LIVE ANIMAL (V2.2, card d2fc06e7; the spec is exchange/otletek-2026-11-04/v2-2-tartasi-blokk.md).
 *
 * The facts live on the product's datasheet (`ProductDatasheet`). Every fact may be null, and null means "being checked"
 * (the spec's "Ellenőrzés alatt"), never a default value: nothing may be guessed. Data is NOT loaded by this module or by
 * the code that uses it; this is the structure and the rules.
 */

/** The four difficulty steps, in order. The stored enum value is the key; the level is the spec's 1-4. */
export const HUSBANDRY_DIFFICULTIES = [
  "KONNYU",
  "KOZEPES",
  "HALADO",
  "SZAKERTO",
] as const;
export type HusbandryDifficulty = (typeof HUSBANDRY_DIFFICULTIES)[number];

/**
 * The scale of the spec (section 2): a fixed label and a fixed criterion for each step, so a step is not given by feeling.
 * The criterion is the customer-language text the shop shows on hover.
 */
export const HUSBANDRY_DIFFICULTY_SCALE: Readonly<
  Record<
    HusbandryDifficulty,
    {
      level: 1 | 2 | 3 | 4;
      label: string;
      criterion: string;
      /** Fixed sentence under the difficulty for the 3rd and 4th step; null for the others. */
      note: string | null;
    }
  >
> = {
  KONNYU: {
    level: 1,
    label: "Kezdőknek is",
    criterion:
      "Tűri a paraméter-ingadozást, nincs különleges etetési vagy medenceigénye, tenyésztett vagy jól akklimatizálható.",
    note: null,
  },
  KOZEPES: {
    level: 2,
    label: "Közepes",
    criterion:
      "Stabil, legalább néhány hónapos medencét kér, de nincs különleges igénye.",
    note: null,
  },
  HALADO: {
    level: 3,
    label: "Haladóknak",
    criterion:
      "Érett, stabil medencét, pontos paramétert vagy különleges etetést kér.",
    note: "Ezt a fajt érett, stabil medencébe javasoljuk. Ha most indítottad a medencédet, kérdezz a boltban, mielőtt megrendeled.",
  },
  SZAKERTO: {
    level: 4,
    label: "Szakértőknek",
    criterion:
      "Csak érett, tapasztalattal kezelt medencébe, vagy nagyon nehezen tartható, vagy különleges igényű.",
    note: "Ezt a fajt csak tapasztalt tartóknak ajánljuk. Megrendelés előtt kérjük, egyeztess velünk.",
  },
};

/** What replaces an empty cell: never an empty cell, never a default (the spec, section 3). */
export const HUSBANDRY_MISSING_TEXT =
  "Ellenőrzés alatt. Érdeklődj a boltban vásárlás előtt.";

export type HusbandryReefSafe =
  "IGEN" | "NEM" | "FELTETELES" | "ALLITAS_NELKULI" | "NEM_FAJ_SZINTU";
export type HusbandrySocialKeeping =
  "EGYEDUL" | "PARBAN" | "CSOPORTBAN" | "TOBB_PELDANY_TARTHATO";
export type HusbandryAggression =
  | "BEKES"
  | "TERULETVEDO"
  | "RAGADOZO"
  | "CSALANOZ"
  | "FAJTARSSAL_AGRESSZIV"
  | "FELTETELES";
export type HusbandryFeeding =
  | "SZURO_PLANKTON"
  | "ALGAEVO"
  | "HUSEVO"
  | "MINDENEVO"
  | "TORMELEKEVO"
  | "FOTOSZINTETIZALO"
  | "TISZTOGATO";
export type HusbandrySizeDimension =
  "TESTHOSSZ" | "KARFESZTAVOLSAG" | "HEJMERET" | "TELJES_KITERJEDES";
export type HusbandryZone = "ALSO" | "KOZEPSO" | "FELSO";
export type HusbandrySourcing = "TENYESZTETT" | "VADFOGAS";

/** The facts the block carries. A decimal number is a string (as the Prisma decimal is serialized). */
export interface ProductHusbandryFacts {
  /** Read only here: the Hungarian name is written through `PATCH /products/:id/names`. */
  magyarNev: string | null;
  genus: string | null;
  species: string | null;
  careDifficulty: HusbandryDifficulty | null;
  minLiter: string | null;
  medenceErettsegHonap: number | null;
  elhelyezesZona: HusbandryZone | null;
  reefSafe: HusbandryReefSafe | null;
  reefSafeIndok: string | null;
  socialKeeping: HusbandrySocialKeeping | null;
  aggression: HusbandryAggression[];
  korallevo: boolean | null;
  gerinctelenevo: boolean | null;
  feedingType: HusbandryFeeding[];
  etetesGyakorisag: string | null;
  eloEleseg: boolean | null;
  fenyIgeny: ElhelyezesiIgeny | null;
  aramlasIgeny: ElhelyezesiIgeny | null;
  meretMax: string | null;
  meretDimenzio: HusbandrySizeDimension | null;
  szarmazas: HusbandrySourcing | null;
  kinekNem: string | null;
  forrasTipus: string | null;
  forrasHivatkozas: string | null;
}

export type ProductHusbandryField = keyof ProductHusbandryFacts;

/** The write input: every key optional, `null` clears. `ellenorizve` verifies (or, `false`, withdraws the verification). */
export type ProductHusbandryInput = {
  [K in Exclude<ProductHusbandryField, "magyarNev">]?: K extends
    "minLiter" | "meretMax"
    ? number | null
    : ProductHusbandryFacts[K];
} & { ellenorizve?: boolean };

export interface ProductHusbandry {
  productId: string;
  /** From the category tree; null when it is not a live animal or sits under several roots. */
  livestockKind: ProductLivestockKind | null;
  facts: ProductHusbandryFacts;
  verification: {
    /** True only when the facts were verified AFTER their last edit (an edit without verifying withdraws it). */
    verified: boolean;
    byUserId: string | null;
    /** The server's clock; nobody can write a time. */
    at: string | null;
  };
  /** The required fields still missing (names as in `ProductHusbandryField`, plus `verification`). Empty when complete. */
  missing: string[];
}
