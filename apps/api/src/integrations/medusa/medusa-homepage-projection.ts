import { prisma } from "@acropora/database";
import type {
  HomepageBlock,
  HomepageContentInput,
  HomepageFooter,
  HomepageNewsletter,
  HomepageSlide,
} from "@acropora/types";

import {
  MAIN_HOMEPAGE_KEY,
  storedBrandIds,
  toHomepageContent,
} from "../../homepage-content/homepage-content.service.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";
import { MEDUSA_PRODUCT_REFERENCE } from "./medusa-product-link.repository.js";

/** A slide as the commerce validator wants it (snake case). */
export interface MedusaHomepageSlide {
  eyebrow: string;
  title: string;
  text: string;
  cta: string;
  cta_href: string | null;
  cta2: string;
  cta2_href: string | null;
  caption: string;
  caption2: string;
  image_url: string | null;
  image_alt: string;
}

/** The footer as the commerce validator wants it (#564, #567; snake case). */
export interface MedusaHomepageFooter {
  intro: string;
  columns: { title: string; links: { label: string; href: string }[] }[];
  social: {
    facebook: string | null;
    instagram: string | null;
    youtube: string | null;
  };
  bottom_text: string;
}

/** The newsletter row as the commerce validator wants it (#577; snake case). */
export interface MedusaHomepageNewsletter {
  enabled: boolean;
  title: string;
  text: string;
  consent_text: string;
  button: string;
}

/**
 * THE COMMERCE HOMEPAGE CONTENT RECORD (the commerce `PUT /admin/homepage-content`
 * contract, #551 and #553): the text overrides, and the slides (`null` is "not
 * set", the storefront shows its starting slides).
 */
export interface MedusaHomepageContentRecord {
  texts: Record<string, string>;
  slides: MedusaHomepageSlide[] | null;
  /** The "Egyedi korallok" band's product handles, in order (commerce #555). */
  featured_handles?: string[] | null;
  /**
   * The eight fixed blocks in order, each shown or hidden (commerce #564);
   * `null` is "not set", the storefront's own order with all shown.
   */
  blocks?: HomepageBlock[] | null;
  /** The footer (commerce #564, #567); `null` is the storefront's own. */
  footer?: MedusaHomepageFooter | null;
  /**
   * The logo strip's brand handles, in order (commerce #575). Sent ONLY when
   * the OS has a list: a shop that predates the field refuses an unknown key
   * and would refuse the whole record, so until somebody sets the strip, the
   * record stays what it was.
   */
  featured_brand_handles?: string[];
  /**
   * The newsletter row (commerce #577); sent when the OS has one, and `null`
   * only to clear a row the shop still holds (see projectHomepageContent).
   */
  newsletter?: MedusaHomepageNewsletter | null;
}

export type HomepageProjectionOutcome =
  | {
      status: "unchanged" | "sent" | "would-send";
      /** Marked products whose handle the shop would refuse, left out. */
      skippedHandles?: string[];
    }
  | { status: "nothing" };

export interface HomepageSource {
  /** The stored content, or `null` when nobody has saved any yet. */
  content(): Promise<HomepageContentInput | null>;
  /** The administrator's switch in the editor (a database row). */
  switchedOn(): Promise<boolean>;
  /** The Medusa product ids of the products marked for the band, in order. */
  featured(): Promise<string[]>;
  /**
   * The logo strip's brand handles (the brands' slugs, the shop's brand
   * handles), in order, only the shown brands; `null` when the list was never
   * set.
   */
  brands(): Promise<string[] | null>;
}

const slideRecord = (slide: HomepageSlide): MedusaHomepageSlide => ({
  eyebrow: slide.eyebrow,
  title: slide.title,
  text: slide.text,
  cta: slide.cta,
  cta_href: slide.ctaHref,
  cta2: slide.cta2,
  cta2_href: slide.cta2Href,
  caption: slide.caption,
  caption2: slide.caption2,
  image_url: slide.imageUrl,
  image_alt: slide.imageAlt,
});

/**
 * THE BAND'S HANDLES, FIT FOR THE SHOP'S VALIDATOR (barracuda, #1723). The shop
 * (commerce #555) refuses the WHOLE home page record, texts and slides too, if
 * the list has a handle outside `^[a-z0-9][a-z0-9._-]*$`, a `..`, a duplicate or
 * more than 12 entries; a refused record would fail the same way every round
 * until someone unmarked a product. So the list is filtered to the shop's rules
 * BEFORE it is sent, and what is left out is returned by name (the caller logs
 * it): an odd handle costs its own card, never the page.
 */
export const FEATURED_HANDLE_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const FEATURED_HANDLE_MAX = 12;

