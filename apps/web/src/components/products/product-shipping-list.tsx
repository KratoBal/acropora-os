"use client";

import type {
  ProductShippingFilter,
  ProductShippingSummary,
} from "@acropora/types";
import { useState } from "react";

import {
  PilotBadge,
  PilotButton,
  PilotSelect,
} from "@/components/pilot/pilot-ui";
import type {
  ProductShippingBulkInput,
  ShippingFlag,
} from "@/lib/api/products";

/**
 * A SZÁLLÍTÁSI JELZŐK A LISTÁKBAN (a82ed229, Balázs 2026-10-08 11:16 UTC: „nem
 * egyesével nézzük át”). A Termékek és a Webshop termékek lista ugyanezt az
 * oszlopot és szűrőt használja; a tömeges szerkesztés a Termékek listáé.
 */
export const SHIPPING_FILTER_LABEL: Record<ProductShippingFilter, string> = {
  PICKUP_ONLY: "Bolti átvétel",
  HEAVY: "Nehéz áru",
  FOXPOST_FORBIDDEN: "Foxpost tiltva",
  LOCKER_UNSUITABLE: "Automatába nem fér",
  FROZEN: "Fagyasztott",
  UNRESTRICTED: "Nincs korlátozás",
  NOT_FILLED: "Nincs kitöltve",
};

const JELZO_FELIRAT: Record<ShippingFlag | "lockerUnsuitable", string> = {
  pickupOnly: "Bolti átvétel",
  isHeavy: "Nehéz áru",
  foxpostForbidden: "Foxpost tiltva",
  lockerUnsuitable: "Automatába nem fér",
  isFrozen: "Fagyasztott",
};
const JELZOK = Object.keys(JELZO_FELIRAT) as (
  ShippingFlag | "lockerUnsuitable"
)[];

/** A lista cellája: a jelzők címkéi, a kézi és az eltérő jelzés. */
export function ShippingCell({
  shipping,
}: {
  shipping: ProductShippingSummary | null | undefined;
}) {
  if (!shipping)
    return <span className="text-xs text-pilot-grey-500">Nincs kitöltve</span>;
  const igaz = JELZOK.filter((flag) => shipping[flag]);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {igaz.length === 0 ? (
        <span className="text-xs text-pilot-grey-500">Nincs korlátozás</span>
      ) : (
        igaz.map((flag) => (
          <PilotBadge key={flag} variant="amber">
            {JELZO_FELIRAT[flag]}
          </PilotBadge>
        ))
      )}
      {shipping.unasDiffers ? (
        <PilotBadge variant="danger">Eltér a UNAS-tól</PilotBadge>
      ) : shipping.hasManual ? (
        <PilotBadge variant="grey">Kézi</PilotBadge>
      ) : null}
    </div>
  );
}

/** A szűrő: a jelleg és az OS–UNAS eltérés. */
export function ShippingFilterControls({
  value,
  differs,
  onChange,
}: {
  value: ProductShippingFilter | "";
  differs: boolean;
  onChange: (next: {
    shipping: ProductShippingFilter | "";
    shippingDiffers: boolean;
  }) => void;
}) {
  return (
    <>
      <PilotSelect
        chevron
        aria-label="Szállítás"
        value={value}
        onChange={(next) =>
          onChange({
            shipping: next as ProductShippingFilter | "",
            shippingDiffers: differs,
          })
        }
        className="min-w-[160px] flex-[1_1_180px] [&_select]:h-10"
      >
        <option value="">Minden szállítás</option>
        {(Object.keys(SHIPPING_FILTER_LABEL) as ProductShippingFilter[]).map(
          (key) => (
            <option key={key} value={key}>
              {SHIPPING_FILTER_LABEL[key]}
            </option>
          ),
        )}
      </PilotSelect>
      <label className="flex items-center gap-2 whitespace-nowrap text-xs text-pilot-grey-700">
        <input
          type="checkbox"
          checked={differs}
          onChange={(event) =>
            onChange({ shipping: value, shippingDiffers: event.target.checked })
          }
        />
        Eltér a UNAS-tól
      </label>
    </>
  );
}

/** Egy tömeges művelet: jelző be vagy ki (kézi), vagy vissza „UNAS szerint”. */
type Muvelet =
  | `${"be" | "ki"}:${ShippingFlag | "lockerUnsuitable"}`
  | `unas:${ShippingFlag}`;

export function shippingBulkInput(
  productIds: string[],
  muvelet: Muvelet,
): ProductShippingBulkInput {
  const [mit, flag] = muvelet.split(":") as [string, ShippingFlag];
  if (mit === "unas") return { productIds, resetToUnas: [flag] };
  return { productIds, set: { [flag]: mit === "be" } };
}

/** A kijelölés sávja: egy művelet a kijelölt termékekre. */
export function ShippingBulkBar({
  count,
  busy,
  onApply,
  onClear,
}: {
  count: number;
  busy: boolean;
  onApply: (muvelet: Muvelet) => void;
  onClear: () => void;
}) {
  const [muvelet, setMuvelet] = useState<Muvelet | "">("");
  return (
    <div
      role="region"
      aria-label="Tömeges szállítási szerkesztés"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-pilot-aqua-200 bg-pilot-aqua-50 px-4 py-3"
    >
      <span className="text-sm font-semibold text-pilot-aqua-800">
        {count} termék kijelölve
      </span>
      <PilotSelect
        chevron
        aria-label="Szállítási művelet"
        value={muvelet}
        onChange={(next) => setMuvelet(next as Muvelet | "")}
        className="min-w-[220px] [&_select]:h-9"
      >
        <option value="">Válassz műveletet…</option>
        {JELZOK.map((flag) => (
          <optgroup key={flag} label={JELZO_FELIRAT[flag]}>
            <option value={`be:${flag}`}>
              {JELZO_FELIRAT[flag]}: igen (kézi)
            </option>
            <option value={`ki:${flag}`}>
              {JELZO_FELIRAT[flag]}: nem (kézi)
            </option>
            {flag !== "lockerUnsuitable" ? (
              <option value={`unas:${flag}`}>
                {JELZO_FELIRAT[flag]}: vissza UNAS szerint
              </option>
            ) : null}
          </optgroup>
        ))}
      </PilotSelect>
      <PilotButton
        size="regular"
        variant="primary"
        disabled={!muvelet || busy}
        onClick={() => muvelet && onApply(muvelet)}
      >
        {busy ? "Mentés…" : `Alkalmaz (${count})`}
      </PilotButton>
      <button
        type="button"
        onClick={onClear}
        className="text-xs text-pilot-grey-600 hover:underline"
      >
        Kijelölés törlése
      </button>
    </div>
  );
}
