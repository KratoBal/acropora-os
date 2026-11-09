/**
 * A RENTED-OUT DEVICE, ONE ROW PER PHYSICAL PIECE (task eszkozberles, S1; Balázs, 2026-11-06).
 *
 * Maintained under Settings (`settings.manage`); the rental itself (S2) picks from the active rows. A piece is retired, never
 * deleted: a rental will point at it, and its contract must stay printable.
 *
 * All amounts are gross whole forints.
 */
export interface RentalEquipment {
  id: string;
  name: string;
  /** The factory serial; `null` when the device has none. Unique when given. */
  serialNumber: string | null;
  dailyFeeHuf: number;
  depositHuf: number;
  /** What a lost or destroyed device costs the renter. */
  replacementValueHuf: number;
  /** The accessories handed over with the device, printed on the contract. */
  accessories: string | null;
  note: string | null;
  isActive: boolean;
}

export interface RentalEquipmentListResponse {
  items: RentalEquipment[];
}

/** One place for the limits, so the form and the server refuse the same input. */
export const RENTAL_EQUIPMENT_LIMITS = {
  name: { min: 1, max: 120 },
  serialNumber: { max: 80 },
  accessories: { max: 1000 },
  note: { max: 2000 },
  /** 100 million forints: well above any device the shop rents, low enough to catch a slipped digit. */
  amountHuf: { min: 0, max: 100_000_000 },
} as const;

/**
 * An optional text field as stored: trimmed, and an empty or blank value is `null` (so two devices without a serial never
 * collide on the unique index with an empty string).
 */
export function normalizeOptionalRentalText(
  raw: string | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * A serial number as stored: no spaces, upper case (barracuda, #2270 review). One physical piece is one row, and the unique
 * index compares the stored text: without this "SN-123", "sn-123" and "SN 123" would be three devices. `null` when blank.
 */
export function normalizeRentalSerialNumber(
  raw: string | null | undefined,
): string | null {
  const compact = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  return compact === "" ? null : compact;
}
