"use client";

import { PilotBadge, PilotSelect } from "@acropora/ui";
import {
  isHusbandryFilterValue,
  type HusbandryFilterValue,
  type ProductListHusbandry,
} from "@acropora/types";

/**
 * THE HUSBANDRY STATE IN THE PRODUCT LIST (V2.2 S6): a filter and a cell, so whoever enters the data and whoever verifies it can work
 * through the live animals from the list instead of opening each product. The cell is empty ("—") for a product that is not a live
 * animal; for a live animal it says verified, or how many required fields are still missing. The words are for whoever works the data,
 * not for one person.
 */
const FILTER_LABELS: Record<HusbandryFilterValue, string> = {
  verified: "Tartási adat: ellenőrzött",
  unverified: "Tartási adat: nem ellenőrzött",
};

export function HusbandryFilterSelect({
  value,
  onChange,
  className,
}: {
  value: HusbandryFilterValue | "";
  onChange: (value: HusbandryFilterValue | "") => void;
  className?: string;
}) {
  return (
    <PilotSelect
      chevron
      aria-label="Tartási adat"
      value={value}
      onChange={(next) => onChange(isHusbandryFilterValue(next) ? next : "")}
      className={className}
    >
      <option value="">Tartási adat: mind</option>
      {(Object.keys(FILTER_LABELS) as HusbandryFilterValue[]).map((option) => (
        <option key={option} value={option}>
          {FILTER_LABELS[option]}
        </option>
      ))}
    </PilotSelect>
  );
}

export function HusbandryCell({
  husbandry,
}: {
  husbandry: ProductListHusbandry | null | undefined;
}) {
  if (!husbandry) return <span className="text-pilot-grey-600">—</span>;
  const state =
    husbandry.verified && husbandry.missing === 0 ? (
      <PilotBadge variant="success">Ellenőrizve</PilotBadge>
    ) : husbandry.verified ? (
      <PilotBadge variant="amber">
        Ellenőrizve, {husbandry.missing} mező hiányzik
      </PilotBadge>
    ) : (
      <PilotBadge variant="grey">
        Nem ellenőrzött, {husbandry.missing} hiányzik
      </PilotBadge>
    );
  // a stated sting or venom is shown next to the state, so a verifier working the list does not page past it (the product page has the banner)
  return husbandry.hazard ? (
    <span className="flex flex-wrap items-center gap-1">
      {state}
      <PilotBadge variant="danger">Csípés vagy méreg</PilotBadge>
    </span>
  ) : (
    state
  );
}
