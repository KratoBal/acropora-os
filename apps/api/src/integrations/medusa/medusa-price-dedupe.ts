import type { MedusaPriceInput } from "./medusa-admin.client.js";
import {
  auditVariantPrices,
  type PriceAuditDeps,
} from "./medusa-price-audit.js";
import { MEDUSA_CURRENCY_CODE } from "./medusa-pricing.policy.js";
import { baseRowsOf } from "./medusa-price-rows.js";

/**
 * THE TWO-HUF-PRICE REPAIR, THE NARROW CASE ONLY (task t-20261116-ket-forint-ar, acrobot 53861 and 53863).
 *
 * The audit (`medusa-price-audit.ts`) found 27 variants on the test Medusa with exactly two plain HUF rows of equal amount, equal to
 * the OS price. The repair keeps the OLDER row (the smaller `price_` ULID) and drops the other one by sending the kept row alone, with
 * its own id: `setVariantPrices` is the variant's whole wanted price set, what is not sent is deleted by Medusa (the same mechanism the
 * price projection uses, `MedusaAdminClient.setVariantPrices`). It runs ONLY when everything below holds, and refuses (and names why)
 * in every other case; it never guesses:
 *   - the audit verdict is `duplicates-equal` (all rows plain, all amounts equal), right now, from a fresh read in the same request;
 *   - exactly two HUF rows, no row in another currency (the replacement would delete it);
 *   - both ids are `price_` plus a 26 character ULID (the older-by-text rule is only a time order for ULIDs);
 *   - the amount equals the OS price (so the amount stays and the next projection finds nothing to change).
 * Without `apply` nothing is written (a plan). After every write the product is read back: exactly one HUF row, the kept id, the same
 * amount, no other row.
 */

export type DedupeAction =
  /** the variant has no duplicate (none or a single HUF row) */
  | "nothing"
  /** plan only: this is what apply would do */
  | "planned"
  | "fixed"
  /** a variant that is not the narrow case: nothing is touched */
  | "refused"
  /** the write or the read back went wrong, the state of the shop is to be read again */
  | "failed"
  /** the product or variant could not be read, nothing is decided */
  | "unreadable";

export interface DedupeEntry {
  osProductId: string;
  sku: string | null;
  variantId: string | null;
  action: DedupeAction;
  /** a stable code or a short sentence: why this action */
  detail: string;
  keepId: string | null;
  deleteIds: string[];
  amount: number | null;
}

export interface DedupeWriter {
  setVariantPrices(
    medusaProductId: string,
    variantId: string,
    prices: MedusaPriceInput[],
  ): Promise<void>;
}

export type DedupeDeps = PriceAuditDeps & { writer: DedupeWriter };

const PRICE_ID = /^price_[0-9A-HJKMNP-TV-Z]{26}$/;

export function dedupeCounts(
  entries: readonly DedupeEntry[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries)
    counts[entry.action] = (counts[entry.action] ?? 0) + 1;
  return counts;
}

