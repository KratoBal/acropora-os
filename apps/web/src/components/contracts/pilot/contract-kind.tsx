"use client";

import { PilotRadioGroup } from "@acropora/ui";
import {
  CONTRACT_KIND_LABELS,
  contractMaintenanceSwitchBlocker,
  contractPurchaseSwitchBlocker,
  type ContractKind,
} from "@acropora/types";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  invoiceCount = 0,
}: {
  value: ContractKind;
  onChange: (kind: ContractKind) => void;
  maintenanceOrderCount?: number;
  /** Hány számla készült belőle: akkor nem lesz újra karbantartási. */
  invoiceCount?: number;
}) {
  // a MÁSIK fajtára váltás zárja: megrendelőlap után a Beszerzés, számla után
  // a Karbantartás (barracuda, #1661)
  const blocker =
    value === "PURCHASE"
      ? contractMaintenanceSwitchBlocker(invoiceCount)
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
        disabled: kind !== value && blocker !== null,
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
  /*
    AZ ÜRES LISTA KIMONDVA (t19, Balázs 2026-10-13): a választó addig csak
    „Válassz egységet” sort mutatott, és nem derült ki, hogy a lista azért
    üres, mert egyetlen Mennyiség fajtájú mértékegység sincs felvéve. Az
    egységek a Beállítások lapon élnek, ide nem kerül kitalált alapérték.
  */
  const empty = units !== null && options.length === 0;
  return (
    <PilotFormField
      label={label}
      help={
        empty
          ? "Nincs felvett mennyiségi egység. Beállítások → Mértékegységek, Fajta: Mennyiség."
          : undefined
      }
    >
      <PilotSelect aria-label={ariaLabel} value={value} onChange={onChange}>
        <option value="">
          {units === null
            ? "Betöltés…"
            : empty
              ? "Nincs mennyiségi egység"
              : "Válassz egységet"}
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

/**
 * A TÉTELSOR OSZLOPAI (t19): a leírás kapja a legtöbb helyet, a négy rövid
 * mező (egységár, darabszám, egység vagy alkalom, ÁFA) osztozik a maradékon.
 * Az új szerződés űrlapja és az adatlap ugyanezt használja.
 */
export const CONTRACT_ITEM_GRID =
  "grid gap-2 md:grid-cols-[minmax(0,3fr)_repeat(4,minmax(0,1fr))]";

/**
 * A TÉTEL LEÍRÁSA, A TARTALOMHOZ NÖVŐ MEZŐBEN (t19, Balázs: „a tétel leírása
 * nem látszik teljesen”). Egy sorból indul, és a szöveg tördelésével együtt
 * nő, tehát a teljes leírás mindig látszik. Új sort az Enter NEM tesz bele:
 * a leírás eddig egysoros mező volt, és a számla tételsorába is így megy át.
 */
export function ContractItemDescriptionInput({
  ariaLabel,
  placeholder,
  value,
  onChange,
}: {
  ariaLabel: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const fit = () => {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    };
    fit();
    // a tördelés a szélességgel együtt változik
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={value}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault();
      }}
      onChange={(event) => onChange(event.target.value.replace(/\r?\n/g, " "))}
      className="w-full resize-none overflow-hidden rounded-md bg-white px-3 py-1.5 text-sm text-pilot-grey-900 ring-1 ring-pilot-grey-200 placeholder:text-pilot-grey-300 focus:outline-none focus:ring-2 focus:ring-pilot-aqua-500"
    />
  );
}
