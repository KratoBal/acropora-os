import {
  CUSTOMER_RANGES_VERSION,
  MAX_MEASUREMENT_AGE_DAYS,
  customerDeviation,
  huNumber,
} from "@acropora/aquarium-calc";
import {
  AQUARIUM_MEASUREMENT_PARAMETERS,
  type ReefClubWaterHintProduct,
  type ReefClubWaterHintRow,
  type ReefClubWaterHints,
  type ReefClubWaterHintStatus,
} from "@acropora/types";

/**
 * THE "MI LÓG KI" OF A REEFCLUB AQUARIUM, THE PURE RULES (card ce6c5cc9, V3.4 S3). RULE-BASED, NO AI: the customer's latest value per
 * parameter against the band APPROVED FOR A CUSTOMER (S1: `customerDeviation`, called WITHOUT options, so the phosphate lock and the
 * sea-only rule are the register's own), and for a deviation the products of the projection (S2b) that move it the right way.
 *
 * WHAT IT REFUSES TO SAY, ON PURPOSE:
 *  - not a sea-water aquarium (or no water type): `NOT_AVAILABLE`, no band, no advice;
 *  - phosphate: no row at all (its band is a proposal behind two locks);
 *  - a value older than its limit (`MAX_MEASUREMENT_AGE_DAYS`: KH and calcium 3 days, magnesium and nitrate 7): `TUL_REGI`, no judgement
 *    and no products, "measure again";
 *  - products from a projection older than 26 hours (`candidatesFresh` false): `productsState: STALE`, none named;
 *  - the empty list of products is NOT a recommendation: `NONE`, and the row says only what the value is.
 *
 * THE PRODUCT FILTER THE PROJECTION CANNOT DO: a product that moves ANOTHER of this customer's deviations the wrong way (low calcium and
 * high magnesium, a product raising both) is not named for either row. Only FRESH deviations count (a stale or missing value is unknown,
 * and the row does not guess). A product's effect on a parameter with no approved band (phosphate, pH) is printed as "Emellett hat: ..."
 * without advice or band (barracuda, #2415).
 *
 * THE TEXTS ARE THE PROPOSED TEMPLATE, which Balázs approves once (acrobot 47110): constants here, replaced as they stand.
 */
export const CUSTOMER_HINT_DISCLAIMER =
  "Tájékoztató jellegű, nem helyettesíti a szakértő véleményét.";

