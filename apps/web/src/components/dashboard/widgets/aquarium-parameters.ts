import { AQUARIUM_MEASUREMENT_PARAMETERS } from "@acropora/types";

const BY_CODE = new Map(
  AQUARIUM_MEASUREMENT_PARAMETERS.map((p) => [p.code, p]),
);

/** The parameter's display label ("Foszfát"), or the code if unknown. */
export function parameterLabel(code: string): string {
  return BY_CODE.get(code as never)?.label ?? code;
}

const valueFormatter = new Intl.NumberFormat("hu-HU", {
  maximumFractionDigits: 3,
});

/** "0,18", the way the aquarium pages write a value. */
export function formatMeasurement(value: number): string {
  return valueFormatter.format(value);
}
