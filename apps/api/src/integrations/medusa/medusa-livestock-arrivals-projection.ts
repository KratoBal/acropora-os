import { prisma } from "@acropora/database";

import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";

/**
 * THE LIVE ANIMALS ON THEIR WAY THAT A BUYER MAY SEE, to the shop's "Érkező állatok" list (V2.6 S4b, card f4e4832b; the
 * contract agreed with murena, 45613/45618/45620; the commerce side is `PUT|GET /admin/livestock-arrivals`, commerce #719).
 *
 * WHAT GOES OUT: only an arrival a customer may register for (`preorderable`) that has not arrived and is not cancelled
 * (`ORDERED`, `IN_TRANSIT`), the bound ones too (with the product's shop id), so the page draws one list. Of it: the kind,
 * the name a buyer reads (the editor says so at the field), the day and the state. The quantity and the note never leave:
 * a count is not a promise to a customer, and the note is internal. A not-preorderable row is not public at all.
 *
 * The day is not compared with today, as for the product page (S3a): the shop words a late day. The shop computes the species
 * key from the name; the OS does not (one rule in one place).
 */
export type LivestockArrivalKind = "FISH" | "INVERTEBRATE" | "CORAL";

export interface MedusaLivestockArrival {
  os_id: string;
  kind: LivestockArrivalKind;
  label: string;
  expected_on: string;
  status: "ORDERED" | "IN_TRANSIT";
  medusa_product_id: string | null;
}

export interface ArrivalSourceRow {
  id: string;
  kind: string;
  label: string;
  /** a `@db.Date` column: midnight UTC of the day */
  expectedOn: Date;
  status: string;
  preorderable: boolean;
  productId: string | null;
}

const OPEN = new Set(["ORDERED", "IN_TRANSIT"]);
/**
 * The shop takes at most this many rows in one set (commerce `AdminPutLivestockArrivals`, `.max(1000)`; barracuda on #2354):
 * over it every round would be a 400 and the list would stand still. The earliest days go first, and the round says what it
 * left out.
 */
export const MAX_PUBLIC_ARRIVALS = 1000;
const KINDS = new Set(["FISH", "INVERTEBRATE", "CORAL"]);

/**
 * The public rows, by `os_id`. A bound arrival whose product the shop does not have (no link yet) still goes, without the
 * product: it is a fact a buyer may read, and the link comes with the product's projection.
 */
export function publicArrivals(
  rows: readonly ArrivalSourceRow[],
  medusaIdOf: ReadonlyMap<string, string>,
): MedusaLivestockArrival[] {
  return rows
    .filter(
      (row) =>
        row.preorderable &&
        OPEN.has(row.status) &&
        KINDS.has(row.kind) &&
        row.label.trim() !== "" &&
        !Number.isNaN(row.expectedOn.getTime()),
    )
    .map((row) => ({
      os_id: row.id,
      kind: row.kind as LivestockArrivalKind,
      label: row.label.trim(),
      expected_on: row.expectedOn.toISOString().slice(0, 10),
      status: row.status as "ORDERED" | "IN_TRANSIT",
      medusa_product_id: row.productId
        ? (medusaIdOf.get(row.productId) ?? null)
        : null,
    }))
    .sort((a, b) => a.os_id.localeCompare(b.os_id));
}

/** The same set on both sides, field by field, whatever order the shop answers in. */
export function arrivalsDiffer(
  current: readonly MedusaLivestockArrival[],
  wanted: readonly MedusaLivestockArrival[],
): boolean {
  const key = (rows: readonly MedusaLivestockArrival[]) =>
    JSON.stringify(
      [...rows]
        .sort((a, b) => a.os_id.localeCompare(b.os_id))
        .map((r) => [
          r.os_id,
          r.kind,
          r.label,
          r.expected_on,
          r.status,
          r.medusa_product_id ?? null,
        ]),
    );
  return key(current) !== key(wanted);
}

/** The set the shop can take: over the cap, the earliest days (then the id), and how many were left out. */
export function cappedArrivals(
  rows: readonly MedusaLivestockArrival[],
  cap: number = MAX_PUBLIC_ARRIVALS,
): { rows: MedusaLivestockArrival[]; leftOut: number } {
  if (rows.length <= cap) return { rows: [...rows], leftOut: 0 };
  const kept = [...rows]
    .sort(
      (a, b) =>
        a.expected_on.localeCompare(b.expected_on) ||
        a.os_id.localeCompare(b.os_id),
    )
    .slice(0, cap)
    .sort((a, b) => a.os_id.localeCompare(b.os_id));
  return { rows: kept, leftOut: rows.length - cap };
}

export type LivestockArrivalsOutcome =
  | { status: "unchanged"; count: number; leftOut?: number }
  | { status: "sent" | "would-send"; count: number; leftOut?: number };

export interface LivestockArrivalSource {
  rows(): Promise<ArrivalSourceRow[]>;
  medusaIds(productIds: readonly string[]): Promise<Map<string, string>>;
}

/** ONE ROUND: the shop's set read first, the whole set written only on a difference (as the redirects). */
export async function projectLivestockArrivals(
  client: Pick<
    MedusaAdminClient,
    "fetchLivestockArrivals" | "replaceLivestockArrivals"
  >,
  source: LivestockArrivalSource,
  apply: boolean,
): Promise<LivestockArrivalsOutcome> {
  const rows = await source.rows();
  const bound = [
    ...new Set(rows.flatMap((r) => (r.productId ? [r.productId] : []))),
  ];
  const capped = cappedArrivals(
    publicArrivals(rows, await source.medusaIds(bound)),
  );
  const wanted = capped.rows;
  const leftOut = capped.leftOut ? { leftOut: capped.leftOut } : {};
  const current = await client.fetchLivestockArrivals();
  if (!arrivalsDiffer(current, wanted))
    return { status: "unchanged", count: wanted.length, ...leftOut };
  if (apply) await client.replaceLivestockArrivals(wanted);
  return {
    status: apply ? "sent" : "would-send",
    count: wanted.length,
    ...leftOut,
  };
}

export function describeLivestockArrivalsProjection(
  outcome: LivestockArrivalsOutcome,
): string {
  const left = outcome.leftOut
    ? `, ${outcome.leftOut} sor kimaradt a ${MAX_PUBLIC_ARRIVALS}-es plafon miatt`
    : "";
  return `Erkezo allatok: ${outcome.status} (${outcome.count} sor${left})`;
}

/**
 * Off by default, like the redirects and the landing pages: the round writes to another system, and the commerce module
 * (#719) comes first. `true` only where it is deployed (the test shop).
 */
export const projectLivestockArrivalsInRound = (
  env: NodeJS.ProcessEnv,
): boolean => env.MEDUSA_PROJECT_LIVESTOCK_ARRIVALS === "true";

export const prismaLivestockArrivalSource: LivestockArrivalSource = {
  rows: async () =>
    prisma.livestockArrival.findMany({
      where: { preorderable: true, status: { in: ["ORDERED", "IN_TRANSIT"] } },
      select: {
        id: true,
        kind: true,
        label: true,
        expectedOn: true,
        status: true,
        preorderable: true,
        productId: true,
      },
    }),
  medusaIds: async (productIds) => {
    if (productIds.length === 0) return new Map();
    const links = await prisma.externalReference.findMany({
      where: { ...MEDUSA_PRODUCT_REFERENCE, entityId: { in: [...productIds] } },
      select: { entityId: true, externalId: true },
    });
    return new Map(links.map((l) => [l.entityId, l.externalId]));
  },
};