/** The parameters of the customer path, in the order of the rows. */
export const WATER_HINT_PARAMETERS = [
  "KH",
  "KALCIUM",
  "MAGNEZIUM",
  "NITRAT",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const LABEL: Record<string, string> = Object.fromEntries(
  AQUARIUM_MEASUREMENT_PARAMETERS.map((parameter) => [
    parameter.code,
    parameter.label,
  ]),
);
const UNIT: Record<string, string> = Object.fromEntries(
  AQUARIUM_MEASUREMENT_PARAMETERS.map((parameter) => [
    parameter.code,
    parameter.unit,
  ]),
);

export interface WaterHintMeasurement {
  parameterCode: string;
  value: number;
  measuredAt: Date;
}

export interface WaterHintCandidate {
  parameterCode: string;
  direction: "EMEL" | "CSOKKENT";
  productId: string;
  productName: string;
  category: string;
  shopUrl: string | null;
  evidenceRef: string;
  /** Mi az `evidenceRef`: a gyártó lapja vagy a bolti termékleírás. */
  referenceKind: "MAKER" | "SHOP_TEXT";
  /** "KOD:IRANY" entries. */
  effects: readonly string[];
  sideEffects: readonly string[];
  rank: number;
}

export interface WaterHintsInput {
  now: Date;
  waterType: "EDESVIZI" | "TENGERI" | null;
  /** Any order, any number: the latest per parameter is used. */
  measurements: readonly WaterHintMeasurement[];
  candidates: readonly WaterHintCandidate[];
  /** The projection's last successful build is recent enough to name products. */
  candidatesFresh: boolean;
}

interface Judged {
  parameterCode: string;
  measurement: WaterHintMeasurement;
  status: ReefClubWaterHintStatus;
  range: { min: number; max: number } | null;
  ageDays: number;
}

const wantedDirection = (status: ReefClubWaterHintStatus) =>
  status === "ALATTA" ? "EMEL" : status === "FELETTE" ? "CSOKKENT" : null;

const DIRECTION_WORD = { EMEL: "emeli", CSOKKENT: "csökkenti" } as const;

/** "Emellett hat: foszfát (csökkenti), pH (emeli)." or null. */
export function sideEffectsText(sideEffects: readonly string[]): string | null {
  const parts = sideEffects.flatMap((entry) => {
    const [code, direction] = entry.split(":");
    if (!code || (direction !== "EMEL" && direction !== "CSOKKENT")) return [];
    const label = LABEL[code] ?? code;
    return [
      `${label.charAt(0).toLowerCase()}${label.slice(1)} (${DIRECTION_WORD[direction]})`,
    ];
  });
  return parts.length === 0 ? null : `Emellett hat: ${parts.join(", ")}.`;
}

function statusSentence(
  label: string,
  unit: string,
  value: number,
  status: ReefClubWaterHintStatus,
  range: { min: number; max: number } | null,
  ageDays: number,
): string {
  const measured = `A(z) ${label} mért értéke ${huNumber(value)} ${unit}`;
  const band = range
    ? `az ajánlott tartomány (${huNumber(range.min)} és ${huNumber(range.max)} ${unit})`
    : "";
  if (status === "ALATTA") return `${measured}, ${band} alatt van.`;
  if (status === "FELETTE") return `${measured}, ${band} felett van.`;
  if (status === "TARTOMANYBAN")
    return `${measured}, az ajánlott tartományon (${huNumber(range!.min)} és ${huNumber(range!.max)} ${unit}) belül van.`;
  return `A(z) ${label} utolsó mérése ${ageDays} napos, ezért ebből most nem mondunk semmit: mérj újra.`;
}

export function buildWaterHints(input: WaterHintsInput): ReefClubWaterHints {
  const base = {
    registerVersion: CUSTOMER_RANGES_VERSION,
    disclaimer: null,
    productsState: "NONE" as const,
    rows: [] as ReefClubWaterHintRow[],
  };
  if (input.waterType !== "TENGERI")
    return { ...base, state: "NOT_AVAILABLE", reason: "WATER_TYPE" };

  const latest = new Map<string, WaterHintMeasurement>();
  for (const measurement of input.measurements) {
    if (!Number.isFinite(measurement.value)) continue;
    const held = latest.get(measurement.parameterCode);
    if (!held || measurement.measuredAt > held.measuredAt)
      latest.set(measurement.parameterCode, measurement);
  }

  // first pass: the status of every measured parameter of the customer path
  const judged = WATER_HINT_PARAMETERS.flatMap((parameterCode): Judged[] => {
    const measurement = latest.get(parameterCode);
    if (!measurement) return [];
    const ageMs = input.now.getTime() - measurement.measuredAt.getTime();
    const limitDays =
      MAX_MEASUREMENT_AGE_DAYS[
        parameterCode as keyof typeof MAX_MEASUREMENT_AGE_DAYS
      ];
    if (ageMs > limitDays * DAY_MS)
      return [
        {
          parameterCode,
          measurement,
          status: "TUL_REGI" as ReefClubWaterHintStatus,
          range: null,
          ageDays: Math.floor(ageMs / DAY_MS),
        },
      ];
    const deviation = customerDeviation(
      parameterCode,
      measurement.value,
      input.waterType,
    );
    // an approved band exists for all four; a missing one would be "no judgement", never a row
    if (
      deviation.status === "NINCS_JOVAHAGYOTT_TARTOMANY" ||
      deviation.status === "NINCS_ERTEK" ||
      !deviation.range
    )
      return [];
    return [
      {
        parameterCode,
        measurement,
        status: deviation.status as ReefClubWaterHintStatus,
        range: { min: deviation.range.min, max: deviation.range.max },
        ageDays: Math.floor(ageMs / DAY_MS),
      },
    ];
  });
  if (judged.length === 0) return { ...base, state: "NO_MEASUREMENT" };

  // the FRESH deviations: what the product filter checks the other rows' products against
  const deviating = new Map<string, "EMEL" | "CSOKKENT">();
  for (const entry of judged) {
    const direction = wantedDirection(entry.status);
    if (direction) deviating.set(entry.parameterCode, direction);
  }

  const rows: ReefClubWaterHintRow[] = judged.map((entry) => {
    const direction = wantedDirection(entry.status);
    const products: ReefClubWaterHintProduct[] =
      direction && input.candidatesFresh
        ? input.candidates
            .filter(
              (candidate) =>
                candidate.parameterCode === entry.parameterCode &&
                candidate.direction === direction &&
                // not a product that moves ANOTHER fresh deviation of this customer the wrong way
                !candidate.effects.some((effect) => {
                  const [code, effectDirection] = effect.split(":");
                  if (!code || code === entry.parameterCode) return false;
                  const wanted = deviating.get(code);
                  return wanted !== undefined && wanted !== effectDirection;
                }),
            )
            .sort((a, b) => a.rank - b.rank)
            .slice(0, 5)
            .map((candidate) => ({
              productId: candidate.productId,
              name: candidate.productName,
              category: candidate.category,
              shopUrl: candidate.shopUrl,
              manufacturerUrl: candidate.evidenceRef,
              referenceKind: candidate.referenceKind,
              sideEffectsText: sideEffectsText(candidate.sideEffects),
            }))
        : [];
    const label = LABEL[entry.parameterCode] ?? entry.parameterCode;
    const unit = UNIT[entry.parameterCode] ?? "";
    return {
      parameterCode: entry.parameterCode,
      label,
      unit,
      value: entry.measurement.value,
      measuredAt: entry.measurement.measuredAt.toISOString(),
      status: entry.status,
      range: entry.range,
      text: statusSentence(
        label,
        unit,
        entry.measurement.value,
        entry.status,
        entry.range,
        entry.ageDays,
      ),
      products,
    };
  });

  // STALE only when a deviation WANTED products and the projection could not give any; nothing deviating needs none
  const productsState =
    deviating.size > 0 && !input.candidatesFresh
      ? "STALE"
      : rows.some((row) => row.products.length > 0)
        ? "OK"
        : "NONE";
  return {
    state: "OK",
    registerVersion: CUSTOMER_RANGES_VERSION,
    disclaimer: CUSTOMER_HINT_DISCLAIMER,
    productsState,
    rows,
  };
}
