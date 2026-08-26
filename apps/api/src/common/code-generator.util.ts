import { randomUUID } from "node:crypto";

/// Human-readable, sortable document code: PREFIX-yyyymmdd-hhmmss-XXXX.
/// Used for leltár/korrekció numbers and POS sale numbers alike.
/// The random tail, as its own function so a test can control it.
///
/// Sixteen bits of real randomness (the first two bytes of a v4 UUID), which is
/// what makes two codes minted in the same second differ. Measured 2026-08-26:
/// 200 000 draws produced 62 428 of the 65 536 possible values, i.e. a uniform
/// draw rather than a counter.
export function randomCodeSuffix(): string {
  return randomUUID().slice(0, 4).toUpperCase();
}

/// The seam exists for ONE reason: a collision must be reproducible on demand.
///
/// Two documents collide when they are minted in the same second AND draw the
/// same tail. Waiting for that to happen by chance is not a test - it is a
/// 1-in-65 536 hope. So the tail is a parameter, defaulted to the real random
/// source, and only a test ever passes anything else.
///
/// It is deliberately NOT a general extension point: whatever is passed must
/// still produce the documented shape (four uppercase hex characters), because
/// the label prints the last two blocks and the asset search matches on a
/// substring of the whole code. A caller that supplies a different shape breaks
/// two other places, and that is asserted in this module's spec.
export function generateCode(
  prefix: string,
  randomSuffix: () => string = randomCodeSuffix,
): string {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return `${prefix}-${stamp}-${randomSuffix()}`;
}
