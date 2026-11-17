import type { PilotBadgeVariant } from "@acropora/ui";
import {
  OPERATIONS_FIELD_TYPE_LABELS,
  OPERATIONS_FREQUENCY_LABELS,
  type OperationsTaskFrequency,
  type OperationsTaskTarget,
} from "@acropora/types";

export const OPERATIONS_TEMPLATES_PATH =
  "/beallitasok/uzemeltetesi-naplo-sablonok";
/** A havi kimutatás oldala (S4b): a Szerviz menüben. */
export const OPERATIONS_REPORT_PATH = "/szerviz/uzemeltetesi-naplo";

export { OPERATIONS_FIELD_TYPE_LABELS, OPERATIONS_FREQUENCY_LABELS };

/** A gyakoriság jelvényének színe: a napi és a heti sablonnak van esedékessége (S4), az alkalminak nincs. */
export const OPERATIONS_FREQUENCY_VARIANT: Record<
  OperationsTaskFrequency,
  PilotBadgeVariant
> = {
  DAILY: "blue",
  WEEKLY: "success",
  OCCASIONAL: "grey",
};

/** A sablon célja a felületen: „Eszköz · V2196 Homokszűrő” vagy „Kategória · Vízkezelés”. */
export function targetLabel(target: OperationsTaskTarget): string {
  if (target.kind === "CATEGORY") return `Kategória · ${target.name}`;
  const [only] = target.assets;
  return target.assets.length === 1 && only
    ? `Eszköz · ${only.assetNumber} ${only.name}`
    : `Eszközlista · ${target.assets.length} eszköz`;
}

export function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export const isAbort = (cause: unknown) =>
  cause instanceof DOMException && cause.name === "AbortError";
