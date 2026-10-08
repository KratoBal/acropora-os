"use client";

import type { ViesFillField } from "@acropora/types";

const LABEL: Record<ViesFillField, string> = {
  name: "Név",
  country: "Ország",
  addressLine1: "Cím",
  postalCode: "Irányítószám",
  city: "Város",
};

export type ViesConflict = {
  field: ViesFillField;
  current: string;
  vies: string;
};

/**
 * A VIES MÁST AD, MINT AMI BE VAN ÍRVA (kártya 600575a0). Az üres mezőket a
 * hívó magától kitölti; a már beírt, eltérő értéket SOHA nem írja felül
 * kérdés nélkül: itt látszik egymás mellett a kettő, és a felülírás csak a
 * gomb megnyomására történik.
 */
export function ViesConflicts({
  conflicts,
  onApply,
}: {
  conflicts: readonly ViesConflict[];
  /** the fields to take from VIES: one row's, or all of them */
  onApply: (fields: readonly ViesConflict[]) => void;
}) {
  if (!conflicts.length) return null;
  return (
    <div
      role="group"
      aria-label="VIES eltérések"
      className="mt-2 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800"
    >
      <p>A VIES más adatot ad, mint ami be van írva:</p>
      <ul className="space-y-0.5">
        {conflicts.map((c) => (
          <li key={c.field} className="flex flex-wrap items-center gap-2">
            <span>
              {LABEL[c.field]}: <strong>{c.vies}</strong> (most: {c.current})
            </span>
            <button
              type="button"
              aria-label={`${LABEL[c.field]}: átvétel a VIES-ből`}
              className="rounded border border-amber-300 bg-white px-1.5 font-semibold"
              onClick={() => onApply([c])}
            >
              Átvétel
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="rounded border border-amber-300 bg-white px-2 py-1 font-semibold"
        onClick={() => onApply(conflicts)}
      >
        Felülírás a VIES adataival
      </button>
    </div>
  );
}
