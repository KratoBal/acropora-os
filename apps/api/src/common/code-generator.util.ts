import { randomUUID } from "node:crypto";

/// Human-readable, sortable document code: PREFIX-yyyymmdd-hhmmss-XXXX.
/// Used for leltár/korrekció numbers and POS sale numbers alike.
export function generateCode(prefix: string): string {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `${prefix}-${stamp}-${randomUUID().slice(0, 4).toUpperCase()}`;
}
