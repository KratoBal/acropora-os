import {
  formatMoney,
  normalizeOptionalRentalText,
  normalizeRentalSerialNumber,
  RENTAL_EQUIPMENT_LIMITS,
  type RentalEquipment,
} from "@acropora/types";

import type { RentalEquipmentInput } from "@/lib/api/rental-equipment";

/** The form as typed: every field is text, so a half-typed amount is not lost on a re-render. */
export type RentalEquipmentForm = {
  name: string;
  serialNumber: string;
  dailyFeeHuf: string;
  depositHuf: string;
  replacementValueHuf: string;
  accessories: string;
  note: string;
};

export const EMPTY_RENTAL_EQUIPMENT_FORM: RentalEquipmentForm = {
  name: "",
  serialNumber: "",
  dailyFeeHuf: "",
  depositHuf: "",
  replacementValueHuf: "",
  accessories: "",
  note: "",
};

export function formFromRentalEquipment(
  item: RentalEquipment,
): RentalEquipmentForm {
  return {
    name: item.name,
    serialNumber: item.serialNumber ?? "",
    dailyFeeHuf: String(item.dailyFeeHuf),
    depositHuf: String(item.depositHuf),
    replacementValueHuf: String(item.replacementValueHuf),
    accessories: item.accessories ?? "",
    note: item.note ?? "",
  };
}

/**
 * A forint amount as typed: whole forints, thousands may be grouped with spaces ("30 000"). Anything else (a decimal, a
 * sign, a letter, an empty field) is `null`, so the form says which field is wrong instead of sending a 0.
 */
export function parseHufInput(raw: string): number | null {
  const compact = raw.replace(/[\s ]/g, "");
  if (!/^\d+$/.test(compact)) return null;
  const value = Number(compact);
  const { min, max } = RENTAL_EQUIPMENT_LIMITS.amountHuf;
  return value >= min && value <= max ? value : null;
}

const AMOUNT_LABELS = {
  dailyFeeHuf: "Napi bérleti díj",
  depositHuf: "Kaució",
  replacementValueHuf: "Pótlási érték",
} as const;

export function rentalEquipmentPayload(
  form: RentalEquipmentForm,
): { ok: true; input: RentalEquipmentInput } | { ok: false; error: string } {
  const name = form.name.trim();
  if (name === "")
    return { ok: false, error: "Az eszköz nevét meg kell adni." };
  const amounts = {} as Record<keyof typeof AMOUNT_LABELS, number>;
  for (const key of Object.keys(AMOUNT_LABELS) as Array<
    keyof typeof AMOUNT_LABELS
  >) {
    const value = parseHufInput(form[key]);
    if (value === null)
      return {
        ok: false,
        error: `${AMOUNT_LABELS[key]}: egész forintösszeget adj meg (legfeljebb ${formatMoney(RENTAL_EQUIPMENT_LIMITS.amountHuf.max, "HUF")}).`,
      };
    amounts[key] = value;
  }
  return {
    ok: true,
    input: {
      name,
      serialNumber: normalizeRentalSerialNumber(form.serialNumber),
      ...amounts,
      accessories: normalizeOptionalRentalText(form.accessories),
      note: normalizeOptionalRentalText(form.note),
    },
  };
}
