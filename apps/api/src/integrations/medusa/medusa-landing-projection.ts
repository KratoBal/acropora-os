import { prisma } from "@acropora/database";

import {
  filterOf,
  type SeoLandingRow,
} from "../../seo-landing/seo-landing.service.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MedusaStoreCategoryLinkRepository } from "./medusa-category-link.repository.js";

/**
 * THE COMMERCE LANDING PAGE RECORD (the commerce `PUT
 * /admin/landing-pages/:os_landing_id` contract, SEO P1-14 part A). The filter
 * is in the shop's terms: Medusa category ids, OS brand ids.
 */
export interface MedusaLandingPageRecord {
  handle: string;
  title: string;
  seo_title: string | null;
  meta_description: string | null;
  intro: string | null;
  filter: {
    category_ids: string[];
    os_brand_ids: string[];
    attribute_filters: never[];
  };
  is_published: boolean;
}

export interface LandingSource {
  landingPages(): Promise<SeoLandingRow[]>;
  /** OS store category id to Medusa category id, for the linked ones. */
  categoryLinks(): Promise<Map<string, string>>;
}

export type LandingPageOutcome =
  | { id: string; slug: string; status: "unchanged" | "sent" | "would-send" }
  | { id: string; slug: string; status: "refused"; reason: string };

/**
 * The record for one page, or why it cannot go: a category without a shop
 * twin would silently drop out of the filter, and the page would list MORE
 * than it says (the same reason the attribute filters are refused).
 */
export function landingRecord(
  row: SeoLandingRow,
  links: ReadonlyMap<string, string>,
): { record: MedusaLandingPageRecord } | { reason: string } {
  const filter = filterOf(row.filterDefinition);
  if (filter.attributeFilters.length)
    return { reason: "attribute filters are not served yet" };
  const missing = filter.storeCategoryIds.filter((id) => !links.has(id));
  if (missing.length)
    return { reason: `no shop category for ${missing.join(", ")}` };
  const categoryIds = filter.storeCategoryIds.map((id) => links.get(id)!);
  if (!categoryIds.length && !filter.brandIds.length)
    return { reason: "the filter is empty" };
  return {
    record: {
      handle: row.slug,
      title: row.title,
      seo_title: row.seoTitle,
      meta_description: row.metaDescription,
      intro: row.intro,
      filter: {
        category_ids: categoryIds,
        os_brand_ids: filter.brandIds,
        attribute_filters: [],
      },
      is_published: row.isPublished,
    },
  };
}

/** The fields the shop keeps, compared as the shop answers them. */
export function landingRecordDiffers(
  current: Partial<MedusaLandingPageRecord> | null,
  wanted: MedusaLandingPageRecord,
): boolean {
  if (!current) return true;
  const pick = (r: Partial<MedusaLandingPageRecord>) =>
    JSON.stringify([
      r.handle,
      r.title,
      r.seo_title ?? null,
      r.meta_description ?? null,
      r.intro ?? null,
      r.filter?.category_ids ?? [],
      r.filter?.os_brand_ids ?? [],
      r.filter?.attribute_filters ?? [],
      r.is_published ?? false,
    ]);
  return pick(current) !== pick(wanted);
}

/**
 * ONE ROUND (SEO P1-14): every OS landing page, read first and written only
 * when it differs, as the brand record does. A refused page does not stop
 * the others; the outcome names it.
 */
export async function projectLandingPages(
  client: Pick<MedusaAdminClient, "fetchLandingPage" | "setLandingPage">,
  source: LandingSource,
  apply: boolean,
): Promise<LandingPageOutcome[]> {
  const [rows, links] = await Promise.all([
    source.landingPages(),
    source.categoryLinks(),
  ]);
  const outcomes: LandingPageOutcome[] = [];
  for (const row of rows) {
    const built = landingRecord(row, links);
    if ("reason" in built) {
      outcomes.push({
        id: row.id,
        slug: row.slug,
        status: "refused",
        reason: built.reason,
      });
      continue;
    }
    const current = await client.fetchLandingPage(row.id);
    if (!landingRecordDiffers(current, built.record)) {
      outcomes.push({ id: row.id, slug: row.slug, status: "unchanged" });
      continue;
    }
    if (apply) await client.setLandingPage(row.id, built.record);
    outcomes.push({
      id: row.id,
      slug: row.slug,
      status: apply ? "sent" : "would-send",
    });
  }
  return outcomes;
}

export function describeLandingProjection(
  outcomes: readonly LandingPageOutcome[],
): string {
  const count = (s: LandingPageOutcome["status"]) =>
    outcomes.filter((o) => o.status === s).length;
  const refused = outcomes
    .filter(
      (o): o is Extract<LandingPageOutcome, { status: "refused" }> =>
        o.status === "refused",
    )
    .map((o) => `${o.slug}: ${o.reason}`);
  return `Landing oldalak: ${outcomes.length} oldal, ${count("sent") + count("would-send")} kiment, ${count("unchanged")} valtozatlan, ${refused.length} visszatartva${
    refused.length ? ` (${refused.join("; ")})` : ""
  }`;
}

export const prismaLandingSource: LandingSource = {
  landingPages: () =>
    prisma.seoLandingPage.findMany({ orderBy: { slug: "asc" } }),
  categoryLinks: async () =>
    new Map(
      (await new MedusaStoreCategoryLinkRepository().all()).map((l) => [
        l.categoryId,
        l.medusaCategoryId,
      ]),
    ),
};
