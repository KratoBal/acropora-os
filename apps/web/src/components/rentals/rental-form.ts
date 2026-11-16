import {
  RENTAL_LIMITS,
  rentalPeriodCount,
  type RentalCustomerSummary,
  type RentalEquipment,
} from "@acropora/types";

import { parseHufInput } from "@/components/settings/rental-equipment-form";
import type { CreateRentalInput } from "@/lib/api/rentals";
import { budapestLocalOf, budapestLocalToIso } from "@/lib/format/date";

/** The desk's form as typed. The two times are `datetime-local` values on the Budapest wall clock. */
export type RentalForm = {
  equipmentId: string;
  customerType: "PERSON" | "COMPANY";
  name: string;
  phone: string;
  email: string;
  postalCode: string;
  city: string;
  line1: string;
  startsAt: string;
  plannedReturnAt: string;
  depositHuf: string;
  note: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fresh form: starting now (to the minute), back in 24 hours. */
export function emptyRentalForm(now: Date): RentalForm {
  const start = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  return {
    equipmentId: "",
    customerType: "PERSON",
    name: "",
    phone: "",
    email: "",
    postalCode: "",
    city: "",
    line1: "",
    startsAt: budapestLocalOf(start),
    plannedReturnAt: budapestLocalOf(new Date(start.getTime() + DAY_MS)),
    depositHuf: "",
    note: "",
  };
}

/** The planned periods and fee for the preview; `null` while the times or the device do not allow one. */
export function rentalPreview(
  form: RentalForm,
  equipment: RentalEquipment | undefined,
): { periods: number; feeHuf: number } | null {
  const start = budapestLocalToIso(form.startsAt);
  const end = budapestLocalToIso(form.plannedReturnAt);
  if (!equipment || !start || !end) return null;
  const periods = rentalPeriodCount(start, end);
  return periods === null
    ? null
    : { periods, feeHuf: periods * equipment.dailyFeeHuf };
}

/**
 * The request, or the first thing the desk has to fix. A chosen existing customer wins over the typed fields; without one,
 * the typed renter must be complete (name, phone, e-mail, address: Balázs, 2026-11-06).
 */
export function rentalRequest(
  form: RentalForm,
  customer: RentalCustomerSummary | null,
): { ok: true; input: CreateRentalInput } | { ok: false; error: string } {
  if (form.equipmentId === "")
    return { ok: false, error: "Válaszd ki a kiadandó eszközt." };

  let who: Pick<CreateRentalInput, "customerId" | "newCustomer">;
  if (customer) who = { customerId: customer.id };
  else {
    const missing = [
      ["name", "a bérlő neve"],
      ["phone", "a telefonszám"],
      ["email", "az e-mail cím"],
      ["postalCode", "az irányítószám"],
      ["city", "a város"],
      ["line1", "az utca és házszám"],
    ].find(([key]) => form[key as keyof RentalForm].trim() === "");
    if (missing) return { ok: false, error: `Hiányzik ${missing[1]}.` };
    who = {
      newCustomer: {
        type: form.customerType,
        displayName: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: {
          postalCode: form.postalCode.trim(),
          city: form.city.trim(),
          line1: form.line1.trim(),
        },
      },
    };
  }

  const startsAt = budapestLocalToIso(form.startsAt);
  const plannedReturnAt = budapestLocalToIso(form.plannedReturnAt);
  if (!startsAt || !plannedReturnAt)
    return {
      ok: false,
      error: "Add meg a kezdés és a visszahozás időpontját.",
    };
  const periods = rentalPeriodCount(startsAt, plannedReturnAt);
  if (periods === null)
    return {
      ok: false,
      error: "A tervezett visszahozás a kezdés után legyen.",
    };
  if (periods > RENTAL_LIMITS.maxDays)
    return {
      ok: false,
      error: `A bérlés legfeljebb ${RENTAL_LIMITS.maxDays} napos lehet.`,
    };

  let depositHuf: number | undefined;
  if (form.depositHuf.trim() !== "") {
    const parsed = parseHufInput(form.depositHuf);
    if (parsed === null)
      return { ok: false, error: "A kaució egész forintösszeg legyen." };
    depositHuf = parsed;
  }

  const note = form.note.trim();
  return {
    ok: true,
    input: {
      equipmentId: form.equipmentId,
      ...who,
      startsAt,
      plannedReturnAt,
      ...(depositHuf === undefined ? {} : { depositHuf }),
      ...(note === "" ? {} : { note }),
    },
  };
}
