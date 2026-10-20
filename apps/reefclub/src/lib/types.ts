import type {
  MeasurementStatus,
  MeasurementTrend,
  WaterType,
} from "@acropora/types";

/**
 * THE /rc/v1 ANSWERS THIS APP READS, written out from the API's own
 * interfaces (apps/api/src/reefclub/reefclub-aquariums.service.ts,
 * reefclub-shop-links.service.ts, reefclub-shop-view.ts). They are a copy on
 * purpose for now: the API process must not depend on the web app's package,
 * and moving them to packages/types is a change of the API side too.
 */
export interface ReefClubAquarium {
  id: string;
  /** OWN: the account's; SHOP: a shop aquarium of a linked customer, read only. */
  origin: "OWN" | "SHOP";
  name: string;
  waterBodyType: "AKVARIUM" | "TO";
  waterType: WaterType | null;
  systemVolumeLiters: number | null;
  /** When the account shared it with the shop; null: private (always null on a shop aquarium). */
  sharedWithShopAt: string | null;
  createdAt: string;
}

export interface ReefClubTarget {
  parameterCode: string;
  min: number | null;
  max: number | null;
}

export interface ReefClubMeasurementValue {
  parameterCode: string;
  value: number;
  unit: string;
  target: { min: number | null; max: number | null } | null;
  status: MeasurementStatus | null;
  direction: "LOW" | "HIGH" | null;
  trend: MeasurementTrend | null;
}

export interface ReefClubOccasion {
  /** The occasion has no table: its id is its moment, in ISO form. */
  id: string;
  measuredAt: string;
  /** MANUAL: recorded in the ReefClub. SHOP: measured in the shop and released. */
  source: "MANUAL" | "SHOP";
  values: ReefClubMeasurementValue[];
}

export interface ReefClubShopLink {
  id: string;
  /** The only thing of the customer the ReefClub may see. */
  customerName: string;
  createdAt: string;
}

export interface ReefClubShopView {
  aquarium: {
    name: string;
    waterBodyType: "AKVARIUM" | "TO";
    waterType: WaterType | null;
    systemVolumeLiters: number | null;
  };
  targets: ReefClubTarget[];
  occasions: {
    measuredAt: string;
    values: { parameterCode: string; value: number }[];
  }[];
}
