import { RENTAL_LIMITS, type RentalReturnInput } from "@acropora/types";

import { parseHufInput } from "@/components/settings/rental-equipment-form";
import { budapestLocalOf, budapestLocalToIso } from "@/lib/format/date";

/** The return panel as typed (task eszkozberles, S4). The time is a `datetime-local` value on the Budapest wall clock. */
export type RentalReturnForm = {
  returnedAt: string;
  depositKeptHuf: string;
  depositKeptReason: string;
};

/** Back now (to the minute), nothing kept. */
export function emptyRentalReturnForm(now: Date): RentalReturnForm {
  return {
    returnedAt: budapestLocalOf(
      new Date(Math.floor(now.getTime() / 60_000) * 60_000),
    ),
    depositKeptHuf: "0",
    depositKeptReason: "",
  };
}

/**
 * The request, or the first thing the desk has to fix. A kept amount needs its reason (Balázs: "kaució vissza vagy levonás
 * okkal"), and never more than the deposit; the server checks the same, this only says it before the round trip.
 */
export function rentalReturnRequest(
  form: RentalReturnForm,
  depositHuf: number,
): { ok: true; input: RentalReturnInput } | { ok: false; error: string } {
  const returnedAt = budapestLocalToIso(form.returnedAt);
  if (!returnedAt)
    return { ok: false, error: "Add meg a visszahozás időpontját." };
  const kept =
    form.depositKeptHuf.trim() === "" ? 0 : parseHufInput(form.depositKeptHuf);
  if (kept === null)
    return {
      ok: false,
      error: "A visszatartott kaució egész forintösszeg legyen.",
    };
  if (kept > depositHuf)
    return {
      ok: false,
      error: "A visszatartott összeg legfeljebb a kaució lehet.",
    };
  const reason = form.depositKeptReason.trim();
  if (kept > 0 && reason === "")
    return {
      ok: false,
      error: "Ha a kaucióból visszatartasz, írd meg az okát is.",
    };
  if (reason.length > RENTAL_LIMITS.depositKeptReason.max)
    return {
      ok: false,
      error: `Az ok legfeljebb ${RENTAL_LIMITS.depositKeptReason.max} karakter lehet.`,
    };
  return {
    ok: true,
    input: {
      returnedAt,
      depositKeptHuf: kept,
      ...(kept > 0 ? { depositKeptReason: reason } : {}),
    },
  };
}