export function shopFeaturedHandles(raw: readonly string[]): {
  handles: string[];
  skipped: string[];
} {
  const handles: string[] = [];
  const skipped: string[] = [];
  for (const handle of raw) {
    const fine =
      handle.length <= 200 &&
      FEATURED_HANDLE_PATTERN.test(handle) &&
      !handle.includes("..") &&
      !handles.includes(handle) &&
      handles.length < FEATURED_HANDLE_MAX;
    (fine ? handles : skipped).push(handle);
  }
  return { handles, skipped };
}

const footerRecord = (footer: HomepageFooter): MedusaHomepageFooter => ({
  intro: footer.intro,
  columns: footer.columns.map((column) => ({
    title: column.title,
    links: column.links.map((link) => ({ label: link.label, href: link.href })),
  })),
  social: {
    facebook: footer.social.facebook,
    instagram: footer.social.instagram,
    youtube: footer.social.youtube,
  },
  bottom_text: footer.bottomText,
});

const newsletterRecord = (
  row: HomepageNewsletter,
): MedusaHomepageNewsletter => ({
  enabled: row.enabled,
  title: row.title,
  text: row.text,
  consent_text: row.consentText,
  button: row.button,
});

/*
  THE BLOCKS AND THE FOOTER ARE SENT (2026-10-26, acrobot 36394 and 36397):
  the test backend runs commerce #564 and #567, which take them (measured:
  the store answer carries both keys). Always sent, `null` where the OS has
  none: with an absent key the shop would keep what it stored before, and a
  cleared footer would stay on the page.
*/
export function homepageRecord(
  content: HomepageContentInput,
  featuredHandles: readonly string[] = [],
  brandHandles: readonly string[] | null = null,
): MedusaHomepageContentRecord {
  return {
    ...(brandHandles !== null
      ? { featured_brand_handles: [...brandHandles] }
      : {}),
    texts: { ...content.texts },
    slides: content.slides === null ? null : content.slides.map(slideRecord),
    featured_handles: [...featuredHandles],
    blocks: content.blocks
      ? content.blocks.map((block) => ({
          key: block.key,
          visible: block.visible,
        }))
      : null,
    footer: content.footer ? footerRecord(content.footer) : null,
    /*
      THE NEWSLETTER ROW ONLY WHEN SET (kirakat-lablec-kep): the shop's
      validator is strict, and a shop without commerce #577 would refuse the
      WHOLE record for the unknown key. Unset is the OS's normal state until
      someone edits the row (the editor keeps `null` until then), so the
      record stays what it was. Once set, the OS editor has no way back to
      `null`; a `null` saved through the API is cleared by the round itself
      (projectHomepageContent), not here, because only the round sees the
      shop's answer.
    */
    ...(content.newsletter
      ? { newsletter: newsletterRecord(content.newsletter) }
      : {}),
  };
}

/** The fields the shop keeps, compared as the shop answers them (key order does not matter). */
/**
 * JSON WITH EVERY OBJECT'S KEYS IN ONE ORDER (barracuda, #1900): the shop
 * keeps the record in jsonb, and jsonb answers an object's keys in its own
 * order (shorter keys first), not in the order they were sent. Compared as
 * plain JSON, the slides and the footer never matched, and every round wrote
 * again. Arrays keep their order: there the order is the content.
 */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((key) => [key, sort((v as Record<string, unknown>)[key])]),
          )
        : v;
  return JSON.stringify(sort(value));
}

export function homepageRecordDiffers(
  current: Partial<MedusaHomepageContentRecord> | null,
  wanted: MedusaHomepageContentRecord,
): boolean {
  if (!current) return true;
  const pick = (r: Partial<MedusaHomepageContentRecord>) =>
    canonicalJson([
      r.texts ?? {},
      r.slides === undefined ? null : r.slides,
      // null and "never sent" are the same as an empty band
      r.featured_handles ?? [],
      // null and "never sent" are both "not set"
      r.blocks ?? null,
      r.footer ?? null,
      // compared only when we send it: a list never set leaves the shop's as it is
      "featured_brand_handles" in wanted ? (r.featured_brand_handles ?? []) : 0,
      // absent and null are both "not set"; the OS sends it only when set
      r.newsletter ?? null,
    ]);
  return pick(current) !== pick(wanted);
}

/**
 * ONE ROUND: the stored content, read from the shop first and written only
 * when it differs, as the landing pages are. Nothing stored yet is nothing to
 * send (the shop shows its starting values, which is the right state).
 */
