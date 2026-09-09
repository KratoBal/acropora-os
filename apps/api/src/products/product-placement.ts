import type { ElhelyezesiIgeny } from "@acropora/types";

/** The customer's declared lamp technology, not a measured PAR value. */
export type LampType = "LED" | "T5" | "VEGYES";
export type HeightBand = "ALSO_HARMAD" | "KOZEPSO_HARMAD" | "FELSO_HARMAD";
export type PlacementLevel = Exclude<ElhelyezesiIgeny, "NEM_ERTELMEZHETO">;

export interface PlacementAdvisorInput {
  aquarium: {
    heightCm: number;
    lampWatt: number;
    lampType: LampType;
    flow: PlacementLevel;
  };
  product: {
    fenyIgeny: ElhelyezesiIgeny | null;
    aramlasIgeny: ElhelyezesiIgeny | null;
  };
}

export interface LightEstimateAssumptions {
  /** The caller can display this prominently: watt is an estimate, never PAR. */
  measurement: "WATT_BECSLES_NEM_MERES";
  lampConversion: {
    lampType: LampType;
    factorToLedReferenceWatt: number;
    formula: "ledReferenciaWatt = lampaWatt × szorzo";
  };
  depthCalculation: {
    formula: "becsultTerheles = (ledReferenciaWatt / akvariumMagassagCm) × (1 - 0.6 × melysegArany)";
    representativeDepthByBand: Record<HeightBand, string>;
    thresholds: "GYENGE < 0.40; KOZEPES < 0.90; EROS ≥ 0.90 (LED-referencia W/cm)";
  };
}

export type PlacementAdvisorResult =
  | {
      kind: "recommendation";
      heightBand: HeightBand;
      flowZone: PlacementLevel;
      flowComparison: {
        aquariumFlow: PlacementLevel;
        productNeed: PlacementLevel;
        relation:
          "MATCHES" | "LOWER_THAN_PRODUCT_NEED" | "HIGHER_THAN_PRODUCT_NEED";
      };
      lightEstimate: LightEstimateAssumptions & {
        ledReferenceWatt: number;
        bands: Record<
          HeightBand,
          { estimatedLoad: number; estimatedNeed: PlacementLevel }
        >;
      };
    }
  | {
      kind: "missingProductFields";
      fields: Array<"fenyIgeny" | "aramlasIgeny">;
    }
  | {
      kind: "notApplicableProductFields";
      fields: Array<{
        field: "fenyIgeny" | "aramlasIgeny";
        state: "NEM_ERTELMEZHETO";
        reason: "A termékhez ez az elhelyezési szempont nem alkalmazható.";
      }>;
    };

const lampFactors: Record<LampType, number> = {
  LED: 1,
  T5: 0.55,
  VEGYES: 0.775,
};

const bands: ReadonlyArray<{ band: HeightBand; depthRatio: number }> = [
  { band: "FELSO_HARMAD", depthRatio: 1 / 6 },
  { band: "KOZEPSO_HARMAD", depthRatio: 1 / 2 },
  { band: "ALSO_HARMAD", depthRatio: 5 / 6 },
];

const needRank: Record<PlacementLevel, number> = {
  GYENGE: 0,
  KOZEPES: 1,
  EROS: 2,
};

