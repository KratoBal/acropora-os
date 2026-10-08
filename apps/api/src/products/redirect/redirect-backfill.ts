import { MemoryRedirectStore } from "./redirect-memory-store.js";
import { normalizeRedirectPath, webshopProductPath } from "./redirect-path.js";
import {
  RedirectError,
  redirectInvariantViolations,
  writeRedirect,
  type RedirectRule,
} from "./redirect-writer.js";

/**
 * A RÉGI UNAS-TERMÉKCÍMEK ÁTIRÁNYÍTÁSA (SEO P0 PR 6). A terv a UNAS csatorna-sor
 * `productUrl`-jéből a normalizált út → `/hu/termek/<a termék WEBSHOP-slugja>`,
 * `reason = UNAS_PRODUCT`.
 *
 * A SZÁRAZFUTÁS UGYANAZ A KÓD, MINT AZ ÍRÁS: a `writeRedirect` egy memóriabeli
 * tárolón fut le, ami a meglévő szabályokkal indul; `--apply` mellett a CLI a
 * tároló naplóját írja ki egy tranzakcióban. Idempotens: egy már ugyanoda mutató
 * szabály `unchanged`; egy más célú a jelentésbe kerül, felülírás nélkül.
 *
 * Slug nélküli termék kimarad, és a jelentés megszámolja: a slugot a
 * `slug-backfill` adja, előbb az fusson.
 */
export interface RedirectBackfillProduct {
  id: string;
  /** A UNAS csatorna-sor `productUrl`-je. */
  unasUrl: string | null;
  /** A WEBSHOP csatorna-sor slugja. */
  webshopSlug: string | null;
}

export interface RedirectBackfillReport {
  products: number;
  withoutOldUrl: number;
  withoutWebshopSlug: string[];
  created: number;
  unchanged: number;
  repointed: number;
  spdPaths: number;
  conflicts: { productId: string; source: string; existing: string }[];
  refused: { productId: string; kind: string; message: string }[];
  invariantViolations: RedirectRule[];
}

export async function planRedirectBackfill(
  products: readonly RedirectBackfillProduct[],
  existing: readonly RedirectRule[],
): Promise<{ store: MemoryRedirectStore; report: RedirectBackfillReport }> {
  const store = new MemoryRedirectStore(existing);
  const report: RedirectBackfillReport = {
    products: products.length,
    withoutOldUrl: 0,
    withoutWebshopSlug: [],
    created: 0,
    unchanged: 0,
    repointed: 0,
    spdPaths: 0,
    conflicts: [],
    refused: [],
    invariantViolations: [],
  };
  // a sorrend rögzített: egy ütközésnél mindig ugyanaz a termék nyer
  for (const p of [...products].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!p.unasUrl?.trim()) {
      report.withoutOldUrl += 1;
      continue;
    }
    if (!p.webshopSlug) {
      report.withoutWebshopSlug.push(p.id);
      continue;
    }
    try {
      const eredmeny = await writeRedirect(store, {
        source: p.unasUrl,
        destination: webshopProductPath(p.webshopSlug),
        reason: "UNAS_PRODUCT",
        entityType: "PRODUCT",
        entityId: p.id,
        onExisting: "keep",
      });
      report.repointed += eredmeny.repointed;
      if (eredmeny.status === "unchanged") report.unchanged += 1;
      else if (eredmeny.status === "conflict")
        report.conflicts.push({
          productId: p.id,
          source: normalizeRedirectPath(p.unasUrl) ?? p.unasUrl,
          existing: eredmeny.existingDestination,
        });
      else {
        report.created += 1;
        // az ÚJ szabályok közül (a második futás 0-t mond, nem a régi címek számát)
        if (normalizeRedirectPath(p.unasUrl)?.startsWith("/spd/"))
          report.spdPaths += 1;
      }
    } catch (error) {
      if (!(error instanceof RedirectError)) throw error;
      report.refused.push({
        productId: p.id,
        kind: error.kind,
        message: error.message,
      });
    }
  }
  report.invariantViolations = await redirectInvariantViolations(store);
  return { store, report };
}

export function describeRedirectBackfill(r: RedirectBackfillReport): string {
  return [
    `Termek: ${r.products}; regi cim nelkul: ${r.withoutOldUrl}; webshop-slug nelkul: ${r.withoutWebshopSlug.length}`,
    `Uj szabaly: ${r.created} (ebbol /spd/ cim: ${r.spdPaths}); valtozatlan: ${r.unchanged}; atirt korabbi cel (lanc-osszevonas): ${r.repointed}`,
    `Elteroen mar meglevo (nem irtuk felul): ${r.conflicts.length}; elutasitva (kor, kisbetus utkozes, ervenytelen): ${r.refused.length}`,
    `Invarians (aktiv cel, ami forras): ${r.invariantViolations.length}`,
    ...r.withoutWebshopSlug.map((id) => `  slug nelkul: ${id}`),
    ...r.conflicts.map(
      (c) => `  elteroen meglevo: ${c.productId} ${c.source} -> ${c.existing}`,
    ),
    ...r.refused.map(
      (x) => `  elutasitva: ${x.productId} ${x.kind}: ${x.message}`,
    ),
    ...r.invariantViolations.map(
      (v) => `  lanc: ${v.sourcePath} -> ${v.destinationPath}`,
    ),
    "",
  ].join("\n");
}
