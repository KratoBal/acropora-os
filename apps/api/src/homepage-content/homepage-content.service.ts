import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sanitizeRichHtml } from "@acropora/rich-text";
import {
  HOMEPAGE_BLOCK_KEYS,
  HOMEPAGE_LIMITS,
  parseHomepageContentInput,
  type HomepageBlock,
  type HomepageBrand,
  type HomepageContent,
  type HomepageContentInput,
  type HomepageFooter,
  type HomepageNewsletter,
  type HomepageSlide,
  isShortTextKey,
  looksLikeShortHtml,
} from "@acropora/types";

import { detectImageContentType } from "../integrations/medusa/image-content-type.js";

export const HOMEPAGE_CONTENT_STORE = Symbol("HOMEPAGE_CONTENT_STORE");
export const HOMEPAGE_CONTENT_PROJECTOR = Symbol("HOMEPAGE_CONTENT_PROJECTOR");
export const HOMEPAGE_IMAGE_UPLOADER = Symbol("HOMEPAGE_IMAGE_UPLOADER");
export const HOMEPAGE_ENVIRONMENT = Symbol("HOMEPAGE_ENVIRONMENT");

/** A hero or band image: the web shop's own formats, at most 8 MB. */
export const HOMEPAGE_IMAGE_LIMITS = {
  bytes: 8 * 1024 * 1024,
  types: ["image/jpeg", "image/png", "image/webp"],
} as const;

export interface HomepageImageUpload {
  fileName: string;
  contentType: string;
  content: Buffer;
}

/**
 * Puts the image on the shop's file storage and returns its public address.
 * The service calls it only where the projection is switched on (an upload is
 * a write to the shop too).
 */
export type HomepageImageUploader = (
  image: HomepageImageUpload,
) => Promise<{ url: string }>;

/** The extension of what the bytes are; the editor's own file name is never used. */
const EXTENSION = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
} as const;

/** The "Egyedi korallok" band shows at most this many (commerce #555). */
export const HOMEPAGE_FEATURED_MAX = 12;

export interface HomepageFeaturedRow {
  productId: string;
  name: string;
  sortOrder: number;
  /**
   * The product's first image and its list price, from the product itself
   * (the same fields the product list shows), never a copy kept by hand
   * (Balázs's brief, 2026-10-26, 4. pont). `grossPrice`: the UNAS mirror's
   * gross price, `null` without one.
   */
  imageUrl: string | null;
  grossPrice: string | null;
}

/** The only record today; another key would be another home page variant. */
export const MAIN_HOMEPAGE_KEY = "main";

export interface HomepageContentRow {
  key: string;
  texts: unknown;
  slides: unknown;
  blocks: unknown;
  footer: unknown;
  /** The logo strip's brand ids (a column added after the others: optional here). */
  featuredBrandIds?: unknown;
  newsletter: unknown;
  projectionEnabled: boolean;
  updatedAt: Date;
}

export interface HomepageContentStore {
  find(key: string): Promise<HomepageContentRow | null>;
  /** The administrator's switch, one row write (the row is created if missing). */
  setProjection(
    key: string,
    enabled: boolean,
    userId: string,
  ): Promise<HomepageContentRow>;
  /** The products marked for the band, in order. */
  featuredList(): Promise<HomepageFeaturedRow[]>;
  /**
   * Marks or unmarks one product. `unknown-product`: no such product; `full`:
   * marking would exceed `max` (an already marked product is never "full").
   */
  setFeatured(
    productId: string,
    featured: boolean,
    userId: string,
    max: number,
  ): Promise<"ok" | "unknown-product" | "full">;
  /**
   * The band's new order. `mismatch`: the list is not exactly the marked
   * products (a product marked or unmarked meanwhile, a duplicate): nothing is
   * written, the editor reloads the list.
   */
  orderFeatured(
    productIds: readonly string[],
    userId: string,
  ): Promise<"ok" | "mismatch">;
  /** The brands with these ids that exist, in any order. */
  brandsByIds(ids: readonly string[]): Promise<HomepageBrand[]>;
  /** The whole record, one transaction. */
  save(
    key: string,
    input: HomepageContentInput,
    userId: string,
  ): Promise<HomepageContentRow>;
}

/**
 * What happened to the projection after a save: `off` (the round is switched
 * off in this environment), `sent`, `unchanged`, or `failed` (the save is kept,
 * the scheduled round tries again).
 */
export type HomepageProjectionResult = "off" | "sent" | "unchanged" | "failed";
/** One round; the service asks for it only where the projection is switched on. */
export type HomepageContentProjector = () => Promise<"sent" | "unchanged">;

