"use client";

import {
  isShippingFilterValue,
  SHIPPING_FILTER_VALUES,
  SHIPPING_FLAG_SHORT_LABELS,
  type ShippingFilterValue,
  type ShippingFlagKey,
} from "@acropora/types";

import { PilotBadge, PilotSelect } from "@/components/pilot/pilot-ui";

/**
 * A TERMÉK SZÁLLÍTÁSI JELZŐI EGY LISTA-CELLÁBAN (a82ed229, 2b). Két „üres” állapot van, és nem ugyanazt mondják:
 * `null` = még senki nem nézte meg a terméket (nincs profil), `[]` = megnézték, egyik jelző sem áll rá.
 */
export function ShippingFlagsCell({
  flags,
}: {
  flags: readonly ShippingFlagKey[] | null | undefined;
}) {
  if (flags === undefined) return null;
  if (flags === null)
    return <span className="text-xs text-pilot-grey-500">nincs vizsgálva</span>;
  if (flags.length === 0)
    return <span className="text-xs text-pilot-grey-600">nincs korlát</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((flag) => (
        <PilotBadge key={flag} variant="amber">
          {SHIPPING_FLAG_SHORT_LABELS[flag]}
        </PilotBadge>
      ))}
    </span>
  );
}

const FILTER_LABELS: Readonly<Record<ShippingFilterValue, string>> = {
  ...SHIPPING_FLAG_SHORT_LABELS,
  none: "Nincs vizsgálva",
};

/** A szállítási szűrő: egy jelző, vagy a még nem vizsgált termékek. */
export function ShippingFilterSelect({
  value,
  onChange,
  className,
}: {
  value: ShippingFilterValue | "";
  onChange: (value: ShippingFilterValue | "") => void;
  className?: string;
}) {
  return (
    <PilotSelect
      chevron
      aria-label="Szállítás"
      value={value}
      onChange={(next) => onChange(isShippingFilterValue(next) ? next : "")}
      className={className}
    >
      <option value="">Szállítás: mind</option>
      {SHIPPING_FILTER_VALUES.map((option) => (
        <option key={option} value={option}>
          {FILTER_LABELS[option]}
        </option>
      ))}
    </PilotSelect>
  );
}
