import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@acropora/database";

import { MemoryRedirectStore } from "./redirect-memory-store.js";
import { normalizeRedirectPath, redirectPathLower } from "./redirect-path.js";
import {
  describeRedirectBackfill,
  planRedirectBackfill,
  type RedirectBackfillReport,
} from "./redirect-backfill.js";
import type { RedirectRule } from "./redirect-writer.js";

export type ProductBackfillDb = Pick<
  PrismaClient | Prisma.TransactionClient,
  "product" | "urlRedirect"
>;

/** Egy régi cím vizsgálata (a kérés `inspect` listájából): miért van vagy nincs rajta szabály. */
export interface RedirectInspection {
  /** A kért cím, ahogy érkezett. */
  asked: string;
  /** A normalizált cím; `null`: a cím érvénytelen (üres, szóközös), nincs mit keresni. */
  normalized: string | null;
  /** A meglévő szabály ezen a címen (a cím kisbetűs egyezése). */
  rule: {
    destination: string;
    reason: string;
    isActive: boolean;
    createdAt?: string;
  } | null;
  /** A UNAS-címük erre a címre normalizálódó termékek (általában egy): van-e webshop-slugjuk, és mi a tervezett cél. */
  products: {
    id: string;
    hasWebshopSlug: boolean;
    plannedDestination: string | null;
  }[];
}

export interface ProductBackfillPlan {
  store: MemoryRedirectStore;
  report: RedirectBackfillReport;
  inspections: RedirectInspection[];
}

/**
 * A TERMÉK-ÁTIRÁNYÍTÁS TERVE AZ ADATBÁZISBÓL (a parancs `redirect-backfill.cli.ts` ugyanezt a tervet futtatja). Az `inspect` címekre külön
 * vizsgálat készül ugyanabból a betöltésből: melyik termék UNAS-címe normalizálódik oda, és mi áll már a címen.
 */
export async function planProductRedirectsFromDb(
  db: ProductBackfillDb,
  inspect: readonly string[] = [],
): Promise<ProductBackfillPlan> {
  const [termekek, meglevo] = await Promise.all([
    db.product.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        channelListings: {
          where: { channel: { in: ["UNAS", "WEBSHOP"] } },
          select: { channel: true, productUrl: true, slug: true },
        },
      },
    }),
    db.urlRedirect.findMany({
      select: {
        id: true,
        sourcePath: true,
        destinationPath: true,
        isActive: true,
        reason: true,
        createdAt: true,
        createdById: true,
        entityType: true,
        entityId: true,
      },
    }),
  ]);
  const products = termekek.map((t) => ({
    id: t.id,
    unasUrl:
      t.channelListings.find((c) => c.channel === "UNAS")?.productUrl ?? null,
    webshopSlug:
      t.channelListings.find((c) => c.channel === "WEBSHOP")?.slug ?? null,
  }));
  const rules: RedirectRule[] = meglevo.map((r) => ({
    id: r.id,
    sourcePath: r.sourcePath,
    destinationPath: r.destinationPath,
    isActive: r.isActive,
    reason: r.reason,
    createdAt: r.createdAt,
  }));
  const { store, report } = await planRedirectBackfill(products, rules);
  const byOldPath = new Map<string, typeof products>();
  for (const p of products) {
    const key = p.unasUrl ? normalizeRedirectPath(p.unasUrl) : null;
    if (key)
      byOldPath.set(redirectPathLower(key), [
        ...(byOldPath.get(redirectPathLower(key)) ?? []),
        p,
      ]);
  }
  const ruleByPath = new Map(
    rules.map((r) => [redirectPathLower(r.sourcePath), r]),
  );
  const inspections = inspect.map((asked): RedirectInspection => {
    const normalized = normalizeRedirectPath(asked);
    if (normalized === null)
      return { asked, normalized, rule: null, products: [] };
    const key = redirectPathLower(normalized);
    const rule = ruleByPath.get(key);
    return {
      asked,
      normalized,
      rule: rule
        ? {
            destination: rule.destinationPath,
            reason: rule.reason ?? "none",
            isActive: rule.isActive,
            ...(rule.createdAt !== undefined
              ? { createdAt: new Date(rule.createdAt).toISOString() }
              : {}),
          }
        : null,
      products: (byOldPath.get(key) ?? []).map((p) => ({
        id: p.id,
        hasWebshopSlug: Boolean(p.webshopSlug),
        plannedDestination: p.webshopSlug
          ? `/hu/termek/${p.webshopSlug}`
          : null,
      })),
    };
  });
  return { store, report, inspections };
}

/**
 * A TERV UJJLENYOMATA (ugyanaz az elv, mint a kategória-betöltőnél): a jelentés SZÖVEGÉBŐL és a kiírandó sorokból. Az `inspect` vizsgálat nincs
 * benne: az csak olvasás, és az írásnak nem kell ugyanazt a listát újra megadnia.
 */
export function productRedirectPlanHash(plan: ProductBackfillPlan): string {
  const { store, report } = plan;
  return createHash("sha256")
    .update(
      JSON.stringify({
        text: describeRedirectBackfill(report),
        created: store
          .created()
          .map((r) => [r.sourcePath, r.destinationPath, r.reason]),
        updated: store.updated().map((m) => [m.id, m.data]),
      }),
    )
    .digest("hex");
}
