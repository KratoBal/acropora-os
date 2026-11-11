import { Injectable } from "@nestjs/common";
import { Prisma, prisma } from "@acropora/database";

import {
  baseStatusFromPayload,
  inquiryOnly,
} from "./unas-webshop-sellable-backfill.js";
import { webshopSellableFromUnas } from "./unas-product-sync.repository.js";

/**
 * THE STORED `webshopSellable` CANNOT STAY BEHIND THE RULE (card e1de003d, 2026-11-11).
 *
 * === WHAT WENT WRONG ===
 *
 * `webshopSellable` is a VALUE DERIVED from two UNAS fields (the `base` status and `Inquire`), stored on
 * the product. The product sync writes it only for a product whose `canonicalHash` changed
 * (`unas-product-sync.repository.ts`, the create and update branches); the diff engine leaves a product
 * with the same hash alone, even on a `full` run. So when the RULE changed (#569, 2026-09-04: `base` 2
 * counts as sold, not only 1) and the UNAS payload did not, the stored value stayed at the old rule's
 * answer for good. Measured on the test OS 2026-11-11 (acrobot): 49 of 49 draft products had
 * `isActive = true` and `webshopSellable = false`, 48 of them `base` 2.
 * The one-off backfill CLI fixes the rows it is run against and nothing else: the next change of the
 * rule leaves the same hole.
 *
 * === WHAT THIS DOES ===
 *
 * It recomputes the value from the STORED UNAS snapshot (the same two fields, the same rule function the
 * sync uses) for every UNAS-mastered, mirrored product, and writes the rows that differ. It runs after
 * every scheduled product sync, and on demand through the admin route (dry run by default).
 *
 * === THE TWO WAYS THIS CAN HURT, AND THE GUARDS ===
 *
 * 1. A snapshot with no `base` status is NOT "not sellable": the rule would answer false for a missing
 *    block, and a recompute would un-publish a live product (the backfill's own header names this). Such
 *    a row is skipped and counted, never changed.
 * 2. A recompute that flips MANY products to false at once is the signature of a broken reader, not of a
 *    business change. The scheduled run holds (writes nothing, logs) above `AUTOMATIC_MAX_TO_FALSE`; the
 *    admin route, which a person starts after reading the dry run, has no such cap.
 *
 * Products whose master is ACROPORA are not touched: there `webshopSellable` is the owner's business
 * decision, not a copy of UNAS.
 */
export const AUTOMATIC_MAX_TO_FALSE = 50;
const WRITE_CHUNK = 1000;
const LISTED_CHANGES_MAX = 500;

export interface SellableStoreRow {
  id: string;
  name: string;
  webshopSellable: boolean;
  /** `rawPayload.Statuses` of the stored snapshot, as stored. */
  statuses: unknown;
  /** `rawPayload.Inquire` of the stored snapshot, as stored. */
  inquire: unknown;
}

export interface SellableStore {
  rows(): Promise<SellableStoreRow[]>;
  set(ids: string[], value: boolean): Promise<void>;
}

export interface SellableChange {
  id: string;
  name: string;
  from: boolean;
  to: boolean;
}

export interface SellableReconcileResult {
  /** `dry-run`: nothing written. `applied`: the rows were written. `held`: the scheduled cap stopped it. */
  mode: "dry-run" | "applied" | "held";
  inspected: number;
  /** Rows whose snapshot carries no `base` status: not decided, not changed. */
  skippedNoBaseStatus: number;
  toTrue: number;
  toFalse: number;
  /** The first changes (`LISTED_CHANGES_MAX`), so a dry run can be read. */
  changes: SellableChange[];
  heldReason?: string;
}

export async function reconcileWebshopSellable(
  store: SellableStore,
  options: { apply: boolean; maxToFalse?: number },
): Promise<SellableReconcileResult> {
  const rows = await store.rows();
  const changes: SellableChange[] = [];
  let skippedNoBaseStatus = 0;
  for (const row of rows) {
    const externalStatus = baseStatusFromPayload({
      Statuses: row.statuses,
    } as Record<string, unknown>);
    if (externalStatus === null) {
      skippedNoBaseStatus += 1;
      continue;
    }
    const to = webshopSellableFromUnas({
      externalStatus,
      inquireOnly: inquiryOnly({ Inquire: row.inquire }),
    });
    if (to !== row.webshopSellable)
      changes.push({
        id: row.id,
        name: row.name,
        from: row.webshopSellable,
        to,
      });
  }
  const toTrue = changes.filter((change) => change.to).length;
  const toFalse = changes.length - toTrue;
  const result = (
    mode: SellableReconcileResult["mode"],
    heldReason?: string,
  ): SellableReconcileResult => ({
    mode,
    inspected: rows.length,
    skippedNoBaseStatus,
    toTrue,
    toFalse,
    changes: changes.slice(0, LISTED_CHANGES_MAX),
    ...(heldReason ? { heldReason } : {}),
  });

  if (!options.apply) return result("dry-run");
  if (options.maxToFalse !== undefined && toFalse > options.maxToFalse)
    return result(
      "held",
      `${toFalse} products would turn not sellable (the scheduled run's cap is ${options.maxToFalse}); nothing was written`,
    );
  for (const value of [true, false]) {
    const ids = changes
      .filter((change) => change.to === value)
      .map((change) => change.id);
    for (let i = 0; i < ids.length; i += WRITE_CHUNK)
      await store.set(ids.slice(i, i + WRITE_CHUNK), value);
  }
  return result("applied");
}

/** Only the two JSON keys the rule reads leave the database, not the whole raw payload of ~1900 products. */
export const prismaSellableStore: SellableStore = {
  async rows() {
    return prisma.$queryRaw<SellableStoreRow[]>(Prisma.sql`
      SELECT p."id", p."name", p."webshopSellable",
             s."rawPayload"->'Statuses' AS "statuses",
             s."rawPayload"->'Inquire' AS "inquire"
        FROM "Product" p
        JOIN "UnasProductSnapshot" s ON s."productId" = p."id"
       WHERE p."catalogAuthority" = 'UNAS' AND p."mirrorState" = 'ACTIVE'`);
  },
  async set(ids, value) {
    /*
      THE WRITE RE-CHECKS WHAT THE READ SAW (barracuda, #2435 review): a product taken over between the
      read and the write (`takeCatalogAuthority`, UNAS to ACROPORA) is the owner's now and is not written,
      and a value somebody else already changed is not overwritten with the one decided on the old read.
    */
    await prisma.product.updateMany({
      where: {
        id: { in: ids },
        catalogAuthority: "UNAS",
        webshopSellable: !value,
      },
      data: { webshopSellable: value },
    });
  },
};

@Injectable()
export class UnasWebshopSellableReconciler {
  run(options: { apply: boolean; maxToFalse?: number }) {
    return reconcileWebshopSellable(prismaSellableStore, options);
  }
}