/**
 * DOES THIS ENVIRONMENT ALLOW WRITING TO THE WEB SHOP: the
 * `MEDUSA_PROJECT_HOMEPAGE_CONTENT=true` variable. The commerce exception is
 * for the TEST shop only; the production OS has the variable off, and an
 * administrator's switch there must not be able to write into the Medusa the
 * production OS points at (acrobot 33495, barracuda #1721).
 */
export function homepageProjectionAllowed(env: NodeJS.ProcessEnv): boolean {
  return env.MEDUSA_PROJECT_HOMEPAGE_CONTENT === "true";
}

const HOST_NAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * THE IMAGE HOSTS OF A FULL-PROFILE TEXT (`RICH_TEXT_IMAGE_HOSTS`, comma
 * separated host names). A malformed entry is dropped, not guessed at; an
 * empty or missing variable is an empty list, which passes NO image: the safe
 * direction (barracuda, #1877).
 */
/**
 * THE TEST STOREFRONT'S ORIGIN (`HOMEPAGE_STOREFRONT_URL`), https only, and
 * only where BOTH writing to the shop is allowed AND the preview is switched
 * on by its own variable (`HOMEPAGE_PREVIEW_ALLOWED=true`, the test system
 * only). The second switch is what keeps the admin from framing the live shop
 * once the production OS projects to the live Medusa too (barracuda, #1881):
 * a comment on an env template is not a guard.
 */
export function homepageStorefrontUrl(env: NodeJS.ProcessEnv): string | null {
  if (!homepageProjectionAllowed(env)) return null;
  if (env.HOMEPAGE_PREVIEW_ALLOWED !== "true") return null;
  try {
    const url = new URL((env.HOMEPAGE_STOREFRONT_URL ?? "").trim());
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

export function richTextImageHosts(env: NodeJS.ProcessEnv): string[] {
  return [
    ...new Set(
      (env.RICH_TEXT_IMAGE_HOSTS ?? "")
        .split(",")
        .map((host) => host.trim().toLowerCase())
        .filter((host) => HOST_NAME.test(host)),
    ),
  ];
}

/**
 * IS THE PROJECTION ON HERE: the environment allows it AND the administrator's
 * switch is on (an AND, not an OR: a missing variable makes the switch inert).
 */
export function homepageProjectionOn(
  env: NodeJS.ProcessEnv,
  row: Pick<HomepageContentRow, "projectionEnabled"> | null,
): boolean {
  return homepageProjectionAllowed(env) && row?.projectionEnabled === true;
}

/**
 * The stored block list, or `null` when it is not a complete one: a hand-edited
 * row that lost a block must not hide it on the page, so the page falls back
 * to the storefront's own order.
 */
function storedBlocks(value: unknown): HomepageBlock[] | null {
  if (!Array.isArray(value)) return null;
  const blocks = value.filter(
    (b): b is HomepageBlock =>
      typeof b === "object" &&
      b !== null &&
      (HOMEPAGE_BLOCK_KEYS as readonly string[]).includes(
        (b as { key?: unknown }).key as string,
      ) &&
      typeof (b as { visible?: unknown }).visible === "boolean",
  );
  const keys = new Set(blocks.map((b) => b.key));
  return keys.size === HOMEPAGE_BLOCK_KEYS.length &&
    blocks.length === HOMEPAGE_BLOCK_KEYS.length
    ? blocks.map(({ key, visible }) => ({ key, visible }))
    : null;
}

/** The stored brand ids through the same strict parse as a save, or `null`. */
export function storedBrandIds(value: unknown): string[] | null {
  if (value === null || value === undefined) return null;
  const parsed = parseHomepageContentInput({
    texts: {},
    slides: null,
    brandIds: value,
  });
  return parsed.ok ? (parsed.value.brandIds ?? null) : null;
}

/** The stored footer through the same strict parse as a save, or `null`. */
function storedFooter(value: unknown): HomepageFooter | null {
  if (value === null || value === undefined) return null;
  const parsed = parseHomepageContentInput({
    texts: {},
    slides: null,
    footer: value,
  });
  if (!parsed.ok || !parsed.value.footer) return null;
  /*
    THE READ SANITIZES AGAIN (barracuda, #1878): a hand-written row is never
    handed on raw.
  */
  return {
    ...parsed.value.footer,
    intro: sanitizeRichHtml(parsed.value.footer.intro, { profile: "short" }),
  };
}

/** The stored newsletter row through the same strict parse as a save, or `null`. */
function storedNewsletter(value: unknown): HomepageNewsletter | null {
  if (value === null || value === undefined) return null;
  const parsed = parseHomepageContentInput({
    texts: {},
    slides: null,
    newsletter: value,
  });
  return parsed.ok ? (parsed.value.newsletter ?? null) : null;
}

/**
 * THE FOOTER INTRO IS RICH TEXT in the shared sanitizer's SHORT profile
 * (#1879): paragraph, bold, italic, link, lists. The storefront footer draws
 * exactly these (murena 36080, barracuda #1878 b), so what the editor shows is
 * what every page shows. The storefront draws it as HTML on every page, so the
 * stored form is the security boundary, exactly like the mail body.
 */
function withSanitizedFooter(
  input: HomepageContentInput,
): HomepageContentInput {
  if (!input.footer) return input;
  return {
    ...input,
    footer: {
      ...input.footer,
      intro: sanitizeRichHtml(input.footer.intro, { profile: "short" }),
    },
  };
}

/**
 * THE FORMATTED SHORT TEXTS (2b-3; commerce #571): the catalogue's `short`
 * fields and every slide's text, in the shared sanitizer's SHORT profile. The
 * storefront draws them as HTML, so the stored form is the security boundary,
 * like the footer intro. Only a value that is short-profile HTML is cleaned:
 * a plain text stays plain, because cleaning would escape it and the
 * storefront shows a non-HTML value as text (`looksLikeShortHtml`).
 */
const cleanShort = (value: string) =>
  looksLikeShortHtml(value)
    ? sanitizeRichHtml(value, { profile: "short" })
    : value;

function withSanitizedShortTexts<
  T extends Pick<HomepageContentInput, "texts" | "slides">,
>(input: T): T {
  return {
    ...input,
    texts: Object.fromEntries(
      Object.entries(input.texts).map(([key, value]) => [
        key,
        isShortTextKey(key) ? cleanShort(value) : value,
      ]),
    ),
    slides:
      input.slides === null
        ? null
        : input.slides.map((slide) => ({
            ...slide,
            text: cleanShort(slide.text),
          })),
  };
}

/** The stored record, read defensively: a hand-edited row cannot break a read. */
export function toHomepageContent(
  row: HomepageContentRow | null,
  projectionAllowed = false,
  imageHosts: readonly string[] = [],
  storefrontUrl: string | null = null,
): HomepageContent {
  if (!row)
    return {
      texts: {},
      slides: null,
      blocks: null,
      footer: null,
      brandIds: null,
      brands: [],
      newsletter: null,
      imageHosts: [...imageHosts],
      storefrontUrl,
      updatedAt: null,
      projectionEnabled: false,
      projectionAllowed,
    };
  const texts: Record<string, string> = {};
  if (typeof row.texts === "object" && row.texts !== null)
    for (const [key, value] of Object.entries(row.texts))
      if (typeof value === "string") texts[key] = value;
  // the read cleans again, like the footer intro: a hand-written row is never handed on raw
  const short = withSanitizedShortTexts({
    texts,
    slides: Array.isArray(row.slides) ? (row.slides as HomepageSlide[]) : null,
  });
  return {
    texts: short.texts,
    slides: short.slides,
    blocks: storedBlocks(row.blocks),
    footer: storedFooter(row.footer),
    brandIds: storedBrandIds(row.featuredBrandIds),
    // the details come from the Brand table: the service fills them in (`withBrands`)
    brands: [],
    newsletter: storedNewsletter(row.newsletter),
    imageHosts: [...imageHosts],
    storefrontUrl,
    updatedAt: row.updatedAt.toISOString(),
    projectionEnabled: row.projectionEnabled === true,
    projectionAllowed,
  };
}

/**
 * THE HOME PAGE CONTENT (Balázs, 2026-10-20). The OS owns it; the Medusa
 * projection writes it to the commerce `homepage_content` module (#551), and a
 * save asks for one projection round at once, so an edit does not wait for the
 * scheduler's hour. The projection failing never fails the save.
 */
@Injectable()
export class HomepageContentService {
  constructor(
    @Inject(HOMEPAGE_CONTENT_STORE)
    private readonly store: HomepageContentStore,
    @Inject(HOMEPAGE_CONTENT_PROJECTOR)
    private readonly project: HomepageContentProjector,
    @Inject(HOMEPAGE_IMAGE_UPLOADER)
    private readonly uploadToShop: HomepageImageUploader,
    @Inject(HOMEPAGE_ENVIRONMENT)
    private readonly environment: NodeJS.ProcessEnv,
  ) {}

  /**
   * An editor's image upload. The type comes from the BYTES (a file named
   * .jpg that is something else is refused, and the shop never sees a name
   * that lies about its content), and the address that comes back is what the
   * editor puts into an image field.
   */
  async uploadImage(file: {
    originalname: string;
    buffer: Buffer;
  }): Promise<{ url: string }> {
    if (!file.buffer.length)
      throw new BadRequestException("A feltöltött kép üres.");
    if (file.buffer.length > HOMEPAGE_IMAGE_LIMITS.bytes)
      throw new BadRequestException("A kép legfeljebb 8 MB lehet.");
    const contentType = detectImageContentType(file.buffer);
    if (
      contentType === null ||
      !(HOMEPAGE_IMAGE_LIMITS.types as readonly string[]).includes(contentType)
    )
      throw new BadRequestException(
        "Csak JPEG, PNG vagy WebP kép tölthető fel (a fájl tartalma dönt, nem a neve).",
      );
    const row = await this.store.find(MAIN_HOMEPAGE_KEY);
    if (!homepageProjectionOn(this.environment, row))
      throw new ServiceUnavailableException(
        "A webshopba küldés ki van kapcsolva vagy ebben a környezetben nincs engedélyezve, a kép nem tölthető fel.",
      );
    /*
      THE NAME IS OURS, NOT THE EDITOR'S (barracuda, #1721). The browser's
      `originalname` is client data: a hand-built request can send
      "../../x.png" or "a\\b.png", and the shop's local file provider joins the
      directory part of a name to its upload folder. Nothing of it goes on: a
      random name and the extension of what the bytes are.
    */
    return this.uploadToShop({
      fileName: `kezdolap-${randomUUID()}${EXTENSION[contentType as keyof typeof EXTENSION]}`,
      contentType,
      content: file.buffer,
    });
  }

  /** The administrator's switch: send the content to the web shop (and allow uploads). */
  async setProjection(
    enabled: unknown,
    userId: string,
  ): Promise<{ projectionEnabled: boolean }> {
    if (typeof enabled !== "boolean")
      throw new BadRequestException("enabled: true vagy false");
    // turning it ON where the environment does not allow writing to the shop
    // would be a switch that does nothing: refuse it, and say why
    if (enabled && !homepageProjectionAllowed(this.environment))
      throw new ConflictException(
        "Ebben a környezetben a webshopba küldés nincs engedélyezve (MEDUSA_PROJECT_HOMEPAGE_CONTENT), a kapcsoló nem kapcsolható be.",
      );
    const row = await this.store.setProjection(
      MAIN_HOMEPAGE_KEY,
      enabled,
      userId,
    );
    return { projectionEnabled: row.projectionEnabled };
  }

  /** The products marked for the "Egyedi korallok" band, in order. */
  featured(): Promise<HomepageFeaturedRow[]> {
    return this.store.featuredList();
  }

  /**
   * The per-product marker (Balázs, 2026-10-20). A change asks for one
   * projection round where the projection is on, like a content save, and its
   * failure never fails the marker.
   */
  async setFeatured(
    productId: unknown,
    featured: unknown,
    userId: string,
  ): Promise<{
    featured: boolean;
    list: HomepageFeaturedRow[];
    projection: HomepageProjectionResult;
  }> {
    if (typeof productId !== "string" || !productId)
      throw new BadRequestException("productId: kötelező");
    if (typeof featured !== "boolean")
      throw new BadRequestException("featured: true vagy false");
    const outcome = await this.store.setFeatured(
      productId,
      featured,
      userId,
      HOMEPAGE_FEATURED_MAX,
    );
    if (outcome === "unknown-product")
      throw new NotFoundException("Nincs ilyen termék.");
    if (outcome === "full")
      throw new ConflictException(
        `A kezdőlapon legfeljebb ${HOMEPAGE_FEATURED_MAX} egyedi korall látszik.`,
      );
    const row = await this.store.find(MAIN_HOMEPAGE_KEY);
    let projection: HomepageProjectionResult;
    if (!homepageProjectionOn(this.environment, row)) projection = "off";
    else
      try {
        projection = await this.project();
      } catch {
        projection = "failed";
      }
    return { featured, list: await this.store.featuredList(), projection };
  }

  /**
   * THE BAND'S ORDER (2b-2): the first product is the large card. Like the
   * marker, a change asks for one projection round where it is on, and its
   * failure never fails the order.
   */
  async orderFeatured(
    productIds: unknown,
    userId: string,
  ): Promise<{
    list: HomepageFeaturedRow[];
    projection: HomepageProjectionResult;
  }> {
    if (
      !Array.isArray(productIds) ||
      productIds.length > HOMEPAGE_FEATURED_MAX ||
      productIds.some((id) => typeof id !== "string" || !id) ||
      new Set(productIds).size !== productIds.length
    )
      throw new BadRequestException(
        `productIds: legfeljebb ${HOMEPAGE_FEATURED_MAX} különböző termékazonosító`,
      );
    const outcome = await this.store.orderFeatured(
      productIds as string[],
      userId,
    );
    if (outcome === "mismatch")
      throw new ConflictException(
        "A kijelölt termékek közben változtak; töltsd újra a listát.",
      );
    const row = await this.store.find(MAIN_HOMEPAGE_KEY);
    let projection: HomepageProjectionResult;
    if (!homepageProjectionOn(this.environment, row)) projection = "off";
    else
      try {
        projection = await this.project();
      } catch {
        projection = "failed";
      }
    return { list: await this.store.featuredList(), projection };
  }

  /**
   * THE LISTED BRANDS' DETAILS, in the list's order. A brand deleted since the
   * save is left out here; its id stays in the stored list until the next save
   * (the projection skips it too).
   */
  private async withBrands(content: HomepageContent): Promise<HomepageContent> {
    if (!content.brandIds?.length) return content;
    const byId = new Map(
      (await this.store.brandsByIds(content.brandIds)).map((b) => [b.id, b]),
    );
    return {
      ...content,
      brands: content.brandIds.flatMap((id) => {
        const brand = byId.get(id);
        return brand ? [brand] : [];
      }),
    };
  }

  async get(): Promise<HomepageContent> {
    return this.withBrands(
      toHomepageContent(
        await this.store.find(MAIN_HOMEPAGE_KEY),
        homepageProjectionAllowed(this.environment),
        richTextImageHosts(this.environment),
        homepageStorefrontUrl(this.environment),
      ),
    );
  }

  async save(
    body: unknown,
    userId: string,
  ): Promise<{
    content: HomepageContent;
    projection: HomepageProjectionResult;
  }> {
    const parsed = parseHomepageContentInput(body);
    if (!parsed.ok) throw new BadRequestException(parsed.message);
    const clean = withSanitizedShortTexts(withSanitizedFooter(parsed.value));
    /*
      THE LIMIT HOLDS FOR WHAT IS STORED, NOT ONLY FOR WHAT ARRIVED (barracuda,
      #1878): the sanitizer can lengthen a text (a bare "<" becomes "&lt;"), and
      a stored intro over the limit would read back as no footer at all.
    */
    if (clean.footer && clean.footer.intro.length > HOMEPAGE_LIMITS.footerIntro)
      throw new BadRequestException(
        `footer.intro: at most ${HOMEPAGE_LIMITS.footerIntro} characters after cleaning`,
      );
    // the same for the formatted texts: the shop refuses the whole record over its caps
    for (const [key, value] of Object.entries(clean.texts))
      if (value.length > HOMEPAGE_LIMITS.textValue)
        throw new BadRequestException(
          `${key}: a formázott szöveg a tisztítás után legfeljebb ${HOMEPAGE_LIMITS.textValue} karakter lehet.`,
        );
    for (const [index, slide] of (clean.slides ?? []).entries())
      if (slide.text.length > HOMEPAGE_LIMITS.slideText)
        throw new BadRequestException(
          `${index + 1}. dia, szöveg: a tisztítás után legfeljebb ${HOMEPAGE_LIMITS.slideText} karakter lehet.`,
        );
    // every listed brand must exist: an unknown id would be a hole nobody can see in the editor
    if (clean.brandIds?.length) {
      const known = new Set(
        (await this.store.brandsByIds(clean.brandIds)).map((b) => b.id),
      );
      const unknown = clean.brandIds.find((id) => !known.has(id));
      if (unknown)
        throw new BadRequestException(
          `brandIds: ismeretlen márka (${unknown})`,
        );
    }
    const row = await this.store.save(MAIN_HOMEPAGE_KEY, clean, userId);
    let projection: HomepageProjectionResult;
    if (!homepageProjectionOn(this.environment, row)) projection = "off";
    else
      try {
        projection = await this.project();
      } catch {
        projection = "failed";
      }
    return {
      content: await this.withBrands(
        toHomepageContent(
          row,
          homepageProjectionAllowed(this.environment),
          richTextImageHosts(this.environment),
          homepageStorefrontUrl(this.environment),
        ),
      ),
      projection,
    };
  }
}