export async function projectHomepageContent(
  client: Pick<
    MedusaAdminClient,
    "fetchHomepageContent" | "setHomepageContent" | "fetchProductHandle"
  >,
  source: HomepageSource,
  apply: boolean,
): Promise<HomepageProjectionOutcome> {
  const [content, featuredIds, brandHandles] = await Promise.all([
    source.content(),
    source.featured(),
    source.brands(),
  ]);
  // nothing stored and nothing marked: nothing to send (the brand list lives in the stored row)
  if (!content && !featuredIds.length) return { status: "nothing" };
  /*
    THE BAND'S HANDLES come from the shop itself (the product's own handle),
    not from our slug: the shop's handle follows the handle switch, and only the
    shop knows which one is live. A product the shop no longer has is left out.
  */
  const handles: string[] = [];
  for (const id of featuredIds) {
    const handle = await client.fetchProductHandle(id);
    if (handle) handles.push(handle);
  }
  const fit = shopFeaturedHandles(handles);
  const wanted = homepageRecord(
    content ?? { texts: {}, slides: null },
    fit.handles,
    brandHandles,
  );
  const skippedHandles = fit.skipped.length ? fit.skipped : undefined;
  const current = await client.fetchHomepageContent();
  /*
    A ROW CLEARED THROUGH THE API (barracuda, #1913): the OS holds `null`, the
    shop still holds a row. Absent would keep the shop's row, and every round
    would see the difference and write again, forever. The shop answering a
    row proves it knows the key (#577), so `null` is safe to send, and the
    next round finds both sides `null`.
  */
  const toSend =
    !("newsletter" in wanted) && current?.newsletter
      ? { ...wanted, newsletter: null }
      : wanted;
  if (!homepageRecordDiffers(current, toSend))
    return { status: "unchanged", skippedHandles };
  if (apply) await client.setHomepageContent(toSend);
  return { status: apply ? "sent" : "would-send", skippedHandles };
}

export function describeHomepageProjection(
  outcome: HomepageProjectionOutcome,
): string {
  const skipped =
    "skippedHandles" in outcome && outcome.skippedHandles?.length
      ? ` (kihagyott kiemelt handle: ${outcome.skippedHandles.join(", ")})`
      : "";
  return `Kezdolap tartalom: ${outcome.status}${skipped}`;
}

/**
 * Off by default, like the other rounds: the projection writes to another
 * system. It runs ONLY where the environment allows it (the variable, true on
 * the test OS, absent on the production OS) AND the administrator's switch in
 * the editor is on. An AND, not an OR (acrobot 33495, barracuda #1721): the
 * commerce exception covers the test shop, so a switch alone must never be able
 * to write into the Medusa the production OS points at.
 */
export const projectHomepageContentInRound = async (
  env: NodeJS.ProcessEnv,
  source: Pick<HomepageSource, "switchedOn">,
): Promise<boolean> =>
  env.MEDUSA_PROJECT_HOMEPAGE_CONTENT === "true" && (await source.switchedOn());

export const prismaHomepageSource: HomepageSource = {
  content: async () => {
    const row = await prisma.homepageContent.findUnique({
      where: { key: MAIN_HOMEPAGE_KEY },
    });
    if (!row) return null;
    // the blocks and the footer too, since commerce #564/#567 (see homepageRecord)
    const { texts, slides, blocks, footer, newsletter } =
      toHomepageContent(row);
    return { texts, slides, blocks, footer, newsletter };
  },
  featured: async () => {
    const rows = await prisma.homepageFeaturedProduct.findMany({
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { productId: true },
    });
    if (!rows.length) return [];
    const links = await prisma.externalReference.findMany({
      where: {
        system: MEDUSA_PRODUCT_REFERENCE.system,
        entityType: MEDUSA_PRODUCT_REFERENCE.entityType,
        entityId: { in: rows.map((r) => r.productId) },
      },
      select: { entityId: true, externalId: true },
    });
    const byProduct = new Map(links.map((l) => [l.entityId, l.externalId]));
    return rows.flatMap((r) => {
      const id = byProduct.get(r.productId);
      return id ? [id] : [];
    });
  },
  brands: async () => {
    const row = await prisma.homepageContent.findUnique({
      where: { key: MAIN_HOMEPAGE_KEY },
      select: { featuredBrandIds: true },
    });
    const ids = storedBrandIds(row?.featuredBrandIds);
    if (ids === null) return null;
    if (!ids.length) return [];
    const brands = await prisma.brand.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, isActive: true, archivedAt: true },
    });
    // the brand projection's rule (`brandIsShown`): a switched-off or archived brand has no shop page
    const slugOf = new Map(
      brands
        .filter((b) => b.isActive && !b.archivedAt)
        .map((b) => [b.id, b.slug]),
    );
    return ids.flatMap((id) => {
      const slug = slugOf.get(id);
      return slug ? [slug] : [];
    });
  },
  switchedOn: async () =>
    (
      await prisma.homepageContent.findUnique({
        where: { key: MAIN_HOMEPAGE_KEY },
        select: { projectionEnabled: true },
      })
    )?.projectionEnabled === true,
};
