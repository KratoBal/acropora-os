import { Prisma } from "@acropora/database";

export interface ParsedUnasPackageComponent {
  sku: string;
  qty: Prisma.Decimal;
}

/**
 * Reads the normalized [{sku, qty}] JSON persisted on
 * UnasProductSnapshot. Invalid rows are ignored here and cause package
 * resolution to fail at the caller when no complete component set remains;
 * raw provider payload is never trusted directly by inventory writers.
 */
export function parseUnasPackageComponents(
  value: Prisma.JsonValue | null | undefined,
): ParsedUnasPackageComponent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, Prisma.JsonValue>;
    const sku = record.sku;
    const rawQty = record.qty;
    if (
      typeof sku !== "string" ||
      !sku.trim() ||
      (typeof rawQty !== "string" && typeof rawQty !== "number")
    )
      return [];
    try {
      const qty = new Prisma.Decimal(rawQty);
      return qty.isPositive() ? [{ sku: sku.trim(), qty }] : [];
    } catch {
      return [];
    }
  });
}
