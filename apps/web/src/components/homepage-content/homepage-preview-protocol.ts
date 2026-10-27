import {
  isShopHref,
  type HomepageBlock,
  type HomepageFooter,
  type HomepageNewsletter,
  type HomepageSlide,
} from "@acropora/types";

/**
 * THE LIVE PREVIEW PROTOCOL, OS SIDE (v1, `agents/nautilus/atadas/
 * kezdolap-2026-10-26/elonezet-protokoll.md`; acrobot 36017: the preview is the
 * REAL test storefront in a frame, the unsaved content goes in a message and is
 * never stored). The storefront side is murena's (acropora-commerce).
 *
 * The record is the commerce `homepage_content` shape (snake_case), the same
 * one the projection writes. `featured_handles` is NOT in it: the editor knows
 * product ids, not the shop's handles, so the storefront keeps the saved band.
 */
export const PREVIEW_PROTOCOL_VERSION = 1;
export const PREVIEW_PATH = "/hu/kezdolap-elonezet";

export const PREVIEW_MESSAGE = {
  ready: "acropora:homepage-preview:ready",
  selected: "acropora:homepage-preview:selected",
  error: "acropora:homepage-preview:error",
  content: "acropora:homepage-preview:content",
  select: "acropora:homepage-preview:select",
} as const;

export interface PreviewRecord {
  texts: Record<string, string>;
  slides: Record<string, string | null>[] | null;
  blocks: HomepageBlock[] | null;
  footer: {
    intro: string;
    columns: HomepageFooter["columns"];
    social: HomepageFooter["social"];
    bottom_text: string;
  } | null;
  /**
   * The newsletter row, ONLY when set: the storefront refuses a record with a
   * key it does not know, and one that predates the row (commerce #577) would
   * otherwise refuse every preview (same rule as the projection).
   */
  newsletter?: {
    enabled: boolean;
    title: string;
    text: string;
    consent_text: string;
    button: string;
  };
}

/*
  A button target the shop would refuse goes to the preview as "no button":
  the field already says what is wrong, and the preview keeps showing the rest
  (acrobot 36371). The save still refuses it, by name.
*/
const previewHref = (href: string | null) =>
  href && isShopHref(href) ? href : null;

const slideRecord = (slide: HomepageSlide) => ({
  eyebrow: slide.eyebrow,
  title: slide.title,
  text: slide.text,
  cta: slide.cta,
  cta_href: previewHref(slide.ctaHref),
  cta2: slide.cta2,
  cta2_href: previewHref(slide.cta2Href),
  caption: slide.caption,
  caption2: slide.caption2,
  image_url: slide.imageUrl,
  image_alt: slide.imageAlt,
});

export function previewRecord(content: {
  texts: Record<string, string>;
  slides: HomepageSlide[] | null;
  blocks: HomepageBlock[] | null;
  footer: HomepageFooter | null;
  newsletter?: HomepageNewsletter | null;
}): PreviewRecord {
  return {
    texts: { ...content.texts },
    slides: content.slides === null ? null : content.slides.map(slideRecord),
    blocks: content.blocks,
    footer: content.footer
      ? {
          intro: content.footer.intro,
          columns: content.footer.columns,
          social: content.footer.social,
          bottom_text: content.footer.bottomText,
        }
      : null,
    ...(content.newsletter
      ? {
          newsletter: {
            enabled: content.newsletter.enabled,
            title: content.newsletter.title,
            text: content.newsletter.text,
            consent_text: content.newsletter.consentText,
            button: content.newsletter.button,
          },
        }
      : {}),
  };
}

/** A message from the frame, read defensively: anything else is `null`. */
export function readPreviewMessage(
  data: unknown,
):
  | { type: "ready" }
  | { type: "selected"; block: string }
  | { type: "error"; message: string }
  | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Record<string, unknown>;
  if (message.version !== PREVIEW_PROTOCOL_VERSION) return null;
  if (message.type === PREVIEW_MESSAGE.ready) return { type: "ready" };
  if (
    message.type === PREVIEW_MESSAGE.selected &&
    typeof message.block === "string"
  )
    return { type: "selected", block: message.block };
  if (
    message.type === PREVIEW_MESSAGE.error &&
    typeof message.message === "string"
  )
    return { type: "error", message: message.message.slice(0, 300) };
  return null;
}