function classifyLight(load: number): PlacementLevel {
  if (load < 0.4) return "GYENGE";
  if (load < 0.9) return "KOZEPES";
  return "EROS";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function compareFlow(
  aquariumFlow: PlacementLevel,
  productNeed: PlacementLevel,
): "MATCHES" | "LOWER_THAN_PRODUCT_NEED" | "HIGHER_THAN_PRODUCT_NEED" {
  if (needRank[aquariumFlow] === needRank[productNeed]) return "MATCHES";
  return needRank[aquariumFlow] < needRank[productNeed]
    ? "LOWER_THAN_PRODUCT_NEED"
    : "HIGHER_THAN_PRODUCT_NEED";
}

function isPlacementLevel(
  value: ElhelyezesiIgeny | null,
): value is PlacementLevel {
  return value !== null && value !== "NEM_ERTELMEZHETO";
}

/**
 * Deterministic placement rule. It purposely has no database, HTTP, AI, or
 * shop-writing dependency: identical input always yields identical output.
 */
export function adviseProductPlacement(
  input: PlacementAdvisorInput,
): PlacementAdvisorResult {
  const missing: Array<"fenyIgeny" | "aramlasIgeny"> = [];
  const { fenyIgeny, aramlasIgeny } = input.product;
  const notApplicable = [
    ...(fenyIgeny === "NEM_ERTELMEZHETO"
      ? [
          {
            field: "fenyIgeny" as const,
            state: "NEM_ERTELMEZHETO" as const,
            reason:
              "A termékhez ez az elhelyezési szempont nem alkalmazható." as const,
          },
        ]
      : []),
    ...(aramlasIgeny === "NEM_ERTELMEZHETO"
      ? [
          {
            field: "aramlasIgeny" as const,
            state: "NEM_ERTELMEZHETO" as const,
            reason:
              "A termékhez ez az elhelyezési szempont nem alkalmazható." as const,
          },
        ]
      : []),
  ];
  if (notApplicable.length > 0)
    return { kind: "notApplicableProductFields", fields: notApplicable };
  if (fenyIgeny == null) missing.push("fenyIgeny");
  if (aramlasIgeny == null) missing.push("aramlasIgeny");
  if (missing.length > 0)
    return { kind: "missingProductFields", fields: missing };
  if (!isPlacementLevel(fenyIgeny) || !isPlacementLevel(aramlasIgeny)) {
    // TypeScript cannot infer the relation between `missing.length` and the
    // two checks above; this is unreachable at runtime.
    return { kind: "missingProductFields", fields: missing };
  }

  // The early return above makes these non-null; keeping local constants also
  // prevents a caller mutating the input object mid-calculation from changing
  // the recommendation half-way through.
  const requestedNeed = fenyIgeny;
  const flowZone = aramlasIgeny;

  const factor = lampFactors[input.aquarium.lampType];
  const ledReferenceWatt = round(input.aquarium.lampWatt * factor);
  const baseLoad = ledReferenceWatt / input.aquarium.heightCm;
  const estimatedBands = Object.fromEntries(
    bands.map(({ band, depthRatio }) => {
      const estimatedLoad = round(baseLoad * (1 - 0.6 * depthRatio));
      return [
        band,
        { estimatedLoad, estimatedNeed: classifyLight(estimatedLoad) },
      ];
    }),
  ) as Record<
    HeightBand,
    { estimatedLoad: number; estimatedNeed: PlacementLevel }
  >;

  const bestBand = bands.reduce((best, candidate) => {
    const candidateEstimate = estimatedBands[candidate.band];
    const bestEstimate = estimatedBands[best.band];
    const candidateDistance = Math.abs(
      needRank[candidateEstimate.estimatedNeed] - needRank[requestedNeed],
    );
    const bestDistance = Math.abs(
      needRank[bestEstimate.estimatedNeed] - needRank[requestedNeed],
    );
    if (candidateDistance !== bestDistance)
      return candidateDistance < bestDistance ? candidate : best;

    // Equal estimated need: prefer the shallower zone for a stronger-demanding
    // product, and the deeper one for a weaker-demanding product.
    if (requestedNeed === "KOZEPES") {
      return Math.abs(candidate.depthRatio - 1 / 2) <
        Math.abs(best.depthRatio - 1 / 2)
        ? candidate
        : best;
    }
    return requestedNeed === "GYENGE"
      ? candidate.depthRatio > best.depthRatio
        ? candidate
        : best
      : candidate.depthRatio < best.depthRatio
        ? candidate
        : best;
  }).band;

  return {
    kind: "recommendation",
    heightBand: bestBand,
    flowZone,
    flowComparison: {
      aquariumFlow: input.aquarium.flow,
      productNeed: flowZone,
      relation: compareFlow(input.aquarium.flow, flowZone),
    },
    lightEstimate: {
      measurement: "WATT_BECSLES_NEM_MERES",
      lampConversion: {
        lampType: input.aquarium.lampType,
        factorToLedReferenceWatt: factor,
        formula: "ledReferenciaWatt = lampaWatt × szorzo",
      },
      depthCalculation: {
        formula:
          "becsultTerheles = (ledReferenciaWatt / akvariumMagassagCm) × (1 - 0.6 × melysegArany)",
        representativeDepthByBand: {
          FELSO_HARMAD: "a felszintol a magassag 1/6-a",
          KOZEPSO_HARMAD: "a felszintol a magassag 1/2-e",
          ALSO_HARMAD: "a felszintol a magassag 5/6-a",
        },
        thresholds:
          "GYENGE < 0.40; KOZEPES < 0.90; EROS ≥ 0.90 (LED-referencia W/cm)",
      },
      ledReferenceWatt,
      bands: estimatedBands,
    },
  };
}
