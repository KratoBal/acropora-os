"use client";

import { PilotFormField, PilotInput } from "@/components/pilot/pilot-ui";

import {
  REPAIR_FEE_FIELDS,
  repairTotalState,
  type RepairFeeKey,
} from "./contract-items";

/**
 * A TÉTEL JAVÍTÁSI DÍJAI (kártya 3d80a18d): öt nem kötelező mező, számolás
 * nélkül. Ugyanez az új szerződés űrlapján és az adatlapon. Az `ariaPrefix`
 * teszi egyedivé a mezőneveket, ha több tétel áll egymás alatt.
 */
export function ContractRepairFees({
  values,
  ariaPrefix,
  onChange,
}: {
  values: Partial<Record<RepairFeeKey, string | null>>;
  ariaPrefix: string;
  onChange: (key: RepairFeeKey, value: string) => void;
}) {
  const total = repairTotalState(values);
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-pilot-grey-500">
        Javítási díjak (nem kötelező, nettó)
      </legend>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-5">
        {REPAIR_FEE_FIELDS.map(({ key, label }) => (
          <PilotFormField key={key} label={label}>
            <PilotInput
              aria-label={`${ariaPrefix}${label}`}
              inputMode="decimal"
              value={values[key] ?? ""}
              // az Összesen csak súlyszámmal írható; a meglévő értéke látszik és megmarad (kártya 51898ed9)
              disabled={key === "repairTotal" && !total.editable}
              onChange={(value) => onChange(key, value)}
            />
          </PilotFormField>
        ))}
      </div>
      {total.hint ? (
        <p
          data-testid="repair-total-hint"
          className="text-xs text-pilot-grey-500"
        >
          {total.hint}
        </p>
      ) : null}
    </fieldset>
  );
}