export async function dedupeProducts(
  osProductIds: readonly string[],
  deps: DedupeDeps,
  options: { apply: boolean },
): Promise<DedupeEntry[]> {
  const entries: DedupeEntry[] = [];
  const add = (
    osProductId: string,
    action: DedupeAction,
    detail: string,
    rest: Partial<DedupeEntry> = {},
  ) =>
    entries.push({
      osProductId,
      sku: null,
      variantId: null,
      keepId: null,
      deleteIds: [],
      amount: null,
      ...rest,
      action,
      detail,
    });

  for (const osProductId of osProductIds) {
    const { targets, errors } = await deps.resolve(osProductId);
    for (const error of errors) add(osProductId, "unreadable", error);
    if (!targets.length) {
      if (!errors.length) add(osProductId, "unreadable", "no-variants");
      continue;
    }
    const medusaProductId = await deps.findMedusaProductId(osProductId);
    if (!medusaProductId) {
      add(osProductId, "unreadable", "no-medusa-link");
      continue;
    }

    for (const target of targets) {
      // A fresh read for every variant: the plan and the write see the shop as it is now, and the read back
      // after a write of the previous variant of the same product is not stale.
      let found;
      try {
        found = await deps.reader.listVariantPrices(medusaProductId);
      } catch (error) {
        add(
          osProductId,
          "unreadable",
          `read-failed (${error instanceof Error ? error.name : "UNKNOWN"})`,
          { sku: target.sku },
        );
        continue;
      }
      if (found.truncated) {
        add(osProductId, "unreadable", "variant-list-truncated", {
          sku: target.sku,
        });
        continue;
      }
      const matched = deps.matchVariant(found.rows, target.sku);
      if ("error" in matched) {
        add(osProductId, "unreadable", matched.error, { sku: target.sku });
        continue;
      }
      const variantId = matched.variant.id;
      const prices = matched.variant.prices;
      if (!prices) {
        add(osProductId, "unreadable", "prices-not-returned", {
          sku: target.sku,
          variantId,
        });
        continue;
      }

      const audit = auditVariantPrices({
        rows: prices,
        osAmount: target.osAmount,
      });
      const base = {
        sku: target.sku,
        variantId,
        keepId: audit.keepId,
        deleteIds: audit.deleteIds,
        amount: audit.hufRows[0]?.amount ?? null,
      };
      if (audit.verdict === "none" || audit.verdict === "single") {
        add(osProductId, "nothing", audit.verdict, {
          sku: target.sku,
          variantId,
        });
        continue;
      }
      const refuse = (reason: string) =>
        add(osProductId, "refused", reason, base);
      if (audit.verdict !== "duplicates-equal") {
        refuse(audit.verdict);
        continue;
      }
      if (audit.hufRows.length !== 2) {
        refuse("rows-not-two");
        continue;
      }
      if (audit.foreignRows > 0) {
        refuse("foreign-currency-row");
        continue;
      }
      if (!audit.hufRows.every((row) => PRICE_ID.test(row.id))) {
        refuse("id-not-ulid");
        continue;
      }
      if (target.osAmount === null || target.osAmount !== base.amount) {
        refuse("os-price-differs");
        continue;
      }
      const keepId = audit.keepId!;
      if (!options.apply) {
        add(osProductId, "planned", "keep-older", base);
        continue;
      }

      try {
        await deps.writer.setVariantPrices(medusaProductId, variantId, [
          {
            id: keepId,
            currency_code: MEDUSA_CURRENCY_CODE,
            amount: base.amount!,
          },
        ]);
      } catch (error) {
        add(
          osProductId,
          "failed",
          `write-failed (${error instanceof Error ? error.name : "UNKNOWN"})`,
          base,
        );
        continue;
      }
      let after;
      try {
        after = await deps.reader.listVariantPrices(medusaProductId);
      } catch (error) {
        add(
          osProductId,
          "failed",
          `read-back-failed (${error instanceof Error ? error.name : "UNKNOWN"})`,
          base,
        );
        continue;
      }
      // a sale price list's row stays and is not counted: the repair keeps one BASE row
      const afterPrices = after.rows.find(
        (row) => row.id === variantId,
      )?.prices;
      const rows = afterPrices ? baseRowsOf(afterPrices) : undefined;
      const ok =
        !after.truncated &&
        rows !== undefined &&
        rows.length === 1 &&
        rows[0]!.id === keepId &&
        rows[0]!.amount === base.amount &&
        rows[0]!.currency_code.toLowerCase() === MEDUSA_CURRENCY_CODE;
      if (ok) add(osProductId, "fixed", "kept-older", base);
      else
        add(
          osProductId,
          "failed",
          `read-back-mismatch (${rows?.length ?? "no"} rows after the write)`,
          base,
        );
    }
  }
  return entries;
}
