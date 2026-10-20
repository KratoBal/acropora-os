import { prisma } from "@acropora/database";
import type { HomepageContentInput, HomepageSlide } from "@acropora/types";

import {
  MAIN_HOMEPAGE_KEY,
  toHomepageContent,
} from "../../homepage-content/homepage-content.service.js";
import type { MedusaAdminClient } from "./medusa-admin.client.js";

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

/**
 * THE COMMERCE HOMEPAGE CONTENT RECORD (the commerce `PUT /admin/homepage-content`
 * contract, #551 and #553): the text overrides, and the slides (`null` is "not
 * set", the storefront shows its starting slides).
 */
export interface MedusaHomepageContentRecord {
  texts: Record<string, string>;
  slides: MedusaHomepageSlide[] | null;
}

export type HomepageProjectionOutcome =
  { status: "unchanged" | "sent" | "would-send" } | { status: "nothing" };

export interface HomepageSource {
  /** The stored content, or `null` when nobody has saved any yet. */
  content(): Promise<HomepageContentInput | null>;
  /** The administrator's switch in the editor (a database row). */
  switchedOn(): Promise<boolean>;
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

export function homepageRecord(
  content: HomepageContentInput,
): MedusaHomepageContentRecord {
  return {
    texts: { ...content.texts },
    slides: content.slides === null ? null : content.slides.map(slideRecord),
  };
}

/** The fields the shop keeps, compared as the shop answers them (key order does not matter). */
export function homepageRecordDiffers(
  current: Partial<MedusaHomepageContentRecord> | null,
  wanted: MedusaHomepageContentRecord,
): boolean {
  if (!current) return true;
  const pick = (r: Partial<MedusaHomepageContentRecord>) =>
    JSON.stringify([
      Object.entries(r.texts ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)),
      r.slides === undefined ? null : r.slides,
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
    "fetchHomepageContent" | "setHomepageContent"
  >,
  source: HomepageSource,
  apply: boolean,
): Promise<HomepageProjectionOutcome> {
  const content = await source.content();
  if (!content) return { status: "nothing" };
  const wanted = homepageRecord(content);
  const current = await client.fetchHomepageContent();
  if (!homepageRecordDiffers(current, wanted)) return { status: "unchanged" };
  if (apply) await client.setHomepageContent(wanted);
  return { status: apply ? "sent" : "would-send" };
}

export function describeHomepageProjection(
  outcome: HomepageProjectionOutcome,
): string {
  return `Kezdolap tartalom: ${outcome.status}`;
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
    const { texts, slides } = toHomepageContent(row);
    return { texts, slides };
  },
  switchedOn: async () =>
    (
      await prisma.homepageContent.findUnique({
        where: { key: MAIN_HOMEPAGE_KEY },
        select: { projectionEnabled: true },
      })
    )?.projectionEnabled === true,
};
