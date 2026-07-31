import { createHash } from "node:crypto";

import type { UnasVariantValue } from "@acropora/types";

export function unasVariantKey(values: readonly UnasVariantValue[]): string {
  if (values.length === 0) return "";
  return JSON.stringify(values.map((item) => item.value.trim()));
}

export function unasVariantSku(baseSku: string, variantKey: string): string {
  if (!variantKey) return baseSku;
  const suffix = createHash("sha256")
    .update(variantKey)
    .digest("hex")
    .slice(0, 16);
  return `${baseSku}#UNASV#${suffix}`;
}

export function unasVariantLabel(values: readonly UnasVariantValue[]): string {
  return values
    .map((item) =>
      item.name.trim()
        ? `${item.name.trim()}: ${item.value.trim()}`
        : item.value.trim(),
    )
    .join(", ");
}

export function parseStoredUnasVariantValues(
  value: unknown,
): UnasVariantValue[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const candidate = item as Record<string, unknown>;
    return typeof candidate.name === "string" &&
      typeof candidate.value === "string" &&
      candidate.value.trim()
      ? [{ name: candidate.name, value: candidate.value }]
      : [];
  });
  return parsed.length === value.length && parsed.length > 0 ? parsed : null;
}
