"use client";

import { PilotRadioGroup } from "@acropora/ui";
import {
  CONTRACT_KIND_LABELS,
  contractPurchaseSwitchBlocker,
  type ContractKind,
} from "@acropora/types";
import { useEffect, useState } from "react";

import { contractsApi } from "@/lib/api/contracts";
import { PilotFormField, PilotSelect } from "@/components/pilot/pilot-ui";

/**
 * A SZERZŐDÉS FAJTÁJA, VÁLASZTÓKAPCSOLÓVAL (hétfői lista M4). Az új szerződés
 * űrlapja és az adatlap ugyanezt használja. Ha a szerződéshez már készült
 * karbantartási megrendelőlap, a „Beszerzés” tiltva van, és alatta áll, miért
 * (Balázs: „így van”); a szerver ugyanezt 409-cel utasítja el.
 */
export function ContractKindSwitch({
  value,
  onChange,
  maintenanceOrderCount = 0,
}: {
  value: ContractKind;
  onChange: (kind: ContractKind) => void;
  maintenanceOrderCount?: number;
}) {
  const blocker =
    value === "PURCHASE"
      ? null
      : contractPurchaseSwitchBlocker(maintenanceOrderCount);
  return (
    <PilotRadioGroup
      name="contract-kind"
      label="Szerződés típusa"
      value={value}
      onChange={onChange}
      options={(["PURCHASE", "MAINTENANCE"] as const).map((kind) => ({
        value: kind,
        label: CONTRACT_KIND_LABELS[kind],
        disabled: kind === "PURCHASE" && blocker !== null,
      }))}
      hint={blocker ?? undefined}
    />
  );
}

export type QuantityUnit = { id: string; code: string; name: string };

/** A beszerzési tétel mennyiségi egységei, egyszer betöltve. */
export function useQuantityUnits(token: string, enabled: boolean) {
  const [units, setUnits] = useState<QuantityUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || units !== null) return;
    let cancelled = false;
    contractsApi
      .quantityUnits(token)
      .then((rows) => {
        if (!cancelled) setUnits(rows);
      })
      .catch(() => {
        if (!cancelled) setError("A mennyiségi egységek nem tölthetők be.");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, token, units]);
  return { units, error };
}

/**
 * A MENNYISÉGI EGYSÉG LEGÖRDÜLŐJE. Egy kivezetett egység, amit a tétel már
 * visel, a listában marad (a választóból csak az új választás esik ki), hogy a
 * mentés ne cserélje le csendben.
 */
export function QuantityUnitSelect({
  label,
  ariaLabel,
  units,
  value,
  current,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  units: QuantityUnit[] | null;
  value: string;
  current?: QuantityUnit | null;
  onChange: (value: string) => void;
}) {
  const options =
    current && units && !units.some((unit) => unit.id === current.id)
      ? [...units, current]
      : (units ?? []);
  return (
    <PilotFormField label={label}>
      <PilotSelect aria-label={ariaLabel} value={value} onChange={onChange}>
        <option value="">
          {units === null ? "Betöltés…" : "Válassz egységet"}
        </option>
        {options.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.code} ({unit.name})
          </option>
        ))}
      </PilotSelect>
    </PilotFormField>
  );
}
